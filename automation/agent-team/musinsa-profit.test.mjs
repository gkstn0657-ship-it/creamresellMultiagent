import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {startWork,workOrders,workSummary,continueWorkUntilStopped} from './work-orders.mjs';
import {makePacket} from './packets.mjs';
import {matchRankingModels,rankingSizeMatch,qualifyRankingResult} from './musinsa-ranking-collector.mjs';
import {runMusinsaProfitSearch} from './musinsa-profit-runner.mjs';
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'cream-profit-target-'));
function packet(id){
  const seed={kreamId:String(id),productUrl:`https://www.musinsa.com/products/${id}`,model:'MODEL',color:'L',option:'L'};
  return makePacket({productId:String(id),offers:[seed]},[{kind:'no1_product',mode:'live',observedAt:new Date().toISOString(),payload:{request:seed,identity:{sourceProductVerified:true,sourceOptionVerified:true,marketModelIndependentlyVerified:true},stock:{selectedStockQuantity:10,selectedOption:{isAvailable:true}},benefits:{productId:String(id),styleNo:'MODEL',maxBenefitPrice:50000},marketResearch:{details:{sizeOptions:[{size:'L',option:'L',lowestNormal:90000}]},marginSettings:{source:'no1_web_saved_settings',feePercent:6,inspectionFee:2500,taxMode:false},sales30d:{productCode:String(id),stage:'final',mode:'estimated',perSize:{L:{estimated30d:30}},cacheInfo:{state:'fresh'}}}}}]);
}
const adopted=id=>({productId:String(id),status:'complete',assessment:{decision:'adopt',reviewId:'review-test'}});

test('finite source inspection counts skipped sources, flushes partial batches and resumes the category in the next work',async()=>{
 const root=temp(),calls=[],settings={category:'000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'};
 const client={request:async cmd=>cmd.endsWith('settings')?settings:{products:[1,2,3,4,5].map(n=>({rank:n,productId:String(n),productName:'shoe',brandName:'brand'}))}};
 const collect=async s=>{calls.push(s.productId);return s.productId==='2'?{status:'skipped',reason:'NO_AVAILABLE_STOCK'}:{status:'collected',kreamId:s.productId,packet:packet(s.productId)};};
 const execute=async({seeds})=>({status:'complete',judged:seeds.length,results:seeds.map(s=>({...adopted(s.kreamId),assessment:{decision:'hold',reviewId:'review-test'}}))});
 const w=startWork(root,{targetSources:3,userInstruction:'inspect 3',requestId:'finite'});
 assert.throws(()=>startWork(root,{targetProducts:3,userInstruction:'inspect 3',requestId:'finite'}),/SCOPE_CONFLICT/);
 const result=await runMusinsaProfitSearch({root,workId:w.workId,client,collect,execute});
 assert.equal(result.status,'complete');assert.equal(result.checkedSources,3);assert.equal(result.profitableProductsFound,0);assert.equal(result.pendingSourceIds.length,0);assert.deepEqual(calls,['1','2','3']);
 const summary=workSummary(root,workOrders(root)[0]);assert.equal(summary.remainingProducts,0);assert.equal(summary.reservedProducts,2);assert.equal(summary.targetSources,3);
 const dir=path.join(root,'explorations',w.workId);fs.writeFileSync(path.join(dir,'process.json'),JSON.stringify({pid:0}));
 await runMusinsaProfitSearch({root,workId:w.workId,client:{request:()=>assert.fail('completed work must not query again')},collect,execute});
 fs.writeFileSync(path.join(dir,'process.json'),JSON.stringify({pid:0}));
 const next=startWork(root,{targetSources:1,userInstruction:'inspect 1',requestId:'next'});
 await runMusinsaProfitSearch({root,workId:next.workId,client,collect,execute});assert.deepEqual(calls,['1','2','3','4']);
 assert.equal(fs.existsSync(path.join(root,'discovery','discovery.sqlite')),false);
});

test('finite inspection preserves interrupted packets and reports source exhaustion without inventing completion',async()=>{
 const root=temp(),w=startWork(root,{targetSources:3,userInstruction:'inspect 3',requestId:'finite-stop'}),stopFile=path.join(root,'explorations',w.workId,'STOP');
 const client={request:async cmd=>cmd.endsWith('settings')?{category:'103000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'}:{products:[{rank:1,productId:'1',productName:'shoe',brandName:'brand'}]}};
 const first=await runMusinsaProfitSearch({root,workId:w.workId,client,collect:async s=>{fs.writeFileSync(stopFile,'stop');return {status:'collected',kreamId:s.productId,packet:packet(s.productId)};},execute:()=>assert.fail('stopped')});
 assert.equal(first.checkedSources,1);assert.deepEqual(first.pendingSourceIds,['1']);fs.unlinkSync(stopFile);
 const last=await runMusinsaProfitSearch({root,workId:w.workId,client,collect:()=>assert.fail('duplicate source'),execute:async()=>({status:'complete',judged:1,results:[adopted(1)]})});
 assert.equal(last.status,'source_exhausted');assert.equal(last.checkedSources,1);assert.equal(workSummary(root,workOrders(root)[0]).remainingProducts,2);
});

