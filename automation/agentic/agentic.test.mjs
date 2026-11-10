import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { teamFixture } from '../../renew/Cream/kream-tools/tests/team-fixture.mjs';
import { readJson, writeJson, context, hash, sizeInQuote } from '../../renew/Cream/kream-tools/agents-core.mjs';
import { collectOffers } from '../../renew/Cream/kream-tools/agents-offers.mjs';
import { parseNo1Benefits, benefitScenario, validPointsSpend } from './benefits.mjs';
import { ROLES, validateDecision, decisionSchemaFor } from './roles.mjs';
import { SourcingTools } from './tools.mjs';
import { runAgentic, validateConfig, finalize, reusableAction } from './runtime.mjs';
import { copyReplayInput } from './run.mjs';
import { aggregateBatchReports } from '../batches.mjs';
import { batchScenario, validBatchPricing } from '../../renew/Cream/kream-tools/agents-batch.mjs';

const NOW = '2026-11-09T03:00:00.000Z';
const decision = (nextStage, actions = [], extra = {}) => ({ summary: '시험 판단', actions, nextStage, complete: false, unresolved: [], recommendations: [], ...extra });
const action = (tool, args) => ({ tool, arguments: JSON.stringify(args), reason: '시험 근거 확인' });
const response = (d, stage) => ({ decision: d, model: ROLES[stage].model, effort: ROLES[stage].effort, usage: { input_tokens: 1, output_tokens: 1 } });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-agentic-test-'));
  t.after(() => { assert.equal(path.dirname(dir), os.tmpdir()); fs.rmSync(dir, { recursive: true, force: true }); });
  const f = teamFixture(dir, NOW);
  writeJson(dir, 'no1-market-123.json', { mode: 'live-visible-ui', kreamId: '123', model: f.offer.model,
    identityVerifiedFromVisibleLink: true, capturedAt: NOW, dataAsOf: NOW, sizes: [{ size: 'S', estimatedTrades30d: 5, instantBidKrw: 200000 }] });
  return f;
}
const provider = async request => {
  const transitions = { planner: 'identity', identity: 'sourcing', sourcing: 'benefits', benefits: 'valuation' };
  if (transitions[request.stage]) return response(decision(transitions[request.stage]), request.stage);
  if (request.stage === 'valuation') return response(decision('audit', [action('calculate', {})]), request.stage);
  if (request.stage === 'audit') return response(decision('audit', [], { complete: true,
    recommendations: request.calculation.options.map(o => ({ optionId: o.optionId, decision: 'clear', reason: '시험 감사' })) }), request.stage);
  return response(decision('audit'), request.stage);
};
const settings = (extra = {}) => ({ provider, mode: 'live', clock: () => NOW, xlsx: false, ...extra });

test('No1 benefit amounts reconcile and existing points are separated from economic profit', () => {
  const raw = { maximumBenefitPriceKrw: 80000, capturedAt: NOW, benefitConditionsVerbatim: [
    '정상가 1개','100,000원','상품쿠폰','-10,000원','적립금','적립금 사용','-10,000원','결제금액 1개','80,000원'] };
  const parsed = parseNo1Benefits(raw);
  assert.equal(parsed.breakdownReconciled, true); assert.equal(parsed.pointsUsedEstimate, 10000);
  assert.equal(parsed.economicCostEstimate, 90000); assert.equal(parsed.accountEligibilityConfirmed, false);
  const scenario = benefitScenario(parsed, 120000, 0, { feeRate: .05, outboundShipping: 3000 });
  assert.equal(scenario.cashProfitEstimate, 31000); assert.equal(scenario.economicProfitEstimate, 21000);
  assert.equal(scenario.promotionAllowed, false);
});

test('unreconciled maximum-benefit total cannot silently treat unknown points as zero', () => {
  const parsed = parseNo1Benefits({ maximumBenefitPriceKrw: 80000, benefitConditionsVerbatim: ['정상가 1개','100,000원','상품쿠폰','-10,000원'] });
  assert.equal(parsed.breakdownReconciled, false); assert.equal(parsed.pointsUsedEstimate, null); assert.equal(parsed.economicCostEstimate, null);
});

