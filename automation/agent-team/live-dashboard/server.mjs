import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const defaultRoot=path.resolve(here,'../../../../Cream/kream-runs/agent-teams');
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const alive=pid=>{try{if(!Number.isSafeInteger(pid)||pid<1)return false;process.kill(pid,0);return true;}catch{return false;}};
const safeWorkId=id=>typeof id==='string'&&/^work-[a-f0-9-]{36}$/.test(id);
const safeBatchId=id=>typeof id==='string'&&/^batch-[a-f0-9-]{36}$/.test(id);
const firstLine=text=>String(text||'').split(/[\r\n]/)[0].slice(0,220);

function recentEvents(file){
 try{
  const fd=fs.openSync(file,'r');let chunk;
  try{const n=fs.fstatSync(fd).size,size=Math.min(n,65536);chunk=Buffer.alloc(size);fs.readSync(fd,chunk,0,size,n-size);}finally{fs.closeSync(fd);}
  return chunk.toString('utf8').split(/\r?\n/).flatMap(line=>{try{const e=JSON.parse(line);return e.type?[{type:e.type,sourceId:e.sourceId||null,rank:e.rank||null,reason:e.reason||e.error||null,decision:e.decision||null,found:e.found??null,retryAt:e.retryAt||null}]:[];}catch{return [];}}).slice(-12).reverse();
 }catch{return [];}
}
export function liveDashboardData(root=defaultRoot,workId){
 const orders=path.join(root,'work-orders');
 const ids=safeWorkId(workId)?[workId]:fs.existsSync(orders)?fs.readdirSync(orders).filter(n=>safeWorkId(n.replace(/\.json$/,''))).map(n=>n.replace(/\.json$/,'')):[];
 const works=ids.map(id=>read(path.join(orders,id+'.json'))).filter(Boolean).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 const work=works.find(w=>w.status!=='stopped')||works[0];
 if(!work)return {version:1,observedAt:new Date().toISOString(),status:'not_started',workerAlive:false,checked:0,qualified:0,recent:[],events:[]};
 const dir=path.join(root,'explorations',work.id),state=read(path.join(dir,'state.json'))||{};
 const monitor=read(path.join(dir,'monitor.json'));
 const monitorFresh=monitor?.at&&Date.now()-Date.parse(monitor.at)<30000;
 const workerPid=Number((()=>{try{return fs.readFileSync(path.join(dir,'continuous.lock'),'utf8');}catch{return 0;}})());
 const workerAlive=alive(workerPid);
 const batches=(state.batches||[]).filter(b=>safeBatchId(b.runId));
 const recent=[];let judged=0,reviewed=0,adopted=0,held=0,excluded=0;
 for(const batch of batches){
  const data=read(path.join(root,batch.runId,'batch-state.json'));
  for(const row of data?.results||[]){
   if(row.status==='complete')judged++;
   if(row.assessment?.reviewId)reviewed++;
   if(row.assessment?.decision==='adopt')adopted++;
   if(row.assessment?.decision==='hold')held++;
   if(row.assessment?.decision==='exclude')excluded++;
   recent.push({productId:String(row.productId||''),decision:row.assessment?.decision||'pending',reviewed:!!row.assessment?.reviewId,qualified:row.qualification?.passed===true,at:row.assessment?.at||data?.finishedAt||null,reason:firstLine(row.assessment?.reason),url:/^\d{1,12}$/.test(String(row.productId||''))?`https://kream.co.kr/products/${row.productId}`:null});
  }
 }
 recent.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
 const current=safeBatchId(state.currentRunId)?read(path.join(root,state.currentRunId,'batch-state.json')):null;
 const activeJudging=workerAlive&&state.status==='running_batch'&&current?.status==='judging';
 const status=work.status==='stopped'||state.status==='stopped'?'stopped':!workerAlive?'offline':monitorFresh&&monitor.severity==='error'?'waiting':state.status==='waiting_for_retry'?'waiting':state.status==='recovering'?'recovering':state.status==='running_batch'?'judging':state.status==='discovering'?'discovering':state.status||'starting';
 return {
  version:1,observedAt:new Date().toISOString(),workId:work.id,status,workerAlive,continuous:work.continuous===true,
  checked:state.checkedSources||0,qualified:state.profitableProductsFound||0,initialTarget:work.targetProfitableProducts||null,
  judged,reviewed,adopted,held,excluded,pendingPackets:state.pendingSourceIds?.length||0,retrySources:state.retrySources?.length||0,
  current:{category:state.currentCategory||null,rank:state.currentSource?.rank||null,name:state.currentSource?.productName||null,sourceId:state.currentSource?.productId||null},
  lastBatch:{runId:state.currentRunId||null,status:current?.status||null,productCount:current?.productCount||0,judged:current?.judged||0},
  agents:{owner:activeJudging?'judging':'idle',reviewer:activeJudging?'possibly_reviewing':'idle'},
  updatedAt:state.updatedAt||null,retryAt:state.retryAt||null,waitReason:status==='waiting'&&monitorFresh&&monitor.severity==='error'?monitor.reason:state.waitReason||null,error:state.error||null,
  monitor:monitorFresh?{code:monitor.code,status:monitor.status,reason:monitor.reason,handler:monitor.handler,action:monitor.action,at:monitor.at}:null,
  featured:recent.find(r=>r.qualified)||null,recent:recent.slice(0,8),events:recentEvents(path.join(dir,'continuous.log')),
 };
}
export function createDashboardServer({root=defaultRoot,workId,port=8874}={}){
 const files=new Map([['/','index.html'],['/app.css','app.css'],['/app.js','app.js']]);
 const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'");
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  if(url.pathname==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'cream-musinsa-live-dashboard-v1'}));return;}
  if(url.pathname==='/api/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(liveDashboardData(root,workId)));return;}
  const file=files.get(url.pathname);if(!file){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',types[path.extname(file)]);res.end(fs.readFileSync(path.join(here,file)));
 });
 return {server,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server.address()));})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const arg=n=>process.argv.find(v=>v.startsWith(`--${n}=`))?.slice(n.length+3);
 const root=arg('root')?path.resolve(arg('root')):defaultRoot,port=Number(arg('port')||8874);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('INVALID_DASHBOARD_PORT');
 const app=createDashboardServer({root,workId:arg('work'),port});await app.listen();console.log(JSON.stringify({app:'cream-musinsa-live-dashboard-v1',port,root}));
}
