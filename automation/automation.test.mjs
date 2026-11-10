import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {teamFixture} from '../renew/Cream/kream-tools/tests/team-fixture.mjs';
import {runAgents} from '../renew/Cream/kream-tools/agents-run.mjs';
import {readJson,writeJson} from '../renew/Cream/kream-tools/agents-core.mjs';
import {claudeModelForRole,invokeClaude} from '../renew/Cream/kream-tools/agents-claude.mjs';
import {buildAutomationReport} from './report.mjs';
import {findBundledCodex} from './codex-cli.mjs';
import {splitIds,remainingHourlyPages,aggregateBatchReports} from './batches.mjs';

const approve = async ({rows}) => ({findings:rows.map(row => ({id:row.id,action:'none',reason:'no additional issue'}))});
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'cream-automation-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  return teamFixture(dir);
}

test('efficient strategy keeps six rule roles and calls only needed model roles',async t => {
  const f = fixture(t),calls=[];
  const result = await runAgents(f.dir,{now:f.now,runId:'efficient',roleAi:true,efficientAi:true,
    providerId:'mock-claude',modelForRole:claudeModelForRole,roleProvider:async request => {calls.push(request.role);return approve(request);}});
  assert.equal(result.final.meta.에이전트팀.complete,true);
  assert.deepEqual(calls,['offer_verifier','final_auditor']);
  assert.equal(readJson(f.dir,'agents-team-ai.json').calls,2);
  assert.equal(result.final.rows[0]['판정'],'후보');
});

test('efficient strategy spends no model calls on an empty shortlist',async t => {
  const f = fixture(t);
  writeJson(f.dir,'k50.json',[]);
  const result = await runAgents(f.dir,{now:f.now,runId:'empty',roleAi:true,efficientAi:true,
    roleProvider:() => assert.fail('no model call expected')});
  assert.equal(result.final.meta.에이전트팀.complete,true);
  assert.equal(readJson(f.dir,'agents-team-ai.json').calls,0);
});

test('No1 evidence is required, fresh, option matched, and cannot promote a failed base decision',async t => {
  const f = fixture(t);
  await runAgents(f.dir,{now:f.now,runId:'no1',roleAi:true,efficientAi:true,roleProvider:approve});
  const missing = buildAutomationReport(f.dir,{now:f.now,xlsx:false});
  assert.equal(missing.summary.candidate,0);
  assert.deepEqual(missing.rows[0].reasons,['NO1_OBSERVATION_MISSING']);
  const observation = {kreamId:'123',size:'S',capturedAt:f.now,dataAsOf:f.now,sourceUrl:f.offer.url,
    kreamModel:f.offer.model,sourceModel:f.offer.model,kreamColor:'BLACK',sourceColor:'BLACK',
    sameSizeTrades30d:5,sourceStock:2,checkoutCost:120000,conditionalDiscount:false,instantBid:200000};
  writeJson(f.dir,'no1-observations.json',{version:'no1-observations-v1',items:[observation]});
  const good = buildAutomationReport(f.dir,{now:f.now,xlsx:false});
  assert.equal(good.summary.candidate,1);
  assert.ok(good.rows[0].instantProfit > 0);
  buildAutomationReport(f.dir,{now:f.now});
  assert.equal(fs.readFileSync(path.join(f.dir,'automation-final.xlsx')).subarray(0,2).toString(),'PK');
  assert.match(fs.readFileSync(path.join(f.dir,'automation-report.html'),'utf8'),/후보 1/);
  const stale = buildAutomationReport(f.dir,{now:'2026-11-08T03:11:00.000Z',xlsx:false});
  assert.equal(stale.summary.candidate,0);
  assert.ok(stale.rows[0].reasons.includes('NO1_STALE'));
  observation.dataAsOf = new Date(Date.parse(f.now)-11*60000).toISOString();
  writeJson(f.dir,'no1-observations.json',{version:'no1-observations-v1',items:[observation]});
  const oldScreenData = buildAutomationReport(f.dir,{now:f.now,xlsx:false});
  assert.equal(oldScreenData.summary.candidate,0);
  assert.ok(oldScreenData.rows[0].reasons.includes('NO1_STALE'));
  observation.dataAsOf = f.now;
  observation.checkoutCost = 119000;
  writeJson(f.dir,'no1-observations.json',{version:'no1-observations-v1',items:[observation]});
  const differentCost = buildAutomationReport(f.dir,{now:f.now,xlsx:false});
  assert.ok(differentCost.rows[0].reasons.includes('NO1_COST_DIFFERENT'));
  observation.checkoutCost = 120000;
  observation.conditionalDiscount = true;
  writeJson(f.dir,'no1-observations.json',{version:'no1-observations-v1',items:[observation]});
  const discount = buildAutomationReport(f.dir,{now:f.now,xlsx:false});
  assert.ok(discount.rows[0].reasons.includes('NO1_COST_UNCONFIRMED'));
});

