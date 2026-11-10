import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {hash} from '../renew/Cream/kream-tools/agents-core.mjs';
import {collectFallbackJobs,runNo1First} from './no1-first-runner.mjs';

const now=new Date().toISOString();
const policy={feeRate:.06,sellerFixedFee:2500,feeVatRate:.1,feeCap:300000,
  outboundShipping:3000,packingCost:1000,minCashProfit:0};
const seed={kreamId:'123',model:'ABC-123',sourceUrl:'https://www.musinsa.com/products/7481180',
  sourceColor:'BLACK',options:[{size:'M',sourceOption:'M(095)',sourceColor:'BLACK'}]};
const seeds={version:'no1-first-seeds-v1',items:[seed]};

test('runner calls No1 before planning only a source-page fallback',async()=>{
  const calls=[];
  const query=async(name,args)=>{
    calls.push({name,args});
    if(name==='no1_search_price_comparison') return {mode:'live-visible-ui',
      identityVerifiedFromVisibleLink:true,kreamId:'123',model:'ABC-123',capturedAt:now,
      dataAsOf:now,sizes:[{size:'M',instantBidKrw:200000,estimatedTrades30d:12}]};
    return {mode:'live-visible-ui',identityVerified:true,productUrl:seed.sourceUrl,
      model:'ABC-123',color:'BLACK',option:'M(095)',stockQuantity:2,
      maximumBenefitPriceKrw:120000,capturedAt:now};
  };
  const {plan}=await runNo1First(seeds,policy,{query,now});
  assert.deepEqual(calls.map(x=>x.name),['no1_search_price_comparison','no1_search_stock_estimate']);
  assert.deepEqual(calls[1].args,{productUrl:seed.sourceUrl,model:'ABC-123',color:'BLACK',option:'M(095)'});
  assert.equal(plan.summary.products,1);
  assert.equal(plan.summary.needsFallback,1);
  assert.equal(plan.fallbackJobs.length,1);
  assert.deepEqual(plan.fallbackJobs[0].requestedFields,
    ['source_stock','checkout_cost','discount_conditions','seller_identity','shipping_cost']);
  assert.equal(plan.fallbackJobs[0].actions.at(-1).stockProbe,true);
});

test('No1 failure becomes targeted fallback without fabricating margin',async()=>{
  const {plan,evidence}=await runNo1First(seeds,policy,{query:async()=>{throw Error('UI_UNAVAILABLE');},now});
  assert.equal(evidence.errors.length,2);
  assert.equal(plan.items[0].options[0].optimisticProfitKrw,null);
  assert.deepEqual(plan.fallbackJobs.map(x=>x.requestedFields),
    [['market_quote'],['source_stock','checkout_cost','discount_conditions','seller_identity','shipping_cost']]);
});

test('targeted fallback is copied through the existing relay transport',async()=>{
  const base=fs.mkdtempSync(path.join(process.cwd(),'.no1-first-test-'));
  assert.ok(base.startsWith(path.resolve(process.cwd())+path.sep));
  const target=path.join(base,'target'),service=path.join(base,'service');
  fs.mkdirSync(target);fs.mkdirSync(service);
  const job={id:'S123-fallback-prod',url:seed.sourceUrl,actions:[{stockProbe:true}],
    requestedFields:['checkout_cost']};
  const transportId=`A${hash(path.resolve(target)).slice(0,12)}-${job.id}`;
  fs.writeFileSync(path.join(service,`dump-${transportId}.json`),JSON.stringify({
    at:now,url:job.url,job:{...job,id:transportId},text:'source page captured'}));
  try {
    const result=await collectFallbackJobs(target,[job],service,{timeoutMs:2000,
      transportOptions:{fetch:async()=>({ok:true,json:async()=>fs.readdirSync(service)})}});
    assert.deepEqual(result,{requested:1,collected:1,missing:[]});
    const dump=JSON.parse(fs.readFileSync(path.join(target,`dump-${job.id}.json`),'utf8'));
    assert.equal(dump.transport.canonicalId,job.id);
    assert.equal(dump.text,'source page captured');
  } finally {fs.rmSync(base,{recursive:true,force:true});}
});

test('runner preserves separate KREAM and source model numbers for the observed pair',async()=>{
  const paired=JSON.parse(fs.readFileSync(new URL('./no1-first-seeds.example.json',import.meta.url),'utf8'));
  const recorded=JSON.parse(fs.readFileSync(new URL('./no1-mcp-prototype/live-matched-product-result.json',import.meta.url),'utf8'));
  const responses=recorded.responses.map(x=>JSON.parse(x.result.content[0].text));
  const calls=[];
  const {plan}=await runNo1First(paired,policy,{now:recorded.recordedAt,
    query:async(name,args)=>{calls.push({name,args});return responses[calls.length-1];}});
  assert.equal(calls[0].args.model,'NBNPG41033-19');
  assert.equal(calls[1].args.model,'NBNPG41033');
  assert.equal(plan.items[0].identityMappingVerified,true);
  assert.equal(plan.items[0].options[0].sourceStockEstimate,40);
  assert.equal(plan.items[0].options[0].optimisticProfitKrw,null);
  assert.ok(plan.items[0].options[0].reasons.includes('NO1_MARKET_UNAVAILABLE_OR_STALE'));
});
