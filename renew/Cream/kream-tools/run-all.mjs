// 크림 소싱 드라이버 — 오늘(2026-11-06) 손으로 이어 붙인 단계를 그대로 코드로 옮긴 것.
// 2026-11-07 기준 변경: 마진은 순수익 > 0 이면 통과, 하락 추세도 네이버 대조 진행(특별표시), 색상 코드 정확 일치(띄어쓰기 차이만 허용).
//   입력: <run-dir>/k50-ids.json (크림 상품 ID 목록. 목록 수집은 Chrome 도구/사람이 함)
//   1 크림 덤프 작업 → 대기 → parse-kream → k50.json
//   2 make-n-jobs(네이버 검색) → 대기 → parse-si → n-cards.json → 마진 가능 선별(margin-1st.json)
//   3 카탈로그 작업(N<id>-cat) → 대기 → parse-si-cat → n-cat.json
//   4 판매처 상품 페이지 작업(N<id>-prod) → 대기 → facts.json(상호·대표자·사업자·재고 문구 추출, 모르면 "확인 불가")
//   5 build-final-auto → final-all.json → export-xlsx
// 사용: node run-all.mjs <run-dir> [--replay] [--max-prod 3]
//   --replay : 사이트 접속·대기 없이 기존 덤프로 재생하고, 오늘 jobs.json 과 생성 작업을 대조 (검증용)
// 안전장치: 릴레이의 속도 제한(15초 간격·4건/회·시간당 150페이지)과 확장의 차단 감지(STOP)는 그대로. STOP 이 보이면 즉시 종료.
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
import { stockSummary } from './stock-summary.mjs';
import { prepareAgents, prepareAgentTeam, runAgents } from './agents-run.mjs';
import { recordIncident } from './agents-incidents.mjs';
import { acquireRunLock,context } from './agents-core.mjs';
import { screenInitialMargins, planMarginCatalogs, planMarginPages } from './margin-screen.mjs';
import { invokeClaude,claudeModelForRole } from './agents-claude.mjs';
import { naverSearchMode, NAVER_SHOPPING_RETIREMENT } from './naver-search-mode.mjs';
const USE_TEAM_AI = !process.argv.includes('--rules-only');
const dir = process.argv[2]; const REPLAY = process.argv.includes('--replay');
if (!dir || !fs.existsSync(dir)) throw new Error('실행 폴더가 없거나 지정되지 않음');
const releaseRunLock = acquireRunLock(dir); process.on('exit', releaseRunLock);
const SKIP_K = process.argv.includes('--skip-kream');   // 2026-11-07: 크림 덤프 단계 생략(기존 k50.json·chart.json 재사용)
const MAXP = Number((process.argv.find((a) => a.startsWith('--max-prod=')) || '--max-prod=3').split('=')[1]);
const tools = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const P = (f) => path.join(dir, f); const rd = (f) => JSON.parse(fs.readFileSync(P(f), 'utf-8'));
const wr = (f, o) => fs.writeFileSync(P(f), JSON.stringify(o, null, 1), 'utf-8');
const log = (m) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (script, ...args) => { const r = spawnSync(process.execPath, [path.join(tools, script), dir, ...args], { encoding: 'utf-8' }); if (r.status !== 0) throw new Error(`${script} 실패: ${r.stderr.slice(0, 300)}`); return r.stdout; };
const jobsFile = () => (fs.existsSync(P('jobs.json')) ? rd('jobs.json') : { jobs: [] });
const addJobs = (list) => { const j = jobsFile(); const have = new Set(j.jobs.map((x) => x.id)); const add = list.filter((x) => !have.has(x.id)); j.jobs.push(...add); wr('jobs.json', j); return add.map((x) => x.id); };
const report = { generated: {}, replayDiff: {} };
// ── 2026-11-07: 실행 상태 기록(stage.json) — 감시자가 중단을 알아채고, 외부 원인이면 같은 명령으로 이어서 실행할 수 있게 ──
const NO_PRE = process.argv.includes('--no-preflight');
const { qualitySearch, qualityCatalog, qualityFacts, qualityFinal, qualityLines } = await import('./quality.mjs');
const runId = process.argv.find(a => a.startsWith('--run-id='))?.slice(9) || Date.now().toString(36); const resumeArgs = [path.resolve(dir), ...process.argv.slice(3).filter((a) => a !== '--replay' && !a.startsWith('--run-id='))];
const CLAUDE_EFFICIENT = process.argv.includes('--claude-efficient');
const EFFICIENT_AI = CLAUDE_EFFICIENT || process.argv.includes('--codex-efficient');
const teamOptions = {runId,replay:REPLAY,roleAi:USE_TEAM_AI,efficientAi:EFFICIENT_AI,
  ...(CLAUDE_EFFICIENT ? {roleProvider:invokeClaude,modelForRole:claudeModelForRole,providerId:'claude'} : {}),
  onRole:e => log(`agent ${e.role}: ${e.status}${e.call ? ' #'+e.call : ''}`)};
