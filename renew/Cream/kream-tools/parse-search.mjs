// 네이버 검색 덤프(dump-Rn-search.json) -> 카드 목록(parsed-search.json) + 상품별 요약 출력
// 카드: 제목, 가격(최저 또는 판매가), 판매처 수, 해외 여부, 관련도(검색어 토큰 일치율), adcr 링크
// 사용: node parse-search.mjs <run-dir>
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2]; const q = JSON.parse(fs.readFileSync(path.join(dir, 'queue.json'), 'utf-8')).queue;
const num = (s) => Number(String(s).replace(/[^\d]/g, ''));
const isPrice = (s) => /^[\d,]{4,}원$/.test(s);
const out = {};
for (const item of q) {
  const f = path.join(dir, `dump-R${item.rank}-search.json`); if (!fs.existsSync(f)) continue;
  const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
  const chunks = d.text.split(/\n\t\n/);
  const tokens = item.naver_query.split(/\s+/).filter((t) => t.length > 1);
  const cards = [];
  for (let i = 0; i < chunks.length; i++) {
    const prevLines = chunks[i].split('\n').map((s) => s.trim()).filter(Boolean);
    if (!/^찜하기\d+$/.test(prevLines[prevLines.length - 1] || '')) continue;   // 카드 시작 표시는 앞 덩어리의 마지막 줄
    const body = chunks[i + 1]; if (!body) continue;
    const mallChunk = (chunks[i + 2] || '').trim().startsWith('쇼핑몰별 최저가') || /^[^\n]*정보\n상품만 보기/.test((chunks[i + 2] || '').trim()) ? chunks[i + 2] : '';
    const lines = body.split('\n').map((s) => s.trim()).filter(Boolean);
    const title = lines[0]; if (!lines.some((l) => l === '배송비' || l === '최저')) continue;
    let price = null; const li = lines.indexOf('최저');
    if (li >= 0 && isPrice(lines[li + 1] || '')) price = num(lines[li + 1]);
    else { const ps = []; for (let k = 1; k < Math.min(lines.length, 14); k++) { if (lines[k - 1] === '배송비' || lines[k - 1].startsWith('포인트')) continue; if (isPrice(lines[k])) ps.push(num(lines[k])); } price = ps.length ? Math.min(...ps) : null; }
    const mallsN = Number((body.match(/판매처\s*(\d+)/) || [])[1] || 1);
    const overseas = /^해외|해외직구|구매대행|배송대행/.test(title) || /해외직구/.test(lines.slice(0, 6).join(' '));
    const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
    const rel = tokens.filter((t) => norm(title).includes(norm(t))).length / Math.max(tokens.length, 1);
    const link = (d.links.find((l) => l.h.includes('cr.shopping.naver.com/adcr') && l.t.trim() === title) || {}).h || null;
    const isCatalog = li >= 0;
    const malls = []; const ml = mallChunk.split('\n').map((s) => s.trim()).filter(Boolean); const mi = ml.indexOf('쇼핑몰별 최저가');
    if (mi >= 0) { for (let k = mi + 1; k < ml.length - 1; k++) { if (/^[\d,]{3,}$/.test(ml[k + 1]) && !/^[\d,]+$/.test(ml[k]) && ml[k] !== '네이버플러스멤버십') malls.push({ mall: ml[k], price: num(ml[k + 1]) }); } }
    else if (ml.length && /정보$/.test(ml[0])) malls.push({ mall: ml[0].replace(/정보$/, ''), price });
    cards.push({ title, price, mallsN, overseas, rel: +rel.toFixed(2), isCatalog, link, malls: malls.slice(0, 6) });
  }
  out[`R${item.rank}`] = { name: item.name, kreamPrice: item.kream_price, query: item.naver_query, cards };
}
fs.writeFileSync(path.join(dir, 'parsed-search.json'), JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) {
  console.log(`\n== ${k} ${v.name} (크림 ${v.kreamPrice.toLocaleString()}원) 카드 ${v.cards.length}개`);
  for (const c of v.cards.slice(0, 6)) console.log(`  ${c.overseas ? '[해외]' : '      '} rel=${c.rel} ${c.price?.toLocaleString() ?? '-'}원 판매처${c.mallsN} ${c.isCatalog ? '[카탈로그]' : ''} ${c.title.slice(0, 44)}`);
}
