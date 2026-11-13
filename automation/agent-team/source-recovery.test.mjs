import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {recoveringClient} from './source-recovery.mjs';
import {runMusinsaProfitSearch} from './musinsa-profit-runner.mjs';
import {startWork} from './work-orders.mjs';import {batchEvents} from './batch-events.mjs';
test('transient lookup recovers on the same request with bounded backoff',async()=>{
 let calls=0;const waits=[],events=[];
 const c=recoveringClient({request:async(cmd,p)=>{assert.equal(p.keyword,'MODEL');if(++calls<3)throw Error('KREAM_SEARCH_FAILED');return {items:[]};}},{delays:[10,20],sleep:async n=>waits.push(n),onRecovery:e=>events.push(e)});
 assert.deepEqual(await c.request('mecro:inventory:search',{keyword:'MODEL'}),{items:[]});assert.equal(calls,3);assert.deepEqual(waits,[10,20]);assert.equal(events.at(-1).type,'source_recovered');
});
test('login failures are not retried and stop interrupts recovery waits',async()=>{
 let calls=0;const c=recoveringClient({request:async()=>{calls++;throw Error('KREAM_LOGIN_REQUIRED');}},{delays:[0,0]});await assert.rejects(c.request('x'),/KREAM_LOGIN_REQUIRED/);assert.equal(calls,1);
 let stop=false;const d=recoveringClient({request:async()=>{throw Error('KREAM_SEARCH_FAILED');}},{stopped:()=>stop,delays:[5000],sleep:async()=>{stop=true;}});await assert.rejects(d.request('x'),/STOP_REQUESTED/);
});
test('exhausted transport recovery retains source and cursor, counts no exclusion, and creates a failure event',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-recovery-'));const w=startWork(root,{targetProfitableProducts:1,userInstruction:'find one profitable',requestId:'recovery'});let attempts=0;
 const client={request:async cmd=>{if(cmd.endsWith('settings'))return {category:'103000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'};if(cmd.endsWith('products'))return {products:[{rank:1,productId:'1',productName:'shoe',brandName:'brand'}]};attempts++;throw Error('NO1_RELAY_CONNECTION_FAILED');}};
 const result=await runMusinsaProfitSearch({root,workId:w.workId,client,recovery:{delays:[0,0]},collect:async(s,{client})=>client.request('mecro:inventory:search',{keyword:'MODEL',cursor:'1'}),execute:async()=>assert.fail('no judgment without data')});
 assert.equal(attempts,3);assert.equal(result.status,'needs_attention');assert.equal(result.checkedSources,0);assert.deepEqual(result.skipped,[]);
 const memory=JSON.parse(fs.readFileSync(path.join(root,'musinsa-discovery/state.json'),'utf8'));assert.deepEqual(memory.seenSourceIds,[]);assert.equal(Object.values(memory.contexts)[0].categoryIndex,0);
 const events=batchEvents(root);assert.equal(events.length,1);assert.equal(events[0].data.productCount,0);assert.match(events[0].data.error,/NO1_RELAY_CONNECTION_FAILED/);
});
test('saved failed source remains retriable even when it drops out of the latest ranking',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-retry-source-'));const w=startWork(root,{targetProfitableProducts:1,userInstruction:'find one profitable',requestId:'retry'});const dir=path.join(root,'explorations',w.workId);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({workId:w.workId,checkedSources:0,skipped:[],batches:[],retrySources:[{category:'103000',rank:2,productId:'2',productName:'saved shoe'}]}));
 const called=[];const client={request:async cmd=>cmd.endsWith('settings')?{category:'103000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'}:{products:[]}};
 const result=await runMusinsaProfitSearch({root,workId:w.workId,client,collect:async s=>{called.push(s.productId);return {status:'skipped',reason:'NO_AVAILABLE_STOCK'};}});assert.deepEqual(called,['2']);assert.deepEqual(result.retrySources,[]);assert.equal(result.checkedSources,1);
});