const prepare = () => USE_TEAM_AI ? prepareAgentTeam(dir,teamOptions) : prepareAgents(dir,{runId});
let curStage = '시작';
const setStage = (stage, status = 'running', extra = {}) => { curStage = stage; if (REPLAY) return; wr('stage.json', { runId, pid: process.pid, stage, status, at: new Date().toISOString(), args: resumeArgs, resume: `node kream-tools/run-all.mjs ${resumeArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`, ...extra }); };
let lastErr = null; process.on('uncaughtExceptionMonitor', (e) => { lastErr = e; });
process.on('exit', (code) => {
  if (REPLAY) return;
  try { const s = rd('stage.json'); if (s.runId !== runId) return;
    if (s.status !== 'running') { if (code !== 0 && s.status === 'failed') recordIncident(dir, s.error || `종료 코드 ${code}`, s.stage); return; }
    s.status = code === 0 ? 'done' : 'failed'; s.at = new Date().toISOString();
    if (code !== 0) { s.error = String((lastErr && (lastErr.message || lastErr)) || `종료 코드 ${code}`).split('\n')[0].slice(0, 300); console.log(`[${new Date().toTimeString().slice(0, 8)}] 파이프라인 중단: '${s.stage}' 단계, ${s.error}`); }
    fs.writeFileSync(P('stage.json'), JSON.stringify(s, null, 1));
    if (code !== 0) recordIncident(dir, s.error, s.stage); } catch {}
});
// 품질 점검: 경보는 로그에 남기고, 치명적(fail)이면 다음 단계로 가지 않고 멈춘다(사이트 방문 낭비 방지)
const qcheck = (fn, canStop = false) => { const q = fn(dir); for (const l of qualityLines(q)) log(l); if (canStop && q.level === 'fail') { const message = '품질경보: ' + q.issues.map((i) => i.msg).join(' / '); setStage(curStage, 'failed', { error: message }); recordIncident(dir, message, curStage); process.exit(1); } return q; };

