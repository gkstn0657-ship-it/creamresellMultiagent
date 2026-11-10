// 에러 관리 감시자(watchdog) — 크림 파이프라인이 조용히 멈추거나 틀리는 것을 막는다.
// 사용: node kream-tools/watchdog.mjs <run-dir> [--fix] [--once] [--interval=15]
//   보통은 직접 켜지 말고 `node kream-tools/start-watch.mjs <run-dir>` 로 켠다(릴레이와 서로 지킴, 세션을 닫아도 계속 돎).
//   15초마다 확인: 릴레이(/health)·서비스 폴더·버전 / 확장 접속 / 덤프 정체 / STOP / 빈 덤프 / 로그 에러·품질경보 / 실행 스크립트 중단.
//   문제가 새로 생기거나 풀릴 때만 한 줄씩 출력하고 <run-dir>/watchdog.log 에 남긴다. 중요한 문제는 Windows 알림도 띄운다.
//   --fix: 안전한 것만 자동 복구
//     · 릴레이가 꺼졌거나 / 예전 버전이거나 / 다른 폴더를 서비스 중 → relay-server.mjs 만 끄고 이 폴더로 다시 띄움(1분에 1번까지)
//     · 실행 스크립트(run-all)가 외부 원인(덤프 정체·릴레이 연결 끊김)으로 죽음 → 같은 명령으로 이어서 실행(감시자 한 번 켤 때 최대 3번, 2분 간격)
//   자동으로 하지 않는 것: STOP(차단·캡차) 해제, 코드 에러로 죽은 실행 재시작, 확장·크롬 조작, relay-server.mjs 가 아닌 프로세스 종료.
//   --once: 한 번만 점검하고 끝냄(잠금 없음, 실행 전 점검·시험용)
//   동시에 하나만 돈다(kream-runs/watchdog.lock). 다른 폴더를 감시하는 감시자가 이미 있으면 서로 서버를 재시작하며 싸우지 않도록 시작하지 않는다.
import fs from 'node:fs'; import path from 'node:path';
import { TOOLS, ROOT, LOCK, RELAY_VERSION, launchDetached, alive, cmdline, portOwner, toast, readLock, sameDir } from './proc.mjs';
const args = process.argv.slice(2);
const runDir = path.resolve(args.find((a) => !a.startsWith('--')) || '.');
const FIX = args.includes('--fix'); const ONCE = args.includes('--once');
const INTERVAL = Number((args.find((a) => a.startsWith('--interval=')) || '=15').split('=')[1]) * 1000;
const RELAY = 'http://127.0.0.1:8787'; const LOG = path.join(runDir, 'watchdog.log'); const HEARTBEAT = path.join(runDir, 'watchdog.heartbeat');
const LIMIT = { extSilentSec: 150, stallSec: 300, progressSec: 300, fixGapSec: 60, toastGapSec: 600, resumeGapSec: 120, resumeMax: 3 };
const INFO_ONLY = new Set(['CAPPED']);   // 알림창을 띄우지 않는 문제
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toLocaleTimeString('ko-KR', { hour12: false });
const out = (kind, code, msg) => { const line = `[${now()}] ${kind} ${code} ${msg}`; console.log(line); try { fs.appendFileSync(LOG, line + '\n'); } catch {} };

// ── 동시 실행 방지 잠금 ──
if (!ONCE) {
  const l = readLock();
  if (l && l.pid !== process.pid && alive(l.pid) && /watchdog\.mjs/.test(cmdline(l.pid))) {
    if (sameDir(l.runDir, runDir)) { console.log(`이미 같은 폴더를 감시 중인 감시자가 있음(PID ${l.pid}). 종료`); process.exit(0); }
    console.log(`다른 폴더(${l.runDir})를 감시하는 감시자가 이미 실행 중(PID ${l.pid}). 두 감시자가 서로 서버를 재시작하며 싸우지 않도록 시작하지 않음. 먼저 node kream-tools/start-watch.mjs "${l.runDir}" --stop`);
    process.exit(2);
  }
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, runDir, started: new Date().toISOString() }));
  const release = () => { const x = readLock(); if (x && x.pid === process.pid) try { fs.unlinkSync(LOCK); } catch {} };
  process.on('exit', release); process.on('SIGINT', () => process.exit(0)); process.on('SIGTERM', () => process.exit(0));
}

// ── 문제 상태: 같은 문제는 한 번만 알리고, 풀리면 '해결'로 알린다 ──
const open = new Map(); const lastToast = {};
const raise = (code, msg) => {
  if (!open.has(code)) {
    out('문제', code, msg);
    if (!ONCE && !INFO_ONLY.has(code) && Date.now() - (lastToast[code] || 0) > LIMIT.toastGapSec * 1000) { lastToast[code] = Date.now(); toast(`크림 수집 문제: ${code}`, msg); }
  }
  open.set(code, msg);
};
const clear = (code) => { if (open.has(code)) { open.delete(code); out('해결', code, '정상으로 돌아옴'); } };

