import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {control,runDirectory} from './control-mcp.mjs';
import {startWork} from './work-orders.mjs';
const seed={kreamId:'123',productUrl:'https://www.musinsa.com/products/456',model:'ABC',color:'BLACK',option:'L'};
const setup=()=>{const options={root:fs.mkdtempSync(path.join(os.tmpdir(),'cream-control-test-')),launch:()=>({launched:true})};startWork(options.root,{targetProducts:5,userInstruction:'Fixture: inspect five products.',requestId:'fixture'});return options;};
test('Dot control creates a concrete scoped batch and exposes status',async()=>{
  const options=setup(),r=await control('cream_batch_start',{products:[seed]},options);
  assert.equal(r.productCount,1);assert.equal((await control('cream_batch_status',{runId:r.runId},options)).status,'needs_attention');
  const saved=JSON.parse(fs.readFileSync(path.join(runDirectory(r.runId,options.root),'products.json'),'utf8'));assert.deepEqual(saved,[seed]);
});
test('control rejects paths outside the run root',()=>{assert.throws(()=>runDirectory('../escape'),/INVALID_RUN/);});
test('stop preserves data and resume clears only explicit stop markers',async()=>{
  const options=setup(),r=await control('cream_batch_start',{products:[seed]},options),dir=runDirectory(r.runId,options.root);
  await control('cream_batch_stop',{runId:r.runId},options);assert.ok(fs.existsSync(path.join(dir,'STOP')));
  await control('cream_batch_resume',{runId:r.runId},options);assert.ok(!fs.existsSync(path.join(dir,'STOP')));assert.ok(fs.existsSync(path.join(dir,'products.json')));
});
test('follow-up reports no active recipient instead of claiming delivery',async()=>{
  const options=setup(),r=await control('cream_batch_start',{products:[seed]},options);
  const result=await control('cream_batch_steer',{runId:r.runId,message:'Check coupon eligibility'},options);
  assert.equal(result.delivered,false);assert.deepEqual(result.queuedProductIds,[]);
});
