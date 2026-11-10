import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {BackgroundClient} from '../no1-background/client.mjs';
import {validatePacket} from './packets.mjs';
import {writeJsonAtomic} from './atomic-json.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const runId=process.argv.find(x=>x.startsWith('--run='))?.slice(6);
if(!/^batch-[a-f0-9-]{36}$/.test(runId||''))throw Error('Use --run=<real batch id>');
const dir=path.join(root,'kream-runs','agent-teams',runId),read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
const batch=read('batch-result.json');assert.equal(batch.mode,'live');assert.equal(batch.status,'complete');assert.ok(batch.productCount>=2);assert.equal(batch.judged,batch.productCount);
const events=fs.readFileSync(path.join(dir,'runtime.log'),'utf8').split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
const barrier=events.findIndex(x=>x.type==='all_products_collected');
assert.ok(barrier>=0&&barrier<events.findIndex(x=>x.type==='product_judgment_started'),'All product collection must precede first judgment');
const products=batch.results.map(row=>{
 const packet=validatePacket(read(`packets/product-${row.productId}.json`)),team=read(`judgments/${row.productId}/team-state.json`);
 assert.equal(team.status,'complete');assert.equal(team.packetId,packet.id);assert.equal(team.packetMode,'live');
 assert.ok(packet.observations.every(x=>x.mode==='live'));
 const review=team.reviews.find(x=>x.id===team.assessment.reviewId);assert.equal(review?.verdict,'pass');assert.notEqual(review.threadId,team.ownerThreadId);
 assert.equal(team.assessment.confirmedProfit,null);assert.equal(team.assessment.purchaseAuthorized,false);
 const p=packet.observations.find(x=>x.kind==='no1_product')?.payload;assert.equal(p.queryStatus,'complete');
 assert.ok(p.marketResearch?.trades?.coverageComplete);assert.ok(p.marketResearch?.settlement?.length);
 return {productId:row.productId,model:p.request.model,color:p.request.color,option:p.request.option,decision:team.assessment.decision,
  independentReview:{model:review.model,verdict:review.verdict},transactions30d:p.marketResearch.trades.transactions30d,selectedTransactions30d:p.marketResearch.trades.selectedTransactions30d,
  recoveredMissingRollout:team.events.some(x=>x.type==='owner_thread_recovery'),reason:team.assessment.reason,unresolved:team.assessment.unresolved};
});
const no1=await new BackgroundClient().status();
const config=JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA,'CreamDotBridge','connection.json'),'utf8'));
const headers={'content-type':'application/json','OAI-Sites-Authorization':'Bearer '+config.serviceToken,'x-cream-bridge-key':config.bridgeKey};
async function rpc(method,params={}){
 const r=await fetch(config.origin+'/bridge/check',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});
 assert.equal(r.status,200);const j=await r.json();assert.ok(!j.error&&!j.result?.isError);return j.result;
}
const inventory=await rpc('events/list');assert.ok(inventory.events.some(x=>x.name==='cream.batch.finished'));
const state=(await rpc('tools/call',{name:'cream_connection_status',arguments:{}})).structuredContent;
assert.equal(state.online,true);
const remoteBatch=(await rpc('tools/call',{name:'cream_batch_status',arguments:{runId}})).structuredContent;
assert.equal(remoteBatch.status,'complete');assert.equal(remoteBatch.judged,batch.productCount);
const result={at:new Date().toISOString(),runId,liveProductJudgmentsVerified:true,allProductsCollectedBeforeJudgment:true,products,
 scope:'Two color variants of one base model; not a catalog-wide profitability claim',
 no1:{browserConnected:no1.browserConnected,connectorVersion:no1.connectorVersion},
 dot:{origin:config.origin,readOnlyRemoteRoundTripVerified:true,eventAdvertised:true,events:state.events,nativeFollowUp:'not_observed_by_this_check',uiVerification:'deferred_by_user'},
 notConfirmed:['Actual checkout eligibility and final price','Inbound/outbound shipping and upstream update timestamp','Native Dot event-triggered next action and recurring operation'],
 noCollectionOrAiInvoked:true};
writeJsonAtomic(path.join(root,'kream-runs','agent-team-readiness','validation.json'),result);
console.log(JSON.stringify({at:result.at,runId,products:products.map(p=>({id:p.productId,decision:p.decision,independentReview:p.independentReview})),no1:result.no1,dot:result.dot,noCollectionOrAiInvoked:true}));
