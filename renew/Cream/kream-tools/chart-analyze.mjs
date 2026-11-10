// 크림 체결 데이터 기반 차트 분석 — 리셀 소싱 판단용 분류와 위험 점수
// 전제: 사서 1~3주 안에 크림에 되판다. 따라서 (1) 지금 가격이 최근 고점인지, (2) 급등 직후인지, (3) 거래가 충분히 빨리 되는지, (4) 사이즈 섞임 착시를 뺀 추세인지가 핵심.
// 입력: <run-dir>/dump-K<id>.json (거래 내역 창에서 읽은 최근 체결 약 50건: 사이즈·가격·날짜). 날짜 기준으로 창을 자른다(기간이 아니라 건수 기준 데이터이므로).
// 출력: <run-dir>/chart.json  { id: { 분류, 판단, 점수, 근거[], 지표{...} } }
// 사용: node chart-analyze.mjs <run-dir> [id,...]   (id 생략 시 폴더의 모든 dump-K*)
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2]; const only = (process.argv[3] || '').split(',').filter(Boolean);
const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0); const DAY = 86400000;
const med = (a) => { const s = [...a].sort((x, y) => x - y), k = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2) : null; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)) : 0; };

// 1) 덤프 → 체결 행 (date, size, price). 상대시간('3시간 전')은 오늘로 본다.
export function readTrades(file) {
  const t = JSON.parse(fs.readFileSync(file, 'utf-8')).text; const L = t.split('\n').map((s) => s.trim()).filter(Boolean);
  const st = L.lastIndexOf('거래일'); if (st < 0) return []; const out = [];
  for (let i = st + 1; i < L.length; i++) {
    const s = L[i]; if (!(s.endsWith('원') && /^[\d,]+$/.test(s.slice(0, -1)) && L[i - 1].length < 8 && !/즉시/.test(L[i - 1]))) continue;
    let date = null; for (let j = i + 1; j < Math.min(L.length, i + 4); j++) { const m = L[j].match(/^(\d{2})\/(\d{2})\/(\d{2})$/); if (m) { date = new Date(2000 + +m[1], +m[2] - 1, +m[3]); break; } if (/(분|시간) 전|방금|오늘/.test(L[j])) { date = new Date(TODAY); break; } if (/^(\d+)일 전$/.test(L[j])) { date = new Date(TODAY - +L[j].match(/^(\d+)/)[1] * DAY); break; } if (/원$/.test(L[j])) break; }
    if (date) out.push({ date, size: L[i - 1], price: Number(s.slice(0, -1).replace(/,/g, '')) });
  }
  return out;
}