test('No1 login-gated benefits carry an explicit reason and unknown cash and point costs',()=>{
  const parsed=parseNo1Benefits({benefitStatus:'login-required',maximumBenefitPriceKrw:null,benefitConditionsVerbatim:['Musinsa에 로그인하시면 최대혜택가를 확인할 수 있습니다.']});
  assert.equal(parsed.loginRequired,true);assert.equal(parsed.cashCostEstimate,null);assert.equal(parsed.pointsUsedEstimate,null);
  assert.ok(parsed.issues.includes('NO1_BENEFITS_LOGIN_REQUIRED'));
  assert.equal(benefitScenario(parsed,200000,0,{feeRate:.05,outboundShipping:3000}).economicProfitEstimate,null);
});

test('one-time coupon is applied to the whole order once and points remain an economic cost', () => {
  const input = { quantity: 3, unitCost: 90000, totalMerchandiseCost: 290000, existingPointsUsed: 10000,
    inboundShipping: 0, salePrice: 120000, stockCap: 3, purchaseLimit: 3, salesCap: 3,
    salesCapConfirmed: true, salesCapEvidence: 'synthetic only', offerVerified: true };
  const result = batchScenario(input, { feeRate: .05, outboundShipping: 3000, totalBudgetUnlimited: true });
  assert.equal(result.capital, 280000); assert.equal(result.cashProfit, 53000); assert.equal(result.economicProfit, 43000);
  const quote = '옵션 S / 수량 3개 / 총 상품금액 290,000원 / 상품 현금 결제액 280,000원 / 적립금 사용 10,000원';
  const evidence = { source: 'dump-N123-prod.json', field: 'text', quote };
  const pricing = { quantity: 3, totalMerchandiseCost: 290000, cashMerchandiseCost: 280000, existingPointsUsed: 10000, conditionsConfirmed: true, evidence };
  assert.ok(validBatchPricing(pricing, 3, 'S', { text: quote }, evidence.source));
  assert.ok(!validBatchPricing(pricing, 5, 'S', { text: quote }, evidence.source));
  assert.ok(!validBatchPricing(pricing, 3, 'M', { text: quote }, evidence.source));
  assert.ok(!validBatchPricing({ ...pricing, cashMerchandiseCost: 290000 }, 3, 'S', { text: quote }, evidence.source));
});

test('points spent require exact size and actual usage, never newly earned rewards', () => {
  const file = 'dump-test.json';
  for (const [quote, expected] of [['옵션 S / 적립금 사용 5,000원', true], ['옵션 S / 구매 시 적립금 5,000원 적립', false],
    ['옵션 M / 적립금 사용 5,000원', false], ['옵션 S / 예상 적립금 사용 5,000원', false]]) {
    assert.equal(validPointsSpend({value:5000,evidence:{source:file,field:'text',quote}}, 'S', {text:quote}, file), expected);
  }
});

test('numbered retailer options bind alphabetic sizes without borrowing decimal or model suffixes', async t => {
  assert.equal(sizeInQuote('S','1.S(90)'),true);
  assert.equal(sizeInQuote('XL','4.XL(105)'),true);
  assert.equal(sizeInQuote('S','1.XS(85)'),false);
  assert.equal(sizeInQuote('M','MODEL1.M'),false);
  assert.equal(sizeInQuote('5','1.5'),false);
  const f=fixture(t), tools=new SourcingTools(f.dir,{config:validateConfig(),clock:()=>NOW}), dump=readJson(f.dir,f.file);
  const text='1.S(90)\n매진임박 (10개)\n판매가\n120,000 원';dump.text+='\n'+text;
  dump.stockProbe={complete:false,results:[{size:'*',state:'unknown'}]};writeJson(f.dir,f.file,dump);
  const ev=readJson(f.dir,'agent-evidence.json').offers[f.offer.id];
  ev.S.optionEvidence={source:f.file,field:'text',quote:text};ev.S.unitPrice.evidence=ev.S.optionEvidence;
  const result=await tools.execute('record_evidence',{offerId:f.offer.id,offers:ev,seller:null});
  assert.ok(result.verification.every(v=>!v.issues.some(i=>i.code==='PRICE_UNCONFIRMED')));
  assert.deepEqual(result.verification.map(v=>v.size),['S']);
  assert.equal(result.verification[0].status,'hold');
});