test('automation output retains excluded products without audited options',t => {
  const f=fixture(t);
  writeJson(f.dir,'audit.json',{items:[]});
  writeJson(f.dir,'final-all.json',{rows:[{'크림ID':'123','상품명':'파타고니아 플리스','모델번호':'25551','판정':'제외','사유':'상품 불일치'}]});
  const report=buildAutomationReport(f.dir,{now:f.now,xlsx:false});
  assert.equal(report.summary.total,1);
  assert.equal(report.summary.excluded,1);
  assert.match(fs.readFileSync(path.join(f.dir,'automation-report.html'),'utf8'),/상품 불일치/);
});

test('Claude route and structured response record real token usage',async () => {
  assert.equal(claudeModelForRole('offer_verifier',[]),'claude-haiku-5-5');
  assert.equal(claudeModelForRole('final_auditor',[{risk:[{pts:7}]}]),'claude-opus-5-5');
  let body;
  const output = await invokeClaude({role:'offer_verifier',rows:[{id:'x'}]}, {apiKey:'test-key',
    fetchImpl:async (_url,request) => {body=JSON.parse(request.body);return {ok:true,json:async()=>({stop_reason:'end_turn',model:'claude-haiku-5-5',
      content:[{type:'text',text:JSON.stringify({findings:[{id:'x',action:'none',reason:'ok'}]})}],usage:{input_tokens:100,output_tokens:20}})};}});
  assert.equal(body.output_config.format.type,'json_schema');
  assert.equal(output._usage.input_tokens,100);
  assert.equal(output._usage.output_tokens,20);
});

test('Codex CLI is found inside the installed VS Code extension when PATH is missing',t => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'cream-codex-home-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const executable=path.join(home,'.vscode','extensions','openai.chatgpt-26.1','bin','windows-x86_64','codex.exe');
  fs.mkdirSync(path.dirname(executable),{recursive:true});
  fs.writeFileSync(executable,'test');
  assert.equal(findBundledCodex([home]),executable);
});

test('daily product IDs are screened in small independent batches',t => {
  assert.deepEqual(splitIds(['1','2','3','4','5','6'],5),[['1','2','3','4','5'],['6']]);
  assert.throws(()=>splitIds(['1','1'],5),/unique/);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cream-batches-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const batchDir=path.join(dir,'batches','batch-001-attempt-01');
  const at='2026-11-09T06:00:00.000Z';
  writeJson(batchDir,'automation-final.json',{summary:{aiUsage:[],no1Observations:0},rows:[
    {kreamId:'1',status:'excluded',reasons:['MODEL_MISMATCH']},
    {kreamId:'2',size:'M',sourceUrl:'https://shop.example/a',status:'candidate',capturedAt:at,dataAsOf:at,reasons:[]}]});
  const manifest={ids:['1','2','3','4','5','6'],batches:[{index:1,ids:['1','2','3','4','5'],status:'done',dir:batchDir},
    {index:2,ids:['6'],status:'pending',dir:null}]};
  const report=aggregateBatchReports(dir,manifest,{xlsx:false,now:at});
  assert.equal(report.summary.productsProcessed,5);
  assert.equal(report.summary.productsTarget,6);
  assert.equal(report.summary.excluded,1);
  assert.equal(report.summary.hold,1);
  assert.ok(report.rows[1].reasons.includes('DOT_REVIEW_MISSING'));
  assert.equal(report.rows[0].batch,1);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir,'dot-screening-queue.json'),'utf8')).items.some(item=>item.kreamId==='1'));
  writeJson(dir,'dot-screening-batch-001.json',{items:[{kreamId:'2',size:'M',sourceUrl:'https://shop.example/b',independentDecision:'clear',promotionAllowed:true,evidence:['dump-K2.json']}]});
  assert.equal(aggregateBatchReports(dir,manifest,{xlsx:false,now:at}).summary.candidate,0);
  writeJson(dir,'dot-screening-batch-001.json',{items:[{kreamId:'2',size:'M',sourceUrl:'https://shop.example/a',independentDecision:'clear',promotionAllowed:true,evidence:['dump-K2.json']}]});
  assert.equal(aggregateBatchReports(dir,manifest,{xlsx:false,now:at}).summary.candidate,1);
  fs.writeFileSync(path.join(dir,'dump-test.json'),'{}');
  assert.equal(remainingHourlyPages(dir).used,1);
});
