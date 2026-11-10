import { money, profit, validateQuote, sizeInQuote } from '../../renew/Cream/kream-tools/agents-core.mjs';

export function validPointsSpend(points, size, dump, file, cashMerchandiseCost) {
  if (!money(points?.value) || !validateQuote(points.evidence, dump, file) || !sizeInQuote(size, points.evidence.quote)) return false;
  const matches = [...points.evidence.quote.matchAll(/(?:적립금|마일리지)\s*(?:사용|차감)\s*[:：]?\s*([\d,]+)\s*원/g)];
  if (points.value > 0 && cashMerchandiseCost !== undefined) {
    const cash = points.evidence.quote.match(/상품\s*현금\s*결제액\s*[:：]?\s*([\d,]+)\s*원/);
    if (!cash || Number(cash[1].replaceAll(',', '')) !== cashMerchandiseCost) return false;
  }
  return matches.length === 1 && Number(matches[0][1].replaceAll(',', '')) === points.value &&
    !/(?:예상|예정|가능|최대|신규)\s*(?:적립금|마일리지)|(?:사용|차감)\s*(?:예정|가능)/.test(points.evidence.quote);
}

const HEADINGS = { '상품쿠폰': 'product_coupon', '장바구니쿠폰': 'cart_coupon', '등급할인': 'membership_discount',
  '적립금': 'existing_points', '마일리지': 'existing_points', '선할인': 'advance_discount', '결제즉시할인': 'payment_discount' };
const amount = text => { const m = String(text).match(/-?\s*(\d[\d,]*)\s*원/); return m ? Number(m[1].replaceAll(',', '')) : null; };

export function parseNo1Benefits(raw) {
  const lines = (raw?.benefitConditionsVerbatim || []).map(String), items = [];
  const baseIndex = lines.findIndex(line => /^정상가(?:\s|$)/.test(line));
  const basePrice = baseIndex >= 0 ? amount(lines[baseIndex]) ?? amount(lines[baseIndex + 1]) : null;
  for (let i = 0; i < lines.length; i++) {
    if (!HEADINGS[lines[i]]) continue;
    let end = i + 1;
    while (end < lines.length && !HEADINGS[lines[end]] && !/^결제금액(?:\s|$)/.test(lines[end])) end++;
    const text = lines.slice(i, end).join('\n'), values = lines.slice(i + 1, end).map(amount).filter(x => x != null);
    const excluded = /사용 제외|쓸 수 있는 쿠폰 없음|사용 불가|적용 불가/.test(text);
    items.push({ index: items.length, type: HEADINGS[lines[i]], label: lines[i], amount: excluded ? 0 : values.length === 1 ? values[0] : null,
      excluded, eligibility: excluded ? 'ineligible' : 'unknown', quote: text });
    i = end - 1;
  }
  const cashCost = money(raw?.maximumBenefitPriceKrw) ? raw.maximumBenefitPriceKrw : null;
  const allAmountsKnown = items.every(item => money(item.amount));
  const reconciled = money(basePrice) && cashCost != null && items.length > 0 && allAmountsKnown &&
    basePrice - items.reduce((n, item) => n + item.amount, 0) === cashCost;
  const points = items.filter(item => item.type === 'existing_points');
  // If the breakdown is incomplete, do not silently assume that no points were spent.
  const pointsUsed = reconciled && points.every(item => money(item.amount)) ? points.reduce((n, item) => n + item.amount, 0) : null;
  return { source: 'No1 visible benefit breakdown', capturedAt: raw?.capturedAt || null, basePrice,
    cashCostEstimate: cashCost, pointsUsedEstimate: pointsUsed,
    economicCostEstimate: cashCost != null && pointsUsed != null ? cashCost + pointsUsed : null,
    breakdownReconciled: reconciled, items, actualCheckoutPriceConfirmed: false,
    accountEligibilityConfirmed: false, remainingCapsConfirmed: false, newPointsEarned: null, loginRequired: raw?.benefitStatus === 'login-required',
    issues: [...(raw?.benefitStatus === 'login-required' ? ['NO1_BENEFITS_LOGIN_REQUIRED'] : []), ...(!reconciled ? ['BENEFIT_BREAKDOWN_UNRECONCILED'] : []), 'CHECKOUT_REQUIRED', 'ACCOUNT_BENEFIT_LIMITS_UNCONFIRMED'] };
}

export function benefitScenario(benefits, salePrice, shipping, policy) {
  const cash = benefits.cashCostEstimate, economic = benefits.economicCostEstimate;
  const delivery = money(shipping) ? shipping : 0;
  return { priceType: 'maximum-benefit-estimate', salePrice, sourceShippingKnown: money(shipping),
    cashProfitEstimate: money(salePrice) && money(cash) ? profit(salePrice, cash + delivery, policy) : null,
    economicProfitEstimate: money(salePrice) && money(economic) ? profit(salePrice, economic + delivery, policy) : null,
    existingPointsUsedEstimate: benefits.pointsUsedEstimate, newPointsEarned: null, promotionAllowed: false };
}
