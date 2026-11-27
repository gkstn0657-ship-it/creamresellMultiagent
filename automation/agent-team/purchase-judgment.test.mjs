import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {TeamStore} from './store.mjs';
import {PurchaseJudge,purchaseJudgmentCurrent} from './purchase-judgment.mjs';
import {runTeam} from './run.mjs';

function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'purchase-judge-'));
 const store=new TeamStore(dir,{product:{kreamId:'123',model:'KC9299'}});
 const obs=store.observe('fixture',{size:'M',trades30d:2,trades7d:0,liquidationLoss:10330});
 store.data.reviews.push({id:'review',verdict:'pass',basis:store.basis()});
 store.data.assessment={id:'assessment',decision:'adopt',reason:'Conditional research candidate',reviewId:'review',evidenceBasis:store.basis(),purchaseAuthorized:false};store.save();
 return {dir,store,obs};
}
const decision=id=>({decision:'do_not_buy',reason:'Recent sales are sparse and immediate liquidation loses money.',risks:['Inventory may remain unsold'],reconsiderWhen:['Recent option-specific profitable trades recover'],basis:[id]});

test('final agent must read originals, cannot collect, and persists separate advisory verdict',async()=>{
 const {store,obs}=fixture(),judge=new PurchaseJudge(store);let turns=0;
 const server={startThread:async c=>{assert.equal(c.config['agents.enabled'],false);assert.equal(c.tools.length,2);return {thread:{id:'judge'}};},runTurn:async()=>{
  turns++;assert.throws(()=>judge.execute({tool:'collect_no1'}),/READ_ONLY/);
  assert.throws(()=>judge.execute({tool:'record_purchase_judgment',arguments:decision(obs.id)}),/READ_ORIGINALS/);
  assert.equal(judge.execute({tool:'read_purchase_evidence'}).remaining,0);
  judge.execute({tool:'record_purchase_judgment',arguments:decision(obs.id)});
 }};
 await judge.run(server,()=>({}),()=>{},()=>{});
 assert.equal(store.data.assessment.decision,'adopt');
 assert.equal(store.data.assessment.purchaseJudgment.decision,'do_not_buy');
 assert.equal(store.data.assessment.purchaseJudgment.purchaseAuthorized,false);
 await judge.run(server,()=>({}),()=>{},()=>{});assert.equal(turns,1);
 store.data.assessment.reason='Changed';assert.equal(purchaseJudgmentCurrent(store.data.assessment),false);
 assert.throws(()=>judge.execute({tool:'record_purchase_judgment',arguments:decision(obs.id)}),/BASIS_CHANGED/);
});

test('runTeam resumes at final agent without repeating owner/reviewer; completed verdict is reusable',async()=>{
 const {dir,obs}=fixture();let opts,starts=0;
 class Server extends EventEmitter{
  config={};async start(){}async close(){}
  async startThread(){starts++;return {thread:{id:'judge'}};}
  async runTurn(id){await opts.onTool({threadId:id,tool:'read_purchase_evidence'});await opts.onTool({threadId:id,tool:'record_purchase_judgment',arguments:decision(obs.id)});}
 }
 const factory=o=>{opts=o;return new Server();};
 const result=await runTeam({dir,resume:true,serverFactory:factory});
 assert.equal(result.status,'complete');assert.equal(result.assessment.purchaseJudgment.decision,'do_not_buy');
 await runTeam({dir,resume:true,serverFactory:factory});assert.equal(starts,1);
});

test('missing final verdict cannot be recovered as complete just because owner published adopt',async()=>{
 const {dir}=fixture();let turns=0;
 class Server extends EventEmitter{config={};async start(){}async close(){}async startThread(){return {thread:{id:'judge'}};}async runTurn(){turns++;}}
 await assert.rejects(runTeam({dir,resume:true,serverFactory:()=>new Server()}),/PURCHASE_JUDGMENT_NOT_RECORDED/);
 assert.equal(turns,2);assert.equal(new TeamStore(dir).data.status,'needs_attention');
});

test('stopped runs never launch purchasing judge',async()=>{
 const {dir}=fixture();fs.writeFileSync(path.join(dir,'STOP'),'');
 class Server extends EventEmitter{config={};async close(){}async startThread(){assert.fail('must not start');}}
 await assert.rejects(runTeam({dir,resume:true,serverFactory:()=>new Server()}),/STOP_REQUESTED/);
});

test('large originals are read in bounded pages and cannot be approved after the first chunk',async()=>{
 const {store,obs}=fixture();obs.payload.large='x'.repeat(40000);store.save();
 const judge=new PurchaseJudge(store);let chunks=0;
 await judge.run({startThread:async()=>({thread:{id:'judge'}}),runTurn:async()=>{
  let page;do{page=judge.execute({tool:'read_purchase_evidence'});chunks++;assert.ok(page.content.length<=12000);
   if(page.remaining)assert.throws(()=>judge.execute({tool:'record_purchase_judgment',arguments:decision(obs.id)}),/READ_ORIGINALS/);
  }while(page.remaining);
  judge.execute({tool:'record_purchase_judgment',arguments:decision(obs.id)});
 }},()=>({}),()=>{},()=>{});
 assert.equal(chunks,4);assert.equal(store.data.assessment.purchaseJudgment.version,2);
});
