import test from 'node:test';
import assert from 'node:assert/strict';
import {readRankingFeed,rankingPolicy} from './ranking-feed.mjs';
import {validateCommand,projectData} from './chrome-extension/protocol.mjs';
import {readRankingSettings} from './chrome-extension/ranking-data.mjs';
import {dispatchBackground,handlesBackgroundTool} from './mcp.mjs';
const settings={category:'103000',period:'WEEKLY',gender:'F',ageBand:'AGE_BAND_25'};
const product=(productId,rank)=>({productId,rank,productName:'Reeder',brandName:'Dr Martens',token:'never-return',productUrl:'https://untrusted.invalid'});
test('ranking feed keeps selected filters and sorts popular rank, not response order or keyword search',async()=>{
  const calls=[];
  const client={request:async(cmd,payload)=>{calls.push([cmd,payload]);return cmd.endsWith('settings')?settings:{products:[product(30,3),product(10,1),product(10,4),product(20,2)]};}};
  const out=await readRankingFeed(client,{limit:2});
  assert.deepEqual(calls,[['musinsa:ranking:settings',{}],['musinsa:ranking:products',{section:'all',...settings}]]);
  assert.deepEqual(out.products.map(p=>p.productId),['10','20']);assert.equal(out.total,3);
  assert.equal(out.cursorAdvanced,false);assert.equal(rankingPolicy.discoveryAI,false);
  assert.equal(out.source,'no1-musinsa-ranking');assert.ok(!JSON.stringify(out).includes('never-return'));
  assert.equal(out.products[0].productUrl,'https://www.musinsa.com/products/10');
});
test('all categories uses the native omitted-category contract and never substitutes for missing settings',async()=>{
  let request;
  await readRankingFeed({request:async(cmd,p)=>cmd.endsWith('settings')?{...settings,category:'000'}:(request=p,{products:[]})});
  assert.ok(!Object.hasOwn(request,'category'));
  let calls=0;
  await assert.rejects(readRankingFeed({request:async()=>{calls++;return {};}}),/NO1_RANKING_SETTINGS_UNAVAILABLE/);
  assert.equal(calls,1);
});
test('ranking command accepts only known filters and ALL popular section',()=>{
  validateCommand('musinsa:ranking:products',{section:'all',...settings});
  for(const p of [{section:'new',...settings},{section:'rising',...settings},{section:'all',...settings,category:'bad'},{section:'all',...settings,keyword:'shoe'},{section:'all',...settings,period:'bad'}])assert.throws(()=>validateCommand('musinsa:ranking:products',p),/NO1_INVALID_PAYLOAD/);
  assert.throws(()=>projectData('musinsa:ranking:products',{products:[product(10,0)]}),/NO1_INVALID_RESPONSE/);
  assert.throws(()=>projectData('musinsa:ranking:products',{products:[product('x',1)]}),/NO1_INVALID_RESPONSE/);
});
test('page settings read returns only filters and does not invoke UI/store methods',t=>{
  const oldLocation=globalThis.location,oldDocument=globalThis.document;
  t.after(()=>{globalThis.location=oldLocation;globalThis.document=oldDocument;});
  globalThis.location={origin:'https://no1.certi.life',pathname:'/sourcing/'};
  globalThis.document={querySelectorAll:()=>[{__vue_app__:{config:{globalProperties:{$pinia:{state:{value:{musinsaRanking:{...settings,token:'secret',setCategory:()=>assert.fail('UI write')}}}}}}}}]};
  assert.deepEqual(readRankingSettings(),[settings]);
});
test('ranking preview MCP dispatch is separate and validates limits',async()=>{
  assert.equal(handlesBackgroundTool('no1_background_ranking_feed'),true);
  for(const limit of [0,-1,1001,1.5])await assert.rejects(readRankingFeed({}, {limit}),/NO1_INVALID_PAYLOAD/);
  const out=await dispatchBackground({id:1,params:{name:'no1_background_ranking_feed',arguments:{limit:1}}},{request:async cmd=>cmd.endsWith('settings')?settings:{products:[product(10,1)]}});
  assert.equal(out.result.isError,false);
  assert.equal(JSON.parse(out.result.content[0].text).products.length,1);
});
