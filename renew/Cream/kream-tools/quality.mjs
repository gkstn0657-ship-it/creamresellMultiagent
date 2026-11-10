// 결과 품질 점검 (2026-11-07): 수집은 멈추지 않았는데 결과가 조용히 틀리는 경우를 잡는다.
//  예: 네이버 화면 구조가 바뀌어 카드를 0개 읽음, 카탈로그 행 0개, 판매처 재고를 거의 못 읽음, 말이 안 되는 수익률.
// 사용: node kream-tools/quality.mjs <run-dir>   → 전체 점검 결과 출력 + <run-dir>/quality.json
//       run-all 이 단계마다 불러서 쓴다. level: ok | warn | fail (fail 이면 다음 단계로 가지 않는 것이 안전)
import fs from 'node:fs'; import path from 'node:path';
import { stockSummary } from './stock-summary.mjs';
const rd = (dir, f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); } catch { return d; } };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
// 파싱 결과 파일이 없거나 해당 단계의 최신 덤프보다 오래됐으면(아직 파싱 전) 점검하지 않는다 — 단계 도중 점검 시 오판 방지
const fresh = (dir, file, re) => { try { const t = fs.statSync(path.join(dir, file)).mtimeMs; const ds = fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => fs.statSync(path.join(dir, f)).mtimeMs); return !ds.length || t >= Math.max(...ds); } catch { return false; } };
const notYet = (stage) => ({ stage, level: 'ok', issues: [], stats: { parsed: false, note: '아직 파싱 전' } });
const verdict = (issues) => (issues.some((i) => i.level === 'fail') ? 'fail' : issues.some((i) => i.level === 'warn') ? 'warn' : 'ok');
export const LIMITS = { searchZeroWarn: 30, searchZeroFail: 50, searchNoMatchWarn: 70, catZeroWarn: 40, stockUnknownWarn: 70, sellerUnknownWarn: 70, absurdPct: 100 };

