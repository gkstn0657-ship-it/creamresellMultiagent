import test from 'node:test';
import assert from 'node:assert/strict';
import { batchScenario } from '../agents-batch.mjs';
import { profit, saleFee } from '../agents-core.mjs';
import { collectOffers, isNaverStore } from '../agents-offers.mjs';
import { evaluateBatches } from '../agents-batch.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const policy = { feeRate: .06, sellerFixedFee: 2500, feeVatRate: .1, feeCap: 300000, outboundShipping: 3000, packingCost: 1000,
  maxPurchasePrice: 1000000, totalBudget: 1000000, minBatchProfit: 10000, stressPriceDrop: .05 };
const input = { quantity: 10, unitCost: 10000, inboundShipping: 3000, salePrice: 20000, stockCap: 10, purchaseLimit: 10,
  salesCap: 10, salesCapConfirmed: true, salesCapEvidence: 'fixture: confirmed depth and target period', offerVerified: true };
test('low priced units can pass by total profit, with per-unit fees and one acquisition shipment', () => {
  assert.equal(saleFee(20000, policy), 4070);
  const s = batchScenario(input, policy);
  assert.equal(s.cashProfit, 16300); assert.equal(s.stressProfit, 6960); assert.equal(s.status, 'hold');
  const viable = batchScenario({ ...input, salePrice: 22000 }, policy);
  assert.ok(viable.unitCashProfit < 10000); assert.equal(viable.status, 'scenario-passed');
});
test('point caps, quantity limits and market evidence cannot be inferred from a listing', () => {
  const s = batchScenario({ ...input, quantity: 20, salesCapConfirmed: false, pointsQuote: { totalPoints: 100000, verified: true } }, policy);
  assert.equal(s.totalPoints, null); assert.equal(s.status, 'hold'); assert.ok(s.issues.some(x => x.includes('구매 가능 수량 초과')));
});
test('fee cap is per sale and VAT/basic/packing fees affect cheap goods', () => {
  assert.equal(saleFee(10000000, policy), 300000);
  assert.ok(profit(20000, 10000, policy) < profit(20000, 10000, { ...policy, sellerFixedFee: 0, feeVatRate: 0, packingCost: 0 }));
});
test('explicit unlimited total capital still requires stock and sales evidence', () => {
  const s = batchScenario({ ...input, salePrice:22000 }, { ...policy, totalBudget:null, totalBudgetUnlimited:true });
  assert.equal(s.status, 'scenario-passed');
  assert.equal(batchScenario({ ...input, stockCap:null }, { ...policy, totalBudget:null, totalBudgetUnlimited:true }).status, 'hold');
  assert.ok(batchScenario(input, { ...policy, totalBudget:null }).issues.includes('총 매입 예산 미확인'));
});
test('Naver preference accepts exact product hosts and still requires seller verification downstream', () => {
  assert.equal(isNaverStore('https://smartstore.naver.com/store/products/123'), true);
  assert.equal(isNaverStore('https://smartstore.naver.com.evil.example/store/products/123'), false);
  const ctx = { policy: { allowNaverStores: true, preferNaverStores: true }, products: [{ id:'1', model:'SX7676-100', n:30, title:'나이키 화이트' }], catalogs: {},
    cards: { 1:{ matched:[{title:'SX7676-100 화이트',price:10000,mall:'SSG',link:'https://ssg.com/item/1'},
      {title:'SX7676-100 화이트',price:11000,mall:'판매자',link:'https://smartstore.naver.com/store/products/123'}] } } };
  assert.equal(collectOffers(ctx)[0].naverStore, true);
  assert.equal(collectOffers({ ...ctx, policy: {} }).length, 1);
});
test('verified single units with unknown batch evidence are held without inventing quantities', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-batch-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const row = { '옵션ID': 'one', '매입가(원)': 10000, '크림시세(원)': 22000, '판매처 배송비(원)': 0, '검증상태':'verified', '판정':'후보', '검증사유코드':'' };
  const result = evaluateBatches({ dir, now:'2026-11-08T00:00:00Z', policy:{...policy, purchaseMode:'multiple-units'} }, { rows:[row] });
  assert.equal(row['판정'], '사람 검토'); assert.equal(result.items[0].scenarios.length, 6);
  assert.ok(result.items[0].scenarios.every(s => s.status === 'hold'));
});
