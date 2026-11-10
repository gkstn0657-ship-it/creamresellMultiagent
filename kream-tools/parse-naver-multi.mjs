// N<id>-s 네이버 검색 덤프를 파싱해 크림 상품명과 느슨하게 매칭되는 최저가 카드를 찾고 마진을 계산한다.
// 모델번호 코드가 없는 브랜드가 대부분이라 제목 토큰 겹침으로 매칭한다 (스톤아일랜드류 정확매칭 대신).
// 사용: node parse-naver-multi.mjs <run-dir>
import fs from 'node:fs'; import path from 'node:path';
import { modelFromDump, compareModel } from './model-evidence.mjs';
const dir = process.argv[2];
const elig = JSON.parse(fs.readFileSync(path.join(dir, 'n-eligible.json'), 'utf-8'));
const num = (s) => Number(String(s).replace(/[^\d]/g, ''));
const isPrice = (s) => /^[\d,]{4,}원$/.test(s);
const TRUSTED = /롯데\s*ON|SSG|신세계|현대|머스트잇|W\s*컨셉|트렌비|LF\s*mall|LFmall/i;
const STOP = new Set(['블랙','화이트','그레이','네이비','베이지','브라운','블루','레드','그린','옐로우','핑크','실버','골드','24FW','25FW','26FW','24SS','25SS','26SS','(W)','-','x']);

function tokens(name) {
  return name.replace(/\(W\)/g, '').split(/\s+/).map(s => s.trim()).filter(s => s.length >= 2 && !STOP.has(s));
}

