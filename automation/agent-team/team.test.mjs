import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {TeamStore,calculateScenario,publishAssessment,evidenceGaps,proposalHash} from './store.mjs';
import {TeamTools} from './tools.mjs';
import {assertMarketIdentity} from '../agentic/tools.mjs';
const input={purchaseBeforePoints:100000,existingPointsSpent:10000,inboundShipping:3000,salePrice:130000,sellerFeeRate:0.05,sellerFixedFee:1000,outboundShipping:2000,newPointsExpected:1000,quantity:2,basis:[],assumptions:['Scenario inputs']};
const seed={kreamId:'123',productUrl:'https://www.musinsa.com/products/456',model:'ABC',color:'BLACK',option:'L'};
function store(){const s=new TeamStore(fs.mkdtempSync(path.join(os.tmpdir(),'cream-team-test-')),{product:seed});s.data.ownerThreadId='owner';return s;}
test('spent points affect cash only; future points are not double-counted',()=>{const r=calculateScenario(input);assert.equal(r.perUnit.economicProfit,17500);assert.equal(r.perUnit.cashProfit,27500);assert.equal(r.totalEconomicProfit,35000);});
test('unknown fees do not silently become zero',()=>{const r=calculateScenario({...input,sellerFeeRate:null});assert.equal(r.totalEconomicProfit,null);assert.ok(r.missing.includes('sellerFeeRate'));});
test('invalid financial inputs are rejected',()=>{assert.throws(()=>calculateScenario({...input,existingPointsSpent:100001}),/POINTS/);assert.throws(()=>calculateScenario({...input,sellerFeeRate:5}),/FEE/);assert.throws(()=>calculateScenario({...input,salePrice:NaN}),/NUMBER/);});
test('AI adoption is retained independently of profitability thresholds, with evidence gaps visible',()=>{
  const s=store(),o=s.observe('no1_product',{missingFields:['actualCheckoutPrice'],upstreamFreshnessConfirmed:false});
  const proposal={decision:'adopt',reason:'Worth further research',basis:[o.id],unresolved:[]};
  s.data.reviews.push({id:'r',threadId:'reviewer',basis:s.basis(),proposalHash:proposalHash(proposal),verdict:'pass'});
  const result=publishAssessment(s,{...proposal,reviewId:'r'},'owner');
  assert.equal(result.decision,'adopt');assert.equal(result.readiness,'research_only');assert.equal(result.confirmedProfit,null);assert.equal(result.purchaseAuthorized,false);assert.ok(result.unresolved.includes('actualCheckoutPrice'));
});
test('stale review and self-review cannot publish a decision',()=>{
  const s=store(),o=s.observe('test',{}),args={decision:'hold',reason:'Missing',basis:[o.id],unresolved:[],reviewId:'r'};
  s.data.reviews.push({id:'r',threadId:'owner',basis:s.basis(),proposalHash:proposalHash(args),verdict:'pass'});assert.throws(()=>publishAssessment(s,args,'owner'),/INDEPENDENT/);
  s.data.reviews[0].threadId='reviewer';s.observe('new',{});assert.throws(()=>publishAssessment(s,args,'owner'),/INDEPENDENT/);
  assert.throws(()=>publishAssessment(s,args,'worker'),/ONLY_PRODUCT_OWNER/);
});
test('persisted state and observation IDs survive restart',()=>{const s=store(),o=s.observe('test',{value:12});const restored=new TeamStore(s.dir);assert.equal(restored.read(o.id).payload.value,12);assert.equal(s.basis(),restored.basis());});
test('replayed evidence cannot be labelled live',async()=>{
  const s=store(),t=new TeamTools(s,{replay:{request:seed,missingFields:[]}});
  const r=await t.execute({tool:'collect_no1',threadId:'owner',arguments:{refreshReason:''}});
  assert.equal(r.mode,'replay');assert.ok(evidenceGaps(s).includes('LIVE_PRODUCT_EVIDENCE_MISSING'));
});
test('concurrent requests share one background product query and cached evidence',async()=>{
  const s=store(),t=new TeamTools(s);let count=0;
  t.collect=async()=>{count++;await new Promise(r=>setTimeout(r,10));return s.observe('no1_product',{request:seed});};
  const p={tool:'collect_no1',threadId:'worker',arguments:{refreshReason:''}};
  const [a,b]=await Promise.all([t.execute(p),t.execute(p)]);assert.equal(count,1);assert.equal(a.id,b.id);
  await t.execute(p);assert.equal(count,1);
});
test('reviewer cannot call a collection tool or impersonate the owner',async()=>{
  const s=store();s.data.actors.push({threadId:'audit',role:'reviewer'});const t=new TeamTools(s);
  await assert.rejects(()=>t.execute({tool:'collect_no1',threadId:'audit',arguments:{refreshReason:''}}),/READ_ONLY/);
  await assert.rejects(()=>t.execute({tool:'request_review',threadId:'worker',arguments:{question:'x'}}),/ONLY_OWNER/);
});
test('STOP is checked before external calls',async()=>{const s=store(),t=new TeamTools(s,{stopCheck:()=>true});await assert.rejects(()=>t.execute({tool:'collect_no1',threadId:'owner',arguments:{}}),/STOP_REQUESTED/);});
test('review ID binds the current immutable evidence set',async()=>{
  const s=store(),o=s.observe('test',{value:1});s.data.actors.push({threadId:'audit',role:'reviewer',proposalHash:'proposal',reviewBasis:s.basis(),requiredReads:[o.id]});const t=new TeamTools(s);
  await assert.rejects(()=>t.execute({tool:'record_review',threadId:'audit',arguments:{verdict:'pass',issues:[],basis:[o.id]}}),/READ_ORIGINALS/);
  await t.execute({tool:'read_observation',threadId:'audit',arguments:{id:o.id}});
  const review=await t.execute({tool:'record_review',threadId:'audit',arguments:{verdict:'pass',issues:[],basis:[o.id]}});
  assert.equal(review.basis,s.basis());assert.equal(review.threadId,'audit');
});
test('the owner cannot change the reviewed proposal while reusing its review ID',()=>{
  const s=store(),o=s.observe('test',{}),p={decision:'hold',reason:'Insufficient evidence',basis:[o.id],unresolved:['cost unknown']};
  s.data.reviews.push({id:'r',threadId:'audit',basis:s.basis(),proposalHash:proposalHash(p),verdict:'pass'});
  assert.throws(()=>publishAssessment(s,{...p,decision:'adopt',reviewId:'r'},'owner'),/INDEPENDENT/);
});
test('imported packet timestamps are preserved rather than made fresh by loading',()=>{
  const s=store(),old='2020-01-01T00:00:00.000Z';s.observe('no1_product',{missingFields:[],upstreamFreshnessConfirmed:true},{observedAt:old});
  assert.equal(s.data.observations[0].observedAt,old);assert.ok(evidenceGaps(s).includes('OBSERVATION_STALE'));
});
test('synthetic packets cannot trigger a live investigation',async()=>{
  const t=new TeamTools(store(),{offline:true});
  await assert.rejects(()=>t.execute({tool:'investigate',threadId:'owner',arguments:{operation:'market_page',arguments:'{"pid":"123"}'}}),/OFFLINE_PACKET/);
});
test('a login redirect is classified as authentication, never as a product mismatch',()=>{
  assert.throws(()=>assertMarketIdentity({url:'https://kream.co.kr/login?returnUrl=/products/123'},'123'),/KREAM_LOGIN_REQUIRED/);
  assert.throws(()=>assertMarketIdentity({url:'https://example.org/login'},'123'),/KREAM_PRODUCT_URL_MISMATCH/);
});
test('a superseded packet remains readable but cannot support a new assessment',()=>{
  const s=store(),old=s.observe('no1_product',{missingFields:['old_gap']});old.active=false;
  s.observe('no1_product',{missingFields:[],upstreamFreshnessConfirmed:true});
  assert.equal(s.read(old.id).active,false);assert.ok(!evidenceGaps(s).includes('old_gap'));
  const p={decision:'hold',reason:'Old basis',basis:[old.id],unresolved:[]};
  assert.throws(()=>publishAssessment(s,{...p,reviewId:'r'},'owner'),/SUPERSEDED/);
});
