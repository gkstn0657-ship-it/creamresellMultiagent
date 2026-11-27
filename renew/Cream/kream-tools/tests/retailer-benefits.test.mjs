import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedOptionBenefits, retailerBenefitNotes, benefitColumns } from '../retailer-benefits.mjs';

const file = 'dump-N1-prod.json';
const row = { size: 'M', state: 'available', offerQuantity: 1, optionKey: 'm' };
const purchase = '옵션 M / 할인 전 판매가 90,000원 / 쿠폰 적용 완료 / 상품 결제가 80,000원 / 구매확정 기본 적립 800P';

test('a discounted option can never lose its coupon twice', () => {
  const result = confirmedOptionBenefits({ ...row, offerText: purchase }, file, 80000);
  assert.equal(result.payablePrice, 80000); assert.equal(result.points, 800); assert.equal(result.discount, 10000);
  const again = confirmedOptionBenefits({ ...row, offerText: purchase }, file, 70000);
  assert.equal(again.payablePrice, 70000); assert.equal(again.discount, null);
  for (const change of [{size:'S'}, {state:'unknown'}, {offerQuantity:2}, {offerText:purchase+' 최대 예상'}, {offerText:purchase+' 포인트 사용 100원'}]) {
    const x = confirmedOptionBenefits({ ...row, offerText: purchase, ...change }, file);
    assert.equal(x.discount, null); assert.equal(x.points, null);
  }
});

test('marketing, review rewards and existing balance are not confirmed new points', () => {
  const dump = { text: '최대 적립 포인트 26,550원\n쿠폰 10% 할인\n5만원 이상 구매\n최대 3천원 한도\n보유 포인트 31,010원\n김**님 카드 혜택\n리뷰 적립 최대 300원' };
  const notes = retailerBenefitNotes(dump, file);
  const result = benefitColumns(notes, file, {}, 4000, 90000);
  assert.match(result['판매처 혜택·조건'], /한도/); assert.doesNotMatch(result['판매처 혜택·조건'], /31,010|김\*\*/);
  assert.equal(result['확인 적립금(원)'], ''); assert.equal(result['포인트 포함 순수익(원)'], '');
  assert.deepEqual(retailerBenefitNotes({ ...dump, blocked:true }, file), []);
});

test('old page snapshots need one explicitly labelled option and quantity for a benefit', () => {
  const observed = {size:'M',state:'available'};
  const line = '수량 1개 / ' + purchase;
  const result = confirmedOptionBenefits(observed, file, null, line);
  assert.equal(result.payablePrice, 80000); assert.equal(result.evidence.field, 'text');
  for (const ambiguous of [purchase, line+' / 옵션 S', line+' / 수량 3개', line+'\n'+line]) {
    assert.equal(confirmedOptionBenefits(observed, file, null, ambiguous).payablePrice, null);
  }
});

test('basic confirmed earning can be counted without a coupon or advertised maximum', () => {
  const sale = '옵션 M / 상품 결제가 80,000원 / 구매확정 시 기본 적립 800P';
  const result = confirmedOptionBenefits({ ...row, offerText:sale }, file);
  assert.equal(result.payablePrice, 80000); assert.equal(result.points, 800); assert.equal(result.discount, null);
  const marketing = confirmedOptionBenefits({ ...row, offerText:sale+' / 멤버십 전용' }, file);
  assert.equal(marketing.points, null);
});

test('minimum spend, cap and validity are checked on an applied goods quote', () => {
  const params = ' / 80,000원 이상 구매 / 최대 12,000원 할인 / 유효기간 2026.11.01~2026.11.30';
  const calc = (terms, now) => confirmedOptionBenefits({ ...row, offerText:purchase+terms }, file, null, '', now);
  assert.equal(calc(params, '2026-11-22T02:00:00Z').discount, 10000);
  for (const [terms, now] of [[params,'2026-11-30T15:00:00Z'],[params.replace('80,000원','150,000원'),'2026-11-22T02:00:00Z'],
    [params.replace('12,000원','5,000원'),'2026-11-22T02:00:00Z'],[params+' / 신규회원만','2026-11-22T02:00:00Z']]) {
    assert.equal(calc(terms, now).discount, null);
  }
});
