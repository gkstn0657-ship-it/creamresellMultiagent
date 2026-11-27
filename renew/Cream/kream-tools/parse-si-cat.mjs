// 카탈로그 덤프(dump-SI<id>-cat.json) -> 판매처 행 중 '신뢰 판매처'만 남겨 모델·색상 대조 후 최저가 계산 (si-cat.json)
// 사용: node parse-si-cat.mjs <run-dir>
import fs from 'node:fs'; import path from 'node:path'; import { codeMatch, parseShip } from './code-match.mjs';   // 2026-11-07: 색상 코드 정확 일치(띄어쓰기 차이만 허용·표시)
import { eligibleListing } from './margin-screen.mjs';
// 인수: <run-dir> [접두사=SI] [상품파일=si-kream.json] [출력=si-cat.json]  (이번 50개: N k50.json n-cat.json)
const dir = process.argv[2]; const PFX = process.argv[3] || 'SI', DATA = process.argv[4] || 'si-kream.json', OUTF = process.argv[5] || 'si-cat.json';
const publicProduct = process.argv.includes('--public-product');
const si = JSON.parse(fs.readFileSync(path.join(dir, DATA), 'utf-8')).map((p) => ({ ...p, name: p.name || p.title }));
const TRUSTED = ['롯데ON', '롯데백화점', '롯데홈쇼핑', '현대Hmall', '현대백화점', '더현대', '신세계몰', '신세계라이브쇼핑', 'SSG닷컴', 'SSG.COM', '신세계V', '신세계백화점', '갤러리아', 'AK몰', '머스트잇', '더블유컨셉', 'W컨셉', '무신사', '29CM', '트렌비', 'LFmall', 'CJ온스타일', 'GSSHOP', 'GS SHOP', 'SK스토아', 'KT알파쇼핑', '스타필드', '에스아이빌리지', 'SI VILLAGE'];
const sourceRank = (m, link = '') => {
  const label = String(m);
  if (/(?:smartstore|brand)\.naver\.com/i.test(link) || /스마트스토어|네이버\s*스토어/i.test(label)) return 0;
  if (TRUSTED.some((t) => label.replace(/\s/g, '').toLowerCase().includes(t.replace(/\s/g, '').toLowerCase()))) return 1;
  if (/쿠팡|Coupang|11번가|G마켓|Gmarket|옥션|Auction|위메프|티몬/i.test(label)) return 2;
  return 3;
};
const norm = (s) => String(s).replace(/[^A-Za-z0-9]/g, '').toUpperCase(); const num = (s) => Number(String(s).replace(/[^\d]/g, ''));
const isPrice = (s) => /^(최저)?[\d,]{4,}원$/.test(s);
const out = {};
for (const p of si) {
  const f = path.join(dir, `dump-${PFX}${p.id}-cat.json`); if (!fs.existsSync(f)) continue;
  const d = JSON.parse(fs.readFileSync(f, 'utf-8')); const L = d.text.split('\n').map((s) => s.trim()).filter(Boolean);
  const start = L.findIndex((s) => s === '네이버페이 가맹점만 보기'); const rows = [];
  for (let k = Math.max(0, start); k < L.length; k++) {
    if (!L[k].endsWith('로 이동하기')) continue;
    const title = L[k].replace(/로 이동하기$/, ''); const mall = L[k + 1]; let price = null, ship = '';
    for (let j = k + 1; j < k + 12 && j < L.length; j++) { if (isPrice(L[j]) && price === null) price = num(L[j]); if (L[j] === '배송비') { ship = L[j + 1] || ''; break; } }
    const near = L.slice(k, k + 10).join(' '); const overseas = /해외직구|해외배송|구매대행|배송대행/.test(near) || /^해외/.test(title);
    const link = (d.links.find((l) => l.t.trim() === L[k].trim() && l.h.includes('adcr')) || {}).h || null;
    const cm = codeMatch(p.model, title); const keyMatch = cm.key; const colorOk = cm.code !== false;
    rows.push({ mall, price, ship, shipFee: parseShip(ship), overseas, title, link, keyMatch, colorOk, codeType: cm.code, codeNote: cm.note, sourceRank: sourceRank(mall, link) });
  }
  const usable = rows.filter(eligibleListing);
  const tot = (r) => Number.isFinite(r.price) && r.price > 0 ? r.price + (r.shipFee ?? 0) : Infinity;
  const preferred = (publicProduct ? [...usable] : usable.filter(r => r.sourceRank === 0 || r.sourceRank === 1)).sort((a, b) => a.sourceRank - b.sourceRank || tot(a) - tot(b));
  const anyMin = [...usable].sort((a, b) => tot(a) - tot(b))[0] || null;
  out[p.id] = { name: p.name, model: p.model, kream: p.kreamMed, rows: rows.length, usable: usable.length, anyMin, offerList: usable, trustedMin: preferred[0] || null, trustedList: preferred.slice(0, 4) };
}
fs.writeFileSync(path.join(dir, OUTF), JSON.stringify(out, null, 1));
for (const [id, v] of Object.entries(out)) {
  const fmt = (r) => r ? `${r.price?.toLocaleString() ?? '미확인'}원+배송 ${r.shipFee ?? '?'} ${r.mall} 색상=${r.colorOk}` : '없음';
  console.log(`\n== ${id} ${v.name.slice(0, 44)} | 크림 ${v.kream?.toLocaleString() ?? '미확인'} | 행 ${v.rows}, 모델일치 ${v.usable}`);
  console.log('   전체 최저(참고):', fmt(v.anyMin)); console.log('   신뢰판매처 최저:', fmt(v.trustedMin));
}