test('wrong KREAM product pages cannot replace identity observations', async t => {
  const f = fixture(t), original = readJson(f.dir, 'dump-K123.json');
  const wrong = { at: NOW, url: 'https://kream.co.kr/products/999', title: 'Other', text: '모델번호 OTHER-1' };
  const tools = new SourcingTools(f.dir, {config:validateConfig(),clock:()=>NOW,capture:async()=>wrong});
  await assert.rejects(()=>tools.execute('market_page',{pid:'123'}), /KREAM_PRODUCT_URL_MISMATCH/);
  assert.deepEqual(readJson(f.dir, 'dump-K123.json'), original);
  writeJson(f.dir, 'dump-K123.json', wrong);
  await assert.rejects(()=>tools.execute('bind_identity',{pid:'123',model:'OTHER-1',title:'Other',file:'dump-K123.json',quote:'모델번호 OTHER-1'}), /KREAM_PRODUCT_URL_MISMATCH/);
});

test('wrong No1 identity does not overwrite a valid prior quote', async t => {
  const f=fixture(t), prior=readJson(f.dir,'no1-market-123.json');
  const tools=new SourcingTools(f.dir,{config:validateConfig(),clock:()=>NOW,queryNo1:async()=>({...prior,kreamId:'999'})});
  await assert.rejects(()=>tools.execute('no1_market',{pid:'123'}),/NO1_MARKET_IDENTITY_MISMATCH/);
  assert.deepEqual(readJson(f.dir,'no1-market-123.json'),prior);
});

test('No1 maximum benefit from a different option cannot spread across market sizes', async t => {
  const f=fixture(t), tools=new SourcingTools(f.dir,{config:validateConfig(),clock:()=>NOW});
  const file=`no1-stock-${f.offer.id}-test.json`;
  writeJson(f.dir,file,{option:'M',capturedAt:NOW,maximumBenefitPriceKrw:80000,benefitConditionsVerbatim:['정상가 1개','100,000원','상품쿠폰','-20,000원']});
  const result=await tools.calculate();
  assert.equal(result.benefits[file].optionMappingConfirmed,false);
  assert.deepEqual(result.benefits[file].options,[]);
});

test('ambiguous points net price is held and is not published as economic profit', async t => {
  const f=fixture(t), ev=readJson(f.dir,'agent-evidence.json'), dump=readJson(f.dir,f.file);
  const quote='옵션 S / 적립금 사용 5,000원'; dump.text+='\n'+quote; writeJson(f.dir,f.file,dump);
  ev.offers[f.offer.id].S.pointsUsed={value:5000,evidence:{source:f.file,field:'text',quote}}; writeJson(f.dir,'agent-evidence.json',ev);
  const result=await runAgentic(f.dir,settings());
  assert.equal(result.summary.candidate,0); assert.equal(result.rows[0].instantProfit,null); assert.equal(result.rows[0].existingPointsUsed,null);
  assert.equal(result.rows[0].cashProfit,null); assert.equal(result.rows[0].checkoutCost,null);
  assert.ok(result.rows[0].reasons.includes('POINTS_SPEND_UNCONFIRMED'));
});

test('expired observation receipts permit reacquisition while pure reads stay deduplicated', () => {
  const receipt = {at:NOW};
  assert.equal(reusableAction(receipt,'no1_market',NOW,10),true);
  assert.equal(reusableAction(receipt,'no1_market','2026-11-09T03:11:00Z',10),false);
  assert.equal(reusableAction(receipt,'inspect_offer','2026-11-09T03:11:00Z',10),false);
  assert.equal(reusableAction(receipt,'read_evidence','2026-11-09T03:11:00Z',10),true);
});

test('empty undiscovered scope is incomplete even when an auditor tries to finish', async t => {
  const f = fixture(t); writeJson(f.dir,'k50-ids.json',[]); writeJson(f.dir,'k50.json',[]);
  const result = await runAgentic(f.dir,settings({provider:async r=>response(r.stage==='planner'?decision('audit'):decision('audit',[],{complete:true}),r.stage)}));
  assert.equal(readJson(f.dir,'agentic-state.json').status,'needs_attention');
  assert.equal(result.independentReview.completed,false); assert.ok(result.unresolved.includes('NO_PRODUCTS_DISCOVERED'));
});

