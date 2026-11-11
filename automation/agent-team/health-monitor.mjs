import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {BackgroundClient} from '../no1-background/client.mjs';
import {classifyError} from './error-catalog.mjs';
import {writeJsonAtomic as write} from './atomic-json.mjs';
import {diagnoseHealthIncident} from './health-monitor-ai.mjs';

const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
export const isAlive=pid=>{if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch{return false;}};
export function monitorDirectory(root,workId){
 if(!/^work-[a-f0-9-]{36}$/.test(workId||''))throw Error('INVALID_WORK_ID');
 return path.join(path.resolve(root),'explorations',workId);
}
const stamp=file=>{try{return fs.statSync(file).mtimeMs;}catch{return 0;}};
const timestamp=value=>Number.isFinite(Date.parse(value))?Date.parse(value):0;
const code=value=>/^[A-Z][A-Z0-9_]{2,100}$/.test(value||'')?value:'UNKNOWN_ERROR';
const stage=value=>['starting','discovering','running_batch','recovering','waiting_for_retry','needs_attention','complete','source_exhausted','stopped'].includes(value)?value:'unknown';
const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;

// Only saved state, file timestamps and local /status are read. Never enqueue a
// No1 product request, acquire the discovery lock, or modify its source cursor.
export async function healthSnapshot({root,workId,client=new BackgroundClient(),now=Date.now,alive=isAlive}){
 const dir=monitorDirectory(root,workId),work=read(path.join(root,'work-orders',workId+'.json'));
 if(!work||work.id!==workId)throw Error('WORK_NOT_FOUND');
 const state=read(path.join(dir,'state.json'))||{},proc=read(path.join(dir,'process.json'));
 let continuousPid;try{continuousPid=Number(fs.readFileSync(path.join(dir,'continuous.lock'),'utf8'));}catch{}
 let activity=Math.max(timestamp(state.updatedAt),timestamp(state.startedAt));
 const batchId=/^batch-[a-f0-9-]{36}$/.test(state.currentRunId||'')?state.currentRunId:null;
 if(state.status==='running_batch'&&batchId){
  const batch=path.join(root,batchId),judgments=path.join(batch,'judgments');
  activity=Math.max(activity,stamp(path.join(batch,'batch-state.json')));
  if(fs.existsSync(judgments))for(const id of fs.readdirSync(judgments).filter(id=>/^(?:\d{1,12}|poizon-\d{1,18})$/.test(id))){
   activity=Math.max(activity,stamp(path.join(judgments,id,'team-state.json')));
  }
 }
 const sourceId=/^\d{1,12}$/.test(String(state.currentSource?.productId||''))?String(state.currentSource.productId):null;
 if(sourceId&&['discovering','recovering'].includes(state.status)){
  const evidence=path.join(root,'musinsa-discovery','evidence',sourceId);
  if(fs.existsSync(evidence))for(const name of fs.readdirSync(evidence).filter(n=>/^\d+\.json$/.test(n)))activity=Math.max(activity,stamp(path.join(evidence,name)));
 }
 let bridge=null,bridgeError=null;
 try{const s=await client.status();bridge={connected:s.browserConnected===true,versionMatches:!!s.connectorVersion&&s.connectorVersion===s.requiredConnectorVersion,pending:s.requestPending===true,recent:(s.recentTimings||[]).slice(-8).map(t=>({cmd:/^[a-zA-Z:-]{1,80}$/.test(t.cmd||'')?t.cmd:'unknown',at:new Date(timestamp(t.at)||0).toISOString(),ok:t.ok===true,totalMs:Number.isFinite(t.totalMs)?t.totalMs:null}))};}catch{bridgeError='NO1_BRIDGE_UNAVAILABLE';}
 return {workId,observedAt:new Date(now()).toISOString(),workStopped:work.status==='stopped'||fs.existsSync(path.join(dir,'STOP')),stage:stage(state.status),workerAlive:alive(proc?.pid)||alive(continuousPid),checked:count(state.checkedSources),qualified:count(state.profitableProductsFound),target:count(work.targetSources||work.targetProfitableProducts||work.targetProducts),sourceId,batchId,lastActivityAt:activity?new Date(activity).toISOString():null,error:state.error?code(state.error):null,recoveryError:state.recovery?.error?code(state.recovery.error):null,waitReason:state.waitReason==='new_ranking_cycle'?state.waitReason:state.waitReason?code(state.waitReason):null,retryAt:timestamp(state.retryAt)?new Date(timestamp(state.retryAt)).toISOString():null,bridge,bridgeError};
}

