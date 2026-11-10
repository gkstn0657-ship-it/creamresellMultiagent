// 이번 50개(k50.json + n-cards.json + n-cat.json) + 앞서 본 14개(final-si.json) -> final-all.json (엑셀 입력)
// 순수익 = 크림시세×0.95 - 3,000 - 매입가. 후보: 순수익 ≥ 10,000원 & 수익률 ≥ 8% & 모델·색상 일치 & 신뢰 판매처 & 재고 있음
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2]; const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
const k50 = rd('k50.json'), cards = rd('n-cards.json'), cat = rd('n-cat.json'), prev = rd('final-si.json');
const FEE = 0.05, SHIP = 3000; const collab = /슈프림|뉴발란스|포터|Supreme|New Balance|Porter/i;
const net = (k, b) => Math.round(k * (1 - FEE) - SHIP - b);
// 직접 확인한 후보·제외 (차트: 크림 상세 차트 직접 확인, 재고·판매처: 상품 페이지 덤프)
const OV = {
  338537: { k: 1377000, kb: '24FW 심리스 터널 다운: XL 사이즈 최근 체결 10건 중앙값(전체 사이즈 중앙값 1,329,500)', buy: 1098240, mall: 'SSG.COM (위탁판매자 매장)', link: 'https://www.ssg.com', biz: 'SSG.COM 위탁판매자(상세 미표시)', rep: '미확인', ch: ['단계적 상승', '상승 후 고점 횡보', '변동 큼·최근 고점'], stock: 'XL 1개 사이즈만 노출(수량 미확인)', verdict: '후보(위험 있음)', risk: '위탁판매자라 상호·대표자 미표시. 카탈로그 최저가(1,010,381원)와 상품 페이지 가격(1,098,240원)이 다름. XL 한 사이즈만 구매 가능. 크림 XL 시세 기준으로 계산.' },
  78809: { k: 410000, kb: '최근 체결 29건 중앙값(거래 드묾, 사이즈별 S 373k~XXL 439k)', buy: 344000, mall: '트렌비', link: 'https://www.trenbe.com', biz: '트렌비(상세 미표시)', rep: '미확인', ch: ['평탄(거래 드묾)', '평탄', '변동 후 횡보'], stock: '사이즈 선택 후 확인 필요(미확인)', verdict: '후보(위험 있음)', risk: '크림 거래가 드물어 현금화가 느릴 수 있음. 트렌비 정품보장(가품 시 최대 200% 보상) 표시. 사이즈별 재고 미확인.' },
  175733: { k: 1117000, kb: '최근 체결 40건 중앙값', buy: 676520, mall: '더블유컨셉', link: 'https://www.wconcept.co.kr', biz: '(주)더블유컨셉', rep: '이지은', ch: ['단계적 상승', '상승', '변동 후 최근 급등'], stock: '품절 (재입고 알림만 가능)', verdict: '제외', reason: '판매처 페이지에 "품절"·"재입고 알림" 표시 — 재고 없음(가격상 순수익 +381,630원이었으나 구매 불가)', risk: '' },
};
const rows = [];
for (const p of k50) {
  const id = String(p.id), k = p.kreamMed, o = OV[id]; const c = cards[id], ct = cat[id];
  const base = { '상품명': p.title, '카테고리': '의류', '크림ID': id, '모델번호': p.model || '', '크림시세(원)': k ?? '', '시세기준': p.kreamMin ? `최근 체결 ${p.n}건 중앙값(${p.kreamMin.toLocaleString()}~${p.kreamMax.toLocaleString()}, 사이즈 혼합)` : `최근 체결 ${p.n}건 중앙값`, '발매가(원)': '', '크림차트 1개월': '미확인', '크림차트 3개월': '미확인', '크림차트 전체': '미확인', '매입가(원)': '', '판매처': '', '판매처 링크': '', '상호명': '', '대표자': '', '사업자구분': '', '예상순수익(원)': '', '수익률(%)': '', '판정': '제외', '사유': '', '리스크': '', '재고확인': '' };
  if (o) {
    const n = net(o.k, o.buy), pct = +(n / o.buy * 100).toFixed(1);
    rows.push({ ...base, '크림시세(원)': o.k, '시세기준': o.kb, '크림차트 1개월': o.ch[0], '크림차트 3개월': o.ch[1], '크림차트 전체': o.ch[2], '매입가(원)': o.buy, '판매처': o.mall, '판매처 링크': o.link, '상호명': o.biz, '대표자': o.rep, '예상순수익(원)': n, '수익률(%)': pct, '판정': o.verdict, '사유': o.reason || `순수익 ${n.toLocaleString()}원(${pct}%), 모델·색상 일치, 신뢰 판매처, 크림 차트 상승/횡보`, '리스크': o.risk, '재고확인': o.stock }); continue;
  }
  let reason = '';
  if (collab.test(p.title)) reason = '협업 상품(슈프림·뉴발란스·포터 등): 국내 정가 구매처가 없어 소싱 대상 아님';
  else if (!p.model) reason = '크림 모델번호 없음: 네이버 대조 불가';
  else if (p.n < 10) reason = `크림 체결 ${p.n}건: 유동성 부족`;
  else if (k < 150000) reason = '시세 15만원 미만: 수수료·배송비 대비 마진 작음';
  else if (!c || !c.matched.length) reason = '네이버에 모델번호 일치 상품 없음';
  else if (ct) {
    if (ct.trustedMin) { const b = ct.trustedMin.price, n = net(k, b), pct = +(n / b * 100).toFixed(1); rows.push({ ...base, '매입가(원)': b, '판매처': ct.trustedMin.mall, '판매처 링크': ct.trustedMin.link || '', '예상순수익(원)': n, '수익률(%)': pct, '판정': '제외', '사유': `순수익 ${n.toLocaleString()}원(${pct}%): 기준 미달` }); continue; }
    reason = ct.rows > 0 && ct.usable === 0 ? '카탈로그 매물의 모델·색상 코드가 달라 비교 불가(싼 매물은 다른 색상)' : '모델·색상 일치 매물이 신뢰 판매처에 없음' + (ct.anyMin ? `(참고: 비신뢰 판매처 최저 ${ct.anyMin.price.toLocaleString()}원 ${ct.anyMin.mall}, 순수익 ${net(k, ct.anyMin.price).toLocaleString()}원)` : '');
  } else {
    const cheap = c.matched.filter((x) => x.colorMatch !== false && x.price).sort((a, b) => a.price - b.price)[0];
    if (cheap) { const n = net(k, cheap.price), pct = +(n / cheap.price * 100).toFixed(1); rows.push({ ...base, '매입가(원)': cheap.price, '판매처': '네이버 검색 카드 최저(판매처 미확인)', '예상순수익(원)': n, '수익률(%)': pct, '판정': '제외', '사유': `순수익 ${n.toLocaleString()}원(${pct}%): 마진 기준 미달` }); continue; }
    reason = '모델은 일치하나 색상 일치 매물 없음';
  }
  rows.push({ ...base, '사유': reason });
}
const all = [...rows, ...prev.rows];
all.sort((a, b) => (b['판정'].startsWith('후보') - a['판정'].startsWith('후보')) || ((b['수익률(%)'] || -999) - (a['수익률(%)'] || -999)));
const meta = { 분석일: '2026-11-05', 범위: `크림 스톤아일랜드 검색 333개 중 정가 이상 거래(할인 표시 없음, 키즈 제외) 152개에서 ${all.length}개 분석 (앞선 14개 + 이번 53개 = 크림 수집 50개 + 도구 수집 3개)`, 수수료율: FEE, 배송비: SHIP,
  후보기준: '순수익 ≥ 10,000원 & 수익률 ≥ 8% & 모델·색상 일치 & 신뢰 판매처 & 재고 확인', 신뢰판매처: '롯데ON, 롯데홈쇼핑, 현대Hmall, 신세계몰, 신세계라이브쇼핑, SSG닷컴, 신세계V, 머스트잇, 더블유컨셉, 무신사, 29CM, 트렌비, LFmall, CJ온스타일, GSSHOP, SK스토아, KT알파쇼핑',
  네이버검색: '모델번호 띄어쓰기 형식(예: L1S15 6100060 S0051-V0029, 구형은 8115 코드를 공백으로 구분), 낮은 가격순, "추천 낮은 가격순" 토글 해제. 쇼핑몰선택 필터는 시험에서 결과 변화가 없어 판매처 이름 필터로 대체',
  크림수집: '크림 상품 페이지의 거래 내역 창 최근 체결 약 40건(로그인 상태의 사용자 Chrome, 확장으로 수집)', 차트: '후보로 남은 3개는 크림 상세 차트(1개월·3개월·전체)를 화면에서 직접 확인. 나머지는 후보가 아니어서 미확인',
  한계: ['시세는 최근 체결 약 40건 중앙값(사이즈 혼합). 후보는 사이즈별로 재계산', '재고는 판매처 페이지 표기 기준이며 수량·사이즈별 재고는 확인하지 못함', '정품 여부는 확인하지 못함(트렌비·SSG·W컨셉은 자체 정품 보증 정책 표시)', '후보 중 상호·대표자는 판매처 페이지에 접힌 정보라 읽지 못한 항목이 있음', '크림 검수 불합격·반품 위험 미반영', '네이버 접속은 사용자 계정 로그인 상태에서 이뤄짐'] };
fs.writeFileSync(path.join(dir, 'final-all.json'), JSON.stringify({ rows: all, meta }, null, 1));
const cnt = (f) => all.filter(f).length;
console.log(`총 ${all.length}개 | 후보 ${cnt((r) => r['판정'].startsWith('후보'))} | 제외 ${cnt((r) => r['판정'] === '제외')}`);
const why = {}; for (const r of all) if (r['판정'] === '제외') { const key = r['사유'].replace(/\d[\d,]*/g, '#').slice(0, 26); why[key] = (why[key] || 0) + 1; }
console.log('제외 사유 분포:', JSON.stringify(why, null, 0));
console.log(all.filter((r) => r['판정'].startsWith('후보')).map((r) => `${r['판정']} ${r['상품명'].slice(0, 36)} | ${r['판매처']} ${r['매입가(원)']} | 순수익 ${r['예상순수익(원)']} (${r['수익률(%)']}%)`).join('\n'));
