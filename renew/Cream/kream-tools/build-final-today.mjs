// 오늘 실행(k50.json + n-cards.json + n-cat.json + 직접 확인한 후보) -> final-all.json (엑셀 입력). 어제 결과(final-si.json)는 섞지 않는다.
// 순수익 = 크림시세×0.95 - 3,000 - 매입가. 후보: 순수익 ≥ 10,000원 & 수익률 ≥ 8% & 모델·색상 일치 & 신뢰 판매처 & 재고 있음
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2]; const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
const k50 = rd('k50.json'), cards = rd('n-cards.json'), cat = rd('n-cat.json');
const FEE = 0.05, SHIP = 3000; const collab = /슈프림|뉴발란스|포터|디올|Supreme|New Balance|Porter|Dior/i;
const net = (k, b) => Math.round(k * (1 - FEE) - SHIP - b);
const won = (n) => Number(n).toLocaleString('ko-KR');
// 크림 체결 덤프에서 사이즈별 체결가, 최근 추세(최신 1/3 vs 오래된 1/3 평균)
function kreamRows(id) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, `dump-K${id}.json`), 'utf-8')); const L = d.text.split('\n').map((s) => s.trim()).filter(Boolean);
  const st = L.lastIndexOf('거래일'); const out = [];
  for (let i = st + 1; i < L.length; i++) { const s = L[i]; if (s.endsWith('원') && /^[\d,]+$/.test(s.slice(0, -1)) && L[i - 1].length < 8 && L[i - 1] !== '즉시 판매가' && L[i - 1] !== '즉시 구매가') out.push({ size: L[i - 1], price: Number(s.slice(0, -1).replace(/,/g, '')) }); }
  return out;
}
const med = (a) => { const s = [...a].sort((x, y) => x - y), k = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[k] : Math.round((s[k - 1] + s[k]) / 2)) : null; };
const bySize = (id) => { const m = {}; for (const r of kreamRows(id)) (m[r.size] ??= []).push(r.price); return m; };
const trend = (id) => { const r = kreamRows(id).map((x) => x.price); const n = Math.floor(r.length / 3); if (n < 4) return '데이터 부족'; const a = r.slice(0, n).reduce((x, y) => x + y, 0) / n, b = r.slice(-n).reduce((x, y) => x + y, 0) / n; const ch = (a / b - 1) * 100; return `${ch > 3 ? '상승' : ch < -3 ? '하락' : '횡보'}(최근 ${n}건 평균 vs 오래된 ${n}건 평균 ${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%, 체결 데이터 기준)`; };

// ── 위험 분류: 7개 항목 점수(0 낮음/1 보통/2 높음) 합산 → 0~3점 낮음, 4~7점 중간, 8점 이상 높음 ──
const RISK_RULE = '항목별 0(양호)·1(주의)·2(위험)점을 합산: 0~3점=낮음, 4~7점=중간, 8점 이상=높음. 항목: 판매처 유형 / 가격 확정성 / 재고 / 크림 시세 표본 / 크림 추세 / 상품 일치 / 마진 여유';
const risk = (f) => { const total = f.reduce((s, x) => s + x.pts, 0); const grade = total >= 8 ? '높음' : total >= 4 ? '중간' : '낮음';
  const icon = (p) => (p === 0 ? '🟢' : p === 1 ? '🟡' : '🔴');
  return { grade, total, text: f.map((x) => `${icon(x.pts)} ${x.name}: ${x.note} (${x.pts}점)`).join('\n') + `\n▶ 합계 ${total}점 → 위험 ${grade}` }; };
