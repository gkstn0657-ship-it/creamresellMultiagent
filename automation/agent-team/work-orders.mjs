import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {writeJsonAtomic} from './atomic-json.mjs';
const read=file=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
const alive=pid=>{if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch{return false;}};
const orderDir=root=>path.join(root,'work-orders');
export function explorationState(root,workId){
 const dir=path.join(root,'explorations',workId),state=read(path.join(dir,'state.json'));if(!state)return null;
 const workerAlive=alive(read(path.join(dir,'process.json'))?.pid);
 return {...state,workerAlive,...(!workerAlive&&['starting','discovering','running_batch'].includes(state.status)?{status:'needs_attention',error:'EXPLORATION_WORKER_NOT_RUNNING'}:{})};
}
export const workPolicy={scopeMode:'ask-user-per-work',dailyLimit:null,maxBatchProducts:5,maxConcurrentProducts:2,maxActiveBatches:1,maxPrefetchBatches:1};
export function workOrders(root){const dir=orderDir(root);return fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>/^work-[a-f0-9-]{36}\.json$/.test(n)).map(n=>read(path.join(dir,n))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)):[];}
export function workSummary(root,work){
 if(!work)return {status:'awaiting_user_scope',policy:workPolicy,requiredQuestion:'이번 작업에서 상품을 몇 개 탐색할까요?'};
 const entries=work.entries.map(e=>{const dir=path.join(root,e.runId),state=read(path.join(dir,'batch-state.json')),proc=read(path.join(dir,'process.json'));return {...e,status:state?.status||'starting',workerAlive:alive(proc?.pid),judged:state?.judged||0};});
 const reserved=entries.reduce((n,e)=>n+e.productCount,0),activeRunIds=entries.filter(e=>e.workerAlive&&!['complete','stopped','needs_attention','prefetching','prefetched'].includes(e.status)).map(e=>e.runId);
 const remaining=Math.max(0,work.targetProducts-reserved);
 const exploration=explorationState(root,work.id);
 const status=work.status==='stopped'?'stopped':activeRunIds.length||exploration?.workerAlive?'running':['needs_attention','source_exhausted'].includes(exploration?.status)?exploration.status:remaining?'ready':entries.every(e=>e.status==='complete')?'complete':'needs_attention';
 return {workId:work.id,status,targetProducts:work.targetProducts,reservedProducts:reserved,remainingProducts:remaining,judgedProducts:entries.reduce((n,e)=>n+e.judged,0),activeRunIds,entries,exploration,createdAt:work.createdAt,userInstruction:work.userInstruction,policy:workPolicy};
}
export function currentWork(root){return workOrders(root).find(w=>{const s=workSummary(root,w);return w.status!=='stopped'&&(s.status!=='complete');})||null;}
export function scopeStatus(root,{eventId}={}){
 const orders=workOrders(root),work=currentWork(root)||orders[0]||null;
 const trigger=eventId?orders.flatMap(w=>w.entries.filter(e=>e.triggerEventId===eventId).map(e=>({workId:w.id,...e}))):[];
 return {...workSummary(root,work),...(eventId?{trigger:{eventId,followUpStarted:trigger.length>0,runs:trigger}}:{})};
}
export async function withWorkLock(root,fn){
 fs.mkdirSync(root,{recursive:true});const file=path.join(root,'work-control.lock');let fd;
 for(let n=0;n<2;n++)try{fd=fs.openSync(file,'wx');break;}catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(fs.readFileSync(file,'utf8'));if(!Number.isSafeInteger(pid)||pid<1||alive(pid))throw Error('WORK_CONTROL_BUSY: read status before retrying');fs.unlinkSync(file);}
 if(fd===undefined)throw Error('WORK_CONTROL_BUSY');fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);
 try{return await fn();}finally{if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===String(process.pid))fs.unlinkSync(file);}
}
export function startWork(root,{targetProducts,userInstruction,requestId}){
 if(!Number.isSafeInteger(targetProducts)||targetProducts<1)throw Error('USER_PRODUCT_COUNT_REQUIRED');
 if(typeof userInstruction!=='string'||!userInstruction.trim()||userInstruction.length>4000)throw Error('USER_SCOPE_INSTRUCTION_REQUIRED');
 if(typeof requestId!=='string'||!requestId.trim()||requestId.length>160)throw Error('WORK_REQUEST_ID_REQUIRED');
 const hex=crypto.createHash('sha256').update(requestId).digest('hex').slice(0,32),id='work-'+hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
 const file=path.join(orderDir(root),id+'.json'),old=read(file);
 if(old){if(old.targetProducts!==targetProducts||old.userInstruction!==userInstruction)throw Error('WORK_REQUEST_SCOPE_CONFLICT');return {...workSummary(root,old),reused:true};}
 if(currentWork(root))throw Error('WORK_SCOPE_ALREADY_ACTIVE: finish or explicitly stop it before opening another');
 const work={id,status:'open',targetProducts,userInstruction,requestId,createdAt:new Date().toISOString(),entries:[]};writeJsonAtomic(file,work);return workSummary(root,work);
}
export function reserveWork(root,{workId,runId,productCount,triggerEventId=null,requestId=null,scopeHash=null,prefetchAfterRunId=null}){
 const orders=workOrders(root),reserved=orders.find(w=>w.entries.some(e=>e.runId===runId));
 if(reserved){const e=reserved.entries.find(e=>e.runId===runId);if(reserved.status==='stopped')throw Error('USER_WORK_SCOPE_REQUIRED');if(e.productCount!==productCount||e.scopeHash!==scopeHash||(workId&&reserved.id!==workId))throw Error('REQUEST_ID_SCOPE_CONFLICT');if(orders.some(w=>workSummary(root,w).activeRunIds.length))throw Error('ACTIVE_BATCH_EXISTS');return reserved.id;}
 const work=workId?orders.find(w=>w.id===workId):currentWork(root);
 if(!work||work.status==='stopped')throw Error('USER_WORK_SCOPE_REQUIRED: ask the user how many products for this work');
 const summary=workSummary(root,work);
 const prefetchAllowed=prefetchAfterRunId&&work.entries.some(e=>e.runId===prefetchAfterRunId)&&read(path.join(root,prefetchAfterRunId,'batch-state.json'))?.status==='judging'&&read(path.join(root,prefetchAfterRunId,'launch.json'))?.managedBy==='deterministic-exploration'&&read(path.join(root,prefetchAfterRunId,'process.json'))?.pid===process.pid&&!summary.entries.some(e=>['prefetching','prefetched'].includes(e.status));
 if(prefetchAfterRunId&&!prefetchAllowed)throw Error('PREFETCH_SCOPE_INVALID');
 if(summary.activeRunIds.some(id=>!prefetchAllowed||id!==prefetchAfterRunId))throw Error('ACTIVE_BATCH_EXISTS: '+summary.activeRunIds.join(','));
 if(productCount>summary.remainingProducts)throw Error('WORK_PRODUCT_LIMIT: remaining '+summary.remainingProducts);
 if(orders.some(w=>workSummary(root,w).activeRunIds.some(id=>!prefetchAllowed||w.id!==work.id||id!==prefetchAfterRunId)))throw Error('ACTIVE_BATCH_EXISTS');
 if(triggerEventId&&orders.some(w=>w.entries.some(e=>e.triggerEventId===triggerEventId)))throw Error('EVENT_FOLLOWUP_ALREADY_STARTED');
 work.entries.push({runId,productCount,triggerEventId,requestId,scopeHash,at:new Date().toISOString()});writeJsonAtomic(path.join(orderDir(root),work.id+'.json'),work);return work.id;
}
export function stopWork(root,workId){
 const work=workOrders(root).find(w=>w.id===workId);if(!work)throw Error('WORK_NOT_FOUND');
 work.status='stopped';writeJsonAtomic(path.join(orderDir(root),work.id+'.json'),work);
 const explorationDir=path.join(root,'explorations',work.id);if(fs.existsSync(explorationDir))fs.writeFileSync(path.join(explorationDir,'STOP'),'work stopped');
 for(const e of work.entries){const dir=path.join(root,e.runId);if(!fs.existsSync(dir))continue;fs.writeFileSync(path.join(dir,'STOP'),'work stopped');const j=path.join(dir,'judgments');if(fs.existsSync(j))for(const id of fs.readdirSync(j).filter(n=>/^\d+$/.test(n)))fs.writeFileSync(path.join(j,id,'STOP'),'work stopped');}
 return workSummary(root,work);
}
export function reopenWork(root,workId){
 const work=workOrders(root).find(w=>w.id===workId);if(!work)throw Error('USER_WORK_SCOPE_REQUIRED');
 if(workSummary(root,work).activeRunIds.length)throw Error('ACTIVE_BATCH_EXISTS');
 const other=currentWork(root);if(other&&other.id!==work.id)throw Error('WORK_SCOPE_ALREADY_ACTIVE');
 work.status='open';writeJsonAtomic(path.join(orderDir(root),work.id+'.json'),work);return work;
}
