import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildNo1FirstReport} from './no1-first.mjs';

const now='2026-11-09T08:03:00.000Z';
const policy={feeRate:.06,sellerFixedFee:2500,feeVatRate:.1,feeCap:300000,
  outboundShipping:3000,packingCost:1000,minCashProfit:0};
const seed={kreamId:'123',model:'ABC-123',color:'BLACK',sourceUrl:'https://seller.example/item/1',
  options:[{size:'M',color:'BLACK'}]};
const market={mode:'live-visible-ui',identityVerifiedFromVisibleLink:true,kreamId:'123',model:'ABC-123',
  capturedAt:'2026-11-09T08:02:00.000Z',dataAsOf:'2026-11-09T08:01:00.000Z',
  sizes:[{size:'M',instantBidKrw:200000,estimatedTrades30d:12}]};
const stock={mode:'live-visible-ui',identityVerified:true,sourceUrl:seed.sourceUrl,model:seed.model,
  color:'BLACK',capturedAt:'2026-11-09T08:02:00.000Z',maxBenefitPriceKrw:120000,
  options:[{size:'M',color:'BLACK',quantity:2}]};
const report=(m=market,s=stock)=>buildNo1FirstReport({version:'no1-first-input-v1',
  items:[{seed,market:m,stock:s}]},policy,now);

test('No1 estimate screens first and sends unconfirmed source fields to legacy collection',()=>{
  const r=report(),o=r.items[0].options[0];
  assert.equal(r.summary.candidates,0);
  assert.equal(o.status,'needs_fallback');
  assert.ok(o.optimisticProfitKrw>0);
  assert.ok(o.maxBuyCostKrw>stock.maxBenefitPriceKrw);
  assert.match(r.fallbackJobs[0].id,/^S123-[a-f0-9]{8}-no1fallback-prod$/);
  assert.deepEqual(r.fallbackJobs[0].requestedFields,
    ['source_stock','checkout_cost','discount_conditions','seller_identity','shipping_cost']);
});

test('stale or fixture market data routes market evidence to legacy collection',()=>{
  for (const m of [{...market,dataAsOf:'2026-11-09T07:47:00.000Z'},{...market,mode:'fixture'}]) {
    const r=report(m),o=r.items[0].options[0];
    assert.equal(o.instantBidKrw,null);
    assert.ok(o.reasons.includes('NO1_MARKET_UNAVAILABLE_OR_STALE'));
    assert.equal(r.fallbackJobs[0].id,'K123-no1fallback');
    assert.match(r.fallbackJobs[1].id,/^S123-[a-f0-9]{8}-no1fallback-prod$/);
  }
});

test('source identity mismatch cannot supply price or stock',()=>{
  const r=report(market,{...stock,sourceUrl:'https://seller.example/item/2'}),o=r.items[0].options[0];
  assert.equal(o.sourceStockEstimate,null);
  assert.equal(o.maxBenefitPriceKrw,null);
  assert.ok(o.missingFields.includes('source_stock'));
});

test('live No1 stock lookup shape requires source URL and exact source option',()=>{
  const raw={source:'No1 stock lookup UI',productUrl:seed.sourceUrl,model:seed.model,color:'(19)BLACK',
    option:'M(095)',stockQuantity:5,maximumBenefitPriceKrw:120000,
    capturedAt:'2026-11-09T08:02:00.000Z',queryCompletedAt:'2026-11-09T08:02:00.000Z',
    identityVerified:true,resultUrlVerifiedFromCopy:true,previousResultCleared:true};
  const sourceSeed={...seed,sourceColor:'(19)BLACK',options:[{size:'M',sourceOption:'M(095)',sourceColor:'(19)BLACK'}]};
  const input=s=>buildNo1FirstReport({version:'no1-first-input-v1',items:[{seed:sourceSeed,market,stock:s}]},policy,now);
  assert.equal(input(raw).items[0].options[0].sourceStockEstimate,5);
  assert.equal(input({...raw,option:'L(100)'}).items[0].options[0].sourceStockEstimate,null);
  assert.equal(input({...raw,resultUrlVerifiedFromCopy:false}).items[0].options[0].maxBenefitPriceKrw,null);
});

test('no stock and source price above cost ceiling do not launch expensive fallback',()=>{
  const noStock=report(market,{...stock,options:[{size:'M',color:'BLACK',quantity:0}]});
  assert.equal(noStock.items[0].options[0].status,'low_potential');
  assert.equal(noStock.fallbackJobs.length,0);
  const tooCostly=report(market,{...stock,maxBenefitPriceKrw:205000});
  assert.equal(tooCostly.items[0].options[0].status,'low_potential');
  assert.equal(tooCostly.fallbackJobs.length,0);
});

test('observed KREAM color suffix and source base model need explicit identity mapping',()=>{
  const recorded=JSON.parse(fs.readFileSync(new URL('./no1-mcp-prototype/live-matched-product-result.json',import.meta.url),'utf8'));
  const [actualMarket,actualStock]=recorded.responses.map(x=>JSON.parse(x.result.content[0].text));
  const pairedSeed={kreamId:'1120286',kreamModel:'NBNPG41033-19',sourceModel:'NBNPG41033',
    identityMappingVerified:true,identityBasis:recorded.identityMapping.basis,
    sourceUrl:'https://www.musinsa.com/products/7481180',sourceColor:'(19)BLACK',
    options:[{size:'L',sourceOption:'L(100)',sourceColor:'(19)BLACK'}]};
  const build=s=>buildNo1FirstReport({version:'no1-first-input-v1',items:[{
    seed:s,market:actualMarket,stock:actualStock}]},policy,recorded.recordedAt);
  const approvedMapping=build(pairedSeed);
  assert.equal(approvedMapping.items[0].identityMappingVerified,true);
  assert.equal(approvedMapping.items[0].options[0].sourceStockEstimate,40);
  assert.equal(approvedMapping.items[0].options[0].instantBidKrw,null);
  assert.equal(approvedMapping.items[0].options[0].optimisticProfitKrw,null);
  assert.equal(approvedMapping.fallbackJobs[0].requestedFields[0],'market_quote');
  const noMapping=build({...pairedSeed,identityMappingVerified:false});
  assert.equal(noMapping.items[0].identityMappingVerified,false);
  assert.equal(noMapping.items[0].options[0].sourceStockEstimate,null);
  assert.ok(noMapping.items[0].options[0].missingFields.includes('product_identity'));
});
