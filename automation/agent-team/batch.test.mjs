import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {runBatch,prepareBatch} from './batch.mjs';
import {groupProducts,makePacket,validatePacket} from './packets.mjs';
const seed=n=>({kreamId:String(n),productUrl:`https://www.musinsa.com/products/${n}`,model:`M${n}`,color:'BLACK',option:'L'});
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'cream-batch-test-'));
test('all N packets exist before any individual AI assessment starts',async()=>{
  const order=[],seen=[];const dir=temp();
  const result=await runBatch({dir,seeds:[seed(1),seed(2),seed(3)],mode:'fixture',
    collect:async s=>{order.push(`collect:${s.kreamId}`);return {request:s,missingFields:[]};},
    analyze:async options=>{assert.deepEqual(order.slice(0,3),['collect:1','collect:2','collect:3']);assert.ok(fs.existsSync(path.join(dir,'collection-complete.json')));order.push(`judge:${options.packet.productId}`);seen.push(options.packet);return {status:'complete',assessment:{decision:'hold'}};}});
  assert.equal(result.productCount,3);assert.equal(result.judged,3);assert.equal(result.status,'complete');assert.equal(seen.length,3);
  assert.deepEqual(seen.map(p=>p.observations[0].payload.request.kreamId).sort(),['1','2','3']);
});
test('one unavailable product is retained as a blocked packet and cannot suppress other products',async()=>{
  const result=await runBatch({dir:temp(),seeds:[seed(1),seed(2)],mode:'fixture',collect:async s=>{if(s.kreamId==='1')throw Error('SOURCE_UNAVAILABLE');return {request:s};},
    analyze:async({packet})=>{if(packet.productId==='1')assert.equal(packet.collectionStatus,'blocked');return {status:'complete',assessment:{decision:'hold'}};}});
  assert.equal(result.results.length,2);
});
test('offers and options for one product are grouped into one decision unit',()=>{const groups=groupProducts([seed(1),{...seed(1),option:'M'},seed(2),seed(1)]);assert.equal(groups.length,2);assert.equal(groups[0].offers.length,2);});
test('changed packet contents cannot reuse the original hash',()=>{
  const p=makePacket(groupProducts([seed(1)])[0],[{kind:'no1_product',mode:'fixture',observedAt:new Date().toISOString(),payload:{request:seed(1)}}]);
  assert.equal(validatePacket(p).productId,'1');p.observations[0].payload.request.kreamId='2';assert.throws(()=>validatePacket(p),/INTEGRITY/);
});
test('an analysis failure is reported per product without losing successful results',async()=>{
  const result=await runBatch({dir:temp(),seeds:[seed(1),seed(2)],mode:'fixture',collect:async request=>({request}),analyze:async({packet})=>{if(packet.productId==='1')throw Error('MODEL_UNAVAILABLE');return {status:'complete',assessment:{decision:'exclude'}};}});
  assert.equal(result.status,'needs_attention');assert.equal(result.results[0].error,'MODEL_UNAVAILABLE');assert.equal(result.results[1].assessment.decision,'exclude');
});
test('the same batch cannot collect concurrently in two workers',async()=>{
  const dir=temp();let release;const gate=new Promise(r=>{release=r;});
  const first=runBatch({dir,seeds:[seed(1)],mode:'fixture',collect:async request=>{await gate;return {request};},analyze:async()=>({status:'complete',assessment:{decision:'hold'}})});
  await assert.rejects(()=>runBatch({dir,seeds:[seed(1)]}),/BATCH_ALREADY_RUNNING/);release();await first;
});

const saveComplete=(dir,packet)=>{
 const state={status:'complete',packetId:packet.id,assessment:{decision:'hold'}};
 const target=path.join(dir,'judgments',packet.productId);fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'team-state.json'),JSON.stringify(state));return state;
};
const oldCollect=async request=>({request,observedAt:new Date(Date.now()-700000).toISOString()});
test('live resume refreshes only unfinished stale products and never rejudges completed scope',async()=>{
 const dir=temp(),seeds=[seed(1),seed(2)];await prepareBatch({dir,seeds,collect:oldCollect});
 const first=JSON.parse(fs.readFileSync(path.join(dir,'packets','product-1.json')));saveComplete(dir,first);
 const collected=[],judged=[];
 const result=await runBatch({dir,seeds,resume:true,collect:async request=>{collected.push(request.kreamId);return {request};},analyze:async({packet})=>{judged.push(packet.productId);return saveComplete(dir,packet);}});
 assert.deepEqual(collected,['2']);assert.deepEqual(judged,['2']);assert.equal(result.results[0].reused,true);assert.equal(result.status,'complete');
 const again=await runBatch({dir,seeds,resume:true,collect:async()=>{throw Error('must not recollect');},analyze:async()=>{throw Error('must not rejudge');}});
 assert.equal(again.status,'complete');assert.ok(again.results.every(x=>x.reused));
 await assert.rejects(runBatch({dir,seeds:[seed(1)],resume:true}),/BATCH_SCOPE_CHANGED/);
});
test('interruption after a refreshed packet write cannot invalidate the previous manifest',async()=>{
 const dir=temp(),seeds=[seed(1),seed(2)];await prepareBatch({dir,seeds,collect:oldCollect});
 const before=JSON.parse(fs.readFileSync(path.join(dir,'collection-complete.json'))).packetIds;
 await assert.rejects(runBatch({dir,seeds,resume:true,collect:async request=>({request}),onEvent:e=>{if(e.type==='product_collected')throw Error('SIMULATED_CRASH');}}),/SIMULATED_CRASH/);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'collection-complete.json'))).packetIds,before);
 const result=await runBatch({dir,seeds,resume:true,collect:async request=>({request}),analyze:async({packet})=>saveComplete(dir,packet)});
 assert.equal(result.status,'complete');assert.equal(result.judged,2);
});
test('product concurrency stays at two while collected packets wait for judgment',async()=>{
 const dir=temp(),releases=[];let active=0,maximum=0,started=0;
 const pending=runBatch({dir,seeds:[seed(1),seed(2),seed(3)],mode:'fixture',concurrency:2,collect:async request=>({request}),
  analyze:async()=>{started++;active++;maximum=Math.max(maximum,active);await new Promise(resolve=>releases.push(resolve));active--;return {status:'complete',assessment:{decision:'hold'}};}});
 while(releases.length<2)await new Promise(resolve=>setImmediate(resolve));assert.equal(started,2);releases.shift()();
 while(started<3)await new Promise(resolve=>setImmediate(resolve));releases.splice(0).forEach(resolve=>resolve());
 const result=await pending;assert.equal(maximum,2);assert.equal(result.status,'complete');
});