export function assessHealth(snapshot,now=Date.now()){
 const s=snapshot;
 // A normal completion must not be mistaken for a dead worker. Preserve a
// specific recorded error instead of reducing it to generic WORKER_NOT_RUNNING.
 if(s.workStopped||s.stage==='stopped')return {status:'stopped',reason:'USER_STOPPED',severity:'none',terminal:true,code:200};
 if(['complete','source_exhausted'].includes(s.stage))return {status:s.stage,reason:s.stage,severity:'none',terminal:true,code:200};
 let status='healthy',reason='RUNNING',severity='none';
 if(s.stage==='needs_attention'||s.stage==='unknown'){status='needs_attention';reason=s.error||'UNKNOWN_ERROR';severity='error';}
 else if(!s.workerAlive){status='worker_stopped';reason='WORKER_NOT_RUNNING';severity='error';}
 else if(s.bridgeError){status='bridge_unavailable';reason=s.bridgeError;severity='error';}
 else if(!s.bridge?.connected){status='connector_disconnected';reason='NO1_BRIDGE_DISCONNECTED';severity='error';}
 else if(!s.bridge.versionMatches){status='connector_update_required';reason='NO1_CONNECTOR_UPDATE_REQUIRED';severity='error';}
 else if(s.stage==='waiting_for_retry'){status='waiting';reason=s.waitReason||'RETRY_SCHEDULED';severity=reason==='new_ranking_cycle'?'none':'warning';}
 else if(now-(timestamp(s.lastActivityAt)||timestamp(s.observedAt))>(s.stage==='running_batch'?600000:300000)){status='stalled';reason='WORKER_PROGRESS_STALE';severity='error';}
 else if(s.stage==='recovering'){status='recovering';reason=s.recoveryError||'recovering';severity='warning';}
 return {status,reason,severity,terminal:false,...classifyError({status,reason})};
}

const signature=(s,f)=>crypto.createHash('sha256').update(JSON.stringify([f.reason,s.sourceId,s.batchId])).digest('hex');
export function planDiagnosis(previous,snapshot,finding,now=Date.now()){
 const id=signature(snapshot,finding),same=previous?.incident?.id===id;
 const incident=finding.severity==='none'?null:{id,firstSeenAt:same?previous.incident.firstSeenAt:now,observations:same?previous.incident.observations+1:1};
 const attempts=(previous?.diagnosisAttempts||[]).filter(x=>now-x.at<86400000).slice(-64);
 // Sustained anomalies only; one diagnosis per incident, at most four/hour,
 // fifteen minutes between calls. Restarting the monitor preserves this budget.
 const ready=incident&&!finding.terminal&&incident.observations>=2&&now-incident.firstSeenAt>=(finding.severity==='error'?10000:60000)&&!attempts.some(x=>x.id===id)&&attempts.filter(x=>now-x.at<3600000).length<4&&(!attempts.length||now-attempts.at(-1).at>=900000);
 return {incident,diagnosisAttempts:attempts,shouldDiagnose:!!ready};
}

