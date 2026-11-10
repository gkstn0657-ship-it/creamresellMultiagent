import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { modelFromDump, compareModel } from './model-evidence.mjs';
import { runAgents } from '../renew/Cream/kream-tools/agents-run.mjs';
import { acquireRunLock, writeJson } from '../renew/Cream/kream-tools/agents-core.mjs';

// Bridge the legacy multi-brand source format into the SAME mandatory agent gates.
export async function validateSourcing(sourceDir) {
  const dir = path.resolve(sourceDir), out = path.join(dir, 'validated'); fs.mkdirSync(out, { recursive: true });
  const release = acquireRunLock(out);
  try {
    const read = (file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const products = read('multi.json'), matches = read('n-multi.json'), legacy = read('final-multi.json'), cards = {}, normalized = [];
    for (const p of products) {
      if (!/^\d+$/.test(String(p.id))) throw new Error('상품 ID 형식 오류');
      let model = p.model || ''; const file = `dump-K${p.id}.json`;
      if (fs.existsSync(path.join(dir, file))) { const dump = read(file); model = modelFromDump(dump) || model; fs.copyFileSync(path.join(dir, file), path.join(out, file)); }
      normalized.push({ ...p, title: p.name, model });
    }
    for (const file of fs.readdirSync(dir).filter((f) => /^dump-N\d+(?:-[a-f0-9]+)?-prod\.json$/.test(f))) fs.copyFileSync(path.join(dir, file), path.join(out, file));
    for (const file of ['jobs.json','agent-policy.json','agent-evidence.json']) {
      if (fs.existsSync(path.join(dir, file))) fs.copyFileSync(path.join(dir, file), path.join(out, file));
      else if (file !== 'jobs.json') writeJson(out, file, file === 'agent-evidence.json' ? { offers: {}, sellers: {} } : {});
    }
    if (!fs.existsSync(path.join(out, 'jobs.json'))) writeJson(out, 'jobs.json', { jobs: [] });
    for (const m of matches) {
      const p = normalized.find((x) => String(x.id) === String(m.id)); if (!p) continue;
      const sources = [...new Set([m.bestAny, m.bestTrusted, m.best].filter(Boolean))];
      cards[String(m.id)] = { matched: sources.map((s) => ({ ...s, isCatalog: false, mall: s.mallName || '', keyMatch: true,
        colorMatch: compareModel(p.model, s.title, p.keyword).status === 'mismatch' ? false : null,
        shipFee: null, topMalls: s.topMalls || [{ mall: s.mallName || '' }] })) };
    }
    for (const row of legacy.rows) {
      const p = normalized.find((x) => String(x.id) === String(row['크림ID'])), m = matches.find((x) => String(x.id) === String(row['크림ID']));
      if (p?.model) row['모델번호'] = p.model;
      const check = compareModel(p?.model, m?.best?.title, p?.keyword);
      if (check.status === 'mismatch') { row['판정'] = '제외'; row['사유'] = check.reason; row['예상순수익(원)'] = ''; row['수익률(%)'] = ''; row['검증사유코드'] = 'MODEL_MISMATCH'; }
      else if (row['판정'] !== '제외') { row['기존분류'] = row['판정']; row['판정'] = '사람 검토'; }
    }
    writeJson(out, 'k50.json', normalized); writeJson(out, 'k50-all.json', normalized); writeJson(out, 'n-cards.json', cards); writeJson(out, 'n-cat.json', {});
    const result = await runAgents(out, { legacy });
    return { dir: out, rows: result.final.rows, counts: { candidates: result.final.rows.filter((r) => r['판정'] === '후보').length,
      review: result.final.rows.filter((r) => r['판정'] === '사람 검토').length, excluded: result.final.rows.filter((r) => r['판정'] === '제외').length } };
  } finally { release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const r = await validateSourcing(process.argv[2]); console.log(JSON.stringify({ output: r.dir, ...r.counts })); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
