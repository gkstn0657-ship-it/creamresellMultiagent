import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {heartbeatCode,routeHeartbeat,sendHeartbeat} from './heartbeat-routing.mjs';
import {classifyWatchdog,pollWatchdog} from './live-watchdog.mjs';
import {startWork} from './work-orders.mjs';import {control} from './control-mcp.mjs';
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-heartbeat-')),workId='work-11111111-2222-3333-4444-555555555555',dir=path.join(root,'explorations',workId);fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(root,'work-orders'),{recursive:true});fs.writeFileSync(path.join(root,'work-orders',workId+'.json'),JSON.stringify({id:workId,status:'open',continuous:true}));fs.writeFileSync(path.join(dir,'continuous.lock'),String(process.pid));fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({status:'waiting_for_retry',waitReason:'NO1_BRIDGE_DISCONNECTED',checkedSources:465,profitableProductsFound:1}));return {root,workId,dir};};
test('observer codes identify healthy, auth, tab, connector, timeout, worker and unknown errors',()=>{
 for(const [finding,code,handler] of [[{status:'healthy',reason:'RUNNING'},200,'commander'],[{status:'waiting',reason:'KREAM_LOGIN_REQUIRED'},401,'auth_agent'],[{status:'waiting',reason:'NO1_WEB_TAB_REQUIRED'},404,'browser_connection_agent'],[{status:'connector_disconnected',reason:'NO1_BRIDGE_DISCONNECTED'},503,'connector_agent'],[{status:'stalled',reason:'WORKER_PROGRESS_STALE'},504,'latency_agent'],[{status:'worker_stopped',reason:'WORKER_NOT_RUNNING'},500,'worker_agent'],[{status:'needs_attention',reason:'UNEXPECTED'},501,'diagnostic_agent']]){assert.equal(heartbeatCode(finding),code);assert.equal(routeHeartbeat({code,reason:finding.reason}).handler,handler);}
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
