import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {BackgroundClient} from '../../no1-background/client.mjs';
import {control} from '../control-mcp.mjs';
import {classifyError} from '../error-catalog.mjs';
import {reopenWork,withWorkLock} from '../work-orders.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const defaultRoot=path.resolve(here,'../../../../Cream/kream-runs/agent-teams');
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const alive=pid=>{try{if(!Number.isSafeInteger(pid)||pid<1)return false;process.kill(pid,0);return true;}catch{return false;}};
const safeWorkId=id=>typeof id==='string'&&/^work-[a-f0-9-]{36}$/.test(id);
const safeBatchId=id=>typeof id==='string'&&/^batch-[a-f0-9-]{36}$/.test(id);
const firstLine=text=>String(text||'').split(/[\r\n]/)[0].slice(0,220);
const modified=file=>{try{return fs.statSync(file).mtimeMs;}catch{return 0;}};

function recentEvents(file){
 try{
  const fd=fs.openSync(file,'r');let chunk;
  try{const n=fs.fstatSync(fd).size,size=Math.min(n,65536);chunk=Buffer.alloc(size);fs.readSync(fd,chunk,0,size,n-size);}finally{fs.closeSync(fd);}
  return chunk.toString('utf8').split(/\r?\n/).flatMap(line=>{try{const e=JSON.parse(line);return e.type&&!['agent_message','thread_started','turn_completed','tool_call','owner_ready'].includes(e.type)?[{type:e.type,sourceId:e.sourceId||e.productId||null,rank:e.rank||null,reason:e.reason||e.error||e.code||null,decision:e.decision||null,found:e.found??null,retryAt:e.retryAt||null}]:[];}catch{return [];}}).slice(-12).reverse();
 }catch{return [];}
}
export function liveDashboardData(root=defaultRoot,workId){
 const orders=path.join(root,'work-orders');
 const ids=safeWorkId(workId)?[workId]:fs.existsSync(orders)?fs.readdirSync(orders).filter(n=>safeWorkId(n.replace(/\.json$/,''))).map(n=>n.replace(/\.json$/,'')):[];
 const works=ids.map(id=>read(path.join(orders,id+'.json'))).filter(Boolean).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 const work=works.find(w=>w.status!=='stopped')||works[0];
 if(!work)return {version:1,observedAt:new Date().toISOString(),status:'not_started',workerAlive:false,checked:0,qualified:0,lookupSkippedCount:0,lookupSkipped:[],recent:[],events:[]};
 const dir=path.join(root,'explorations',work.id),state=read(path.join(dir,'state.json'))||{};
 const lookupSkipped=[...new Map((state.skipped||[]).filter(s=>s.lookupFailed===true).map(s=>[String(s.sourceId),s])).values()].reverse().map(s=>({
  sourceId:String(s.sourceId),name:firstLine(s.productName)||null,reason:firstLine(s.reason),attempts:Number.isSafeInteger(s.attempts)&&s.attempts>0?s.attempts:null,at:s.at&&Number.isFinite(Date.parse(s.at))?s.at:null,
  url:/^\d{1,12}$/.test(String(s.sourceId))?`https://www.musinsa.com/products/${s.sourceId}`:null,
 }));
 const monitor=read(path.join(dir,'monitor.json'));
 const healthMonitor=read(path.join(dir,'health-monitor.json'));
 const recoveryMonitor=read(path.join(dir,'exploration-watchdog.json'));
 const healthMonitorFresh=healthMonitor?.at&&Date.now()-Date.parse(healthMonitor.at)<30000;
 const healthMonitorAlive=alive(healthMonitor?.pid)&&!healthMonitor?.endedAt;
 const remoteMonitor=read(path.join(dir,'remote-monitor.json'));
 const monitorFresh=monitor?.at&&Date.now()-Date.parse(monitor.at)<30000;
 const workerPid=Number((()=>{try{return fs.readFileSync(path.join(dir,'continuous.lock'),'utf8');}catch{return 0;}})());
 const workerAlive=alive(workerPid)||alive(read(path.join(dir,'process.json'))?.pid);
 // Work reservations survive restarts; state.batches only covers this worker's run.
 const batches=[...new Map([...(work.entries||[]),...(state.batches||[]),{runId:state.currentRunId}].filter(b=>safeBatchId(b.runId)).map(b=>[b.runId,b])).values()];
 const general=!work.scopeMode&&Number.isSafeInteger(work.targetProducts);
 let updatedMs=modified(path.join(dir,'state.json')),collected=0;
 const recent=[];let judged=0,reviewed=0,adopted=0,held=0,excluded=0;
 for(const batch of batches){
  const data=read(path.join(root,batch.runId,'batch-state.json'));
  updatedMs=Math.max(updatedMs,modified(path.join(root,batch.runId,'batch-state.json')));
  collected+=data?.collected??(data?.status==='complete'?data.productCount||0:0);
  for(const row of data?.results||[]){
   if(row.status!=='complete')continue;
   if(row.status==='complete')judged++;
   if(row.assessment?.reviewId)reviewed++;
   if(row.assessment?.decision==='adopt')adopted++;
   if(row.assessment?.decision==='hold')held++;
   if(row.assessment?.decision==='exclude')excluded++;
   recent.push({platforms:[...new Set((row.marketSchemas||[]).map(s=>s.platform||'kream'))],qualifiedPlatforms:[...new Set((row.qualification?.eligibleOptions||[]).map(o=>o.platform||'kream'))],productId:String(row.productId||''),decision:row.assessment?.decision||'pending',reviewed:!!row.assessment?.reviewId,qualified:row.qualification?.passed===true,at:row.assessment?.at||data?.finishedAt||null,reason:firstLine(row.assessment?.reason),url:/^\d{1,12}$/.test(String(row.productId||''))?`https://kream.co.kr/products/${row.productId}`:null});
  }
 }
 recent.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
 const current=safeBatchId(state.currentRunId)?read(path.join(root,state.currentRunId,'batch-state.json')):null;
 const activeJudging=workerAlive&&state.status==='running_batch'&&current?.status==='judging';
 const status=work.status==='stopped'||state.status==='stopped'?'stopped':state.status==='complete'?'complete':!workerAlive?'offline':monitorFresh&&monitor.severity==='error'?'waiting':state.status==='waiting_for_retry'?'waiting':state.status==='recovering'?'recovering':state.status==='running_batch'?(current?.status==='judging'?'judging':'collecting'):state.status==='discovering'?'discovering':state.status||'starting';
 return {
  version:1,observedAt:new Date().toISOString(),workId:work.id,status,workerAlive,continuous:work.continuous===true,
  checked:general?collected:state.checkedSources||0,qualified:state.profitableProductsFound||0,initialTarget:work.targetSources||work.targetProfitableProducts||work.targetProducts||null,scopeMode:work.scopeMode||null,
  lookupSkippedCount:lookupSkipped.length,lookupSkipped:lookupSkipped.slice(0,50),
  judged,reviewed,adopted,held,excluded,pendingPackets:state.pendingSourceIds?.length||0,retrySources:state.retrySources?.length||0,
  brandPlan:state.brandPlan||null,
  current:{category:state.currentCategory||null,rank:state.currentSource?.brandRank||state.currentSource?.rank||null,brand:state.currentSource?.brandName||null,name:state.currentSource?.productName||null,sourceId:state.currentSource?.productId||null},
  lastBatch:{runId:state.currentRunId||null,status:current?.status||null,productCount:current?.productCount||0,collected:current?.collected||0,judged:(current?.results||[]).filter(r=>r.status==='complete').length},
  agents:{owner:activeJudging?'judging':'idle',reviewer:activeJudging?'possibly_reviewing':'idle'},
  updatedAt:updatedMs?new Date(updatedMs).toISOString():state.updatedAt||null,retryAt:state.retryAt||null,waitReason:status==='waiting'&&monitorFresh&&monitor.severity==='error'?monitor.reason:state.waitReason||null,error:state.error||null,
  monitor:monitorFresh?{code:monitor.code,status:monitor.status,reason:monitor.reason,handler:monitor.handler,action:monitor.action,remoteBridge:remoteMonitor||monitor.remoteBridge||null,at:monitor.at}:null,
  healthMonitor:healthMonitor?{active:!!healthMonitorFresh&&healthMonitorAlive,at:healthMonitor.at,status:healthMonitor.status,reason:healthMonitor.reason,code:healthMonitor.code,ai:healthMonitor.ai||null,mode:'read-only'}:null,
  recoveryMonitor:recoveryMonitor?{active:alive(recoveryMonitor.pid)&&Date.now()-Date.parse(recoveryMonitor.at)<30000,at:recoveryMonitor.at,status:recoveryMonitor.status,reason:recoveryMonitor.reason,attempts:recoveryMonitor.attempts?.length||0,mode:recoveryMonitor.mode}:null,
  featured:recent.find(r=>r.qualified)||null,recent:recent.slice(0,8),events:recentEvents(path.join(dir,general?'runtime.log':'continuous.log')),
 };
}
export async function startDashboardWork({root,workId,client=new BackgroundClient(),continueWork=control}={}){
 if(!safeWorkId(workId))throw Error('INVALID_WORK_ID');
 const workFile=path.join(root,'work-orders',workId+'.json'),work=read(workFile);
 if(!work||work.scopeMode!=='profitable-results'||work.continuous!==true)throw Error('ACTIVE_MUSINSA_WORK_REQUIRED');
 const dir=path.join(root,'explorations',workId);
 if(work.status==='stopped')await withWorkLock(root,()=>{
  reopenWork(root,workId);
  for(const file of [path.join(dir,'STOP'),...work.entries.map(e=>path.join(root,e.runId,'STOP'))])if(fs.existsSync(file))fs.unlinkSync(file);
  for(const entry of work.entries){const judgments=path.join(root,entry.runId,'judgments');if(!fs.existsSync(judgments))continue;
   for(const name of fs.readdirSync(judgments).filter(n=>/^(?:\d{1,12}|poizon-\d{1,18})$/.test(n))){const file=path.join(judgments,name,'STOP');if(fs.existsSync(file))fs.unlinkSync(file);}}
 });
 const result=await continueWork('cream_musinsa_work_continue',{workId},{root});
 let bridge;try{bridge=await client.status();}catch{return {ok:false,code:503,reason:'NO1_BRIDGE_UNAVAILABLE',workerStarted:result.launched===true||result.reused===true};}
 if(bridge.browserConnected!==true)return {ok:false,code:503,reason:'NO1_BRIDGE_DISCONNECTED',workerStarted:result.launched===true||result.reused===true};
 if(bridge.connectorVersion!==bridge.requiredConnectorVersion)return {ok:false,code:426,reason:'NO1_CONNECTOR_UPDATE_REQUIRED',workerStarted:result.launched===true||result.reused===true};
 const state=read(path.join(dir,'state.json'));
 if(state?.status==='waiting_for_retry')fs.writeFileSync(path.join(dir,'WAKE'),'dashboard start');
 return {ok:true,code:200,reason:state?.status==='waiting_for_retry'?'RETRY_WOKEN':'WORK_RUNNING',workerStarted:result.launched===true||result.reused===true};
}
export function createDashboardServer({root=defaultRoot,workId,port=8875,start=startDashboardWork}={}){
 const files=new Map([['/','index.html'],['/app.css','app.css'],['/app.js','app.js']]);
 const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
 let starting=null;
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'");
  if(url.pathname==='/api/start'&&req.method==='POST'){
   const origin=`http://127.0.0.1:${server.address()?.port||port}`;
   if(req.headers.origin!==origin||!String(req.headers['content-type']||'').startsWith('application/json')){res.writeHead(403);res.end();return;}
   let body='';req.on('data',part=>{body+=part;if(body.length>1024)req.destroy();});
   req.on('end',async()=>{let requested;try{requested=JSON.parse(body).workId;}catch{res.writeHead(400);res.end();return;}
    const selected=liveDashboardData(root,workId).workId;
    if(!safeWorkId(requested)||requested!==selected){res.writeHead(400);res.end();return;}
    try{if(!starting)starting=Promise.resolve(start({root,workId:requested})).finally(()=>{starting=null;});const result=await starting;
     res.writeHead(result.ok?200:[426,503].includes(result.code)?result.code:409,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
    }catch(e){const classified=classifyError({reason:e.message});res.writeHead(classified.code===409?409:500,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,code:classified.code,reason:classified.reason}));}
   });return;
  }
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
 const root=arg('root')?path.resolve(arg('root')):defaultRoot,port=Number(arg('port')||8875);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('INVALID_DASHBOARD_PORT');
 const app=createDashboardServer({root,workId:arg('work'),port});await app.listen();console.log(JSON.stringify({app:'cream-musinsa-live-dashboard-v1',port,root}));
}
