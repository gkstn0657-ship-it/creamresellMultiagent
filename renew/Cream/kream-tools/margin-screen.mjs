import { DEFAULT_POLICY, canonicalUrl, fresh, median, money, profit, readJson, saleFee, tradesFromDump } from './agents-core.mjs';

// This is an exploration filter. Listing prices are NOT option-bound checkout
// prices and an observed profitable size is NOT proof of available source stock.
export const searchOffers = (entry) => entry?.eligibleMatches ?? entry?.matched ?? [];
export const eligibleListing = (offer) => Boolean(offer?.keyMatch) && !offer.overseas && !offer.used &&
  offer.colorMatch !== false && offer.colorOk !== false && !/중고|하자|모조품/.test(offer.title || '');

export function screenListing(product, offer, dump, policy = DEFAULT_POLICY, now = new Date().toISOString()) {
  const rules = { ...DEFAULT_POLICY, ...policy };
  const reasons = [], options = [];
  if (!eligibleListing(offer)) return { status: 'ineligible', reasons: ['LISTING_IDENTITY_OR_CONDITION'], options, promotionAllowed: false };
  const knownPrice = money(offer.price) && offer.price > 0;
  const knownShipping = money(offer.shipFee);
  const estimatedCost = knownPrice ? offer.price + (knownShipping ? offer.shipFee : 0) : null;
  const marketFresh = !dump?.blocked && !dump?.failed && fresh(dump?.at, now, rules.freshnessMinutes);
  const sizes = new Map();
  if (!dump?.blocked && !dump?.failed) for (const trade of tradesFromDump(dump)) {
    const age = Date.parse(now) - Date.parse(trade.at);
    if (age < 0 || age > 30 * 86400000 || !money(trade.price) || trade.price <= 0 || !trade.size || trade.size === '*') continue;
    if (!sizes.has(trade.size)) sizes.set(trade.size, []);
    sizes.get(trade.size).push(trade.price);
  }
  for (const [size, prices] of sizes) {
    const price = median(prices), stressedPrice = Math.floor(price * (1 - rules.stressPriceDrop));
    options.push({ size, count: prices.length, marketPrice: price, saleFee: saleFee(price, rules),
      estimatedProfit: estimatedCost == null ? null : profit(price, estimatedCost, rules),
      stressProfit: estimatedCost == null ? null : profit(stressedPrice, estimatedCost, rules),
      // Ceiling includes source shipping, so it can be compared with total cost.
      maxSourceCost: Math.max(0, profit(price, 0, rules) - rules.minCashProfit - 1),
      sufficientSample: prices.length >= 3 });
  }
  options.sort((a, b) => Number(b.sufficientSample) - Number(a.sufficientSample) || (b.estimatedProfit ?? -Infinity) - (a.estimatedProfit ?? -Infinity) || a.size.localeCompare(b.size));
  const potentialOptions = options.filter((o) => o.sufficientSample && o.estimatedProfit > rules.minCashProfit);
  if (!knownPrice) reasons.push('LISTING_PRICE_MISSING');
  if (!knownShipping) reasons.push('SOURCE_SHIPPING_UNCONFIRMED');
  if (!marketFresh) reasons.push('MARKET_REFRESH_REQUIRED');
  if (!options.length || options.some((o) => !o.sufficientSample)) reasons.push('OPTION_SAMPLE_INSUFFICIENT');
  if (rules.costPolicyConfirmed !== true) reasons.push('COST_POLICY_UNCONFIRMED');
  // An incomplete or stale observation cannot establish that profit is absent.
  const incomplete = !knownPrice || !marketFresh || !options.length || rules.costPolicyConfirmed !== true;
  const status = incomplete ? 'needs_verification' : potentialOptions.length ? 'potential' :
    options.some((o) => !o.sufficientSample) ? 'needs_verification' : 'low_potential';
  if (status === 'low_potential') reasons.push('OBSERVED_OPTIONS_BELOW_MARGIN');
  reasons.push('OPTION_CHECKOUT_AND_STOCK_REQUIRED');
  return { status, reasons, options, potentialOptions, estimatedCost, sourceShippingKnown: knownShipping,
    mixedProfit: knownPrice && money(product.kreamMed) && product.kreamMed > 0 ? profit(product.kreamMed, estimatedCost, rules) : null,
    marketObservedAt: dump?.at ?? null, marketFresh, promotionAllowed: false };
}

