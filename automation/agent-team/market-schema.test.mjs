import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {buildMarketSchema,marketSchemas,salesAsOf} from './market-schema.mjs';
import {TeamStore} from './store.mjs';import {TeamTools} from './tools.mjs';import {handleMcp} from './control-mcp.mjs';
const now=Date.parse('2026-11-10T08:00:00Z');
function observation(){return {id:'source-1',kind:'no1_product',mode:'fixture',observedAt:new Date(now).toISOString(),payload:{request:{kreamId:'123',model:'MODEL',productUrl:'https://www.musinsa.com/products/456',color:'BLACK',option:'L'},identity:{sourceProductVerified:true,sourceOptionVerified:true},benefits:{productId:'456',styleNo:'MODEL',maxBenefitPrice:258200},stock:{selectedStockQuantity:5},marketResearch:{details:{totalSales:99999,sizeOptions:[{size:'L',option:'l',fastDeliveryPrice:300000,lowestNormal:265000,highestBid:200000},{size:'M',option:'m',lowestNormal:200000}]},marginSettings:{source:'no1_web_saved_settings',feePercent:6,inspectionFee:2500,taxMode:false},sales30d:{productCode:'123',taskId:'t',stage:'final',mode:'estimated',perSize:{L:{estimated30d:3000,confidence:'high'},M:{estimated30d:76,confidence:'low'}},cacheInfo:{fetchedAt:'2026-11-09T16:06:00Z',state:'fresh'}},trades:{transactions30d:4,coverageComplete:true}}}};}
test('schema retains exact per-size estimate, total, source time and independent trade count',()=>{
 const s=buildMarketSchema(observation(),{},now);assert.equal(s.totalExpectedSales30d,3076);assert.equal(s.rows[0].expectedSales30d,3000);assert.equal(s.actualRecordedTrades30d,4);assert.equal(s.salesAsOf.timeLabel,'오늘 01:06');assert.equal(s.historyMode,'estimated');
 assert.equal(s.rows[0].margins.normal.marginAmount,-11600);assert.equal(s.rows[0].margins.fast.marginAmount,21300);assert.equal(s.rows[0].margins.fast.marginRate,7.1);assert.equal(s.rows[1].sourceOptionMatched,false);assert.equal(s.inputs.purchasePrice,258200);
});
test('no saved fee settings means no invented default-margin result',()=>{
 const o=observation();delete o.payload.marketResearch.marginSettings;assert.equal(buildMarketSchema(o).rows[0].margins.normal.status,'unknown');
});
test('partial, missing and colliding sales stay uncertain; final missing size matches No1 zero',()=>{
 const o=observation();o.payload.marketResearch.sales30d.perSize={L:{estimated30d:10}};
 assert.equal(buildMarketSchema(o).rows[1].expectedSales30d,0);
 o.payload.marketResearch.sales30d.stage='partial';const p=buildMarketSchema(o);assert.equal(p.totalSalesStatus,'partial');assert.equal(p.rows[1].expectedSales30d,null);
 delete o.payload.marketResearch.sales30d;assert.equal(buildMarketSchema(o).totalExpectedSales30d,null);
 const collision=observation();collision.payload.marketResearch.details.sizeOptions=[{size:'270',option:'270'}];collision.payload.marketResearch.sales30d.perSize={'KR270':{estimated30d:10},'270':{estimated30d:5}};
 assert.equal(buildMarketSchema(collision).rows[0].salesStatus,'ambiguous');assert.equal(buildMarketSchema(collision).rows[0].expectedSales30d,null);
});
test('direct screen margin keeps displayed rounding, actual tax/cost and selected mode',()=>{
 const o=observation();o.payload.marketResearch.displayedSchema={available:true,productCode:'123',inputs:{purchasePrice:258200,desiredSellingPrice:300000,marginMode:'desired',feePercent:6,inspectionFee:2500,taxMode:true,applyFeeEvent:false},salesStopped:false,totalText:'3,076건',asOfText:'오늘 01:06 기준 최신',rows:[{size:'L',option:'l',sales30d:3076,sales30dStatus:'ok',isEstimated:true,normal:265000,fast100:300000,highestBid:200000,marginAmount:17727,marginRate:6.5,marginAmountText:'17,727원',marginRateText:'6.5%'}]};
 const s=buildMarketSchema(o);assert.equal(s.rows[0].margins.desired.marginRate,6.5);assert.equal(s.rows[0].margins.desired.source,'no1_displayed_value');assert.equal(s.displayedValueVerified,true);assert.equal(s.purchaseMatchesSourceQuote,true);
 assert.equal(buildMarketSchema(o,{desiredSellingPrice:400000}).rows[0].margins.desired.source,'no1_formula_with_observed_inputs');
});
test('updating cache and stale source identity cannot masquerade as complete profit evidence',()=>{
 const o=observation();o.payload.marketResearch.sales30d.cacheInfo.state='updating';assert.equal(buildMarketSchema(o).totalSalesStatus,'partial');
 o.payload.benefits.styleNo='OTHER';assert.equal(buildMarketSchema(o).rows[0].margins.normal.status,'unknown');
 assert.equal(salesAsOf({fetchedAt:'invalid'}).timestamp,null);
 const failure={...o,kind:'collection_error',observedAt:new Date(now+1).toISOString(),payload:{request:o.payload.request,code:'FAILED'}};
 assert.equal(marketSchemas([o,failure]).length,1);assert.equal(marketSchemas([o,failure])[0].rows.length,0);
});
test('agent state, reviewer and real MCP handler carry the same 3076-volume evidence',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-schema-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const runId='batch-11111111-1111-1111-1111-111111111111',dir=path.join(root,runId),o=observation();fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'products.json'),JSON.stringify([o.payload.request]));
 const s=new TeamStore(path.join(dir,'judgments','123'),{product:o.payload.request});s.observe(o.kind,o.payload,{mode:'fixture'});s.data.actors.push({role:'reviewer',threadId:'review'});s.save();
 assert.equal(s.summary().marketSchemas[0].totalExpectedSales30d,3076);
 const r=await new TeamTools(s,{offline:true}).execute({tool:'read_market_schema',threadId:'review',arguments:{}});assert.equal(r[0].totalExpectedSales30d,3076);
 const response=await handleMcp({method:'tools/call',params:{name:'cream_panel_data',arguments:{runId}}},{root});assert.equal(JSON.parse(response.content[0].text).products[0].marketSchemas[0].totalExpectedSales30d,3076);
});
