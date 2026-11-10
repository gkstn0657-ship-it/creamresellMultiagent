import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RUNS = path.join(ROOT, 'kream-runs', 'automation');
const HOST = '127.0.0.1';
const PORT = Number(process.env.CREAM_DASHBOARD_PORT || 8765);
const readJson = file => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
};

export function dashboardData() {
  const state = readJson(path.join(RUNS, 'loop-state.json')) || {};
  const dir = state.dir && path.resolve(state.dir).startsWith(path.resolve(RUNS) + path.sep) ? state.dir : null;
  const manifest = dir ? readJson(path.join(dir, 'batches.json')) : null;
  const report = dir ? readJson(path.join(dir, 'automation-final.json')) : null;
  const batches = Array.isArray(manifest?.batches) ? manifest.batches : [];
  const reviews = dir ? fs.readdirSync(dir).filter(name => /^dot-screening-batch-\d+\.json$/.test(name))
    .map(name => readJson(path.join(dir, name))).filter(Boolean) : [];
  const summary = report?.summary || {};
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const done = batches.filter(batch => batch.status === 'done').length;
  const processed = batches.filter(batch => batch.status === 'done').reduce((n, batch) => n + batch.ids.length, 0);
  return {
    updatedAt: new Date().toISOString(),
    run: dir ? path.basename(dir) : null,
    status: state.status || 'unknown', phase: state.phase || null,
    currentBatch: state.batch || state.nextBatch || null,
    processed, target: manifest?.ids?.length || state.target || 0,
    batches: {done, total: batches.length, running: batches.filter(batch => batch.status === 'running').length,
      failed: batches.filter(batch => batch.status === 'failed').length,
      items: batches.map(batch => ({index: batch.index, status: batch.status}))},
    decisions: {candidate: summary.candidate || 0, hold: summary.hold || 0, excluded: summary.excluded || 0},
    no1Observations: summary.no1Observations || 0,
    dot: {batches: reviews.length, reviewed: reviews.reduce((n, review) => n + (review.summary?.reviewed || 0), 0),
      approved: reviews.reduce((n, review) => n + (review.summary?.approved || 0), 0)},
    recent: rows.slice(-12).reverse().map(row => ({id: row.kreamId, model: row.model, size: row.size,
      status: row.status, reason: (row.reasons || []).join(' · '), batch: row.batch})),
    error: state.error || null,
  };
}

