import { readJson, writeJson, envelope, fresh, issue, tradesFromDump, median, profit, canonicalUrl, normalizeSize } from './agents-core.mjs';

export function marketFor(ctx, offer, size) {
  const file = `dump-K${offer.pid}.json`, dump = readJson(ctx.dir, file), issues = [];
  if (!dump || dump.blocked || dump.failed) issues.push(issue('MARKET_UNAVAILABLE', '크림 원본 수집 실패'));
  if (!fresh(dump?.at, ctx.now, ctx.policy.freshnessMinutes)) issues.push(issue('MARKET_STALE', '크림 원본 관측시각 만료 또는 없음'));
  const trades = tradesFromDump(dump).filter((t) => t.size === size && Date.parse(t.at) <= Date.parse(ctx.now));
  const recent = trades.filter((t) => Date.parse(ctx.now) - Date.parse(t.at) <= 30 * 86400000);
  if (recent.length < 3 || size === '*') issues.push(issue('OPTION_SAMPLE_INSUFFICIENT', '동일 사이즈 최근 30일 체결 3건 미만'));
  return { price: median(recent.map((t) => t.price)), count: recent.length, observedAt: dump?.at || null, source: file, issues };
}

export function riskScore(offer, verified, seller, market, row, policy) {
  const points = [
    { name: '판매처 유형', pts: seller?.status === 'verified' ? seller.role === 'marketplace' ? 1 : 0 : 2 },
    { name: '가격 확정성', pts: verified.issues.some((x) => /PRICE|SHIPPING|CONDITIONS|STALE/.test(x.code)) || policy.costPolicyConfirmed !== true ? 2 : 0 },
    { name: '재고', pts: verified.issues.some((x) => /STOCK|SOLD_OUT|BLOCKED|STALE/.test(x.code)) ? 2 : 0 },
    { name: '크림 시세 표본', pts: market.count >= 10 ? 0 : market.count >= 5 ? 1 : 2 },
    { name: '크림 추세', pts: /하락/.test(row['차트 분류'] || '') ? 2 : /상승/.test(row['차트 분류'] || '') ? 0 : 1 },
    { name: '상품 일치', pts: verified.issues.some((x) => /MODEL|COLOR/.test(x.code)) ? 2 : 0 },
    { name: '마진 여유', pts: typeof row['수익률(%)'] !== 'number' ? 2 : row['수익률(%)'] >= 15 ? 0 : row['수익률(%)'] >= 10 ? 1 : 2 },
  ];
  const total = points.reduce((n, p) => n + p.pts, 0), grade = total >= 8 ? '높음' : total >= 4 ? '중간' : '낮음';
  return { points, total, grade, text: points.map((p) => `${['🟢','🟡','🔴'][p.pts]} ${p.name}: ${p.pts}점`).join('\n') + `\n▶ 합계 ${total}점 → 위험 ${grade}` };
}