const trendPts = (t) => (t.startsWith('하락') ? 2 : t.startsWith('횡보') ? 1 : t.startsWith('상승') ? 0 : 1);
const sample = (n) => ({ pts: n >= 10 ? 0 : n >= 5 ? 1 : 2, note: `해당 사이즈 체결 ${n}건` + (n >= 10 ? ' (충분)' : n >= 5 ? ' (적음)' : ' (매우 적음)') });
const marginPts = (pct) => (pct >= 15 ? 0 : pct >= 10 ? 1 : 2);
const rows = [];
const mk = (p, extra) => ({ '상품명': p.title, '카테고리': '의류', '크림ID': String(p.id), '모델번호': p.model || '', '크림시세(원)': p.kreamMed ?? '', '시세기준': p.kreamMin ? `최근 체결 ${p.n}건 중앙값(${won(p.kreamMin)}~${won(p.kreamMax)}, 사이즈 혼합)` : `최근 체결 ${p.n}건 중앙값`, '발매가(원)': '', '크림차트 1개월': '미확인', '크림차트 3개월': '미확인', '크림차트 전체': '미확인', '매입가(원)': '', '판매처': '', '판매처 링크': '', '상호명': '', '대표자': '', '사업자구분': '', '예상순수익(원)': '', '수익률(%)': '', '판정': '제외', '사유': '', '리스크': '', '재고확인': '', ...extra });
const P = Object.fromEntries(k50.map((p) => [String(p.id), p]));