async function health() {
  try { const r = await fetch(RELAY + '/health', { signal: AbortSignal.timeout(3000) }); if (r.status === 404) return { outdated: true }; const h = await r.json(); if ((h.version || 1) < RELAY_VERSION) h.outdated = true; return h; } catch { return null; }
}
let lastFix = 0;
async function fixRelay(reason) {
  if (!FIX || ONCE || Date.now() - lastFix < LIMIT.fixGapSec * 1000) return; lastFix = Date.now();
  const pid = portOwner();
  if (pid) {
    const cl = cmdline(pid);
    if (!/relay-server\.mjs/.test(cl)) { raise('PORT_TAKEN', `8787 포트를 릴레이가 아닌 프로세스가 사용 중(PID ${pid}: ${cl.slice(0, 120)}). 자동으로 끄지 않음`); return; }
    try { process.kill(pid); } catch {}
    await sleep(1200);
  }
  launchDetached('relay', [path.join(TOOLS, 'relay-server.mjs'), runDir], ROOT, path.join(runDir, 'relay.log'));
  await sleep(2500);
  const h = await health();
  if (h && !h.outdated && sameDir(h.dir, runDir)) out('복구', 'RELAY_RESTART', `${reason} → 릴레이를 이 폴더로 다시 띄움(PID ${h.pid}): ${runDir}`);
  else out('문제', 'RELAY_RESTART_FAIL', `${reason} → 릴레이 재시작 실패. relay.log 확인 필요`);
}

// ── 로그의 새 줄만 읽기(처음엔 기존 내용 건너뜀) ──
const pos = {};
function newLines(file) {
  try {
    const st = fs.statSync(file); if (pos[file] === undefined) { pos[file] = st.size; return []; }
    if (st.size < pos[file]) pos[file] = 0; if (st.size === pos[file]) return [];
    const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(st.size - pos[file]); fs.readSync(fd, b, 0, b.length, pos[file]); fs.closeSync(fd); pos[file] = st.size;
    return b.toString('utf8').split(/\r?\n/).filter(Boolean);
  } catch { if (pos[file] === undefined) pos[file] = 0; return []; }
}
// ── 새 덤프 검사: 차단 화면, 빈 덤프 ──
const seenDump = new Set(fs.existsSync(runDir) ? fs.readdirSync(runDir).filter((f) => f.startsWith('dump-')) : []);
function checkNewDumps() {
  for (const f of fs.readdirSync(runDir).filter((x) => x.startsWith('dump-') && !seenDump.has(x))) {
    seenDump.add(f);
    try { const d = JSON.parse(fs.readFileSync(path.join(runDir, f), 'utf8'));
      if (d.blocked) out('문제', 'BLOCKED_DUMP', `${f}: 차단·캡차 화면으로 저장됨`);
      else if (!d.text || d.text.length < 200) out('경고', 'EMPTY_DUMP', `${f}: 화면 글자 ${d.text ? d.text.length : 0}자. 페이지 로딩 실패 의심`);
    } catch { out('경고', 'BAD_DUMP', `${f}: JSON 을 읽지 못함`); }
  }
}
// ── 실행 스크립트(run-all) 상태: stage.json ──
const EXTERNAL = /정체|릴레이|ECONNREFUSED|ECONNRESET|fetch failed/;   // 이어서 실행하면 풀릴 수 있는 외부 원인
const CODE_ERR = /ReferenceError|TypeError|SyntaxError|RangeError|is not defined|Cannot read/;
let resumes = 0, lastResume = 0; const doneSeen = new Set(); const WD_STARTED = Date.now();
function checkStage() {
  const f = path.join(runDir, 'stage.json'); let s; try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return; }
  if (s.status === 'running' && !alive(s.pid)) s = { ...s, status: 'failed', error: s.error || '실행 스크립트 프로세스가 사라짐(강제 종료 의심)' };
  if (s.status === 'failed') {
    const err = String(s.error || '원인 미상');
    raise('PIPELINE_DOWN', `실행 스크립트가 '${s.stage}' 단계에서 멈춤: ${err.slice(0, 160)}. 이어서 실행: ${s.resume}`);
    const canResume = FIX && !ONCE && EXTERNAL.test(err) && !CODE_ERR.test(err) && !/STOP|품질경보/.test(err) && resumes < LIMIT.resumeMax && Date.now() - lastResume > LIMIT.resumeGapSec * 1000;
    if (canResume && Array.isArray(s.args)) {
      resumes++; lastResume = Date.now();
      launchDetached('run-all', [path.join(TOOLS, 'run-all.mjs'), ...s.args], ROOT, path.join(runDir, 'run-all.log'));
      out('복구', 'PIPELINE_RESUME', `외부 원인으로 멈춘 실행을 이어서 시작(${resumes}/${LIMIT.resumeMax}번째)`);
    }
  } else clear('PIPELINE_DOWN');
  // 감시자를 다시 켤 때 예전 완료를 또 알리지 않음
  if (s.status === 'done' && !doneSeen.has(s.runId) && new Date(s.at).getTime() > WD_STARTED - 60000) { doneSeen.add(s.runId); out('진행', 'PIPELINE_DONE', `전체 실행 완료. ${s.summary || ''}`); if (!ONCE) toast('크림 수집 완료', s.summary || runDir); }
}

