import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {collectRankingCandidate,qualifyRankingResult} from './musinsa-ranking-collector.mjs';
import {bindPoizonSize} from './poizon-ranking-collector.mjs';
import {buildMarketSchema,marketSchemas} from './market-schema.mjs';
import {marginReport} from './margin-report.mjs';
import {musinsaSignals} from './musinsa-signals.mjs';
import {validatePacket,groupProducts,makePacket} from './packets.mjs';
import {offerProductId} from './market-offer.mjs';
import {runBatch} from './batch.mjs';
import {recoveringClient} from './source-recovery.mjs';
import {reviewModel} from './roles.mjs';
import {runMusinsaProfitSearch} from './musinsa-profit-runner.mjs';
import {startWork,workOrders,workSummary} from './work-orders.mjs';
import {classifyError} from './error-catalog.mjs';
const candidate={productId:'99',productUrl:'https://www.musinsa.com/products/99',productName:'Test jacket',rank:1};
const adopted=id=>({productId:id,status:'complete',assessment:{decision:'adopt',reviewId:'verified-review'}});
function fixture({kream=false,kreamError,poizonError}={}){
 const calls=[],stock={status:'success',productNumber:'99',makerNumber:'MODEL',combinedOptions:[{firstOption:'BLACK',size:'L',limitedQty:5,isAvailable:true}]};
 const product={spuId:'123',styleCode:'MODEL',colorName:'BLACK',bidStatus:1};
 const prices={product,isApparel:true,sizes:[{skuId:'456',size:'L',apparelSize:'L',color:'BLACK',cnBuyBox:130000,salesCount:'30',localSalesCount:'4'}]};
 const settings={source:'no1_web_saved_settings',category:'apparelShoes',fees:{apparelShoes:{rate:10,minFee:15000,maxFee:45000}},taxMode:false};
 const client={status:async()=>({connectorVersion:'0.8.0'}),request:async(cmd,p={})=>{
  calls.push([cmd,p]);
  if(cmd==='stock:check')return structuredClone(stock);
  if(cmd==='mecro:inventory:search'){if(kreamError)throw Error(kreamError);return {items:kream?[{productCode:'123',brandProductCode:'MODEL',totalSales:1}]:[],nextCursor:null};}
  if(cmd==='market:poizon:search'){if(poizonError)throw Error(poizonError);return {products:[product],nextCursor:null};}
  if(cmd==='market:poizon:prices')return structuredClone(prices);
  if(cmd==='market:poizon:margin-settings')return structuredClone(settings);
  if(cmd.endsWith(':displayed-schema'))return {available:false,reason:'MATCHING_PRICE_TABLE_NOT_OPEN'};
  if(cmd==='market:poizon:chart')return {request:p,chart:Array.from({length:14},(_,i)=>({date:new Date(Date.now()-(14-i)*86400000).toISOString().slice(0,10),price:125000,count:i<7?1:3})),meta:{symbol:'₩',salesCount:'30'}};
  if(cmd==='musinsa:product:benefit')return {productId:'99',styleNo:'MODEL',maxBenefitPrice:80000};
  if(cmd==='settings:get')return {kreamApiBrowser:'electron'};
  if(cmd==='market:kream:prices')return {prices:[{size:'L',option:'L',buyPrice:130000,sellPrice:130000}]};
  if(cmd==='market:kream:details')return {colorway:'BLACK',sizeOptions:[{size:'L',option:'L',lowestNormal:130000,highestBid:130000}]};
  if(cmd==='market:margin-settings')return {source:'no1_web_saved_settings',feePercent:6,inspectionFee:2500,taxMode:false};
  if(cmd==='market:kream:history:start')return {productCode:'123',stage:'final',mode:'estimated',perSize:{L:{estimated30d:8}},cacheInfo:{state:'fresh'}};
  if(cmd==='market:kream:trades')return {items:[],hasNext:false};
  if(cmd==='market:kream:askPreviewBatch')return {previews:[],failures:[]};
  throw Error('UNEXPECTED_COMMAND '+cmd);
 }};
 return {client,calls,stock,prices,settings};
}
test('POIZON-only source reaches saved batch, independent AI input and profitability gate without numeric KREAM collision',async()=>{
 const f=fixture(),result=await collectRankingCandidate(candidate,{client:f.client}),p=result.packet;
 assert.equal(p.productId,'poizon-123');assert.equal(groupProducts(p.offers)[0].productId,'poizon-123');validatePacket(p);
 const o=p.observations[0],s=buildMarketSchema(o),row=s.rows[0];
 assert.equal(row.margins.cn.marginAmount,35000);assert.equal(row.margins.cn.marginRate,35000/130000*100);
 assert.equal(s.displayedValueVerified,false);assert.equal(row.localSales30d,4);assert.equal(row.expectedSales30d,30);
 assert.equal(row.recent.direction,'increasing');assert.equal(row.recent.last7d.observedCount,21);
 assert.equal(qualifyRankingResult(adopted(p.productId),p).passed,true);
 assert.equal(musinsaSignals([o])[0].platform,'poizon');assert.equal(marginReport([o]).rows[0].platform,'poizon');
 assert.equal(f.calls.filter(([cmd])=>cmd==='stock:check').length,1);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cream-poizon-batch-'));
 const batch=await runBatch({dir,seeds:p.offers,analysisProfile:'musinsa-ranking',collect:async()=>o.payload,analyze:async({packet,mission})=>{assert.equal(offerProductId(mission.product),p.productId);assert.equal(musinsaSignals(packet.observations)[0].rows[0].sales30d.localSellerCount,4);return adopted(p.productId);}});
 assert.equal(batch.status,'complete');assert.equal(batch.results[0].marketSchemas[0].platform,'poizon');
});
test('both markets form one product packet and preserve separate margins and sales',async()=>{
 const f=fixture({kream:true}),r=await collectRankingCandidate(candidate,{client:f.client});
 assert.equal(r.packet.productId,'123');assert.deepEqual(r.marketKeys,['123','poizon-123']);
 assert.equal(groupProducts(r.packet.offers).length,1);validatePacket(r.packet);
 assert.equal(marketSchemas(r.packet.observations).length,2);assert.equal(musinsaSignals(r.packet.observations).length,2);
 const q=qualifyRankingResult(adopted('123'),r.packet);assert.equal(q.passed,true);assert.deepEqual(q.eligibleOptions.map(x=>x.platform),['kream','poizon']);
 assert.equal(f.calls.filter(([cmd])=>cmd==='musinsa:product:benefit').length,1);
 const lone=r.packet.offers.find(o=>o.market==='poizon');assert.throws(()=>validatePacket(makePacket({productId:'123',offers:[lone]},r.packet.observations.filter(o=>o.payload.request.market==='poizon'))),/MISMATCH/);
});
test('POIZON cannot pass with zero stock, no review, unknown sales/fees, wrong SKU, blocked bidding or desired-only profit',async()=>{
 const p=(await collectRankingCandidate(candidate,{client:fixture().client})).packet;
 for(const alter of [p=>p.stock.selectedStockQuantity=0,p=>p.market.sizes[0].salesCount=null,p=>p.market.sizes[0].salesCount='1천+',p=>p.market.sizes[0].salesCount='0',p=>p.sizeBinding.skuId='999',p=>p.marketResearch.marginSettings=null,p=>p.marketResearch.charts.GLOBAL.request.skuId='999',p=>p.market.product.bidStatus=0,p=>p.market.sizes[0].cnBuyBox=70000,p=>p.identity.marketModelIndependentlyVerified=false]){
  const copy=structuredClone(p);alter(copy.observations[0].payload);assert.equal(qualifyRankingResult(adopted(p.productId),copy).passed,false);
 }
 assert.equal(qualifyRankingResult({status:'complete',assessment:{decision:'adopt'}},p).passed,false);
 const o=structuredClone(p.observations[0]);o.payload.market.sizes[0].cnBuyBox=70000;assert.ok(buildMarketSchema(o,{desiredSellingPrice:200000}).rows[0].margins.desired.marginAmount>0);assert.equal(qualifyRankingResult(adopted(p.productId),{...p,observations:[o]}).passed,false);
});
test('direct POIZON displayed margins keep rounding and reject a different purchase input',async()=>{
 const p=(await collectRankingCandidate(candidate,{client:fixture().client})).packet,o=p.observations[0];
 o.payload.marketResearch.displayedSchema={available:true,spuId:'123',inputs:{purchasePrice:80000,desiredSellingPrice:null,useDesiredPrice:false,taxMode:false,fee:{rate:10,minFee:15000,maxFee:45000}},rows:[{...o.payload.market.sizes[0],marginAmount:35000,marginRate:26.9,marginAmountText:'35,000원',marginRateText:'26.9%'}]};
 assert.equal(buildMarketSchema(o).rows[0].margins.cn.marginRate,26.9);assert.equal(buildMarketSchema(o).rows[0].margins.cn.source,'no1_displayed_value');
 o.payload.marketResearch.displayedSchema.inputs.purchasePrice=1000;assert.equal(qualifyRankingResult(adopted(p.productId),p).passed,false);
});
test('missing/gapped chart coverage never fabricates trends, and an unsuccessful refresh hides old market data',async()=>{
 const p=(await collectRankingCandidate(candidate,{client:fixture().client})).packet,o=p.observations[0];o.payload.marketResearch.charts.GLOBAL.chart.splice(3,1);
 assert.equal(buildMarketSchema(o).rows[0].recent.direction,null);
 const newer={...o,kind:'collection_error',observedAt:new Date(Date.parse(o.observedAt)+1000).toISOString(),payload:{request:o.payload.request,code:'POIZON_API_ERROR'}};
 assert.equal(marketSchemas([o,newer])[0].rows.length,0);assert.equal(marginReport([o,newer]).rows.length,0);
});
test('Poizon SKU binding rejects ambiguous editions, mismatched colors and implicit shoe conversions',()=>{
 const f=fixture(),option=f.stock.combinedOptions[0];assert.equal(bindPoizonSize(f.stock,f.prices,option).row.skuId,'456');
 assert.equal(bindPoizonSize(f.stock,{...f.prices,sizes:[...f.prices.sizes,...f.prices.sizes]},option),null);
 assert.equal(bindPoizonSize(f.stock,f.prices,{...option,firstOption:'WHITE'}),null);
 const shoes={...f.prices,isApparel:false,sizes:[{skuId:'1',sizeKR:'230',sizeEU:'37',color:'BLACK'}]};
 assert.equal(bindPoizonSize(f.stock,shoes,{...option,size:'230'}),null);assert.equal(bindPoizonSize(f.stock,shoes,{...option,size:'UK4'}),null);assert.equal(bindPoizonSize(f.stock,shoes,{...option,size:'EU37'}).row.skuId,'1');
});
test('one failed market retries once and does not suppress the other; auth and shared stock errors stop safely',async()=>{
 const f=fixture({kream:true,poizonError:'POIZON_API_ERROR'}),waits=[];
 const r=await collectRankingCandidate(candidate,{client:recoveringClient(f.client,{lookupDelays:[1000],sleep:async n=>waits.push(n)})});
 assert.equal(r.packet.productId,'123');assert.equal(r.packet.observations[0].payload.marketChecks.poizon.lookupFailed,true);assert.deepEqual(waits,[1000]);assert.equal(f.calls.filter(([cmd])=>cmd==='market:poizon:search').length,2);
 const g=fixture({kreamError:'KREAM_SEARCH_FAILED'});assert.equal((await collectRankingCandidate(candidate,{client:recoveringClient(g.client,{lookupDelays:[1000],sleep:async()=>{}})})).packet.productId,'poizon-123');
 await assert.rejects(collectRankingCandidate(candidate,{client:fixture({poizonError:'POIZON_LOGIN_REQUIRED'}).client}),/POIZON_LOGIN_REQUIRED/);
 await assert.rejects(collectRankingCandidate(candidate,{client:fixture({poizonError:'NO1_INVALID_RESPONSE'}).client}),/NO1_INVALID_RESPONSE/);
 let attempts=0;await assert.rejects(collectRankingCandidate(candidate,{client:recoveringClient({request:async()=>{attempts++;throw Error('STOCK_CHECK_FAILED');}},{lookupDelays:[1000],sleep:async()=>{}})}),/STOCK_CHECK_FAILED/);assert.equal(attempts,2);
});
test('unrequestable search models cannot poison a valid exact match or become a price request',async()=>{
 const f=fixture(),base=f.client.request;
 const unsupported={spuId:'12',styleCode:'MODEL/OTHER@MODEL',colorName:'BLACK',bidStatus:1};
 f.client.request=async(cmd,p)=>cmd==='market:poizon:search'?{products:[unsupported,{spuId:'123',styleCode:'MODEL',colorName:'BLACK',bidStatus:1}],nextCursor:null}:base(cmd,p);
 const r=await collectRankingCandidate(candidate,{client:f.client});
 assert.equal(r.packet.productId,'poizon-123');
 assert.deepEqual(f.calls.filter(([cmd])=>cmd==='market:poizon:prices').map(([,p])=>p.spuId),['123']);
 f.client.request=async(cmd,p)=>cmd==='market:poizon:search'?{products:[unsupported],nextCursor:null}:base(cmd,p);
 const skipped=await collectRankingCandidate(candidate,{client:f.client});
 assert.equal(skipped.status,'skipped');assert.equal(skipped.marketChecks.poizon.reason,'POIZON_UNSUPPORTED_MARKET_MODEL_FORMAT');
 assert.equal(classifyError({reason:skipped.marketChecks.poizon.reason}).code,211);
 assert.equal(classifyError({reason:'NO1_INVALID_RESPONSE'}).code,400);
});
test('POIZON packet and namespaced dedup survive interruption and increment the work count once',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-poizon-resume-')),w=startWork(root,{targetProfitableProducts:1,userInstruction:'find one',requestId:'poizon-resume'});
 const f=fixture(),stop=path.join(root,'explorations',w.workId,'STOP'),client={...f.client,request:async(cmd,p)=>cmd==='musinsa:ranking:settings'?{category:'103000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'}:cmd==='musinsa:ranking:products'?{products:[{rank:1,productId:'99',productName:'Test',brandName:'Test'}]}:f.client.request(cmd,p)};
 const first=await runMusinsaProfitSearch({root,workId:w.workId,client,collect:async(s,args)=>{const r=await collectRankingCandidate(s,args);fs.writeFileSync(stop,'test');return r;}});assert.equal(first.status,'stopped');assert.deepEqual(first.pendingSourceIds,['99']);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'musinsa-discovery','state.json'))).seenKreamIds,['poizon-123']);fs.unlinkSync(stop);
 const second=await runMusinsaProfitSearch({root,workId:w.workId,client,collect:()=>assert.fail('no repeat collection'),execute:async({seeds})=>({status:'complete',judged:1,results:[adopted(offerProductId(seeds[0]))]})});
 assert.equal(second.status,'complete');assert.equal(workSummary(root,workOrders(root)[0]).profitableProductsFound,1);
});
test('only final adoption verification uses Sol; preliminary and hold/rework reviews stay Luna',()=>{
 assert.equal(reviewModel({decision:'adopt'}).model,'gpt-6.1-sol');assert.equal(reviewModel({decision:'adopt'}).effort,'high');
 for(const decision of ['hold','exclude'])assert.equal(reviewModel({decision,needsDeepReview:true}).model,'gpt-6-luna');
});
test('an aged pending source is recollected before judgment and old profitable evidence cannot pass',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-poizon-aged-')),w=startWork(root,{targetProfitableProducts:1,userInstruction:'find one',requestId:'aged'}),f=fixture();
 const source={...candidate,category:'103000'},old=(await collectRankingCandidate(source,{client:f.client})).packet;
 for(const o of old.observations)o.observedAt=new Date(Date.now()-3600000).toISOString();
 const packet=makePacket(old,old.observations),dir=path.join(root,'explorations',w.workId),evidence=path.join(root,'musinsa-discovery','evidence','99');
 fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'packet.json'),JSON.stringify(packet));
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({pendingSourceIds:['99'],checkedSources:1,skipped:[],batches:[]}));
 fs.writeFileSync(path.join(root,'musinsa-discovery','state.json'),JSON.stringify({seenSourceIds:['99'],seenKreamIds:['poizon-123'],contexts:{}}));
 const client={request:async cmd=>cmd.endsWith('settings')?{category:'103000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'}:{products:[]}};let collected=0;
 const result=await runMusinsaProfitSearch({root,workId:w.workId,client,collect:async(s,args)=>{collected++;assert.equal(s.productId,'99');assert.equal(args.seenKreamIds.has('poizon-123'),false);return {status:'skipped',reason:'NO_AVAILABLE_STOCK'};},execute:()=>assert.fail('sold-out refreshed source must not reach AI')});
 assert.equal(collected,1);assert.equal(result.profitableProductsFound,0);assert.deepEqual(result.pendingSourceIds,[]);assert.equal(result.checkedSources,1);
});
test('a previously qualified KREAM listing and its POIZON evidence are one unique profitable product',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-poizon-count-')),w=startWork(root,{targetProfitableProducts:2,userInstruction:'find two',requestId:'dedup'});
 const file=path.join(root,'work-orders',w.workId+'.json'),work=JSON.parse(fs.readFileSync(file));
 for(const [n,id] of ['123','poizon-123'].entries()){
  const runId='batch-'+String(n);work.entries.push({runId,productCount:1});fs.mkdirSync(path.join(root,runId));
  fs.writeFileSync(path.join(root,runId,'batch-state.json'),JSON.stringify({status:'complete',judged:1,results:[{...adopted(id),qualification:{passed:true,canonicalProductId:'123'}}]}));
 }
 fs.writeFileSync(file,JSON.stringify(work));assert.equal(workSummary(root,workOrders(root)[0]).profitableProductsFound,1);
});
