import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {TeamStore,proposalHash} from './store.mjs';import {TeamTools,reviewTools} from './tools.mjs';
function fixture(n=3){const s=new TeamStore(fs.mkdtempSync(path.join(os.tmpdir(),'cream-bulk-test-')),{product:{kreamId:'123'}});s.data.ownerThreadId='owner';for(let i=0;i<n;i++)s.observe('test',{nested:{original:i}},{observedAt:'2026-01-01T00:00:00Z'});const t=new TeamTools(s,{offline:true});return {s,t};}
const call=(t,tool,args={},threadId='audit')=>t.execute({tool,arguments:args,threadId});
function reviewer(s){const ids=[...s.data.observations,...s.data.calculations].map(x=>x.id),proposal={decision:'hold',reason:'Unverified option and checkout',basis:ids,unresolved:['actualCheckoutPrice']};s.data.actors.push({threadId:'audit',role:'reviewer',proposalHash:proposalHash(proposal),reviewBasis:s.basis(),requiredReads:ids});return {ids,proposal};}
test('29 originals and 35 owner calls finish review and publication in 40 calls',async()=>{
 const {s,t}=fixture(9);const basis=[s.data.observations[0].id];
 for(let i=0;i<20;i++)await call(t,'calculate_scenario',{purchaseBeforePoints:100,existingPointsSpent:0,inboundShipping:0,salePrice:90+i,sellerFeeRate:0.06,sellerFixedFee:0,outboundShipping:0,newPointsExpected:0,quantity:1,basis,assumptions:['fixture']},'owner');
 for(let i=0;i<15;i++)await call(t,'team_state',{},'owner');
 const {ids,proposal}=reviewer(s),returned=[];for(let i=0;i<ids.length;i+=10)returned.push(...await call(t,'read_observations',{ids:ids.slice(i,i+10)}));
 assert.deepEqual(returned,ids.map(id=>s.read(id)));assert.equal(returned[0].observedAt,'2026-01-01T00:00:00Z');
 const r=await call(t,'record_review',{verdict:'pass',issues:[],basis:ids});
 const a=await call(t,'publish_assessment',{...proposal,reviewId:r.id},'owner');assert.equal(a.decision,'hold');assert.equal(a.purchaseAuthorized,false);assert.equal(s.data.toolCalls,40);
 for(let i=0;i<10;i++)await call(t,'team_state',{},'owner');await assert.rejects(call(t,'team_state',{},'owner'),/TEAM_TOOL_BUDGET_REACHED/);
});
test('omitted original cannot pass review',async()=>{const {s,t}=fixture();const {ids}=reviewer(s);await call(t,'read_observations',{ids:ids.slice(1)});await assert.rejects(call(t,'record_review',{verdict:'pass',issues:[],basis:ids.slice(1)}),/REVIEW_MUST_READ_ORIGINALS/);});
test('bad IDs and invalid batches cannot partially credit reads',async()=>{const {s,t}=fixture();const {ids}=reviewer(s);for(const x of [[],[ids[0],ids[0]],Array(11).fill(ids[0]),[null],['']])await assert.rejects(call(t,'read_observations',{ids:x}),/OBSERVATION_BATCH_INVALID/);await assert.rejects(call(t,'read_observations',{ids:[ids[0],'missing']}),/OBSERVATION_NOT_FOUND/);assert.equal(t.reviewReads.get('audit'),undefined);await assert.rejects(call(t,'read_observations',{ids:[ids[0]],extra:true}),/OBSERVATION_BATCH_INVALID/);});
test('changed basis and changed proposal still block publication',async()=>{const {s,t}=fixture();const {ids,proposal}=reviewer(s);await call(t,'read_observations',{ids});const r=await call(t,'record_review',{verdict:'pass',issues:[],basis:ids});await assert.rejects(call(t,'publish_assessment',{...proposal,decision:'adopt',reviewId:r.id},'owner'),/INDEPENDENT_CURRENT_REVIEW_REQUIRED/);s.observe('new',{});await assert.rejects(call(t,'record_review',{verdict:'pass',issues:[],basis:ids}),/REVIEW_BASIS_CHANGED/);await assert.rejects(call(t,'publish_assessment',{...proposal,reviewId:r.id},'owner'),/INDEPENDENT_CURRENT_REVIEW_REQUIRED/);});
test('review tool schema is bounded and discovery keeps five products with two workers',()=>{const tool=reviewTools.find(t=>t.name==='read_observations');assert.equal(tool.inputSchema.properties.ids.maxItems,10);assert.equal(tool.inputSchema.properties.ids.uniqueItems,true);const source=fs.readFileSync(new URL('./exploration.mjs',import.meta.url),'utf8');assert.match(source,/Math.min\(5,remaining\)/);assert.match(source,/executeBatch\(\{seeds,dir:batchDir,concurrency:2/);});
