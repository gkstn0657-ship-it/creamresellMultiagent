import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sourceAvailability} from './source-availability.mjs';
import {TeamStore,digest} from './store.mjs';
import {runTeam} from './run.mjs';
import {reviewModel} from './roles.mjs';

function packet(){
  const at=new Date().toISOString(), productId='123';
  const candidate={kind:'catalog-candidate',kreamId:productId,title:'Sample',model:'AB1',category:'clothing',
    discovery:{source:'no1-kream-popularity',sort:'popular_score',observedAt:at}};
  const gaps=['verifiedSourceOfferMissing','deepMarketCollectionDeferredUntilSourceFound'];
  const summary={productId,gaps,sourceQuotes:[],offers:[],checkedSources:0,retailersSearched:['musinsa'],coverage:'first page'};
  const observations=[['catalog_candidate',candidate],['source_search',{url:'https://www.musinsa.com/search/goods',query:'AB1',items:[],hasNext:false}],
    ['collection_summary',summary]].map(([kind,payload])=>({kind,payload,observedAt:at,mode:'fixture'}));
  const body={version:'cream-product-packet-v1',candidate,productId,offers:[],sourceQuotes:[],gaps,
    collectionStatus:'partial',collectedAt:at,observations};
  return {...body,id:digest(body)};
}

function setup(t,compactDecisions=['hold','hold'],afterDecision=()=>{}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cream-availability-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const data=packet(), threads=[], calls=[];
  class Fake extends EventEmitter{
    config={};
    async start(){}
    async close(){}
    async startThread(opts){
      const n=threads.push(opts),id='actor-'+n;
      return {thread:{id},model:opts.model};
    }
    async runTurn(id,input){
      const opts=threads[Number(id.slice(6))-1],names=opts.tools.map(tool=>tool.name);
      calls.push(names);
      const call=(tool,args={})=>this.onTool({threadId:id,tool,arguments:args});
      if(names.includes('record_source_check')){
        const body=JSON.parse(input);
        assert.equal(body.originalCollectionSummary.kind,'collection_summary');
        await assert.rejects(()=>call('read_observation',{id:'outside-packet'}),/OBSERVATION_NOT_FOUND/);
        const decision=compactDecisions.shift()||'hold';
        await call('record_source_check',{decision,reason:'packet evidence checked'});
        afterDecision(decision);
      }else if(names.includes('record_review')){
        await assert.rejects(()=>call('record_review',{verdict:'pass',issues:[]}),/REVIEW_MUST_READ_ORIGINALS/);
        let page;do{page=await call('read_next_originals');assert.ok(page.originals.length);}while(page.remaining);
        await call('record_review',{verdict:'pass',issues:[]});
      }else{
        const state=await call('team_state');
        const proposal={decision:'hold',reason:'full check',basis:[state.observations[0].id],unresolved:['no source']};
        await call('request_review',{proposal,question:'Check original evidence',needsDeepReview:false});
        await call('publish_reviewed_assessment');
      }
      this.emit('notification',{method:'thread/tokenUsage/updated',params:{threadId:id,tokenUsage:{total:{totalTokens:101,inputTokens:100,outputTokens:1}}}});
    }
  }
  const factory=({onTool})=>{const server=new Fake();server.onTool=onTool;return server;};
  return {dir,data,threads,calls,run:extra=>runTeam({dir,mission:{product:{kreamId:data.productId},analysisProfile:'general'},
    packet:data,serverFactory:factory,...extra})};
}

test('only recognized, consistent absence of purchase evidence is eligible',()=>{
  assert.equal(sourceAvailability(packet()).verifiedOffers,0);
  for(const change of [
    p=>{p.offers.push({});},p=>{p.sourceQuotes.push({price:1});},
    p=>{p.observations.push({kind:'source_identity',payload:{stock:1}});},
    p=>{p.observations.push({kind:'market_research',payload:{}});},
    p=>{p.observations.at(-1).payload.productId='other';},
    p=>{p.observations.at(-1).payload.offers=[{}];},
    p=>{p.observations.at(-1).payload.checkedSources=1;},
    p=>{p.observations[1].payload.items=[{productUrl:'https://www.musinsa.com/products/1'}];},
    p=>{p.observations.splice(1,1);},
    p=>{p.observations.push({kind:'source_lookup_error',payload:{retailer:'musinsa',code:'SOURCE_29CM_MODEL_MISMATCH'}});},
    p=>{p.observations[0].payload={...p.candidate,model:'different'};},
    p=>{p.gaps=['verifiedSourceOfferMissing'];},
    p=>{p.gaps=[...p.gaps,'UNKNOWN'];},p=>{delete p.sourceQuotes;},
    p=>{p.candidate.discovery.source='musinsa-ranking';}]){
    const data=packet();change(data);assert.equal(sourceAvailability(data),null);
  }
});

