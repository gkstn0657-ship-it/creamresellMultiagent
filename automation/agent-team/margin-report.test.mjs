import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {calculateMargin,marginReport,marginOptions} from './margin-report.mjs';
import {TeamStore} from './store.mjs';
import {TeamTools,reviewTools} from './tools.mjs';
import {handleMcp} from './control-mcp.mjs';
import {panelData} from './panel-data.mjs';
import {marginSummary,renderMargins} from './panel-ui/margin-view.mjs';
const now=Date.parse('2026-11-10T08:00:00Z');
export function evidence(){return {id:'obs-margin',kind:'no1_product',mode:'fixture',observedAt:new Date(now).toISOString(),payload:{
  request:{kreamId:'1138541',productUrl:'https://www.musinsa.com/products/7395794',model:'IR2243-010',color:'BLACK',option:'XS'},
  identity:{sourceProductVerified:true,sourceOptionVerified:true},
  stock:{selectedStockQuantity:35,originalPrice:329000,discountRate:22},
  benefits:{productId:'7395794',styleNo:'IR2243-010',normalPrice:329000,maxBenefitPrice:258200},
  sizeBinding:{sourceSize:'XS',marketSize:'XS'},market:{prices:[{size:'XS',option:'xs-id',buyPrice:265000,sellPrice:200000}]}
}};}