// 덤프 대기: 전부 도착 / STOP / 정체(180초) 중 하나로 끝난다. 재생 모드면 파일 존재만 확인.
// 2026-11-08: 시간당 상한(240페이지)으로 릴레이가 쉬는 동안은 정체로 보지 않는다(상한 대기 중 3분 정체로 멈추던 문제)
const relayHealth = async () => { try { const r = await fetch('http://127.0.0.1:8787/health', { signal: AbortSignal.timeout(3000) }); return r.ok ? await r.json() : null; } catch { return null; } };
async function waitDumps(ids, label) {
  const missing = () => ids.filter((id) => !fs.existsSync(P(`dump-${id}.json`)));
  if (REPLAY) { const m = missing(); log(`${label}: 재생 — 덤프 ${ids.length - m.length}/${ids.length}` + (m.length ? ` (없음: ${m.slice(0, 5).join(',')}${m.length > 5 ? '…' : ''})` : '')); return; }
  let last = -1, stall = 0;
  while (true) {
    if (fs.existsSync(P('STOP')) || (process.env.CREAM_RELAY_SERVICE_DIR && fs.existsSync(path.join(process.env.CREAM_RELAY_SERVICE_DIR,'STOP')))) throw new Error(`${label}: STOP(차단 화면) 감지 — 중단`);
    const m = missing(); if (!m.length) { log(`${label}: 덤프 완료 ${ids.length}/${ids.length}`); return; }
    const n = ids.length - m.length; if (n === last) { if (++stall >= 36) { const h = await relayHealth(); const nearCap = (() => { try { const t = Date.now() - 3600000; return fs.readdirSync(dir).filter((f) => f.startsWith('dump-') && fs.statSync(P(f)).mtimeMs > t).length >= 230; } catch { return false; } })(); if ((h && h.capped) || nearCap) { stall = 24; log(`${label}: 시간당 상한 대기 중 (${n}/${ids.length}), 자동으로 이어감`); } else throw new Error(`${label}: 180초 정체 (${n}/${ids.length}) — 확장이 꺼졌거나 작업이 멈춤`); } } else { stall = 0; last = n; log(`${label}: ${n}/${ids.length}`); }
    await sleep(5000);
  }
}
const TRUST = /롯데ON|롯데온|롯데홈쇼핑|롯데아이몰|롯데백화점|현대Hmall|현대백화점|더현대|신세계|SSG|머스트잇|MUSTIT|더블유컨셉|W컨셉|무신사|29CM|트렌비|LFmall|CJ온스타일|GS\s?SHOP|GSSHOP|SK스토아|KT알파|11번가|10x10|텐바이텐/i;

// ── 0. 전제 ──
setStage('입력 확인');
if (!fs.existsSync(P('k50-ids.json'))) throw new Error('k50-ids.json 없음: 크림 상품 ID 목록을 먼저 만드세요(목록 수집 단계)');
setStage('사전 점검');
// 실행 전 점검: 코드 시험(가짜 데이터로 전체 흐름 재생)·릴레이 폴더·환경. 실패하면 사이트에 접속하기 전에 멈춘다(무시: --no-preflight)
if (!REPLAY && !NO_PRE) {
  const pf = spawnSync(process.execPath, [path.join(tools, 'preflight.mjs'), process.env.CREAM_RELAY_SERVICE_DIR || dir, '--need-relay',...(process.env.CREAM_RELAY_SERVICE_DIR ? ['--verified-legacy-relay'] : [])], { encoding: 'utf-8' });
  process.stdout.write(pf.stdout || ''); if (pf.status !== 0) { setStage('사전 점검', 'failed', { error: '사전 점검 실패: ' + ((pf.stdout || '').split('\n').filter((l) => /^\[실패\]/.test(l)).join(' / ') || pf.stderr || '').slice(0, 300) }); log('사전 점검 실패로 실행하지 않음(문제를 고치거나, 알고 진행하려면 --no-preflight)'); process.exit(1); }
}
if (!REPLAY) { try { const r = await fetch('http://127.0.0.1:8787/jobs'); if (!r.ok) throw 0; } catch { throw new Error('릴레이(127.0.0.1:8787) 응답 없음: node kream-tools/relay-server.mjs <run-dir> 를 먼저 띄우세요'); } }
const ids = rd('k50-ids.json').map(String);

