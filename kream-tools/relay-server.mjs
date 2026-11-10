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
const startedAt = Date.now(); let lastPollAt = 0, lastProgress = null;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1:8787');
  const send = (code, body, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); res.end(body); };
  if (req.method === 'OPTIONS') return send(204, '');
  if (req.method === 'GET' && u.pathname === '/health') {
    const all = readJson('jobs.json', { jobs: [] }).jobs || [];
    const dumps = fs.readdirSync(dir).filter(f => /^dump-.*\.json$/.test(f));
    const times = dumps.map(f => fs.statSync(path.join(dir, f)).mtimeMs);
    return send(200, JSON.stringify({ ok:true, pid:process.pid, dir, startedAt:new Date(startedAt).toISOString(),
      total:all.length, pending:all.filter(j => !fs.existsSync(path.join(dir, `dump-${safe(j.id)}.json`))).length,
      dumps:dumps.length, lastPollAt:lastPollAt ? new Date(lastPollAt).toISOString() : null,
      lastProgress, stop:fs.existsSync(path.join(dir,'STOP')), capped:times.filter(t => Date.now()-t < 3600000).length >= 150 }), 'application/json; charset=utf-8');
  }
  if (req.method === 'GET' && u.pathname === '/submit') return send(200, PAGE, 'text/html; charset=utf-8');
  if (req.method === 'GET' && u.pathname === '/queue') { const f = path.join(dir, 'queue.json'); return fs.existsSync(f) ? send(200, fs.readFileSync(f), 'application/json; charset=utf-8') : send(404, 'queue.json 없음'); }
  if (req.method === 'GET' && u.pathname === '/jobs') {
    lastPollAt = Date.now();
    const all = readJson('jobs.json', { jobs: [] }).jobs || [];
    // IP 제한 방지: 한 번에 1건, 직전 덤프로부터 MIN_GAP_MS 경과 후에만 내준다 (분당 최대 1페이지 수준)
    const MIN_GAP_MS = 15000, PER_POLL = 4, HOURLY_CAP = 150;
    const pending = all.filter((j) => !fs.existsSync(path.join(dir, `dump-${safe(j.id)}.json`)));
    const mt = fs.readdirSync(dir).filter((f) => f.startsWith('dump-')).map((f) => fs.statSync(path.join(dir, f)).mtimeMs);
    const last = Math.max(0, ...mt); const lastHour = mt.filter((t) => Date.now() - t < 3600000).length;
    const ready = Date.now() - last >= MIN_GAP_MS && lastHour < HOURLY_CAP;
    return send(200, JSON.stringify({ stop: fs.existsSync(path.join(dir, 'STOP')), capped: lastHour >= HOURLY_CAP, jobs: ready ? pending.slice(0, Math.min(PER_POLL, HOURLY_CAP - lastHour)) : [] }), 'application/json; charset=utf-8');
  }
  if (req.method === 'GET' && u.pathname === '/status') return send(200, JSON.stringify(fs.readdirSync(dir), null, 1), 'application/json');
  if (req.method === 'POST' && u.pathname === '/progress') {
    let b = ''; req.on('data', c => { b += c; if (b.length > 10000) req.destroy(); });
    req.on('end', () => { try { const p = JSON.parse(b); lastProgress = { id:String(p.id || '').slice(0,80), step:String(p.step || '').slice(0,160), at:new Date().toISOString() }; send(200,'ok'); } catch { send(400,'JSON 오류'); } }); return;
  }
  if (req.method === 'POST' && u.pathname === '/stop') { fs.writeFileSync(path.join(dir, 'STOP'), new Date().toISOString()); return send(200, 'stopped'); }
  if (req.method === 'POST' && u.pathname === '/resume') { fs.rmSync(path.join(dir, 'STOP'), { force: true }); return send(200, 'resumed'); }
  if (req.method === 'POST' && (u.pathname === '/sellers' || u.pathname === '/dump')) {
    let b = ''; req.on('data', (c) => b += c); req.on('end', () => {
      try { JSON.parse(b); } catch { return send(400, 'JSON 오류'); }
      const name = u.pathname === '/dump' ? `dump-${safe(u.searchParams.get('id'))}.json` : `sellers-${safe(u.searchParams.get('model'))}.json`;
      fs.writeFileSync(path.join(dir, name), b); send(200, '저장됨: ' + name);
    }); return;
  }
  send(404, 'not found');
}).listen(8787, '127.0.0.1', () => console.log('relay on http://127.0.0.1:8787 dir=' + dir));