test('continuous lookup fails twice, waits only one second, skips and does not retry the same source on restart',async()=>{
 const root=temp(),w=startWork(root,{targetProfitableProducts:1,userInstruction:'continue until stopped',requestId:'skip'});continueWorkUntilStopped(root,w.workId);
 const settings={category:'103000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'},calls=[],waits=[],events=[];
 const client={request:async(cmd,payload)=>{
  if(cmd.endsWith('settings'))return settings;
  if(cmd==='stock:check'){const id=payload.url.split('/').at(-1);calls.push(id);if(id==='1')throw Error('STOCK_CHECK_FAILED');return {};}
  return {products:[1,2].map(n=>({rank:n,productId:String(n),productName:'shoe',brandName:'brand'}))};
 }};
 const options={root,workId:w.workId,client,recovery:{sleep:async ms=>waits.push(ms)},onEvent:e=>events.push(e),collect:async(s,{client})=>{await client.request('stock:check',{url:s.productUrl});return {status:'skipped',reason:'NO_AVAILABLE_STOCK'};}};
 const result=await runMusinsaProfitSearch(options);
 assert.equal(result.status,'source_exhausted');assert.deepEqual(calls,['1','1','2']);assert.deepEqual(waits,[1000]);assert.equal(result.checkedSources,2);assert.equal(result.profitableProductsFound,0);
 assert.equal(result.skipped[0].lookupFailed,true);assert.equal(result.skipped[0].attempts,2);assert.equal(result.retrySources.length,0);
 assert.ok(events.some(e=>e.type==='source_lookup_skipped'&&e.sourceId==='1'));assert.ok(events.some(e=>e.type==='source_retry'&&e.sourceId==='1'&&e.at));
 const file=path.join(root,'musinsa-discovery','state.json'),memory=JSON.parse(fs.readFileSync(file));assert.deepEqual(memory.seenSourceIds,['1','2']);memory.contexts[JSON.stringify(settings)].categoryIndex=0;fs.writeFileSync(file,JSON.stringify(memory));
 calls.length=0;await runMusinsaProfitSearch(options);assert.deepEqual(calls,[]);
});

test('continuous discovery skips product timeouts but preserves authentication, transport and schema failures',async()=>{
 for(const code of ['NO1_BRIDGE_TIMEOUT','NO1_RELAY_TIMEOUT','NO1_AUTH_REQUIRED','NO1_BRIDGE_DISCONNECTED','NO1_INVALID_RESPONSE']){
  const root=temp(),w=startWork(root,{targetProfitableProducts:1,userInstruction:'continue until stopped',requestId:code});continueWorkUntilStopped(root,w.workId);
  const client={request:async cmd=>{if(cmd.endsWith('settings'))return {category:'103000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'};if(cmd==='stock:check')throw Error(code);return {products:[{rank:1,productId:'1',productName:'shoe',brandName:'brand'}]};}};
  const result=await runMusinsaProfitSearch({root,workId:w.workId,client,recovery:{sleep:async()=>{}},collect:async(s,{client})=>client.request('stock:check',{url:s.productUrl})});
  const timeout=code.endsWith('TIMEOUT');assert.equal(result.status,timeout?'source_exhausted':'needs_attention');assert.equal(result.checkedSources,timeout?1:0);
 }
});

