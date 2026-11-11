import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {BackgroundClient} from '../no1-background/client.mjs';
import {startExploration} from './exploration.mjs';
import {isAlive,monitorDirectory} from './health-monitor.mjs';
import {writeJsonAtomic as write} from './atomic-json.mjs';
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
const retryable=new Set(['ASSESSMENT_NOT_COMPLETE','REVIEW_NOT_RECORDED','CODEX_TURN_TIMEOUT','TEAM_TOOL_BUDGET_REACHED','REVIEW_BUDGET_REACHED']);
const automaticResume=(root,args)=>startExploration(root,args,{requireOpenWork:true});

// Deterministic recovery only. The AI diagnostic report is never a command.
export async function pollExplorationWatchdog({root,workId,client=new BackgroundClient(),resume=automaticResume,alive=isAlive,now=Date.now}){
 const dir=monitorDirectory(root,workId),file=path.join(dir,'exploration-watchdog.json');
 const previous=read(file),work=read(path.join(root,'work-orders',workId+'.json')),state=read(path.join(dir,'state.json'));
 const attempts=previous?.attempts||[];
 const report={version:1,workId,pid:process.pid,at:new Date(now()).toISOString(),pollIntervalMs:10000,mode:'bounded-auto-resume',attempts};
 const finish=(status,reason,extra={})=>{Object.assign(report,{status,reason},extra);write(file,report);return report;};
 if(!work||work.scopeMode||!Number.isSafeInteger(work.targetProducts))return finish('blocked','GENERAL_WORK_REQUIRED');
 if(work.status==='stopped'||fs.existsSync(path.join(dir,'STOP'))||state?.status==='stopped')return finish('stopped','USER_STOPPED',{terminal:true});
 if(['complete','source_exhausted'].includes(state?.status))return finish('complete',state.status,{terminal:true});
 if(alive(read(path.join(dir,'process.json'))?.pid))return finish('watching','WORKER_RUNNING');
 if(state?.status!=='needs_attention'||state?.error!=='BATCH_NEEDS_ATTENTION')return finish('blocked',state?.error||'UNCLASSIFIED_WORKER_EXIT');
 const runId=state.currentRunId;
 if(!work.entries?.some(e=>e.runId===runId))return finish('blocked','BATCH_OUTSIDE_WORK');
 const batch=read(path.join(root,runId,'batch-state.json'));
 const failed=(batch?.results||[]).filter(r=>r.status!=='complete');
 if(!failed.length||failed.some(r=>!retryable.has(r.error)))return finish('blocked','ERROR_REQUIRES_INSPECTION');
 const prior=attempts.filter(a=>a.runId===runId);
 if(prior.length>=2)return finish('blocked','BATCH_RETRY_LIMIT',{runId});
 if(prior.length&&now()-prior.at(-1).at<120000)return finish('cooldown','RETRY_BACKOFF',{runId});
 // An authenticated No1 session must exist before spending a resume attempt.
 try{
  const bridge=await client.status();
  if(!bridge.browserConnected||!bridge.connectorVersion||bridge.connectorVersion!==bridge.requiredConnectorVersion)return finish('waiting','CONNECTOR_NOT_READY');
  await client.request('settings:get',{});
 }catch{return finish('waiting','NO1_SESSION_NOT_READY');}
 // Persist budget before launch, including if the supervisor crashes mid-launch.
 const attempt={runId,at:now(),errors:failed.map(r=>({productId:r.productId,error:r.error}))};
 attempts.push(attempt);finish('restarting','SAVED_BATCH_RETRY',{runId});
 try{const result=await resume(root,{workId,resume:true});attempt.launched=result.launched===true;attempt.workerPid=result.pid||null;
  return finish(result.launched?'restarted':'watching',result.launched?'WORKER_RESUMED':'WORKER_REUSED',{runId});
 }catch(e){attempt.error=String(e.message).slice(0,120);return finish('blocked','RESUME_FAILED',{runId});}
}

export async function runExplorationWatchdog(options){
 const dir=monitorDirectory(options.root,options.workId);fs.mkdirSync(dir,{recursive:true});
 const lock=path.join(dir,'exploration-watchdog.lock');
 if(fs.existsSync(lock)){if(isAlive(Number(fs.readFileSync(lock,'utf8'))))throw Error('WATCHDOG_ALREADY_RUNNING');fs.unlinkSync(lock);}
 fs.writeFileSync(lock,String(process.pid),{flag:'wx'});
 try{while(!fs.existsSync(path.join(dir,'EXPLORATION_WATCHDOG_STOP'))){
  try{const result=await pollExplorationWatchdog(options);if(result.terminal)return result;}
  catch{write(path.join(dir,'exploration-watchdog-error.json'),{at:new Date().toISOString(),error:'WATCHDOG_POLL_FAILED'});}
  await new Promise(r=>setTimeout(r,10000));
 }}finally{if(fs.existsSync(lock)&&fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}
}
export async function attachExplorationWatchdog({root,workId}){
 const dir=monitorDirectory(root,workId);fs.mkdirSync(dir,{recursive:true});
 const lock=path.join(dir,'exploration-watchdog.lock'),pid=fs.existsSync(lock)?Number(fs.readFileSync(lock,'utf8')):null;
 if(isAlive(pid))return {launched:false,pid};
 const fd=fs.openSync(path.join(dir,'exploration-watchdog.log'),'a');let child;
 try{child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--root='+path.resolve(root),'--work='+workId],{windowsHide:true,detached:true,stdio:['ignore',fd,fd]});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}finally{fs.closeSync(fd);}
 child.unref();return {launched:true,pid:child.pid};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const arg=k=>process.argv.find(v=>v.startsWith('--'+k+'='))?.slice(k.length+3);
 if(!arg('root')||!arg('work'))throw Error('ROOT_AND_WORK_REQUIRED');
 const options={root:path.resolve(arg('root')),workId:arg('work')};
 if(process.argv.includes('--attach'))console.log(JSON.stringify(await attachExplorationWatchdog(options)));
 else await runExplorationWatchdog(options);
}
