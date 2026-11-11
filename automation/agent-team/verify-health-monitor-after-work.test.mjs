import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {verificationGate,verifyAfterWork} from './verify-health-monitor-after-work.mjs';
const workId='work-11111111-2222-3333-4444-555555555555';
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-monitor-gate-')),dir=path.join(root,'explorations',workId);fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(root,'work-orders'));fs.writeFileSync(path.join(root,'work-orders',workId+'.json'),JSON.stringify({id:workId,status:'open',entries:[]}));return {root,dir,workId};};
test('tests wait through discovery and errors, and also wait for worker shutdown after completion',()=>{
 const f=fixture(),state=path.join(f.dir,'state.json');
 for(const status of ['discovering','running_batch','needs_attention','source_exhausted']){fs.writeFileSync(state,JSON.stringify({status}));assert.equal(verificationGate(f.root,workId).ready,false);}
 fs.writeFileSync(state,JSON.stringify({status:'complete'}));fs.writeFileSync(path.join(f.dir,'process.json'),JSON.stringify({pid:123}));
 assert.equal(verificationGate(f.root,workId,()=>true).ready,false);assert.equal(verificationGate(f.root,workId,()=>false).ready,true);
});
test('deferred runner invokes no tests or model until completion gate permits it and never activates monitoring',async()=>{
 const f=fixture();let ready=false,tested=0,smoked=0;
 const r=await verifyAfterWork({...f,gate:()=>({ready,status:ready?'ready':'waiting_for_completion'}),sleep:async()=>{assert.equal(tested,0);assert.equal(smoked,0);ready=true;},runTests:async()=>{assert.equal(ready,true);tested++;return true;},runSmoke:async()=>{smoked++;return {actionExecuted:false,model:'test',threadId:'test'};}});
 assert.equal(tested,1);assert.equal(smoked,1);assert.equal(r.status,'passed');assert.equal(r.monitorActivated,false);
});
test('stopping the source work cancels deferred validation',async()=>{
 const r=await verifyAfterWork({...fixture(),gate:()=>({ready:false,status:'cancelled'}),runTests:()=>assert.fail('tests must not run'),runSmoke:()=>assert.fail('AI must not run')});assert.equal(r.status,'cancelled');assert.equal(r.testsStarted,false);
});
