import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {writeJsonAtomic} from './atomic-json.mjs';import {control} from './control-mcp.mjs';import {batchEvents} from './batch-events.mjs';import {attachIdentity} from './collector.mjs';
import {startWork} from './work-orders.mjs';
const setup=t=>{const p=fs.mkdtempSync(path.join(os.tmpdir(),'cream-readiness-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;};
test('transient Windows sharing lock preserves old JSON until atomic replacement',t=>{
 const root=setup(t),file=path.join(root,'state.json');fs.writeFileSync(file,'{"old":true}');let attempts=0;
 writeJsonAtomic(file,{new:true},{pause:()=>{},rename:(from,to)=>{if(attempts++<2){assert.deepEqual(JSON.parse(fs.readFileSync(to,'utf8')),{old:true});throw Object.assign(Error('locked'),{code:'EPERM'});}fs.renameSync(from,to);}});
 assert.equal(attempts,3);assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{new:true});assert.deepEqual(fs.readdirSync(root),['state.json']);
});
test('event retry requestId starts exactly one batch and rejects changed scope',async t=>{
 const root=setup(t);let launches=0;const options={root,launch:async()=>{launches++;return {launched:true};}};
 startWork(root,{targetProducts:5,userInstruction:'Fixture: inspect five products.',requestId:'fixture'});
 const seed={kreamId:'1',productUrl:'https://www.musinsa.com/products/1',model:'A',color:'BLACK',option:'L'};
 const a=await control('cream_batch_start',{products:[seed],requestId:'event-one'},options);
 const b=await control('cream_batch_start',{products:[seed],requestId:'event-one'},options);
 assert.equal(a.runId,b.runId);assert.equal(b.reused,true);assert.equal(launches,1);
 await assert.rejects(control('cream_batch_start',{products:[{...seed,kreamId:'2'}],requestId:'event-one'},options),/SCOPE_CONFLICT/);
});
test('completion event excludes fixtures and has stable identity across scans',t=>{
 const root=setup(t),run='batch-11111111-1111-1111-1111-111111111111',file=path.join(root,run,'batch-state.json');
 const state={mode:'fixture',status:'complete',productCount:2,judged:2,results:[{assessment:{decision:'hold'}}],startedAt:new Date().toISOString(),finishedAt:new Date().toISOString()};
 writeJsonAtomic(file,state);assert.deepEqual(batchEvents(root),[]);writeJsonAtomic(file,{...state,mode:'live'});
 assert.equal(batchEvents(root).length,1);assert.deepEqual(batchEvents(root),batchEvents(root));
});
test('official identity facts cannot cross model, color or current KREAM colorway',()=>{
 const payload={request:{model:'ABC',color:'(19)BLACK'},identity:{},errors:{},missingFields:['marketModelIndependentEvidence'],marketResearch:{details:{colorway:'White'}}};
 const entry={model:'ABC',color:'(19)BLACK',marketColor:'Black'};
 assert.equal(attachIdentity(structuredClone(payload),entry).identity.marketModelIndependentlyVerified,undefined);
 const good=structuredClone(payload);good.marketResearch.details.colorway='Black';assert.equal(attachIdentity(good,entry).identity.marketModelIndependentlyVerified,true);
});