test('quantity conditions are recordable and fabricated stock limits are rejected', async t => {
  const f = fixture(t), tools = new SourcingTools(f.dir,{config:validateConfig(),clock:()=>NOW});
  const dump=readJson(f.dir,f.file), quote='옵션 S / 수량 3개 / 배송비 0원 / 구매 가능 수량 5개 / 구매 제한 수량 5개';
  dump.text+='\n'+quote; writeJson(f.dir,f.file,dump);
  await tools.calculate(); const verified=readJson(f.dir,'verified-offers.json').items[0];
  const ref={source:f.file,field:'text',quote};
  const market=readJson(f.dir,'dump-K123.json');
  const conditions={stockCap:5,stockCapEvidence:ref,purchaseLimit:5,purchaseLimitEvidence:ref,salesCap:3,salesWindowDays:30,
    salesCapConfirmed:true,salesCapReason:'관측 거래 5건보다 낮은 3개 판매를 시나리오로 가정',salesCapEvidence:{source:'dump-K123.json',field:'text',quote:market.text},
    inboundShippingByQuantity:{3:{value:0,source:f.file,evidence:ref}}};
  const result=await tools.execute('record_batch_conditions',{optionId:verified.id,quantity:3,conditions});
  assert.equal(result.salesGuaranteed,false);
  await assert.rejects(()=>tools.execute('record_batch_conditions',{optionId:verified.id,quantity:3,conditions:{...conditions,stockCap:500}}),/BATCH_CONDITIONS_UNVERIFIED/);
});

test('seller-page benefit uncertainty can be recorded without a No1 result', async t => {
  const f = fixture(t), tools = new SourcingTools(f.dir, { mode: 'replay', config: validateConfig(), clock: () => NOW });
  const result = await tools.execute('assess_benefits', { offerId: f.offer.id, note: '현재 원문에서 개인 쿠폰 조건 미확인', items: [] });
  assert.equal(result.promotionAllowed, false); assert.equal(result.breakdown.actualCheckoutPriceConfirmed, false);
  assert.equal(readJson(f.dir, 'benefit-assessments.json')[f.offer.id].note, result.note);
});

test('role tools and completion are constrained by schema and host validation', () => {
  assert.equal(decisionSchemaFor('planner').properties.actions.maxItems, 0);
  assert.deepEqual(decisionSchemaFor('identity').properties.actions.items.properties.tool.enum, ROLES.identity.tools);
  assert.throws(() => validateDecision(decision('audit', [action('no1_stock', {})]), 'identity'), /ROLE_TOOL_NOT_ALLOWED/);
  assert.throws(() => validateDecision(decision('audit', [], { complete: true }), 'planner'), /ONLY_AUDITOR/);
});

test('all specialist decisions execute, calculate runs as a tool, and final evidence can pass', async t => {
  const f = fixture(t); const calls = [];
  const result = await runAgentic(f.dir, settings({ provider: request => { calls.push(request.stage); return provider(request); } }));
  assert.deepEqual(calls, ['planner','identity','sourcing','benefits','valuation','audit']);
  assert.equal(result.summary.candidate, 1); assert.equal(result.rows[0].instantProfit, 67000);
  assert.equal(readJson(f.dir, 'agentic-state.json').status, 'complete');
  assert.ok(fs.existsSync(path.join(f.dir, 'agent-tool-results/action-001.json')));
});

test('same-option evidence, independent No1 quote and final reviewer are all mandatory', async t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.dir, 'agent-evidence.json')); fs.unlinkSync(path.join(f.dir, 'no1-market-123.json'));
  const result = await runAgentic(f.dir, settings());
  assert.equal(result.summary.candidate, 0);
  assert.ok(result.rows.some(row => row.reasons.includes('NO1_MARKET_UNVERIFIED')));
});