// ── 직접 확인한 후보·제외 (재고·판매자: 판매처 상품 페이지 덤프 / 사이트 표기, 차트: 크림 상세 차트 화면 확인) ──
const done = new Set();
{ // 521751 말파일 플리스 — 트렌비 마켓플레이스 판매자 RHIA(신품 487,000원), 사이즈별 시세로 재계산
  const id = '521751', p = P[id], bs = bySize(id), tr = trend(id), buy = 487000;
  for (const size of ['XL', 'M', 'L', 'XXL']) {
    const k = med(bs[size] || []), n = net(k, buy), pct = +(n / buy * 100).toFixed(1), ok = n >= 10000 && pct >= 8;
    const sm = sample(bs[size].length);
    const rk = ok ? risk([
      { name: '판매처 유형', pts: 1, note: '트렌비 입점 개인 판매자(RHIA). 트렌비는 통신판매중개자, 정품 감정·가품 시 최대 200% 보상 표기' },
      { name: '가격 확정성', pts: 0, note: '노출가 487,000원 그대로(쿠폰·회원 조건 없음)' },
      { name: '재고', pts: 1, note: `${size} 옵션 선택 가능·품절 표시 없음, 수량 표시 없음(개별 1점 추정)` },
      { name: '크림 시세 표본', pts: sm.pts, note: sm.note },
      { name: '크림 추세', pts: Math.max(1, trendPts(tr)), note: `${tr}. 단 구간에 급등이 포함됐고 3개월 차트는 급등 후 고점 횡보, 크림 헤더 최근 -18.3% 표시 → 고점 부근 매수 위험` },
      { name: '상품 일치', pts: 1, note: '모델코드(6100021)·색상(블랙) 일치, 크림은 25SS이나 판매 페이지에 시즌 미표시' },
      { name: '마진 여유', pts: marginPts(pct), note: `수익률 ${pct}%` + (pct >= 15 ? ' (여유)' : pct >= 10 ? ' (보통)' : ' (얇음: 시세 소폭 하락에도 소멸)') },
    ]) : null;
    rows.push(mk(p, { ...(rk ? { '위험등급': rk.grade, '위험근거': rk.text } : {}), '상품명': `${p.title} [${size}]`, '크림시세(원)': k, '시세기준': `${size} 사이즈 최근 체결 ${bs[size].length}건 중앙값(전체 사이즈 ${p.n}건)`, '크림차트 1개월': tr, '크림차트 3개월': '급등 후 고점 횡보(화면 확인)', '크림차트 전체': '완만 상승 후 변동 횡보(화면 확인)',
      '매입가(원)': buy, '판매처': '트렌비 (마켓플레이스 개별 판매자 RHIA)', '판매처 링크': 'https://www.trenbe.com/good/3431+161409533', '상호명': 'RHIA (트렌비 입점)', '대표자': '황선우', '사업자구분': '개인 마켓플레이스 판매자(사업자번호 770-13-00695, 통신판매 2021-서울송파-3819, 송파구 위례광장로 290)',
      '예상순수익(원)': n, '수익률(%)': pct, '판정': ok ? '후보(위험 있음)' : '제외', '사유': ok ? '' : `순수익 ${won(n)}원(${pct}%): 마진 기준 미달`,
      '리스크': ok ? '개별 판매자 입점 상품(트렌비는 통신판매중개자, 가품 시 최대 200% 보상 표기). 크림 상품은 25SS이며 판매 페이지에 시즌 미표시. 크림 헤더 최근 -18% 표시(사이즈 교차 착시 가능). 구매 전 판매자 정품 증빙 확인 필요.' : '',
      '재고확인': size === 'XXL' ? 'XXL 옵션 선택 가능(수량 표시 없음)' : `${size} 옵션 선택 가능·품절 표시 없음(수량 조절 UI 없음, 마켓플레이스 개별 1점 추정)` }));
  }
  done.add(id);
}
{ // 421644 크링클랩스 윈드레지스턴트 자켓 — LFmall 입점사([명품]) XXL 1개 남음
  const id = '421644', p = P[id], bs = bySize(id), k = med(bs['XXL']), buy = 565510, n = net(k, buy), pct = +(n / buy * 100).toFixed(1);
  const tr2 = trend(id), sm2 = sample(bs['XXL'].length);
  const rk2 = risk([
    { name: '판매처 유형', pts: 2, note: 'LFmall 입점사 판매·[명품] 표기(구매대행/병행 가능), 실제 판매자명 미표시' },
    { name: '가격 확정성', pts: 2, note: '565,510원은 "첫 구매 최대 예상 혜택가"(정가 999,000원, 회원가입·쿠폰 조건부)' },
    { name: '재고', pts: 2, note: 'XXL 1개 남음(사이트 표기), 3XL 일시품절, 다른 사이즈 없음' },
    { name: '크림 시세 표본', pts: sm2.pts, note: sm2.note },
    { name: '크림 추세', pts: trendPts(tr2), note: tr2 },
    { name: '상품 일치', pts: 0, note: '모델코드(K1S15 4100037 S0A23)·색상(V0065) 일치' },
    { name: '마진 여유', pts: marginPts(pct), note: `수익률 ${pct}%` + (pct >= 15 ? ' (여유, 단 혜택가 조건 미충족 시 소멸)' : '') },
  ]);
  rows.push(mk(p, { '위험등급': rk2.grade, '위험근거': rk2.text, '상품명': `${p.title} [XXL]`, '크림시세(원)': k, '시세기준': `XXL 사이즈 최근 체결 ${bs['XXL'].length}건 중앙값(표본 적음, 전체 ${p.n}건)`, '크림차트 1개월': trend(id), '크림차트 3개월': '미확인(차트 캡처 지연)', '크림차트 전체': '미확인',
    '매입가(원)': buy, '판매처': 'LFmall ([명품] 입점사 판매, 로젠택배)', '판매처 링크': 'https://www.lfmall.co.kr/app/product/E4U5XX03446', '상호명': '(주)LF (LFmall 플랫폼) / 입점사명 상세 미표시', '대표자': '김상균(LF 대표이사)', '사업자구분': 'LFmall 플랫폼 사업자 211-87-87724(통신판매 2010-서울강남-00066) — 실제 판매자는 입점사',
    '예상순수익(원)': n, '수익률(%)': pct, '판정': '후보(고위험)', '리스크': '565,510원은 "첫 구매 최대 예상 혜택가"(정가 999,000원 → 쿠폰·회원가입 혜택 조건부)이며 쿠폰 미적용 시 마진 소멸 가능. 입점사 판매 [명품] 표기(구매대행/병행 가능). XXL 한 사이즈 1개만 남음, 크림 XXL 체결 5건뿐이라 시세 신뢰도 낮음.',
    '재고확인': 'XXL 1개 남음(사이트 표기, 수량 조절 UI 없음) · 3XL 일시품절 · 다른 사이즈 옵션 없음' })); done.add(id);
}
rows.push(mk(P['428886'], { '매입가(원)': 544080, '판매처': 'SSG닷컴 (위탁판매자 주식회사 구하다)', '판매처 링크': 'https://www.ssg.com/item/itemView.ssg?itemId=1000804657232&siteNo=6001&salestrNo=6005', '상호명': '주식회사 구하다(SSG 위탁판매)', '대표자': '미표시(SSG 대표 최택원은 플랫폼)', '사업자구분': '사업자 876-86-01259, 통신판매 2021-서울강남-04204', '크림시세(원)': 612000, '시세기준': 'XXL 사이즈 최근 체결 13건 중앙값', '예상순수익(원)': net(612000, 544080), '수익률(%)': +(net(612000, 544080) / 544080 * 100).toFixed(1),
  '사유': '재고·마진 불충분: 구매 가능 옵션이 XXL·3XL 각 1개뿐(XL 매진, M/L 옵션 없음). XXL 마진 6.3%(쿠폰 적용가 544,080원 기준, 쿠폰 미적용 594,080원이면 적자)', '재고확인': 'XXL 남은수량 1개 · 3XL 남은수량 1개 · XL 매진' })); done.add('428886');
