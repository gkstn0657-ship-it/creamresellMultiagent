import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { context, DEFAULT_POLICY, readJson, writeJson } from '../agents-core.mjs';
import { screenListing, screenInitialMargins, planMarginCatalogs, planMarginPages } from '../margin-screen.mjs';
import { collectOffers, trustedMall } from '../agents-offers.mjs';
import { runAgents } from '../agents-run.mjs';
import { teamFixture } from './team-fixture.mjs';

const NOW = '2026-11-09T03:00:00.000Z';
const policy = { ...DEFAULT_POLICY, costPolicyConfirmed: true, feeRate: 0.06, sellerFixedFee: 2500, feeVatRate: 0.1, packingCost: 1000, stressPriceDrop: 0.05 };
const product = { id: '123', model: '801563051-A0029', title: '스톤아일랜드 801563051-A0029 블랙', n: 20, kreamMed: 100000 };
const offer = { title: product.title, keyMatch: true, colorMatch: true, price: 100000, shipFee: 0, link: 'https://shop.example/product/1', topMalls: [{ mall: '롯데ON' }] };
const dump = (groups = [['S', 100000, 5], ['L', 140000, 3]]) => ({ at: NOW, text: '거래일\n' + groups.flatMap(([size, price, count]) => Array.from({ length: count }, () => `${size}\n${price.toLocaleString('en-US')}원\n오늘`)).join('\n') });
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-margin-'));
  t.after(() => { assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
function fixture(t, offers = [offer]) {
  const dir = temp(t);
  writeJson(dir, 'k50.json', [product]); writeJson(dir, 'agent-policy.json', policy);
  writeJson(dir, 'n-cards.json', { 123: { name: product.title, matched: offers } });
  writeJson(dir, 'dump-K123.json', dump());
  return dir;
}

test('mixed-size loss retains profitable size and charges the complete stored cost policy', () => {
  const result = screenListing(product, offer, dump(), policy, NOW);
  assert.equal(result.mixedProfit, -13350);
  assert.equal(result.status, 'potential');
  assert.deepEqual(result.potentialOptions.map((o) => o.size), ['L']);
  assert.equal(result.potentialOptions[0].estimatedProfit, 24010);
  assert.equal(result.potentialOptions[0].saleFee, 11990);
  assert.equal(result.potentialOptions[0].stressProfit, 17472);
  assert.equal(result.promotionAllowed, false);
});

test('missing, stale, blocked, sparse or unknown-price data stays unverified', () => {
  for (const [source, market] of [[offer, null], [offer, { ...dump(), at: '2026-10-01T03:00:00Z' }],
    [offer, { ...dump(), blocked: true }], [offer, dump([['L', 140000, 2]])], [{ ...offer, price: null }, dump()]]) {
    const result = screenListing(product, source, market, policy, NOW);
    assert.equal(result.status, 'needs_verification'); assert.equal(result.promotionAllowed, false);
  }
  const unknownShipping = screenListing(product, { ...offer, shipFee: null }, dump(), policy, NOW);
  assert.equal(unknownShipping.sourceShippingKnown, false);
  assert.ok(unknownShipping.reasons.includes('SOURCE_SHIPPING_UNCONFIRMED'));
});

test('fresh observed losses are low potential; wrong colors and used listings are ineligible', () => {
  assert.equal(screenListing(product, { ...offer, price: 200000 }, dump(), policy, NOW).status, 'low_potential');
  for (const source of [{ ...offer, title: `중고 ${offer.title}` }, { ...offer, colorMatch: false }, { ...offer, overseas: true }]) {
    assert.equal(screenListing(product, source, dump(), policy, NOW).status, 'ineligible');
  }
  assert.equal(screenListing(product, offer, dump(), { ...policy, costPolicyConfirmed: false }, NOW).status, 'needs_verification');
});

test('insufficient samples and relative dates are never converted into sufficient current evidence', () => {
  const result = screenListing(product, offer, dump([['S', 90000, 4], ['L', 140000, 2]]), policy, NOW);
  assert.equal(result.status, 'needs_verification'); assert.equal(result.potentialOptions.length, 0);
  const old = screenListing(product, offer, { ...dump(), at: '2026-09-01T03:00:00Z' }, policy, NOW);
  assert.equal(old.options.length, 0);
});

test('profitable size survives catalog and detail-page selection with guarded stock probing', (t) => {
  const catalog = { ...offer, isCatalog: true, price: 105000, shipFee: null, link: 'https://catalog.example/item/1' };
  const dir = fixture(t, [offer, catalog]);
  writeJson(dir, 'n-cat.json', { 123: { offerList: [{ ...offer, mall: '롯데ON', topMalls: [] }] } });
  const ctx = context(dir, { now: NOW }), screen = screenInitialMargins(ctx);
  assert.equal(screen.shortlist.length, 1); assert.ok(screen.shortlist[0].best.net > 0);
  assert.equal(planMarginCatalogs(screen)[0].url, catalog.link);
  const jobs = planMarginPages(ctx, screen, { trustedMall, maxReferencePages: 0 });
  assert.equal(jobs.length, 1); assert.deepEqual(jobs[0].potentialSizes, ['L']);
  assert.deepEqual(jobs[0].actions, [{ stockProbe: true }]);
});

test('missing search is counted separately and untrusted reference page cap is preserved', (t) => {
  const dir = fixture(t, [{ ...offer, topMalls: [{ mall: 'unknown' }] }]);
  writeJson(dir, 'k50.json', [product, { ...product, id: '456' }]);
  const ctx = context(dir, { now: NOW }), screen = screenInitialMargins(ctx);
  assert.equal(screen.summary.products, 2); assert.equal(screen.summary.searched, 1);
  assert.deepEqual(screen.products[1].reasons, ['SEARCH_MISSING']);
  assert.equal(planMarginPages(ctx, screen, { trustedMall, maxReferencePages: 0 }).length, 0);
  assert.equal(planMarginPages(ctx, screen, { trustedMall, maxReferencePages: 1 }).length, 1);
});

test('parser removes used/wrong-color cards before top three and retains all eligible sources downstream', (t) => {
  const dir = fixture(t);
  const titles = [`중고 ${product.title}`, product.title.replace('A0029', 'V0020'), ...Array.from({ length: 5 }, (_, i) => `${product.title} 상품 ${i}`)];
  const text = titles.flatMap((title, i) => ['찜하기1', `${title}\n${(90000 + i * 1000).toLocaleString('en-US')}원\n배송비\n무료`, '롯데ON정보']).join('\n\t\n');
  writeJson(dir, 'dump-N123-s.json', { text, links: titles.map((title, i) => ({ t: title, h: `https://cr.shopping.naver.com/adcr?id=${i}` })) });
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../parse-si.mjs', import.meta.url)), dir, 'N', 'k50.json', 'n-cards.json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const cards = readJson(dir, 'n-cards.json')['123'];
  assert.equal(cards.matched.length, 3); assert.equal(cards.eligibleMatches.length, 5);
  assert.ok(cards.eligibleMatches.every((item) => !item.title.includes('중고') && item.colorMatch !== false));
  assert.equal(collectOffers(context(dir, { now: NOW })).length, 5);
});

test('size opportunity cannot promote without option checkout, stock and seller evidence', async (t) => {
  const dir = temp(t); teamFixture(dir, NOW);
  writeJson(dir, 'k50.json', [{ ...product, kreamMed: 100000 }]);
  writeJson(dir, 'dump-K123.json', dump([['S', 200000, 5]]));
  writeJson(dir, 'agent-evidence.json', { offers: {}, sellers: {} });
  const ctx = context(dir, { now: NOW });
  assert.equal(screenInitialMargins(ctx).products[0].status, 'potential');
  const { final } = await runAgents(dir, { now: NOW, runId: 'margin-test' });
  assert.equal(final.rows.filter((row) => row['판정'] === '후보').length, 0);
  assert.ok(final.rows.some((row) => row['판정'] === '사람 검토'));
});

test('legacy report uses policy costs and retains a mixed-loss size opportunity for final audit', (t) => {
  const dir = fixture(t);
  const captured = new Date().toISOString();
  writeJson(dir, 'dump-K123.json', { ...dump(), at: captured });
  writeJson(dir, 'n-cat.json', {});
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../build-final-auto.mjs', import.meta.url)), dir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const row = readJson(dir, 'final-all.json').rows[0];
  assert.equal(row['판정'], '사람 검토'); assert.equal(row['예상순수익(원)'], 24010);
  assert.match(row['시세기준'], /L 최근 30일/);
});
