// 자동 판정 (run-all 5단계). 손으로 적은 OV 테이블 없이 k50.json + n-cards.json + n-cat.json + facts.json 만으로 final-all.json 을 만든다.
// 후보 기준(2026-11-07 변경): 순수익 > 0 & 모델·색상 코드 정확 일치(띄어쓰기 차이는 허용·특별표시) & (신뢰 판매처 또는 판매자 확인) & 재고 문구에 품절/매진 없음.
// 하락 추세·고점권(수익률 15% 미만)은 제외하지 않고 '특별표시' 열과 차트 근거에 표시한다.
// 판단이 필요한 항목(조건부 가격, 입점 판매, 재고 수량 불명)은 "검토 필요"로 표시해 마지막 검토(강한 모델/사람)에게 넘긴다. 숨기는 빈칸은 없다.
import fs from 'node:fs'; import path from 'node:path'; import { otherColor } from './code-match.mjs';
import { stockSummary } from './stock-summary.mjs';
import { context, profit, readJson, tradesFromDump } from './agents-core.mjs';
import { screenListing, searchOffers } from './margin-screen.mjs';
import { analyze as chartAnalyze, readTrades as chartTrades } from './chart-analyze.mjs';   // 차트 기준(2026-11-06 재수립): 유동성 게이트·사이즈 보정 추세·고점·급등
const dir = process.argv[2]; const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
// k50-all.json(차트 게이트 전 전체)이 있으면 그걸 쓴다 — 게이트에서 건너뛴 상품도 사유와 함께 엑셀에 남기기 위해
const k50 = fs.existsSync(path.join(dir, 'k50-all.json')) ? rd('k50-all.json') : rd('k50.json'), cards = rd('n-cards.json'), cat = rd('n-cat.json'), facts = fs.existsSync(path.join(dir, 'facts.json')) ? rd('facts.json') : {};
for (const entry of Object.values(cards)) entry.matched = searchOffers(entry);
const ctx = context(dir);
// 2026-11-07: 크림 덤프가 없으면(--skip-kream 재실행) 저장된 chart.json 을 쓴다
const chartJ = fs.existsSync(path.join(dir, 'chart.json')) ? rd('chart.json') : {};
const chartOf = (id) => { const tf = path.join(dir, `dump-K${id}.json`); return fs.existsSync(tf) ? chartAnalyze(chartTrades(tf).sort((a, b) => b.date - a.date)) : (chartJ[id] || { 분류: '데이터 부족', 판단: '보류', 점수: 2, 근거: ['덤프 없음'], 지표: {} }); };
const FEE = ctx.policy.feeRate, SHIP = ctx.policy.outboundShipping; const collab = /슈프림|뉴발란스|포터|디올|Supreme|New Balance|Porter|Dior/i;
const net = (k, b) => profit(k, b, ctx.policy); const won = (n) => Number(n).toLocaleString('ko-KR');
const TRUST = /롯데ON|롯데온|롯데홈쇼핑|롯데백화점|현대Hmall|현대백화점|더현대|신세계|SSG|머스트잇|MUSTIT|더블유컨셉|W컨셉|무신사|29CM|트렌비|LFmall|CJ온스타일|GS\s?SHOP|SK스토아|KT알파|11번가|10x10|텐바이텐/i;
function kreamRows(id) { return tradesFromDump(readJson(dir, `dump-K${id}.json`)).filter((trade) => {
  const age = Date.parse(ctx.now) - Date.parse(trade.at); return age >= 0 && age <= 30 * 86400000;
}); }
const med = (a) => { const s = [...a].sort((x, y) => x - y), k = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[k] : Math.round((s[k - 1] + s[k]) / 2)) : null; };
const bySize = (id) => { const m = {}; for (const r of kreamRows(id)) (m[r.size] ??= []).push(r.price); return m; };
const trend = (id) => { const r = kreamRows(id).map((x) => x.price); const n = Math.floor(r.length / 3); if (n < 4) return '데이터 부족'; const a = r.slice(0, n).reduce((x, y) => x + y, 0) / n, b = r.slice(-n).reduce((x, y) => x + y, 0) / n; const ch = (a / b - 1) * 100; return `${ch > 3 ? '상승' : ch < -3 ? '하락' : '횡보'}(최근 ${n}건 vs 이전 ${n}건 ${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%, 체결 데이터 기준)`; };
const base = (p) => ({ '상품명': p.title, '카테고리': '의류', '크림ID': String(p.id), '모델번호': p.model || '', '크림시세(원)': p.kreamMed ?? '', '시세기준': `최근 체결 ${p.n}건 중앙값(사이즈 혼합)`, '발매가(원)': '', '차트 분류': '', '차트 판단': '', '차트 근거': '', '최근30일 체결': '', '매입가(원)': '', '판매처 배송비(원)': '', '판매처': '', '판매처 링크': '', '상호명': '', '대표자': '', '사업자구분': '', '예상순수익(원)': '', '수익률(%)': '', '최대 적립 포인트(원)': '', '포인트 포함 순수익(원)': '', '포인트 포함 수익률(%)': '', '판정': '제외', '특별표시': '', '위험등급': '', '위험근거': '', '사유': '', '리스크': '', '재고확인': '' });
const rows = [];
for (const p of k50) {
  const id = String(p.id), k = p.kreamMed, c = cards[id], ct = cat[id], fx = facts[`N${id}-prod`]; const ch0 = chartOf(id);
  // 특별표시: 하락 추세는 제외하지 않고 표시 + 차트 근거 앞에 첨부 (2026-11-07)
  const flags = []; const down = ch0.strict && ch0.strict.구분 === '제외'; if (down) flags.push('⚠하락추세');   // 2026-11-07: 엄격 기준(strict)의 하락 판정을 참고
  const chartWhy = (down ? `⚠하락추세 — ${ch0.근거[ch0.근거.length - 1]} || ` : '') + ch0.근거.join(' / ');
  const r = { ...base(p), '차트 분류': ch0.분류, '차트 판단': `${ch0.판단} (위험점수 ${ch0.점수})`, '차트 근거': chartWhy, '최근30일 체결': ch0.지표.최근30일체결 ?? '', '특별표시': flags.join(' · ') };
  if (collab.test(p.title)) { rows.push({ ...r, '사유': '협업 상품: 국내 정가 구매처 없음' }); continue; }
  if (ch0.판단 === '보류') flags.push('※차트 데이터 부족(참고용)');   // 2026-11-07: 네이버 서칭은 진행하고 특별표시만
  if (ch0.strict && ch0.strict.구분 === '검토') flags.push(`※엄격기준 참고: ${ch0.분류}`);
  r['특별표시'] = flags.join(' · ');
  if (!p.model) { rows.push({ ...r, '판정': '사람 검토', '사유': '모델번호 미확인: 상품 식별 후 추가 탐색 필요' }); continue; }
  if (p.n < 10) { rows.push({ ...r, '판정': '사람 검토', '사유': `크림 관측 체결 ${p.n}건: 유동성·시세 추가 확인 필요` }); continue; }
  if (!c || !c.matched.length) { rows.push({ ...r, '판정': '사람 검토', '사유': !c ? '네이버 검색 결과 미수집: 추가 탐색 필요' : '수집된 검색 결과에서 일치 신품 미확인: 추가 탐색 필요' }); continue; }
  // 매입 후보: 판매처 페이지를 확인한 매물(facts) > 카탈로그 신뢰 최저 > 단일 카드 최저
  let buy = null, mall = '', link = '', confirmed = false, why = '', codeNote = '', ship = 0, shipUnk = false;
  if (fx && !fx.blocked) { const src = (ct && ct.trustedMin) || null; const single = c.matched.filter((m) => !m.isCatalog && !m.overseas && m.keyMatch && m.colorMatch !== false && !/중고/.test(m.title)).sort((a, b) => a.price - b.price)[0];
    const pick = /신뢰 카탈로그/.test(fx.why) && src ? { price: src.price, mall: src.mall, link: src.link, code: src } : single ? { price: single.price, mall: (single.topMalls && single.topMalls[0] && single.topMalls[0].mall) || '', link: single.link, code: single } : null;
    if (pick) { buy = pick.price; mall = pick.mall; link = fx.url || pick.link; confirmed = fx.isProductPage; why = fx.why; if (pick.code.codeType === 'spacing') codeNote = pick.code.codeNote; ship = pick.code.shipFee ?? 0; shipUnk = pick.code.shipFee == null; } }
  else if (ct && ct.trustedMin) { buy = ct.trustedMin.price; mall = ct.trustedMin.mall; link = ct.trustedMin.link || ''; if (ct.trustedMin.codeType === 'spacing') codeNote = ct.trustedMin.codeNote; ship = ct.trustedMin.shipFee ?? 0; shipUnk = ct.trustedMin.shipFee == null; }
  else { const single = c.matched.filter((m) => !m.isCatalog && !m.overseas && m.keyMatch && m.colorMatch !== false && !/중고/.test(m.title)).sort((a, b) => a.price - b.price)[0]; if (single) { buy = single.price; mall = (single.topMalls && single.topMalls[0] && single.topMalls[0].mall) || '판매처 미표시'; link = single.link; if (single.codeType === 'spacing') codeNote = single.codeNote; ship = single.shipFee ?? 0; shipUnk = single.shipFee == null; } }
  if (codeNote) flags.push('ⓢ코드 띄어쓰기 차이'); if (shipUnk) flags.push('⚠배송비 미확인(0원으로 계산)'); r['특별표시'] = flags.join(' · ');
  if (!buy) { const used = c.matched.filter((m) => /중고/.test(m.title)).length; rows.push({ ...r, '사유': ct ? (ct.usable === 0 ? '카탈로그 매물의 모델·색상 코드 불일치' : '모델·색상 일치 매물이 신뢰 판매처에 없음') : used ? `신품 매물 없음(중고 ${used}건)` : '모델 일치하나 색상 일치 신품 매물 없음' }); continue; }
  // 2026-11-08: 백화점·대형몰 등 신뢰 판매처 목록(TRUST)에 없으면 후보로 보지 않고 제외한다(소형몰·미표시 판매처는 더 이상 "참고"로 포함하지 않음)
  if (!TRUST.test(mall)) { rows.push({ ...r, '매입가(원)': buy, '판매처 배송비(원)': ship, '판매처': mall, '판매처 링크': link, '사유': `제외: 신뢰 판매처 목록에 없는 판매처(${mall || '미표시'}) — 백화점·대형몰이 아니거나 확인 불가` }); continue; }
  const cost0 = buy + ship; const n = net(k, cost0), pct = +(n / cost0 * 100).toFixed(1);
  // 2026-11-07: 최대 적립 포인트 = 현금과 같음. 판정은 현금 마진으로 하되, 엑셀에는 포인트 포함 순수익·수익률을 별도 열로 기록
  const pr = fx && fx.적립포인트_raw || { ratio: null, won_absolute: null, raw: '' };
  const pt = pr.ratio != null ? Math.round(buy * pr.ratio / 100) : (pr.won_absolute || 0);
  const nP = n + pt, pctP = cost0 ? +(nP / cost0 * 100).toFixed(1) : 0;   // 2026-11-07: 판매처 배송비를 매입비용에 포함
  const ch = ch0;   // 위에서 계산한 차트 결과 재사용(덤프 없으면 chart.json)
  // 고점권(조건부) & 수익률 15% 미만: 제외하지 않고 조건을 표시해 포함 (2026-11-07)
  if (/조건부/.test(ch.판단) && pct > 0 && pct < 15) { flags.push(`⚠고점권(${ch.분류}): 수익률 15% 미만`); r['특별표시'] = flags.join(' · '); }
  const fill = { '매입가(원)': buy, '판매처 배송비(원)': ship, '판매처': mall, '판매처 링크': link, '예상순수익(원)': n, '수익률(%)': pct, '최대 적립 포인트(원)': pt || '', '포인트 포함 순수익(원)': pt ? nP : '', '포인트 포함 수익률(%)': pt ? pctP : '', '차트 분류': ch.분류, '차트 판단': `${ch.판단} (위험점수 ${ch.점수})`, '차트 근거': r['차트 근거'], '최근30일 체결': ch.지표.최근30일체결 ?? '' };
  if (n <= 0) {
    const screen = screenListing(p, { title: p.title, price: buy, shipFee: shipUnk ? null : ship, keyMatch: true }, readJson(dir, `dump-K${id}.json`), ctx.policy, ctx.now);
    const option = screen.potentialOptions[0];
    rows.push({ ...r, ...fill, ...(option ? { '크림시세(원)': option.marketPrice, '시세기준': `${option.size} 최근 30일 ${option.count}건 중앙값(옵션별 매입가·재고 미확인)`, '예상순수익(원)': option.estimatedProfit,
      '수익률(%)': +(option.estimatedProfit / cost0 * 100).toFixed(1), '포인트 포함 순수익(원)': '', '포인트 포함 수익률(%)': '' } : {}),
      '판정': screen.status === 'low_potential' ? '제외' : '사람 검토',
      '사유': option ? `사이즈 혼합 시세는 적자이나 ${screen.potentialOptions.map((o) => o.size).join(', ')} 옵션에서 마진 가능성: 실제 옵션 매입가·재고 확인 필요` :
        screen.status === 'low_potential' ? '관측한 사이즈별 시세와 현재 매물가 기준 마진 부족' : '시세·옵션 근거 부족 또는 만료: 수익 없음으로 확정할 수 없어 재확인 필요' });
    continue;
  }
  // 차트: 하락·고점권은 특별표시만(위에서 처리). 급등 직후·급등 후 조정 → 사람 검토, 보류 → 검토 필요
  if (ch.strict && ch.strict.구분 === '검토') { flags.push(`※엄격기준 참고: ${ch.분류}(${ch.근거.find((s) => /급등|조정|데이터/.test(s)) || ch.근거[0]})`); r['특별표시'] = flags.join(' · '); fill['특별표시'] = r['특별표시']; }
  // 2026-11-07: 마진이 양수면 판매처 페이지를 못 열었어도 제외하지 않고 후보로 포함 + 특별표시(미확인 사유)
  // 2026-11-08: 이 지점의 mall 은 이미 TRUST 통과한 신뢰 판매처만 남음(소형몰·미표시는 위에서 제외)
  const unv = (why, extra = {}) => { rows.push({ ...r, ...fill, ...extra, '판정': ch.판단 === '유의' ? '후보(유의: 저유동)' : '후보(판매처 미확인)', '특별표시': [...flags, '※재고·판매자 미확인'].join(' · '), '사유': why }); };
  if (!fx || !fx.재고문구) { unv(fx ? `확인 불가: ${fx.status}` : '검토 필요: 신뢰 판매처 매물이나 상품 페이지(재고·판매자) 미확인'); continue; }
  // 품절 판정: "중고품절"(중고만 품절, 신품 판매 중)은 제외. 남음/남은수량 문구가 있으면 품절 아님.
  const structured = Array.isArray(fx.stockProbe?.results);
  const stockInfo = stockSummary(fx);
  // One sold-out size does not make the whole product sold out. Legacy text lacks
  // complete option enumeration, so require an explicit product-wide statement.
  const soldout = structured ? stockInfo.allSoldout : fx.재고문구.some((s) => /전체\s*(?:사이즈|옵션)?\s*(?:품절|매진)|모든\s*(?:사이즈|옵션).*품절|상품이\s*품절/.test(s));
  // 재고 문구에서 사이즈별 가용 여부 추출: "XXL (110 around) 1개 남음" → 가용, "3XL ... 일시품절" / "XL ... 매진" → 불가
  const SZ = /\b(XXS|XS|S|M|L|XL|XXL|3XL|2XL|4XL|\d{2,3})\b/; const avail = new Set(), gone = new Set();
  for (const s of fx.재고문구) { const m = s.match(SZ); if (!m) continue; if (/남음|남은수량/.test(s) && !/품절|매진/.test(s)) avail.add(m[1]); else if (/품절|매진/.test(s)) gone.add(m[1]); }
  if (structured) { avail.clear(); gone.clear(); stockInfo.available.forEach((s) => avail.add(s)); stockInfo.soldout.forEach((s) => gone.add(s)); }
  const sellerCols = { '상호명': fx.상호명, '대표자': fx.대표자, '사업자구분': `사업자 ${fx.사업자등록번호} / 통신판매 ${fx.통신판매} / ${fx.입점판매}`, '재고확인': fx.재고확인 || stockInfo.text || fx.재고문구.join(' · ') };
  if (fx.blocked) { unv('확인 불가: 판매처 페이지 차단 화면', sellerCols); continue; }
  if (!confirmed) { unv('확인 불가: 링크가 상품 페이지가 아닌 추천/목록 페이지로 연결', sellerCols); continue; }
  if (soldout) { rows.push({ ...r, ...fill, ...sellerCols, '사유': '품절: 판매처 페이지 품절/매진 표기' }); continue; }
  // 사이즈별 재계산: 판매처 재고 문구에 사이즈가 있으면 그 사이즈만, 없으면 크림 사이즈별 전부
  const bs = bySize(id); let sizes = Object.keys(bs).filter((s) => bs[s].length >= 3 && !/즉시/.test(s));
  let sizeNote = '';
  if (avail.size) { sizes = sizes.filter((s) => avail.has(s)); sizeNote = `판매처 가용 사이즈 ${[...avail].join('·')}만 판정` + (gone.size ? ` (${[...gone].join('·')} 품절)` : ''); }   // 사이즈별 재고를 읽은 경우: 가용 사이즈만
  else if (gone.size) { sizes = sizes.filter((s) => !gone.has(s)); sizeNote = `${[...gone].join('·')} 품절 제외, 나머지 사이즈 재고 불명`; }
  const review = []; if (ch.판단 === '보류') review.push('차트 데이터 부족'); if (ch.판단 === '유의') review.push(`저유동(${ch.근거[ch.근거.length - 1]})`); if (/있음/.test(fx.조건부가격)) review.push('조건부 가격'); if (/입점|위탁/.test(fx.입점판매)) review.push('입점·위탁 판매'); if (!avail.size) review.push('재고 사이즈·수량 불명(판매처 옵션을 열어 확인 필요)'); if (fx.상호명 === '확인 불가' || fx.대표자 === '확인 불가') review.push('판매자 정보 일부 미확인');
  if (avail.size && !sizes.length) { rows.push({ ...r, ...fill, ...sellerCols, '사유': `판매처 가용 사이즈(${[...avail].join('·')})의 크림 체결이 3건 미만: 시세 판단 불가` }); continue; }
  if (structured && stockInfo.uncertain) review.push(`재고 부분 확인: ${fx.stockProbe.reason || 'unknown'}`);
  const stockUnknown = structured ? stockInfo.available.length === 0 : fx.재고문구.every((t) => /^확인 불가/.test(t));
  // 색상 대조: 크림 상품명과 판매처 페이지 제목의 색상어가 서로 겹치지 않으면 다른 색상 상품일 수 있음 → 사람 검토
  const COLORS = ['블랙', '화이트', '네이비', '그레이', '베이지', '샌드', '브라운', '카키', '그린', '블루', '레드', '올리브', '오트밀', '아이보리', '핑크', '옐로우', '오렌지', '퍼플', '실버', '차콜', '민트'];
  let sellerTitle = ''; try { sellerTitle = JSON.parse(fs.readFileSync(path.join(dir, `dump-N${id}-prod.json`), 'utf-8')).title || ''; } catch {}
  // 색상 코드 정확 일치(2026-11-07): 판매처 상품 페이지 제목에 같은 모델의 다른 색상 코드가 있으면 제외
  const oc = otherColor(p.model, sellerTitle); if (oc) { rows.push({ ...r, ...fill, ...sellerCols, '사유': `색상 코드 불일치: 판매처 페이지 ${oc} / 크림 ${p.model}` }); continue; }
  const kc = COLORS.filter((c) => p.title.includes(c)), sc = COLORS.filter((c) => sellerTitle.includes(c));
  const colorMismatch = !stockUnknown && kc.length > 0 && sc.length > 0 && !kc.some((c) => sc.includes(c));
  const colorNote = colorMismatch ? `크림 ${kc.join('·')} / 판매처 제목 ${sc.join('·')}` : '';   // 판매처 페이지는 열었지만(또는 수집 실패) 재고 문구가 없음 → 후보 아님, 사람 검토
  for (const s of sizes.length ? sizes : ['전체']) { const ks = s === '전체' ? k : med(bs[s]); const ns = net(ks, cost0), ps = +(ns / cost0 * 100).toFixed(1); const ok = ns > 0; const nsP = ns + pt, psP = cost0 ? +(nsP / cost0 * 100).toFixed(1) : 0;   // 2026-11-07: 순수익 양수면 포함
    rows.push({ ...r, ...fill, ...sellerCols, '상품명': s === '전체' ? p.title : `${p.title} [${s}]`, '크림시세(원)': ks, '시세기준': s === '전체' ? r['시세기준'] : `${s} 사이즈 최근 체결 ${bs[s].length}건 중앙값`, '예상순수익(원)': ns, '수익률(%)': ps, '최대 적립 포인트(원)': pt || '', '포인트 포함 순수익(원)': pt ? nsP : '', '포인트 포함 수익률(%)': pt ? psP : '', '특별표시': stockUnknown ? [...flags, '※재고 미확인'].join(' · ') : r['특별표시'],
      '판정': !ok ? '제외' : colorMismatch ? '사람 검토' : (ch.판단 === '유의' && stockUnknown) ? '후보(유의: 저유동)' : stockUnknown ? '후보(재고 미확인)' : (ch.판단 === '유의' ? '후보(유의: 저유동)' : review.length ? '후보(검토 필요)' : '후보'), '사유': !ok ? `순수익 ${won(ns)}원(${ps}%): 마진 0 이하` : colorMismatch ? `검토 유형: 색상 불일치 의심(${colorNote}) — 같은 모델 코드라도 다른 색상일 수 있어 판매처 상품 페이지와 크림 색상 코드를 직접 대조 필요` : stockUnknown ? `재고 미확인(포함): 마진 양수(순수익 ${won(ns)}원, ${ps}%)이나 판매처 페이지에서 재고·사이즈 문구를 읽지 못함(${fx.재고문구[0]}). 구매 전 직접 확인 필요` : '', '리스크': ok ? (review.length ? `검토 필요 항목: ${review.join(', ')}. 판매처 근거: ${why}` : `판매처 근거: ${why}`) + (sizeNote ? `. ${sizeNote}` : '') + (codeNote ? `. ${codeNote}` : '') : '' }); }
}
// 위험등급·근거: AI 마지막 검토(risk-ai.json)가 있으면 크림ID+상품명으로 합친다
try { const ra = JSON.parse(fs.readFileSync(path.join(dir, 'risk-ai.json'), 'utf-8')); const m = new Map(ra.map((x) => [`${x.크림ID}|${x.상품명}`, x])); for (const r of rows) { const x = m.get(`${r['크림ID']}|${r['상품명']}`); if (x) { r['위험등급'] = x.위험등급; r['위험근거'] = x.위험근거; } } } catch {}
const rank = (x) => x['판정'].startsWith('후보') ? 0 : x['판정'] === '사람 검토' ? 1 : 2;
rows.sort((a, b) => (rank(a) - rank(b)) || ((b['수익률(%)'] || -999) - (a['수익률(%)'] || -999)));
const meta = { 분석일: new Date().toISOString().slice(0, 10), 방식: 'run-all 자동 판정(build-final-auto): 손으로 적은 판단 없음. "후보(검토 필요)"와 "확인 불가"는 마지막 검토 대상', 수수료율: FEE, 배송비: SHIP, 후보기준: '순수익 > 0 & 모델·색상 코드 정확 일치(띄어쓰기 차이는 ⓢ표시 후 포함) & 판매처 페이지 확인 & 품절 아님. 하락추세·고점권(수익률 15% 미만)은 제외하지 않고 ⚠특별표시', 한계: ['위험등급은 자동으로 매기지 않음(마지막 검토에서 점수표 적용)', '크림 차트 3개월·전체는 자동 확인 불가', '재고 수량은 판매처 표기 문구 그대로'] };
fs.writeFileSync(path.join(dir, 'final-all.json'), JSON.stringify({ rows, meta }, null, 1));
const cnt = (f) => rows.filter(f).length; console.log(`총 ${rows.length}행 | 후보 ${cnt((r) => r['판정'] === '후보')} | 후보(검토 필요) ${cnt((r) => r['판정'] === '후보(검토 필요)')} | 후보(유의: 저유동) ${cnt((r) => r['판정'] === '후보(유의: 저유동)')} | 사람 검토 ${cnt((r) => r['판정'] === '사람 검토')} | 제외 ${cnt((r) => r['판정'] === '제외')} | 확인 불가·검토 필요 사유 ${cnt((r) => /확인 불가|검토 필요/.test(r['사유']))}`);
for (const r of rows.filter((x) => x['판정'].startsWith('후보'))) console.log(`  ${r['판정']} ${r['상품명'].slice(0, 44)} | ${r['판매처']} ${won(r['매입가(원)'])} | 크림 ${won(r['크림시세(원)'])} → ${won(r['예상순수익(원)'])} (${r['수익률(%)']}%) | ${r['리스크'].slice(0, 60)}`);
