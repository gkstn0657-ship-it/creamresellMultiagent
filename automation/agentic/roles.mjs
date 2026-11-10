export const ROLES = {
  planner: { model: 'gpt-6.1-sol', effort: 'medium', tools: [],
    instructions: '전체 탐색을 조정한다. 누락 근거, 직전 도구 결과, 탐색 범위를 보고 다음 전문 역할을 선택한다. discovery → identity → sourcing → benefits → valuation → audit는 기본 경로일 뿐, 새 증거가 필요하면 이전 단계로 돌아간다. 빈 결과를 수익 상품 없음으로 해석하지 않는다. 완료된 단순 계산을 반복시키지 않는다.' },
  discovery: { model: 'gpt-6-luna', effort: 'high', tools: ['discover'],
    instructions: '어떤 KREAM 목록·검색어를 탐색할지 선택한다. sources를 출발점으로 사용한다. 이미 productIds가 있으면 discovery를 반복하지 말고 identity로 넘긴다. 단순 ID 추출과 중복 제거는 도구가 한다. 목표 개수 부족이면 다른 관련 검색어를 선택한다.' },
  identity: { model: 'gpt-6-luna', effort: 'high', tools: ['market_page', 'read_evidence', 'bind_identity'],
    instructions: '상품 식별 담당. 상품명·모델·색상·사이즈를 읽고 부족한 원문을 요청한다. 모델번호는 원문 인용으로만 보완한다. 브랜드 전체를 협업 상품으로 추정해 제외하지 않는다. 모델·색상 불일치를 수익 계산에 섞지 않는다. 이미 식별된 상품은 다시 읽지 않는다.' },
  sourcing: { model: 'gpt-6.1-sol', effort: 'medium', tools: ['search_sources', 'catalog_page', 'inspect_offer', 'read_evidence'],
    instructions: '매입처 탐색 담당. 직접 검색어를 정하고 수집된 링크에서 판매처를 선택한다. 검색 누락, 다른 색상, 중고, 하자, 목록 링크를 구분한다. 혼합 시세 적자만으로 중단하지 말고 옵션별 마진 및 할인 가능성을 살핀다. 가장 싼 한 곳이 실패하면 다른 판매처를 선택한다. 검색어를 바꿔도 두 번 연속 새 판매처가 없으면 benefits로 넘겨 확보한 자료를 해석한다. progress의 남은 페이지·호출 예산을 보고 식별·혜택·수익성·감사에 최소 5회 호출을 남긴다. 모든 판매처를 소진하려 하지 말고 유망한 근거를 우선한다.' },
  benefits: { model: 'gpt-6.1-sol', effort: 'medium', tools: ['no1_market', 'no1_stock', 'read_evidence', 'assess_benefits', 'record_evidence'],
    instructions: '쿠폰·마일리지 담당. No1과 판매처 원문의 할인, 조건, 사용 제외, 결제수단, 수량·한도를 해석한다. No1 최대혜택가는 탐색용 추정이며 결제 확정 증거가 아니다. 기존 적립금 사용은 현금 지출을 낮추지만 보유 자산을 소모하므로 경제적 이익에는 다시 비용으로 넣고, 신규 적립은 별도 표시한다. 중복 할인과 이중 차감을 금지한다. 지원되는 무신사 URL 및 화면에서 확인된 정확한 모델/색상/옵션이 있으면 no1_stock을 선택한다. 모르면 추측해 호출하지 말고 상세 원문이나 다른 매입처를 요청한다. 잔액·등급·결제수단·한도가 미확인이면 unknown으로 명시한다. 확보한 조건을 assess_benefits로 기록하고 valuation으로 넘긴다.' },
  valuation: { model: 'gpt-6.1-sol', effort: 'high', tools: ['calculate', 'record_evidence', 'record_batch_pricing', 'record_batch_conditions', 'read_evidence', 'no1_market'],
    instructions: '수익성 담당. 원문에 있는 동일 옵션 실구매가·배송비·판매자·할인 조건 근거를 record_evidence로 연결하고 calculate를 사용한다. 산술은 직접 만들지 않는다. 사이즈별 최근 30일 3건 이상, 저장된 비용 정책, 가격 하락 가정, 여러 개 구매의 수량·회전·쿠폰 재사용 제한을 검토한다. 다른 판매처나 할인 근거가 필요하면 해당 전문 역할로 돌아간다. No1 추정가로 확정 후보를 만들지 않는다. 계산이 없으면 반드시 calculate를 호출한 후 audit로 넘긴다.' },
  audit: { model: 'gpt-6.1-sol', effort: 'high', tools: ['read_evidence', 'calculate'],
    instructions: '독립 최종 감사자. 앞 역할의 결론보다 원본 인용·옵션 연결·최신성·비용/적립금 이중 계산·쿠폰 적용 조건·판매자·실재고 한계를 먼저 본다. 감사 후 unresolved에는 미해결 사항을 쓴다. recommendations는 계산 결과의 optionId별 clear/hold/exclude 의견이며 모든 계산 옵션을 한 번씩 포함한다. clear는 결정론적 검증을 우회하는 승인이 아니다. 새로운 증거가 필요하고 아직 시도하지 않은 방법이 있으면 이전 역할로 보내며, 외부 조건상 더 진행 불가하면 complete와 미해결 사유를 남긴다. 자료 부족을 수익 없음이라고 단정하지 않는다. 최종 제출 직전에 시스템이 계산·최신성을 다시 검사한다.' },
  recovery: { model: 'gpt-6.1-sol', effort: 'high', tools: ['retry', 'read_evidence'],
    instructions: '오류 복구 담당. 실제 오류·시도 횟수·직전 행동을 읽고 원인을 판단한다. 일시 오류만 retry하고, ID/모델 불일치·로그인/차단·도구 미지원은 다른 탐색 경로 또는 확인 필요로 넘긴다. 이미 실패한 같은 경로를 무한 반복하지 않는다. 코드 변경이나 앱 재시작은 하지 않는다. 증거 없이 성공으로 바꾸지 않는다. 대안이 없으면 audit에 사유를 넘긴다.' },
};