// ── 1. 크림 덤프 → k50.json ──
// 크림 상품 페이지: 거래 내역 창만 필요하므로 전체 스크롤 생략(noScroll), 대기 1.0s/1.8s (속도 3단계, 2026-11-06)
if (!SKIP_K) { setStage('크림 덤프'); report.generated.K = addJobs(ids.map((id) => ({ id: `K${id}`, url: `https://kream.co.kr/products/${id}`, actions: [{ wait: 1000 }, { click: '거래 내역 더보기', after: 1800 }, { noScroll: true }] })));
await waitDumps(ids.map((id) => `K${id}`), '크림');
for (const id of ids) {
  const dump = rd(`dump-K${id}.json`);
  if (new URL(dump.url).pathname === '/login') throw new Error(`KREAM_LOGIN_REQUIRED: 상품 ${id}가 로그인 화면으로 이동함. Chrome KREAM 로그인 후 새 덤프 수집 필요`);
}
log(run('parse-kream.mjs').split('\n')[0]); } else log('크림 단계 생략(--skip-kream): 기존 k50.json·chart.json 사용');
// 차트 게이트(2026-11-06): 네이버를 뒤지기 전에 크림 체결로 유동성·추세를 먼저 본다. 저유동·하락·데이터부족은 여기서 끝(네이버 페이지 절약). 전체 결과는 k50-all.json 에 남김.
const { analyze: chartAnalyze, readTrades: chartTrades } = await import('./chart-analyze.mjs');
const { parsePoints } = await import('./code-match.mjs');   // 2026-11-07: 최대 적립 포인트 추출(엑셀 별도 열)
const k50all = rd('k50.json'); const chart = SKIP_K && fs.existsSync(P('chart.json')) ? rd('chart.json') : {}; const skipped = {};
// 2026-11-07: 하락 추세는 더 이상 건너뛰지 않음(엑셀에 ⚠하락추세 특별표시). 데이터 부족(보류)만 건너뜀.
if (!SKIP_K) for (const p of k50all) { const f = P(`dump-K${p.id}.json`); const ch = fs.existsSync(f) ? chartAnalyze(chartTrades(f).sort((a, b) => b.date - a.date)) : { 분류: '데이터 부족', 판단: '보류', 점수: 2, 근거: ['덤프 없음'], 지표: {} }; chart[String(p.id)] = ch; if (ch.판단 === '보류') skipped[ch.분류] = (skipped[ch.분류] || 0) + 1; }
if (!SKIP_K) wr('chart.json', chart); wr('k50-all.json', k50all);
const k50 = k50all; wr('k50.json', k50);   // 2026-11-07: 차트 기반 사전 필터 제거(모든 상품 네이버 서칭)
log(`차트 게이트: ${k50all.length}개 중 ${k50.length}개 통과, 건너뜀 ${JSON.stringify(skipped)} (네이버 검색 생략)`);

// ── 2. 네이버 검색 → n-cards.json → 마진 가능 선별 ──
// Retired API flags use the normal page workflow; offline replay stays offline.
const API_REQUESTED = process.argv.includes('--naver-api');
const SEARCH_MODE = naverSearchMode({ apiRequested: API_REQUESTED, replay: REPLAY });
let sIds = []; let before = new Set(); let cards;
setStage('네이버 검색');
if (SEARCH_MODE === 'saved-api-cards') { cards = rd('n-cards.json'); report.generated.search = []; log('네이버 API 재생: 저장된 n-cards.json 사용(외부 호출 없음)'); }
else {
  if (API_REQUESTED && !REPLAY) log(NAVER_SHOPPING_RETIREMENT.message);
  report.searchSource = { mode: 'page', retiredApiFlag: API_REQUESTED, notice: NAVER_SHOPPING_RETIREMENT.notice };
  before = new Set(jobsFile().jobs.map((x) => x.id)); log(run('make-n-jobs.mjs').split('\n')[0]);
  report.generated.search = jobsFile().jobs.map((x) => x.id).filter((id) => !before.has(id));
  sIds = jobsFile().jobs.map((x) => x.id).filter((id) => /^N\d+-s$/.test(id)); await waitDumps(sIds, '네이버 검색');
  run('parse-si.mjs', 'N', 'k50.json', 'n-cards.json'); cards = rd('n-cards.json');
}
qcheck(qualitySearch, true);
const marginScreen = screenInitialMargins(context(dir));
const margin = marginScreen.shortlist;
wr('margin-screen.json', marginScreen);
wr('margin-1st.json', margin); log(`1차 선별: 옵션 마진 가능 ${marginScreen.summary.potential}개 / 근거 추가 확인 ${marginScreen.summary.needs_verification}개 / 상세 탐색 가능 ${margin.length}개`);

