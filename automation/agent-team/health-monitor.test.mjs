import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assessHealth,planDiagnosis,healthSnapshot,pollHealthMonitor,runHealthMonitor,monitorDirectory} from './health-monitor.mjs';
import {diagnoseHealthIncident,validateDiagnosis} from './health-monitor-ai.mjs';
const workId='work-11111111-2222-3333-4444-555555555555';
const healthy=()=>({workId,observedAt:new Date().toISOString(),stage:'discovering',workerAlive:true,checked:3,sourceId:'1',batchId:null,lastActivityAt:new Date().toISOString(),bridge:{connected:true,versionMatches:true}});
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-health-monitor-')),dir=monitorDirectory(root,workId);fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(root,'work-orders'));fs.writeFileSync(path.join(root,'work-orders',workId+'.json'),JSON.stringify({id:workId,status:'open',scopeMode:'inspected-sources',targetSources:233}));fs.writeFileSync(path.join(dir,'process.json'),JSON.stringify({pid:process.pid}));fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({status:'discovering',updatedAt:new Date().toISOString(),checkedSources:132,currentSource:{productId:'7'},token:'must-not-leak'}));return {root,dir,workId};};
const client={status:async()=>({browserConnected:true,connectorVersion:'0.8.0',requiredConnectorVersion:'0.8.0'}),request:()=>assert.fail('monitor must never collect a product')};
test('completion/stopping are terminal, while recorded schema failure is not hidden by worker death',()=>{
 assert.equal(assessHealth({...healthy(),stage:'complete',workerAlive:false}).terminal,true);
 assert.equal(assessHealth({...healthy(),workStopped:true}).reason,'USER_STOPPED');
 const failure=assessHealth({...healthy(),stage:'needs_attention',workerAlive:false,error:'NO1_INVALID_RESPONSE'});
 assert.equal(failure.code,400);assert.equal(failure.reason,'NO1_INVALID_RESPONSE');
});
test('health snapshots preserve finite scope and filter arbitrary values without No1 product requests',async()=>{
 const f=fixture(),before=fs.readFileSync(path.join(f.dir,'state.json'),'utf8');
 const s=await healthSnapshot({...f,client});assert.equal(s.target,233);assert.equal(s.workerAlive,true);assert.equal(s.checked,132);assert.ok(!JSON.stringify(s).includes('must-not-leak'));
 assert.equal(fs.readFileSync(path.join(f.dir,'state.json'),'utf8'),before);
 assert.throws(()=>monitorDirectory(f.root,'../../escape'),/INVALID_WORK_ID/);
});
test('active product AI timestamps avoid false discovery-stall reports',async()=>{
 const f=fixture(),batchId='batch-11111111-2222-3333-4444-555555555555';
 fs.writeFileSync(path.join(f.dir,'state.json'),JSON.stringify({status:'running_batch',updatedAt:'2020-01-01T00:00:00Z',currentRunId:batchId}));
 const dir=path.join(f.root,batchId,'judgments','123');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'team-state.json'),'{}');
 assert.equal(assessHealth(await healthSnapshot({...f,client})).status,'healthy');
 const s=healthy();s.lastActivityAt=new Date(Date.now()-301000).toISOString();assert.equal(assessHealth(s).reason,'WORKER_PROGRESS_STALE');
 assert.equal(assessHealth({...s,stage:'running_batch'}).status,'healthy');
});
test('diagnosis is debounced, durable, and budgeted rather than run every poll',()=>{
 const s={...healthy(),error:'NO1_INVALID_RESPONSE',stage:'needs_attention'},f=assessHealth(s),t=1000000;
 const p=planDiagnosis(null,s,f,t);assert.equal(p.shouldDiagnose,false);
 const q=planDiagnosis(p,s,f,t+10000);assert.equal(q.shouldDiagnose,true);
 const saved={...q,diagnosisAttempts:[{id:q.incident.id,at:t+10000}]};
 assert.equal(planDiagnosis(saved,s,f,t+999999).shouldDiagnose,false);
 assert.equal(planDiagnosis(null,healthy(),assessHealth(healthy()),t).shouldDiagnose,false);
});
test('normal polls do not call AI; sustained error starts one asynchronous diagnosis',async()=>{
 const f=fixture();let calls=0,now=Date.now();const diagnose=async()=>{calls++;return {summary:'test',actionExecuted:false};};
 await pollHealthMonitor({...f,client,now:()=>now,diagnose});assert.equal(calls,0);
 fs.writeFileSync(path.join(f.dir,'state.json'),JSON.stringify({status:'needs_attention',error:'NO1_INVALID_RESPONSE'}));
 await pollHealthMonitor({...f,client,now:()=>now,diagnose});now+=11000;
 const r=await pollHealthMonitor({...f,client,now:()=>now,diagnose});await r.pending;assert.equal(calls,1);
 await pollHealthMonitor({...f,client,now:()=>now+20000,diagnose});assert.equal(calls,1);
});
test('terminal monitor exits without touching the work or spawning AI',async()=>{
 const f=fixture();fs.writeFileSync(path.join(f.dir,'state.json'),JSON.stringify({status:'complete',checkedSources:233}));
 const r=await runHealthMonitor({...f,client,diagnose:()=>assert.fail('terminal AI call'),sleep:()=>assert.fail('terminal sleep')});
 assert.equal(r.status,'complete');assert.equal(fs.existsSync(path.join(f.dir,'health-monitor.lock')),false);
});
test('diagnostic AI has one record-only tool, no agent escalation, and never executes advice',async()=>{
 const f=fixture(),value={summary:'응답 검증 실패',likelyCause:'필드 계약 확인 필요',nextCheck:'저장된 진단 메타데이터 확인',confidence:'medium'};let closed=false;
 const result=await diagnoseHealthIncident({dir:path.join(f.dir,'diagnostic'),snapshot:healthy(),finding:{reason:'NO1_INVALID_RESPONSE'},serverFactory:options=>({
  start:async()=>{},startThread:async p=>{assert.equal(p.model,'gpt-6-luna');assert.equal(p.config['agents.enabled'],false);assert.deepEqual(p.tools.map(x=>x.name),['record_health_diagnosis']);return {thread:{id:'test-thread'}};},
  runTurn:async()=>{await options.onTool({threadId:'test-thread',tool:'record_health_diagnosis',arguments:value});},close:async()=>{closed=true;}
 })});
 assert.equal(closed,true);assert.equal(result.actionExecuted,false);
 assert.throws(()=>validateDiagnosis({...value,command:'execute me'}),/INVALID_HEALTH_DIAGNOSIS/);
});