rows.push(mk(P['232475'], { '매입가(원)': 336590, '판매처': 'W컨셉(㈜더블유컨셉코리아)', '판매처 링크': 'https://www.wconcept.co.kr/Product/305821343', '상호명': '㈜더블유컨셉코리아', '대표자': '이지은', '사업자구분': '사업자 211-88-19183, 통신판매 2025-서울영등포-0492', '예상순수익(원)': net(P['232475'].kreamMed, 336590), '수익률(%)': +(net(P['232475'].kreamMed, 336590) / 336590 * 100).toFixed(1), '사유': '품절: 상품 페이지 전 옵션 품절(재입고 알림만 가능)', '재고확인': '품절' })); done.add('232475');
rows.push(mk(P['323251'], { '매입가(원)': 1464000, '판매처': '텐바이텐 입점몰(veroshop)', '판매처 링크': 'https://www.10x10.co.kr/recommend-product/index.asp?itemId=6928347', '상호명': '(주)백패커 플랫폼 / 입점몰 veroshop 상세 미확인', '대표자': '김동환(백패커 대표이사)', '사업자구분': '플랫폼 사업자 107-87-83297', '사유': '확인 불가(참고): 광고 링크가 추천 페이지로 연결돼 상품·재고·판매자 미확인. 사이즈별 편차 큼(L 14%, XL 10%, M 0.4%)', '리스크': '입점몰 개별 판매자 매물이라 정품·재고 검증 불가', '재고확인': '미확인' })); done.add('323251');