export const TOOL_GUIDE = {
  discover: '{source: KREAM list URL or search term, limit: 1..500}',
  market_page: '{pid: known KREAM product ID}',
  search_sources: '{pid, query: exact model + optional brand/color}',
  catalog_page: '{pid, catalogIndex: index from searchResults.eligibleMatches}. An exact observed url is also accepted instead of catalogIndex.',
  inspect_offer: '{offerId: ID from offers}',
  read_evidence: '{file: name listed in evidenceFiles, offset: 0-based text character offset, length: 1..16000}',
  bind_identity: '{pid, model, title, quote: exact source quote, file: dump-K<id>.json}',
  no1_market: '{pid}',
  no1_stock: '{offerId, model, color: exact No1/source color label, option: exact source option label}',
  assess_benefits: '{offerId, stockFile?: exact no1-stock file returned by no1_stock, note, items: [{index: benefit item index, eligibility: eligible|ineligible|unknown, reason, evidence: [{file, quote}]}]}. No1 breakdown OR an inspected seller page is required. Empty items is valid when the observed page cannot establish benefits; explain unknown conditions in note.',
  record_evidence: '{offerId, offers: existing agent-evidence option schema keyed by size, seller: existing seller evidence schema or null}. Every quote refers to the inspected source dump. For spent points, offers[size].pointsUsed={value,evidence}; quote must contain size, 적립금 사용 N원 and 상품 현금 결제액 C원 matching unitPrice.value. Never use No1 estimate as checkout quote. See evidenceSchema.',
  calculate: '{}',
  record_batch_pricing: '{optionId, pricing: {quantity, totalMerchandiseCost, cashMerchandiseCost, existingPointsUsed, conditionsConfirmed, evidence: {source, field, quote}}}. Exact quote: option, 수량 N, 총 상품금액 X원 (after coupons, before points), 상품 현금 결제액 C원, 적립금 사용 Y원. C+Y must equal X. Applies to one quantity only.',
  record_batch_conditions: '{optionId, quantity, conditions: {stockCap, stockCapEvidence, purchaseLimit, purchaseLimitEvidence, salesCap, salesWindowDays, salesCapConfirmed:true, salesCapReason, salesCapEvidence, inboundShippingByQuantity:{N:{value,source,evidence}}}}. References are {source,field,quote}. Seller quotes must bind size and 구매 가능 수량/재고 수량 N개, 구매 제한 수량/최대 구매 수량 N개. Shipping quote binds size, 수량 N개, 배송비. Demand quote comes from dump-K<pid>.json same-size trades; salesCap must not exceed observed 30-day sample scaled by salesWindowDays (1..30). Explain conservative assumption; it is never guaranteed sales.',
  retry: '{} (only the failed read-only tool; max 2 retries)',
};

