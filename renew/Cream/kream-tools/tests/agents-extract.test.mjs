import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPageEvidence } from '../agents-extract.mjs';
import { validateQuote } from '../agents-core.mjs';
const file = 'dump-N123-abcdef-prod.json';
const panel = '판매자 정보\n상호명: 테스트상점\n사업자등록번호: 123-45-67890\n실제 판매자 테스트상점은 통신판매중개 입점 판매자\n국내 출고\n반품 가능 7일\n구매 영수증 발급 가능\n고객센터\n상호명: 플랫폼운영사';
const make = (host) => ({ at: '2026-11-08T03:00:00Z', url: `https://${host}/product`, title: 'TEST-MODEL', text: '옵션 S / 판매가 120,000원\n배송비 무료\n' + panel,
  stockProbe: { results: [{ size: 'S', optionKey: 's1', state: 'available', maxQty: 1 }] } });
for (const [host, adapter] of [['www.ssg.com','ssg'],['m.web.mustit.co.kr','mustit'],['www.trenbe.com','trenbe']]) test(`${adapter}: scoped price, shipping, seller panel and footer isolation`, () => {
  const dump = make(host), r = extractPageEvidence(dump, file);
  assert.equal(r.adapter, adapter); assert.equal(r.offers.S.unitPrice.value, 120000); assert.equal(r.offers.S.shipping.value, 0);
  assert.equal(r.seller.name, '테스트상점'); assert.equal(r.seller.domestic, true); assert.equal(r.seller.role, 'marketplace');
  assert.equal(validateQuote(r.seller.identityEvidence, dump, file), true);
});
test('selected-row snapshot retains per-option evidence after the page switches options', () => {
  const dump = make('www.ssg.com'); dump.text = '현재 옵션 M\n배송비 무료\n' + panel;
  dump.stockProbe.results[0] = { ...dump.stockProbe.results[0], offerText: '옵션 S / 단가 130,000원', offerQuantity: 1 };
  const r = extractPageEvidence(dump, file); assert.equal(r.offers.S.unitPrice.value, 130000);
  assert.equal(validateQuote(r.offers.S.unitPrice.evidence, dump, file), true);
  assert.equal(validateQuote({ ...r.offers.S.unitPrice.evidence, size: 'M' }, dump, file), false);
});
test('conditional shipping, option-less prices and platform footer alone stay unresolved', () => {
  const dump = make('www.trenbe.com'); dump.text = '판매가 120,000원\n배송비 10만원 이상 무료\n회사소개\n상호명: 플랫폼운영사';
  const r = extractPageEvidence(dump, file); assert.deepEqual(r.offers, {}); assert.equal(r.seller, null);
});
test('ambiguous per-option prices, totals with quantity > 1 and blocked pages are not promoted', () => {
  const dump = make('www.ssg.com'); dump.text = '배송비 무료'; dump.stockProbe.results[0] = { size: 'S', optionKey: 's1', state: 'available', offerText: '옵션 S / 총금액 240,000원', offerQuantity: 2 };
  assert.deepEqual(extractPageEvidence(dump, file).offers, {});
  dump.blocked = true; assert.deepEqual(extractPageEvidence(dump, file).offers, {});
  dump.url = 'https://notssg.com/product'; assert.equal(extractPageEvidence(dump, file).adapter, null);
});