const priority = { potential: 0, needs_verification: 1, low_potential: 2, ineligible: 3 };
const inspectable = (row) => ['potential', 'needs_verification'].includes(row.screen.status) && canonicalUrl(row.offer.link);
const ranked = (rows) => [...rows].sort((a, b) => priority[a.screen.status] - priority[b.screen.status] ||
  (a.screen.estimatedCost ?? Infinity) - (b.screen.estimatedCost ?? Infinity));

export function screenInitialMargins(ctx) {
  const products = [], shortlist = [];
  for (const product of ctx.products) {
    const pid = String(product.id), entry = ctx.cards[pid], dump = readJson(ctx.dir, `dump-K${pid}.json`);
    const offers = searchOffers(entry).map((offer) => ({ offer, screen: screenListing(product, offer, dump, ctx.policy, ctx.now) }));
    const useful = ranked(offers.filter((row) => row.screen.status !== 'ineligible'));
    const best = ranked(useful.filter(inspectable))[0];
    const reasons = !product.model ? ['MODEL_MISSING'] : !entry ? ['SEARCH_MISSING'] : !useful.length ? ['ELIGIBLE_SOURCE_NOT_FOUND'] : [];
    if (useful.length && !best) reasons.push(useful.some((row) => !canonicalUrl(row.offer.link)) ? 'SOURCE_LINK_MISSING' : 'OBSERVED_OPTIONS_BELOW_MARGIN');
    const status = product.model ? useful[0]?.screen.status ?? 'needs_verification' : 'needs_verification';
    products.push({ pid, model: product.model, status, reasons, offers });
    if (best && product.model) {
      const option = best.screen.potentialOptions[0] || best.screen.options[0];
      shortlist.push({ pid, name: entry.name || product.title, kream: product.kreamMed, status,
        best: { ...best.offer, net: option?.estimatedProfit ?? null, pct: best.screen.estimatedCost > 0 && option?.estimatedProfit != null ? +(option.estimatedProfit / best.screen.estimatedCost * 100).toFixed(1) : null,
          marginScreen: best.screen } });
    }
  }
  const counts = Object.fromEntries(Object.keys(priority).map((status) => [status, products.filter((p) => p.status === status).length]));
  return { version: 'option-margin-v1', at: ctx.now, promotionAllowed: false, products, shortlist,
    summary: { products: products.length, searched: products.filter((p) => Boolean(ctx.cards[p.pid])).length,
      ...counts, inspectableProducts: shortlist.length } };
}

export function planMarginCatalogs(screen) {
  return screen.products.flatMap((p) => {
    const best = ranked(p.offers.filter((row) => row.offer.isCatalog && inspectable(row)))[0];
    return best && p.model ? [{ id: `N${p.pid}-cat`, url: best.offer.link, actions: [{ wait: 1500 }] }] : [];
  });
}

export function planMarginPages(ctx, screen, { trustedMall, maxReferencePages = 3 }) {
  const jobs = [], references = [];
  for (const p of screen.products) {
    const product = ctx.products.find((item) => String(item.id) === p.pid);
    if (!product?.model) continue;
    const dump = readJson(ctx.dir, `dump-K${p.pid}.json`), cat = ctx.catalogs[p.pid];
    const catalogOffers = cat?.offerList ?? cat?.trustedList ?? (cat?.trustedMin ? [cat.trustedMin] : []);
    const rows = ranked([...catalogOffers.map((offer) => ({ offer, catalog: true, screen: screenListing(product, offer, dump, ctx.policy, ctx.now) })),
      ...p.offers.filter((row) => !row.offer.isCatalog)].filter(inspectable));
    const trusted = rows.find((row) => trustedMall(row.offer.mall || '') || (row.offer.topMalls || []).some((mall) => trustedMall(mall.mall)));
    const pick = trusted || rows[0];
    if (!pick) continue;
    const job = { id: `N${p.pid}-prod`, url: pick.offer.link, actions: [{ stockProbe: true }],
      why: `${trusted ? '신뢰' : '참고'} ${pick.catalog ? '카탈로그' : '단일카드'} ${pick.offer.mall || pick.offer.topMalls?.[0]?.mall || ''} ${pick.offer.price} · 옵션별 ${pick.screen.status}`,
      marginStatus: pick.screen.status, potentialSizes: pick.screen.potentialOptions.map((o) => o.size) };
    if (trusted) jobs.push(job); else references.push(job);
  }
  return [...jobs, ...references.slice(0, Math.max(0, maxReferencePages))];
}
