import { locateDump } from './agents-offers.mjs';
import { envelope, quote, quotedAmounts, normalizeSize, sizeInQuote, moneyInQuote, writeJson } from './agents-core.mjs';

export const SOURCE_ADAPTERS = [
  { name: 'mustit', host: /(^|\.)mustit\.co\.kr$/, sellerHeading: /판매자\s*(?:정보|소개)/g },
  { name: 'ssg', host: /(^|\.)ssg\.com$/, sellerHeading: /판매자\s*(?:정보|상세정보)|업체\s*정보/g },
  { name: 'trenbe', host: /(^|\.)trenbe\.com$/, sellerHeading: /판매자\s*정보|셀러\s*정보/g },
];
export function extractPageEvidence(dump, file) {
  let adapter; try { adapter = SOURCE_ADAPTERS.find((a) => a.host.test(new URL(dump.url).hostname)); } catch {}
  if (!adapter || dump.blocked || dump.failed) return { adapter: adapter?.name || null, offers: {}, seller: null, issues: ['SOURCE_UNSUPPORTED_OR_BLOCKED'] };
  const body = String(dump.text || ''), offers = {}, issues = [];
  const ref = (field, text, extra = {}) => ({ ...quote(file, field, text), ...extra });
  // Only explicit shipping lines; thresholds, members-only and regional exceptions remain unknown.
  const shippingCandidates = [...body.matchAll(/배송비[ \t:：]*\n?[ \t]*(?:무료(?:배송)?|[\d,]+\s*원)(?:[^\n]{0,40})/g)].map((m) => m[0]).filter((s) => !/이상|조건|쿠폰|회원|제외|불가|아님|제주|도서|지역|추가/.test(s));
  const shipValues = [...new Set(shippingCandidates.map((s) => /무료/.test(s) && moneyInQuote(0, { quote: s }) ? 0 : quotedAmounts(s).length === 1 ? quotedAmounts(s)[0] : null).filter((x) => x !== null))];
  const shipping = shipValues.length === 1 ? { value: shipValues[0], evidence: ref('text', shippingCandidates.find((s) => moneyInQuote(shipValues[0], { quote: s }))) } : null;
  for (const row of dump.stockProbe?.results || []) {
    const size = normalizeSize(row.size); if (!size || size === '*' || !['available','limit'].includes(row.state)) continue;
    // offerText is captured from the selected option's visible row BEFORE quantity probing.
    const snapshot = typeof row.offerText === 'string' && row.offerText.length <= 500 && row.offerQuantity === 1 ? row.offerText : null;
    const lines = snapshot ? [{ text: snapshot, field: 'stockProbe.results.offerText' }] : body.split('\n').filter((s) => /사이즈|옵션|SIZE|선택/.test(s) && sizeInQuote(size, s)).map((text) => ({ text, field: 'text' }));
    const candidates = lines.filter(({ text }) => sizeInQuote(size, text) && quotedAmounts(text).length === 1 && /판매가|단가|가격|금액/.test(text) && !/할인|쿠폰|혜택|적립|이상|중고|총액/.test(text));
    const distinct = [...new Set(candidates.map((x) => quotedAmounts(x.text)[0]))];
    if (distinct.length !== 1 || distinct[0] <= 0) { issues.push(`OPTION_PRICE_UNRESOLVED:${size}`); continue; }
    const chosen = candidates[0], evidence = ref(chosen.field, chosen.text, chosen.field === 'text' ? {} : { size, optionKey: row.optionKey || null });
    offers[size] = { size, optionEvidence: evidence, unitPrice: { value: distinct[0], evidence }, ...(shipping ? { shipping } : {}), extractedBy: adapter.name };
  }
  // Restrict identity extraction to a named seller panel, never the platform footer.
  const blocks = [...body.matchAll(new RegExp(adapter.sellerHeading.source, 'g'))].map((m) => body.slice(m.index, m.index + 1300).split(/고객센터|회사소개|이용약관/)[0]);
  const readLabeled = (pattern) => {
    const matches = blocks.flatMap((b) => [...b.matchAll(new RegExp(pattern, 'g'))]).map((m) => ({ value: m[1].trim(), text: m[0] }));
    return new Set(matches.map((m) => m.value)).size === 1 ? matches[0] : null;
  };
  const name = readLabeled('(?:판매자명|상호명|상호|업체명)[ \\t:：]*\\n?[ \\t]*([^\\n:：]{2,60})'), business = readLabeled('사업자(?:등록)?번호[ \\t:：]*\\n?[ \\t]*(\\d{3}-?\\d{2}-?\\d{5})');
  const role = blocks.map((b) => b.match(/[^\n]*(?:실제\s*판매자|판매자)[^\n]*(?:직접\s*판매|통신판매중개|중개자|입점)[^\n]*/)?.[0]).find((s) => s && name && s.includes(name.value));
  const domestic = blocks.map((b) => b.match(/[^\n]*(?:국내\s*(?:출고|발송)|한국\s*출고)[^\n]*/)?.[0]).find((s) => s && !/해외|불가|아님/.test(s));
  const returns = blocks.map((b) => b.match(/[^\n]*(?:반품|교환)[^\n]{2,150}/)?.[0]).find(Boolean);
  const receipt = blocks.map((b) => b.match(/[^\n]*(?:영수증|구매\s*증빙)[^\n]*(?:가능|발급)[^\n]*/)?.[0]).find((s) => s && !/불가|않|미발급/.test(s));
  const seller = name && business ? { name: name.value, businessNumber: business.value, role: role && /직접\s*판매/.test(role) ? 'direct' : role ? 'marketplace' : null,
    domestic: Boolean(domestic), identityEvidence: ref('text', name.text), businessEvidence: ref('text', business.text),
    ...(role ? { roleEvidence: ref('text', role) } : {}), ...(domestic ? { dispatchEvidence: ref('text', domestic) } : {}),
    ...(returns ? { returnEvidence: ref('text', returns) } : {}), ...(receipt ? { receiptEvidence: ref('text', receipt) } : {}), extractedBy: adapter.name } : null;
  if (!seller) issues.push('SELLER_PANEL_UNRESOLVED');
  return { adapter: adapter.name, offers, seller, issues };
}
export function autoEvidence(ctx, offers) {
  const result = { offers: {}, sellers: {} }, diagnostics = [];
  for (const offer of offers) {
    const { dump, file } = locateDump(ctx, offer); if (!dump) continue;
    const extracted = extractPageEvidence(dump, file);
    if (Object.keys(extracted.offers).length) result.offers[offer.id] = extracted.offers;
    if (extracted.seller) result.sellers[offer.id] = extracted.seller;
    diagnostics.push({ offerId: offer.id, adapter: extracted.adapter, optionCount: Object.keys(extracted.offers).length, sellerIdentityExtracted: Boolean(extracted.seller), issues: extracted.issues });
  }
  writeJson(ctx.dir, 'auto-evidence.json', envelope(ctx, diagnostics, { evidence: result })); return result;
}
