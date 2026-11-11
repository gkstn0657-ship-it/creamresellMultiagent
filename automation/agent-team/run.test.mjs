import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {runTeam,ensureReviewRecorded} from './run.mjs';
import {TeamStore} from './store.mjs';

test('missing review receives one tool reminder, but prose alone still fails',async()=>{
 const store=new TeamStore(fs.mkdtempSync(path.join(os.tmpdir(),'cream-review-reminder-')),{});
 let turns=0;const args={store,threadId:'reviewer',expectedBasis:store.basis(),server:{runTurn:async()=>{turns++;}}};
 await assert.rejects(ensureReviewRecorded(args),/REVIEW_NOT_RECORDED/);assert.equal(turns,1);
 args.server.runTurn=async()=>{turns++;store.data.reviews.push({threadId:'reviewer',basis:store.basis(),verdict:'pass'});};
 assert.equal((await ensureReviewRecorded(args)).verdict,'pass');assert.equal(turns,2);
 await ensureReviewRecorded(args);assert.equal(turns,2);
 store.data.reviews=[];store.observe('new',{});
 await assert.rejects(ensureReviewRecorded(args),/REVIEW_BASIS_CHANGED/);assert.equal(turns,2);
});

test('a timeout after a current-basis assessment was persisted remains complete',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cream-run-timeout-'));
  const mission={product:{kreamId:'123',productUrl:'https://www.musinsa.com/products/456',model:'ABC',color:'BLACK',option:'L'}};
  class FakeServer extends EventEmitter{
    config={};
    async start(){}
    async close(){}
    async startThread(){return {thread:{id:'owner'}};}
    async runTurn(){
      const saved=new TeamStore(dir,mission);
      saved.data.assessment={decision:'hold',readiness:'research_only',evidenceBasis:saved.basis()};
      saved.save();
      throw Error('CODEX_TURN_TIMEOUT');
    }
  }
  const result=await runTeam({dir,mission,serverFactory:()=>new FakeServer()});
  assert.equal(result.status,'complete');
  assert.equal(result.assessment.decision,'hold');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'team-state.json'),'utf8')).status,'complete');
});

test('resume reuses a persisted current-basis assessment without another turn',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cream-run-resume-'));
  const mission={product:{kreamId:'123',productUrl:'https://www.musinsa.com/products/456',model:'ABC',color:'BLACK',option:'L'}};
  const saved=new TeamStore(dir,mission);
  saved.data.status='needs_attention';
  saved.data.assessment={decision:'hold',readiness:'research_only',evidenceBasis:saved.basis()};
  saved.save();
  class FakeServer extends EventEmitter{
    config={};
    async close(){}
    async runTurn(){throw Error('MUST_NOT_RERUN');}
  }
  const result=await runTeam({dir,mission,resume:true,serverFactory:()=>new FakeServer()});
  assert.equal(result.status,'complete');
  assert.equal(result.assessment.decision,'hold');
});