let lastProgress = 0, lastDone = -1;
async function tick() {
  if (!ONCE) try { fs.writeFileSync(HEARTBEAT, String(Date.now())); } catch {}
  const h = await health();
  if (!h) { raise('RELAY_DOWN', '릴레이(127.0.0.1:8787)가 응답하지 않음'); await fixRelay('릴레이 응답 없음'); checkStage(); return; }
  clear('RELAY_DOWN'); clear('PORT_TAKEN');
  if (h.outdated) { raise('RELAY_OUTDATED', '릴레이가 예전 버전으로 실행 중'); await fixRelay('예전 버전'); return; }
  clear('RELAY_OUTDATED');
  if (!sameDir(h.dir, runDir)) { raise('RELAY_WRONG_DIR', `릴레이가 다른 폴더를 서비스 중: ${h.dir} (기대: ${runDir}). 확장이 엉뚱한 작업을 받는 상태`); await fixRelay('다른 폴더 서비스'); return; }
  clear('RELAY_WRONG_DIR');

  if (h.stop) raise('STOPPED', 'STOP 파일 있음: 차단·캡차 감지로 수집이 멈춤. 시간을 두고 사람이 확인한 뒤 /resume 하세요(자동 해제 안 함)'); else clear('STOPPED');
  // 시간당 상한은 최근 1시간 덤프 수로 정해지는 이동 창이라 경계(230건 이상)에선 서버가 작업을 거의 안 내준다. 이때도 상한으로 본다(정체 오판 방지)
  try { const hourAgo = Date.now() - 3600000; const n = fs.readdirSync(runDir).filter((f) => f.startsWith('dump-') && fs.statSync(path.join(runDir, f)).mtimeMs > hourAgo).length; if (n >= 230) h.capped = true; } catch {}
  if (h.capped) raise('CAPPED', '시간당 상한(240페이지)에 닿음: 오래된 페이지가 1시간을 넘기는 대로 자동으로 이어감'); else clear('CAPPED');
  if (h.pending > 0 && !h.stop) {
    const seen = [h.lastPollAgoSec, h.progressAgoSec, h.lastDumpAgoSec].filter((x) => x != null); const silent = seen.length ? Math.min(...seen, h.uptimeSec ?? Infinity) : (h.uptimeSec ?? 0);   // 확장은 작업 묶음을 처리하는 동안 /jobs 를 묻지 않으므로 진행 보고·덤프 저장도 접속으로 본다   // 릴레이 막 띄운 직후엔 접속 기록이 없으므로 가동 시간으로 판단(오판 방지)
    if (silent > LIMIT.extSilentSec) raise('EXT_SILENT', `확장이 ${silent}초째 접속하지 않음. 크롬 꺼짐, 확장 꺼짐, "자동 실행" 해제, 다른 폴더 확장 로드 여부 확인`); else clear('EXT_SILENT');
    const idle = Math.min(h.lastDumpAgoSec ?? Infinity, h.uptimeSec ?? Infinity);
    if (!open.has('EXT_SILENT') && !h.capped && idle > LIMIT.stallSec) raise('STALLED', `확장은 접속하는데 ${Math.round(idle / 60)}분째 새 덤프가 없음. 페이지 로딩 멈춤(창 가림 설정), 사이트 지연, 탭 오류 확인`); else clear('STALLED');
  } else { clear('EXT_SILENT'); clear('STALLED'); }

  checkNewDumps();
  for (const l of newLines(path.join(runDir, 'relay.log'))) if (/Error|EADDRINUSE|ECONNRESET|Unhandled/i.test(l)) out('문제', 'RELAY_LOG', l.slice(0, 200));
  for (const l of newLines(path.join(runDir, 'run-all.log'))) if (/Error|실패(?! 0)|정체|STOP|품질경보|중단/.test(l) && !/^\[통과\]/.test(l)) out(/품질경보\(주의\)/.test(l) ? '경고' : '문제', /품질경보/.test(l) ? 'QUALITY' : 'RUNALL_LOG', l.slice(0, 220));
  checkStage();

  const done = h.total - h.pending;
  if (h.total > 0 && h.pending === 0 && lastDone !== done) out('진행', 'QUEUE_EMPTY', `대기 작업 0건(${done}/${h.total} 완료). 현재 단계 끝`);
  else if (Date.now() - lastProgress > LIMIT.progressSec * 1000) { out('진행', 'PROGRESS', `${done}/${h.total} 완료, 남은 작업 ${h.pending}, 마지막 덤프 ${h.lastDumpAgoSec ?? '-'}초 전`); lastProgress = Date.now(); }
  lastDone = done;
}

out('시작', 'WATCHDOG', `감시 시작: ${runDir} (자동 복구 ${FIX ? '켬' : '끔'}${ONCE ? ', 1회 점검' : `, ${INTERVAL / 1000}초 간격`})`);
if (ONCE) { await tick(); process.exit(open.size ? 1 : 0); }
for (;;) { try { await tick(); } catch (e) { out('경고', 'WATCHDOG_ERR', String((e && e.message) || e).slice(0, 200)); } await sleep(INTERVAL); }
