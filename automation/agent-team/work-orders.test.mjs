import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {control} from './control-mcp.mjs';import {reserveWork,scopeStatus} from './work-orders.mjs';
const seed=n=>({kreamId:String(n),productUrl:`https://www.musinsa.com/products/${n}`,model:'ABC',color:'BLACK',option:'L'});
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-work-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let launches=0;return {root,get launches(){return launches;},launch:async dir=>{launches++;fs.writeFileSync(path.join(dir,'batch-state.json'),JSON.stringify({status:'complete',judged:JSON.parse(fs.readFileSync(path.join(dir,'products.json'),'utf8')).length}));return {launched:true};}};}
const begin=(o,n=3,key='scope')=>control('cream_work_start',{targetProducts:n,userInstruction:`Fixture user requested ${n} products.`,requestId:key},o);

test('no work order blocks collection and asks for a user count; no daily 100 default',async t=>{
 const o=setup(t);await assert.rejects(control('cream_batch_start',{products:[seed(1)]},o),/USER_WORK_SCOPE_REQUIRED/);
 const s=await control('cream_batch_status',{},o);assert.equal(s.work.status,'awaiting_user_scope');assert.equal(s.work.policy.dailyLimit,null);assert.equal(o.launches,0);
 const w=await begin(o,150);assert.equal(w.targetProducts,150);assert.equal((await begin(o,150)).reused,true);
});
test('work limit is reserved before launch and duplicate requests spend no additional count',async t=>{
 const o=setup(t);await begin(o,3);const first=await control('cream_batch_start',{products:[seed(1),seed(2)],requestId:'a'},o);
 await assert.rejects(control('cream_batch_start',{products:[seed(3),seed(4)],requestId:'b'},o),/WORK_PRODUCT_LIMIT/);
 assert.equal((await control('cream_batch_start',{products:[seed(1),seed(2)],requestId:'a'},o)).runId,first.runId);
 await control('cream_batch_start',{products:[seed(3)],requestId:'c'},o);const s=scopeStatus(o.root);assert.equal(s.reservedProducts,3);assert.equal(s.remainingProducts,0);assert.equal(s.status,'complete');assert.equal(o.launches,2);
 await assert.rejects(control('cream_batch_start',{products:[seed(4)]},o),/USER_WORK_SCOPE_REQUIRED/);
});
test('event follow-up stays idempotent even if the model changes requestId',async t=>{
 const o=setup(t);await begin(o,3);const triggerEventId='evt-'+'a'.repeat(64);
 const a=await control('cream_batch_start',{products:[seed(1)],triggerEventId,requestId:'first'},o),b=await control('cream_batch_start',{products:[seed(1)],triggerEventId,requestId:'changed'},o);
 assert.equal(a.runId,b.runId);assert.equal(o.launches,1);const s=await control('cream_batch_status',{eventId:triggerEventId},o);assert.equal(s.work.trigger.followUpStarted,true);assert.equal(s.work.trigger.runs.length,1);
 await assert.rejects(control('cream_batch_start',{products:[seed(2)],triggerEventId},o),/SCOPE_CONFLICT/);
});
test('batch size and concurrency remain bounded independently of requested work count',async t=>{
 const o=setup(t);await begin(o,150);
 await assert.rejects(control('cream_batch_start',{products:Array.from({length:6},(_,i)=>seed(i+1))},o),/BATCH_PRODUCT_LIMIT/);
 await assert.rejects(control('cream_batch_start',{products:[seed(1)],concurrency:3},o),/INVALID_CONCURRENCY/);assert.equal(scopeStatus(o.root).reservedProducts,0);
});
test('one active batch prevents another start and work replacement',async t=>{
 const o=setup(t);await begin(o,3);o.launch=async dir=>{fs.writeFileSync(path.join(dir,'process.json'),JSON.stringify({pid:process.pid}));fs.writeFileSync(path.join(dir,'batch-state.json'),JSON.stringify({status:'judging'}));return {launched:true};};
 await control('cream_batch_start',{products:[seed(1)]},o);
 await assert.rejects(control('cream_batch_start',{products:[seed(2)]},o),/ACTIVE_BATCH_EXISTS/);await assert.rejects(begin(o,2,'other'),/WORK_SCOPE_ALREADY_ACTIVE/);
});
test('stop and explicit resume retain scope; resuming completed work is a no-op',async t=>{
 const o=setup(t);const w=await begin(o,3),b=await control('cream_batch_start',{products:[seed(1)]},o);
 assert.equal((await control('cream_batch_resume',{runId:b.runId},o)).reused,true);assert.equal(o.launches,1);
 await control('cream_work_stop',{workId:w.workId},o);assert.equal(scopeStatus(o.root).status,'stopped');
 await assert.rejects(control('cream_batch_start',{products:[seed(2)],workId:w.workId},o),/USER_WORK_SCOPE_REQUIRED/);
});
test('reservation recovery cannot double-spend after a crash before batch directory creation',async t=>{
 const o=setup(t),w=await begin(o,2),args={workId:w.workId,runId:'batch-11111111-1111-1111-1111-111111111111',productCount:1,requestId:'one'};
 reserveWork(o.root,args);reserveWork(o.root,args);assert.equal(scopeStatus(o.root).reservedProducts,1);
 assert.throws(()=>reserveWork(o.root,{...args,scopeHash:'changed'}),/SCOPE_CONFLICT/);
});
test('simultaneous starts cannot race the shared work count',async t=>{
 const o=setup(t);await begin(o,1);o.launch=async()=>{await new Promise(r=>setTimeout(r,25));return {launched:true};};
 const results=await Promise.allSettled([control('cream_batch_start',{products:[seed(1)]},o),control('cream_batch_start',{products:[seed(2)]},o)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(scopeStatus(o.root).reservedProducts,1);
 assert.match(results.find(r=>r.status==='rejected').reason.message,/WORK_CONTROL_BUSY/);
});
