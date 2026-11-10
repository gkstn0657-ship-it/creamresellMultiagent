import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const VERSION = 'cream-agents-v1';
export const DEFAULT_POLICY = Object.freeze({ freshnessMinutes: 10, sellerTtlHours: 24, maxFallback: 3, maxLlmCalls: 5, maxLlmInputChars: 20000,maxRoleAiCalls:96,maxRoleAiInputChars:160000,
  feeRate: 0.05, sellerFixedFee: 0, feeVatRate: 0, feeCap: 300000, packingCost: 0,
  outboundShipping: 3000, minCashProfit: 0, stressPriceDrop: 0, costPolicyConfirmed: false });
export const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function readJson(dir, file, fallback = null) {
  const target = path.join(dir, file);
  if (!fs.existsSync(target)) return fallback;
  try { return JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error(`${file}: JSON 읽기 실패 (${error.message})`); }
}
export function writeJson(dir, file, value) {
  const target = path.join(dir, file); fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8'); fs.renameSync(temp, target);
}
export function acquireRunLock(dir) {
  const file = path.join(dir, '.cream-run.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx'); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); fs.closeSync(fd);
      return () => { try { if (JSON.parse(fs.readFileSync(file, 'utf8')).pid === process.pid) fs.unlinkSync(file); } catch {} };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner; try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('실행 잠금 파일을 읽을 수 없음. 동시 실행 여부 확인 필요'); }
      let alive = false; if (Number.isSafeInteger(owner.pid) && owner.pid > 0) { try { process.kill(owner.pid, 0); alive = true; } catch (error) { alive = error.code !== 'ESRCH'; } }
      if (alive) throw new Error(`같은 폴더를 실행 중인 프로세스가 있음(PID ${owner.pid})`);
      fs.unlinkSync(file);
    }
  }
  throw new Error('실행 잠금 획득 실패');
}
export function canonicalUrl(raw) {
  try { const url = new URL(raw); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort(); return url.href;
  } catch { return ''; }
}
export const normalizeSize = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
export const offerId = (pid, url) => `${pid}-${hash(canonicalUrl(url)).slice(0, 16)}`;
export const optionId = (id, size) => `${id}-${hash(normalizeSize(size)).slice(0, 12)}`;
export const productJobId = (offer) => `N${offer.pid}-${offer.id.split('-').at(-1)}-prod`;
export const envelope = (ctx, items, extra = {}) => ({ version: VERSION, runId: ctx.runId, at: ctx.now, items, ...extra });
export const issue = (code, detail) => ({ code, detail });
export function validTime(at) { return typeof at === 'string' && Number.isFinite(Date.parse(at)); }
export function fresh(at, now, minutes) { const age = Date.parse(now) - Date.parse(at); return validTime(at) && age >= -60000 && age <= minutes * 60000; }
export function context(dir, options = {}) {
  const policy = { ...DEFAULT_POLICY, ...readJson(dir, 'agent-policy.json', {}) };
  for (const key of ['freshnessMinutes', 'sellerTtlHours', 'maxFallback', 'maxLlmCalls', 'maxLlmInputChars']) if (!Number.isFinite(policy[key]) || policy[key] < 0) throw new Error(`agent-policy.json: ${key} 값 오류`);
  for (const key of ['maxFallback', 'maxLlmCalls', 'maxLlmInputChars','maxRoleAiCalls','maxRoleAiInputChars']) if (!Number.isSafeInteger(policy[key]) || policy[key] < 0) throw new Error(`agent-policy.json: ${key} 0 이상 정수 필요`);
  if (policy.feeRate < 0 || policy.feeRate >= 1 || !Number.isFinite(policy.feeRate) || !Number.isSafeInteger(policy.outboundShipping) || policy.outboundShipping < 0) throw new Error('agent-policy.json: 비용 규칙 오류');
  for (const key of ['sellerFixedFee', 'feeCap', 'packingCost', 'minCashProfit']) if (!Number.isSafeInteger(policy[key]) || policy[key] < 0) throw new Error(`agent-policy.json: ${key} 비용 규칙 오류`);
  for (const key of ['feeVatRate', 'stressPriceDrop']) if (!Number.isFinite(policy[key]) || policy[key] < 0 || policy[key] >= 1) throw new Error(`agent-policy.json: ${key} 비율 오류`);
  for (const key of ['totalBudget', 'maxPurchasePrice', 'minBatchProfit', 'minMarketPrice']) if (policy[key] != null && (!Number.isSafeInteger(policy[key]) || policy[key] < 0)) throw new Error(`agent-policy.json: ${key} 값 오류`);
  if (policy.quantitiesToCompare != null && (!Array.isArray(policy.quantitiesToCompare) || !policy.quantitiesToCompare.length || policy.quantitiesToCompare.some(q => !Number.isSafeInteger(q) || q < 1))) throw new Error('agent-policy.json: 비교 수량 오류');
  const now = options.now || new Date().toISOString();
  if (!validTime(now)) throw new Error('판정 시각 오류');
  return { dir: path.resolve(dir), policy, now, runId: options.runId || `${path.basename(path.resolve(dir))}-${hash(now).slice(0, 12)}`,
    products: readJson(dir, 'k50-all.json', readJson(dir, 'k50.json', [])), cards: readJson(dir, 'n-cards.json', {}), catalogs: readJson(dir, 'n-cat.json', {}),
    jobs: readJson(dir, 'jobs.json', { jobs: [] }).jobs, evidence: readJson(dir, 'agent-evidence.json', { offers: {}, sellers: {} }) };
}
export function quote(source, field, text) { return { source, field, quote: String(text).slice(0, 500) }; }
export function validateQuote(ref, dump, file) {
  if (!ref || ref.source !== file || typeof ref.quote !== 'string' || ref.quote.trim().length < 2) return false;
  if (ref.field === 'stockProbe.results.offerText') {
    const row = dump?.stockProbe?.results?.find((r) => normalizeSize(r.size) === ref.size && (r.optionKey || null) === ref.optionKey && ['available','limit'].includes(r.state));
    return row?.offerQuantity === 1 && typeof row.offerText === 'string' && row.offerText.includes(ref.quote);
  }
  if (!['text', 'title'].includes(ref.field)) return false;
  return String(dump?.[ref.field] || '').includes(ref.quote);
}
export const money = (n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
export function quotedAmounts(text) {
  return [...String(text || '').matchAll(/(?<![\d,.])(?:\d{1,3}(?:,\d{3})+|\d+)(?![\d,.])\s*원/g)].map((m) => Number(m[0].replace(/[^\d]/g, '')));
}
export function moneyInQuote(n, ref) {
  if (!money(n)) return false;
  const text = ref?.quote || '';
  if (n === 0 && /(?:배송비\s*무료|무료\s*배송)(?=$|[\s().·/])/.test(text) && !/이상|조건|쿠폰|회원|제외|불가|아님|않|지역|제주|도서|추가/.test(text)) return true;
  return quotedAmounts(text).includes(n);
}
export function sizeInQuote(size, text) {
  const escaped = normalizeSize(size).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!size || size === '*') return false;
  if (new RegExp(`(?<![A-Z0-9.])${escaped}(?![A-Z0-9.])`, 'i').test(String(text || ''))) return true;
  // Retailers number option rows as "1.S(90)". Only a line-start list index
  // before an alphabetic size is allowed; decimal sizes and model suffixes
  // still cannot borrow the tail of a longer token.
  return /^[A-Z][A-Z0-9 ]*$/.test(normalizeSize(size)) &&
    new RegExp(`(?:^|\\n)\\s*\\d+[.)]\\s*${escaped}(?![A-Z0-9.])`, 'i').test(String(text || ''));
}
export function saleFee(price, policy) {
  return Math.min(policy.feeCap ?? 300000, Math.ceil((price * policy.feeRate + (policy.sellerFixedFee ?? 0)) * (1 + (policy.feeVatRate ?? 0)) - 1e-7));
}
export function profit(price, cost, policy) { return price - saleFee(price, policy) - policy.outboundShipping - (policy.packingCost ?? 0) - cost; }
export function median(values) { const a = [...values].sort((x, y) => x - y); const i = Math.floor(a.length / 2); return !a.length ? null : a.length % 2 ? a[i] : Math.round((a[i - 1] + a[i]) / 2); }

