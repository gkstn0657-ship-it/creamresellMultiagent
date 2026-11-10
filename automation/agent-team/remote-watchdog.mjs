import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {classifyRemoteBridge} from './live-watchdog.mjs';
import {sendHeartbeat} from './heartbeat-routing.mjs';
import {writeJsonAtomic as write} from './atomic-json.mjs';
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
const live=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
export async function pollRemoteWatchdog({root,workId,remoteStatus=undefined,now=Date.now}={}){
 const dir=path.join(root,'explorations',workId);fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,'remote-monitor.json'),previous=read(file);
 const remote=remoteStatus===undefined?read(path.join(process.env.LOCALAPPDATA||'','CreamDotBridge','status.json')):remoteStatus;
 const finding=classifyRemoteBridge(remote,now())||{status:'remote_disconnected',reason:'REMOTE_BRIDGE_NOT_RUNNING',severity:'warning'};
 const handlers={keep_running:async()=>({status:'observed'}),request_remote_pairing:async()=>({status:'requires_remote_bridge_credentials'}),record_remote_bridge_failure:async()=>({status:'remote_bridge_retry_preserved'}),retry_saved_request:async()=>({status:'remote_bridge_retry_preserved'}),inspect_stall:async()=>({status:'diagnostic_recorded'}),record_unknown_error:async(signal)=>{write(path.join(dir,'last-remote-diagnostic.json'),{at:signal.at,code:signal.code,reason:signal.reason});return {status:'diagnostic_recorded'};}};
 const routed=await sendHeartbeat({root,workId,finding,handlers,channel:'remote'});
 const monitor={at:new Date(now()).toISOString(),...finding,code:routed.ack.code,handler:routed.decision.handler,action:routed.decision.action,actionResult:routed.decision.result?.status||null};write(file,monitor);
 if(previous?.reason!==monitor.reason&&finding.severity!=='none')fs.appendFileSync(path.join(dir,'continuous.log'),JSON.stringify({type:'work_needs_attention',error:`${monitor.code} ${monitor.reason}`,monitorCode:monitor.code,at:monitor.at})+'\n');
 return monitor;
}
export async function runRemoteWatchdog({root,workId,intervalMs=10000,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const dir=path.join(root,'explorations',workId);fs.mkdirSync(dir,{recursive:true});const lock=path.join(dir,'remote-watchdog.lock');
 if(fs.existsSync(lock)){const pid=Number(fs.readFileSync(lock,'utf8'));if(Number.isSafeInteger(pid)&&pid>0&&live(pid))return {status:'already_running',pid};fs.unlinkSync(lock);}
 fs.writeFileSync(lock,String(process.pid),{flag:'wx'});
 try{for(;;){const work=read(path.join(root,'work-orders',workId+'.json'));if(!work||work.status==='stopped')return {status:'stopped'};
  try{await pollRemoteWatchdog({root,workId});}catch(e){write(path.join(dir,'remote-watchdog-failure.json'),{at:new Date().toISOString(),code:501,reason:String(e.message).slice(0,120)});}
  await sleep(intervalMs);}}
 finally{if(fs.existsSync(lock)&&fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const arg=n=>process.argv.find(v=>v.startsWith(`--${n}=`))?.slice(n.length+3);if(!arg('root')||!arg('work'))throw Error('ROOT_AND_WORK_REQUIRED');
 await runRemoteWatchdog({root:path.resolve(arg('root')),workId:arg('work')});
}
