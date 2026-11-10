import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {workOrders,workSummary,withWorkLock,reserveWork,explorationState,reopenWork} from './work-orders.mjs';
import {writeJsonAtomic as write} from './atomic-json.mjs';
import {DiscoveryStore} from './discovery-store.mjs';
import {selectNext} from './discovery-feed.mjs';
import {groupProducts} from './packets.mjs';
import {digest} from './store.mjs';
import {runBatch,prepareBatch} from './batch.mjs';
const read=file=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
const batchId=(workId,index)=>'batch-'+crypto.createHash('sha256').update(`discovery-v1:${workId}:${index}`).digest('hex').slice(0,32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
export const explorationDir=(root,id)=>{if(!/^work-[a-f0-9-]{36}$/.test(id||''))throw Error('INVALID_WORK_ID');return path.join(root,'explorations',id);};
export async function startExploration(root,{workId,resume=false},options={}){
 if(typeof resume!=='boolean')throw Error('INVALID_RESUME_FLAG');
 return withWorkLock(root,async()=>{
  let work=workOrders(root).find(w=>w.id===workId);if(!work)throw Error('USER_WORK_SCOPE_REQUIRED');
  if(work.scopeMode==='profitable-results')throw Error('USE_MUSINSA_PROFIT_RUNNER');
  if(work.status==='stopped'){if(!resume)throw Error('USER_WORK_SCOPE_REQUIRED');reopenWork(root,workId);work=workOrders(root).find(w=>w.id===workId);}
  const summary=workSummary(root,work),prior=explorationState(root,workId);
  if(prior?.workerAlive||prior?.status==='complete')return {...prior,reused:true,launched:false};
  if(prior&&!resume)return {...prior,reused:true,launched:false,requiredAction:'Resume this same work explicitly; do not create replacement work.'};
  if(workOrders(root).some(w=>workSummary(root,w).activeRunIds.length||explorationState(root,w.id)?.workerAlive))throw Error('ACTIVE_BATCH_EXISTS');
  if(!summary.remainingProducts&&!work.entries.some(e=>read(path.join(root,e.runId,'batch-state.json'))?.status!=='complete'))return {status:'complete',launched:false,workId};
  const dir=explorationDir(root,workId);fs.mkdirSync(dir,{recursive:true});
  if(fs.existsSync(path.join(dir,'STOP')))fs.unlinkSync(path.join(dir,'STOP'));
  write(path.join(dir,'state.json'),{workId,status:'starting',startedAt:new Date().toISOString(),runtimeDiscoveryAI:false,mode:'live'});
  let child;
  if(options.launchExploration)child=await options.launchExploration({root,workId,dir,resume});
  else{
   const fd=fs.openSync(path.join(dir,'runtime.log'),'a');
   try{
    const p=spawn(process.execPath,[fileURLToPath(import.meta.url),`--root=${root}`,`--work=${workId}`,...(resume?['--resume']:[])],{windowsHide:true,detached:true,stdio:['ignore',fd,fd]});
    await new Promise((resolve,reject)=>{p.once('spawn',resolve);p.once('error',reject);});p.unref();child={pid:p.pid,launched:true};
   }finally{fs.closeSync(fd);}
  }
  write(path.join(dir,'process.json'),{pid:child.pid,at:new Date().toISOString()});return {workId,status:'starting',runtimeDiscoveryAI:false,...child};
 });
}
export async function runExploration({root,workId,feed,executeBatch=runBatch,mode='live',prefetchBatch=mode==='live'?prepareBatch:null,onEvent=()=>{}}){
 const dir=explorationDir(root,workId);fs.mkdirSync(dir,{recursive:true});
 const lock=path.join(dir,'worker.lock');
 if(fs.existsSync(lock)){let alive=false;try{process.kill(Number(fs.readFileSync(lock,'utf8')),0);alive=true;}catch{}if(alive)throw Error('EXPLORATION_ALREADY_RUNNING');fs.unlinkSync(lock);}
 fs.writeFileSync(lock,String(process.pid),{flag:'wx'});
 const store=new DiscoveryStore(path.join(root,'discovery'));
 store.importCompleted(root);
 const stop=()=>fs.existsSync(path.join(dir,'STOP'))||workOrders(root).find(w=>w.id===workId)?.status==='stopped';
 const state={workId,status:'discovering',runtimeDiscoveryAI:false,startedAt:new Date().toISOString(),mode,batches:[]};
 const save=()=>write(path.join(dir,'state.json'),state);
 let prefetch=null,abortPrefetch=false;
 const startPrefetch=currentId=>{
  if(!prefetchBatch||prefetch||stop())return;
  prefetch=(async()=>{
   const work=workOrders(root).find(w=>w.id===workId),remaining=workSummary(root,work).remainingProducts;
   if(!remaining)return null;
   const id=batchId(workId,work.entries.length),batchDir=path.join(root,id);
   const seeds=await selectNext(store,id,Math.min(5,remaining),{feed,stopped:()=>stop()||abortPrefetch});
   if(stop()||abortPrefetch)return null;
   await withWorkLock(root,()=>{
    if(stop()||abortPrefetch)throw Error('STOP_REQUESTED');
    reserveWork(root,{workId,runId:id,productCount:groupProducts(seeds).length,requestId:`discovery:${id}`,scopeHash:digest(groupProducts(seeds)),prefetchAfterRunId:read(path.join(root,currentId,'batch-state.json'))?.status==='judging'?currentId:null});
    fs.mkdirSync(batchDir,{recursive:true});write(path.join(batchDir,'products.json'),seeds);
    write(path.join(batchDir,'launch.json'),{workId,concurrency:2,managedBy:'deterministic-exploration',prefetchedAfter:currentId,createdAt:new Date().toISOString()});
    write(path.join(batchDir,'process.json'),{pid:process.pid,launchedAt:new Date().toISOString()});
    write(path.join(batchDir,'batch-state.json'),{version:'cream-product-batch-v1',mode,status:'prefetching',productCount:seeds.length,collected:0,judged:0,results:[]});
   });
   state.prefetchRunId=id;save();onEvent({type:'batch_prefetch_started',runId:id,afterRunId:currentId});
   await prefetchBatch({seeds,dir:batchDir,mode,stopped:()=>stop()||abortPrefetch,onEvent:e=>onEvent({...e,runId:id,prefetch:true})});
   onEvent({type:'batch_prefetch_complete',runId:id});return {runId:id};
  })().catch(e=>({error:e.message}));
 };
 try{
  save();
  while(!stop()){
   const work=workOrders(root).find(w=>w.id===workId);if(!work)throw Error('USER_WORK_SCOPE_REQUIRED');
   const pending=work.entries.find(e=>read(path.join(root,e.runId,'batch-state.json'))?.status!=='complete');
   const remaining=workSummary(root,work).remainingProducts;
   if(!pending&&!remaining){state.status='complete';break;}
   const id=pending?.runId||batchId(workId,work.entries.length),batchDir=path.join(root,id);
   state.status='discovering';state.currentRunId=id;save();
   let seeds=read(path.join(batchDir,'products.json'));
   if(!seeds?.length){seeds=await selectNext(store,id,pending?.productCount||Math.min(5,remaining),{feed,stopped:stop});}
   if(stop())break;
   await withWorkLock(root,()=>{
    if(stop())throw Error('STOP_REQUESTED');
    reserveWork(root,{workId,runId:id,productCount:groupProducts(seeds).length,requestId:`discovery:${id}`,scopeHash:digest(groupProducts(seeds))});
    fs.mkdirSync(batchDir,{recursive:true});write(path.join(batchDir,'products.json'),seeds);
    write(path.join(batchDir,'launch.json'),{workId,concurrency:2,requestId:`discovery:${id}`,managedBy:'deterministic-exploration',createdAt:new Date().toISOString()});
    write(path.join(batchDir,'process.json'),{pid:process.pid,launchedAt:new Date().toISOString()});
    if(fs.existsSync(path.join(batchDir,'STOP')))fs.unlinkSync(path.join(batchDir,'STOP'));
    const judgments=path.join(batchDir,'judgments');
    if(pending&&fs.existsSync(judgments))for(const name of fs.readdirSync(judgments).filter(n=>/^\d+$/.test(n))){const stopFile=path.join(judgments,name,'STOP');if(fs.existsSync(stopFile))fs.unlinkSync(stopFile);}
   });
   state.status='running_batch';state.discovery=store.status();save();
   const result=await executeBatch({seeds,dir:batchDir,concurrency:2,resume:Boolean(pending),mode,onEvent,onCollected:()=>startPrefetch(id)});
   state.batches.push({runId:id,status:result.status,productCount:seeds.length});save();
   if(result.status!=='complete')abortPrefetch=true;
   const prepared=await prefetch;prefetch=null;delete state.prefetchRunId;save();
   if(prepared?.error&&!stop())throw Error('PREFETCH_FAILED: '+prepared.error);
   if(result.status!=='complete')throw Error('BATCH_NEEDS_ATTENTION');
  }
  if(stop())state.status='stopped';
 }catch(e){
  state.status=stop()?'stopped':e.message==='DISCOVERY_EXHAUSTED'?'source_exhausted':'needs_attention';state.error=e.message;
  // A failed preparation is a real failed batch attempt with zero products.
  // It reaches the existing completion subscriber without spending the N quota.
  if(state.currentRunId){const batchDir=path.join(root,state.currentRunId);if(!fs.existsSync(path.join(batchDir,'batch-state.json'))){
   fs.mkdirSync(batchDir,{recursive:true});write(path.join(batchDir,'products.json'),[]);
   write(path.join(batchDir,'launch.json'),{workId,concurrency:2,managedBy:'deterministic-exploration',stage:'discovery'});
   write(path.join(batchDir,'batch-state.json'),{version:'cream-product-batch-v1',mode,status:state.status==='stopped'?'stopped':'needs_attention',stage:'discovery',productCount:0,collected:0,judged:0,results:[],error:'DISCOVERY_STAGE: '+e.message,startedAt:state.startedAt,finishedAt:new Date().toISOString()});
  }}
 }
 finally{abortPrefetch=true;await prefetch;state.finishedAt=new Date().toISOString();state.discovery=store.status();save();store.close();if(fs.existsSync(lock)&&fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}
 return state;
}
export function discoveryStatus(root){const file=path.join(root,'discovery','discovery.sqlite');if(!fs.existsSync(file))return {status:'not_started',runtimeDiscoveryAI:false};const s=new DiscoveryStore(path.dirname(file));try{return s.status();}finally{s.close();}}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const arg=name=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
 if(!arg('root')||!arg('work'))throw Error('EXPLORATION_ARGUMENTS_REQUIRED');
 const result=await runExploration({root:arg('root'),workId:arg('work'),onEvent:e=>console.log(JSON.stringify(e))});
 console.log(JSON.stringify({workId:result.workId,status:result.status,error:result.error}));if(result.status!=='complete')process.exitCode=2;
}
