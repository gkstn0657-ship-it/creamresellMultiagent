import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { context, writeJson, readJson, quote, tradesFromDump, optionId, productJobId, canonicalUrl, acquireRunLock, moneyInQuote } from '../agents-core.mjs';
import { pathToFileURL } from 'node:url';
import { collectOffers, verifyOffers, locateDump, planFallback } from '../agents-offers.mjs';
import { verifySellers } from '../agents-sellers.mjs';
import { runAgents } from '../agents-run.mjs';
import { recordIncident } from '../agents-incidents.mjs';
import { reviewWithLlm, applyLlmReview, invokeCodex, validateFindings } from '../agents-llm.mjs';

const NOW = '2026-11-08T03:00:00.000Z', MODEL = '801563051-A0029', TITLE = `스톤아일랜드 ${MODEL} 블랙`;
function fixture(t, count = 2) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-agents-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = { id: '123', model: MODEL, title: TITLE, n: 30, kreamMed: 200000 };
  const sources = Array.from({ length: count }, (_, i) => ({ title: TITLE, price: 120000 + i * 1000, shipFee: 0, link: `https://shop${i}.example/product/1`, keyMatch: true, topMalls: [{ mall: i ? 'SSG' : '롯데ON' }] }));
  writeJson(dir, 'k50.json', [p]); writeJson(dir, 'n-cards.json', { 123: { matched: sources } }); writeJson(dir, 'n-cat.json', {});
  writeJson(dir, 'agent-policy.json', { costPolicyConfirmed: true, costPolicySource: '운영자가 확인한 시험 수수료', costPolicyVersion: 'fixture-v1' });
  writeJson(dir, 'jobs.json', { jobs: [] });
  writeJson(dir, 'dump-K123.json', { at: NOW, text: '거래일\n' + ['S','S','S','M','M','M'].map((s) => `${s}\n200,000원\n26/11/08`).join('\n') });
  const offers = collectOffers(context(dir, { now: NOW }));
  const baseline = { rows: [{ '크림ID': '123', '상품명': TITLE + ' [S]', '모델번호': MODEL, '판정': '후보', '차트 분류': '횡보', '예상순수익(원)': 67000, '매입가(원)': 120000, '수익률(%)': 55.8, '판매처 링크': sources[0]?.link || '' }], meta: {} };
  writeJson(dir, 'final-all.json', baseline);
  return { dir, offers, baseline, ctx: () => context(dir, { now: NOW, runId: 'test-run' }) };
}
function addEvidence(f, index = 0, overrides = {}) {
  const o = f.offers[index], file = `dump-${productJobId(o)}.json`;
  const text = '옵션 S / 판매가 120,000원\n배송비 무료\n판매자: 실제상점\n사업자등록번호 123-45-67890\n실제 판매자는 실제상점, 플랫폼은 중개자\n국내 출고\n반품 가능 7일\n구매 영수증 발급 가능';
  const dump = { at: NOW, url: o.url, title: TITLE, text, stockProbe: { complete: true, enumerationComplete: true, results: [{ size: 'S', state: 'available', maxQty: 2 }] }, ...overrides };
  writeJson(f.dir, file, dump);
  const q = (s) => quote(file, 'text', s), ev = readJson(f.dir, 'agent-evidence.json', { offers: {}, sellers: {} });
  ev.offers[o.id] = { S: { size: 'S', optionEvidence: q('옵션 S / 판매가 120,000원'), unitPrice: { value: 120000, evidence: q('옵션 S / 판매가 120,000원') }, shipping: { value: 0, evidence: q('배송비 무료') } } };
  ev.sellers[o.id] = { name: '실제상점', businessNumber: '123-45-67890', role: 'marketplace', domestic: true,
    identityEvidence: q('판매자: 실제상점'), businessEvidence: q('사업자등록번호 123-45-67890'), roleEvidence: q('실제 판매자는 실제상점, 플랫폼은 중개자'),
    dispatchEvidence: q('국내 출고'), returnEvidence: q('반품 가능 7일'), receiptEvidence: q('구매 영수증 발급 가능') };
  writeJson(f.dir, 'agent-evidence.json', ev); return { o, file, dump, ev };
}

