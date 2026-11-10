// 스톤아일랜드 검색 덤프(dump-SI<id>-s.json) -> 모델번호 일치 카드만 추출 (시즌코드·스타일코드 정규화 비교, 해외 제외)
// 사용: node parse-si.mjs <run-dir>   → si-cards.json
import fs from 'node:fs'; import path from 'node:path';
// 인수: <run-dir> [접두사=SI] [상품파일=si-kream.json] [출력=si-cards.json]  (이번 50개: N k50.json n-cards.json)
const dir = process.argv[2]; const PFX = process.argv[3] || 'SI', DATA = process.argv[4] || 'si-kream.json', OUTF = process.argv[5] || 'si-cards.json';
const si = JSON.parse(fs.readFileSync(path.join(dir, DATA), 'utf-8')).map((p) => ({ ...p, name: p.name || p.title }));
const num = (s) => Number(String(s).replace(/[^\d]/g, '')); const isPrice = (s) => /^[\d,]{4,}원$/.test(s);
const norm = (s) => String(s).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const out = {};
for (const p of si) {
  const f = path.join(dir, `dump-${PFX}${p.id}-s.json`); if (!fs.existsSync(f)) continue;
  const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
  const f2 = path.join(dir, `dump-${PFX}${p.id}-s2.json`);   // 다른 검색어(q2) 재검색 결과가 있으면 합쳐서 사용
  if (fs.existsSync(f2)) { const d2 = JSON.parse(fs.readFileSync(f2, 'utf-8')); d.text += '\n\t\n' + d2.text; d.links = d.links.concat(d2.links); }
  // Kream 모델 L1S1561000-60S0051-V0029 -> 비교키: L1S156100060S0051 (시즌+상품+스타일), 색상: V0029
  const nm = norm(p.model); const key = nm.slice(0, nm.indexOf('V', 8) > 0 ? nm.lastIndexOf('V') : nm.length); const color = nm.slice(nm.lastIndexOf('V'));
  const chunks = d.text.split(/\n\t\n/); const cards = [];
  for (let i = 0; i < chunks.length; i++) {
    const prev = chunks[i].split('\n').map((s) => s.trim()).filter(Boolean);
    if (!/^찜하기\d+$/.test(prev[prev.length - 1] || '')) continue;
    const body = chunks[i + 1]; if (!body) continue; const lines = body.split('\n').map((s) => s.trim()).filter(Boolean);
    const title = lines[0]; if (!lines.some((l) => l === '배송비' || l === '최저')) continue;
    let price = null; const li = lines.indexOf('최저');
    if (li >= 0 && isPrice(lines[li + 1] || '')) price = num(lines[li + 1]);
    else { const ps = []; for (let k = 1; k < Math.min(lines.length, 14); k++) { if (lines[k - 1] === '배송비' || lines[k - 1].startsWith('포인트')) continue; if (isPrice(lines[k])) ps.push(num(lines[k])); } price = ps.length ? Math.min(...ps) : null; }
    const mallsN = Number((body.match(/판매처\s*(\d+)/) || [])[1] || 1);
    const overseas = /^해외|해외직구|구매대행|배송대행/.test(title) || /해외직구/.test(lines.slice(0, 6).join(' '));
    const link = (d.links.find((l) => l.h.includes('cr.shopping.naver.com/adcr') && l.t.trim() === title) || {}).h || null;
    const t = norm(title); const keyMatch = t.includes(key); const colorMatch = t.includes(color) ? true : (/V0[A-Z]\d{2}|V\d{4}/.test(t) ? false : null);
    const mallChunk = (chunks[i + 2] || ''); const ml = mallChunk.split('\n').map((s) => s.trim()).filter(Boolean);
    const topMalls = []; const mi = ml.indexOf('쇼핑몰별 최저가');
    if (mi >= 0) { for (let k = mi + 1; k < ml.length - 1; k++) { if (/^[\d,]{3,}$/.test(ml[k + 1]) && !/^[\d,]+$/.test(ml[k]) && ml[k] !== '네이버플러스멤버십' && ml[k] !== '네이버페이') topMalls.push({ mall: ml[k], price: num(ml[k + 1]) }); } }
    if (!topMalls.length && ml.length && /정보$/.test(ml[0])) topMalls.push({ mall: ml[0].replace(/정보$/, ''), price });   // 단일 상품 카드: 다음 덩어리의 첫 줄이 판매처명
    cards.push({ title, price, mallsN, overseas, isCatalog: li >= 0, keyMatch, colorMatch, link, topMalls: topMalls.slice(0, 6) });
  }
  const matched = cards.filter((c) => c.keyMatch && !c.overseas);
  out[p.id] = { name: p.name, model: p.model, key, color, kream: p.kreamMed, cards: cards.length, matched };
}
fs.writeFileSync(path.join(dir, OUTF), JSON.stringify(out, null, 1));
for (const [id, v] of Object.entries(out)) {
  console.log(`\n== ${id} ${v.name.slice(0, 48)} | 키 ${v.key} ${v.color} | 크림 ${v.kream.toLocaleString()}원 | 카드 ${v.cards}개 중 모델일치 ${v.matched.length}개`);
  for (const c of v.matched.slice(0, 4)) console.log(`   ${c.price?.toLocaleString()}원 판매처${c.mallsN} ${c.isCatalog ? '[카탈로그]' : '[단일]'} 색상일치=${c.colorMatch} ${c.title.slice(0, 50)} | ${c.topMalls.map((m) => m.mall).slice(0, 3).join('/')}`);
}