// Relative dates are anchored to the ORIGINAL capture time, never to replay time.
export function tradesFromDump(dump) {
  if (!validTime(dump?.at)) return [];
  const base = new Date(dump.at); const kst = new Date(base.getTime() + 9 * 3600000);
  const midnight = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600000;
  const lines = String(dump.text || '').split('\n').map((s) => s.trim()).filter(Boolean), start = lines.lastIndexOf('거래일'), out = [];
  if (start < 0) return out;
  for (let i = start + 2; i < lines.length; i++) {
    if (!/^[\d,]+원$/.test(lines[i]) || lines[i - 1].length > 12 || /즉시/.test(lines[i - 1])) continue;
    let at = null;
    for (const line of lines.slice(i + 1, i + 4)) {
      const m = line.match(/^(\d{2,4})\/(\d{2})\/(\d{2})$/), days = line.match(/^(\d+)일 전$/);
      if (m) { const year = Number(m[1]) + (m[1].length === 2 ? 2000 : 0); at = Date.UTC(year, Number(m[2]) - 1, Number(m[3])) - 9 * 3600000; break; }
      if (days) { at = midnight - Number(days[1]) * 86400000; break; }
      if (/방금|오늘|\d+\s*(?:분|시간) 전/.test(line)) { at = midnight; break; }
      if (/원$/.test(line)) break;
    }
    if (at != null) out.push({ size: normalizeSize(lines[i - 1]), price: Number(lines[i].replace(/[^\d]/g, '')), at: new Date(at).toISOString() });
  }
  return out;
}
