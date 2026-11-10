import fs from 'node:fs';
import path from 'node:path';
import { modelFromDump, compareModel } from './model-evidence.mjs';
const dir = path.resolve(process.argv[2]), apply = process.argv.includes('--apply');
const report = JSON.parse(fs.readFileSync(path.join(dir, 'report-data.json'), 'utf8'));
const products = JSON.parse(fs.readFileSync(path.join(dir, 'multi.json'), 'utf8'));
const items = [];
for (const row of [...report.candidates, ...report.reference]) {
  const candidates = products.filter((p) => p.name === row.name && p.keyword === row.keyword); if (candidates.length !== 1) continue;
  const p = candidates[0]; let dump; try { dump = JSON.parse(fs.readFileSync(path.join(dir, `dump-K${p.id}.json`), 'utf8')); } catch { continue; }
  const model = modelFromDump(dump), check = compareModel(model, row.bestTitle, row.keyword);
  items.push({ id: String(p.id), model, sellerTitle: row.bestTitle, ...check, source: `dump-K${p.id}.json` });
}
if (apply) {
  const file = path.join(dir, 'final-multi.json'), backup = path.join(dir, 'final-multi.before-model-validation.json');
  const final = JSON.parse(fs.readFileSync(file, 'utf8')); if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  for (const row of final.rows) {
    const item = items.find((i) => i.id === String(row['크림ID'])); if (!item) continue;
    if (item.model) row['모델번호'] = item.model;
    if (item.status === 'mismatch') {
      if (typeof row['예상순수익(원)'] === 'number') row['검증전 예상순수익(원)'] = row['예상순수익(원)'];
      row['판정'] = '제외'; row['사유'] = item.reason; row['예상순수익(원)'] = ''; row['수익률(%)'] = ''; row['검증사유코드'] = 'MODEL_MISMATCH';
    } else if (item.status !== 'matched' && String(row['판정']).startsWith('후보')) {
      row['판정'] = '사람 검토'; row['사유'] = item.reason; row['검증사유코드'] = 'MODEL_UNCONFIRMED';
    }
  }
  const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(final, null, 1)); fs.renameSync(temp, file);
}
const result = { at: new Date().toISOString(), applied: apply, items };
fs.writeFileSync(path.join(dir, 'model-validation.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ checked: items.length, excluded: items.filter((i) => i.status === 'mismatch').length, unconfirmed: items.filter((i) => i.status === 'unconfirmed').length, applied: apply }));
