// 여러 브랜드의 k50-ids*.json을 모두 모아 dump-K<id>.json을 파싱 -> multi.json
// 사용: node parse-multi.mjs <run-dir>
import fs from 'node:fs'; import path from 'node:path';
import { modelFromDump } from './model-evidence.mjs';
const dir = process.argv[2];
const isNum = (s) => s.length > 0 && [...s].every((c) => c >= '0' && c <= '9');
const med = (a) => { const s = [...a].sort((x, y) => x - y), k = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[k] : Math.round((s[k - 1] + s[k]) / 2)) : null; };

const idFiles = fs.readdirSync(dir).filter(f => /^k50-ids.*\.json$/.test(f));
const items = [];
for (const f of idFiles) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
  const keyword = data.keyword || f;
  for (const it of (data.ids || [])) items.push({ ...it, keyword });
}

const out = [];
for (const it of items) {
  const id = it.id;
  const fp = path.join(dir, `dump-K${id}.json`);
  if (!fs.existsSync(fp)) { out.push({ ...it, status: 'no-dump' }); continue; }
  const d = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  const L = (d.text || '').split('\n').map(s => s.trim()).filter(Boolean);
  const st = L.lastIndexOf('거래일'); const rows = [];
  if ((d.text || '').includes('거래 및 입찰 내역') && st >= 0) {
    for (let i = st + 1; i < L.length && rows.length < 40; i++) {
      const s = L[i]; if (!s.endsWith('원')) continue;
      const v = s.slice(0, -1).split(',').join('');
      if (!isNum(v) || L[i - 1].length >= 8) continue;
      rows.push({ size: L[i - 1], price: Number(v) });
    }
  }
  const ps = rows.map(r => r.price);
  out.push({
    ...it,
    model: modelFromDump(d),
    status: d.blocked ? 'blocked' : (ps.length ? 'ok' : 'no-tx'),
    n: ps.length,
    kreamMed: med(ps),
    kreamMin: ps.length ? Math.min(...ps) : null,
    kreamMax: ps.length ? Math.max(...ps) : null,
  });
}
fs.writeFileSync(path.join(dir, 'multi.json'), JSON.stringify(out, null, 1));
const ok = out.filter(o => o.status === 'ok');
console.log(`총 ${items.length}개 후보, 덤프완료 ${out.filter(o=>o.status!=='no-dump').length}, 체결있음 ${ok.length}`);
for (const o of out) console.log(`[${o.keyword}] ${String(o.id).padStart(8)} ${o.status.padEnd(8)} med=${String(o.kreamMed ?? '-').padStart(9)} n=${String(o.n ?? '-').padStart(3)} 매입가=${String(o.price).padStart(9)} ${o.name}`);
