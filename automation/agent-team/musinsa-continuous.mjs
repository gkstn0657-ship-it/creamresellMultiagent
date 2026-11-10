import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {runMusinsaProfitSearch} from './musinsa-profit-runner.mjs';
import {workOrders} from './work-orders.mjs';
import {writeJsonAtomic as write} from './atomic-json.mjs';
const read=p=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):null;
export async function runContinuousMusinsa({root,workId,run=runMusinsaProfitSearch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onEvent=()=>{},intervals={sourceExhausted:300000,lookupFailure:900000,otherFailure:300000}}){
 const dir=path.join(root,'explorations',workId);fs.mkdirSync(dir,{recursive:true});
 const lock=path.join(dir,'continuous.lock');
 if(fs.existsSync(lock)){let alive=false;try{process.kill(Number(fs.readFileSync(lock,'utf8')),0);alive=true;}catch{}if(alive)throw Error('CONTINUOUS_WORKER_ALREADY_RUNNING');fs.unlinkSync(lock);}
 fs.writeFileSync(lock,String(process.pid),{flag:'wx'});
 const stopped=()=>fs.existsSync(path.join(dir,'STOP'))||workOrders(root).find(w=>w.id===workId)?.status==='stopped';
 try{
  for(;;){
   const work=workOrders(root).find(w=>w.id===workId);
   if(!work||work.scopeMode!=='profitable-results'||work.continuous!==true)throw Error('CONTINUOUS_MUSINSA_WORK_REQUIRED');
   if(stopped())break;
   const result=await run({root,workId,onEvent});
   if(stopped())break;
   if(result.status==='source_exhausted'||result.status==='complete'){
    const memoryFile=path.join(root,'musinsa-discovery','state.json'),memory=read(memoryFile),key=JSON.stringify(result.settings);
    if(memory?.contexts?.[key]){memory.contexts[key].categoryIndex=0;write(memoryFile,memory);}
   }
   const waitMs=result.status==='source_exhausted'||result.status==='complete'?intervals.sourceExhausted:result.error==='KREAM_SEARCH_FAILED'?intervals.lookupFailure:intervals.otherFailure;
   const stateFile=path.join(dir,'state.json'),state=read(stateFile)||result;
   state.status='waiting_for_retry';state.waitReason=result.status==='source_exhausted'?'new_ranking_cycle':result.error||result.status;
   state.retryAt=new Date(Date.now()+waitMs).toISOString();write(stateFile,state);
   onEvent({type:'continuous_wait',reason:state.waitReason,retryAt:state.retryAt,found:state.profitableProductsFound});
   for(let left=waitMs;left>0&&!stopped();left-=1000)await sleep(Math.min(left,1000));
  }
  const stateFile=path.join(dir,'state.json'),state=read(stateFile)||{};state.status='stopped';state.finishedAt=new Date().toISOString();write(stateFile,state);
  return state;
 }finally{if(fs.existsSync(lock)&&fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const arg=n=>process.argv.find(v=>v.startsWith(`--${n}=`))?.slice(n.length+3);
 if(!arg('root')||!arg('work'))throw Error('ROOT_AND_WORK_REQUIRED');
 await runContinuousMusinsa({root:path.resolve(arg('root')),workId:arg('work'),onEvent:e=>console.log(JSON.stringify(e))});
}