// ── 나머지 상품: 자동 판정 ──
for (const p of k50) {
  const id = String(p.id); if (done.has(id)) continue; const k = p.kreamMed, c = cards[id], ct = cat[id];
  let reason = '';
  if (collab.test(p.title)) reason = '협업 상품(슈프림·디올 등): 국내 정가 구매처가 없어 소싱 대상 아님';
  else if (!p.model) reason = '크림 모델번호 없음: 네이버 대조 불가';
  else if (p.n < 10) reason = `크림 체결 ${p.n}건: 유동성·시세 신뢰 부족`;
  else if (k < 150000) reason = '시세 15만원 미만: 수수료·배송비 대비 마진 작음';
  else if (!c || !c.matched.length) reason = '네이버에 모델번호 일치 상품 없음';
  else if (ct && ct.trustedMin) { const b = ct.trustedMin.price, n = net(k, b), pct = +(n / b * 100).toFixed(1);
    rows.push(mk(p, { '매입가(원)': b, '판매처': ct.trustedMin.mall, '판매처 링크': ct.trustedMin.link || '', '예상순수익(원)': n, '수익률(%)': pct, '사유': `신뢰 판매처 최저가 기준 순수익 ${won(n)}원(${pct}%): 마진 기준 미달` })); continue; }
  else if (ct) reason = ct.rows > 0 && ct.usable === 0 ? '카탈로그 매물의 모델·색상 코드가 달라 비교 불가(싼 매물은 다른 색상)' : '모델·색상 일치 매물이 신뢰 판매처에 없음' + (ct.anyMin ? `(참고: 비신뢰 판매처 최저 ${won(ct.anyMin.price)}원 ${ct.anyMin.mall})` : '');
  else {
    const ok = c.matched.filter((x) => x.colorMatch !== false && x.keyMatch && x.price);
    const used = ok.filter((x) => /중고/.test(x.title)), fresh = ok.filter((x) => !/중고/.test(x.title) && !x.overseas).sort((a, b) => a.price - b.price)[0];
    if (!fresh && used.length) reason = `신품 매물 없음(일치 매물은 중고 ${used.length}건)`;
    else if (fresh) { const n = net(k, fresh.price), pct = +(n / fresh.price * 100).toFixed(1); const mall = (fresh.topMalls && fresh.topMalls[0] && fresh.topMalls[0].mall) || '';
      rows.push(mk(p, { '매입가(원)': fresh.price, '판매처': mall || '네이버 검색 카드(판매처 미표시)', '예상순수익(원)': n, '수익률(%)': pct, '사유': n >= 10000 && pct >= 8 ? `참고(고위험): 최저 ${won(fresh.price)}원 순수익 ${won(n)}원(${pct}%)이나 판매처 미표시·소형몰/구매대행 추정 → 신뢰 판매처 아님, 재고·판매자 미확인` : `순수익 ${won(n)}원(${pct}%): 마진 기준 미달` })); continue; }
    else reason = '모델은 일치하나 색상 일치 신품 매물 없음';
  }
  rows.push(mk(p, { '사유': reason }));
}
rows.sort((a, b) => (b['판정'].startsWith('후보') - a['판정'].startsWith('후보')) || ((b['수익률(%)'] || -999) - (a['수익률(%)'] || -999)));
const meta = { 분석일: '2026-11-06', 범위: `크림 스톤아일랜드 검색 200개 카드 중 어제 탐색 51개·정가 대비 할인 표시 98개 제외 → 신규 51개 수집, 1차 필터 통과 40개 네이버 대조 (총 ${rows.length}행, 사이즈별 후보는 별도 행)`,
  위험등급기준: RISK_RULE, 수수료율: FEE, 배송비: SHIP, 후보기준: '순수익 ≥ 10,000원 & 수익률 ≥ 8% & 모델·색상 일치 & 신뢰 판매처 & 재고 확인',
  수집방식: '사용자 Chrome에 로드한 확장(naver-extension)이 릴레이 큐의 크림·네이버 페이지를 열어 화면 텍스트 덤프, 해석은 로컬 스크립트. 작업 간 4~11초(상향 1단계 적용), 시간당 150페이지 상한, 차단 화면 감지 시 즉시 중단 — 이번 실행 접속 제한 0건',
  재고확인: '판매처 사이트 표기 기준: LFmall(XXL 1개 남음), SSG(옵션별 남은수량), W컨셉(품절), 트렌비(옵션 선택 가능 여부, 수량 UI 없음). ▲ 수량 증가 테스트는 이 판매처들에 수량 조절 UI가 없거나 입점 단품 상품이라 적용되지 않음',
  한계: ['크림 시세는 최근 체결 약 40~51건(약 4~6주) 기준, 사이즈별 표본은 5~21건', '정품 여부·검수 불합격·반품 리스크 미반영', '네이버 카드 중 판매처 미표시 매물은 신뢰 판매처로 인정하지 않음', '1개월 차트는 체결 데이터 기준으로 대체(화면 캡처 지연), 3개월·전체는 화면 확인(521751)'] };
fs.writeFileSync(path.join(dir, 'final-all.json'), JSON.stringify({ rows, meta }, null, 1));
const cnt = (f) => rows.filter(f).length;
console.log(`총 ${rows.length}행 | 후보 ${cnt((r) => r['판정'].startsWith('후보'))} | 제외 ${cnt((r) => r['판정'] === '제외')}`);
const why = {}; for (const r of rows) if (r['판정'] === '제외') { const key = r['사유'].replace(/\d[\d,.]*/g, '#').slice(0, 30); why[key] = (why[key] || 0) + 1; }
console.log('제외 사유 분포:'); for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`  ${v}  ${k}`);
console.log(rows.filter((r) => r['판정'].startsWith('후보')).map((r) => `${r['판정']} ${r['상품명'].slice(0, 44)} | ${r['판매처']} ${won(r['매입가(원)'])} | 크림 ${won(r['크림시세(원)'])} → 순수익 ${won(r['예상순수익(원)'])} (${r['수익률(%)']}%)`).join('\n'));
