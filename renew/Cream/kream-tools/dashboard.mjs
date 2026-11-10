// 진행 대시보드: relay-server 가 /stats(JSON) 와 /dashboard(HTML) 로 노출한다. 실행 폴더의 파일만 읽는다(외부 전송 없음).
import fs from 'node:fs'; import path from 'node:path';
const cache = new Map();            // dump 파일별 품질 플래그 캐시 (mtime 기준)
export const live = { lastPoll: 0, lastBatch: 0, lastJobs: [], progress: null };   // relay 가 /jobs 호출 때 채움
const stage = (id) => /^K/.test(id) ? 'kream' : /^N\d+-s2?$/.test(id) ? 'nsearch' : /^N\d+-cat$/.test(id) ? 'ncat' : /^(P|N\d+-prod$)/.test(id) ? 'seller' : 'etc';
export function stats(dir) {
  const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); } catch { return d; } };
  const now = Date.now();
  const jobs = (rd('jobs.json', { jobs: [] }).jobs || []);
  const files = fs.readdirSync(dir).filter((f) => /^dump-.*\.json$/.test(f)).map((f) => ({ f, id: f.slice(5, -5), t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => a.t - b.t);
  const done = new Set(files.map((x) => x.id));
  const stages = {};
  for (const j of jobs) { const s = stage(j.id); stages[s] ??= { total: 0, done: 0 }; stages[s].total++; if (done.has(j.id)) stages[s].done++; }
  const ts = files.map((x) => x.t);
  const gaps = ts.slice(-21).map((t, i, a) => i ? Math.round((t - a[i - 1]) / 1000) : null).filter((x) => x !== null);
  const rate = (m) => ts.filter((t) => now - t < m * 60000).length;
  const lastHour = rate(60);
  // 품질: 거래창 못 연 덤프 / NOT FOUND / 차단
  const quality = { notFound: 0, blocked: 0, noModal: 0 };
  for (const x of files) {
    let q = cache.get(x.f); if (!q || q.t !== x.t) {
      q = { t: x.t, nf: false, bl: false, nm: false, title: '' };
      try { const d = JSON.parse(fs.readFileSync(path.join(dir, x.f), 'utf-8')); const al = (d.actionLog || []).join(' '); q.title = String(d.title || '').replace(/\s*(정품 안심 거래)?\s*(\|\s*KREAM.*)?$/, '').slice(0, 60);
        q.nf = /NOT FOUND/.test(al); q.bl = !!d.blocked; q.nm = x.id.startsWith('K') && !/체결 거래|거래 내역/.test(d.text || ''); } catch {}
      cache.set(x.f, q);
    }
    if (q.nf) quality.notFound++; if (q.bl) quality.blocked++; if (q.nm) quality.noModal++;
  }
  let log = []; try { log = fs.readFileSync(path.join(dir, 'run-all.log'), 'utf-8').trim().split(/\r?\n/).slice(-30); } catch {}
  const chart = rd('chart.json', null); const chartDist = {};
  if (chart) for (const c of Object.values(chart)) { const k = c.분류 || '?'; chartDist[k] = (chartDist[k] || 0) + 1; }
  const final = rd('final-all.json', null); let verdict = null;
  if (Array.isArray(final)) { verdict = {}; for (const r of final) { const k = r.판정 || '?'; verdict[k] = (verdict[k] || 0) + 1; } }
  // 상품별 플로우: 수집 → 차트 → 네이버 검색 → 카탈로그 → 판매처 → 판정 (id 규칙: K{pid}, N{pid}-s/-s2/-cat/-prod)
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  // 지금 작업: 확장의 단계 보고(id) > 마지막 전달 묶음 중 미완료 첫 건 > jobs.json 순서상 첫 미완료(확장은 순서대로 처리하므로 거의 같음)
  const pg = live.progress && live.progress.id && !done.has(live.progress.id) ? live.progress.id : null;
  const current = pg || (live.lastJobs || []).find((id) => !done.has(id)) || (jobs.find((j) => !done.has(j.id)) || {}).id || null;
  const k50all = rd('k50-all.json', null) || rd('k50.json', null) || []; const titleOf = new Map((Array.isArray(k50all) ? k50all : []).map((x) => [String(x.id), x.title]));
  const finalRows = Array.isArray(final && final.rows) ? final.rows : Array.isArray(final) ? final : []; const finalOf = new Map(finalRows.map((r) => [String(r['\\uD06C\\uB9BCID']), r['판정']]));
  const step = (id) => !jobById.has(id) ? null : done.has(id) ? 'done' : id === current ? 'now' : 'wait';   // null = 해당 없음
  const products = jobs.filter((j) => /^K\d+$/.test(j.id)).map((j) => { const pid = j.id.slice(1); const ch = chart && chart[pid];
    return { pid, title: titleOf.get(pid) || (cache.get(`dump-K${pid}.json`) || {}).title || '', current: [j.id, `N${pid}-s`, `N${pid}-s2`, `N${pid}-cat`, `N${pid}-prod`].includes(current),
      kream: step(j.id), chart: ch ? { 분류: ch.분류, 판단: ch.판단 } : null, search: step(`N${pid}-s`) || step(`N${pid}-s2`), cat: step(`N${pid}-cat`), prod: step(`N${pid}-prod`), final: finalOf.get(pid) || null }; });
  const xlsx = fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx'));
  const pending = jobs.filter((j) => !done.has(j.id)).length;
  const r10 = rate(10) / 10; const eta = r10 > 0 ? Math.round(pending / r10) : null;
  return { now, dir, stop: fs.existsSync(path.join(dir, 'STOP')), stages, dumps: files.length, pending, lastDumpAgo: ts.length ? Math.round((now - ts[ts.length - 1]) / 1000) : null,
    gaps, rate5: rate(5), rate10: rate(10), lastHour, cap: 240, etaMin: eta, lastPollAgo: live.lastPoll ? Math.round((now - live.lastPoll) / 1000) : null, lastBatch: live.lastBatch,
    quality, log, chartDist, chartTotal: chart ? Object.keys(chart).length : 0, verdict, xlsx, current, products, progress: live.progress ? { ...live.progress, ago: Math.round((now - live.progress.at) / 1000) } : null };
}
export const PAGE = `<!doctype html><html lang=ko><meta charset=utf-8><title>소싱 진행 대시보드</title>
<style>body{font:14px/1.5 system-ui,sans-serif;background:#111827;color:#e5e7eb;margin:0;padding:16px}h1{font-size:18px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.card{background:#1f2937;border-radius:10px;padding:12px}
.card h2{font-size:14px;margin:0 0 8px;color:#9ca3af}.bar{background:#374151;border-radius:6px;height:14px;overflow:hidden;margin:4px 0}.bar i{display:block;height:100%;background:#3b82f6}
.bar.cur i{background:#10b981}.big{font-size:26px;font-weight:600}.ok{color:#10b981}.warn{color:#f59e0b}.bad{color:#ef4444}
.gaps{display:flex;align-items:flex-end;gap:3px;height:70px}.gaps b{flex:1;background:#3b82f6;border-radius:2px 2px 0 0;min-width:6px}.gaps b.slow{background:#ef4444}
pre{background:#0b1220;padding:8px;border-radius:6px;font-size:12px;max-height:320px;overflow:auto;white-space:pre-wrap}button{background:#374151;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;margin-right:6px}
small{color:#9ca3af}table{width:100%;font-size:13px}td{padding:2px 4px}td:last-child{text-align:right}#flow td,#flow th{text-align:center;white-space:nowrap}#flow td:first-child{text-align:left;max-width:420px;overflow:hidden;text-overflow:ellipsis}#flow tr.cur{background:#064e3b}#flow td:last-child{text-align:center}.sym{font-size:15px}.pipe{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid #374151}.pipe:first-child{border-top:0}.pipe .n{font-size:18px;width:26px;text-align:center}.pipe .t{flex:1}.pipe .t b{font-size:14px}.pipe .sub{color:#9ca3af;font-size:12px;margin-top:2px}.pipe.now{background:#064e3b;border-radius:8px;padding:8px}.pipe.done .t b{color:#93c5fd}.pipe.wait .t b{color:#9ca3af}.wf{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.wf span{background:#374151;border-radius:14px;padding:4px 12px;color:#9ca3af}.wf span.done{background:#1e3a5f;color:#93c5fd}.wf span.now{background:#10b981;color:#fff;font-weight:600}.wf i{color:#6b7280;font-style:normal}</style>
<h1>소싱 진행 대시보드 <small id=upd></small></h1>
<div class=grid>
<div class=card><h2>단계 진행</h2><div id=stages></div></div>
<div class=card><h2>속도</h2><div class=big id=rate></div><div class=gaps id=gaps></div><small>최근 20개 덤프 간격(초) · 빨강 = 30초 이상</small><div id=eta></div></div>
<div class=card><h2>상태</h2><table id=status></table><div style="margin-top:8px"><button onclick="post('/stop')">일시정지(STOP)</button><button onclick="post('/resume')">재개</button></div></div>
<div class=card><h2>품질</h2><table id=quality></table></div>
<div class=card><h2>차트 게이트 · 결과</h2><div id=result></div></div>
</div>
<div class=card style="margin-top:12px"><h2>지금 탐색 중 — 한 상품의 작업 흐름 <small>(1초 갱신)</small></h2><div id=now style="font-size:16px;font-weight:600;margin-bottom:8px"></div><div id=wf class=wf></div><div id=wfnote><small></small></div></div>
<div class=card style="margin-top:12px"><h2>전체 탐색 파이프라인 <small>● 완료 · ◐ 지금 · ○ 대기</small></h2><div id=pipe></div></div>
<div class=card style="margin-top:12px"><h2>상품별 플로우 <small>● 완료 · ◐ 지금 · ○ 대기 · – 해당 없음(생략/탈락) · 체크박스: 진행 중·후보만</small> <label><input type=checkbox id=onlyActive> 완료·탈락 숨기기</label></h2>
<div style="max-height:420px;overflow:auto"><table id=flow><thead><tr><th style="text-align:left">상품</th><th>수집</th><th>차트</th><th>네이버 검색</th><th>카탈로그</th><th>판매처</th><th>판정</th></tr></thead><tbody></tbody></table></div></div>
<div class=card style="margin-top:12px"><h2>run-all.log (최근 30줄)</h2><pre id=log></pre></div>
<script>
const $=(s)=>document.querySelector(s);const NAMES={kream:'상품 수집(K)',nsearch:'네이버 검색(N-s)',ncat:'네이버 카탈로그(N-cat)',seller:'판매처 페이지(P)',etc:'기타'};
async function post(p){await fetch(p,{method:'POST'});load()}
async function load(){try{const s=await (await fetch('/stats')).json();
$('#upd').textContent=new Date(s.now).toLocaleTimeString('ko-KR')+' 갱신 (1초마다)';
let cur=null;for(const k of ['kream','nsearch','ncat','seller']){if(s.stages[k]&&s.stages[k].done<s.stages[k].total){cur=k;break}}
$('#stages').innerHTML=['kream','nsearch','ncat','seller','etc'].filter(k=>s.stages[k]).map(k=>{const v=s.stages[k];const p=v.total?Math.round(v.done/v.total*100):0;return '<div>'+NAMES[k]+' '+v.done+'/'+v.total+(k===cur?' <span class=ok>◀ 진행 중</span>':'')+'<div class="bar'+(k===cur?' cur':'')+'"><i style="width:'+p+'%"></i></div></div>'}).join('')||'<small>jobs.json 없음</small>';
$('#rate').innerHTML=(s.rate5/5).toFixed(1)+' 건/분 <small>최근5분 '+s.rate5+'건 · 10분 '+s.rate10+'건</small>';
const mx=Math.max(30,...s.gaps);$('#gaps').innerHTML=s.gaps.map(g=>'<b class="'+(g>=30?'slow':'')+'" style="height:'+Math.max(4,g/mx*100)+'%" title="'+g+'초"></b>').join('');
$('#eta').innerHTML='남은 작업 '+s.pending+'건 · 예상 '+(s.etaMin==null?'—':s.etaMin+'분')+' (10분 평균 기준)';
const cls=(v,w,b)=>v==null?'':v>=b?'bad':v>=w?'warn':'ok';
$('#status').innerHTML=[['STOP',s.stop?'<span class=bad>정지됨</span>':'<span class=ok>없음</span>'],['마지막 덤프',s.lastDumpAgo==null?'—':'<span class="'+cls(s.lastDumpAgo,40,120)+'">'+s.lastDumpAgo+'초 전</span>'],['확장 마지막 폴링',s.lastPollAgo==null?'(릴레이 재시작 후 없음)':'<span class="'+cls(s.lastPollAgo,30,90)+'">'+s.lastPollAgo+'초 전 · '+s.lastBatch+'건 전달</span>'],['시간당 상한',s.lastHour+' / '+s.cap],['덤프 합계',s.dumps+'개']].map(r=>'<tr><td>'+r[0]+'</td><td>'+r[1]+'</td></tr>').join('');
$('#quality').innerHTML=[['거래창 못 연 덤프',s.quality.noModal],['클릭 NOT FOUND',s.quality.notFound],['차단 화면 감지',s.quality.blocked]].map(r=>'<tr><td>'+r[0]+'</td><td class="'+(r[1]?'warn':'ok')+'">'+r[1]+'</td></tr>').join('');
let h='';if(s.chartTotal){h+='<div>차트 분석 '+s.chartTotal+'개: '+Object.entries(s.chartDist).map(e=>e[0]+' '+e[1]).join(' · ')+'</div>'}else h+='<small>차트 게이트 전</small>';
if(s.verdict)h+='<div style="margin-top:6px">최종 판정: '+Object.entries(s.verdict).map(e=>'<b>'+e[0]+'</b> '+e[1]).join(' · ')+'</div>';
if(s.xlsx.length)h+='<div style="margin-top:6px">엑셀: '+s.xlsx.join(', ')+'</div>';$('#result').innerHTML=h;
const SYM={done:'<span class="sym ok">●</span>',now:'<span class="sym warn">◐</span>',wait:'<span class=sym>○</span>'};const sym=(v)=>v?SYM[v]:'<small>–</small>';
const curP=s.products.find(p=>p.current);const stageName=curP?(curP.kream!=='done'?'거래 내역 수집':curP.search==='now'?'네이버 검색':curP.cat==='now'?'네이버 카탈로그':curP.prod==='now'?'판매처 재고·사업자 확인':'진행 중'):null;
const STEPS=['페이지 열기','로딩 완료·대기','동작 실행·텍스트 수집','저장','완료·다음 대기'];const pg=s.progress;const pgIdx=pg&&pg.id===s.current?STEPS.indexOf(pg.step):-1;
$('#wf').innerHTML=STEPS.map((st,i)=>'<span class="'+(i<pgIdx?'done':i===pgIdx?'now':'')+'">'+st+(i===pgIdx?' <i>'+pg.ago+'초</i>':'')+'</span>'+(i<STEPS.length-1?'<i>→</i>':'')).join('');
$('#wfnote').innerHTML='<small>'+(pg?'확장 보고: '+pg.step+' ('+pg.ago+'초 전'+(pg.id?', '+pg.id:'')+')':'확장에서 단계 보고가 아직 없음 — 확장 ↻ 후 표시됨. 지금 상품은 작업 순서로 추정.')+'</small>';
$('#now').innerHTML=curP?'<span class=warn>◐</span> '+stageName+' · K'+curP.pid+' '+(curP.title||'')+(curP.chart?' <small>(차트: '+curP.chart.분류+' / '+curP.chart.판단+')</small>':''):'<small>'+(s.current?'작업 '+s.current:'확장이 다음 묶음을 기다리는 중')+'</small>';
const pst=s.stages,tot=(k)=>pst[k]?pst[k].total:0,dn=(k)=>pst[k]?pst[k].done:0,pfin=s.xlsx&&s.xlsx.length>0;
const P=[
{t:'1. 거래내역 수집',sub:'상품 페이지 열기 → 거래 내역 더보기 클릭 → 최근 체결 텍스트 저장',cnt:dn('kream')+'/'+tot('kream')+'개',done:tot('kream')>0&&dn('kream')===tot('kream')},
{t:'2. 차트 게이트(분석)',sub:'7·30·90일 지표 → 분류·판단 → 하락·데이터 부족 제외, 저유동은 유의 표시 → 네이버 검색 대상 선별',cnt:s.chartTotal?(s.chartTotal+'개 분석 '+Object.entries(s.chartDist).map(e=>e[0]+' '+e[1]).join(' · ')):'',done:s.chartTotal>0},
{t:'3. 네이버 검색',sub:'모델번호로 네이버 쇼핑 검색 → 최저가·판매처 후보 파싱 → 마진 계산 (20초 간격 느린 레인)',cnt:tot('nsearch')?dn('nsearch')+'/'+tot('nsearch')+'건':'',done:tot('nsearch')>0&&dn('nsearch')===tot('nsearch')},
{t:'4. 네이버 카탈로그',sub:'마진이 나는 상품의 가격비교 페이지 → 판매처별 가격·링크 수집',cnt:tot('ncat')?dn('ncat')+'/'+tot('ncat')+'건':'',done:tot('ncat')>0&&dn('ncat')===tot('ncat')},
{t:'5. 판매처 상세·재고 확인',sub:'후보 상품 페이지에서 사이즈 옵션 펼치기 → 재고, 사업자명, 대표자명 수집',cnt:tot('seller')?dn('seller')+'/'+tot('seller')+'건':'',done:tot('seller')>0&&dn('seller')===tot('seller')},
{t:'6. 최종 판정 · 엑셀',sub:'마진·차트·재고 종합 → 후보/후보(유의)/제외 판정 → 엑셀 저장',cnt:pfin?s.xlsx.join(', '):'',done:pfin}];
let pcur=P.findIndex(p=>!p.done);if(pfin)pcur=-1;
if(!curP&&pcur>=0&&P[pcur]&&pcur>0&&!s.current){$('#now').innerHTML='<span class=warn>◐</span> '+P[pcur].t+' 진행 중 <small>(드라이버가 처리 — 확장 작업 없음)</small>';$('#wfnote').innerHTML='<small>이 단계는 브라우저가 아니라 run-all 드라이버가 로컬에서 계산해요.</small>';}
$('#pipe').innerHTML=P.map((p,i)=>{const c=i<pcur?'done':i===pcur?'now':'wait';const ic=c==='done'?'●':c==='now'?'◐':'○';return '<div class="pipe '+c+'"><div class="n '+(c==='now'?'warn':c==='done'?'ok':'')+'">'+ic+'</div><div class="t"><b>'+p.t+'</b> <small>'+(p.cnt||'')+'</small><div class="sub">'+p.sub+'</div></div></div>'}).join('');
const only=$('#onlyActive').checked;const fin=(p)=>p.final?('<b class="'+(p.final.startsWith('후보')?'ok':'')+'">'+p.final+'</b>'):(p.chart&&['제외','보류'].includes(p.chart.판단)?'<small class=bad>'+p.chart.판단+'</small>':'<small>–</small>');
$('#flow tbody').innerHTML=s.products.filter(p=>!only||p.current||(!(p.chart&&['제외','보류'].includes(p.chart.판단))&&!(p.final&&!p.final.startsWith('후보')))).map(p=>'<tr'+(p.current?' class=cur':'')+'><td title="'+p.pid+'">'+(p.title||'K'+p.pid)+'</td><td>'+sym(p.kream)+'</td><td>'+(p.chart?'<small>'+p.chart.분류+'</small>':sym(p.kream==='done'?'wait':null))+'</td><td>'+sym(p.search)+'</td><td>'+sym(p.cat)+'</td><td>'+sym(p.prod)+'</td><td>'+fin(p)+'</td></tr>').join('');
$('#log').textContent=s.log.map(l=>l.split('\\uD06C\\uB9BC').join('수집')).join('\\n');}catch(e){$('#upd').textContent='릴레이 연결 안 됨: '+e.message}}
load();setInterval(load,1000);</script></html>`;
