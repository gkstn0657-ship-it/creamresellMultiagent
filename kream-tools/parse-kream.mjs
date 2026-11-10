// 크림 상품 덤프(dump-K<id>.json) -> k50.json: 상품명, 모델번호, 최근 체결 40건 시세(중앙값/최저/최고), 사이즈 분포, 네이버 검색어(q1/q2)
// 사용: node parse-kream.mjs <run-dir>
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2]; const ids = JSON.parse(fs.readFileSync(path.join(dir, 'k50-ids.json'), 'utf-8'));
const isNum = (s) => s.length > 0 && [...s].every((c) => c >= '0' && c <= '9');
const med = (a) => { const s = [...a].sort((x, y) => x - y), k = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[k] : Math.round((s[k - 1] + s[k]) / 2)) : null; };
const re = /^([A-Z]\dS\d{2})(\d{5})-(\d{2})(S[0-9A-Z]+)-(V[0-9A-Z]{4})$/;
const out = [];
for (const id of ids) {
  const f = path.join(dir, `dump-K${id}.json`); if (!fs.existsSync(f)) continue;
  const d = JSON.parse(fs.readFileSync(f, 'utf-8')); const L = d.text.split('\n').map((s) => s.trim()).filter(Boolean);
  const mi = L.findIndex((s) => s.startsWith('모델번호')); const model = mi < 0 ? null : (L[mi].length > 5 ? L[mi].replace(/^모델번호\s*/, '') : (L[mi + 1] || ''));
  const rel = (() => { const i = L.findIndex((s) => s.startsWith('발매가')); return i < 0 ? null : (L[i].replace(/^발매가\s*/, '') || L[i + 1] || null); })();
  const st = L.lastIndexOf('거래일'); const rows = [];
  if (d.text.includes('거래 및 입찰 내역') && st >= 0) for (let i = st + 1; i < L.length && rows.length < 40; i++) {
    const s = L[i]; if (!s.endsWith('원')) continue; const v = s.slice(0, -1).split(',').join(''); if (!isNum(v) || L[i - 1].length >= 8) continue; rows.push({ size: L[i - 1], price: Number(v) });
  }
  const ps = rows.map((r) => r.price); const sz = {}; rows.forEach((r) => { sz[r.size] = (sz[r.size] || 0) + 1; });
  const m = model && model.match(re); const q1 = m ? `${m[1]} ${m[2]}${m[3]} ${m[4]}-${m[5]}` : (model ? model.replace(/-/g, ' ') : null); const q2 = m ? `${m[1]} ${m[2]}${m[3]} ${m[4]} ${m[5]}` : null;
  out.push({ id, title: d.title.replace(/ 정품 안심 거래.*$/, '').slice(0, 90), model, rel, n: ps.length, kreamMed: med(ps), kreamMin: ps.length ? Math.min(...ps) : null, kreamMax: ps.length ? Math.max(...ps) : null, sizes: sz, q1, q2, fmtOk: !!m, blocked: d.blocked });
}
// 제 도구(브라우저)로 먼저 수집한 상품(덤프 없음): [id, 제목, 모델, 시세 중앙값, 체결 건수]
const extra = [[611768, '스톤 아일랜드 4100019 매트 립스탑 코듀라 어드밴스드 다운', 'K2S1541000-19S0182-V0029', 1473000, 40], [988319, '스톤 아일랜드 6100009 오가닉 코튼 플리스 집업 후드 블랙 26FW', 'L2S1561000-09S0051-V0029', 485000, 18], [821377, '스톤 아일랜드 1200038 나일론 메탈 에코닐 오버셔츠 펄 그레이', 'L1S1512000-38S0019-V0061', 596000, 40]];
for (const [id, title, model, med, n] of extra) {
  const m = model.match(re);
  out.push({ id: String(id), title, model, rel: null, n, kreamMed: med, kreamMin: null, kreamMax: null, sizes: {}, q1: m ? `${m[1]} ${m[2]}${m[3]} ${m[4]}-${m[5]}` : model.replace(/-/g, ' '), q2: m ? `${m[1]} ${m[2]}${m[3]} ${m[4]} ${m[5]}` : null, fmtOk: !!m, blocked: false, extra: true });
}
fs.writeFileSync(path.join(dir, 'k50.json'), JSON.stringify(out, null, 1));
console.log(`${out.length}/${ids.length} 파싱, 표준 모델형식 ${out.filter((o) => o.fmtOk).length}개`);
for (const o of out) console.log(`${String(o.id).padStart(8)} ${String(o.kreamMed ?? '-').padStart(9)} n=${String(o.n).padStart(2)} ${(o.model || '(모델없음)').slice(0, 30).padEnd(30)} ${o.title.slice(0, 40)}`);
