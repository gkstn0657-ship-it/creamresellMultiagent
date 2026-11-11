import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startWork,workOrders,workSummary,withWorkLock} from './work-orders.mjs';
import {writeJsonAtomic as write} from './atomic-json.mjs';

export async function startMusinsaInspection(root,args){
 return withWorkLock(root,async()=>{
  const summary=args.workId?workSummary(root,workOrders(root).find(w=>w.id===args.workId)):startWork(root,args);
  if(summary.scopeMode!=='inspected-sources')throw Error('INSPECTION_WORK_REQUIRED');
  if(summary.status==='stopped')throw Error('USER_WORK_SCOPE_REQUIRED');
  if(summary.exploration?.workerAlive||summary.status==='complete')return {...summary,launched:false};
  if(workOrders(root).some(w=>w.id!==summary.workId&&(workSummary(root,w).activeRunIds.length||workSummary(root,w).exploration?.workerAlive)))throw Error('ACTIVE_BATCH_EXISTS');
  const dir=path.join(root,'explorations',summary.workId);fs.mkdirSync(dir,{recursive:true});
  if(fs.existsSync(path.join(dir,'STOP')))throw Error('USER_WORK_SCOPE_REQUIRED');
  if(!fs.existsSync(path.join(dir,'state.json')))write(path.join(dir,'state.json'),{workId:summary.workId,status:'starting',mode:'live',source:'no1-musinsa-ranking',targetSources:summary.targetSources,runtimeDiscoveryAI:false,checkedSources:0,skipped:[],batches:[],startedAt:new Date().toISOString()});
  const fd=fs.openSync(path.join(dir,'continuous.log'),'a');let child;
  try{child=spawn(process.execPath,[fileURLToPath(new URL('./musinsa-profit-runner.mjs',import.meta.url)),`--root=${root}`,`--work=${summary.workId}`],{windowsHide:true,detached:true,stdio:['ignore',fd,fd]});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}finally{fs.closeSync(fd);}
  child.unref();write(path.join(dir,'process.json'),{pid:child.pid,at:new Date().toISOString()});
  return {...summary,launched:true,pid:child.pid};
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const arg=n=>process.argv.find(v=>v.startsWith(`--${n}=`))?.slice(n.length+3);
 const root=arg('root')?path.resolve(arg('root')):fileURLToPath(new URL('../../kream-runs/agent-teams/',import.meta.url));
 const args=arg('work')?{workId:arg('work')}:{targetSources:Number(arg('count')),userInstruction:arg('instruction'),requestId:arg('request'),...(arg('plan')?{sourcePlan:JSON.parse(fs.readFileSync(path.resolve(arg('plan')),'utf8'))}:{})};
 console.log(JSON.stringify(await startMusinsaInspection(root,args),null,2));
}
