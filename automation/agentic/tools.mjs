import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { context, readJson, writeJson, hash, canonicalUrl, productJobId, validateQuote, fresh, normalizeSize } from '../../renew/Cream/kream-tools/agents-core.mjs';
import { collectOffers, locateDump, verifyOffer } from '../../renew/Cream/kream-tools/agents-offers.mjs';
import { screenInitialMargins, searchOffers } from '../../renew/Cream/kream-tools/margin-screen.mjs';
import { runAgents } from '../../renew/Cream/kream-tools/agents-run.mjs';
import { validBatchPricing, validBatchConditions } from '../../renew/Cream/kream-tools/agents-batch.mjs';
import { RelayTransport } from '../../kream-tools/relay-transport.mjs';
import { buildKreamListUrl } from '../../kream-tools/kream-list-url.mjs';
import { callNo1Mcp } from '../no1-first-runner.mjs';
import { parseNo1Benefits, benefitScenario } from './benefits.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ENGINE = path.join(ROOT, 'renew/Cream/kream-tools');
export const evidenceFiles = dir => fs.readdirSync(dir).filter(f => /^(dump-|no1-market-|no1-stock-).*\.json$/.test(f)).sort();
export function inputDigest(dir) {
  const files = [...evidenceFiles(dir), 'k50-ids.json','k50-all.json','k50.json','n-cards.json','n-cat.json','agent-policy.json','agent-evidence.json','batch-evidence.json','benefit-assessments.json'];
  return hash(files.filter(f => fs.existsSync(path.join(dir, f))).map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
}
export function readEvidence(dir, file) {
  if (typeof file !== 'string' || path.basename(file) !== file || !evidenceFiles(dir).includes(file)) throw Error('EVIDENCE_FILE_NOT_ALLOWED');
  return readJson(dir, file);
}
const textOf = dump => [dump.title || '', dump.text || '', ...(dump.benefitConditionsVerbatim || [])].join('\n');
const objectArgs = (args, required, optional = []) => {
  if (!args || Array.isArray(args) || typeof args !== 'object' || required.some(k => !Object.hasOwn(args, k)) || Object.keys(args).some(k => ![...required,...optional].includes(k))) throw Error('TOOL_ARGUMENT_SCHEMA');
};
const safeUrl = raw => {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || /(^|\.)(localhost|local)$|^[\d.]+$|:/.test(url.hostname)) throw Error('PUBLIC_HTTPS_URL_REQUIRED');
  return url.href;
};
const publicCode = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/ -]{0,99}$/.test(value);
export function assertMarketIdentity(dump, pid) {
  let url; try { url = new URL(dump?.url); } catch { throw Error('KREAM_PRODUCT_URL_MISMATCH'); }
  if(['kream.co.kr','www.kream.co.kr'].includes(url.hostname)&&/^\/login(?:\/|$)/.test(url.pathname))throw Error('KREAM_LOGIN_REQUIRED');
  if (!['kream.co.kr','www.kream.co.kr'].includes(url.hostname) || !new RegExp(`^/products/${pid}/?$`).test(url.pathname)) throw Error('KREAM_PRODUCT_URL_MISMATCH');
}