// 네이버 검색: 덤프는 있는데 카드를 0개 읽은 비율(화면 구조 변경 의심), 모델 일치 0개 비율
export function qualitySearch(dir) {
  if (!fresh(dir, 'n-cards.json', /^dump-N\d+-s2?\.json$/)) return notYet('네이버 검색');
  const cards = rd(dir, 'n-cards.json', {}); const k50 = rd(dir, 'k50.json', []); const issues = [];
  const searched = k50.map((p) => String(p.id)).filter((id) => fs.existsSync(path.join(dir, `dump-N${id}-s.json`)));
  if (!searched.length) return { stage: '네이버 검색', level: 'ok', issues, stats: { searched: 0 } };
  const zero = searched.filter((id) => !cards[id] || !cards[id].cards); const noMatch = searched.filter((id) => cards[id] && cards[id].cards && !cards[id].matched.length);
  const zp = pct(zero.length, searched.length), np = pct(noMatch.length, searched.length);
  if (zp >= LIMITS.searchZeroFail) issues.push({ level: 'fail', msg: `검색 덤프 ${searched.length}건 중 ${zero.length}건(${zp}%)에서 카드를 0개 읽음. 네이버 화면 구조 변경 또는 차단 의심. 덤프 1건을 열어 확인 필요(예: ${zero.slice(0, 3).join(',')})` });
  else if (zp >= LIMITS.searchZeroWarn) issues.push({ level: 'warn', msg: `카드 0개 검색 ${zero.length}건(${zp}%). 일부 화면 구조 변경 의심(예: ${zero.slice(0, 3).join(',')})` });
  if (np >= LIMITS.searchNoMatchWarn) issues.push({ level: 'warn', msg: `카드는 읽었지만 모델 코드가 맞는 카드가 없는 상품 ${noMatch.length}건(${np}%). 검색어나 코드 대조 규칙 확인 필요` });
  return { stage: '네이버 검색', level: verdict(issues), issues, stats: { searched: searched.length, zeroCards: zero.length, noMatch: noMatch.length } };
}
// 카탈로그: 덤프는 있는데 판매처 행을 0개 읽은 비율
export function qualityCatalog(dir) {
  if (!fresh(dir, 'n-cat.json', /^dump-N\d+-cat\.json$/)) return notYet('카탈로그');
  const cat = rd(dir, 'n-cat.json', {}); const issues = []; const dumps = fs.readdirSync(dir).filter((f) => /^dump-N\d+-cat\.json$/.test(f)).map((f) => f.match(/N(\d+)-cat/)[1]);
  if (!dumps.length) return { stage: '카탈로그', level: 'ok', issues, stats: { dumps: 0 } };
  const zero = dumps.filter((id) => !cat[id] || !cat[id].rows); const zp = pct(zero.length, dumps.length);
  if (zp >= LIMITS.catZeroWarn) issues.push({ level: 'warn', msg: `카탈로그 ${dumps.length}건 중 ${zero.length}건(${zp}%)에서 판매처 행을 0개 읽음. 카탈로그 화면 구조 변경 의심(예: ${zero.slice(0, 3).join(',')})` });
  return { stage: '카탈로그', level: verdict(issues), issues, stats: { dumps: dumps.length, zeroRows: zero.length } };
}
// 판매처 페이지: 재고 문구·판매자 정보를 못 읽은 비율, 차단 화면
export function qualityFacts(dir) {
  if (!fresh(dir, 'facts.json', /^dump-N\d+-prod\.json$/)) return notYet('판매처 페이지');
  const facts = rd(dir, 'facts.json', {}); const issues = []; const list = Object.values(facts); if (!list.length) return { stage: '판매처 페이지', level: 'ok', issues, stats: { pages: 0 } };
  const opened = list.filter((f) => f.url); const stockUnk = opened.filter((f) => Array.isArray(f.stockProbe?.results) ? stockSummary(f).uncertain : !f.재고문구 || f.재고문구.every((t) => /^확인 불가/.test(t))); const sellerUnk = opened.filter((f) => f.상호명 === '확인 불가'); const blocked = opened.filter((f) => f.blocked);
  if (blocked.length) issues.push({ level: 'warn', msg: `판매처 페이지 ${blocked.length}건이 차단 화면` });
  if (opened.length >= 3 && pct(stockUnk.length, opened.length) >= LIMITS.stockUnknownWarn) issues.push({ level: 'warn', msg: `판매처 페이지 ${opened.length}건 중 ${stockUnk.length}건(${pct(stockUnk.length, opened.length)}%)에서 재고 문구를 못 읽음. 옵션 열기 동작이나 사이트 형식 확인 필요` });
  if (opened.length >= 3 && pct(sellerUnk.length, opened.length) >= LIMITS.sellerUnknownWarn) issues.push({ level: 'warn', msg: `판매자 상호를 못 읽은 페이지 ${sellerUnk.length}건(${pct(sellerUnk.length, opened.length)}%)` });
  return { stage: '판매처 페이지', level: verdict(issues), issues, stats: { pages: list.length, opened: opened.length, stockUnknown: stockUnk.length, sellerUnknown: sellerUnk.length, blocked: blocked.length } };
}
// 최종 결과: 말이 안 되는 수익률(데이터 오류 의심), 후보 0개
export function qualityFinal(dir) {
  const f = rd(dir, 'final-all.json', null); const issues = []; if (!f) return { stage: '판정', level: 'ok', issues, stats: {} };
  const cand = f.rows.filter((r) => String(r['판정']).startsWith('후보')); const absurd = cand.filter((r) => Number(r['수익률(%)']) > LIMITS.absurdPct);
  if (absurd.length) issues.push({ level: 'warn', msg: `수익률 ${LIMITS.absurdPct}% 초과 후보 ${absurd.length}행. 다른 상품·사이즈 가격이 섞인 데이터 오류 의심(예: ${absurd.slice(0, 2).map((r) => `${r['크림ID']} ${r['수익률(%)']}% ${r['판매처']}`).join(', ')})` });
  if (f.rows.length >= 10 && !cand.length) issues.push({ level: 'warn', msg: `전체 ${f.rows.length}행 중 후보 0행. 기준이나 수집 단계 확인 필요` });
  return { stage: '판정', level: verdict(issues), issues, stats: { rows: f.rows.length, candidates: cand.length, absurd: absurd.length } };
}
export function qualityAll(dir) {
  const parts = [qualitySearch(dir), qualityCatalog(dir), qualityFacts(dir), qualityFinal(dir)];
  const res = { at: new Date().toISOString(), level: verdict(parts.flatMap((p) => p.issues)), parts };
  try { fs.writeFileSync(path.join(dir, 'quality.json'), JSON.stringify(res, null, 1)); } catch {}
  return res;
}
// 한 줄 요약(run-all 로그용): "품질경보(주의) 단계: 메시지" 형식
export const qualityLines = (q) => q.issues.map((i) => `${i.level === 'fail' ? '품질경보(중단)' : '품질경보(주의)'} ${q.stage}: ${i.msg}`);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const dir = process.argv[2]; if (!dir) { console.error('사용: node kream-tools/quality.mjs <run-dir>'); process.exit(1); }
  const r = qualityAll(dir);
  for (const p of r.parts) { console.log(`[${p.level.toUpperCase()}] ${p.stage} ${JSON.stringify(p.stats)}`); for (const l of qualityLines(p)) console.log('   ' + l); }
  console.log(`종합: ${r.level}`); process.exit(r.level === 'fail' ? 1 : 0);
}
