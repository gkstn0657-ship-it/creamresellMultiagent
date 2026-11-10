import { money, profit, readJson, writeJson, envelope, validateQuote, sizeInQuote, moneyInQuote, fresh, tradesFromDump } from './agents-core.mjs';

export function validBatchConditions(ev, quantity, verified, dump, file, ctx) {
  if (!ev || !verified || !fresh(dump?.at, ctx.now, ctx.policy.freshnessMinutes)) return false;
  const shipping = ev.inboundShippingByQuantity?.[quantity], size = verified.size;
  const quantityPattern = new RegExp(`수량\\s*[:：]?\\s*${quantity}(?:\\s*개|(?=\\s|/|$))`);
  if (!money(shipping?.value) || !validateQuote(shipping.evidence, dump, file) || !sizeInQuote(size, shipping.evidence.quote) ||
      !quantityPattern.test(shipping.evidence.quote) || !/배송비/.test(shipping.evidence.quote) || !moneyInQuote(shipping.value, shipping.evidence)) return false;
  for (const [key, label] of [['stockCap','(?:구매 가능|재고) 수량'],['purchaseLimit','(?:구매 제한|최대 구매) 수량']]) {
    const ref = ev[`${key}Evidence`];
    if (!Number.isSafeInteger(ev[key]) || ev[key] < 0 || !validateQuote(ref, dump, file) || !sizeInQuote(size, ref.quote)) return false;
    const match = ref.quote.match(new RegExp(`${label}\\s*[:：]?\\s*(\\d+)\\s*개`));
    if (!match || Number(match[1]) !== ev[key]) return false;
  }
  const marketFile = `dump-K${verified.pid}.json`, market = readJson(ctx.dir, marketFile), demand = ev.salesCapEvidence;
  if (!Number.isSafeInteger(ev.salesCap) || ev.salesCap < 0 || !Number.isSafeInteger(ev.salesWindowDays) || ev.salesWindowDays < 1 || ev.salesWindowDays > 30 ||
      ev.salesCapConfirmed !== true || typeof ev.salesCapReason !== 'string' || ev.salesCapReason.length < 10 ||
      !fresh(market?.at, ctx.now, ctx.policy.freshnessMinutes) || !validateQuote(demand, market, marketFile) || !sizeInQuote(size, demand.quote)) return false;
  const trades = tradesFromDump(market).filter(t => t.size === size && Date.parse(ctx.now) - Date.parse(t.at) >= -60000 && Date.parse(ctx.now) - Date.parse(t.at) <= 30 * 86400000);
  // This remains an explicitly labelled scenario assumption, never guaranteed demand.
  return ev.salesCap <= Math.floor(trades.length * ev.salesWindowDays / 30);
}

export function validBatchPricing(q, quantity, size, dump, file) {
  if (!q || q.quantity !== quantity || !money(q.totalMerchandiseCost) || !money(q.cashMerchandiseCost) || !money(q.existingPointsUsed) ||
      q.cashMerchandiseCost + q.existingPointsUsed !== q.totalMerchandiseCost || q.conditionsConfirmed !== true ||
      !validateQuote(q.evidence, dump, file) || !sizeInQuote(size, q.evidence.quote)) return false;
  const text = q.evidence.quote;
  const count = new RegExp(`수량\\s*[:：]?\\s*${quantity}(?:\\s*개|(?=\\s|/|$))`);
  const total = text.match(/(?:총\s*상품금액|상품\s*합계)\s*[:：]?\s*([\d,]+)\s*원/);
  const points = text.match(/(?:적립금|마일리지)\s*(?:사용|차감)\s*[:：]?\s*([\d,]+)\s*원/);
  const cash = text.match(/상품\s*현금\s*결제액\s*[:：]?\s*([\d,]+)\s*원/);
  return count.test(text) && total && Number(total[1].replaceAll(',', '')) === q.totalMerchandiseCost &&
    points && Number(points[1].replaceAll(',', '')) === q.existingPointsUsed && cash && Number(cash[1].replaceAll(',', '')) === q.cashMerchandiseCost;
}