export class SourcingTools {
  constructor(dir, options = {}) { this.dir = path.resolve(dir); this.options = options; this.config = options.config; this.mode = options.mode || 'live'; }
  now() { return this.options.clock?.() || new Date().toISOString(); }
  ctx() { return context(this.dir, { now: this.now() }); }
  emit(message) { this.options.onEvent?.({ type: 'tool-progress', message }); }
  stopped() { return fs.existsSync(path.join(this.dir, 'STOP')) || (this.options.stopFile && fs.existsSync(this.options.stopFile)); }
  script(name, ...args) {
    const result = spawnSync(process.execPath, [path.join(ENGINE, name), this.dir, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 2000000 });
    if (result.status !== 0) throw Error(`PARSER_FAILED:${name}:${String(result.stderr || result.error).slice(0, 500)}`);
  }
  product(pid) {
    if (typeof pid !== 'string' || !/^\d{1,12}$/.test(pid) || !readJson(this.dir, 'k50-ids.json', []).map(String).includes(pid)) throw Error('PRODUCT_NOT_IN_SCOPE');
    return this.ctx().products.find(p => String(p.id) === pid) || { id: pid, model: null };
  }
  offer(id) { const offer = collectOffers(this.ctx()).find(o => o.id === id); if (!offer) throw Error('OFFER_NOT_IN_OBSERVED_SOURCES'); return offer; }
  archive(file, value) {
    writeJson(this.dir, path.join('observations', `${path.basename(file, '.json')}-${hash(value).slice(0, 16)}.json`), value);
    writeJson(this.dir, file, value);
  }
  async capture(job, targetFile) {
    if (this.mode === 'replay') throw Error('REPLAY_NETWORK_DISABLED');
    if (this.stopped()) throw Error('STOP_REQUESTED');
    const counter = readJson(this.dir, 'agentic-tool-counts.json', { pages: 0, no1: 0 });
    if (counter.pages >= this.config.maxPagesPerRun) throw Error('PAGE_BUDGET_REACHED');
    counter.pages++; writeJson(this.dir, 'agentic-tool-counts.json', counter);
    const serial = String(counter.pages).padStart(3, '0');
    // Preserve the -prod suffix required by the installed extension.
    const id = job.id.endsWith('-prod') ? job.id.replace(/-prod$/, `-a${serial}-prod`) : `${job.id}-a${serial}`;
    const queued = { ...job, id };
    let dump;
    if (this.options.capture) dump = await this.options.capture(queued);
    else {
      if (!this.options.relayDir) throw Error('RELAY_NOT_CONFIGURED');
      const transport = new RelayTransport(this.dir, this.options.relayDir, this.options.transportOptions);
      await transport.verify();
      const jobs = readJson(this.dir, 'jobs.json', { jobs: [] }); jobs.jobs.push(queued); writeJson(this.dir, 'jobs.json', jobs);
      const deadline = Date.now() + this.config.pageTimeoutMs; let ping = 0;
      try {
        do {
          if (this.stopped()) throw Error('STOP_REQUESTED');
          await transport.sync(); dump = readJson(this.dir, `dump-${id}.json`);
          if (dump) break;
          if (Date.now() > deadline) throw Error('PAGE_CAPTURE_TIMEOUT');
          if (Date.now() - ping > 15000) { this.emit(`페이지 수집 대기: ${job.id}`); ping = Date.now(); }
          await new Promise(resolve => setTimeout(resolve, 1000));
        } while (!dump);
      } finally { transport.cancelPending(); }
    }
    if (!dump || dump.blocked || dump.failed || !dump.at || !canonicalUrl(dump.url)) throw Error('PAGE_BLOCKED_OR_INVALID');
    if (!fresh(dump.at, this.now(), this.config.freshnessMinutes)) throw Error('PAGE_CAPTURE_STALE');
    const marketId = targetFile.match(/^dump-K(\d+)\.json$/)?.[1];
    if (marketId) assertMarketIdentity(dump, marketId);
    this.archive(targetFile, { ...dump, job: { ...queued, canonicalId: job.id } });
    return dump;
  }
  async no1(name, args, file, validate) {
    if (this.mode === 'replay') throw Error('REPLAY_NETWORK_DISABLED');
    const counter = readJson(this.dir, 'agentic-tool-counts.json', { pages: 0, no1: 0 });
    if (counter.no1 >= this.config.maxNo1Queries) throw Error('NO1_QUERY_BUDGET_REACHED');
    counter.no1++; writeJson(this.dir, 'agentic-tool-counts.json', counter);
    const raw = await (this.options.queryNo1 || callNo1Mcp)(name, args);
    if (validate) validate(raw);
    this.archive(file, raw); return raw;
  }
  async execute(tool, args) {
    if (this.stopped()) throw Error('STOP_REQUESTED');
    switch (tool) {
      case 'discover': {
        objectArgs(args, ['source','limit']);
        if (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 500) throw Error('DISCOVERY_LIMIT_INVALID');
        const url = buildKreamListUrl(args.source);
        const dump = await this.capture({ id: `S${hash(url).slice(0, 8)}`, url, expectedSort: 'popular_score', actions: [{ wait: 1500 }, { kreamSort: '인기순' }] }, `dump-discovery-${hash(url).slice(0, 8)}.json`);
        if (!dump.kreamSort?.verified || dump.kreamSort.selectedLabel !== '인기순' || new URL(dump.url).searchParams.get('sort') !== 'popular_score') throw Error('DISCOVERY_SORT_UNVERIFIED');
        const ids = new Set(readJson(this.dir, 'k50-ids.json', []).map(String));
        for (const link of dump.links || []) { const m = String(link.h).match(/^https:\/\/(?:www\.)?kream\.co\.kr\/products\/(\d+)(?:[/?#]|$)/); if (m && ids.size < args.limit) ids.add(m[1]); }
        writeJson(this.dir, 'k50-ids.json', [...ids]); return { productIds: [...ids], requested: args.limit, shortfall: Math.max(0, args.limit - ids.size) };
      }
      case 'market_page': {
        objectArgs(args, ['pid']); this.product(args.pid);
        const prior = this.ctx().products;
        await this.capture({ id: `K${args.pid}`, url: `https://kream.co.kr/products/${args.pid}`, actions: [{ wait: 1000 }, { click: '거래 내역 더보기', after: 1800 }, { noScroll: true }] }, `dump-K${args.pid}.json`);
        this.script('parse-kream.mjs');
        const freshProducts = readJson(this.dir, 'k50.json', []), merged = [...new Map([...prior, ...freshProducts].map(p => [String(p.id), p])).values()];
        writeJson(this.dir, 'k50.json', merged); writeJson(this.dir, 'k50-all.json', merged);
        return { product: this.product(args.pid), file: `dump-K${args.pid}.json` };
      }
      case 'bind_identity': {
        objectArgs(args, ['pid','model','title','quote','file']); this.product(args.pid);
        if (args.file !== `dump-K${args.pid}.json` || !publicCode(args.model) || typeof args.title !== 'string' || args.title.length > 180) throw Error('IDENTITY_BINDING_INVALID');
        const dump = readEvidence(this.dir, args.file), text = textOf(dump);
        assertMarketIdentity(dump, args.pid);
        if (typeof args.quote !== 'string' || !text.includes(args.quote) || !args.quote.includes(args.model) || !/모델번호|품번|상품코드/.test(args.quote) || !text.includes(args.title)) throw Error('IDENTITY_QUOTE_NOT_BOUND');
        const products = this.ctx().products, found = products.find(p => String(p.id) === args.pid);
        const item = { ...(found || { id: args.pid, n: 0, kreamMed: null }), model: args.model, title: args.title, q1: args.model, identityEvidence: { file: args.file, quote: args.quote } };
        if (found) Object.assign(found, item); else products.push(item);
        writeJson(this.dir, 'k50.json', products); writeJson(this.dir, 'k50-all.json', products); return item;
      }
      case 'search_sources': {
        objectArgs(args, ['pid','query']); const p = this.product(args.pid);
        if (!p.model || typeof args.query !== 'string' || args.query.length < 2 || args.query.length > 180 || /[\x00-\x1f]/.test(args.query)) throw Error('SEARCH_IDENTITY_OR_QUERY_INVALID');
        const old = this.ctx().cards;
        const second = fs.existsSync(path.join(this.dir, `dump-N${args.pid}-s.json`));
        await this.capture({ id: `N${args.pid}-s`, url: `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(args.query)}`, actions: [{ wait: 1500 }] }, `dump-N${args.pid}-${second ? 's2' : 's'}.json`);
        this.script('parse-si.mjs', 'N', 'k50.json', 'n-cards.json');
        const cards = readJson(this.dir, 'n-cards.json', {});
        for (const [pid, entry] of Object.entries(old)) {
          if (!cards[pid]) cards[pid] = entry;
          else { const all = [...new Map([...searchOffers(entry), ...searchOffers(cards[pid])].map(o => [o.link || o.title, o])).values()]; cards[pid].eligibleMatches = all; cards[pid].matched = all.slice(0, 3); }
        }
        writeJson(this.dir, 'n-cards.json', cards); return { pid: args.pid, cards: cards[args.pid], offers: collectOffers(this.ctx()).filter(o => o.pid === args.pid).map(({ product, ...o }) => o) };
      }
      case 'catalog_page': {
        objectArgs(args, ['pid'], ['url','catalogIndex']); this.product(args.pid);
        const cards = searchOffers(this.ctx().cards[args.pid]);
        const url = args.url ?? (Number.isSafeInteger(args.catalogIndex) ? cards[args.catalogIndex]?.link : null);
        if (!url || !cards.some(o => o.isCatalog && canonicalUrl(o.link) === canonicalUrl(url))) throw Error('CATALOG_LINK_NOT_OBSERVED');
        safeUrl(url);
        await this.capture({ id: `N${args.pid}-cat`, url, actions: [{ wait: 1500 }] }, `dump-N${args.pid}-cat.json`);
        this.script('parse-si-cat.mjs', 'N', 'k50.json', 'n-cat.json'); return this.ctx().catalogs[args.pid];
      }
      case 'inspect_offer': {
        objectArgs(args, ['offerId']); const offer = this.offer(args.offerId); safeUrl(offer.url);
        const id = productJobId(offer), dump = await this.capture({ id, url: offer.url, actions: [{ stockProbe: true }] }, `dump-${id}.json`);
        return { offerId: offer.id, file: `dump-${id}.json`, title: dump.title, stock: dump.stockProbe, excerpt: textOf(dump).slice(0, 6000) };
      }
      case 'read_evidence': {
        objectArgs(args, ['file'], ['offset','length']); const dump = readEvidence(this.dir, args.file);
        const offset = args.offset ?? 0, length = args.length ?? 12000;
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 16000) throw Error('EVIDENCE_RANGE_INVALID');
        const text = textOf(dump);
        return { file: args.file, at: dump.at || dump.capturedAt, title: dump.title, url: dump.url || dump.productUrl, stockProbe: dump.stockProbe,
          text: text.slice(offset, offset + length), offset, totalLength: text.length, truncated: text.length > offset + length,
          ...(args.file.startsWith('no1-') ? { observation: dump } : {}) };
      }
      case 'no1_market': {
        objectArgs(args, ['pid']); const product = this.product(args.pid); if (!product.model) throw Error('MODEL_REQUIRED');
        const raw = await this.no1('no1_search_price_comparison', { kreamId: args.pid, model: product.model }, `no1-market-${args.pid}.json`, raw => {
          if (raw.kreamId !== args.pid || raw.model !== product.model || !raw.identityVerifiedFromVisibleLink) throw Error('NO1_MARKET_IDENTITY_MISMATCH');
        });
        return raw;
      }
      case 'no1_stock': {
        objectArgs(args, ['offerId','model','color','option']); const offer = this.offer(args.offerId);
        const { dump } = locateDump(this.ctx(), offer);
        const url = /^https:\/\/www\.musinsa\.com\/products\/\d+$/.test(dump?.url || '') ? dump.url : offer.url;
        if (!/^https:\/\/www\.musinsa\.com\/products\/\d+$/.test(url)) throw Error('NO1_STOCK_SOURCE_UNSUPPORTED');
        const identityText = [offer.title, dump?.title, dump?.text, ...(dump?.stockProbe?.results || []).map(r => `${r.size} ${r.optionKey || ''}`)].filter(Boolean).join('\n');
        if (![args.model,args.color,args.option].every(s => typeof s === 'string' && s.length > 0 && s.length <= 100 && identityText.includes(s))) throw Error('NO1_STOCK_LABEL_NOT_OBSERVED');
        const file = `no1-stock-${offer.id}-${hash([args.model,args.color,args.option]).slice(0,12)}.json`;
        const raw = await this.no1('no1_search_stock_estimate', { productUrl: url, model: args.model, color: args.color, option: args.option }, file, raw => {
          if (raw.productUrl !== url || raw.model !== args.model || raw.color !== args.color || raw.option !== args.option || raw.identityVerified !== true || raw.resultUrlVerifiedFromCopy !== true) throw Error('NO1_STOCK_IDENTITY_MISMATCH');
        });
        return { file, ...raw, benefits: parseNo1Benefits(raw) };
      }
      case 'assess_benefits': {
        objectArgs(args, ['offerId','note','items'], ['stockFile']); const offer = this.offer(args.offerId);
        const stocks = evidenceFiles(this.dir).filter(f => f === `no1-stock-${offer.id}.json` || f.startsWith(`no1-stock-${offer.id}-`));
        if (args.stockFile && !stocks.includes(args.stockFile)) throw Error('BENEFIT_SOURCE_NOT_BOUND');
        const file = args.stockFile || stocks.sort((a,b) => Date.parse(readJson(this.dir,b).capturedAt) - Date.parse(readJson(this.dir,a).capturedAt))[0];
        const raw = file ? readJson(this.dir, file) : null;
        const inspected = locateDump(this.ctx(), offer);
        if ((!raw && !inspected.dump) || !Array.isArray(args.items) || typeof args.note !== 'string' || args.note.length > 4000) throw Error('BENEFIT_INPUT_MISSING');
        const breakdown = raw ? parseNo1Benefits(raw) : { source: inspected.file, items: [], issues: ['NO1_NOT_OBSERVED'], actualCheckoutPriceConfirmed: false }, seen = new Set();
        for (const item of args.items) {
          if (!Number.isSafeInteger(item.index) || item.index < 0 || item.index > 50 || (raw && !breakdown.items[item.index]) || seen.has(item.index) || !['eligible','ineligible','unknown'].includes(item.eligibility) || typeof item.reason !== 'string' || !Array.isArray(item.evidence)) throw Error('BENEFIT_ASSESSMENT_INVALID');
          seen.add(item.index);
          for (const e of item.evidence) { if (![file, inspected.file].includes(e.file) || !e.quote || !textOf(readEvidence(this.dir, e.file)).includes(e.quote)) throw Error('BENEFIT_QUOTE_INVALID'); }
          if (item.eligibility !== 'unknown' && !item.evidence.length) throw Error('BENEFIT_ELIGIBILITY_EVIDENCE_REQUIRED');
        }
        const saved = readJson(this.dir, 'benefit-assessments.json', {});
        const key = file || offer.id;
        saved[key] = { ...args, at: this.now(), sourceHash: hash(raw || inspected.dump), breakdown, promotionAllowed: false };
        writeJson(this.dir, 'benefit-assessments.json', saved); return saved[key];
      }
      case 'record_evidence': {
        objectArgs(args, ['offerId','offers','seller']); const offer = this.offer(args.offerId), ctx = this.ctx(), { dump, file } = locateDump(ctx, offer);
        if (!dump || !args.offers || typeof args.offers !== 'object' || Array.isArray(args.offers)) throw Error('SOURCE_EVIDENCE_MISSING');
        const checkQuotes = value => {
          if (!value || typeof value !== 'object') return;
          if (Object.hasOwn(value, 'quote') && !validateQuote(value, dump, file)) throw Error('SOURCE_QUOTE_INVALID');
          for (const item of Object.values(value)) checkQuotes(item);
        };
        checkQuotes(args.offers); checkQuotes(args.seller);
        for (const [size, ev] of Object.entries(args.offers)) {
          if (normalizeSize(size) !== ev.size || !ev.optionEvidence || !ev.unitPrice?.evidence || !ev.shipping?.evidence) throw Error('OPTION_EVIDENCE_INCOMPLETE');
        }
        const next = structuredClone(ctx.evidence); next.offers ||= {}; next.sellers ||= {};
        next.offers[offer.id] = { ...(next.offers[offer.id] || {}), ...args.offers };
        if (args.seller) next.sellers[offer.id] = args.seller;
        const checked = verifyOffer({ ...ctx, evidence: next }, offer);
        if (checked.some(v => Object.hasOwn(args.offers, v.size) && v.issues.some(i => ['PRICE_UNCONFIRMED','SHIPPING_UNCONFIRMED'].includes(i.code)))) throw Error('OPTION_PRICE_OR_SHIPPING_NOT_BOUND');
        writeJson(this.dir, 'agent-evidence.json', next);
        return { offerId: offer.id, verification: checked.map(v => ({ size: v.size, status: v.status, issues: v.issues })) };
      }
      case 'record_batch_pricing': {
        objectArgs(args, ['optionId','pricing']);
        const verified = readJson(this.dir, 'verified-offers.json', { items: [] }).items.find(item => item.id === args.optionId);
        const offer = verified && this.offer(verified.offerId), located = offer && locateDump(this.ctx(), offer);
        const quantity = args.pricing?.quantity;
        if (!Number.isSafeInteger(quantity) || quantity < 1 || !verified || !validBatchPricing(args.pricing, quantity, verified.size, located.dump, located.file)) throw Error('BATCH_PRICING_QUOTE_INVALID');
        const batch = readJson(this.dir, 'batch-evidence.json', {});
        batch[args.optionId] ||= {}; batch[args.optionId].pricingByQuantity ||= {}; batch[args.optionId].pricingByQuantity[quantity] = args.pricing;
        writeJson(this.dir, 'batch-evidence.json', batch); return { optionId: args.optionId, quantity, pricing: args.pricing, otherQuantityConditionsConfirmed: false };
      }
      case 'record_batch_conditions': {
        objectArgs(args, ['optionId','quantity','conditions']);
        const verified = readJson(this.dir, 'verified-offers.json', { items: [] }).items.find(item => item.id === args.optionId);
        const located = verified && locateDump(this.ctx(), this.offer(verified.offerId));
        if (!Number.isSafeInteger(args.quantity) || args.quantity < 1 || !verified || !validBatchConditions(args.conditions, args.quantity, verified, located.dump, located.file, this.ctx())) throw Error('BATCH_CONDITIONS_UNVERIFIED');
        const batch = readJson(this.dir, 'batch-evidence.json', {}), prior = batch[args.optionId] || {};
        batch[args.optionId] = { ...prior, ...args.conditions, pricingByQuantity: prior.pricingByQuantity,
          inboundShippingByQuantity: { ...prior.inboundShippingByQuantity, ...args.conditions.inboundShippingByQuantity } };
        writeJson(this.dir, 'batch-evidence.json', batch); return { optionId: args.optionId, quantity: args.quantity, status: 'scenario-assumptions-recorded', salesGuaranteed: false };
      }
      case 'calculate': objectArgs(args, []); return this.calculate();
      default: throw Error('UNKNOWN_TOOL');
    }
  }
  async calculate() {
    const ctx = this.ctx(), screen = screenInitialMargins(ctx);
    writeJson(this.dir, 'margin-screen.json', screen); writeJson(this.dir, 'margin-1st.json', screen.shortlist);
    const legacy = { rows: ctx.products.map(p => ({ '크림ID': String(p.id), '상품명': p.title || '', '모델번호': p.model || '', '판정': '사람 검토', '사유': '전문 에이전트가 수집한 옵션별 근거 확인 필요' })), meta: { engine: 'agentic-codex' } };
    const result = await runAgents(this.dir, { now: this.now(), runId: 'agentic-rules', roleAi: false, legacy });
    const benefits = {};
    for (const offer of result.offers) {
      const market = screen.products.find(p => p.pid === offer.pid)?.offers.flatMap(row => row.screen.options || []) || [];
      const sizes = [...new Map(market.map(row => [row.size, row])).values()];
      for (const file of evidenceFiles(this.dir).filter(f => f === `no1-stock-${offer.id}.json` || f.startsWith(`no1-stock-${offer.id}-`))) {
        const raw = readJson(this.dir, file), parsed = parseNo1Benefits(raw);
        const matched = sizes.filter(row => normalizeSize(raw.option) === row.size);
        benefits[file] = { offerId: offer.id, sourceOption: raw.option, breakdown: parsed, model: offer.model,
          sourceQuoteFresh: fresh(raw.capturedAt, ctx.now, ctx.policy.freshnessMinutes), optionMappingConfirmed: matched.length === 1,
          options: matched.map(row => ({ size: row.size, ...benefitScenario(parsed, row.marketPrice, offer.listedShipping, ctx.policy) })) };
      }
    }
    writeJson(this.dir, 'benefit-scenarios.json', benefits);
    const calculation = { at: this.now(), inputHash: inputDigest(this.dir), margin: screen.summary, benefits,
      options: readJson(this.dir, 'audit.json').items.map(item => ({ optionId: item.id, offerId: item.offerId, pid: item.pid, size: item.size, status: item.status, issues: item.issues, market: item.market,
        row: result.final.rows.find(row => row['옵션ID'] === item.id) })),
      sourceCoverage: { products: ctx.products.length, searched: Object.keys(ctx.cards).length, offers: result.offers.length,
        detailPages: result.offers.filter(offer => locateDump(ctx, offer).dump).length } };
    writeJson(this.dir, 'agentic-calculation.json', calculation); return calculation;
  }
}
