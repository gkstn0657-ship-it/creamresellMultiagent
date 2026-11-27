import test from 'node:test';import assert from 'node:assert/strict';
import {makePacket} from './packets.mjs';
import {channelTrades,tradePriceCheck,modeHasTradeEvidence} from './trade-channels.mjs';
import {qualifyRankingResult} from './musinsa-ranking-collector.mjs';
import {musinsaSignals} from './musinsa-signals.mjs';
const DAY=86400000,now=Date.parse('2026-11-12T00:00:00Z');
const at=days=>new Date(now-days*DAY).toISOString();
const trade=(days,price,size='L',storage=false)=>({date:at(days),price,size,...(storage?{isImmediateDelivery:true}:{})});
const window_=items=>({windowStart:at(30),windowEnd:new Date(now).toISOString(),coverageComplete:true,issues:[],items});
const inputs={purchasePrice:50000,feePercent:6,inspectionFee:2500,taxMode:false};
function packet({fast=null,normal=null,items=[]}={}){
  const seed={kreamId:'777',productUrl:'https://www.musinsa.com/products/777',model:'MODEL',color:'L',option:'L'};
  return makePacket({productId:'777',offers:[seed]},[{kind:'no1_product',mode:'live',observedAt:new Date(now).toISOString(),payload:{request:seed,
    identity:{sourceProductVerified:true,sourceOptionVerified:true,marketModelIndependentlyVerified:true},stock:{selectedStockQuantity:5,selectedOption:{isAvailable:true}},
    benefits:{productId:'777',styleNo:'MODEL',maxBenefitPrice:50000},
    marketResearch:{details:{sizeOptions:[{size:'L',option:'L',fastDeliveryPrice:fast,lowestNormal:normal,highestBid:30000}]},
      marginSettings:{source:'no1_web_saved_settings',feePercent:6,inspectionFee:2500,taxMode:false},
      sales30d:{productCode:'777',stage:'final',mode:'raw',perSize:{L:{estimated30d:9}},cacheInfo:{state:'fresh'}},trades:window_(items)}}}]);
}
const adopted={productId:'777',status:'complete',assessment:{decision:'adopt',reviewId:'review-x'}};

test('splits per-size 30-day trades into ⚡ storage and normal channels',()=>{
  const c=channelTrades(window_([trade(1,70000,'L',true),trade(3,74000,'L',true),trade(9,72000,'L',true),trade(2,60000),trade(40,99000,'L',true),trade(1,50000,'M',true)]),'L');
  assert.equal(c.status,'complete');
  assert.deepEqual([c.storage.count30d,c.storage.last7dCount,c.storage.previous7dCount,c.storage.median30d],[3,2,1,72000]);
  assert.deepEqual([c.normal.count30d,c.normal.median30d,c.normal.latestTrade.price],[1,60000,60000]);
  assert.equal(channelTrades({items:[]},'L').status,'unavailable');
  assert.equal(channelTrades({...window_([trade(1,1)]),coverageComplete:false},'L').status,'observed_only');
});

test('trade-price check recomputes margin at the same channel median',()=>{
  const c=channelTrades(window_([trade(1,80000,'L',true),trade(2,60000)]),'L');
  const fast=tradePriceCheck('fast',{salePrice:90000,marginAmount:32100,marginRate:35.6},c,inputs);
  assert.equal(fast.channel,'storage');assert.equal(fast.marginAtMedian,80000-4800-2500-50000);assert.equal(fast.status,'profit_at_trade_median');
  const normal=tradePriceCheck('normal',{salePrice:90000,marginAmount:32100,marginRate:35.6},c,{...inputs,purchasePrice:60000});
  assert.equal(normal.marginAtMedian,60000-3600-2500-60000);assert.equal(normal.status,'no_profit_at_trade_median');
  assert.equal(tradePriceCheck('instant',{},c,inputs),null);
  assert.equal(tradePriceCheck('normal',{salePrice:1},channelTrades(window_([trade(1,80000,'L',true)]),'L'),inputs).status,'no_channel_trades');
  assert.equal(tradePriceCheck('fast',{salePrice:1},c,{purchasePrice:50000}).status,'inputs_unknown');
  assert.equal(modeHasTradeEvidence('instant',{marginAmount:1,marginRate:1},null),true);
  assert.equal(modeHasTradeEvidence('fast',{marginAmount:1,marginRate:1},fast),true);
  assert.equal(modeHasTradeEvidence('normal',{marginAmount:1,marginRate:1},normal),false);
});

test('a positive ask margin needs same-channel trades that stay profitable at their median',()=>{
  // normal ask is profitable but only ⚡ trades exist for the size
  let q=qualifyRankingResult(adopted,packet({normal:90000,items:[trade(1,90000,'L',true)]}));
  assert.equal(q.passed,false);
  // normal trades exist but their median leaves a loss (ask-only profit)
  q=qualifyRankingResult(adopted,packet({normal:90000,items:[trade(1,55000),trade(3,56000)]}));
  assert.equal(q.passed,false);
  // fast ask profitable and ⚡ trades confirm it
  q=qualifyRankingResult(adopted,packet({fast:95000,normal:52000,items:[trade(1,88000,'L',true),trade(2,92000,'L',true),trade(4,52000)]}));
  assert.equal(q.passed,true);
  assert.deepEqual(q.eligibleOptions[0].saleModes.map(m=>[m.mode,m.channel,m.channelTrades30d,m.channelMedian30d]),[['fast','storage',2,90000]]);
  assert.equal(q.eligibleOptions[0].saleModes[0].marginAtChannelMedian,90000-5400-2500-50000);
});

test('screening signals expose the channel split and per-mode trade checks to the AI',()=>{
  const o=packet({fast:95000,normal:90000,items:[trade(1,88000,'L',true),trade(2,54000)]}).observations[0];
  const row=musinsaSignals([o])[0].rows.find(r=>r.size==='L');
  assert.equal(row.channelTrades.storage.count30d,1);assert.equal(row.channelTrades.normal.count30d,1);
  assert.equal(row.margins.fast.tradeCheck.status,'profit_at_trade_median');
  assert.equal(row.margins.normal.tradeCheck.status,'no_profit_at_trade_median');
  assert.equal(row.margins.instant.tradeCheck,undefined);
});