test('already exhausted lookup resumes at the next rank without another retry cycle',async()=>{
 const root=temp(),w=startWork(root,{targetProfitableProducts:1,userInstruction:'continuous',requestId:'upgrade'});continueWorkUntilStopped(root,w.workId);
 const dir=path.join(root,'explorations',w.workId);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({checkedSources:0,skipped:[],batches:[],currentSource:{productId:'1',rank:1},recovery:{type:'source_recovery_exhausted',cmd:'stock:check',error:'STOCK_CHECK_FAILED',sourceId:'1',attempts:4},waitReason:'STOCK_CHECK_FAILED',retryAt:'old'}));
 const calls=[],client={request:async cmd=>cmd.endsWith('settings')?{category:'103000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'}:{products:[1,2].map(n=>({rank:n,productId:String(n),productName:'shoe',brandName:'brand'}))}};
 const result=await runMusinsaProfitSearch({root,workId:w.workId,client,collect:async s=>{calls.push(s.productId);return {status:'skipped',reason:'NO_AVAILABLE_STOCK'};}});
 assert.deepEqual(calls,['2']);assert.equal(result.checkedSources,2);assert.equal(result.waitReason,undefined);assert.equal(result.retryAt,undefined);
});
test('profit result needs independent adoption AND a matched in-stock profitable selling option with demand',()=>{
  assert.equal(qualifyRankingResult(adopted(1),packet(1)).passed,true);
  for(const alter of [p=>p.stock.selectedStockQuantity=0,p=>p.identity.marketModelIndependentlyVerified=false,p=>p.request.option='OTHER',p=>p.benefits.maxBenefitPrice=100000,p=>p.marketResearch.sales30d.perSize.L.estimated30d=0]){const p=packet(1);alter(p.observations[0].payload);assert.equal(qualifyRankingResult(adopted(1),p).passed,false);}
  assert.equal(qualifyRankingResult({...adopted(1),assessment:{decision:'hold',reviewId:'review'}},packet(1)).passed,false);
});
test('until-profitable scope differs from examined-product scope and retries cannot change it',()=>{
  const root=temp(),w=startWork(root,{targetProfitableProducts:10,userInstruction:'find 10 profitable',requestId:'x'});
  assert.equal(w.targetProducts,null);assert.equal(w.targetProfitableProducts,10);assert.equal(w.remainingProducts,10);
  assert.throws(()=>startWork(root,{targetProducts:10,userInstruction:'find 10 profitable',requestId:'x'}),/SCOPE_CONFLICT/);
  assert.throws(()=>startWork(temp(),{targetProducts:10,targetProfitableProducts:10,userInstruction:'x',requestId:'y'}),/AMBIGUOUS/);
});
test('model matching ignores irrelevant recommendations and preserves ambiguous exact matches',()=>{
  const stock={makerNumber:'ABC',combinedOptions:[{firstOption:'(19)BLACK',size:'L'}]};
  const rows=[{productCode:'1',brandProductCode:'ABC-19'},{productCode:'2',brandProductCode:'XYZ'},{productCode:'3',brandProductCode:'ABC / OLD'}];
  assert.deepEqual(matchRankingModels(stock,rows).map(m=>m.item.productCode),['1','3']);
  assert.deepEqual(matchRankingModels(stock,[{productCode:'9',brandProductCode:'-'}]),[]);
});
test('one-size fallback requires singleton choices and never maps ambiguous or numeric shoe sizes',()=>{
  const stock={makerNumber:'X',combinedOptions:[{size:'NONE'}]},market={prices:[{size:'ONE SIZE',option:'ONE SIZE'}]};
  assert.equal(rankingSizeMatch(stock,market,'NONE').evidence.kind,'exact-model-single-option');
  assert.equal(rankingSizeMatch({...stock,combinedOptions:[{size:'NONE'},{size:'OTHER'}]},market,'NONE'),null);
  assert.equal(rankingSizeMatch(stock,market,'230'),null);
  assert.equal(rankingSizeMatch(stock,{prices:[{size:'XS'}]},'085(XS)').price.size,'XS');
});
test('runner continues after held products until target successes, keeping separate persistent ranking deduplication',async()=>{
  const root=temp(),w=startWork(root,{targetProfitableProducts:2,userInstruction:'find 2 profitable',requestId:'test'});
  const calls=[];const client={request:async cmd=>cmd.endsWith('settings')?{category:'103000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'}:{products:[1,2,3,4].map(n=>({rank:n,productId:String(n),productName:'shoe',brandName:'brand'}))}};
  const result=await runMusinsaProfitSearch({root,workId:w.workId,client,collect:async s=>{calls.push(s.productId);return {status:'collected',kreamId:s.productId,packet:packet(s.productId)};},execute:async({seeds})=>({status:'complete',judged:seeds.length,results:seeds.map(s=>({...adopted(s.kreamId),...(s.kreamId==='1'?{assessment:{decision:'hold',reviewId:'r'}}:{})}))})});
  assert.equal(result.status,'complete');assert.equal(result.profitableProductsFound,2);assert.deepEqual(calls,['1','2','3']);
  const summary=workSummary(root,workOrders(root)[0]);assert.equal(summary.reservedProducts,3);assert.equal(summary.profitableProductsFound,2);assert.equal(summary.remainingProducts,0);
  const registry=JSON.parse(fs.readFileSync(path.join(root,'qualified-products.json'),'utf8'));assert.equal(registry.total,2);assert.deepEqual(registry.products.map(product=>product.canonicalProductId),['2','3']);
  assert.equal(fs.existsSync(path.join(root,'discovery','discovery.sqlite')),false);
  const memory=JSON.parse(fs.readFileSync(path.join(root,'musinsa-discovery','state.json'),'utf8'));assert.deepEqual(memory.seenSourceIds,['1','2','3']);
});
test('interrupted collection preserves queued packets and category cursor for the same work',async()=>{
  const root=temp(),w=startWork(root,{targetProfitableProducts:1,userInstruction:'find 1 profitable',requestId:'resume'});
  const stopFile=path.join(root,'explorations',w.workId,'STOP');let collects=0;
  const client={request:async cmd=>cmd.endsWith('settings')?{category:'103000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'}:{products:[{rank:1,productId:'1',productName:'shoe',brandName:'brand'}]}};
  const first=await runMusinsaProfitSearch({root,workId:w.workId,client,collect:async()=>{collects++;fs.writeFileSync(stopFile,'test interrupt');return {status:'collected',kreamId:'1',packet:packet(1)};},execute:async()=>assert.fail('must not start after stop')});
  assert.equal(first.status,'stopped');assert.deepEqual(first.pendingSourceIds,['1']);
  const memory=JSON.parse(fs.readFileSync(path.join(root,'musinsa-discovery','state.json'),'utf8'));assert.equal(Object.values(memory.contexts)[0].categoryIndex,0);
  fs.unlinkSync(stopFile);
  const second=await runMusinsaProfitSearch({root,workId:w.workId,client,collect:async()=>assert.fail('saved packet must not be recollected'),execute:async()=>({status:'complete',judged:1,results:[adopted(1)]})});
  assert.equal(second.status,'complete');assert.equal(second.profitableProductsFound,1);assert.equal(collects,1);
});
test('explicit continuous scope keeps collecting after the initial profit target',async()=>{
  const root=temp(),w=startWork(root,{targetProfitableProducts:1,userInstruction:'find one profitable',requestId:'continuous'});
  const scope=continueWorkUntilStopped(root,w.workId);assert.equal(scope.continuous,true);assert.equal(scope.remainingProducts,5);
  const calls=[],client={request:async cmd=>cmd.endsWith('settings')?{category:'103000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'}:{products:[1,2].map(n=>({rank:n,productId:String(n),productName:'jacket',brandName:'brand'}))}};
  const result=await runMusinsaProfitSearch({root,workId:w.workId,client,collect:async s=>{calls.push(s.productId);return {status:'collected',kreamId:s.productId,packet:packet(s.productId)};},execute:async({seeds})=>({status:'complete',judged:seeds.length,results:seeds.map(s=>adopted(s.kreamId))})});
  assert.deepEqual(calls,['1','2']);assert.equal(result.profitableProductsFound,2);assert.equal(result.status,'source_exhausted');
  const summary=workSummary(root,workOrders(root)[0]);assert.equal(summary.remainingToInitialTarget,0);assert.equal(summary.remainingProducts,5);
});
test('continuous source scope resumes after its original checked-source target',async()=>{
  const root=temp(),w=startWork(root,{targetSources:1,userInstruction:'inspect one',requestId:'continuous-sources'}),dir=path.join(root,'explorations',w.workId);
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({workId:w.workId,status:'complete',checkedSources:1,skipped:[],batches:[],pendingSourceIds:[]}));
  const scope=continueWorkUntilStopped(root,w.workId);assert.equal(scope.continuous,true);assert.equal(scope.remainingProducts,5);
  const calls=[],client={request:async cmd=>cmd.endsWith('settings')?{category:'103000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'}:{products:[1,2].map(n=>({rank:n,productId:String(n),productName:'jacket',brandName:'brand'}))}};
  const memoryDir=path.join(root,'musinsa-discovery');fs.mkdirSync(memoryDir,{recursive:true});fs.writeFileSync(path.join(memoryDir,'state.json'),JSON.stringify({version:1,seenSourceIds:['1'],seenKreamIds:[],contexts:{}}));
  const result=await runMusinsaProfitSearch({root,workId:w.workId,client,collect:async s=>{calls.push(s.productId);return {status:'skipped',reason:'NO_AVAILABLE_STOCK'};}});
  assert.deepEqual(calls,['2']);assert.equal(result.checkedSources,2);assert.equal(result.status,'source_exhausted');
});
