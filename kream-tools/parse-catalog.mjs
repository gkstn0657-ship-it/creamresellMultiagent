// 네이버 카탈로그 덤프(dump-*-catalog*.json) -> 판매처 행 목록. 행: 제목, 판매처, 가격, 배송비, 해외 여부, 링크(adcr)
// 사용: node parse-catalog.mjs <run-dir> <dump-id> [제목에 반드시 포함할 키워드...]
import fs from 'node:fs'; import path from 'node:path';
const [dir, id, ...must] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(path.join(dir, `dump-${id}.json`), 'utf-8'));
const isPrice = (s) => /^(최저)?[\d,]{4,}원$/.test(s); const num = (s) => Number(String(s).replace(/[^\d]/g, ''));
const L = d.text.split('\n').map((s) => s.trim()).filter(Boolean);
const start = L.findIndex((s) => s === '네이버페이 가맹점만 보기'); const rows = [];
for (let k = Math.max(0, start); k < L.length; k++) {
  if (!L[k].endsWith('로 이동하기')) continue;
  const title = L[k].replace(/로 이동하기$/, ''); const mall = L[k + 1];
  let price = null, ship = '', j = k + 1;
  for (; j < k + 12 && j < L.length; j++) { if (isPrice(L[j]) && price === null) price = num(L[j]); if (L[j] === '배송비') { ship = L[j + 1] || ''; break; } }
  const near = L.slice(k, k + 10).join(' ');
  const overseas = /해외직구|해외배송|구매대행|배송대행/.test(near) || /^해외/.test(title);
  const link = (d.links.find((l) => l.t.trim() === L[k].trim() && l.h.includes('adcr')) || {}).h || null;
  rows.push({ mall, price, ship, overseas, title, link });
}
const sel = rows.filter((r) => must.every((m) => r.title.includes(m)));
console.log(`${id}: 행 ${rows.length}개 (조건 일치 ${sel.length}개)`);
for (const r of sel.sort((a, b) => a.price - b.price)) console.log(`  ${r.overseas ? '[해외] ' : ''}${r.price?.toLocaleString()}원 | ${r.mall} | 배송비 ${r.ship} | ${r.title.slice(0, 70)}`);
fs.writeFileSync(path.join(dir, `catalog-${id}.json`), JSON.stringify(rows, null, 1));
