import { codeMatch, otherColor } from './code-match.mjs';
import { productIdentityCompatible } from './product-identity.mjs';
import { stockSummary } from './stock-summary.mjs';
import { canonicalUrl, offerId, optionId, productJobId, readJson, fresh, normalizeSize, validateQuote, moneyInQuote, money, issue, quote, envelope, writeJson, profit, sizeInQuote, quotedAmounts } from './agents-core.mjs';
import { marketFor } from './agents-audit.mjs';
import { searchOffers } from './margin-screen.mjs';

// Store platform is an exploration preference; actual seller proof remains mandatory.
export const trustedMall = (mall) => /롯데ON|롯데온|롯데홈쇼핑|롯데백화점|현대Hmall|현대백화점|더현대|신세계|SSG|머스트잇|MUSTIT|더블유컨셉|W컨셉|무신사|29CM|트렌비|LFmall|CJ온스타일|GS\s?SHOP|SK스토아|KT알파|11번가|10x10|텐바이텐/i.test(mall);
export function isNaverStore(url) { try { const u = new URL(url); return u.protocol === 'https:' && ['smartstore.naver.com', 'brand.naver.com'].includes(u.hostname) && /^\/[^/]+\/products\/\d+\/?$/.test(u.pathname); } catch { return false; } }

export function collectOffers(ctx) {
  const all = [];
  for (const p of ctx.products) {
    if (!p.model || (ctx.policy.eligibilityMode !== 'option-evidence' && (Number(p.n) < 10 || /슈프림|뉴발란스|포터|디올|Supreme|New Balance|Porter|Dior/i.test(p.title || '')))) continue;
    const pid = String(p.id), cards = searchOffers(ctx.cards[pid]), cat = ctx.catalogs[pid];
    const sources = [...(cat?.offerList || []), ...(cat?.trustedList || []), ...(cat?.trustedMin ? [cat.trustedMin] : []), ...cards.filter((x) => !x.isCatalog)];
    const seen = new Set();
    for (const source of sources) {
      const url = canonicalUrl(source.link), title = String(source.title || ''), cm = codeMatch(p.model, title);
      if (!url || seen.has(url) || source.overseas || source.used || /중고|하자|모조품/.test(title) || !cm.code || source.colorMatch === false || source.colorOk === false || !productIdentityCompatible(p.title,title,p.model)) continue;
      const mall = source.mall || source.topMalls?.[0]?.mall || '';
      const naverStore = isNaverStore(url);
      if (ctx.policy.exploreAllMatchedSellers !== true && !trustedMall(mall) && !(ctx.policy.allowNaverStores === true && naverStore)) continue;
      seen.add(url);
      all.push({ id: offerId(pid, url), pid, url, title, model: p.model, productTitle: p.title, product: p,
        mall, naverStore, listedPrice: source.price, listedShipping: source.shipFee ?? null });
    }
  }
  return all.sort((a, b) => a.pid.localeCompare(b.pid) || (ctx.policy.preferNaverStores === true ? Number(b.naverStore) - Number(a.naverStore) : 0) || ((a.listedPrice + (a.listedShipping || 0)) - (b.listedPrice + (b.listedShipping || 0))) || a.id.localeCompare(b.id));
}
export function locateDump(ctx, offer) {
  const file = `dump-${productJobId(offer)}.json`, exact = readJson(ctx.dir, file);
  if (exact) return { dump: exact, file };
  const legacyFile = `dump-N${offer.pid}-prod.json`, legacy = readJson(ctx.dir, legacyFile);
  if (!legacy) return { dump: null, file };
  const job = ctx.jobs.find((j) => j.id === `N${offer.pid}-prod`);
  // Redirect targets need not equal the source URL. Match the ORIGINAL queued URL.
  if (canonicalUrl(legacy.job?.url || job?.url || legacy.url) === offer.url) return { dump: legacy, file: legacyFile };
  return { dump: null, file };
}
const colors = [['블랙','BLACK'],['네이비','NAVY'],['화이트','WHITE'],['그레이','GREY','GRAY'],['블루','BLUE'],['베이지','BEIGE'],['브라운','BROWN'],['그린','GREEN'],['레드','RED']];
function colorConflict(a, b) { const groups = (s) => colors.map((g, i) => g.some((x) => new RegExp(`(?:^|[^A-Z])${x}(?:$|[^A-Z])`, 'i').test(s)) ? i : -1).filter((x) => x >= 0); const x = groups(a), y = groups(b); return x.length && y.length && !x.some((i) => y.includes(i)); }

