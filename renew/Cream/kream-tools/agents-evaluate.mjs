import fs from 'node:fs';
import path from 'node:path';
import { hash, readJson, writeJson } from './agents-core.mjs';
import { extractPageEvidence } from './agents-extract.mjs';
const root = path.resolve(process.argv[2] || 'kream-runs'), out = path.resolve(process.argv[3] || 'agent-evaluation');
fs.mkdirSync(out, { recursive: true });
const cases = [], sources = [], hosts = {}, coverage = { supportedPages: 0, scopedOptionPrices: 0, sellerPanels: 0 }, seen = new Set();
for (const run of fs.readdirSync(root).sort()) {
  const dir = path.join(root, run); if (!fs.statSync(dir).isDirectory()) continue;
  const products = readJson(dir, 'k50-all.json', readJson(dir, 'k50.json', []));
  for (const file of fs.readdirSync(dir).filter((f) => /^dump-N.*-prod\.json$/.test(f)).sort()) {
    const dump = readJson(dir, file), fingerprint = hash([dump.url, dump.at, dump.text, dump.stockProbe]); if (seen.has(fingerprint)) continue; seen.add(fingerprint);
    let host = ''; try { host = new URL(dump.url).hostname; } catch {}
    hosts[host] = (hosts[host] || 0) + 1;
    const extracted = extractPageEvidence(dump, file), pid = file.match(/^dump-N(\d+)-/)?.[1], p = products.find((x) => String(x.id) === pid);
    if (extracted.adapter) coverage.supportedPages++; coverage.scopedOptionPrices += Object.keys(extracted.offers).length; if (extracted.seller) coverage.sellerPanels++;
    const item = { caseId: 'archive-' + fingerprint.slice(0, 20), source: { run, file, fingerprint }, host, observedAt: dump.at || null,
      productId: pid || null, model: p?.model || null, productTitle: p?.title || null,
      observed: { blocked: Boolean(dump.blocked), failed: Boolean(dump.failed), optionCount: dump.stockProbe?.results?.length || 0,
        available: (dump.stockProbe?.results || []).filter((r) => ['available','limit'].includes(r.state)).map((r) => r.size),
        soldout: (dump.stockProbe?.results || []).filter((r) => r.state === 'soldout').map((r) => r.size) },
      automatic: { adapter: extracted.adapter, priceOptions: Object.keys(extracted.offers), sellerPanel: Boolean(extracted.seller), issues: extracted.issues },
      expectedVerdict: null, reviewedBy: null, reviewEvidence: [], reviewStatus: '독립 수동 검토 대기' };
    sources.push(item); cases.push(item);
  }
}
// Stratify archived verdicts AND runs; never fill the queue from the first run alone.
const buckets = new Map();
for (const run of fs.readdirSync(root).sort()) {
  const dir = path.join(root, run); if (!fs.statSync(dir).isDirectory()) continue;
  const final = readJson(dir, 'final-all.json');
  for (const [index, row] of (final?.rows || []).entries()) {
    const fingerprint = hash([run, index, row['크림ID'], row['상품명'], row['판정']]);
    const key = `${run}|${String(row['판정']).startsWith('후보') ? '후보' : row['판정']}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ caseId: 'result-' + fingerprint.slice(0, 20), source: { run, file: 'final-all.json', rowIndex: index, fingerprint }, productId: String(row['크림ID']),
      model: row['모델번호'] || null, productTitle: row['상품명'], observed: { historicalVerdict: row['판정'], estimatedProfit: row['예상순수익(원)'] },
      expectedVerdict: null, reviewedBy: null, reviewEvidence: [], reviewStatus: '독립 수동 검토 대기' });
  }
}
while (cases.length < 100 && [...buckets.values()].some((b) => b.length)) {
  for (const bucket of buckets.values()) { if (cases.length >= 100) break; if (bucket.length) cases.push(bucket.shift()); }
}
const existing = readJson(out, 'review-labels.json', []), labels = new Map(existing.map((l) => [l.caseId, l]));
let reviewed = 0, correct = 0, compared = 0;
for (const c of cases) {
  const label = labels.get(c.caseId); if (!label) continue;
  if (!['후보','사람 검토','제외'].includes(label.expectedVerdict) || !label.reviewedBy || !Array.isArray(label.reviewEvidence) || !label.reviewEvidence.length) throw new Error(`독립 정답 라벨 근거 누락: ${c.caseId}`);
  Object.assign(c, { expectedVerdict: label.expectedVerdict, reviewedBy: label.reviewedBy, reviewEvidence: label.reviewEvidence, reviewStatus: '독립 수동 검토 완료' }); reviewed++;
  if (c.observed.historicalVerdict != null) { compared++; if (c.observed.historicalVerdict === label.expectedVerdict) correct++; }
}
writeJson(out, 'review-cases.json', cases);
const report = { at: new Date().toISOString(), actualDumpPages: sources.length, cases: cases.length, reviewed, unreviewed: cases.length - reviewed,
  comparedHistoricalRows: compared, historicalVerdictAgreement: compared ? correct / compared : null, candidatePrecision: null, note: '자동 추출 관측값은 정답 라벨이 아님. 독립 검토 전 정확도·누락률을 산출하지 않음',
  adapters: coverage, hosts: Object.entries(hosts).sort((a, b) => b[1] - a[1]) };
writeJson(out, 'evaluation-report.json', report); console.log(JSON.stringify(report));