test('complete option-bound evidence produces one candidate without approving other sellers', async (t) => {
  const f = fixture(t); addEvidence(f);
  const { final } = await runAgents(f.dir, { now: NOW, runId: 'test-run' });
  const candidates = final.rows.filter((r) => r['판정'] === '후보');
  assert.equal(candidates.length, 1); assert.equal(candidates[0]['예상순수익(원)'], 67000);
  assert.equal(candidates[0]['매입가(원)'], 120000); assert.ok(candidates[0]['옵션ID']);
  assert.ok(final.rows.some((r) => r['판정'] === '사람 검토'));
});
test('identity is stable, seller-specific, and normalizes tracking-only URLs', (t) => {
  const f = fixture(t); assert.notEqual(f.offers[0].id, f.offers[1].id);
  assert.notEqual(optionId(f.offers[0].id, 'S'), optionId(f.offers[0].id, 'M'));
  assert.equal(optionId(f.offers[0].id, ' s '), optionId(f.offers[0].id, 'S'));
  assert.equal(canonicalUrl('https://a.example/p?utm_source=x#y'), 'https://a.example/p');
  assert.equal(canonicalUrl('javascript:alert(1)'), '');
});
test('missing price evidence, cross-size reuse, unknown shipping and coupon conditions hold', (t) => {
  const f = fixture(t, 1), { ev, o, file, dump } = addEvidence(f);
  ev.offers[o.id].S.size = 'M'; writeJson(f.dir, 'agent-evidence.json', ev);
  let rows = verifyOffers(f.ctx(), f.offers); assert.equal(rows[0].status, 'hold'); assert.equal(rows[0].cost, null);
  assert.ok(rows[0].issues.some((x) => x.code === 'PRICE_UNCONFIRMED'));
  ev.offers[o.id].S.size = 'S'; delete ev.offers[o.id].S.shipping;
  writeJson(f.dir, 'agent-evidence.json', ev); writeJson(f.dir, file, { ...dump, text: dump.text + '\n첫 구매 쿠폰 혜택가' });
  rows = verifyOffers(f.ctx(), f.offers);
  assert.ok(rows[0].issues.some((x) => x.code === 'SHIPPING_UNCONFIRMED'));
  assert.ok(rows[0].issues.some((x) => x.code === 'CONDITIONS_UNCONFIRMED'));
});
test('color mismatch and blocked pages cannot be candidates', async (t) => {
  const f = fixture(t, 1); addEvidence(f, 0, { title: TITLE.replace('블랙', '네이비'), blocked: true });
  const { final } = await runAgents(f.dir, { now: NOW }); assert.equal(final.rows[0]['판정'], '제외');
  assert.match(final.rows[0]['검증사유코드'], /COLOR_MISMATCH/);
});
test('capture time expires even if files are freshly written; relative trade age is capture anchored', async (t) => {
  const f = fixture(t, 1); addEvidence(f, 0, { at: '2025-10-01T03:00:00.000Z' });
  const trades = tradesFromDump({ at: '2025-10-01T03:00:00.000Z', text: '거래일\nS\n200,000원\n방금' });
  assert.match(trades[0].at, /^2025-09-30T15:/);
  const { final } = await runAgents(f.dir, { now: NOW }); assert.equal(final.rows[0]['판정'], '사람 검토'); assert.match(final.rows[0]['검증사유코드'], /OFFER_STALE/);
});
test('seller checks reject platform-only identities, reuse unchanged evidence and invalidate edits', (t) => {
  const f = fixture(t, 1), { ev, o } = addEvidence(f);
  let sellers = verifySellers(f.ctx(), f.offers); assert.equal(sellers[0].status, 'verified');
  sellers = verifySellers(f.ctx(), f.offers); assert.equal(sellers[0].cached, true);
  ev.sellers[o.id].name = '플랫폼운영사'; writeJson(f.dir, 'agent-evidence.json', ev);
  sellers = verifySellers(f.ctx(), f.offers); assert.equal(sellers[0].cached, false); assert.equal(sellers[0].status, 'hold');
});
test('fallback tries next seller after sold-out, stops on verified seller and honors budget', (t) => {
  const f = fixture(t, 3); addEvidence(f, 0, { stockProbe: { complete: true, enumerationComplete: true, results: [{ size: 'S', state: 'soldout' }] } });
  let ctx = f.ctx(), checks = verifyOffers(ctx, f.offers), sellers = verifySellers(ctx, f.offers);
  let next = planFallback(ctx, f.offers, checks, sellers); assert.equal(next.jobs.length, 1); assert.equal(next.jobs[0].url, f.offers[1].url);
  addEvidence(f, 1); ctx = f.ctx(); next = planFallback(ctx, f.offers, verifyOffers(ctx, f.offers), verifySellers(ctx, f.offers)); assert.equal(next.jobs.length, 0);
  const policy = readJson(f.dir, 'agent-policy.json'); writeJson(f.dir, 'agent-policy.json', { ...policy, maxFallback: 0 });
  const noPass = checks.map((r) => ({ ...r, status: 'hold' })); next = planFallback(f.ctx(), f.offers, noPass, []); assert.equal(next.jobs.length, 0); assert.equal(next.items[0].status, 'exhausted');
});
test('legacy redirect dump binds by queued source URL and never leaks to another seller', (t) => {
  const f = fixture(t); writeJson(f.dir, 'jobs.json', { jobs: [{ id: 'N123-prod', url: f.offers[0].url }] });
  writeJson(f.dir, 'dump-N123-prod.json', { url: 'https://redirect.example/landing', text: '', at: NOW });
  assert.equal(locateDump(f.ctx(), f.offers[0]).file, 'dump-N123-prod.json'); assert.equal(locateDump(f.ctx(), f.offers[1]).dump, null);
});
test('mixed-size or old market samples and unconfirmed cost rules cannot pass', async (t) => {
  const f = fixture(t, 1); addEvidence(f);
  writeJson(f.dir, 'dump-K123.json', { at: NOW, text: '거래일\nM\n200,000원\n26/11/08\nM\n200,000원\n26/11/08\nM\n200,000원\n26/11/08' });
  writeJson(f.dir, 'agent-policy.json', {});
  const { final } = await runAgents(f.dir, { now: NOW }); const row = final.rows[0];
  assert.equal(row['판정'], '사람 검토'); assert.equal(row['예상순수익(원)'], '');
  assert.match(row['검증사유코드'], /OPTION_SAMPLE_INSUFFICIENT/); assert.match(row['검증사유코드'], /COST_POLICY_UNCONFIRMED/);
});
test('resume deduplicates snapshots; actual settlements stay separate and events are immutable', async (t) => {
  const f = fixture(t, 1); addEvidence(f);
  let r = await runAgents(f.dir, { now: NOW }); await runAgents(f.dir, { now: NOW });
  assert.equal(readJson(f.dir, 'outcomes.json').snapshots.length, 1);
  const event = { eventId: 'sale-1', optionId: r.final.rows[0]['옵션ID'], kind: 'actual', at: NOW, settlement: 180000, purchaseCost: 120000, extraCost: 3000, source: '실제 정산 명세' };
  writeJson(f.dir, 'outcome-events.json', [event]); await runAgents(f.dir, { now: NOW }); await runAgents(f.dir, { now: NOW });
  let report = readJson(f.dir, 'calibration-report.json'); assert.equal(report.actualTransactions, 1); assert.equal(report.realizedProfit, 57000); assert.equal(report.candidateAccuracy, null);
  writeJson(f.dir, 'outcome-events.json', [{ ...event, settlement: 999999 }]); await assert.rejects(runAgents(f.dir, { now: NOW }), /충돌/);
  assert.equal(readJson(f.dir, 'agent-state.json').status, 'failed');
});
test('unbound legacy candidates are retained for review, rejected rows preserved', async (t) => {
  const f = fixture(t, 0); f.baseline.rows.push({ '크림ID': '456', '상품명': '기존 제외', '판정': '제외', '사유': '명백한 불일치' });
  const { final } = await runAgents(f.dir, { now: NOW, legacy: f.baseline });
  assert.equal(final.rows.length, 2); assert.equal(final.rows[0]['판정'], '사람 검토'); assert.equal(final.rows[1]['판정'], '제외');
});
test('LLM output cannot upgrade candidates, malformed or missing IDs fail, cache prevents calls', async (t) => {
  const f = fixture(t, 1); addEvidence(f); await runAgents(f.dir, { now: NOW });
  let calls = 0; const provider = async ({ rows }) => { calls++; return { findings: rows.map((r) => ({ id: r.id, action: 'hold', reason: '추가 확인 필요' })) }; };
  const audit = readJson(f.dir, 'audit.json'); let review = await reviewWithLlm(f.ctx(), audit, { provider });
  await reviewWithLlm(f.ctx(), audit, { provider }); assert.equal(calls, 1);
  const final = readJson(f.dir, 'final-all.json'); applyLlmReview(final, review); assert.equal(final.rows[0]['판정'], '사람 검토');
  assert.throws(() => validateFindings({ findings: [] }, new Set(['x'])), /누락/);
  assert.throws(() => validateFindings({ findings: [{ id: 'x', action: 'approve', reason: '' }] }, new Set(['x'])), /검증/);
});
test('LLM budget/failure blocks promotion; unavailable CLI rejects without hanging', async (t) => {
  const f = fixture(t, 1); addEvidence(f); await runAgents(f.dir, { now: NOW });
  const ctx = f.ctx(); ctx.policy.maxLlmCalls = 0;
  const review = await reviewWithLlm(ctx, readJson(f.dir, 'audit.json'), { provider: () => assert.fail('must not call') });
  assert.equal(review.errors.length, 1); const final = readJson(f.dir, 'final-all.json'); applyLlmReview(final, review); assert.equal(final.rows[0]['판정'], '사람 검토');
  await assert.rejects(invokeCodex({}, { executable: path.join(f.dir, 'missing-codex.exe'), timeoutMs: 1000 }), /실행 실패/);
});
test('incident records preserve STOP and deduplicate diagnostics; corrupt inputs fail visibly', (t) => {
  const f = fixture(t, 0); fs.writeFileSync(path.join(f.dir, 'STOP'), 'blocked');
  const a = recordIncident(f.dir, new Error('덤프 정체'), '수집'); recordIncident(f.dir, new Error('덤프 정체'), '수집');
  assert.equal(a.kind, 'BLOCKED'); assert.equal(readJson(f.dir, 'incident.json').items.length, 1); assert.ok(fs.existsSync(path.join(f.dir, 'STOP')));
  fs.writeFileSync(path.join(f.dir, 'agent-policy.json'), '{bad'); assert.throws(f.ctx, /JSON 읽기 실패/);
});
test('unobserved legacy sizes are preserved instead of dropped by product ID', async (t) => {
  const f = fixture(t, 1); addEvidence(f);
  f.baseline.rows.push({ ...f.baseline.rows[0], '상품명': TITLE + ' [M]' });
  const { final } = await runAgents(f.dir, { now: NOW, legacy: f.baseline });
  assert.equal(final.rows.filter((r) => r['판정'] === '후보').length, 1);
  assert.ok(final.rows.some((r) => r['상품명'].endsWith('[M]') && r['판정'] === '사람 검토'));
});
test('same-size quote cannot borrow a different option price', (t) => {
  const f = fixture(t, 1), { o, ev, file, dump } = addEvidence(f);
  writeJson(f.dir, file, { ...dump, text: dump.text + '\n옵션 M / 판매가 80,000원' });
  ev.offers[o.id].S.unitPrice = { value: 80000, evidence: quote(file, 'text', '옵션 M / 판매가 80,000원') };
  writeJson(f.dir, 'agent-evidence.json', ev);
  assert.ok(verifyOffers(f.ctx(), f.offers)[0].issues.some((i) => i.code === 'PRICE_UNCONFIRMED'));
});
test('run lock prevents concurrent writers and releases cleanly', (t) => {
  const f = fixture(t, 0), release = acquireRunLock(f.dir);
  assert.throws(() => acquireRunLock(f.dir), /실행 중/); release();
  const again = acquireRunLock(f.dir); again(); assert.equal(fs.existsSync(path.join(f.dir, '.cream-run.lock')), false);
});
test('negative verified purchase margin triggers fallback', (t) => {
  const f = fixture(t), { o, file, dump, ev } = addEvidence(f);
  const text = dump.text.replace(/120,000/g, '220,000'); writeJson(f.dir, file, { ...dump, text });
  ev.offers[o.id].S.optionEvidence.quote = '옵션 S / 판매가 220,000원';
  ev.offers[o.id].S.unitPrice = { value: 220000, evidence: quote(file, 'text', '옵션 S / 판매가 220,000원') };
  writeJson(f.dir, 'agent-evidence.json', ev);
  const ctx = f.ctx(), result = planFallback(ctx, f.offers, verifyOffers(ctx, f.offers), verifySellers(ctx, f.offers));
  assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].url, f.offers[1].url);
});
test('LLM timeout kills the launched process and uses Sol High with structured output', async () => {
  let killed = false, argv;
  const spawnProcess = (exe, args, options) => {
    argv = args; assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => { killed = true; };
    return child;
  };
  await assert.rejects(invokeCodex({ rows: [] }, { spawnProcess, timeoutMs: 10 }), /시간 초과/);
  assert.equal(killed, true); assert.ok(argv.includes('gpt-6.1-sol')); assert.ok(argv.includes('model_reasoning_effort="high"')); assert.ok(argv.includes('--output-schema'));
});
test('LLM input budget blocks new calls without exposing raw source data', async (t) => {
  const f = fixture(t, 1); addEvidence(f); await runAgents(f.dir, { now: NOW });
  const ctx = f.ctx(); ctx.policy.maxLlmInputChars = 0;
  const r = await reviewWithLlm(ctx, readJson(f.dir, 'audit.json'), { provider: () => assert.fail('must not call') });
  assert.equal(r.calls, 0); assert.match(r.errors[0].message, /입력 길이/);
});
test('follow-up tracking preserves past snapshots and emits overdue 7/14-day observations', async (t) => {
  const f = fixture(t, 1); addEvidence(f); await runAgents(f.dir, { now: NOW });
  const first = readJson(f.dir, 'outcomes.json').snapshots[0];
  await runAgents(f.dir, { now: '2026-11-23T03:00:00.000Z' });
  const history = readJson(f.dir, 'outcomes.json'); assert.deepEqual(history.snapshots[0], first);
  assert.ok(history.due.some((d) => d.days === 7)); assert.ok(history.due.some((d) => d.days === 14));
});
test('Excel preserves separate sellers and exports verification IDs and review rows', (t) => {
  const f = fixture(t, 0), a = { ...f.baseline.rows[0], '판정': '사람 검토', '제안ID': 'seller-a', '옵션ID': 'option-a', '검증사유코드': 'PRICE_UNCONFIRMED' }, b = { ...a, '제안ID': 'seller-b', '옵션ID': 'option-b' };
  writeJson(f.dir, 'export.json', { rows: [a, b], meta: {} });
  const exporter = fileURLToPath(new URL('../export-xlsx.py', import.meta.url)), out = path.join(f.dir, 'test.xlsx');
  const r = spawnSync('python', ['-I', exporter, path.join(f.dir, 'export.json'), out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const check = spawnSync('python', ['-I', '-c', "import sys,openpyxl; w=openpyxl.load_workbook(sys.argv[1],read_only=True); s=w['사람 검토']; rows=list(s.values); h=list(rows[0]); assert len(rows)==3; assert set(r[h.index('옵션ID')] for r in rows[1:])=={'option-a','option-b'}; assert len(list(w['수익후보'].values))==1; w.close()", out], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});
test('review metrics use the historical snapshot rather than a later promotion', async (t) => {
  const f = fixture(t, 1); addEvidence(f);
  const policy = readJson(f.dir, 'agent-policy.json'); writeJson(f.dir, 'agent-policy.json', { ...policy, costPolicyConfirmed: false });
  const held = await runAgents(f.dir, { now: NOW }), snapshot = readJson(f.dir, 'outcomes.json').snapshots[0];
  writeJson(f.dir, 'agent-policy.json', policy);
  const at = '2026-11-08T03:01:00.000Z';
  writeJson(f.dir, 'outcome-events.json', [{ eventId: 'review-old-hold', optionId: held.final.rows[0]['옵션ID'], snapshotId: snapshot.id, kind: 'review', at, valid: true, source: '독립 정답표' }]);
  const promoted = await runAgents(f.dir, { now: at }); assert.equal(promoted.final.rows[0]['판정'], '후보');
  const report = readJson(f.dir, 'calibration-report.json'); assert.equal(report.reviewedCandidates, 0); assert.equal(report.missedInReviewedNonCandidates, 1);
});
test('amount matching rejects a suffix of a larger price and negated free shipping', () => {
  assert.equal(moneyInQuote(120000, { quote: '판매가 1,120,000원' }), false);
  assert.equal(moneyInQuote(0, { quote: '배송비 무료 아님, 3,000원' }), false);
});
test('SIZE M or XS cannot attest to an S option', (t) => {
  const f = fixture(t, 1), { o, ev, file, dump } = addEvidence(f);
  for (const label of ['SIZE M', '옵션 XS']) {
    const line = `${label} / 판매가 120,000원`;
    writeJson(f.dir, file, { ...dump, text: dump.text.replace('옵션 S / 판매가 120,000원', line) });
    ev.offers[o.id].S.optionEvidence = quote(file, 'text', line); ev.offers[o.id].S.unitPrice.evidence = quote(file, 'text', line);
    writeJson(f.dir, 'agent-evidence.json', ev);
    assert.equal(verifyOffers(f.ctx(), f.offers)[0].status, 'hold');
  }
});
test('an evidence block with two option prices cannot approve the cheaper price for S', (t) => {
  const f = fixture(t, 1), { o, ev, file, dump } = addEvidence(f);
  const block = '옵션 S / 판매가 120,000원\n옵션 M / 판매가 80,000원';
  writeJson(f.dir, file, { ...dump, text: dump.text.replace('옵션 S / 판매가 120,000원', block) });
  ev.offers[o.id].S.optionEvidence = quote(file, 'text', block);
  ev.offers[o.id].S.unitPrice = { value: 80000, evidence: quote(file, 'text', '옵션 M / 판매가 80,000원') };
  writeJson(f.dir, 'agent-evidence.json', ev);
  assert.equal(verifyOffers(f.ctx(), f.offers)[0].status, 'hold');
});
test('candidate freshness is rechecked after the AI review finishes', async (t) => {
  const f = fixture(t, 1); addEvidence(f); let now = NOW;
  const provider = async ({ rows }) => { now = '2026-11-08T03:11:00.000Z'; return { findings: rows.map((r) => ({ id: r.id, action: 'none', reason: '' })) }; };
  const { final } = await runAgents(f.dir, { now: NOW, clock: () => now, llm: true, provider });
  assert.equal(final.rows[0]['판정'], '사람 검토'); assert.match(final.rows[0]['검증사유코드'], /STALE/);
});
test('fallback does not claim completion with stale market data', (t) => {
  const f = fixture(t); addEvidence(f);
  const dump = readJson(f.dir, 'dump-K123.json'); writeJson(f.dir, 'dump-K123.json', { ...dump, at: '2026-11-08T02:00:00Z' });
  const ctx = f.ctx(), r = planFallback(ctx, f.offers, verifyOffers(ctx, f.offers), verifySellers(ctx, f.offers));
  assert.notEqual(r.items[0].status, 'complete');
});
test('contradictory overseas dispatch evidence is not verified as domestic', (t) => {
  const f = fixture(t, 1), { o, ev, file, dump } = addEvidence(f);
  writeJson(f.dir, file, { ...dump, text: dump.text + '\n해외 출고' });
  ev.sellers[o.id].dispatchEvidence = quote(file, 'text', '해외 출고'); writeJson(f.dir, 'agent-evidence.json', ev);
  assert.equal(verifySellers(f.ctx(), f.offers)[0].status, 'hold');
});
test('initial input failure records both stage and structured incident', (t) => {
  const f = fixture(t, 0), driver = fileURLToPath(new URL('../run-all.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [driver, f.dir, '--no-preflight'], { encoding: 'utf8', timeout: 10000 });
  assert.notEqual(r.status, 0); assert.equal(readJson(f.dir, 'stage.json')?.status, 'failed');
  assert.ok(readJson(f.dir, 'incident.json')?.current); assert.equal(fs.existsSync(path.join(f.dir, '.cream-run.lock')), false);
});
test('API replay uses saved cards without making any network request', (t) => {
  const f = fixture(t, 1); writeJson(f.dir, 'k50-ids.json', ['123']);
  const products = readJson(f.dir, 'k50.json'); products[0].q1 = MODEL; writeJson(f.dir, 'k50.json', products);
  const saved = readJson(f.dir, 'n-cards.json');
  const guard = path.join(f.dir, 'no-network.mjs'); fs.writeFileSync(guard, "globalThis.fetch = async () => { throw new Error('TEST_NETWORK_FORBIDDEN'); };\n");
  const driver = fileURLToPath(new URL('../run-all.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [driver, f.dir, '--replay', '--skip-kream', '--naver-api'], { encoding: 'utf8', timeout: 15000,
    env: { ...process.env, NAVER_CLIENT_ID: 'test', NAVER_CLIENT_SECRET: 'test', NODE_OPTIONS: `--import=${pathToFileURL(guard).href}` } });
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(readJson(f.dir, 'n-cards.json'), saved);
});
test('batch mode cannot stop fallback on single-unit profit without quantity evidence', async (t) => {
  const f = fixture(t, 2); addEvidence(f);
  writeJson(f.dir, 'agent-policy.json', { ...readJson(f.dir, 'agent-policy.json'), purchaseMode: 'multiple-units', totalBudget: 1000000, minBatchProfit: 10000 });
  const r = await runAgents(f.dir, { now: NOW });
  assert.equal(r.final.rows.filter(row => row['판정'] === '후보').length, 0);
  assert.equal(r.fallback.jobs.length, 1);
  assert.ok(readJson(f.dir, 'batch-scenarios.json').items.length > 0);
  assert.ok(readJson(f.dir, 'audit.json').items.some(item => item.issues.some(i => i.code === 'BATCH_UNCONFIRMED')));
});

test('candidates introduced during AI review require a new review', (t) => {
  const f = fixture(t, 1), final = { rows: [{ '옵션ID': 'new-option', '판정': '후보', '검증상태': 'verified', '검증사유코드': '', '사유': '' }] };
  applyLlmReview(final, { findings: [], errors: [] });
  assert.equal(final.rows[0]['판정'], '사람 검토'); assert.match(final.rows[0]['검증사유코드'], /LLM_INCOMPLETE/);
});
