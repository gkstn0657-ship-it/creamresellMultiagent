import { money, normalizeSize, quote, sizeInQuote } from './agents-core.mjs';

const paymentRestriction = /(?:카드|결제).{0,10}(?:점검|불가)|계좌이체.{0,10}(?:선택|전용|만\s*가능)/;
const benefit = /쿠폰|할인|혜택가|적립|포인트|캐시백|회원가|카드.{0,18}(?:예상가|결제\s*시)/;
const terms = /결제\s*시|멤버십|첫\s*구매|중복|최소|이상\s*구매|한도|유효|만료|까지|기간|제외|회원\s*전용|\d{4}[-.]\d{1,2}[-.]\d{1,2}\s*[~～]/;
const numericLine = /^(?:원|%|[-+~\s]*[\d,.]+\s*(?:원|P|%|포인트)?(?:\s*(?:적립|할인))?)$/i;
const privateLine = /(?:[\w.-]+@[\w.-]+|\d{2,3}-\d{3,4}-\d{4}|\*{2,}|\S+님(?:의|께)|보유\s*(?:포인트|적립금)|사용\s*가능\s*잔액)/;

// Keep the merchant's wording and nearby monetary or eligibility lines. These are
// informational, including maximums, deferred card discounts and review rewards.
export function retailerBenefitNotes(dump, file, model = '') {
  if (!dump || dump.blocked || dump.failed) return [];
  const all = String(dump.text || '').split('\n');
  const modelCode = String(model).toUpperCase().replace(/[-\s]/g, '');
  const header = modelCode.length > 4 ? all.findIndex(s => s.toUpperCase().replace(/[-\s]/g, '').includes(modelCode)) : -1;
  const lines = all.slice(Math.max(0, header));
  const notes = new Map();
  for (const text of all.slice(0, Math.max(0, header))) {
    if (text.length <= 240 && paymentRestriction.test(text) && !privateLine.test(text)) notes.set(text, quote(file, 'text', text));
  }
  for (let i = 0; i < lines.length && notes.size < 32; i++) {
    const line = lines[i].trim();
    if (/^(?:카테고리\s*인기상품|함께\s*(?:본|구매한)\s*상품|관련\s*상품|추천\s*상품|상품제공정보고시|상품문의하기|LIST WRITE)(?:\s|$)/.test(line) ||
        (header >= 0 && i > 0 && /(?:카테고리|브랜드|스토어|패딩)\s*인기상품$/.test(line))) break;
    if (!(benefit.test(line) || paymentRestriction.test(line)) || privateLine.test(line) || line.length > 240) continue;
    let end = i + 1;
    while (end < lines.length && end <= i + 3) {
      const next = lines[end].trim();
      if (next && (privateLine.test(next) || next.length > 180 || !(numericLine.test(next) || terms.test(next)))) break;
      end++;
    }
    const text = lines.slice(i, end).join('\n').trim();
    if (!/[\d%]|무료|전용|확정|조건|신규|회원|기본|추가|리뷰|로그인|결제|중복|한도|만료/.test(text) && !paymentRestriction.test(text)) continue;
    notes.set(text, quote(file, 'text', text));
  }
  return [...notes.values()];
}

const amount = '(\\d{1,3}(?:,\\d{3})+|\\d+)';
const readAmount = (text, label, unit = '원') => {
  const matches = [...text.matchAll(new RegExp(label + '[ \\t:：]*' + amount + '\\s*(?:' + unit + ')(?![\\d,.])', 'gi'))];
  const values = new Set(matches.map(m => Number(m[1].replaceAll(',', ''))));
  return values.size === 1 ? [...values][0] : null;
};

function supportedTerms(text, base, paid, observedAt) {
  let eligible = true;
  const rest = text
    .replace(/([\d,]+)\s*원\s*이상\s*구매/g, (_, n) => {
      eligible &&= money(base) && base >= Number(n.replaceAll(',', ''));
      return '';
    })
    .replace(/최대\s*([\d,]+)\s*원\s*할인(?:\s*한도)?/g, (_, n) => {
      eligible &&= money(base) && money(paid) && base - paid <= Number(n.replaceAll(',', ''));
      return '';
    })
    .replace(/유효기간\s*[:：]?\s*(\d{4}[-.]\d{2}[-.]\d{2})\s*[~～]\s*(\d{4}[-.]\d{2}[-.]\d{2})(?![\d:])/g, (_, start, end) => {
      const stamp = Date.parse(observedAt);
      const day = Number.isFinite(stamp) ? new Date(stamp + 9 * 3600000).toISOString().slice(0, 10) : '';
      const dates = [start, end].map(v => v.replaceAll('.', '-'));
      eligible &&= Boolean(day) && dates.every(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().startsWith(v)) &&
        dates[0] <= day && day <= dates[1];
      return '';
    });
  return eligible && !/최대|예시|예상|적용\s*(?:시|전|가능|예정|하면|불가)|카드|청구|캐시백|리뷰|(?:포인트|적립금)[\s\d,P원]*사용|조건부|미적용|배송비\s*포함|장바구니|총\s*결제|가정|대상자|이상|한도|멤버십|회원|로그인|할인\s*시|첫\s*구매|첫\s*주문|기간|만료|까지|선착순|소진|충전\s*결제|중복|유효|\d{4}[./-]\d{1,2}|\d{1,2}:\d{2}/.test(rest);
}