test('two different low-effort actors confirm only the missing-source hold',async t=>{
  const x=setup(t);const s=await x.run();
  assert.deepEqual(x.threads.map(t=>t.effort),['low','low']);
  assert.equal(s.assessment.decision,'hold');assert.equal(s.assessment.confirmedProfit,null);
  assert.notEqual(s.reviews[0].threadId,s.assessment.threadId);
  assert.equal(s.reviews[0].evidenceView,'source_availability_projection');
  for(const a of s.actors){assert.equal(a.tokenUsage.totalTokens,101);assert.equal(a.originalIdsDelivered.length,1);}
  await x.run({resume:true});assert.equal(x.threads.length,2);
  await x.run({resume:true,message:'Please reassess the full evidence'});assert.equal(x.threads.length,4);
});

test('each inspected 29CM search hit requires its own matching model mismatch record',()=>{
  const p=packet(),summary=p.observations.at(-1).payload,url='https://www.29cm.co.kr/products/11';
  summary.retailersSearched.push('29cm');
  p.gaps.push('SOURCE_29CM_MODEL_MISMATCH');
  p.observations.splice(2,0,{kind:'source_search',payload:{retailer:'29cm',query:'AB1',
    url:'https://www.29cm.co.kr/store/search?keyword=AB1',items:[{productUrl:url}]}});
  assert.equal(sourceAvailability(p),null);
  const error={kind:'source_lookup_error',payload:{retailer:'29cm',productUrl:url,code:'SOURCE_29CM_MODEL_MISMATCH'}};
  p.observations.splice(3,0,error);
  assert.deepEqual(sourceAvailability(p).searches.map(x=>x.retailer),['musinsa','29cm']);
  error.payload.productUrl='https://www.29cm.co.kr/products/12';
  assert.equal(sourceAvailability(p),null);
});

test('a material dispute uses a full independent high-tier review; a routine second look stays standard',async t=>{
  for(const [decision,model] of [['conflict','gpt-6.1-sol'],['full_review','gpt-6-luna']]){
    const x=setup(t,['hold',decision]);const s=await x.run();
    assert.equal(x.threads.length,4);assert.equal(x.threads.at(-1).model,model);
    assert.equal(s.assessment.reason,'full check');
    const raw=s.observations.filter(v=>v.active!==false);
    assert.ok(raw.every(v=>v.kind!=='source_availability_projection'));
    assert.equal(s.reviews.at(-1).basisIds.length,raw.length);
  }
  assert.equal(reviewModel({decision:'adopt'}).model,'gpt-6.1-sol');
});

test('per-thread cumulative token usage survives reopening, repeats, old events and missing fields',t=>{
  const {dir}=setup(t),s=new TeamStore(dir,{});s.data.actors=[{threadId:'one',tokenUsage:null},{threadId:'two',tokenUsage:null}];s.save();
  for(const total of [null,{totalTokens:20,inputTokens:15,cachedInputTokens:10},{totalTokens:20},{totalTokens:9}]){
    s.recordTokenUsage('one',total);
  }
  const again=new TeamStore(dir);assert.equal(again.data.actors[0].tokenUsage.cachedInputTokens,10);
  assert.equal(again.data.actors[0].tokenUsage.outputTokens,null);assert.equal(again.data.actors[1].tokenUsage,null);
  again.recordTokenUsage('one',{totalTokens:30,inputTokens:24,outputTokens:6});
  assert.equal(new TeamStore(dir).data.actors[0].tokenUsage.totalTokens,30);
});

test('a material conflict survives interruption before the compact turn finishes',async t=>{
  const x=setup(t,['conflict'],()=>{throw Error('connection lost');});
  await assert.rejects(x.run(),/connection lost/);
  assert.equal(new TeamStore(x.dir).data.materialReviewConflict,true);
  const state=await x.run({resume:true});
  assert.equal(x.threads.at(-1).model,'gpt-6.1-sol');
  assert.equal(state.assessment.reason,'full check');
});

test('a legacy interrupted packet is restored before full review on resume',async t=>{
  const x=setup(t),store=new TeamStore(x.dir,{product:{kreamId:x.data.productId},analysisProfile:'general'});
  store.data.packetId=x.data.id;
  const row=x.data.observations[0];
  const originalId=store.observe(row.kind,row.payload,{mode:row.mode,observedAt:row.observedAt}).id;
  const state=await x.run({resume:true});
  assert.equal(state.observations.find(o=>o.id===originalId).active,false);
  const active=state.observations.filter(o=>o.active!==false);
  assert.deepEqual(active.map(o=>o.kind),x.data.observations.map(o=>o.kind));
  assert.deepEqual(state.reviews.at(-1).basisIds,active.map(o=>o.id));
  assert.equal(state.assessment.reason,'full check');
});
