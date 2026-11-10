// 스톤아일랜드 14개: si-kream.json(크림) + si-cards.json(검색 카드) + si-cat.json(카탈로그 신뢰 판매처) -> final-si.json
// 순수익 = 크림시세×0.95 - 3,000 - 매입가. 후보: 순수익 ≥ 10,000원 & 수익률 ≥ 8% & 모델·색상 일치 & 신뢰 판매처
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2]; const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
const si = rd('si-kream.json'), cards = rd('si-cards.json'), cat = fs.existsSync(path.join(dir, 'si-cat.json')) ? rd('si-cat.json') : {};
const FEE = 0.05, SHIP = 3000; const rows = [];
for (const p of si) {
  const c = cards[p.id] || { matched: [], cards: 0 }, k = cat[p.id];
  const net = (b) => Math.round(p.kreamMed * (1 - FEE) - SHIP - b);
  let buy = null, mall = '', link = '', note = '', basis = '', verdict = '제외', reason = '', ref = '';
  if (k && k.trustedMin) { buy = k.trustedMin.price; mall = k.trustedMin.mall; link = k.trustedMin.link || ''; basis = '카탈로그 신뢰 판매처 최저(모델·색상 일치)'; if (k.anyMin && k.anyMin.price < buy) ref = `참고: 비신뢰 판매처 최저 ${k.anyMin.price.toLocaleString()}원(${k.anyMin.mall}) 순수익 ${net(k.anyMin.price).toLocaleString()}원`; }
  else if (k && k.rows > 0 && k.usable === 0) { reason = '카탈로그 매물의 색상 코드가 크림 상품과 달라 비교 불가(싼 매물은 다른 색상)'; }
  else if (k && k.usable > 0 && !k.trustedMin) { reason = '모델·색상 일치 매물이 신뢰 판매처에 없음'; if (k.anyMin) ref = `참고: 비신뢰 판매처 최저 ${k.anyMin.price.toLocaleString()}원(${k.anyMin.mall}) 순수익 ${net(k.anyMin.price).toLocaleString()}원`; }
  else {
    const singles = c.matched.filter((x) => !x.isCatalog && x.colorMatch === true && x.price).sort((a, b) => a.price - b.price);
    if (singles[0]) { buy = singles[0].price; mall = '네이버 단일 상품(판매처 미확인)'; link = singles[0].link || ''; basis = '검색 카드 최저(모델·색상 일치, 신뢰 판매처 여부 미확인)'; }
    else if (c.matched.length === 0) reason = c.cards ? '네이버에 모델번호 일치 상품 없음' : '검색 결과 없음';
    else reason = '모델은 일치하나 색상 일치 상품 없음';
  }
  if (buy !== null) { const n = net(buy), pct = +(n / buy * 100).toFixed(1); if (n < 10000 || pct < 8) { verdict = '제외'; reason = `순수익 ${n.toLocaleString()}원(${pct}%)로 기준 미달`; } else { verdict = '후보'; reason = `순수익 ${n.toLocaleString()}원(${pct}%)`; } }
  rows.push({ '상품명': p.name, '카테고리': '의류', '크림ID': p.id, '모델번호': p.model, '크림시세(원)': p.kreamMed, '시세기준': `최근 체결 40건 중앙값(${p.kreamMin.toLocaleString()}~${p.kreamMax.toLocaleString()}, 사이즈 혼합)`, '발매가(원)': '', '크림차트 1개월': '미확인', '크림차트 3개월': '미확인', '크림차트 전체': '미확인',
    '매입가(원)': buy ?? '', '판매처': mall, '판매처 링크': link, '상호명': '', '대표자': '', '사업자구분': '', '예상순수익(원)': buy !== null ? net(buy) : '', '수익률(%)': buy !== null ? +(net(buy) / buy * 100).toFixed(1) : '', '판정': verdict, '사유': reason, '리스크': [basis, ref].filter(Boolean).join(' / '), '재고확인': '' });
}
rows.sort((a, b) => (b['판정'] === '후보') - (a['판정'] === '후보') || (b['수익률(%)'] || -999) - (a['수익률(%)'] || -999));
const meta = { 분석일: '2026-11-05', 범위: '크림 스톤아일랜드 검색 결과 중 정가 이상 거래(할인 표시 없음) 106개 중 현행 시즌(26SS/26FW) 모델코드 상품 14개', 수수료율: FEE, 배송비: SHIP,
  네이버검색: '모델번호 띄어쓰기 형식(예: L1S15 6100060 S0051-V0029), 낮은 가격순, "추천 낮은 가격순" 토글 해제', 신뢰판매처: '롯데ON, 롯데홈쇼핑, 현대Hmall, 신세계몰, 신세계라이브쇼핑, SSG닷컴, 신세계V, 머스트잇, 더블유컨셉, 무신사, 29CM, 트렌비, LFmall, CJ온스타일, GSSHOP, SK스토아, KT알파쇼핑 등(카탈로그 판매처 목록을 이름으로 필터)',
  쇼핑몰선택필터: '화면의 쇼핑몰선택 필터는 적용 시험에서 검색 결과에 변화가 없고 다음 검색에 유지되지 않아, 판매처 이름 필터로 대체', 매칭기준: '크림 모델번호의 시즌+상품+스타일 코드와 색상 코드(V....)를 네이버 제목과 대조. 색상 코드가 다르면 제외',
  한계: ['크림 차트는 이번 14개에서 확인하지 않음(후보가 없어 생략)', '시세는 사이즈 혼합 최근 40건 중앙값(사이즈별 시세 상이)', '신뢰 판매처 목록은 임의 기준', '재고·사업자 정보는 후보가 없어 확인하지 않음'] };
fs.writeFileSync(path.join(dir, 'final-si.json'), JSON.stringify({ rows, meta }, null, 1));
console.log(rows.map((r) => `${r['판정'].padEnd(3)} ${String(r['수익률(%)']).padStart(6)} ${String(r['예상순수익(원)']).padStart(9)}  ${r['모델번호'].slice(0, 26).padEnd(26)} ${r['사유'].slice(0, 58)}`).join('\n'));