export const DECISION_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['summary', 'actions', 'nextStage', 'complete', 'unresolved', 'recommendations'], properties: {
    summary: { type: 'string', description: '한국어 문장으로 작성하는 판단 요약' }, actions: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['tool', 'arguments', 'reason'], properties: { tool: { type: 'string', enum: Object.keys(TOOL_GUIDE) }, arguments: { type: 'string', description: 'JSON object encoded as a string, matching the tool guide' }, reason: { type: 'string', description: '한국어로 작성하는 도구 선택 이유' } } } },
    nextStage: { type: 'string', enum: Object.keys(ROLES) }, complete: { type: 'boolean' },
    unresolved: { type: 'array', items: { type: 'string', description: '한국어로 작성하는 미해결 사항; 오류 코드는 원문 유지' } },
    recommendations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['optionId', 'decision', 'reason'],
      properties: { optionId: { type: 'string' }, decision: { type: 'string', enum: ['clear', 'hold', 'exclude'] }, reason: { type: 'string' } } } },
  } };

export function validateDecision(value, stage) {
  if (!value || typeof value.summary !== 'string' || value.summary.length > 4000 || !Array.isArray(value.actions) || value.actions.length > 8 ||
    !ROLES[value.nextStage] || typeof value.complete !== 'boolean' || !Array.isArray(value.unresolved) || value.unresolved.some(s => typeof s !== 'string' || s.length > 2000) ||
    !Array.isArray(value.recommendations)) throw Error('AGENT_DECISION_INVALID');
  if (value.complete && (stage !== 'audit' || value.actions.length)) throw Error('ONLY_AUDITOR_CAN_COMPLETE');
  if (stage !== 'audit' && value.recommendations.length) throw Error('ONLY_AUDITOR_CAN_RECOMMEND');
  const ids = new Set();
  for (const r of value.recommendations) {
    if (!r.optionId || ids.has(r.optionId) || !['clear','hold','exclude'].includes(r.decision) || typeof r.reason !== 'string') throw Error('AUDIT_RECOMMENDATION_INVALID');
    ids.add(r.optionId);
  }
  for (const action of value.actions) {
    if (!ROLES[stage].tools.includes(action.tool) || typeof action.arguments !== 'string' || action.arguments.length > 24000 || typeof action.reason !== 'string') throw Error('ROLE_TOOL_NOT_ALLOWED');
    const args = JSON.parse(action.arguments);
    if (!args || Array.isArray(args) || typeof args !== 'object') throw Error('TOOL_ARGUMENTS_INVALID');
  }
  return value;
}

export function decisionSchemaFor(stage) {
  const schema = structuredClone(DECISION_SCHEMA), allowed = ROLES[stage].tools;
  if (allowed.length) schema.properties.actions.items.properties.tool.enum = allowed;
  else schema.properties.actions.maxItems = 0;
  if (stage !== 'audit') { schema.properties.complete.enum = [false]; schema.properties.recommendations.maxItems = 0; }
  return schema;
}
