import test from 'node:test';import assert from 'node:assert/strict';
import {summarizeTrades,marketEvidence} from './market-evidence.mjs';
const now=Date.parse('2026-11-10T00:00:00Z');
test('30 day and selected option volume are exact only with full coverage',()=>{
 const page={items:[{date:'2026-11-09T00:00:00Z',size:'L',price:10},{date:'2026-11-08T00:00:00Z',size:'M',price:20}],hasNext:true,nextCursor:'2'};
 assert.equal(summarizeTrades([page],{now,size:'L(100)'}).transactions30d,null);
 const r=summarizeTrades([{...page,hasNext:false}],{now,size:'L(100)'});assert.equal(r.transactions30d,2);assert.equal(r.selectedTransactions30d,1);
});
test('market read stops at page budget and previews one option at a time',async()=>{
 const calls=[];const c={async request(cmd,args){calls.push([cmd,args]);if(cmd.endsWith('details'))return {};if(cmd.endsWith('trades'))return {items:[{date:'2026-11-09',size:'L',price:10}],hasNext:true,nextCursor:String(Number(args.cursor)+1)};return {previews:[],failures:[]};}};
 const r=await marketEvidence(c,{kreamId:'1',option:'L(100)'},{prices:[{size:'L',option:'L',buyPrice:20,sellPrice:10}]},{maxPages:2,now});
 assert.equal(calls.filter(x=>x[0].endsWith('trades')).length,2);assert.equal(r.trades.transactions30d,null);assert.equal(r.settlement.length,2);assert.ok(calls.filter(x=>x[0].endsWith('askPreviewBatch')).every(x=>x[1].items.length===1));
});

test('login expiry stops further market reads and preserves collected trade lower bounds',async()=>{
 for(const failedStage of ['details','trades']){
  const calls=[];const client={async request(cmd){calls.push(cmd);if(cmd.endsWith('details')){if(failedStage==='details')throw Error('NO1_PLATFORM_LOGIN_REQUIRED');return {};}
   if(calls.length===2)return {items:[{date:'2026-11-09',size:'L',price:10}],hasNext:true,nextCursor:'2'};
   throw Error('KREAM_TOKEN_EXPIRED');}};
  const r=await marketEvidence(client,{kreamId:'1',option:'L'},{prices:[{size:'L',option:'L',buyPrice:20,sellPrice:10}]},{now});
  assert.equal(calls.length,failedStage==='details'?1:3);assert.equal(r.settlement,null);
  if(failedStage==='trades'){assert.equal(r.trades.observedCount30d,1);assert.equal(r.trades.transactions30d,null);}
 }
});