export async function pollHealthMonitor({root,workId,client,now=Date.now,alive=isAlive,diagnose=diagnoseHealthIncident,busy=false,onDiagnostic=()=>{}}){
 const dir=monitorDirectory(root,workId),file=path.join(dir,'health-monitor.json');
 const snapshot=await healthSnapshot({root,workId,client,now,alive}),previous=read(file),finding=assessHealth(snapshot,now()),plan=planDiagnosis(previous,snapshot,finding,now());
 const priorAI=previous?.ai?.status==='running'&&!busy?{...previous.ai,status:'interrupted'}:previous?.ai;
 const report={version:1,at:new Date(now()).toISOString(),pid:process.pid,workId,...finding,checked:snapshot.checked,qualified:snapshot.qualified,lastActivityAt:snapshot.lastActivityAt,incident:plan.incident,diagnosisAttempts:plan.diagnosisAttempts,ai:priorAI||{status:'idle'},mode:'read-only',pollIntervalMs:10000};
 let pending=null;
 if(plan.shouldDiagnose&&!busy){
  const incidentId=plan.incident.id;
  report.diagnosisAttempts.push({id:incidentId,at:now()});report.ai={status:'running',incidentId,startedAt:new Date(now()).toISOString()};
  write(file,report);
  pending=Promise.resolve().then(()=>diagnose({dir:path.join(dir,'health-diagnostics',incidentId),snapshot,finding})).then(result=>({status:'complete',incidentId,finishedAt:new Date(now()).toISOString(),...result}),()=>({status:'failed',incidentId,finishedAt:new Date(now()).toISOString(),error:'HEALTH_DIAGNOSIS_FAILED'})).then(result=>{
   const latest=read(file);if(latest?.ai?.incidentId===incidentId){latest.ai=result;write(file,latest);}try{onDiagnostic(result);}catch{}return result;
  });
 }else write(file,report);
 return {report,pending};
}

export async function runHealthMonitor({root,workId,intervalMs=10000,sleep=ms=>new Promise(r=>setTimeout(r,ms)),...options}){
 const dir=monitorDirectory(root,workId),lock=path.join(dir,'health-monitor.lock');
 if(!read(path.join(root,'work-orders',workId+'.json')))throw Error('WORK_NOT_FOUND');
 fs.mkdirSync(dir,{recursive:true});
 if(fs.existsSync(lock)){const pid=Number(fs.readFileSync(lock,'utf8'));if(isAlive(pid))return {status:'already_running',pid};fs.unlinkSync(lock);}
 fs.writeFileSync(lock,String(process.pid),{flag:'wx'});let pending=null;
 try{for(;;){
  if(fs.existsSync(path.join(dir,'HEALTH_MONITOR_STOP')))return {status:'monitor_stopped'};
  let result;
  try{result=await pollHealthMonitor({root,workId,...options,busy:!!pending});}
  catch{write(path.join(dir,'health-monitor-error.json'),{at:new Date().toISOString(),error:'MONITOR_POLL_FAILED'});await sleep(intervalMs);continue;}
  if(result.pending){pending=result.pending.catch(()=>null);void pending.then(()=>{pending=null;});}
  if(result.report.terminal)return result.report;
  await sleep(intervalMs);
 }}finally{await pending;const file=path.join(dir,'health-monitor.json'),report=read(file);if(report?.pid===process.pid)write(file,{...report,endedAt:new Date().toISOString()});if(fs.existsSync(lock)&&fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}
}

export async function startHealthMonitor({root,workId}){
 const dir=monitorDirectory(root,workId),work=read(path.join(root,'work-orders',workId+'.json')),state=read(path.join(dir,'state.json'));
 if(!work)throw Error('WORK_NOT_FOUND');
 if(work.status==='stopped'||['complete','stopped','source_exhausted'].includes(state?.status))return {launched:false,status:'terminal'};
 if(fs.existsSync(path.join(dir,'HEALTH_MONITOR_STOP')))return {launched:false,status:'monitor_stopped'};
 const lock=path.join(dir,'health-monitor.lock');
 if(fs.existsSync(lock)){const pid=Number(fs.readFileSync(lock,'utf8'));if(isAlive(pid))return {launched:false,status:'already_running',pid};}
 fs.mkdirSync(dir,{recursive:true});
 const fd=fs.openSync(path.join(dir,'health-monitor.log'),'a');let child;
 try{child=spawn(process.execPath,[fileURLToPath(import.meta.url),`--root=${path.resolve(root)}`,`--work=${workId}`],{cwd:dir,windowsHide:true,detached:true,stdio:['ignore',fd,fd]});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}finally{fs.closeSync(fd);}
 child.unref();return {launched:true,pid:child.pid};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const arg=n=>process.argv.find(v=>v.startsWith(`--${n}=`))?.slice(n.length+3);
 if(!arg('root')||!arg('work'))throw Error('ROOT_AND_WORK_REQUIRED');
 const options={root:path.resolve(arg('root')),workId:arg('work')};
 if(process.argv.includes('--attach'))console.log(JSON.stringify(await startHealthMonitor(options)));
 else await runHealthMonitor(options);
}
