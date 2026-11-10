import test from 'node:test';import assert from 'node:assert/strict';
import {summarizeTrades,marketEvidence,settlementBreakdown} from './market-evidence.mjs';
const now=Date.parse('2026-11-10T00:00:00Z');
test('30 day and selected option volume are exact only with full coverage',()=>{
 const page={items:[{date:'2026-11-09T00:00:00Z',size:'L',price:10},{date:'2026-11-08T00:00:00Z',size:'M',price:20}],hasNext:true,nextCursor:'2'};
 assert.equal(summarizeTrades([page],{now,size:'L(100)'}).transactions30d,null);
 const r=summarizeTrades([{...page,hasNext:false}],{now,size:'L(100)'});assert.equal(r.transactions30d,2);assert.equal(r.selectedTransactions30d,1);
});
test('market read stops at page budget and previews one option at a time',async()=>{
 const calls=[];const c={async request(cmd,args){calls.push([cmd,args]);if(cmd.endsWith('details'))return {};if(cmd.endsWith('trades'))return {items:[{date:new Date(now-Number(args.cursor)*86400000).toISOString(),size:'L',price:10}],hasNext:true,nextCursor:String(Number(args.cursor)+1)};return {previews:[],failures:[]};}};
 const r=await marketEvidence(c,{kreamId:'1',option:'L(100)'},{prices:[{size:'L',option:'L',buyPrice:20,sellPrice:10}]},{maxPages:2,maxSelectedPages:2,now});
 assert.equal(calls.filter(x=>x[0].endsWith('trades')).length,4);assert.equal(r.trades.transactions30d,null);assert.equal(r.selectedTrades.transactions30d,null);assert.equal(r.settlement.length,2);assert.equal(r.errors.settlement,'MARKET_SETTLEMENT_INCOMPLETE');assert.ok(calls.filter(x=>x[0].endsWith('askPreviewBatch')).every(x=>x[1].items.length===1));
});

test('unsorted, repeated and invalid trade pages cannot imply complete coverage',()=>{
 const recent={date:'2026-11-09',size:'L',price:10},old={...recent,date:'2026-09-01'};
 assert.equal(summarizeTrades([{items:[old,recent],hasNext:true}],{now}).coverageComplete,false);
 assert.equal(summarizeTrades([{items:[recent,old],hasNext:true}],{now}).coverageComplete,true);
 const repeated=summarizeTrades([{items:[recent],hasNext:true},{items:[recent],hasNext:false}],{now});
 assert.equal(repeated.coverageComplete,false);assert.equal(repeated.observedCount30d,1);
 assert.equal(repeated.selectedTransactions30d,null);
 for(const date of ['invalid','2026-12-01'])assert.equal(summarizeTrades([{items:[{...recent,date}],hasNext:false}],{now}).coverageComplete,false);
 // Identical sales within one page may be separate transactions; never collapse rows.
 assert.equal(summarizeTrades([{items:[recent,recent],hasNext:false}],{now}).transactions30d,2);
});

test('selected option coverage is independent of the bounded product total',async()=>{
 const client={async request(cmd,args){if(cmd.endsWith('details'))return {};if(cmd.endsWith('trades'))return {items:[{date:'2026-11-09',size:args.size||'M',price:10}],hasNext:!args.size,nextCursor:'2'};throw Error('unexpected');}};
 const r=await marketEvidence(client,{kreamId:'1',option:'L'},{prices:[{size:'L',option:'L'}]},{now,maxPages:1});
 assert.equal(r.trades.transactions30d,null);assert.equal(r.selectedTrades.transactions30d,1);assert.equal(r.selectedTrades.scope,'selected_option');
 const wrong=summarizeTrades([{items:[{date:'2026-11-09',size:'M'}],hasNext:false}],{now,size:'L',scope:'selected_option'});
 assert.equal(wrong.coverageComplete,false);assert.deepEqual(wrong.issues,['size_filter_mismatch']);
});

test('settlement arithmetic uses actual fee adjustments and preserves unknown shipping',()=>{
 const preview={price:134000,processingFee:{value:-5790},authenticationFee:{value:0},totalPayout:128210};
 const result=settlementBreakdown(preview);assert.equal(result.reconciled,true);assert.equal(result.observedSellerFee,5790);assert.equal(result.shippingCost,null);assert.equal(result.actualSettlementConfirmed,false);
 assert.equal(settlementBreakdown({...preview,totalPayout:128000}).reconciled,false);
 assert.equal(settlementBreakdown({...preview,processingFee:undefined}).reconciled,null);
 assert.equal(settlementBreakdown({...preview,processingFee:{value:'-5790'}}).observedSellerFee,null);
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
