import { profit } from './agents-core.mjs';
import { eligibleListing } from './margin-screen.mjs';

const sourceRank = (offer, policy, trusted) => {
  const link = String(offer.link || ''); const malls = (offer.topMalls || []).map((mall) => mall.mall || '').join(' ');
  if (policy.preferNaverStores && (/(?:smartstore|brand)\.naver\.com/i.test(link) || /스마트스토어|네이버\s*스토어/i.test(malls))) return 0;
  if (trusted(malls)) return 1;
  if (/쿠팡|Coupang|11번가|G마켓|Gmarket|옥션|Auction|위메프|티몬/i.test(malls)) return 2;
  return 3;
};
// Unknown listing prices sort after known ones. A listing estimate never decides which seller page to read.
const listedCost = (m) => Number.isFinite(m.price) && m.price > 0 ? m.price + (m.shipFee ?? 0) : Infinity;

export function planPublicSearch(cards, policy, trusted) {
  const candidates = [];
  for (const [pid, o] of Object.entries(cards)) {
    const matches = (o.matched || []).filter((m) => m.link && eligibleListing(m))
      .map((m) => ({ ...m, sourceRank: sourceRank(m, policy, trusted) }))
      .sort((a, b) => a.sourceRank - b.sourceRank || listedCost(a) - listedCost(b));
    if (matches.length) candidates.push({ pid, name: o.name, kream: o.kream, matches });
  }
  const shortlist = candidates.map(({ matches, ...product }) => {
    const first = matches[0], cost = listedCost(first);
    const net = Number.isFinite(product.kream) && product.kream > 0 && Number.isFinite(cost) && Number.isFinite(first.shipFee)
      ? profit(product.kream, cost, policy) : null;
    return { ...product, best: { ...first, net, pct: net == null ? null : +(net / cost * 100).toFixed(1) } };
  });
  const catalogs = candidates.filter((x) => x.matches[0].isCatalog)
    .map((x) => ({ id: `N${x.pid}-cat`, url: x.matches[0].link, actions: [{ wait: 1500 }] }));
  return { candidates, shortlist, catalogs };
}

export function planPublicPages(candidates, cat, {trustedMall, maxReferencePages}) {
  const prod = [];
  // Extension 0.4+: guarded size/quantity probing; no blind purchase-area clicks.
  const PROD_ACTIONS = [{ stockProbe: true }];
  const push = (pid, link, why) => prod.push({ id: `N${pid}-prod`, url: link, actions: PROD_ACTIONS, why });
  let refs = 0;
  for (const {pid, matches} of candidates) {
    const catalog = matches[0].isCatalog ? cat[pid] : null;
    const catalogSeller = catalog?.trustedMin?.link ? catalog.trustedMin : catalog?.trustedList?.find((offer) => offer.link);
    if (catalogSeller) {
      push(pid, catalogSeller.link, `신뢰 카탈로그 ${catalogSeller.mall} ${catalogSeller.price}`);
      continue;
    }
    const single = matches.filter((m) => !m.isCatalog);
    const trusted = single.find((m) => (m.topMalls || []).some((x) => trustedMall(x.mall)));
    if (trusted) {
      push(pid, trusted.link, `신뢰 단일카드 ${trusted.topMalls[0].mall} ${trusted.price}`);
    } else if (single.length && refs < maxReferencePages) {
      push(pid, single[0].link, `참고 단일카드 ${single[0].price ?? '가격 미확인'}`);
      refs++;
    }
  }
  return prod;
}