// A one-unit selected-option row can establish a payable item price without
// replaying the purchase. Never subtract a banner coupon from a listing price.
export function confirmedOptionBenefits(row, file, knownUnitPrice = null, body = '', observedAt = null) {
  const result = { basePrice: knownUnitPrice, payablePrice: knownUnitPrice, discount: null, points: null, evidence: null };
  if (!['available', 'limit'].includes(row?.state)) return result;
  const size = normalizeSize(row.size);
  let field = 'stockProbe.results.offerText';
  let text = row.offerQuantity === 1 ? row.offerText : null;
  if (!text) {
    // Older collectors preserve the rendered page. Only a single unequivocal
    // size-and-quantity line is interchangeable with a selected-row snapshot.
    const matches = body.split('\n').filter(line => {
      const labels = [...line.matchAll(/(?:옵션|사이즈)\s*[:：]?\s*([A-Z0-9.]+)/gi)];
      const quantities = [...line.matchAll(/수량\s*[:：]?\s*(\d+)\s*개/g)];
      return labels.length === 1 && normalizeSize(labels[0][1]) === size && quantities.length === 1 &&
        quantities[0][1] === '1' && /적립|쿠폰|즉시\s*할인/.test(line) && line.length <= 500;
    });
    if (matches.length !== 1) return result;
    field = 'text';
    text = matches[0];
  }
  if (typeof text !== 'string' || text.length > 500 || !sizeInQuote(size, text)) return result;
  const base = readAmount(text, '(?:할인\\s*전\\s*(?:상품가|판매가)|기본\\s*판매가|정상\\s*판매가)');
  const paid = readAmount(text, '(?:최종\\s*상품가|할인\\s*후\\s*상품가|상품\\s*결제가)');
  if (!supportedTerms(text, base, paid, observedAt)) return result;
  const applied = /(?:쿠폰|즉시\s*할인)\s*(?:자동\s*)?적용\s*(?:완료|됨)/.test(text);
  if (applied && money(base) && money(paid) && paid > 0 && base >= paid &&
      (knownUnitPrice == null || knownUnitPrice === base || knownUnitPrice === paid)) {
    result.basePrice = base;
    result.payablePrice = paid;
    result.discount = base - paid;
  }
  if (!applied && money(paid) && paid > 0 && !/쿠폰|즉시\s*할인/.test(text) &&
      (knownUnitPrice == null || knownUnitPrice === paid)) result.payablePrice = paid;
  // Bind rewards to the actual item cost as well as size and quantity. Do not
  // count rates, existing balance, tier bonuses or a store-wide ceiling.
  const basis = readAmount(text, '(?:적립\\s*기준\\s*(?:상품가|금액))');
  const points = readAmount(text, '(?:구매\\s*확정\\s*(?:시\\s*)?기본\\s*적립(?:금|\\s*포인트)?|기본\\s*적립(?:금|\\s*포인트)?\\s*(?:지급\\s*)?확정)', '원|P|포인트');
  if (money(points) && result.payablePrice > 0 && (basis ?? paid) === result.payablePrice) result.points = points;
  if (result.discount != null || result.points != null || (!applied && result.payablePrice === paid && paid > 0)) {
    result.evidence = { ...quote(file, field, text), size, optionKey: row.optionKey || null };
  }
  return result;
}

export function benefitColumns(notes, file, confirmed = {}, net = null, cost = null) {
  const credited = confirmed.points;
  const total = net != null && money(credited) ? net + credited : null;
  return {
    '할인 전 옵션가(원)': confirmed.basePrice ?? '', '확인 쿠폰·즉시할인(원)': confirmed.discount ?? '',
    '확인 적립금(원)': credited ?? '', '포인트 포함 순수익(원)': total ?? '',
    '포인트 포함 수익률(%)': total != null && cost > 0 ? +(total / cost * 100).toFixed(1) : '',
    '판매처 혜택·조건': [...new Set([...(confirmed.evidence ? [confirmed.evidence] : []), ...notes].map(n => n.quote.replace(/\s+/g, ' ')))].join(' · '),
    '혜택 근거': notes.length || confirmed.evidence ? file : '',
  };
}
