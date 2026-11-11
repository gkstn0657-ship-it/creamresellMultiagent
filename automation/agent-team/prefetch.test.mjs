import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {runExploration} from './exploration.mjs';import {runBatch,prepareBatch} from './batch.mjs';import {DiscoveryStore} from './discovery-store.mjs';import {startWork,scopeStatus,stopWork,reopenWork} from './work-orders.mjs';import {digest} from './store.mjs';
const fixture=n=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-prefetch-')),s=new DiscoveryStore(path.join(root,'discovery'));s.appendPage({cursor:'1',nextCursor:null,observedAt:new Date().toISOString(),items:Array.from({length:n},(_,i)=>({productCode:String(i+1),brandProductCode:'M'+(i+1),titleKo:'shoe',titleEn:'',totalSales:1,wishCount:1}))});s.close();const w=startWork(root,{targetProducts:n,userInstruction:'fixture',requestId:'fixture'});return {root,workId:w.workId};};
const packet=c=>{const p={version:'cream-product-packet-v1',productId:c.kreamId,candidate:c,offers:[],collectedAt:new Date().toISOString(),observations:[{kind:'catalog_candidate',mode:'fixture',observedAt:c.discovery.observedAt,payload:c}],gaps:[],collectionStatus:'partial'};return {...p,id:digest(p)};};
test('next collection overlaps judgment; barriers, two AI slots, N cap and no repeated collection survive',async()=>{
 const {root,workId}=fixture(7),counts=new Map(),events=[];let active=0,maxActive=0,release;const gate=new Promise(r=>release=r);
 const collectDiscovered=async c=>{counts.set(c.kreamId,(counts.get(c.kreamId)||0)+1);events.push('collect:'+c.kreamId);if(c.kreamId==='7'){assert.ok(active>0);release();}return packet(c);};
 const result=await runExploration({root,workId,mode:'fixture',prefetchBatch:args=>prepareBatch({...args,collectDiscovered}),executeBatch:args=>runBatch({...args,collectDiscovered,analyze:async({packet:p})=>{active++;maxActive=Math.max(maxActive,active);events.push('judge:'+p.productId);if(Number(p.productId)<=5)await gate;active--;return {status:'complete',assessment:{decision:'hold'}};}})});
 assert.equal(result.status,'complete');assert.equal(scopeStatus(root).reservedProducts,7);assert.equal(maxActive,2);assert.equal(counts.size,7);assert.ok([...counts.values()].every(n=>n===1));assert.ok(events.slice(0,5).every(x=>x.startsWith('collect:')));assert.ok(events.indexOf('collect:7')<events.indexOf('judge:3'));
});
test('stop during prefetch is bounded and explicit resume reuses the same reservations',async()=>{
 const {root,workId}=fixture(7);let didStop=false;
 const collectDiscovered=async c=>{if(c.kreamId==='6'&&!didStop){didStop=true;stopWork(root,workId);}return packet(c);};
 const run=()=>runExploration({root,workId,mode:'fixture',prefetchBatch:args=>prepareBatch({...args,collectDiscovered}),executeBatch:args=>runBatch({...args,collectDiscovered,analyze:async()=>{await new Promise(r=>setTimeout(r,20));return {status:'complete',assessment:{decision:'hold'}};}})});
 assert.equal((await run()).status,'stopped');assert.equal(scopeStatus(root).reservedProducts,7);
 const entries=scopeStatus(root).entries.map(e=>e.runId);for(const id of entries)fs.writeFileSync(path.join(root,id,'process.json'),JSON.stringify({pid:2147483647}));
 reopenWork(root,workId);fs.unlinkSync(path.join(root,'explorations',workId,'STOP'));
 assert.equal((await run()).status,'complete');assert.deepEqual(scopeStatus(root).entries.map(e=>e.runId),entries);assert.equal(scopeStatus(root).judgedProducts,7);
});
test('prefetch failure preserves the completed first batch and resumes without quota duplication',async()=>{
 const {root,workId}=fixture(7);let fail=true;
 const collectDiscovered=async c=>{if(c.kreamId==='6'&&fail)throw Error('NO1_BRIDGE_DISCONNECTED');return packet(c);};
 const run=()=>runExploration({root,workId,mode:'fixture',prefetchBatch:args=>prepareBatch({...args,collectDiscovered}),executeBatch:args=>runBatch({...args,collectDiscovered,analyze:async()=>{await new Promise(r=>setTimeout(r,10));return {status:'complete',assessment:{decision:'hold'}};}})});
 const first=await run();assert.equal(first.status,'needs_attention');assert.equal(scopeStatus(root).judgedProducts,5);assert.equal(scopeStatus(root).reservedProducts,7);
 fail=false;assert.equal((await run()).status,'complete');assert.equal(scopeStatus(root).reservedProducts,7);assert.equal(scopeStatus(root).entries.length,2);
});
test('batch failure with a saved prefetch resumes without creating a competing lookahead',async()=>{
 const {root,workId}=fixture(7);let fail=true;
 const collectDiscovered=async c=>packet(c);
 const run=()=>runExploration({root,workId,mode:'fixture',prefetchBatch:args=>prepareBatch({...args,collectDiscovered}),executeBatch:args=>runBatch({...args,collectDiscovered,analyze:async({packet:p})=>{
  if(fail&&p.productId==='1')return {status:'needs_attention'};
  return {status:'complete',assessment:{decision:'hold'}};
 }})});
 const first=await run();assert.equal(first.status,'needs_attention');assert.equal(scopeStatus(root).reservedProducts,7);assert.equal(scopeStatus(root).entries.at(-1).status,'prefetched');
 fail=false;const resumed=await run();assert.equal(resumed.status,'complete');assert.equal(scopeStatus(root).reservedProducts,7);assert.equal(scopeStatus(root).judgedProducts,7);assert.equal(scopeStatus(root).entries.length,2);
});