test('observed No1 normal/instant/desired arithmetic and VAT parity',()=>{
  assert.equal(calculateMargin({salePrice:265000,purchasePrice:258200}).marginAmount,-11600);
  assert.equal(calculateMargin({salePrice:150000,purchasePrice:258200}).marginAmount,-119700);
  const desired=calculateMargin({salePrice:300000,purchasePrice:258200});
  assert.equal(desired.marginAmount,21300);assert.equal(desired.marginRate,7.1);assert.equal(desired.label,'남음');
  const vat=calculateMargin({salePrice:300000,purchasePrice:258200,taxMode:true});
  assert.equal(vat.marginAmount,17727);assert.equal(vat.marginRate.toFixed(1),'6.5');
});
test('POIZON lower and upper fee caps match observed values',()=>{
  for(const [salePrice,amount,rate] of [[100000,-173200,'-173.2'],[300000,11800,'3.9'],[500000,196800,'39.4']]){
    const r=calculateMargin({platform:'poizon',salePrice,purchasePrice:258200});
    assert.equal(r.marginAmount,amount);assert.equal(r.marginRate.toFixed(1),rate);
  }
});
test('no 15% profit gate; zero is break-even and missing price is unknown',()=>{
  assert.equal(calculateMargin({salePrice:100000,purchasePrice:91499}).status,'profit');
  assert.equal(calculateMargin({salePrice:100000,purchasePrice:91500}).status,'break_even');
  for(const value of [null,undefined,0,NaN,-1,Infinity])assert.equal(calculateMargin({salePrice:value,purchasePrice:10}).status,'unknown');
  assert.equal(calculateMargin({salePrice:100000,purchasePrice:null}).status,'unknown');
});
test('keeps exact max-benefit amount, exposes four modes, and does not fill missing fast price',()=>{
  const r=marginReport([evidence()],{},now);assert.equal(r.rows.length,4);
  assert.equal(r.rows.find(x=>x.saleMode==='normal').marginAmount,-11600);
  assert.ok(r.rows.every(x=>x.purchasePrice===258200));
  assert.equal(r.rows.find(x=>x.saleMode==='fast').status,'unknown');
  assert.equal(r.rows.find(x=>x.saleMode==='desired').status,'unknown');
  assert.equal(r.rows[0].observationMode,'fixture');assert.equal(r.rows[0].freshness,'recent_observation');
  assert.equal(r.settings.feeSettingsBasis,'no1_defaults_not_user_settings');
  assert.equal(marginReport([evidence()],{desiredSellingPrice:300000},now).rows.at(-1).marginRate,7.1);
});
test('size, benefit identity, stock and staleness are preserved without profitable substitution',()=>{
  const o=evidence();o.payload.market.prices.push({size:'XL',option:'xl',buyPrice:900000});
  o.payload.sizeBinding=null;
  assert.equal(marginReport([o],{},now).rows[1].marginAmount,-11600);
  o.payload.market.prices=o.payload.market.prices.filter(x=>x.size!=='XS');
  assert.ok(marginReport([o],{desiredSellingPrice:900000},now).rows.every(x=>x.status==='unknown'));
  o.payload.request.option='250';o.payload.market.prices=[{size:'US7',buyPrice:900000}];
  assert.ok(marginReport([o],{},now).rows.every(x=>x.status==='unknown'));
  const mismatch=evidence();mismatch.payload.benefits.styleNo='OTHER';
  assert.ok(marginReport([mismatch],{},now).rows.every(x=>x.purchasePrice===null));
  const zero=evidence();zero.payload.stock.selectedStockQuantity=0;
  const row=marginReport([zero],{},now+600001).rows[1];assert.equal(row.stockQuantity,0);assert.equal(row.freshness,'stale');
  assert.equal(marginReport([zero],{},now-1).rows[1].freshness,'unknown');
});
test('deduplicates offers and a failed refresh does not resurrect the previous price',()=>{
  const old=evidence(),newer=evidence();newer.observedAt=new Date(now+1).toISOString();newer.payload.benefits.maxBenefitPrice=260000;
  assert.equal(marginReport([old,newer],{},now+2).rows[1].purchasePrice,260000);
  const failure={...newer,kind:'collection_error',payload:{request:newer.payload.request,code:'NO1_AUTH_REQUIRED'}};
  assert.equal(marginReport([old,failure],{},now+2).rows[1].status,'unknown');
  assert.equal(marginReport([{...old,active:false}],{},now).rows.length,0);
});
test('fee events bind to exact product/option/price and invalid event data stays unknown',()=>{
  const o=evidence();o.payload.marketResearch={settlement:[{previews:[{productCode:'1138541',option:'xs-id',price:265000,isInstant:false,hasFeeEvent:true,processingFee:{value:-1000},authenticationFee:{value:-500}}]}]};
  assert.equal(marginReport([o],{},now).rows[1].marginAmount,5300);
  o.payload.marketResearch.settlement[0].previews[0].processingFee.value=1000;
  assert.equal(marginReport([o],{},now).rows[1].marginAmount,5300);
  o.payload.marketResearch.settlement[0].previews[0].option='xl';
  assert.equal(marginReport([o],{},now).rows[1].marginAmount,-11600);
  assert.equal(calculateMargin({salePrice:265000,purchasePrice:258200,feeEvent:{hasFeeEvent:true}}).status,'unknown');
});
test('invalid custom fee configurations and desired prices are rejected',()=>{
  for(const options of [{desiredSellingPrice:-1},{taxMode:'false'},{fees:{kreamPercent:101}},{fees:{poizonMinFee:90000}},{fees:{unknown:1}}])assert.throws(()=>marginOptions(options),/MARGIN_/);
});
test('agent summary, read-only reviewer tool, panel and MCP all expose margin results',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-margin-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const runId='batch-11111111-1111-1111-1111-111111111111',dir=path.join(root,runId);fs.mkdirSync(dir);
  const o=evidence();fs.writeFileSync(path.join(dir,'products.json'),JSON.stringify([o.payload.request]));
  const s=new TeamStore(path.join(dir,'judgments','1138541'),{product:o.payload.request});
  s.observe(o.kind,o.payload,{mode:o.mode,observedAt:o.observedAt});s.data.actors.push({role:'reviewer',threadId:'review'});s.save();
  assert.equal(s.summary().margins.rows[1].marginAmount,-11600);
  assert.ok(reviewTools.some(t=>t.name==='read_margin_report'));
  const report=await new TeamTools(s,{offline:true}).execute({tool:'read_margin_report',threadId:'review',arguments:{desiredSellingPrice:300000}});
  assert.equal(report.rows.at(-1).marginAmount,21300);assert.equal(s.data.calculations.length,0);
  const panel=panelData({runId,productId:'1138541'},{root});assert.equal(panel.detail.margins.rows[1].marginAmount,-11600);
  const response=await handleMcp({method:'tools/call',params:{name:'cream_panel_data',arguments:{runId}}},{root});
  const body=JSON.parse(response.content[0].text);assert.equal(body.products[0].margins.rows[1].marginAmount,-11600);
  const status=await handleMcp({method:'tools/call',params:{name:'cream_batch_status',arguments:{runId}}},{root});
  assert.equal(status.structuredContent.margins[0].rows[1].marginAmount,-11600);
});
test('margin UI prioritizes results and escapes source labels',()=>{
  const o=evidence();o.payload.request.color='<img src=x onerror=alert(1)>';
  const r=marginReport([o],{},now),html=renderMargins(r);
  assert.match(html,/-11,600원/);assert.match(html,/-4.4%/);assert.match(html,/계산 불가/);
  assert.ok(!html.includes('<img'));assert.match(marginSummary(r),/손해 1/);
});