test('expiry during the auditor call is revalidated at finalization', async t => {
  const f = fixture(t); let now = NOW;
  const result = await runAgentic(f.dir, settings({ clock: () => now, provider: async request => {
    const r = await provider(request); if (request.stage === 'audit') now = '2026-11-09T03:11:00.000Z'; return r;
  } }));
  assert.equal(result.summary.candidate, 0); assert.ok(result.rows.some(row => row.reasons.includes('NO1_MARKET_STALE')));
});

test('replay uses original timestamps and never produces current approved candidates', async t => {
  const f = fixture(t); const result = await runAgentic(f.dir, settings({ mode: 'replay' }));
  assert.equal(result.summary.candidate, 0); assert.ok(result.rows[0].reasons.includes('HISTORICAL_REPLAY_ONLY'));
  assert.equal(readJson(f.dir, 'dump-K123.json').at, NOW);
});

test('AI decisions really control tool selection, including recovery retry', async t => {
  const f = fixture(t), config = validateConfig(), tools = new SourcingTools(f.dir, { mode: 'live', config, clock: () => NOW });
  const realExecute = tools.execute.bind(tools), commands = []; let failure = true;
  tools.execute = async (tool, args) => {
    commands.push({ tool, args });
    if (tool === 'read_evidence' && failure) { failure = false; throw Error('TRANSIENT_TEST_FAILURE'); }
    return realExecute(tool, args);
  };
  let readRequested = false;
  const result = await runAgentic(f.dir, settings({ tools, provider: async request => {
    if (request.stage === 'identity' && !readRequested) { readRequested = true; return response(decision('sourcing', [action('read_evidence', { file: 'dump-K123.json' })]), request.stage); }
    if (request.stage === 'recovery') return response(decision('sourcing', [action('retry', {})]), request.stage);
    return provider(request);
  } }));
  assert.equal(commands.filter(c => c.tool === 'read_evidence').length, 2);
  assert.equal(readJson(f.dir, 'agentic-state.json').recoveries, 1); assert.equal(result.summary.candidate, 1);
});

test('repeated unchanged actions are suppressed and no-progress ends explicitly', async t => {
  const f = fixture(t);
  const result = await runAgentic(f.dir, settings({ config: { maxNoProgressTurns: 2, maxAgentCalls: 12 }, provider: async request =>
    response(request.stage === 'planner' ? decision('identity') : decision('identity', [action('read_evidence', { file: 'dump-K123.json' })]), request.stage) }));
  const state = readJson(f.dir, 'agentic-state.json');
  assert.equal(state.status, 'needs_attention'); assert.equal(state.toolActions, 1); assert.equal(result.summary.candidate, 0);
});

test('budget exhaustion produces an incomplete result rather than claiming completion', async t => {
  const f = fixture(t); const result = await runAgentic(f.dir, settings({ config: { maxAgentCalls: 1 } }));
  assert.equal(readJson(f.dir, 'agentic-state.json').status, 'needs_attention'); assert.equal(result.summary.candidate, 0);
});

test('completed run resumes without repeating tool calls', async t => {
  const f = fixture(t); await runAgentic(f.dir, settings());
  const result = await runAgentic(f.dir, settings({ provider: () => assert.fail('completed work must not repeat') }));
  assert.equal(result.summary.candidate, 1);
  await assert.rejects(()=>runAgentic(f.dir,settings({clock:()=> '2026-11-09T03:11:00Z'})), /COMPLETED_RESULT_STALE/);
  assert.equal(readJson(f.dir,'agentic-state.json').status,'complete');
});

test('completed run cannot reuse evidence older than its recent report timestamp', async t => {
  const f=fixture(t), reportTime='2026-11-09T03:09:00Z';
  await runAgentic(f.dir,settings({clock:()=>reportTime}));
  await assert.rejects(()=>runAgentic(f.dir,settings({clock:()=> '2026-11-09T03:11:00Z'})),/COMPLETED_RESULT_STALE/);
  assert.equal(readJson(f.dir,'agentic-state.json').status,'complete');
});

test('completed approval is invalidated by same-time edits to source evidence', async t => {
  const f=fixture(t); await runAgentic(f.dir,settings());
  const dump=readJson(f.dir,f.file); dump.text+='\n상품정보 변경'; writeJson(f.dir,f.file,dump);
  await assert.rejects(()=>runAgentic(f.dir,settings()),/COMPLETED_INPUT_CHANGED/);
});

