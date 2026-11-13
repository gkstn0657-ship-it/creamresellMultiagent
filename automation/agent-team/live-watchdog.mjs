import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
import {BackgroundClient} from '../no1-background/client.mjs';
import {control} from './control-mcp.mjs';import {writeJsonAtomic as write} from './atomic-json.mjs';
import {sendHeartbeat} from './heartbeat-routing.mjs';
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
const live=pid=>{try{if(!Number.isSafeInteger(pid)||pid<1)return false;process.kill(pid,0);return true;}catch{return false;}};
const here=path.dirname(fileURLToPath(import.meta.url));
export function classifyWatchdog({work,state,workerAlive,bridge,bridgeError,now=Date.now()}){
 if(work?.status==='stopped')return {status:'stopped',reason:'USER_STOPPED',severity:'none'};
 // A finite scope that reached its target or exhausted the ranking ended normally.
 if(!workerAlive&&work?.continuous!==true&&['complete','source_exhausted'].includes(state?.status))return {status:'finished',reason:state.status,severity:'none'};
 if(!workerAlive)return {status:'worker_stopped',reason:'WORKER_NOT_RUNNING',severity:'error'};
 if(bridgeError||!bridge)return {status:'bridge_unavailable',reason:'NO1_BRIDGE_UNAVAILABLE',severity:'error'};
 if(bridge.browserConnected!==true)return {status:'connector_disconnected',reason:'NO1_BRIDGE_DISCONNECTED',severity:'error'};
 if(bridge.connectorVersion!==bridge.requiredConnectorVersion)return {status:'connector_update_required',reason:'NO1_CONNECTOR_UPDATE_REQUIRED',severity:'error'};
 if(state?.status==='waiting_for_retry')return {status:'waiting',reason:state.waitReason||'RETRY_SCHEDULED',severity:state.waitReason==='new_ranking_cycle'?'none':'warning'};
 if(state?.status==='recovering'&&state.recovery?.error)return {status:'recovering',reason:state.recovery.error,severity:'warning'};
 if(['discovering','recovering','running_batch'].includes(state?.status)&&state.updatedAt&&now-Date.parse(state.updatedAt)>300000)return {status:'stalled',reason:'WORKER_PROGRESS_STALE',severity:'error'};
 if(state?.status==='needs_attention')return {status:'needs_attention',reason:state.error||'WORK_NEEDS_ATTENTION',severity:'error'};
 return {status:'healthy',reason:state?.status||'RUNNING',severity:'none'};
}
export function classifyRemoteBridge(remote,now=Date.now()){
 if(!remote)return null;
 if(!remote.at||now-Date.parse(remote.at)>30000)return {status:'remote_stalled',reason:'REMOTE_BRIDGE_SIGNAL_STALE',severity:'warning'};
 if(remote.connected===true)return {status:'healthy',reason:'RUNNING',severity:'none'};
 return {status:'remote_disconnected',reason:String(remote.code||'REMOTE_BRIDGE_NOT_RUNNING'),severity:'warning'};
}
export async function pollWatchdog({root,workId,client=new BackgroundClient(),restart=async()=>control('cream_musinsa_work_continue',{workId},{root}),restartBridge=restartLocalBridge,notify=nativeNotify,now=Date.now,remoteBridgeStatus=undefined}={}){
 const dir=path.join(root,'explorations',workId),file=path.join(dir,'monitor.json');fs.mkdirSync(dir,{recursive:true});
 const previous=read(file),work=read(path.join(root,'work-orders',workId+'.json')),state=read(path.join(dir,'state.json'))||{};
 // Continuous work holds continuous.lock; a finite inspection runner holds only worker.lock.
 const lockPid=name=>Number((()=>{try{return fs.readFileSync(path.join(dir,name),'utf8');}catch{return 0;}})());
 const workerAlive=live(lockPid('continuous.lock'))||live(lockPid('worker.lock'));let bridge=null,bridgeError=null;
 try{bridge=await client.status();}catch(e){bridgeError=e.message;}
 const finding=classifyWatchdog({work,state,workerAlive,bridge,bridgeError,now:now()});
 const changed=previous?.status!==finding.status||previous?.reason!==finding.reason;
 const monitor={version:1,workId,at:new Date(now()).toISOString(),...finding,workerAlive,connectorConnected:bridge?.browserConnected===true,connectorVersion:bridge?.connectorVersion||null,checked:state.checkedSources||0,qualified:state.profitableProductsFound||0,workStatus:work?.status||null,sourceStatus:state.status||null,retryAt:state.retryAt||null,changedAt:changed?new Date(now()).toISOString():previous?.changedAt||null,lastHealthyAt:finding.status==='healthy'?new Date(now()).toISOString():previous?.lastHealthyAt||null,lastRestartAt:previous?.lastRestartAt||null,lastBridgeRestartAt:previous?.lastBridgeRestartAt||null};
 const handlers={
  keep_running:async()=>{if(previous?.connectorConnected===false&&monitor.connectorConnected&&state.status==='waiting_for_retry'&&['NO1_BRIDGE_DISCONNECTED','NO1_WEB_TAB_REQUIRED'].includes(state.waitReason)){fs.writeFileSync(path.join(dir,'WAKE'),'connector recovered');monitor.recovery='retry_wake_requested';}return {status:'observed'};},
  restart_worker:async()=>{if(work?.status!=='open'||work.continuous!==true||fs.existsSync(path.join(dir,'STOP')))return {status:'not_authorized'};if(previous?.lastRestartAt&&now()-Date.parse(previous.lastRestartAt)<120000)return {status:'cooldown'};await restart();monitor.lastRestartAt=new Date(now()).toISOString();monitor.recovery='worker_restart_requested';return {status:'requested'};},
  restart_bridge:async()=>{if(previous?.status!=='bridge_unavailable'||previous.lastBridgeRestartAt&&now()-Date.parse(previous.lastBridgeRestartAt)<120000)return {status:'cooldown'};await restartBridge();monitor.lastBridgeRestartAt=new Date(now()).toISOString();monitor.recovery='bridge_restart_requested';return {status:'requested'};},
  wait_for_authenticated_tab:async()=>{if(monitor.connectorConnected)try{await client.request('musinsa:ranking:settings',{});fs.writeFileSync(path.join(dir,'WAKE'),'authenticated tab recovered');monitor.recovery='retry_wake_requested';return {status:'retry_woken'};}catch{}return {status:'requires_browser_tab'};},
  wait_for_connector:async()=>{if(monitor.connectorConnected){fs.writeFileSync(path.join(dir,'WAKE'),'connector recovered');monitor.recovery='retry_wake_requested';return {status:'retry_woken'};}return {status:'requires_connector_connection'};},
  request_login:async()=>({status:'requires_login'}),
  request_connector_reload:async()=>({status:'requires_connector_reload'}),
  honor_backoff:async()=>({status:'backoff_preserved'}),
  retry_saved_request:async()=>({status:'runner_retry_preserved'}),
  record_exclusion:async()=>({status:'product_exclusion_recorded'}),
  request_remote_pairing:async()=>({status:'requires_remote_bridge_credentials'}),
  record_remote_bridge_failure:async()=>({status:'remote_bridge_retry_preserved'}),
  inspect_stall:async()=>({status:'diagnostic_recorded'}),
  record_unknown_error:async(signal)=>{const diagnostic=path.join(dir,'last-unknown-error.json');write(diagnostic,{at:signal.at,code:signal.code,reason:signal.reason,sourceStatus:state.status,checked:monitor.checked});return {status:'diagnostic_recorded'};},
 };
 try{const routed=await sendHeartbeat({root,workId,finding:monitor,handlers});monitor.code=routed.ack.code;monitor.handler=routed.decision.handler;monitor.action=routed.decision.action;monitor.actionResult=routed.decision.result?.status||null;}
 catch(e){monitor.routingError=String(e.message).slice(0,120);}
 const remoteSidecar=Number((()=>{try{return fs.readFileSync(path.join(dir,'remote-watchdog.lock'),'utf8');}catch{return 0;}})());
 if(live(remoteSidecar))monitor.remoteBridge=read(path.join(dir,'remote-monitor.json'));
 else{
 const remote=remoteBridgeStatus===undefined?read(path.join(process.env.LOCALAPPDATA||'', 'CreamDotBridge','status.json')):remoteBridgeStatus;
 const remoteFinding=classifyRemoteBridge(remote,now());
 if(remoteFinding){
  const previousRemote=previous?.remoteBridge;
  try{const routed=await sendHeartbeat({root,workId,finding:remoteFinding,handlers,channel:'remote'});
   monitor.remoteBridge={...remoteFinding,code:routed.ack.code,handler:routed.decision.handler,action:routed.decision.action,actionResult:routed.decision.result?.status||null,at:remote?.at||null};
   if(previousRemote?.reason!==remoteFinding.reason&&remoteFinding.severity!=='none')fs.appendFileSync(path.join(dir,'continuous.log'),JSON.stringify({type:'work_needs_attention',error:remoteFinding.reason,monitorCode:routed.ack.code,at:monitor.at})+'\n');
  }catch(e){monitor.remoteRoutingError=String(e.message).slice(0,120);}
 }
 }
 write(file,monitor);
 if(changed&&finding.severity!=='none')fs.appendFileSync(path.join(dir,'continuous.log'),JSON.stringify({type:'work_needs_attention',error:monitor.reason,monitorCode:monitor.code,at:monitor.at})+'\n');
 if(changed&&finding.severity!=='none')try{await notify(monitor);monitor.notifiedAt=new Date(now()).toISOString();write(file,monitor);}catch(e){monitor.notificationError=String(e.message).slice(0,100);write(file,monitor);}
 return monitor;
}
function nativeNotify(monitor){
 const messages={connector_disconnected:'No1 Background Connector 연결이 끊겨 상품 탐색이 멈췄습니다.',bridge_unavailable:'No1 로컬 브리지에 연결할 수 없습니다.',worker_stopped:'수익 상품 탐색 실행기가 종료돼 다시 시작합니다.',stalled:'수익 상품 탐색 기록이 5분 넘게 갱신되지 않았습니다.',needs_attention:'수익 상품 탐색에서 확인이 필요한 오류가 발생했습니다.',waiting:'상품 탐색이 오류 복구를 기다리고 있습니다.'};
 const script=path.join(here,'live-watchdog-notify.ps1');
 return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Message',messages[monitor.status]||'상품 탐색 상태를 확인해 주세요.'],{windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('DESKTOP_NOTIFICATION_FAILED')));});
}
function restartLocalBridge(){
 const script=fileURLToPath(new URL('../no1-background/run-bridge.mjs',import.meta.url));
 const child=spawn(process.execPath,[script],{cwd:path.dirname(script),windowsHide:true,detached:true,stdio:'ignore'});child.unref();
}
export async function runWatchdog({root,workId,intervalMs=10000,client=new BackgroundClient(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),notify=nativeNotify,onEvent=()=>{}}={}){
 const dir=path.join(root,'explorations',workId);fs.mkdirSync(dir,{recursive:true});const lock=path.join(dir,'watchdog.lock');
 if(fs.existsSync(lock)){const pid=Number(fs.readFileSync(lock,'utf8'));if(live(pid))throw Error('WATCHDOG_ALREADY_RUNNING');fs.unlinkSync(lock);}
 fs.writeFileSync(lock,String(process.pid),{flag:'wx'});
 try{for(;;){const result=await pollWatchdog({root,workId,client,notify});onEvent(result);if(result.status==='stopped')return result;await sleep(intervalMs);}}
 finally{if(fs.existsSync(lock)&&fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const arg=n=>process.argv.find(v=>v.startsWith(`--${n}=`))?.slice(n.length+3);if(!arg('root')||!arg('work'))throw Error('ROOT_AND_WORK_REQUIRED');
 await runWatchdog({root:path.resolve(arg('root')),workId:arg('work'),onEvent:e=>console.log(JSON.stringify({at:e.at,status:e.status,reason:e.reason,recovery:e.recovery}))});
}