// Explicit evidence is option-bound; unscoped listing prices never become checkout prices.
export function verifyOffer(ctx, offer) {
  const { dump, file } = locateDump(ctx, offer), raw = dump || {}, summary = stockSummary(raw);
  const recorded = ctx.evidence.offers?.[offer.id] || {}, structured = summary.rows;
  const sizes = new Set([...structured.map((r) => normalizeSize(r.size)), ...Object.keys(recorded).map(normalizeSize)]);
  if (sizes.size > 1) sizes.delete('*'); // A probe failure placeholder is not an additional sellable size.
  if (!sizes.size) sizes.add('*');
  const checks = [];
  for (const size of sizes) {
    const issues = [], refs = [], ev = recorded[size] || {}, sr = structured.find((r) => normalizeSize(r.size) === size);
    const reject = (code, detail) => issues.push(issue(code, detail));
    if (!dump) reject('DETAIL_MISSING', '판매처 상세 덤프 없음');
    if (raw.blocked || raw.failed || /blocked|captcha|login|site-skipped/.test(raw.stockProbe?.reason || '')) reject('DETAIL_BLOCKED', '차단·로그인·수집 실패');
    if (!fresh(raw.at, ctx.now, ctx.policy.freshnessMinutes)) reject('OFFER_STALE', '가격·재고 원본 관측시각 만료 또는 없음');
    const cm = codeMatch(offer.model, raw.title || '');
    if (!cm.code) reject(otherColor(offer.model, raw.title) ? 'MODEL_MISMATCH' : 'MODEL_UNCONFIRMED', '판매처 상세 제목에서 모델·색상 코드 확인 필요');
    else refs.push(quote(file, 'title', raw.title));
    if (colorConflict(offer.productTitle, raw.title || '')) reject('COLOR_MISMATCH', '크림과 판매처 제목의 색상 불일치');
    const available = sr && (sr.state === 'available' || (sr.state === 'limit' && sr.maxQty > 0));
    if (sr?.state === 'soldout') reject('SOLD_OUT', `${size} 품절`);
    else if (!available || size === '*') reject('STOCK_UNCONFIRMED', '동일 옵션 선택 가능 여부 미확인');
    if (available) refs.push({ source: file, field: 'stockProbe.results', size, state: sr.state, optionKey: sr.optionKey || null });
    const scoped = normalizeSize(ev.size) === size && validateQuote(ev.optionEvidence, raw, file) && sizeInQuote(size, ev.optionEvidence.quote);
    const amount = (field) => {
      const item = ev[field];
      if (!scoped || !item || !validateQuote(item.evidence, raw, file) || !moneyInQuote(item.value, item.evidence)) return null;
      if (field === 'unitPrice') {
        const prices = [...new Set(quotedAmounts(ev.optionEvidence.quote))];
        if (prices.length !== 1 || prices[0] !== item.value || !sizeInQuote(size, item.evidence.quote)) return null;
      }
      return item.value;
    };
    const unitPrice = amount('unitPrice'), shipping = amount('shipping');
    if (unitPrice != null && ctx.policy.maxPurchasePrice != null && unitPrice > ctx.policy.maxPurchasePrice) reject('BUDGET_EXCEEDED', '개당 매입 예산 초과');
    if (unitPrice == null || unitPrice <= 0) reject('PRICE_UNCONFIRMED', '옵션별 실제 판매가·할인 조건 근거 필요');
    if (shipping == null) reject('SHIPPING_UNCONFIRMED', '배송비 근거 필요(무료도 0원으로 명시)');
    const conditional = /혜택가|첫 구매|쿠폰|회원가|카드할인/.test(raw.text || '');
    const conditionsOk = ev.conditionsConfirmed === true && scoped && validateQuote(ev.conditionsEvidence, raw, file);
    if (conditional && !conditionsOk) reject('CONDITIONS_UNCONFIRMED', '쿠폰·회원·카드 조건 적용 가능 여부 미확인');
    for (const key of ['optionEvidence', 'conditionsEvidence']) if (validateQuote(ev[key], raw, file)) refs.push(ev[key]);
    for (const key of ['unitPrice', 'shipping']) if (ev[key] && validateQuote(ev[key].evidence, raw, file)) refs.push(ev[key].evidence);
    const excluded = issues.some((i) => ['SOLD_OUT','MODEL_MISMATCH','COLOR_MISMATCH'].includes(i.code));
    checks.push({ id: optionId(offer.id, size), offerId: offer.id, pid: offer.pid, size, sellerId: null, status: excluded ? 'excluded' : issues.length ? 'hold' : 'verified',
      unitPrice, shipping, cost: money(unitPrice) && money(shipping) ? unitPrice + shipping : null, observedAt: raw.at || null,
      expiresAt: raw.at && Number.isFinite(Date.parse(raw.at)) ? new Date(Date.parse(raw.at) + ctx.policy.freshnessMinutes * 60000).toISOString() : null, issues, evidence: refs, source: file });
  }
  return checks;
}

