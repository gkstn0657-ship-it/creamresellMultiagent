import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {context,readJson,writeJson} from '../agents-core.mjs';
import {AGENT_ROLES} from '../agents-lifecycle.mjs';
import {roleDefinition,runRoleAi,safeChecks} from '../agents-team.mjs';
import {runAgents,prepareAgentTeam} from '../agents-run.mjs';
import {teamFixture} from './team-fixture.mjs';
const ok=async ({rows})=>({findings:rows.map(r=>({id:r.id,action:'none',reason:'추가 지적 없음'}))});
function fixture(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cream-team-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return teamFixture(dir);}
test('root definitions load six distinct roles with Sol High',()=>{
  assert.equal(AGENT_ROLES.length,6);
  for(const [role,name] of AGENT_ROLES) {const def=roleDefinition(role);assert.equal(def.name,name);const source=fs.readFileSync(def.file,'utf8');assert.match(source,/model = "gpt-6.1-sol"/);assert.match(source,/model_reasoning_effort = "high"/);}
});
test('all six workers execute and hand off without dropping a verified candidate',async t=>{
  const f=fixture(t),roles=[];
  const result=await runAgents(f.dir,{now:f.now,runId:'team-complete',roleAi:true,roleProvider:async req=>{roles.push(req.role);const input=JSON.stringify(req);assert.doesNotMatch(input,/시험상점|123-45-67890|https:\/\//);return ok(req);}});
  assert.equal(new Set(roles).size,6);assert.equal(roles.length,6);
  assert.equal(result.final.meta.에이전트팀.complete,true);
  assert.equal(result.final.rows.filter(r=>r['판정']==='후보').length,1);
  const state=readJson(f.dir,'agents-execution.json');assert.equal(Object.keys(state.roles).length,6);
  for(const entry of Object.values(state.roles)){assert.equal(entry.rules,'done');assert.equal(entry.ai,'done');}
  assert.equal(readJson(f.dir,'outcomes.json').snapshots.length,1);
});
test('cache reuse does not contaminate seller rules or skip mandatory role accounting',async t=>{
  const f=fixture(t);let calls=0;const opts={now:f.now,runId:'repeat',roleAi:true,roleProvider:async req=>{calls++;return ok(req);}};
  await runAgents(f.dir,opts);const first=calls;const result=await runAgents(f.dir,opts);
  // Outcome summary changes after the first snapshot; other unchanged roles reuse cache.
  assert.ok(calls<=first+1);assert.equal(result.final.rows[0]['판정'],'후보');assert.equal(result.final.meta.에이전트팀.complete,true);
});
test('any worker failure holds candidates and is reported as incomplete',async t=>{
  const f=fixture(t);const r=await runAgents(f.dir,{now:f.now,roleAi:true,roleProvider:async req=>{if(req.role==='outcome_tracker')throw Error('unavailable');return ok(req);}});
  assert.equal(r.final.meta.에이전트팀.complete,false);assert.equal(readJson(f.dir,'agent-state.json').status,'needs-attention');
  assert.equal(r.final.rows.filter(r=>r['판정']==='후보').length,0);assert.match(r.final.rows[0]['검증사유코드'],/AGENT_TEAM_INCOMPLETE/);
  assert.notEqual(readJson(f.dir,'outcomes.json').snapshots[0].decision,'후보');
});
test('global AI budget is enforced across roles and malformed replies fail closed',async t=>{
  const f=fixture(t);writeJson(f.dir,'agent-policy.json',{maxRoleAiCalls:1});const ctx=context(f.dir,{now:f.now});let calls=0;
  await runRoleAi(ctx,'error_manager',[{id:'a',status:'OK'}],{roleProvider:async r=>{calls++;return ok(r);}});
  const r=await runRoleAi(ctx,'offer_verifier',[{id:'b',status:'verified'}],{roleProvider:()=>assert.fail('budget')});assert.equal(calls,1);assert.equal(r.errors.length,1);
  const bad=await runRoleAi(context(f.dir,{now:f.now,runId:'other'}),'seller_verifier',[{id:'b'}],{roleProvider:async()=>({findings:[]})});assert.equal(bad.errors.length,1);
});
test('offline replay invokes no worker and records all six as disabled_replay',async t=>{
  const f=fixture(t);const r=await runAgents(f.dir,{now:f.now,roleAi:true,replay:true,roleProvider:()=>assert.fail('offline')});
  assert.equal(r.final.meta.에이전트팀.complete,false);assert.ok(r.final.meta.에이전트팀.roles.every(x=>x.ai==='disabled_replay'&&x.rules==='done'));assert.equal(r.final.meta.에이전트팀.calls,0);
});
test('freshness is checked after outcome AI, and changed source invalidates earlier approval',async t=>{
  const f=fixture(t);let clock=f.now;
  const r=await runAgents(f.dir,{now:f.now,clock:()=>clock,roleAi:true,roleProvider:async req=>{if(req.role==='outcome_tracker')clock='2026-11-08T03:11:00.000Z';return ok(req);}});
  assert.equal(r.final.rows[0]['판정'],'사람 검토');assert.match(r.final.rows[0]['검증사유코드'],/OFFER_STALE/);
});
test('same-time price or market edits during model calls require a fresh review',async t=>{
  const f=fixture(t);
  const r=await runAgents(f.dir,{now:f.now,roleAi:true,roleProvider:async req=>{if(req.role==='outcome_tracker'){const d=readJson(f.dir,'dump-K123.json');d.text=d.text.replaceAll('200,000','220,000');writeJson(f.dir,'dump-K123.json',d);}return ok(req);}});
  assert.equal(r.final.rows[0]['판정'],'사람 검토');assert.match(r.final.rows[0]['검증사유코드'],/LLM_INCOMPLETE/);
});
test('seller AI excludes stay excluded and are not cached as deterministic truth',async t=>{
  const f=fixture(t);const r=await runAgents(f.dir,{now:f.now,roleAi:true,roleProvider:async req=>({findings:req.rows.map(row=>({id:row.id,action:req.role==='seller_verifier'?'exclude':'none',reason:'시험 제한'}))})});
  assert.equal(r.final.rows[0]['판정'],'제외');assert.equal(readJson(f.dir,'seller-rules-cache.json').items[0].status,'verified');
});
test('source fallback respects its AI worker hold before creating collection work',async t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.dir,f.file));
  const result=await prepareAgentTeam(f.dir,{now:f.now,roleProvider:async req=>({findings:req.rows.map(row=>({id:row.id,action:req.role==='source_fallback'?'hold':'none',reason:'대체 탐색 추가 확인'}))})});
  assert.equal(result.fallback.jobs.length,0);assert.equal(result.fallback.items[0].status,'held-by-ai');
});
test('safe summaries change when evidence changes but ignore cache bookkeeping',()=>{
  assert.deepEqual(safeChecks([{id:'x',cached:false}]),safeChecks([{id:'x',cached:true}]));
  assert.notDeepEqual(safeChecks([{id:'x',cost:100}]),safeChecks([{id:'x',cost:101}]));
});
