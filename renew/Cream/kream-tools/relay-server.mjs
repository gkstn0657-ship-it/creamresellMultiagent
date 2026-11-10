// 릴레이 서버 (127.0.0.1:8787) — 크롬 확장/사이드패널 Claude <-> Claude Code 를 파일로 잇는다.
//  GET  /queue            검색할 상품 큐(queue.json)
//  GET  /jobs             아직 덤프가 없는 작업 목록 {jobs:[{id,url}], stop}  (jobs.json 기준)
//  POST /dump?id=X        페이지 덤프를 dump-X.json 으로 저장 (= 작업 완료 표시)
//  POST /stop             STOP 파일 생성 -> /jobs 가 stop:true 반환 (차단 화면 감지 시 확장이 호출)
//  POST /resume           STOP 파일 삭제
//  GET  /submit, POST /sellers?model=X   (사이드패널 Claude 제출용, 기존)
//  GET  /status           저장된 파일 목록
// 사용: node relay-server.mjs <run-dir>
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { stats, PAGE as DASH, live } from './dashboard.mjs';
import { TOOLS, ROOT, RELAY_VERSION, launchDetached } from './proc.mjs';   // 2026-11-07: 감시자와 서로 지킴   // 진행 대시보드 (/dashboard, /stats)
const dir = path.resolve(process.argv[2] || 'runs/relay'); fs.mkdirSync(dir, { recursive: true });
const safe = (s) => String(s || '').replace(/[^\w.\-]/g, '_').slice(0, 80);
const PAGE = `<!doctype html><meta charset=utf-8><title>제출</title>
<body style="font:14px sans-serif;max-width:720px;margin:20px auto"><h3>교차대조 결과 제출</h3>
<input id=m placeholder="모델번호" style="width:100%;padding:6px"><br><br>
<textarea id=j rows=16 style="width:100%" placeholder="JSON"></textarea><br>
<button id=b style="padding:8px 16px">저장</button> <span id=r></span>
<script>b.onclick=async()=>{try{JSON.parse(j.value)}catch(e){r.textContent='JSON 오류: '+e.message;return}
const x=await fetch('/sellers?model='+encodeURIComponent(m.value),{method:'POST',body:j.value});r.textContent=await x.text()}</script></body>`;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); } catch { return d; } };
const STARTED = Date.now();
// 감시자 지키기: start-watch.mjs 가 만든 watchdog.enabled 가 있으면, 감시자 생존 신호(watchdog.heartbeat)가 90초 넘게 없을 때 감시자를 다시 띄운다(2분에 1번까지)
let lastWdLaunch = 0;
setInterval(() => {
  try {
    if (!fs.existsSync(path.join(dir, 'watchdog.enabled'))) return;
    let hb = 0; try { hb = Number(fs.readFileSync(path.join(dir, 'watchdog.heartbeat'), 'utf8')); } catch {}
    const age = Date.now() - hb;
    if (age > 90000 && Date.now() - lastWdLaunch > 120000 && Date.now() - STARTED > 30000) {
      lastWdLaunch = Date.now(); launchDetached('watchdog', [path.join(TOOLS, 'watchdog.mjs'), dir, '--fix'], ROOT, path.join(dir, 'watchdog.out.log'));
      console.log(new Date().toISOString().slice(11, 19), `감시자 다시 띄움(생존 신호 ${hb ? Math.round(age / 1000) + '초' : '없음'})`);
    }
  } catch {}
}, 60000);
// /health: 감시자(watchdog.mjs)용 상태. 확장 폴링 시각(live.lastPoll)을 건드리지 않는다.
function health() {
  const all = readJson('jobs.json', { jobs: [] }).jobs || []; const files = fs.readdirSync(dir).filter((f) => f.startsWith('dump-')); const have = new Set(files);
  const pending = all.filter((j) => !have.has(`dump-${safe(j.id)}.json`)).length;
  const mt = files.map((f) => fs.statSync(path.join(dir, f)).mtimeMs); const last = mt.length ? Math.max(...mt) : 0; const lastHour = mt.filter((t) => Date.now() - t < 3600000).length;
  const ago = (t) => (t ? Math.round((Date.now() - t) / 1000) : null);
  const hb = (() => { try { return Number(fs.readFileSync(path.join(dir, 'watchdog.heartbeat'), 'utf8')); } catch { return 0; } })();
  return { ok: true, version: RELAY_VERSION, pid: process.pid, dir, watchdogAgoSec: ago(hb), watchdogEnabled: fs.existsSync(path.join(dir, 'watchdog.enabled')), total: all.length, pending, dumps: files.length, lastDumpAgoSec: ago(last), lastPollAgoSec: ago(live.lastPoll), progressAgoSec: ago(live.progress && live.progress.at), uptimeSec: ago(STARTED), stop: fs.existsSync(path.join(dir, 'STOP')), capped: lastHour >= 240 };
}
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1:8787');
  const send = (code, body, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); res.end(body); };
  if (req.method === 'OPTIONS') return send(204, '');
  if (req.method === 'GET' && u.pathname === '/health') { try { return send(200, JSON.stringify(health()), 'application/json; charset=utf-8'); } catch (e) { return send(500, String(e)); } }
  if (req.method === 'GET' && u.pathname === '/dashboard') return send(200, DASH, 'text/html; charset=utf-8');
  if (req.method === 'GET' && u.pathname === '/stats') { try { return send(200, JSON.stringify(stats(dir)), 'application/json; charset=utf-8'); } catch (e) { return send(500, String(e)); } }
  if (req.method === 'GET' && u.pathname === '/submit') return send(200, PAGE, 'text/html; charset=utf-8');
  if (req.method === 'GET' && u.pathname === '/queue') { const f = path.join(dir, 'queue.json'); return fs.existsSync(f) ? send(200, fs.readFileSync(f), 'application/json; charset=utf-8') : send(404, 'queue.json 없음'); }
  if (req.method === 'GET' && u.pathname === '/jobs') {
    const all = readJson('jobs.json', { jobs: [] }).jobs || [];
    // IP 제한 방지: 한 번에 1건, 직전 덤프로부터 MIN_GAP_MS 경과 후에만 내준다 (분당 최대 1페이지 수준)
    // 속도 2단계(2026-11-06): 크림·판매처 페이지는 10초 간격·6건/회·시간당 200. 네이버(검색 N*-s, 카탈로그 N*-cat)는 어제 접속 제한 이력이 있어 20초 간격·2건/회 유지.
    const MIN_GAP_MS = 6000, NAVER_GAP_MS = 6000, PER_POLL = 8, NAVER_PER_POLL = 1, HOURLY_CAP = 240;
    const isNaver = (j) => /^N\d+-(s2?|cat)$/.test(j.id);
    const pending = all.filter((j) => !fs.existsSync(path.join(dir, `dump-${safe(j.id)}.json`)));
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('dump-')).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }));
    const mt = files.map((x) => x.t); const last = Math.max(0, ...mt); const lastHour = mt.filter((t) => Date.now() - t < 3600000).length;
    const lastNaver = Math.max(0, ...files.filter((x) => /^dump-N\d+-(s2?|cat)\.json$/.test(x.f)).map((x) => x.t));
    let ready = Date.now() - last >= MIN_GAP_MS && lastHour < HOURLY_CAP;
    const batch = []; let nv = 0;
    for (const j of pending) { if (batch.length >= Math.min(PER_POLL, HOURLY_CAP - lastHour)) break; if (isNaver(j)) { if (nv >= NAVER_PER_POLL || Date.now() - lastNaver < NAVER_GAP_MS) break; nv++; } batch.push(j); }
    live.lastPoll = Date.now(); live.lastBatch = ready ? batch.length : 0; if (ready && batch.length) live.lastJobs = batch.map((j) => j.id); console.log(new Date().toISOString().slice(11,19), '/jobs ->', live.lastBatch, 'ready=' + ready);
    return send(200, JSON.stringify({ stop: fs.existsSync(path.join(dir, 'STOP')), capped: lastHour >= HOURLY_CAP, jobs: ready ? batch : [] }), 'application/json; charset=utf-8');
  }
  if (req.method === 'GET' && u.pathname === '/status') return send(200, JSON.stringify(fs.readdirSync(dir), null, 1), 'application/json');
  if (req.method === 'POST' && u.pathname === '/progress') { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { try { const o = JSON.parse(b); live.progress = { id: o.id || '', step: o.step || '', at: Date.now() }; } catch {} send(200, 'ok'); }); return; }
  if (req.method === 'POST' && u.pathname === '/stop') { fs.writeFileSync(path.join(dir, 'STOP'), new Date().toISOString()); return send(200, 'stopped'); }
  if (req.method === 'POST' && u.pathname === '/resume') { fs.rmSync(path.join(dir, 'STOP'), { force: true }); return send(200, 'resumed'); }
  if (req.method === 'POST' && (u.pathname === '/sellers' || u.pathname === '/dump')) {
    let b = ''; req.on('data', (c) => b += c); req.on('end', () => {
      try { JSON.parse(b); } catch { return send(400, 'JSON 오류'); }
      const name = u.pathname === '/dump' ? `dump-${safe(u.searchParams.get('id'))}.json` : `sellers-${safe(u.searchParams.get('model'))}.json`;
      fs.writeFileSync(path.join(dir, name), b); console.log(new Date().toISOString().slice(11,19), 'dump', name); send(200, '저장됨: ' + name);
    }); return;
  }
  if (req.method === 'POST' && u.pathname === '/record') {   // 탐색 기록기(확장) → record.jsonl 에 한 줄씩 추가. 로컬 파일에만 저장
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 8e6) req.destroy(); }); req.on('end', () => {
      try { const ev = JSON.parse(b); const arr = Array.isArray(ev) ? ev : [ev]; fs.appendFileSync(path.join(dir, 'record.jsonl'), arr.map((e) => JSON.stringify(e)).join('\n') + '\n'); console.log(new Date().toISOString().slice(11, 19), 'record +' + arr.length); send(200, 'ok'); } catch { send(400, 'JSON 오류'); }
    }); return;
  }
  send(404, 'not found');
}).listen(8787, '127.0.0.1', () => console.log('relay on http://127.0.0.1:8787 dir=' + dir));