export function verifyOffers(ctx, offers) {
  const items = offers.flatMap((offer) => verifyOffer(ctx, offer));
  writeJson(ctx.dir, 'verified-offers.json', envelope(ctx, items)); return items;
}

export function planFallback(ctx, offers, verified, sellers, batchApprovedOptionIds = new Set()) {
  const jobs = [], items = [];
  for (const pid of new Set(offers.map((o) => o.pid))) {
    const list = offers.filter((o) => o.pid === pid), inspected = list.filter((o) => locateDump(ctx, o).dump);
    const passed = list.some((o) => verified.some((v) => {
      if (v.offerId !== o.id || v.status !== 'verified') return false;
      if (ctx.policy.purchaseMode === 'multiple-units' && !batchApprovedOptionIds.has(v.id)) return false;
      const market = marketFor(ctx, o, v.size);
      return !market.issues.length && ctx.policy.costPolicyConfirmed === true && Boolean(ctx.policy.costPolicySource) && Boolean(ctx.policy.costPolicyVersion) && market.price != null && profit(Math.floor(market.price * (1 - (ctx.policy.stressPriceDrop ?? 0))), v.cost, ctx.policy) > (ctx.policy.minCashProfit ?? 0);
    }) && sellers.some((s) => s.offerId === o.id && s.status === 'verified'));
    if (passed) { items.push({ pid, status: 'complete', reason: '검증된 구매 제안 확보', inspected: inspected.length }); continue; }
    const maximum = 1 + Math.floor(ctx.policy.maxFallback);
    const next = list.find((o) => !locateDump(ctx, o).dump);
    if (next && inspected.length < maximum) {
      const job = { id: productJobId(next), url: next.url, actions: [{ stockProbe: true }], offerId: next.id, why: `에이전트 대체 판매처 ${next.mall}` };
      jobs.push(job); items.push({ pid, offerId: next.id, status: 'pending', inspected: inspected.length, nextJob: job.id });
    } else items.push({ pid, status: 'exhausted', reason: inspected.length >= maximum ? '대체 판매처 확인 한도 도달' : '확인 가능한 대체 링크 없음', inspected: inspected.length });
  }
  const result = envelope(ctx, items, { jobs }); writeJson(ctx.dir, 'fallback-results.json', result); return result;
}