// A scenario is never a sales forecast. Stock and market depth must be supplied
// independently; a visible trade sample is not a complete demand measurement.
export function batchScenario(input, policy) {
  const { quantity, unitCost, inboundShipping, salePrice } = input;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || !money(unitCost) || !money(inboundShipping) || !money(salePrice)) throw new Error('수량·가격·매입 배송비 확인 필요');
  const merchandise = money(input.totalMerchandiseCost) ? input.totalMerchandiseCost : quantity * unitCost;
  const existingPointsUsed = money(input.existingPointsUsed) ? input.existingPointsUsed : 0;
  const cashMerchandise = money(input.cashMerchandiseCost) ? input.cashMerchandiseCost : merchandise - existingPointsUsed;
  if (!money(cashMerchandise) || cashMerchandise + existingPointsUsed !== merchandise) throw Error('BATCH_PAYMENT_TOTAL_MISMATCH');
  const capital = cashMerchandise + inboundShipping;
  const cashProfit = quantity * profit(salePrice, 0, policy) - cashMerchandise - inboundShipping;
  const economicProfit = cashProfit - existingPointsUsed;
  const stressSale = Math.floor(salePrice * (1 - (policy.stressPriceDrop ?? 0)));
  const stressProfit = quantity * profit(stressSale, 0, policy) - merchandise - inboundShipping;
  const issues = [];
  const caps = [['stockCap', '구매 가능 수량'], ['purchaseLimit', '구매 제한 수량'], ['salesCap', '목표 기간 내 보수적 판매 가능 수량']];
  for (const [key, name] of caps) {
    if (!Number.isSafeInteger(input[key]) || input[key] < 0) issues.push(`${name} 미확인`);
    else if (quantity > input[key]) issues.push(`${name} 초과`);
  }
  if (input.salesCapConfirmed !== true || !input.salesCapEvidence) issues.push('동일 옵션 수요·기간 근거 미확인');
  if (input.offerVerified !== true) issues.push('판매처·가격·동일 옵션 검증 미완료');
  if (policy.totalBudgetUnlimited !== true) {
    if (policy.totalBudget == null) issues.push('총 매입 예산 미확인');
    else if (capital > policy.totalBudget) issues.push('총 매입 예산 초과');
  }
  if (policy.maxPurchasePrice != null && merchandise / quantity > policy.maxPurchasePrice) issues.push('개당 예산 초과');
  if (stressProfit < (policy.minBatchProfit ?? 0) || stressProfit <= 0) issues.push('합계 보수적 이익 기준 미달');
  // A maximum percent shown on a product page is insufficient. A point quote
  // must cover this exact quantity and spending amount with remaining caps.
  const q = input.pointsQuote;
  const points = q?.verified === true && q.quantity === quantity && q.purchaseAmount === merchandise && q.remainingCapsConfirmed === true && q.source && money(q.totalPoints) ? q.totalPoints : null;
  return { quantity, capital, cashProfit, economicProfit, existingPointsUsed, totalMerchandiseCost: merchandise, cashMerchandiseCost: cashMerchandise, stressProfit, unitCashProfit: +(cashProfit / quantity).toFixed(2),
    totalPoints: points, profitIncludingPoints: points == null ? null : cashProfit + points,
    status: issues.length ? 'hold' : 'scenario-passed', issues,
    limitation: '전량이 가정 매도가에 팔렸을 때의 계산. 주문·매입 추천 수량 확정 아님. 출고·포장비와 판매 수수료는 판매 단위마다 차감.' };
}

export function evaluateBatches(ctx, final) {
  if (ctx.policy.purchaseMode !== 'multiple-units') return null;
  const evidence = readJson(ctx.dir, 'batch-evidence.json', {}), items = [];
  const quantities = ctx.policy.quantitiesToCompare || [1, 3, 5, 10, 20, 50];
  for (const row of final.rows) {
    if (!row['옵션ID'] || !money(row['매입가(원)']) || !money(row['크림시세(원)'])) continue;
    const ev = evidence[row['옵션ID']] || {}, scenarios = [];
    // Shared inbound delivery is allowed only when explicitly quoted for this quantity.
    for (const quantity of quantities) {
      const delivery = ev.inboundShippingByQuantity?.[quantity];
      let shippingKnown = money(delivery?.value) && delivery?.source;
      const verified = readJson(ctx.dir, 'verified-offers.json', { items: [] }).items.find(item => item.id === row['옵션ID']);
      const file = verified?.source, dump = file ? readJson(ctx.dir, file) : null;
      const pricing = ev.pricingByQuantity?.[quantity];
      const pricingKnown = validBatchPricing(pricing, quantity, verified?.size || '*', dump, file);
      const conditionsKnown = ctx.policy.eligibilityMode !== 'option-evidence' || validBatchConditions(ev, quantity, verified, dump, file, ctx);
      if (!conditionsKnown) shippingKnown = false;
      const scenario = batchScenario({ quantity, unitCost: row['매입가(원)'], salePrice: row['크림시세(원)'],
        ...(pricingKnown ? { totalMerchandiseCost: pricing.totalMerchandiseCost, cashMerchandiseCost: pricing.cashMerchandiseCost, existingPointsUsed: pricing.existingPointsUsed } : {}),
        inboundShipping: shippingKnown ? delivery.value : quantity * (Number(row['판매처 배송비(원)']) || 0),
        stockCap: ev.stockCap, purchaseLimit: ev.purchaseLimit, salesCap: ev.salesCap,
        salesCapConfirmed: ev.salesCapConfirmed, salesCapEvidence: ev.salesCapEvidence,
        offerVerified: row['검증상태'] === 'verified', pointsQuote: ev.pointsByQuantity?.[quantity] }, ctx.policy);
      if (!shippingKnown) { scenario.issues.push('해당 수량의 매입 배송비 근거 미확인'); scenario.status = 'hold'; }
      if (!conditionsKnown) { scenario.issues.push('수량·구매 제한·동일 옵션 수요 근거 미확인'); scenario.status = 'hold'; }
      if (ctx.policy.eligibilityMode === 'option-evidence' && !pricingKnown) {
        scenario.issues.push('해당 수량의 쿠폰·적립금 적용 총 상품금액 미확인(1개 혜택가 반복 적용 금지)'); scenario.status = 'hold';
      }
      scenarios.push(scenario);
    }
    items.push({ optionId: row['옵션ID'], scenarios });
    row['수량검토'] = scenarios.some(s => s.status === 'scenario-passed') ? '수량 시나리오 통과(판매 보장 아님)' : '수량·회전·총예산 근거 확인 필요';
    if (row['판정'] === '후보' && !scenarios.some(s => s.status === 'scenario-passed')) {
      row['판정'] = '사람 검토'; row['검증상태'] = 'hold';
      row['검증사유코드'] = [row['검증사유코드'], 'BATCH_UNCONFIRMED'].filter(Boolean).join(' · ');
      row['사유'] = [row['사유'], row['수량검토']].filter(Boolean).join(' / ');
    }
  }
  const result = envelope(ctx, items, { note: '동일 상품의 여러 사이즈·번들은 상품 1종으로 집계. 수량 시나리오는 서로 대안이며 예산을 합산해 집행한 계획이 아님.' });
  writeJson(ctx.dir, 'batch-scenarios.json', result); return result;
}
