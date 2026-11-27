import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {rankingSizeMatch,collectKreamCandidate} from '../agent-team/musinsa-ranking-collector.mjs';
import {makePacket} from '../agent-team/packets.mjs';
import {resolveCases,retryExcludedSource} from './exclusion-resolution-agent.mjs';

const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-resolution-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const batchDir=path.join(root,'batch-11111111-1111-1111-1111-111111111111'),source={productId:'1',productName:'sample',productUrl:'https://www.musinsa.com/products/1'};write(path.join(batchDir,'sources.json'),[source]);write(path.join(batchDir,'source-evidence','1','1.json'),{cmd:'stock:check',observedAt:new Date().toISOString()});return {root,batchDir,item:{batchId:path.basename(batchDir),batchDir,sourceRow:{sourceId:'1',status:'skipped',reason:'NO_MARKET_QUALIFYING_OPTION'},facts:{sourceId:'1',sourceName:'sample',basisHash:'basis-1',kream:{code:'AVAILABLE_OPTION_NOT_BOUND'},poizon:{code:'POIZON_EXACT_MODEL_NOT_FOUND'},confidence:'recorded'},diagnosis:{status:'complete',summary:'Options unbound'}}};}
test('explicit market option label binds only one exact source option during remediation',()=>{
 const stock={makerNumber:'IF1940',combinedOptions:[{firstOption:'220',size:'220'}]},market={kreamId:'477095',prices:[{size:'W220',option:'220',buyPrice:35000}]};
 assert.equal(rankingSizeMatch(stock,market,'220'),null);
 assert.equal(rankingSizeMatch(stock,market,'220',{allowExplicitMarketOption:true,sourceFirstOption:'220'}).evidence.kind,'same-market-option-label');
 assert.equal(rankingSizeMatch(stock,{...market,prices:[...market.prices,{size:'W220 duplicate',option:'220'}]},'220',{allowExplicitMarketOption:true,sourceFirstOption:'220'}),null);
 assert.equal(rankingSizeMatch(stock,{...market,prices:[{size:'US 5W',option:'US 5W'}]},'220',{allowExplicitMarketOption:true,sourceFirstOption:'220'}),null);
 assert.equal(rankingSizeMatch(stock,market,'220',{allowExplicitMarketOption:true,sourceFirstOption:'Black'}),null);
});
test('alternate search term finds only a listing with the exact manufacturer code',async()=>{
 const source={productId:'1',productUrl:'https://www.musinsa.com/products/1'},calls=[];
 const client={request:async(cmd,payload)=>{calls.push([cmd,payload]);if(cmd==='stock:check')return {makerNumber:'M-1A',combinedOptions:[{firstOption:'L',size:'L',limitedQty:2,isAvailable:true}]};if(cmd==='mecro:inventory:search')return {items:payload.keyword==='M1A'?[{productCode:'123',brandProductCode:'M-1A',totalSales:0}]:[],nextCursor:null};if(cmd==='market:kream:prices')return {prices:[]};if(cmd==='market:kream:details')return {colorway:'Black'};throw Error('UNEXPECTED_COMMAND');}};
 assert.equal((await collectKreamCandidate(source,{client})).reason,'EXACT_MARKET_MODEL_NOT_FOUND');
 calls.length=0;assert.equal((await collectKreamCandidate(source,{client,searchVariants:true})).reason,'AVAILABLE_OPTION_NOT_BOUND');
 assert.ok(calls.some(([cmd,payload])=>cmd==='mecro:inventory:search'&&payload.keyword==='M1A'));
});
test('resolution agent reads basis before retry, saves independently reviewed outcome and does not repeat',async t=>{
 const f=fixture(t),outDir=path.join(f.root,'resolution');let retries=0,turns=0;
 const serverFactory=options=>({start:async()=>{},close:async()=>{},startThread:async()=>({thread:{id:'resolver'}}),runTurn:async()=>{
  turns++;const args={sourceId:'1',basisHash:'basis-1',action:'retry_once',reason:'명시적 판매 옵션과 새 조회를 확인합니다.',nextCheck:'재수집 후 독립 검토 기록을 확인합니다.'};
  await assert.rejects(options.onTool({threadId:'resolver',tool:'record_action',arguments:args}),/NOT_READ/);
  const read=await options.onTool({threadId:'resolver',tool:'read_case',arguments:{sourceId:'1'}});assert.equal(read.policy.retryAllowed,true);
  await options.onTool({threadId:'resolver',tool:'record_action',arguments:args});
 }});
 const retry=async()=>{retries++;return {status:'recovered',reviewed:true,productIds:['123']};};
 const first=await resolveCases({cases:[f.item],outDir,root:f.root,serverFactory,retry});assert.equal(first.counts.recovered,1);assert.equal(retries,1);
 await resolveCases({cases:[f.item],outDir,root:f.root,serverFactory,retry});assert.equal(turns,1);assert.equal(retries,1);
});
test('recheck keeps an exclusion when the collector cannot find a qualified packet',async t=>{
 const f=fixture(t),outDir=path.join(f.root,'resolution');
 const result=await retryExcludedSource(f.item,{root:f.root,outDir,client:{},collect:async(_source,options)=>{assert.equal(options.searchVariants,true);assert.equal(options.allowExplicitMarketOption,true);return {status:'skipped',reason:'EXACT_MARKET_MODEL_NOT_FOUND'};}});
 assert.equal(result.status,'still_excluded');assert.equal(result.reviewed,false);
});
test('temporary No1 busy response is retried on the same request',async t=>{
 const f=fixture(t);let requests=0;
 const result=await retryExcludedSource(f.item,{root:f.root,outDir:path.join(f.root,'resolution'),retryDelays:[0],client:{status:async()=>({}),request:async()=>{requests++;if(requests===1)throw Error('NO1_BRIDGE_BUSY');return {ok:true};}},collect:async(_source,{client})=>{await client.request('stock:check',{url:'same'});return {status:'skipped',reason:'EXACT_MARKET_MODEL_NOT_FOUND'};}});
 assert.equal(requests,2);assert.equal(result.status,'still_excluded');
});
test('a new packet alone cannot claim recovery without a real independent review',async t=>{
 const f=fixture(t),outDir=path.join(f.root,'resolution'),offer={kreamId:'123',productUrl:'https://www.musinsa.com/products/1',model:'M1',color:'Black',option:'L'};
 const packet=makePacket({productId:'123',offers:[offer]},[{kind:'no1_product',mode:'live',observedAt:new Date().toISOString(),payload:{request:offer,missingFields:[]}}]);
 const result=await retryExcludedSource(f.item,{root:f.root,outDir,client:{},collect:async()=>({status:'collected',packet}),review:async()=>({status:'complete',results:[{productId:'123',status:'complete',assessment:{id:'fake',reviewId:'fake'}}]})});
 assert.equal(result.status,'needs_attention');assert.equal(result.reviewed,false);
});