// ── 3. 카탈로그 → n-cat.json ──
setStage('카탈로그'); const plannedCatalogs = planMarginCatalogs(marginScreen); report.generated.cat = addJobs(plannedCatalogs);
const catIds = jobsFile().jobs.map((x) => x.id).filter((id) => /-cat$/.test(id)); await waitDumps(catIds, '카탈로그');
run('parse-si-cat.mjs', 'N', 'k50.json', 'n-cat.json'); const cat = rd('n-cat.json'); qcheck(qualityCatalog);

// ── 4. 판매처 상품 페이지 → facts.json ──
// 카탈로그·단일 매물 모두 옵션별 선별 결과를 사용한다. 신뢰 판매처 우선,
// 추가 확인 대상도 탐색하되 참고 판매처는 기존 --max-prod 한도를 유지한다.
setStage('판매처 페이지');
// Reuse the option-aware screen; a mixed-size median must not reject it again.
const pageContext = context(dir);
const prod = planMarginPages(pageContext, screenInitialMargins(pageContext), { trustedMall: (mall) => TRUST.test(mall), maxReferencePages: MAXP });
report.generated.prod = addJobs(prod); report.prodWhy = Object.fromEntries(prod.map((p) => [p.id, p.why]));
await waitDumps(prod.map((p) => p.id), '판매처 페이지');
const facts = {};
for (const p of prod) {
  const f = P(`dump-${p.id}.json`); if (!fs.existsSync(f)) { facts[p.id] = { status: '확인 불가: 덤프 없음' }; continue; }
  const d = JSON.parse(fs.readFileSync(f, 'utf-8')); const t = (d.text || '').replace(/\r/g, ''); const g = (re) => { const m = t.match(re); return m ? m[1].trim().slice(0, 60) : null; };
  const probed = stockSummary(d);
  // 재고 문구: 해당 줄 + 앞 2줄을 묶는다 (LFmall처럼 "XXL (110 around)" 와 "1개 남음" 이 다른 줄에 있는 경우 사이즈를 같이 잡기 위해)
  const lines = t.split('\n').map((s) => s.trim()); const stock = [];
  for (let i = 0; i < lines.length && stock.length < 10; i++) if (/품절|남은수량|\d+개 남음|매진|재입고 알림/.test(lines[i])) stock.push(lines.slice(Math.max(0, i - 2), i + 1).filter(Boolean).join(' / ').replace(/\s+/g, ' ').slice(0, 120));
  facts[p.id] = { url: d.url, title: d.title, blocked: !!d.blocked, isProductPage: !/recommend|추천/i.test(d.url) && !/고객님이 방금 본 상품/.test(t.slice(0, 2500)),
    상호명: g(/(?:상호명|상호|업체명|회사명|법인명)\s*[:：\t]?\s*\n?\s*([^\n]{2,60})/) || '확인 불가', 대표자: g(/(?:대표자명|대표자|대표이사)\s*[:：\t]?\s*\n?\s*([^\n]{2,40})/) || '확인 불가',
    사업자등록번호: g(/사업자\s*(?:등록)?\s*번호\s*[:：\t]?\s*\n?\s*([\d-]{10,13})/) || '확인 불가', 통신판매: g(/통신판매(?:업)?\s*(?:신고)?\s*(?:번호)?\s*[:：\t]?\s*\n?\s*([^\n]{4,40})/) || '확인 불가',
    조건부가격: /혜택가|첫 구매|쿠폰 적용|쿠폰할인가/.test(t) ? '있음(쿠폰·회원 조건 문구 존재) → 결제가 확인 필요' : '없음', 입점판매: /입점|위탁판매|마켓플레이스|통신판매중개/.test(t) ? '입점·위탁 판매 문구 있음' : '미확인',
    stockProbe: d.stockProbe || null, 재고확인: probed.text || stock.join(' · ') || '확인 불가: 재고 표시 문구 없음',
    재고문구: stock.length ? stock : ['확인 불가: 재고 표시 문구 없음'], 적립포인트_raw: (() => { const pp = parsePoints(t, 0); return { ratio: pp.ratio, won_absolute: pp.ratio ? null : pp.won, raw: pp.raw }; })(), why: p.why };
}
wr('facts.json', facts); log(`판매처 사실 추출 ${Object.keys(facts).length}건 → facts.json`); qcheck(qualityFacts);