export function auditFinal(ctx, offers, verified, sellers, legacy) {
  const rows = [], items = [], claimed = new Set();
  for (const offer of offers) {
    const templates = legacy.rows.filter((r) => String(r['크림ID']) === offer.pid);
    for (const v of verified.filter((x) => x.offerId === offer.id)) {
      const seller = sellers.find((s) => s.offerId === offer.id), market = marketFor(ctx, offer, v.size);
      const template = templates.find((r) => r['상품명']?.endsWith(` [${v.size}]`)) || templates[0] || {};
      // Preserve model-level eligibility rules, not failures specific to the first seller.
      const eligible = Boolean(offer.model) && (ctx.policy.eligibilityMode === 'option-evidence' || (Number(offer.product.n) >= 10 && !/슈프림|뉴발란스|포터|디올|Supreme|New Balance|Porter|Dior/i.test(offer.productTitle)));
      if (!eligible) continue;
      for (const original of templates) {
        const originalSize = normalizeSize(String(original['상품명'] || '').match(/ \[([^\]]+)\]$/)?.[1] || '*');
        if (originalSize === v.size && canonicalUrl(original['판매처 링크']) === offer.url) claimed.add(original);
      }
      const issues = [...v.issues, ...(seller?.issues || [issue('SELLER_UNCONFIRMED', '판매자 검사 결과 없음')]), ...market.issues];
      if (ctx.policy.costPolicyConfirmed !== true || !ctx.policy.costPolicySource || !ctx.policy.costPolicyVersion) issues.push(issue('COST_POLICY_UNCONFIRMED', '판매 수수료·발송비 규칙의 출처와 버전 확인 필요'));
      const cost = v.cost, net = cost != null && market.price != null ? profit(market.price, cost, ctx.policy) : null;
      const stressNet = cost != null && market.price != null ? profit(Math.floor(market.price * (1 - (ctx.policy.stressPriceDrop ?? 0))), cost, ctx.policy) : null;
      if (net != null && net <= 0) issues.push(issue('NO_MARGIN', '동일 옵션 실제 원가 기준 이익 0 이하'));
      if (stressNet != null && stressNet <= (ctx.policy.minCashProfit ?? 0)) issues.push(issue('MARGIN_BUFFER_INSUFFICIENT', '보수적 매도가 기준 개당 이익 기준 미달'));
      const excluded = v.status === 'excluded' || seller?.status === 'excluded' || issues.some((i) => i.code === 'NO_MARGIN');
      const status = excluded ? 'excluded' : issues.length ? 'hold' : 'verified';
      const row = { ...template, '상품명': `${offer.productTitle}${v.size === '*' ? '' : ` [${v.size}]`}`, '크림ID': offer.pid, '모델번호': offer.model,
        '옵션ID': v.id, '제안ID': offer.id, '판매자ID': seller?.sellerId || '', '검증상태': status, '검증사유코드': [...new Set(issues.map((i) => i.code))].join(' · '),
        '매입가(원)': v.unitPrice ?? '', '판매처 배송비(원)': v.shipping ?? '', '판매처': offer.mall, '판매처 링크': offer.url,
        '상호명': seller?.name || '확인 불가', '대표자': '', '사업자구분': seller?.businessNumber ? `${seller.role} / ${seller.businessNumber}` : '확인 불가',
        '크림시세(원)': market.price ?? '', '시세기준': `${v.size} 동일 옵션 최근 30일 관측 체결 ${market.count}건 중앙값(예상 매도가)`, '최근30일 체결': market.count,
        '예상순수익(원)': net ?? '', '하락가정 순수익(원)': stressNet ?? '', '수익률(%)': net != null && cost > 0 ? +(net / cost * 100).toFixed(1) : '',
        '최대 적립 포인트(원)': '', '포인트 포함 순수익(원)': '', '포인트 포함 수익률(%)': '',
        '판정': status === 'verified' ? '후보' : status === 'excluded' ? '제외' : '사람 검토',
        '사유': issues.map((i) => i.detail).join(' / '), '특별표시': `${template['특별표시'] || ''} · 매도가·수수료는 추정, 실제 정산과 구분`,
        '리스크': '필수 근거 검증 결과에 따른 판정. 체결 중앙값은 매출 보장 아님.',
        '재고확인': v.issues.some((i) => /STOCK|SOLD_OUT/.test(i.code)) ? '미확인 또는 품절' : `${v.size} 옵션 선택 가능(UI, 실재고 수량 아님)`,
        '관측시각': v.observedAt || '', '만료시각': v.expiresAt || '' };
      const risk = riskScore(offer, v, seller, market, row, ctx.policy);
      row['위험등급'] = risk.grade; row['위험근거'] = risk.text + `\n☞ 확인: ${row['사유'] || '매입 직전 가격·재고 재확인'}`;
      rows.push(row); items.push({ id: v.id, offerId: offer.id, pid: offer.pid, size: v.size, status, issues, risk, evidence: [...v.evidence, ...(seller?.evidence || [])], market });
    }
  }
  // Never silently drop legacy rows, including rejected models with no source offers.
  for (const original of legacy.rows) if (!claimed.has(original)) {
    const row = { ...original };
    if (String(row['판정']).startsWith('후보') || row['판정'] === '사람 검토') { row['판정'] = '사람 검토'; row['검증상태'] = 'hold'; row['검증사유코드'] = 'OFFER_NOT_BOUND'; row['사유'] = `${row['사유'] || ''} / 판매처·옵션별 검증 결과 연결 필요`; }
    rows.push(row);
  }
  const rank = (r) => r['판정'] === '후보' ? 0 : r['판정'] === '사람 검토' ? 1 : 2;
  rows.sort((a, b) => rank(a) - rank(b) || (Number(b['수익률(%)']) || 0) - (Number(a['수익률(%)']) || 0));
  writeJson(ctx.dir, 'audit.json', envelope(ctx, items));
  return { rows, meta: { ...legacy.meta, 에이전트버전: 'cream-agents-v1', 실행ID: ctx.runId, 판정시각: ctx.now,
    후보기준: '동일 옵션·실구매가·판매자·최근 시세·비용 정책 검증 및 보수적 개당 이익 기준 충족. 여러 개 매입은 별도 수량·회전 검토 필요', 수수료율: ctx.policy.feeRate, 배송비: ctx.policy.outboundShipping,
    기본수수료: ctx.policy.sellerFixedFee, 수수료VAT: ctx.policy.feeVatRate, 포장비: ctx.policy.packingCost,
    한계: ['판매가: 최근 체결 중앙값을 사용한 추정치, 현재 구매입찰가 및 실제 정산액과 다름', '옵션 선택 가능 UI는 실제 창고 재고 수량을 뜻하지 않음', '필수 근거 미확인은 사람 검토로 분류'] } };
}