// 2) 분석
// 탈락 2종류 (2026-11-06 사용자 결정): '제외' = 명백한 부정 지표(바로 탈락), '검토' = 물음표(탈락시키지 않고 사람이 보도록 따로 뺌), '통과'.
// 어떤 분류를 어느 쪽에 둘지는 아래 두 배열만 고치면 된다.
export const CLEAR_EXCLUDE = ['하락'];                                   // 최근 7일 가격 하락 → 되팔 때 더 내릴 가능성이 명백
export const NEEDS_REVIEW = ['데이터 부족', '급등 직후', '급등 후 조정'];   // 판단 근거가 모호: 사람이 판단
// 2026-11-07 변경: 기존 엄격 기준(strict)은 참고용으로 보존하고, 실제 파이프라인은 '가능성이 보이면 일단 후보'로 돌린다.
//   구분: '통과' = 네이버 서칭 대상, '검토' = 데이터 부족 등으로 서칭은 하되 결과를 사람 검토로 분류
//   strict: 이전 기준(하락=제외, 데이터부족/급등/조정=검토). 엑셀 '차트 판단' 열의 참고 문구로만 쓴다.
export function analyze(trades) {
  const r = analyzeCore(trades);
  const strict = { 구분: CLEAR_EXCLUDE.includes(r.분류) ? '제외' : NEEDS_REVIEW.includes(r.분류) ? '검토' : '통과', 판단: r.판단 };
  const 구분 = r.분류 === '데이터 부족' ? '검토' : '통과';   // 데이터 부족도 네이버는 돌려본다(매물 있으면 사람 검토로 남김)
  return { ...r, 구분, strict };
}
function analyzeCore(trades) {
  const R = { 지표: {}, 근거: [] }; const n = trades.length;
  if (n < 5) return { ...R, 분류: '데이터 부족', 판단: '보류', 점수: 2, 근거: [`체결 ${n}건`] };
  const age = (t) => Math.floor((TODAY - t.date) / DAY);
  const w7 = trades.filter((t) => age(t) <= 7), w30 = trades.filter((t) => age(t) <= 30), w830 = trades.filter((t) => age(t) > 7 && age(t) <= 30), w90 = trades.filter((t) => age(t) <= 90), w3190 = trades.filter((t) => age(t) > 30 && age(t) <= 90);
  const spanDays = Math.max(1, age(trades[trades.length - 1]) - age(trades[0]) + 1);
  R.지표.체결수 = n; R.지표.최근30일체결 = w30.length; R.지표.최근7일체결 = w7.length; R.지표.데이터기간일 = spanDays; R.지표.일평균체결_30일 = +(w30.length / 30).toFixed(2);
  // 사이즈 효과 제거: 각 체결을 "그 사이즈의 창 내 중앙값" 대비 비율로 바꾼 지수(1.0 = 그 사이즈 평균 수준). 사이즈 체결 3건 미만이면 전체 중앙값 대비
  const bySize = {}; for (const t of w90.length >= 10 ? w90 : trades) (bySize[t.size] ??= []).push(t.price);
  const allMed = med((w90.length >= 10 ? w90 : trades).map((t) => t.price));
  const base = (t) => (bySize[t.size] && bySize[t.size].length >= 3 ? med(bySize[t.size]) : allMed);
  const idx = (list) => list.map((t) => t.price / base(t));
  const sizeMix = Object.keys(bySize).length > 1 && Object.values(bySize).some((v) => v.length >= 3 && Math.abs(med(v) / allMed - 1) > 0.12);
  if (sizeMix) R.근거.push('사이즈별 시세 차이 12% 이상 → 사이즈 보정 지수로 추세 계산(헤더 등락률 착시 배제)');
  // 유동성: 탈락 조건이 아니라 "유의" 표시 (사용자 판단). 30일 5건 미만이면 추세 지표는 계산 불가라 유동성 정보만 돌려준다.
  if (w30.length < 5) { const last = age(trades[0]); const w90n = w90.length;
    return { ...R, 분류: '저유동', 판단: '유의', 점수: 2, 근거: [...R.근거, `최근 30일 체결 ${w30.length}건, 90일 ${w90n}건, 마지막 체결 ${last}일 전 — 1~3주 내 매도가 느릴 수 있음(판단 필요)`] }; }
  // 창별 지수 중앙값
  const m7 = med(idx(w7)), m830 = med(idx(w830)), m30 = med(idx(w30)), m3190 = med(idx(w3190));
  const ref = m830 ?? m30; const chg7 = m7 != null && ref ? (m7 / ref - 1) * 100 : null; const chg30 = m30 != null && m3190 ? (m30 / m3190 - 1) * 100 : null;
  R.지표.최근7일_vs_8_30일 = chg7 == null ? null : +chg7.toFixed(1); R.지표.최근30일_vs_31_90일 = chg30 == null ? null : +chg30.toFixed(1);
  // 일별 지수(사이즈 보정) → 고점 위치·급등·변동성
  const byDay = {}; for (const t of w90.length >= 10 ? w90 : trades) (byDay[age(t)] ??= []).push(t.price / base(t));
  const days = Object.keys(byDay).map(Number).sort((a, b) => a - b); const daily = days.map((d) => ({ d, v: med(byDay[d]) }));
  const peak = daily.reduce((p, x) => (x.v > p.v ? x : p), daily[0]); const cur = m7 ?? daily[0].v;
  const peakRatio = cur / peak.v; R.지표.현재_대비_90일고점 = +(peakRatio * 100).toFixed(1); R.지표.고점_며칠전 = peak.d;
  let spikeDay = null; for (let i = 0; i < daily.length; i++) { const prev = daily.slice(i + 1, i + 8).map((x) => x.v); if (prev.length >= 3 && daily[i].v / med(prev) - 1 >= 0.15) { spikeDay = daily[i].d; break; } }
  R.지표.급등일_며칠전 = spikeDay;
  const vol30 = daily.filter((x) => x.d <= 30).map((x) => x.v); const cv = vol30.length >= 3 ? sd(vol30) / mean(vol30) * 100 : null; R.지표.변동계수_30일 = cv == null ? null : +cv.toFixed(1);
  const f7 = w7.length, f830 = w830.length / (23 / 7); R.지표.거래빈도_7일_vs_이전 = f830 ? +(f7 / f830).toFixed(2) : null;
  // 3) 분류 (우선순위 순)
  let 분류, 판단, 점수;
  const trendUp = chg7 != null && chg7 >= 5, trendDown = chg7 != null && chg7 <= -5, nearPeak = peakRatio >= 0.95 && peak.d <= 30;
  if (spikeDay != null && spikeDay <= 14) { 분류 = '급등 직후'; 판단 = '관망'; 점수 = 2; R.근거.push(`${spikeDay}일 전 하루 만에 직전 7일 중앙값 대비 +15% 이상 → 고점 매수 위험`); }
  else if (trendDown) { 분류 = '하락'; 판단 = '제외'; 점수 = 2; R.근거.push(`최근 7일 ${chg7.toFixed(1)}% (8~30일 대비) → 되팔 때 더 내릴 수 있음`); }
  else if (spikeDay != null && spikeDay <= 45 && peakRatio < 0.9) { 분류 = '급등 후 조정'; 판단 = '관망'; 점수 = 2; R.근거.push(`${spikeDay}일 전 급등 후 고점 대비 ${((1 - peakRatio) * 100).toFixed(0)}% 하락 중 → 바닥 미확인`); }
  else if (trendUp && !nearPeak) { 분류 = '상승 지속'; 판단 = '매수 가능'; 점수 = 0; R.근거.push(`최근 7일 +${chg7.toFixed(1)}%, 고점 대비 ${(peakRatio * 100).toFixed(0)}%`); }
  else if (trendUp && nearPeak) { 분류 = '상승·고점권'; 판단 = '조건부(마진 15% 이상일 때)'; 점수 = 1; R.근거.push(`최근 7일 +${chg7.toFixed(1)}%지만 90일 고점(${peak.d}일 전)의 ${(peakRatio * 100).toFixed(0)}% → 상단 매수`); }
  else if (nearPeak) { 분류 = '고점 횡보'; 판단 = '조건부(마진 15% 이상일 때)'; 점수 = 1; R.근거.push(`횡보 중이나 90일 고점(${peak.d}일 전)의 ${(peakRatio * 100).toFixed(0)}%`); }
  else { 분류 = '횡보'; 판단 = '매수 가능'; 점수 = 0; R.근거.push(`최근 7일 ${chg7 == null ? '체결 없음' : (chg7 >= 0 ? '+' : '') + chg7.toFixed(1) + '%'} (±5% 이내), 고점 대비 ${(peakRatio * 100).toFixed(0)}%`); }
  if (cv != null && cv >= 8) { 점수 += 1; R.근거.push(`30일 일별 변동계수 ${cv.toFixed(1)}% (8% 이상) → 매도가 예측 어려움`); }
  if (R.지표.거래빈도_7일_vs_이전 != null && R.지표.거래빈도_7일_vs_이전 < 0.5 && w830.length >= 8) { 점수 += 1; R.근거.push(`최근 7일 거래 빈도가 이전의 ${(R.지표.거래빈도_7일_vs_이전 * 100).toFixed(0)}% → 수요 식는 중`); }
  if (w30.length < 10) { 점수 = Math.max(점수, 1); R.근거.push(`최근 30일 체결 ${w30.length}건 → 시세 신뢰도 낮음`); }
  if (chg30 != null && chg30 >= 10) R.근거.push(`30일 vs 31~90일 +${chg30.toFixed(1)}% (중기 상승)`); else if (chg30 != null && chg30 <= -10) { R.근거.push(`30일 vs 31~90일 ${chg30.toFixed(1)}% (중기 하락)`); 점수 += 1; }
  return { ...R, 분류, 판단, 점수: Math.min(점수, 3) };
}

if (process.argv[1] && /chart-analyze\.mjs$/.test(process.argv[1])) {
  const files = fs.readdirSync(dir).filter((f) => /^dump-K\d+\.json$/.test(f)).filter((f) => !only.length || only.includes(f.slice(6, -5)));
  const out = {}; const dist = {};
  for (const f of files) { const id = f.slice(6, -5); const tr = readTrades(path.join(dir, f)); tr.sort((a, b) => b.date - a.date); const r = analyze(tr); out[id] = r; dist[r.분류] = (dist[r.분류] || 0) + 1; }
  fs.writeFileSync(path.join(dir, 'chart.json'), JSON.stringify(out, null, 1));
  console.log(`분석 ${files.length}개 → chart.json | 분포: ${JSON.stringify(dist)}`);
  for (const [id, r] of Object.entries(out)) console.log(`  ${id.padEnd(8)} ${r.분류.padEnd(8)} ${r.판단.padEnd(16)} 점수${r.점수} | 30일 ${r.지표.최근30일체결 ?? '-'}건 7d ${r.지표.최근7일_vs_8_30일 ?? '-'}% 고점비 ${r.지표.현재_대비_90일고점 ?? '-'}% | ${r.근거[0] || ''}`);
}
