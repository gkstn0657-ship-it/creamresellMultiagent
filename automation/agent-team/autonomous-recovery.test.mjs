import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';
import {TeamStore,proposalHash} from './store.mjs';import {TeamTools} from './tools.mjs';import {runTeam} from './run.mjs';
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cream-auto-recovery-')),mission={product:{kreamId:'123'}};const s=new TeamStore(dir,mission),o=s.observe('fixture',{unknown:true},{mode:'fixture'}),proposal={decision:'hold',reason:'Evidence is incomplete',basis:[o.id],unresolved:['FIXTURE']};s.data.ownerThreadId='owner';s.data.reviews.push({id:'review',threadId:'independent-reviewer',verdict:'pass',basis:s.basis(),proposalHash:proposalHash(proposal),proposal});s.save();return {dir,mission,s,proposal};}
test('exact reviewed publication preserves the decision and all review checks',async()=>{const {s}=fixture(),tools=new TeamTools(s);const invoke=()=>tools.execute({threadId:'owner',tool:'publish_reviewed_assessment',arguments:{reviewId:'review'}});
 s.data.reviews[0].verdict='rework';await assert.rejects(invoke(),/INDEPENDENT_CURRENT/);s.data.reviews[0].verdict='pass';
 s.data.reviews[0].proposal.reason='Tampered';await assert.rejects(invoke(),/INDEPENDENT_CURRENT/);s.data.reviews[0].proposal.reason='Evidence is incomplete';
 const result=await invoke();assert.equal(result.decision,'hold');assert.equal(result.purchaseAuthorized,false);
 s.observe('new',{});await assert.rejects(invoke(),/INDEPENDENT_CURRENT/);
});
test('incomplete owner autonomously hands off to strong model and publishes independently reviewed result',async()=>{const {dir,mission,s}=fixture();s.data.ownerThreadId=null;s.save();let opts,turns=0;const models=[];
 class Fake extends EventEmitter{config={};async start(){}async close(){}async startThread(o){models.push(o.model);return {thread:{id:'owner-'+models.length}};}async runTurn(id,message){turns++;if(turns===1)return;assert.equal(JSON.parse(message).task,'AUTONOMOUS_RECOVERY');await opts.onTool({threadId:id,tool:'publish_reviewed_assessment',arguments:{reviewId:'review'}});}}
 const result=await runTeam({dir,mission,serverFactory:o=>{opts=o;return new Fake();}});assert.equal(result.status,'complete');assert.equal(result.assessment.decision,'hold');assert.deepEqual(models,['gpt-6-luna','gpt-6.1-sol']);assert.ok(result.events.some(e=>e.type==='autonomous_recovery_started'));
});
test('autonomous repair is bounded and STOP prevents further turns',async()=>{
 for(const stop of [false,true]){const {dir,mission,s}=fixture();s.data.ownerThreadId=null;s.save();let turns=0,threads=0;
 class Fake extends EventEmitter{config={};async start(){}async close(){}async startThread(){return {thread:{id:'owner-'+(++threads)}};}async runTurn(){turns++;if(stop)fs.writeFileSync(path.join(dir,'STOP'),'stop');}}
 await assert.rejects(runTeam({dir,mission,serverFactory:()=>new Fake()}),stop?/STOP_REQUESTED/:/ASSESSMENT_NOT_COMPLETE/);assert.equal(turns,stop?1:3);
 }
});
