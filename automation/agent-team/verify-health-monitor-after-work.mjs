import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {writeJsonAtomic as write} from './atomic-json.mjs';
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const alive=pid=>{if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch{return false;}};
export function verificationGate(root,workId,isAlive=alive){
 if(!/^work-[a-f0-9-]{36}$/.test(workId||''))throw Error('INVALID_WORK_ID');
 const work=read(path.join(root,'work-orders',workId+'.json')),dir=path.join(root,'explorations',workId),state=read(path.join(dir,'state.json'));
 if(!work||!state)return {ready:false,status:'waiting_for_state'};
 if(work.status==='stopped'||state.status==='stopped')return {ready:false,status:'cancelled'};
 if(state.status!=='complete')return {ready:false,status:state.status==='needs_attention'?'waiting_for_recovery':'waiting_for_completion'};
 const orders=path.join(root,'work-orders');
 for(const name of fs.readdirSync(orders).filter(n=>/^work-[a-f0-9-]{36}\.json$/.test(n))){
  const w=read(path.join(orders,name));if(!w||w.id+'.json'!==name)continue;
  const folder=path.join(root,'explorations',w.id),otherState=read(path.join(folder,'state.json'));
  if(w.id!==workId&&['complete','stopped','source_exhausted'].includes(otherState?.status))continue;
  let continuousPid;try{continuousPid=Number(fs.readFileSync(path.join(folder,'continuous.lock'),'utf8'));}catch{}
  if(isAlive(read(path.join(folder,'process.json'))?.pid)||isAlive(continuousPid))return {ready:false,status:'waiting_for_workers'};
  for(const e of w.entries||[])if(/^batch-[a-f0-9-]{36}$/.test(e.runId)&&!['complete','stopped','needs_attention'].includes(read(path.join(root,e.runId,'batch-state.json'))?.status)&&isAlive(read(path.join(root,e.runId,'process.json'))?.pid))return {ready:false,status:'waiting_for_workers'};
 }
 return {ready:true,status:'ready'};
}
async function tests(repo,log){
 const files=['automation/agent-team/health-monitor.test.mjs','automation/agent-team/verify-health-monitor-after-work.test.mjs','automation/agent-team/heartbeat-routing.test.mjs','automation/agent-team/live-dashboard/server.test.mjs'];
 const fd=fs.openSync(log,'a');
 try{return await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--test',...files],{cwd:repo,windowsHide:true,stdio:['ignore',fd,fd]});p.once('error',reject);p.once('exit',code=>resolve(code===0));});}finally{fs.closeSync(fd);}
}
export async function verifyAfterWork({root,workId,repo=fileURLToPath(new URL('../../',import.meta.url)),sleep=ms=>new Promise(r=>setTimeout(r,ms)),gate=verificationGate,runTests=tests,runSmoke}={}){
 if(!/^work-[a-f0-9-]{36}$/.test(workId||''))throw Error('INVALID_WORK_ID');
 const dir=path.join(root,'explorations',workId),file=path.join(dir,'health-monitor-validation.json'),lock=path.join(dir,'health-monitor-validation.lock');fs.mkdirSync(dir,{recursive:true});
 if(fs.existsSync(lock)){const pid=Number(fs.readFileSync(lock,'utf8'));if(alive(pid))return {status:'already_waiting',pid};fs.unlinkSync(lock);}
 fs.writeFileSync(lock,String(process.pid),{flag:'wx'});
 const save=value=>{const report={at:new Date().toISOString(),workId,pid:process.pid,monitorActivated:false,...value};write(file,report);return report;};
 try{
  // No monitor import, test runner, Codex process, or product query until the
  // existing work is complete and all saved product workers have exited.
  for(;;){const g=gate(root,workId);if(g.status==='cancelled')return save({...g,testsStarted:false});if(g.ready)break;save({...g,testsStarted:false});await sleep(20000);}
  save({status:'testing',testsStarted:true});
  if(!await runTests(repo,path.join(dir,'health-monitor-tests.log')))return save({status:'failed',testsStarted:true,unitTestsPassed:false});
  // Re-check before the single real-model smoke call in case another work began.
  while(!gate(root,workId).ready){const g=gate(root,workId);if(g.status==='cancelled')return save({status:'cancelled',testsStarted:true,unitTestsPassed:true});save({status:'waiting_for_smoke',testsStarted:true,unitTestsPassed:true});await sleep(20000);}
  const diagnosticDir=fs.mkdtempSync(path.join(os.tmpdir(),'cream-health-ai-smoke-'));
  const smoke=runSmoke||(async args=>{const {diagnoseHealthIncident}=await import('./health-monitor-ai.mjs');return diagnoseHealthIncident(args);});
  const result=await smoke({dir:diagnosticDir,snapshot:{workId,stage:'needs_attention',workerAlive:false,error:'NO1_INVALID_RESPONSE',checked:1,sourceId:'test-only',bridge:{connected:true,versionMatches:true},mode:'synthetic-verification'},finding:{code:400,status:'needs_attention',reason:'NO1_INVALID_RESPONSE',severity:'error',synthetic:true}});
  if(result.actionExecuted!==false||!result.threadId)throw Error('MONITOR_SMOKE_NOT_CONFIRMED');
  return save({status:'passed',testsStarted:true,unitTestsPassed:true,liveModelSmokePassed:true,smokeUsesSyntheticIncident:true,diagnosticDir,model:result.model,threadId:result.threadId});
 }catch{return save({status:'failed',error:'MONITOR_VALIDATION_FAILED'});}
 finally{if(fs.existsSync(lock)&&fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const arg=n=>process.argv.find(v=>v.startsWith(`--${n}=`))?.slice(n.length+3);
 if(!arg('root')||!arg('work'))throw Error('ROOT_AND_WORK_REQUIRED');
 const result=await verifyAfterWork({root:path.resolve(arg('root')),workId:arg('work')});console.log(JSON.stringify(result));if(result.status==='failed')process.exitCode=1;
}