const page = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cream · 소싱 진행판</title><style>
:root{color-scheme:dark;--bg:#090e18;--panel:#111b2a;--line:#24354a;--text:#edf5ff;--muted:#91a6bf;--mint:#56e6bd;--blue:#7ba9ff;--amber:#ffca76;--red:#ff8190}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% -10%,#173544 0,transparent 35%),radial-gradient(circle at 90% 10%,#1e274a 0,transparent 32%),var(--bg);color:var(--text);font:15px/1.5 system-ui,'Malgun Gothic',sans-serif}
.wrap{max-width:1320px;margin:auto;padding:28px}.top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.brand{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--mint);font-weight:800}.title{font-size:clamp(28px,4vw,46px);line-height:1.15;letter-spacing:-.04em;margin:8px 0}.sub,.muted{color:var(--muted)}.live{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:999px;padding:9px 14px;background:#102033;white-space:nowrap}.dot{width:8px;height:8px;border-radius:50%;background:var(--mint);box-shadow:0 0 12px var(--mint)}.dot.warn{background:var(--amber);box-shadow:0 0 12px var(--amber)}
.hero{display:grid;grid-template-columns:1.4fr .8fr;gap:18px;margin:28px 0}.panel,.card{background:linear-gradient(145deg,#142238,#101927);border:1px solid var(--line);border-radius:20px;box-shadow:0 16px 40px #0002}.panel{padding:25px}.eyebrow{color:var(--muted);font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:800}.big{font-size:clamp(42px,6vw,72px);font-weight:800;letter-spacing:-.06em;line-height:1.1;margin:8px 0}.big span{font-size:.42em;color:var(--muted);letter-spacing:0}.bar{height:13px;background:#26364a;border-radius:999px;overflow:hidden;margin:20px 0 9px}.fill{height:100%;width:0;background:linear-gradient(90deg,#41cda9,#8abaff);border-radius:inherit;transition:width .5s}.between{display:flex;justify-content:space-between;gap:12px}.phase{font-size:25px;font-weight:750;margin:12px 0 8px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{padding:18px}.card .num{font-size:32px;font-weight:800;letter-spacing:-.04em;margin-top:7px}.candidate .num{color:var(--mint)}.hold .num{color:var(--amber)}.excluded .num{color:var(--red)}.review .num{color:var(--blue)}
.section{margin-top:28px}.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:13px}.section h2{font-size:19px;margin:0}.batch-grid{display:grid;grid-template-columns:repeat(25,1fr);gap:5px}.batch{height:12px;border-radius:4px;background:#29374a}.batch.done{background:var(--mint)}.batch.running{background:var(--blue);box-shadow:0 0 10px #7ba9ff77}.batch.failed{background:var(--red)}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;min-width:680px}th,td{text-align:left;padding:12px 10px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:12px}td{font-size:13px}td.reason{max-width:440px;color:var(--muted)}.pill{display:inline-block;padding:3px 9px;border-radius:999px;background:#26364a;font-size:12px}.pill.excluded{color:var(--red)}.pill.hold{color:var(--amber)}.pill.candidate{color:var(--mint)}.foot{color:var(--muted);font-size:12px;margin:22px 0 5px}.error{color:var(--red)}@media(max-width:800px){.hero{grid-template-columns:1fr}.grid{grid-template-columns:repeat(2,1fr)}.batch-grid{grid-template-columns:repeat(20,1fr)}}@media(max-width:500px){.top{display:block}.live{width:max-content;margin-top:15px}.batch-grid{grid-template-columns:repeat(10,1fr)}.wrap{padding:18px}}
</style></head><body><main class="wrap"><header class="top"><div><div class="brand">Cream / Dot Commander</div><h1 class="title">상품 탐색 진행판</h1><div class="sub" id="run">현재 실행을 불러오는 중</div></div><div class="live"><span class="dot" id="liveDot"></span><span id="live">연결 중</span></div></header>
<div class="hero"><section class="panel"><div class="eyebrow">오늘 처리한 상품</div><div class="big"><span id="processed">0</span><span> / <span id="target">500</span></span></div><div class="bar"><div class="fill" id="fill"></div></div><div class="between muted"><span id="percent">0%</span><span id="batchProgress">배치 0 / 0</span></div></section><section class="panel"><div class="eyebrow">현재 단계</div><div class="phase" id="phase">확인 중</div><div class="muted" id="detail">상태를 불러오는 중입니다.</div><div class="foot" id="updated"></div></section></div>
<div class="grid"><div class="card candidate"><div class="eyebrow">후보</div><div class="num" id="candidate">0</div><div class="muted">검증 조건 통과</div></div><div class="card hold"><div class="eyebrow">보류</div><div class="num" id="hold">0</div><div class="muted">증빙 또는 재확인 필요</div></div><div class="card excluded"><div class="eyebrow">제외</div><div class="num" id="excluded">0</div><div class="muted">현재 기준 부적합</div></div><div class="card review"><div class="eyebrow">Dot 독립 검토</div><div class="num" id="reviewed">0</div><div class="muted" id="reviewDetail">검토 배치 0개</div></div></div>
<section class="section panel"><div class="section-head"><h2>배치 흐름</h2><span class="muted" id="batchNote"></span></div><div class="batch-grid" id="batches"></div><div class="foot">초록 완료 · 파랑 진행 · 빨강 실패 · 회색 대기</div></section>
<section class="section panel"><div class="section-head"><h2>최근 판정</h2><span class="muted">완료된 배치 기준</span></div><div class="table-wrap"><table><thead><tr><th>배치</th><th>KREAM ID</th><th>모델</th><th>사이즈</th><th>판정</th><th>사유</th></tr></thead><tbody id="rows"></tbody></table></div></section><div class="foot">10초마다 자동 갱신 · 후보는 구매 승인 의미가 아닙니다 · No1 동일 옵션 관측 <span id="no1">0</span>건</div></main>
<script>
const $=id=>document.getElementById(id), put=(id,value)=>{$(id).textContent=value??''};
const phaseNames={discovering:'상품 탐색',screening:'상품 검증', 'waiting-relay-cap':'수집 용량 대기'};
async function refresh(){try{const response=await fetch('/api/status',{cache:'no-store'});if(!response.ok)throw Error(response.status);const d=await response.json();const p=d.target?Math.min(100,Math.round(d.processed/d.target*100)):0;
put('run',d.run||'실행 기록 없음');put('processed',d.processed);put('target',d.target||0);put('percent',p+'% 완료');$('fill').style.width=p+'%';put('batchProgress','배치 '+d.batches.done+' / '+d.batches.total);
put('phase',phaseNames[d.phase]||({done:'완료',failed:'실패','under-target':'목표 미달'}[d.status]||'대기'));put('detail',d.error||((d.currentBatch?'현재 '+d.currentBatch+'번 배치 · ':'')+'완료 '+d.batches.done+'개 / 실패 '+d.batches.failed+'개'));
put('updated','조회 '+new Date(d.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}));put('candidate',d.decisions.candidate);put('hold',d.decisions.hold);put('excluded',d.decisions.excluded);
put('reviewed',d.dot.reviewed);put('reviewDetail','검토 배치 '+d.dot.batches+'개 · 승인 '+d.dot.approved+'건');put('no1',d.no1Observations);put('batchNote',d.batches.done+'/'+d.batches.total+' 완료');
const grid=$('batches');grid.replaceChildren();for(const b of d.batches.items){const cell=document.createElement('span');cell.className='batch '+b.status;cell.title=b.index+'번 배치 · '+b.status;grid.append(cell)}
const body=$('rows');body.replaceChildren();for(const r of d.recent){const tr=document.createElement('tr');for(const v of [r.batch,r.id,r.model,r.size]){const td=document.createElement('td');td.textContent=v??'';tr.append(td)}const td=document.createElement('td'),pill=document.createElement('span');pill.className='pill '+r.status;pill.textContent=({candidate:'후보',hold:'보류',excluded:'제외'})[r.status]||r.status;td.append(pill);tr.append(td);const reason=document.createElement('td');reason.className='reason';reason.textContent=r.reason;tr.append(reason);body.append(tr)}
put('live',d.status==='running'?'실행 중':'상태: '+d.status);$('liveDot').classList.toggle('warn',d.status!=='running');
}catch(e){put('live','연결 확인 필요');$('liveDot').classList.add('warn');put('detail',String(e))}}
refresh();setInterval(refresh,10000);
</script></body></html>`;

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/api/status') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      try { response.end(JSON.stringify(dashboardData())); }
      catch (error) { response.statusCode = 500; response.end(JSON.stringify({error: error.message})); }
    } else if (request.url === '/' || request.url === '/index.html') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(page);
    } else {response.statusCode = 404; response.end('Not found');}
  });
  server.listen(PORT, HOST, () => console.log(`Cream dashboard: http://${HOST}:${PORT}/`));
}