test('evidence path traversal, invented source links and fake option quotes fail closed', async t => {
  const f = fixture(t), tools = new SourcingTools(f.dir, { mode: 'replay', config: validateConfig(), clock: () => NOW });
  await assert.rejects(() => tools.execute('read_evidence', { file: '../agent-policy.json' }), /EVIDENCE_FILE/);
  await assert.rejects(() => tools.execute('catalog_page', { pid: '123', url: 'https://evil.example/anything' }), /CATALOG_LINK_NOT_OBSERVED/);
  await assert.rejects(() => tools.execute('inspect_offer', { offerId: 'invented' }), /OFFER_NOT/);
  await assert.rejects(() => tools.execute('market_page', { pid: '123' }), /REPLAY_NETWORK_DISABLED/);
  const current = readJson(f.dir, 'agent-evidence.json');
  const invalid = structuredClone(current.offers[f.offer.id]); invalid.S.unitPrice.evidence.quote = '옵션 S 판매가 1원';
  await assert.rejects(() => tools.execute('record_evidence', { offerId: f.offer.id, offers: invalid, seller: null }), /SOURCE_QUOTE_INVALID/);
  assert.deepEqual(readJson(f.dir, 'agent-evidence.json'), current);
});

test('changed evidence after review cannot reuse an old approval', async t => {
  const f = fixture(t), tools = new SourcingTools(f.dir, { mode: 'live', config: validateConfig(), clock: () => NOW });
  const calculation = await tools.calculate();
  writeJson(f.dir, 'benefit-assessments.json', { changed: true });
  const result = await finalize(f.dir, { mode: 'live', unresolved: [], decisions: [] }, tools,
    { recommendations: calculation.options.map(o => ({ optionId: o.optionId, decision: 'clear', reason: 'old' })), unresolved: [] }, { xlsx: false });
  assert.equal(result.summary.candidate, 0); assert.ok(result.rows[0].reasons.includes('AUDIT_INPUT_CHANGED'));
});

test('new exploration admits sufficient single-size evidence without a whole-brand blacklist', t => {
  const f = fixture(t), products = readJson(f.dir, 'k50.json'); products[0].n = 5; products[0].title = 'New Balance ' + products[0].title;
  writeJson(f.dir, 'k50.json', products);
  assert.equal(collectOffers(context(f.dir, { now: NOW })).length, 0);
  writeJson(f.dir, 'agent-policy.json', { ...readJson(f.dir, 'agent-policy.json'), eligibilityMode: 'option-evidence' });
  assert.equal(collectOffers(context(f.dir, { now: NOW })).length, 1);
});

test('replay copying never overwrites historical evidence or an existing output', t => {
  const f = fixture(t), target = path.join(f.dir, 'bad');
  assert.throws(() => copyReplayInput(f.dir, target), /OUTSIDE_SOURCE/);
  assert.throws(() => copyReplayInput(f.dir, f.dir), /OUTSIDE_SOURCE/);
});

test('cycle aggregation accepts completed Codex independent review and still checks freshness', async t => {
  const f = fixture(t); await runAgentic(f.dir, settings());
  const cycle = path.join(f.dir, 'cycle'); fs.mkdirSync(cycle);
  const manifest = { ids: ['123'], batches: [{ index: 1, ids: ['123'], status: 'done', dir: f.dir }] };
  assert.equal(aggregateBatchReports(cycle, manifest, { now: NOW, xlsx: false }).summary.candidate, 1);
  assert.equal(aggregateBatchReports(cycle, manifest, { now: '2026-11-09T03:11:00Z', xlsx: false }).summary.candidate, 0);
  const market=readJson(f.dir,'no1-market-123.json');
  writeJson(f.dir,'no1-market-123.json',{...market,dataAsOf:'2026-11-09T02:49:00Z'});
  assert.equal(aggregateBatchReports(cycle, manifest, { now: NOW, xlsx: false }).summary.candidate, 0);
  writeJson(f.dir, 'agentic-state.json', { status: 'running' });
  assert.equal(aggregateBatchReports(cycle, manifest, { now: NOW, xlsx: false }).summary.candidate, 0);
});
