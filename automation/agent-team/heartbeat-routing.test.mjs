import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {heartbeatCode,routeHeartbeat,sendHeartbeat,coordinatorAccept,commanderHandle} from './heartbeat-routing.mjs';
import {ERROR_CATALOG,classifyError} from './error-catalog.mjs';
import {classifyWatchdog,classifyRemoteBridge,pollWatchdog} from './live-watchdog.mjs';
import {pollRemoteWatchdog} from './remote-watchdog.mjs';
import {startWork} from './work-orders.mjs';import {control} from './control-mcp.mjs';
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-heartbeat-')),workId='work-11111111-2222-3333-4444-555555555555',dir=path.join(root,'explorations',workId);fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(root,'work-orders'),{recursive:true});fs.writeFileSync(path.join(root,'work-orders',workId+'.json'),JSON.stringify({id:workId,status:'open',continuous:true}));fs.writeFileSync(path.join(dir,'continuous.lock'),String(process.pid));fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({status:'waiting_for_retry',waitReason:'NO1_BRIDGE_DISCONNECTED',checkedSources:465,profitableProductsFound:1}));return {root,workId,dir};};
test('observer codes identify healthy, auth, tab, connector, timeout, worker and unknown errors',()=>{
 for(const [finding,code,handler] of [[{status:'healthy',reason:'RUNNING'},200,'commander'],[{status:'waiting',reason:'KREAM_LOGIN_REQUIRED'},401,'auth_agent'],[{status:'waiting',reason:'NO1_WEB_TAB_REQUIRED'},404,'browser_connection_agent'],[{status:'connector_disconnected',reason:'NO1_BRIDGE_DISCONNECTED'},503,'connector_agent'],[{status:'stalled',reason:'WORKER_PROGRESS_STALE'},504,'latency_agent'],[{status:'worker_stopped',reason:'WORKER_NOT_RUNNING'},500,'worker_agent'],[{status:'needs_attention',reason:'UNEXPECTED'},501,'diagnostic_agent']]){assert.equal(heartbeatCode(finding),code);assert.equal(routeHeartbeat({code,reason:finding.reason}).handler,handler);}
});
test('catalog covers every No1 public error and historical live source outcome',()=>{
 const protocol=fs.readFileSync(new URL('../no1-background/chrome-extension/protocol.mjs',import.meta.url),'utf8').split('const errorCodes = new Set')[1].split('const keys =')[0];
 const no1Codes=[...protocol.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map(x=>x[1]);
 const historical=['NO1_BRIDGE_TIMEOUT','NO1_WEB_TAB_REQUIRED','NO1_BRIDGE_DISCONNECTED','NO1_INVALID_PAYLOAD','STOCK_CHECK_FAILED','KREAM_SEARCH_FAILED','EXACT_MARKET_MODEL_NOT_FOUND','NO_POSITIVE_MARGIN_IN_BOUND_AVAILABLE_OPTIONS','AVAILABLE_OPTION_NOT_BOUND','UNSUPPORTED_SOURCE_MODEL_FORMAT','MARKET_MODEL_AMBIGUOUS','NO_AVAILABLE_STOCK'];
 for(const reason of [...new Set([...no1Codes,...historical])])assert.ok(ERROR_CATALOG[reason],`missing ${reason}`);
 assert.equal(ERROR_CATALOG.NO_AVAILABLE_STOCK.code,210);
 assert.equal(ERROR_CATALOG.EXACT_MARKET_MODEL_NOT_FOUND.code,211);
 assert.equal(ERROR_CATALOG.KREAM_SEARCH_FAILED.code,502);
});
test('coordinator corrects an incorrect code and commander follows the verified route',async()=>{
 const {dir,workId}=fixture(),box=path.join(dir,'heartbeats');fs.mkdirSync(box,{recursive:true});
 const signal={id:`${workId}:1`,sequence:1,code:200,reason:'MUSINSA_DISCOVERY: KREAM_SEARCH_FAILED',status:'waiting'};
 const ack=coordinatorAccept(signal,box);assert.equal(ack.code,502);assert.equal(ack.corrected,true);
 assert.equal(coordinatorAccept(signal,box).signalId,signal.id);
 assert.throws(()=>coordinatorAccept({...signal,id:'stale',sequence:0},box),/INVALID_HEARTBEAT_SIGNAL/);
 assert.throws(()=>coordinatorAccept({...signal,id:'different'},box),/STALE_HEARTBEAT_SIGNAL/);
 let retried=0;const decision=await commanderHandle(signal,ack,box,{retry_saved_request:async()=>{retried++;return {status:'runner_retry_preserved'};}});
 assert.equal(decision.handler,'upstream_agent');assert.equal(decision.code,502);assert.equal(retried,1);
 assert.equal(classifyError({status:'needs_attention',reason:'NEW_UNSEEN_ERROR'}).code,501);
 assert.equal(classifyError({status:'healthy',reason:'NEW_UNSEEN_ERROR'}).code,501);
});
test('source recovery sends the upstream error to the coordinator without consuming a product',async()=>{
 const {root,workId,dir}=fixture();
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({status:'recovering',recovery:{error:'KREAM_SEARCH_FAILED'},checkedSources:5}));
 const client={status:async()=>({browserConnected:true,connectorVersion:'0.8.0',requiredConnectorVersion:'0.8.0'})};
 const monitor=await pollWatchdog({root,workId,client,notify:()=>{}});
 assert.equal(monitor.code,502);assert.equal(monitor.handler,'upstream_agent');assert.equal(monitor.actionResult,'runner_retry_preserved');
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'heartbeats','coordinator.json'))).code,502);
});
test('live Dot bridge 401 has an independent coordinator signal and does not hide No1 503',async()=>{
 const {root,workId,dir}=fixture();const at=new Date().toISOString();
 const client={status:async()=>({browserConnected:false,connectorVersion:'0.8.0',requiredConnectorVersion:'0.8.0'})};
 const monitor=await pollWatchdog({root,workId,client,remoteBridgeStatus:{connected:false,code:'BRIDGE_HTTP_401',at},notify:()=>{}});
 assert.equal(monitor.code,503);assert.equal(monitor.remoteBridge.code,401);
 assert.equal(monitor.remoteBridge.handler,'remote_bridge_agent');assert.equal(monitor.remoteBridge.actionResult,'requires_remote_bridge_credentials');
 const remote=JSON.parse(fs.readFileSync(path.join(dir,'heartbeats','remote','commander.json')));
 assert.equal(remote.reason,'BRIDGE_HTTP_401');
 assert.equal(classifyRemoteBridge({connected:false,code:'BRIDGE_HTTP_401',at:'2020-01-01T00:00:00Z'}).reason,'REMOTE_BRIDGE_SIGNAL_STALE');
});
test('remote sidecar records live bridge 401 then a healthy recovery on its own channel',async()=>{
 const {root,workId,dir}=fixture(),at=new Date().toISOString();
 const failed=await pollRemoteWatchdog({root,workId,remoteStatus:{connected:false,code:'BRIDGE_HTTP_401',at}});
 assert.equal(failed.code,401);assert.equal(failed.actionResult,'requires_remote_bridge_credentials');
 const recovered=await pollRemoteWatchdog({root,workId,remoteStatus:{connected:true,at}});
 assert.equal(recovered.code,200);assert.equal(recovered.actionResult,'observed');
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'heartbeats','remote','monitor.json'))).sequence,2);
});
test('monitor sends durable signal through coordinator and commander, healthy signal has no recovery action',async()=>{
 const {root,workId}=fixture();let actions=0;const finding={status:'healthy',reason:'RUNNING',checked:465,qualified:1};
 const first=await sendHeartbeat({root,workId,finding,handlers:{keep_running:async()=>{actions++;return {status:'observed'};}}});assert.equal(first.signal.code,200);assert.equal(first.ack.to,'commander');assert.equal(first.decision.action,'keep_running');
 const next=await sendHeartbeat({root,workId,finding,handlers:{keep_running:async()=>{actions++;return {status:'observed'};}}});assert.equal(next.signal.sequence,2);assert.equal(actions,2);
 const base=path.join(root,'explorations',workId,'heartbeats');assert.equal(JSON.parse(fs.readFileSync(path.join(base,'commander.json'),'utf8')).signalId,next.signal.id);
});
test('disconnected connector alerts once and restored connector wakes the saved retry',async()=>{
 const {root,workId,dir}=fixture();const notifications=[];let connected=false;
 const client={status:async()=>({browserConnected:connected,connectorVersion:'0.8.0',requiredConnectorVersion:'0.8.0'})};
 const first=await pollWatchdog({root,workId,client,notify:e=>notifications.push(e.code)});assert.equal(first.code,503);assert.equal(first.handler,'connector_agent');assert.equal(first.actionResult,'requires_connector_connection');
 await pollWatchdog({root,workId,client,notify:e=>notifications.push(e.code)});assert.deepEqual(notifications,[503]);
 connected=true;const recovered=await pollWatchdog({root,workId,client,notify:e=>notifications.push(e.code)});assert.equal(recovered.actionResult,'retry_woken');assert.equal(fs.readFileSync(path.join(dir,'WAKE'),'utf8'),'connector recovered');
});
test('worker agent requests one restart and stop signal never restarts',async()=>{
 const {root,workId,dir}=fixture();fs.unlinkSync(path.join(dir,'continuous.lock'));let starts=0;const client={status:async()=>({browserConnected:true,connectorVersion:'0.8.0',requiredConnectorVersion:'0.8.0'})};
 const first=await pollWatchdog({root,workId,client,restart:async()=>{starts++;},notify:()=>{}});assert.equal(first.code,500);assert.equal(first.handler,'worker_agent');assert.equal(starts,1);
 await pollWatchdog({root,workId,client,restart:async()=>{starts++;},notify:()=>{}});assert.equal(starts,1);
 const workFile=path.join(root,'work-orders',workId+'.json');fs.writeFileSync(workFile,JSON.stringify({id:workId,status:'stopped',continuous:true}));const stopped=await pollWatchdog({root,workId,client,restart:async()=>{starts++;},notify:()=>{}});assert.equal(stopped.code,200);assert.equal(starts,1);
});
test('bridge agent restarts a missing local bridge only after a repeated failure',async()=>{
 const {root,workId}=fixture();let starts=0;const client={status:async()=>{throw Error('NO1_BRIDGE_UNAVAILABLE');}};
 const options={root,workId,client,restartBridge:async()=>{starts++;},notify:()=>{}};
 assert.equal((await pollWatchdog(options)).code,503);assert.equal(starts,0);
 const second=await pollWatchdog(options);assert.equal(starts,1);assert.equal(second.handler,'bridge_agent');assert.equal(second.actionResult,'requested');
 await pollWatchdog(options);assert.equal(starts,1);
});
test('coordinator replays a saved signal before accepting the next heartbeat',async()=>{
 const {root,workId,dir}=fixture(),box=path.join(dir,'heartbeats');fs.mkdirSync(box,{recursive:true});
 fs.writeFileSync(path.join(box,'monitor.json'),JSON.stringify({id:`${workId}:4`,sequence:4,code:501,reason:'UNKNOWN',at:new Date().toISOString()}));
 let diagnosed=0;const x=await sendHeartbeat({root,workId,finding:{status:'healthy',reason:'RUNNING'},handlers:{record_unknown_error:async()=>{diagnosed++;return {status:'diagnostic_recorded'};}}});
 assert.equal(diagnosed,1);assert.equal(x.signal.sequence,5);assert.equal(x.signal.code,200);
});
test('starting continuous work attaches the independent watchdog',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-watchdog-start-')),w=startWork(root,{targetProfitableProducts:1,userInstruction:'continue',requestId:'attach'});let runner=0,watchdog=0;
 const result=await control('cream_musinsa_work_continue',{workId:w.workId},{root,launchContinuous:async()=>{runner++;return {launched:true};},launchWatchdog:async()=>{watchdog++;}});
 assert.equal(result.continuous,true);assert.equal(runner,1);assert.equal(watchdog,1);
});
test('finite inspection runner holding only worker.lock is not reported as stopped',async()=>{
 const {root,workId,dir}=fixture();
 fs.writeFileSync(path.join(root,'work-orders',workId+'.json'),JSON.stringify({id:workId,status:'open',scopeMode:'inspected-sources',targetSources:1000}));
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({status:'discovering',checkedSources:4,updatedAt:new Date().toISOString()}));
 fs.unlinkSync(path.join(dir,'continuous.lock'));fs.writeFileSync(path.join(dir,'worker.lock'),String(process.pid));
 const client={status:async()=>({browserConnected:true,connectorVersion:'0.8.0',requiredConnectorVersion:'0.8.0'})};
 const monitor=await pollWatchdog({root,workId,client,remoteBridgeStatus:null,notify:()=>{}});
 assert.equal(monitor.workerAlive,true);assert.notEqual(monitor.reason,'WORKER_NOT_RUNNING');
 fs.unlinkSync(path.join(dir,'worker.lock'));
 const stopped=await pollWatchdog({root,workId,client,remoteBridgeStatus:null,notify:()=>{}});
 assert.equal(stopped.workerAlive,false);assert.equal(stopped.reason,'WORKER_NOT_RUNNING');
});
test('a finished finite scope is not reported as a stopped worker',async()=>{
 const {root,workId,dir}=fixture();
 fs.writeFileSync(path.join(root,'work-orders',workId+'.json'),JSON.stringify({id:workId,status:'open',scopeMode:'inspected-sources',targetSources:1000}));
 fs.unlinkSync(path.join(dir,'continuous.lock'));
 const client={status:async()=>({browserConnected:true,connectorVersion:'0.8.0',requiredConnectorVersion:'0.8.0'})};
 for(const status of ['source_exhausted','complete']){
  fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({status,checkedSources:638}));
  const monitor=await pollWatchdog({root,workId,client,remoteBridgeStatus:null,notify:()=>assert.fail('no alert for a normal end')});
  assert.equal(monitor.status,'finished');assert.equal(monitor.severity,'none');assert.equal(monitor.code,200);
 }
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({status:'needs_attention',error:'X',checkedSources:5}));
 assert.equal((await pollWatchdog({root,workId,client,remoteBridgeStatus:null,notify:()=>{}})).reason,'WORKER_NOT_RUNNING');
});
