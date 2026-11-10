// 카탈로그 덤프(dump-SI<id>-cat.json) -> 판매처 행 중 '신뢰 판매처'만 남겨 모델·색상 대조 후 최저가 계산 (si-cat.json)
// 사용: node parse-si-cat.mjs <run-dir>
import fs from 'node:fs'; import path from 'node:path';
// 인수: <run-dir> [접두사=SI] [상품파일=si-kream.json] [출력=si-cat.json]  (이번 50개: N k50.json n-cat.json)
const dir = process.argv[2]; const PFX = process.argv[3] || 'SI', DATA = process.argv[4] || 'si-kream.json', OUTF = process.argv[5] || 'si-cat.json';
const si = JSON.parse(fs.readFileSync(path.join(dir, DATA), 'utf-8')).map((p) => ({ ...p, name: p.name || p.title }));
const TRUSTED = ['롯데ON', '롯데백화점', '롯데홈쇼핑', '현대Hmall', '현대백화점', '더현대', '신세계몰', '신세계라이브쇼핑', 'SSG닷컴', 'SSG.COM', '신세계V', '신세계백화점', '갤러리아', 'AK몰', '머스트잇', '더블유컨셉', 'W컨셉', '무신사', '29CM', '트렌비', 'LFmall', 'CJ온스타일', 'GSSHOP', 'GS SHOP', 'SK스토아', 'KT알파쇼핑', '스타필드', '에스아이빌리지', 'SI VILLAGE'];
const isTrusted = (m) => TRUSTED.some((t) => String(m).replace(/\s/g, '').toLowerCase().includes(t.replace(/\s/g, '').toLowerCase()));
const norm = (s) => String(s).replace(/[^A-Za-z0-9]/g, '').toUpperCase(); const num = (s) => Number(String(s).replace(/[^\d]/g, ''));
const isPrice = (s) => /^(최저)?[\d,]{4,}원$/.test(s);
const out = {};
for (const p of si) {
  const f = path.join(dir, `dump-${PFX}${p.id}-cat.json`); if (!fs.existsSync(f)) continue;
  const d = JSON.parse(fs.readFileSync(f, 'utf-8')); const L = d.text.split('\n').map((s) => s.trim()).filter(Boolean);
  const nm = norm(p.model); const color = nm.slice(nm.lastIndexOf('V')); const key = nm.slice(0, nm.lastIndexOf('V'));
  const start = L.findIndex((s) => s === '네이버페이 가맹점만 보기'); const rows = [];
  for (let k = Math.max(0, start); k < L.length; k++) {
    if (!L[k].endsWith('로 이동하기')) continue;
    const title = L[k].replace(/로 이동하기$/, ''); const mall = L[k + 1]; let price = null, ship = '';
    for (let j = k + 1; j < k + 12 && j < L.length; j++) { if (isPrice(L[j]) && price === null) price = num(L[j]); if (L[j] === '배송비') { ship = L[j + 1] || ''; break; } }
    const near = L.slice(k, k + 10).join(' '); const overseas = /해외직구|해외배송|구매대행|배송대행/.test(near) || /^해외/.test(title);
    const link = (d.links.find((l) => l.t.trim() === L[k].trim() && l.h.includes('adcr')) || {}).h || null;
    const t = norm(title); const keyMatch = t.includes(key); const colorOk = t.includes(color) ? true : (/V0[A-Z0-9]{3}|V\d{4}/.test(t) ? false : null);
    rows.push({ mall, price, ship, overseas, title, link, keyMatch, colorOk, trusted: isTrusted(mall) });
  }
  const usable = rows.filter((r) => r.keyMatch && !r.overseas && r.colorOk !== false);
  const trusted = usable.filter((r) => r.trusted).sort((a, b) => a.price - b.price);
  const anyMin = [...usable].sort((a, b) => a.price - b.price)[0] || null;
  out[p.id] = { name: p.name, model: p.model, kream: p.kreamMed, rows: rows.length, usable: usable.length, anyMin, trustedMin: trusted[0] || null, trustedList: trusted.slice(0, 4) };
}
fs.writeFileSync(path.join(dir, OUTF), JSON.stringify(out, null, 1));
for (const [id, v] of Object.entries(out)) {
  const net = (b) => Math.round(v.kream * 0.95 - 3000 - b); const fmt = (r) => r ? `${r.price.toLocaleString()}원 ${r.mall} (순수익 ${net(r.price).toLocaleString()}, ${(net(r.price) / r.price * 100).toFixed(1)}%) 색상=${r.colorOk}` : '없음';
  console.log(`\n== ${id} ${v.name.slice(0, 44)} | 크림 ${v.kream.toLocaleString()} | 행 ${v.rows}, 모델일치 ${v.usable}`);
  console.log('   전체 최저(참고):', fmt(v.anyMin)); console.log('   신뢰판매처 최저:', fmt(v.trustedMin));
}
