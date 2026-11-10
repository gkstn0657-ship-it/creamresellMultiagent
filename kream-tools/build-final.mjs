// 수집·검증 결과(수동 정리본)를 계산해 final.json 생성. 순수익 = 크림시세×(1-수수료5%) - 배송비3,000 - 매입가
// 판정 기준: 순수익 ≥ 10,000원 & 수익률 ≥ 8% & 크림 차트가 하락 추세가 아님 & 모델·색상 일치 확인. 정가 대비 40% 이상 낮은 매입가는 '고위험' 표시.
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2]; const FEE = 0.05, SHIP = 3000;
const R = [
  // 후보 후보들 (판매처 확인 완료)
  { n: "Arc'teryx Heliad 15 Backpack Black", c: '가방', id: 83946, model: '28412/6057/9829/10358/10403', k: 153000, kb: '7일 중앙값(313건/19일), 최근40건 159,000', rel: 130000, ch: ['횡보', '횡보', '초기 고점 후 하락→저점권 안정'], buy: 112000, mall: '은경몰 (스마트스토어)', link: 'https://smartstore.naver.com/eunkyungmalls/products/13773474186', biz: '은경몰 (간이 사업자)', rep: '이은경', stock: '옵션 판매중(수량 미확인)', risk: '정가(130,000) 대비 14% 낮음 → 병행수입/가품 가능성. 은경몰은 간이 사업자. 리뷰에 "가품" 언급 있음. 정품 보증·반품 조건 확인 필요.' },
  { n: "Arc'teryx Mantis 26 Backpack Black", c: '가방', id: 84450, model: '29560/6044/9825/10643 (ABQSU10643)', k: 240000, kb: '최근40건 중앙값(236,000~244,000)', rel: 214500, ch: ['완만 하락', '횡보', '횡보 변동'], buy: 145880, mall: '와이몰 (스마트스토어)', link: 'https://smartstore.naver.com/ymallsd/products/13850721109', biz: '와이몰 (간이 사업자)', rep: '정현우', stock: '블랙 품절임박 (9개 남음, 페이지 표기)', risk: '국내 공식판매처 275,500원 대비 47% 낮음 → 병행수입/가품 가능성 높음. 같은 판매처가 다른 상품도 40~43% 할인 판매. 크림 검수 불합격 시 손실.', hi: true },
  // 마진 부족·하락 등으로 제외
  { n: 'Alo Yoga Iconic Shopper Tote Bag Grey Tiedye', c: '가방', id: 385408, model: 'W7066R', k: 80000, kb: '7일 중앙값(252건/29일), 이전 86,000', ch: ['완만 하락', '급등 후 횡보', '큰 변동'], buy: 69900, mall: '네이버 최저(판매처 미확인)', down: true },
  { n: 'Salomon Trailblazer 20 Black', c: '가방', id: 235772, model: 'LC2182600', k: 85000, kb: '7일 중앙값(336건/36일), 이전 101,000(-16%)', ch: ['하락', '하락', '하락(최근 급락)'], buy: 84430, mall: '네이버 최저(판매처 미확인)', down: true },
  { n: "Arc'teryx Heliad 6 Crossbody Bag Black", c: '가방', id: 101705, model: '28414/6169/7973/9828/10359', k: 80000, kb: '7일 중앙값(102건/92일), 이전 98,000(-18%)', rel: 80000, ch: ['미확인', '미확인', '미확인'], buy: 73600, mall: '네이버 카탈로그 최저(31곳)', down: true },
  { n: 'Porter All New Tanker Sling Bag Zip Black', c: '가방', id: 397317, model: '622-15154', k: 426500, kb: '7일 중앙값(42건/242일)', rel: 409600, ch: ['미확인', '미확인', '미확인'], buy: 449700, mall: '네이버 카탈로그 최저(109곳, 모델 일치 미확인)' },
  { n: 'Vivienne Westwood Mini Bas Relief Pendant Silver', c: '주얼리', id: 53211, model: '63020086', k: 183000, kb: '랭킹 표시가(체결 미확인)', ch: ['미확인', '미확인', '미확인'], buy: 176220, mall: '네이버 카탈로그 최저(28곳)' },
  { n: 'Vivienne Westwood Mayfair Bas Relief Pendant Silver', c: '주얼리', id: 53213, model: '63020052/630203EG-W110/02W110', k: 177000, kb: '최근40건 중앙값', ch: ['횡보', '횡보', '초기 변동 후 안정'], buy: 195000, mall: 'POINT SELECT (동일 모델 실버)', note: '137,000원 매물은 핑크골드(다른 색상)라 제외' },
  { n: 'Diesel Dx1247040 Black Leather Stackable Bracelet', c: '주얼리', id: 0, model: 'DX1247040', k: 69000, kb: '랭킹 표시가(체결 미확인)', ch: ['미확인', '미확인', '미확인'], buy: 71200, mall: '네이버 최저(리셀 매물)' },
  { n: 'Vivienne Westwood London Orb Pendant Silver', c: '주얼리', id: 88433, model: '63020278-02P102', k: 167000, kb: '최근40건 중앙값', ch: ['미확인', '미확인', '미확인'], buy: 189000, mall: '네이버 카탈로그 최저(10곳)' },
  { n: 'Vivienne Westwood Reina Pendant Silver', c: '주얼리', id: 88429, model: '63020095-02P102', k: 196000, kb: '최근40건 중앙값(177,000~280,000)', ch: ['횡보(끝에 단발 스파이크)', '횡보', '횡보 변동'], buy: 167600, mall: 'TPMALL (카탈로그 최저)', hold: '마진 얇음(9%), 2위 판매처 180,530원(마진 1.5%). 판매처 상품 페이지 확인 실패(링크가 다른 상품으로 연결)', risk: '가격 변동 큼, 최저가 판매처 1곳뿐' },
  { n: '(W) Vivienne Westwood Westminster Ring 925 Rhodium', c: '주얼리', id: 265665, model: '64040016-W004', k: 199000, kb: '최근40건 중앙값', ch: ['미확인', '미확인', '미확인'], buy: 195200, mall: '리셀S(리셀 매물)' },
  { n: 'Chrome Hearts Spacer Forever Ring 6mm Silver', c: '주얼리', id: 820913, model: '(미표시)', k: 1365000, kb: '최근40건 중앙값(1,001,000~1,590,000, 사이즈별 상이)', ch: ['미확인', '미확인', '미확인'], buy: 1213700, mall: '리셀US 7 (리셀 매물)', hold: '사이즈별 시세가 달라 비교 불가(US 7 기준 시세 미확인). 가품 위험 최상', risk: '고가 주얼리·가품 다수' },
  { n: 'Montbell Light Weight Duffle Bag Black', c: '가방', id: 467468, model: '1133394', k: 69000, kb: '랭킹 표시가(체결 미확인)', ch: ['미확인', '미확인', '미확인'], buy: 75000, mall: '네이버 카탈로그 최저(6곳)' },
  { n: 'Salomon Trailblazer 10 Black', c: '가방', id: 300957, model: 'LC2182900', k: 75000, kb: '랭킹 표시가(체결 미확인)', ch: ['미확인', '미확인', '미확인'], buy: 77620, mall: '네이버 카탈로그 최저(72곳)' },
  { n: 'C.P. Company Nylon B Lens Cross Bag Black', c: '가방', id: 574056, model: '19CMAC735A005269G999/RCCMAC735A005269G999', k: 284000, kb: '최근40건 중앙값(272,000~294,000)', ch: ['완만 하락', '횡보', '상승 후 하락'], buy: 506000, mall: '메종 드 레온 (동일 블랙 모델)', note: '233,460원 매물은 색상코드 888/683(다른 색상)이라 제외' },
  { n: 'COS Trullo Leather Crossbody Bag Black', c: '가방', id: 0, model: '1351272001', k: 278000, kb: '랭킹 표시가(체결 미확인)', ch: ['미확인', '미확인', '미확인'], buy: 286100, mall: '리셀 매물' },
  { n: 'Porter All New Tanker Sling Bag Zip L Black', c: '가방', id: 397316, model: '622-15154', k: 510000, kb: '랭킹 표시가(체결 미확인)', ch: ['미확인', '미확인', '미확인'], buy: 506000, mall: '네이버 최저(국내 단일 판매)' },
  { n: 'Salomon UNI Cross Insulation Jacket Pussy Willow Grey', c: '의류', id: 1059995, model: 'LD0274500', k: 330000, kb: '랭킹 표시가', rel: 320000, ch: ['미확인', '미확인', '미확인'], buy: 320000, mall: '정가(발매가) 구매 가정', note: '프리미엄 +3%' },
  { n: 'Montbell Superior Down Parka Black', c: '의류', id: 210092, model: '1101659', k: 267000, kb: '랭킹 표시가', rel: 259000, ch: ['미확인', '미확인', '미확인'], buy: 259000, mall: '정가(발매가) 구매 가정', note: '프리미엄 +3%' },
  { n: 'IAB Studio Fleece Gray', c: '의류', id: 1016613, model: '(미표시)', k: 120000, kb: '랭킹 표시가', rel: 118000, ch: ['미확인', '미확인', '미확인'], buy: 118000, mall: '정가(발매가) 구매 가정', note: '프리미엄 +2%' },
];
const rows = R.map((r) => {
  const net = Math.round(r.k * (1 - FEE) - SHIP - r.buy), pct = +(net / r.buy * 100).toFixed(1);
  const lowVsRetail = r.rel ? +(1 - r.buy / r.rel).toFixed(2) : null;
  let verdict, reason = '';
  if (r.hold) { verdict = '보류'; reason = r.hold; }
  else if (net < 10000 || pct < 8) { verdict = '제외'; reason = `순수익 ${net.toLocaleString()}원(${pct}%)로 기준 미달` + (r.down ? ' + 크림 시세 하락 추세' : '') + (r.note ? ' / ' + r.note : ''); }
  else { verdict = r.hi ? '후보(고위험)' : '후보(위험 있음)'; reason = `순수익 ${net.toLocaleString()}원(${pct}%), 모델·색상 일치 확인, 크림 차트 추세 양호(횡보)`; }
  return { '상품명': r.n, '카테고리': r.c, '크림ID': r.id || '', '모델번호': r.model, '크림시세(원)': r.k, '시세기준': r.kb, '발매가(원)': r.rel || '', '크림차트 1개월': r.ch[0], '크림차트 3개월': r.ch[1], '크림차트 전체': r.ch[2],
    '매입가(원)': r.buy, '판매처': r.mall, '판매처 링크': r.link || '', '상호명': r.biz || '', '대표자': r.rep || '', '사업자구분': r.biz && r.biz.includes('간이') ? '간이 사업자' : '', '예상순수익(원)': net, '수익률(%)': pct, '판정': verdict, '사유': reason, '리스크': r.risk || '', '재고확인': r.stock || '' };
});
rows.sort((a, b) => (b['판정'].startsWith('후보') - a['판정'].startsWith('후보')) || b['수익률(%)'] - a['수익률(%)']);
const meta = { 분석일: '2026-11-05', 수수료율: FEE, 배송비: SHIP, 후보기준: '순수익 ≥ 10,000원 & 수익률 ≥ 8% & 크림 차트 하락 추세 아님 & 모델·색상 일치',
  크림시세기준: '최근 체결 40건 중앙값(일부 7일 중앙값)', 차트: '크림 상세 차트(1개월/3개월/전체)를 화면에서 직접 확인', 네이버: '자체 확장으로 검색·카탈로그·상품 페이지 텍스트 덤프(분당 1페이지 이하)',
  한계: ['체결 전체 내역 대신 최근 체결 기준 시세를 사용', '매입가 판매처 재고는 상품 페이지 표기 기준(▲ 수량 증가 테스트는 하지 않음)', '정품 여부는 확인하지 못함: 병행수입·가품 위험은 구매 전 직접 확인', '크림 검수 불합격·반품 리스크 미반영'] };
fs.writeFileSync(path.join(dir, 'final.json'), JSON.stringify({ rows, meta }, null, 1));
console.log(rows.map((r) => `${r['판정'].padEnd(8)} ${String(r['수익률(%)']).padStart(6)}% ${String(r['예상순수익(원)']).padStart(9)}  ${r['상품명'].slice(0, 46)}`).join('\n'));