// Agents 2/5 verify each seller+option; agent 3 only adds the next seller after failure.
// Hashed jobs still end in -prod so the existing extension's guarded probing applies.
setStage('구매조건·판매자 검증·대체 판매처');
let prepared = await prepare();
for (let round = 0; round <= prepared.ctx.policy.maxFallback && prepared.fallback.jobs.length; round++) {
  if (fs.existsSync(P('STOP'))) throw new Error('대체 판매처: STOP 감지 — 중단');
  const next = prepared.fallback.jobs;
  if (REPLAY) { log(`대체 판매처: 재생에서 새 접속 생략, 대기 작업 ${next.length}건(fallback-results.json)`); break; }
  const added = addJobs(next); log(`대체 판매처 ${round + 1}차: ${next.length}건(신규 ${added.length})`);
  await waitDumps(next.map((j) => j.id), '대체 판매처');
  prepared = await prepare();
}

// ── 5. 최종 판정·엑셀 ──
setStage('판정·엑셀'); const fin = run('build-final-auto.mjs').split('\n'); log(fin.slice(0, 3).join(' | '));
setStage('최종 감사·성과 기록');
const audited = await runAgents(dir, { ...teamOptions, legacy: rd('final-all.json') });
log(`에이전트 감사: 후보 ${audited.final.rows.filter((r) => r['판정'] === '후보').length} / 사람 검토 ${audited.final.rows.filter((r) => r['판정'] === '사람 검토').length}`);
setStage('엑셀 출력');
const py = spawnSync('python', ['-I', path.join(tools, 'export-xlsx.py'), P('final-all.json'), P(`kream-auto-${path.basename(dir)}.xlsx`)], { encoding: 'utf-8' });
if (py.status !== 0) throw new Error(`export-xlsx.py 실패: ${String(py.stderr || py.error || 'Python 실행 실패').slice(0, 300)}`);
log(py.stdout.trim());
qcheck(qualityFinal);
if (USE_TEAM_AI && !REPLAY && !audited.final.meta.에이전트팀.complete) throw new Error('필수 6개 에이전트 AI 검토 미완료: agents-team-ai.json 확인');
setStage('완료', 'done', { summary: `감사 후 ${audited.final.rows.length}행, 후보 ${audited.final.rows.filter((r) => r['판정'] === '후보').length}행, 사람 검토 ${audited.final.rows.filter((r) => r['판정'] === '사람 검토').length}행` });
recordIncident(dir, null, '완료');

// ── 재생 모드: 오늘 손으로 만든 작업 목록과 대조 ──
if (REPLAY) {
  const existing = new Set(before); const gen = { K: ids.map((i) => `K${i}`), search: report.generated.search.length ? report.generated.search : sIds, cat: plannedCatalogs.map((x) => x.id), prod: prod.map((p) => p.id) };
  for (const [k, list] of Object.entries(gen)) { const ex = [...existing].filter((id) => (k === 'K' ? /^K/ : k === 'search' ? /-s$/ : k === 'cat' ? /-cat$/ : /-prod$/).test(id)); const g = new Set(list);
    report.replayDiff[k] = { 생성: list.length, 기존: ex.length, 기존에없음: list.filter((x) => !existing.has(x)), 생성안됨: ex.filter((x) => !g.has(x)) }; }
  wr('run-all-replay-report.json', report); console.log('\n== 재생 대조 ==\n' + JSON.stringify(report.replayDiff, null, 1));
}