const out = [];
for (const o of elig) {
  const f = path.join(dir, `dump-N${o.id}-s.json`);
  if (!fs.existsSync(f)) { out.push({ ...o, status: 'no-dump' }); continue; }
  const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
  let kreamModel = o.model || ''; try { kreamModel ||= modelFromDump(JSON.parse(fs.readFileSync(path.join(dir, `dump-K${o.id}.json`), 'utf8'))); } catch {}
  const kTokens = tokens(o.name);
  const chunks = (d.text || '').split(/\n\t\n/);
  const cards = [];
  for (let i = 0; i < chunks.length; i++) {
    const prev = chunks[i].split('\n').map(s => s.trim()).filter(Boolean);
    if (!/^찜하기\d+$/.test(prev[prev.length - 1] || '')) continue;
    const body = chunks[i + 1]; if (!body) continue;
    const lines = body.split('\n').map(s => s.trim()).filter(Boolean);
    const title = lines[0]; if (!title) continue;
    if (!lines.some(l => l === '배송비' || l === '최저')) continue;
    let price = null; const li = lines.indexOf('최저');
    if (li >= 0 && isPrice(lines[li + 1] || '')) price = num(lines[li + 1]);
    else { const ps = []; for (let k = 1; k < Math.min(lines.length, 14); k++) { if (isPrice(lines[k])) ps.push(num(lines[k])); } price = ps.length ? Math.min(...ps) : null; }
    if (!price) continue;
    const overseas = /^해외|해외직구|구매대행|배송대행/.test(title);
    const bad = /중고|구제|리셀|KREAM|크림|키즈|여아|남아|유아|아동|짝퉁|레플리카(?!.*스니커즈)|이월|리퍼|스타일추천|땡처리|대여|렌탈|대관|호환|수선|수거|보강|굽갈이|밑창|클리닝|세탁|관리권|기프티콘|쿠폰/i.test(title);
    const matchCount = kTokens.filter(t => title.includes(t)).length;
    const matchRatio = kTokens.length ? matchCount / kTokens.length : 0;
    const mallChunk = chunks[i + 2] || '';
    const ml = mallChunk.split('\n').map(s => s.trim()).filter(Boolean);
    // 카탈로그형 카드: 판매처명 다음에 (가끔 "네이버플러스멤버십"을 건너뛰고) 가격 숫자가 나온다. 헤더("쇼핑몰별 최저가")가 없는 경우도 있다.
    const SKIP = new Set(['브랜드 카탈로그', '네이버플러스멤버십', '네이버페이', '쇼핑몰별 최저가']);
    const topMalls = [];
    let lastLabel = null;
    for (const line of ml) {
      if (/^찜하기\d*$/.test(line)) continue;
      if (SKIP.has(line)) continue;
      if (/^[\d,]{3,}$/.test(line)) { if (lastLabel) { topMalls.push({ mall: lastLabel, price: num(line) }); lastLabel = null; } continue; }
      lastLabel = line;
    }
    const singleMall = (/정보$/.test(ml[0] || '')) ? ml[0].replace(/정보$/, '') : null;
    if (!topMalls.length && singleMall) topMalls.push({ mall: singleMall, price });
    const trustedMall = topMalls.find(m => TRUSTED.test(m.mall));
    const mallName = trustedMall ? trustedMall.mall : (topMalls[0] ? topMalls[0].mall : null);
    const mallBad = mallName ? /KREAM|크림/i.test(mallName) : false;
    const trusted = !!trustedMall;
    const trustedPrice = trustedMall ? trustedMall.price : null;
    const link = ((d.links || []).find(l => l.h && l.h.includes('cr.shopping.naver.com/adcr') && l.t && l.t.trim() === title) || {}).h || null;
    const modelCheck = compareModel(kreamModel, title, o.keyword);
    cards.push({ title, price, overseas, bad, mallBad, matchRatio, mallName, trusted, trustedPrice, topMalls, link, modelCheck });
  }
  const minPrice = Math.max(10000, o.kreamMed * 0.15);
  const good = cards.filter(c => !c.overseas && !c.bad && !c.mallBad && c.modelCheck.status !== 'mismatch' && c.matchRatio >= 0.8 && c.price >= minPrice).sort((a, b) => a.price - b.price);
  const bestAny = good[0] || null;
  const trustedCards = cards.filter(c => !c.overseas && !c.bad && !c.mallBad && c.modelCheck.status === 'matched' && c.matchRatio >= 0.8 && c.trusted && c.trustedPrice >= minPrice).sort((a, b) => a.trustedPrice - b.trustedPrice);
  const bestTrustedRaw = trustedCards[0] || null;
  const bestTrusted = bestTrustedRaw ? { ...bestTrustedRaw, price: bestTrustedRaw.trustedPrice } : null;
  const best = bestTrusted || bestAny;
  const net = best ? Math.round(o.kreamMed * 0.95) - 3000 - best.price : null;
  const netPct = best && best.price ? Math.round((net / best.price) * 1000) / 10 : null;
  out.push({ ...o, status: 'ok', cardsTotal: cards.length, cardsMatched: good.length, bestAny, bestTrusted, best, net, netPct });
}
fs.writeFileSync(path.join(dir, 'n-multi.json'), JSON.stringify(out, null, 1));
const margin = out.filter(o => o.best && o.net >= 10000 && o.netPct >= 8);
const trusted = margin.filter(o => o.best.trusted);
const refOnly = margin.filter(o => !o.best.trusted);
console.log(`네이버 파싱 완료 ${out.filter(o=>o.status==='ok').length}/${elig.length} | 마진조건 충족 ${margin.length}개 (신뢰판매처 ${trusted.length} / 참고용-비신뢰판매처 ${refOnly.length})`);
console.log('\n[신뢰 판매처 매칭 — 실제 후보]');
for (const o of trusted.sort((a,b)=>b.net-a.net)) {
  console.log(`[${o.keyword}] ${o.name} | 크림시세 ${o.kreamMed.toLocaleString()} | 최저가 ${o.best.price.toLocaleString()}(${o.best.mallName||'?'}) | 순이익 ${o.net.toLocaleString()}원 (${o.netPct}%) | ${o.best.title.slice(0,40)}`);
}
console.log('\n[비신뢰 판매처 매칭 — 참고용, 구매 전 직접 확인 필요]');
for (const o of refOnly.sort((a,b)=>b.net-a.net)) {
  console.log(`[${o.keyword}] ${o.name} | 크림시세 ${o.kreamMed.toLocaleString()} | 최저가 ${o.best.price.toLocaleString()}(${o.best.mallName||'?'}) | 순이익 ${o.net.toLocaleString()}원 (${o.netPct}%) | ${o.best.title.slice(0,40)}`);
}
