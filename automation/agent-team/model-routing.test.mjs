import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultModel,modelConfig,reviewSelection,queueUpgrade} from './model-routing.mjs';
test('only measured models are allowed; independent review keeps its stronger floor',()=>{
 assert.deepEqual(defaultModel('owner'),{model:'gpt-6-luna',effort:'medium'});
 assert.throws(()=>modelConfig({model:'invented',effort:'high'}),/NOT_ALLOWED/);
 assert.throws(()=>defaultModel('invented'),/NOT_ALLOWED/);
 assert.equal(reviewSelection({decision:'hold'}).model,'gpt-6-luna');
 for(const [proposal,context] of [[{decision:'adopt'},{}],[{decision:'hold'},{needsDeepReview:true}],[{decision:'hold'},{reworkCount:1}]]){
  assert.equal(reviewSelection(proposal,context).model,'gpt-6.1-sol');
  assert.equal(reviewSelection(proposal,context).effort,'high');
 }
});
test('upgrade requires real evidence and can occur only once without resetting saved work',()=>{
 const state={observations:['original'],toolCalls:7},args={reason:'Conflicting original evidence requires deeper reasoning',evidenceIds:['original']};
 assert.throws(()=>queueUpgrade(state,'reviewer',args),/ROLE_FORBIDDEN/);
 assert.throws(()=>queueUpgrade(state,'owner',{...args,evidenceIds:[]}),/EVIDENCE_REQUIRED/);
 assert.throws(()=>queueUpgrade(state,'owner',args,{readEvidence:()=>{throw Error('UNKNOWN');}}),/UNKNOWN/);
 assert.equal(state.modelUpgradeCount,undefined);
 assert.equal(queueUpgrade(state,'owner',args,{readEvidence:id=>assert.equal(id,'original')}).accepted,true);
 assert.equal(state.pendingModelUpgrade.model,'gpt-6.1-sol');
 assert.equal(state.toolCalls,7);assert.deepEqual(state.observations,['original']);
 assert.throws(()=>queueUpgrade(state,'owner',args),/ALREADY_PENDING/);
 delete state.pendingModelUpgrade;
 assert.throws(()=>queueUpgrade(state,'owner',args),/UPGRADE_LIMIT/);
});
test('already strong coordinator does not spend an upgrade or downgrade',()=>{
 const state={};assert.equal(queueUpgrade(state,'coordinator',{reason:'Complex conflicting status needs stronger reasoning',evidenceIds:[]}).accepted,false);
 assert.equal(state.modelUpgradeCount,undefined);
});
