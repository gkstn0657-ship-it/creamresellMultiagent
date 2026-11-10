import { locateDump } from './agents-offers.mjs';
import { hash, fresh, validateQuote, issue, envelope, writeJson, readJson } from './agents-core.mjs';

export function verifySellers(ctx, offers) {
  // Keep model restrictions out of the deterministic evidence cache.
  const cache = readJson(ctx.dir, 'seller-rules-cache.json', { items: [] }), items = [];
  for (const offer of offers) {
    const { dump, file } = locateDump(ctx, offer), raw = dump || {}, ev = ctx.evidence.sellers?.[offer.id] || {};
    // A changed page or changed human evidence invalidates cached checks immediately.
    const inputHash = hash([raw.at, raw.title, raw.text, raw.blocked, raw.failed, raw.stockProbe?.reason, ev, ctx.policy.sellerTtlHours]);
    const old = cache.items.find((x) => x.offerId === offer.id && x.inputHash === inputHash && fresh(x.observedAt, ctx.now, ctx.policy.sellerTtlHours * 60));
    if (old) { items.push({ ...old, cached: true }); continue; }
    const issues = [], refs = [], bad = (code, detail) => issues.push(issue(code, detail));
    if (!dump || raw.blocked || raw.failed || /blocked|captcha|login|site-skipped/.test(raw.stockProbe?.reason || '')) bad('SELLER_SOURCE_UNAVAILABLE', '판매자 원문 수집 실패');
    if (!fresh(raw.at, ctx.now, ctx.policy.sellerTtlHours * 60)) bad('SELLER_STALE', '판매자 증빙 관측시각 만료 또는 없음');
    const check = (key) => { const ok = validateQuote(ev[key], raw, file); if (ok) refs.push(ev[key]); return ok; };
    const identity = check('identityEvidence') && typeof ev.name === 'string' && ev.name.trim().length >= 2 && ev.identityEvidence.quote.includes(ev.name);
    const business = check('businessEvidence') && /^\d{3}-?\d{2}-?\d{5}$/.test(ev.businessNumber || '') && ev.businessEvidence.quote.replace(/-/g, '').includes(ev.businessNumber.replace(/-/g, ''));
    if (!identity || !business) bad('SELLER_IDENTITY_UNCONFIRMED', '실제 판매자명·사업자번호 증빙 필요');
    if (!check('roleEvidence') || !['direct', 'marketplace'].includes(ev.role)) bad('SELLER_ROLE_UNCONFIRMED', '플랫폼 운영사와 실제 판매자 구분 필요');
    const domesticEvidence = check('dispatchEvidence') && /국내\s*(?:출고|발송|배송)|한국\s*(?:출고|발송)/.test(ev.dispatchEvidence.quote) && !/해외|구매대행|국제배송|국내\s*(?:출고|발송|배송)\s*(?:불가|아님)/.test(ev.dispatchEvidence.quote);
    if (ev.domestic !== true || !domesticEvidence) bad('DISPATCH_UNCONFIRMED', '국내 출고 근거 필요');
    if (!check('returnEvidence')) bad('RETURN_UNCONFIRMED', '반품 조건 근거 필요');
    if (!check('receiptEvidence')) bad('RECEIPT_UNCONFIRMED', '구매 증빙 가능 여부 확인 필요');
    const sellerId = identity && business ? hash([ev.name, ev.businessNumber.replace(/-/g, '')]).slice(0, 20) : null;
    items.push({ offerId: offer.id, sellerId, name: identity ? ev.name : null, businessNumber: business ? ev.businessNumber : null,
      role: ev.role || null, status: issues.length ? 'hold' : 'verified', observedAt: raw.at || null,
      expiresAt: raw.at && Number.isFinite(Date.parse(raw.at)) ? new Date(Date.parse(raw.at) + ctx.policy.sellerTtlHours * 3600000).toISOString() : null,
      inputHash, issues, evidence: refs, cached: false });
  }
  writeJson(ctx.dir, 'seller-rules-cache.json', envelope(ctx, items));
  writeJson(ctx.dir, 'seller-checks.json', envelope(ctx, items)); return items;
}
