import {renderAgents} from '/agent-activity-ui.js';
import {renderResults} from '/results-ui.js';
const $=id=>document.getElementById(id),put=(id,v)=>{$(id).textContent=v??'—';};
const labels={ready:'실행 준비',running:'진행 중',complete:'완료',blocked:'진행 차단',needs_attention:'확인 필요',stopped:'중지됨',source_exhausted:'후보 소진',judging:'상품 판단',collecting:'수집 중',launch_pending:'실행 요청',hold:'보류',exclude:'제외',adopt:'조사 후보 채택',owner:'상품 담당',owner_retired:'이전 담당',reviewer:'독립 검수'};
const label=v=>labels[v]||v||'기록 없음',model=m=>m?`${m.model||'모델 미기록'} / ${m.effort||'강도 미기록'}`:'기존 기록에 모델 없음';
Object.assign(labels,{discovering:'상품 탐색 중',waiting_for_retry:'재시도 대기',running_batch:'배치 처리 중',recovering:'복구 중'});
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
let data=null,busy=false,loading=false,selected=new URL(location.href).searchParams.get('run')||'',fresh=false;
function buttons(){$('runs').disabled=busy;for(const action of ['stop','resume'])$(action).disabled=busy||!fresh||!(action==='stop'?data?.canStop:data?.canResume);}
function render(d){
 data=d;const options=d.runs.map(r=>[r.id,`${r.id} · ${label(r.status)}`]);
 if(JSON.stringify(options)!==$('runs').dataset.options){$('runs').replaceChildren(...options.map(([v,t])=>{const o=el('option',t);o.value=v;return o;}));$('runs').dataset.options=JSON.stringify(options);}
 selected=d.selected||'';$('runs').value=selected;
 $('policy').replaceChildren(...[['coordinator','지휘자'],['owner','상품 판단'],['reviewer','일반 검수'],['deepReviewer','심층 검수']].map(([role,name])=>{const n=el('div',null,'policy-item');n.append(el('small',name),el('strong',model(d.policy[role])),el('small',role==='owner'?'근거 제시 후 Sol/high 1회 승격':'저장된 정책'));return n;}));
 if(!d.selected){renderAgents([]);put('headline','등록된 Herdr 작업이 없습니다');put('mission','새 작업이 저장되면 자동으로 나타납니다.');buttons();return;}
 renderAgents(d.agents||[],selected);
 renderResults(d);
 $('budget').disabled=!!d.continuous;
 put('state',label(d.status));put('headline',d.stopping&&d.controllerAlive?'중지 요청 처리 중':label(d.status));put('mission',d.mission.instruction);put('model',model(d.model));put('turns',`턴 ${d.turns} / ${d.mission.maxTurns}`);put('process',d.controllerAlive?'지휘자 프로세스 실행 중':'지휘자 프로세스 종료');put('scope',`${d.mission.source} · 기존 작업 범위 유지`);put('updated',new Date(d.observedAt).toLocaleTimeString('ko-KR'));put('error',d.error||(!d.controllerAlive&&d.status==='running'?'실행 기록은 진행 중이지만 지휘자 프로세스가 없습니다.':''));
 put('completed',`${d.completed} / ${d.mission.targetProducts}`);put('unit',d.mission.source==='musinsa-ranking'?'확인한 구매처 상품 수':'검수 완료 상품 수');put('reviewed',d.reviewed);put('skipped',d.skipped);put('workers',d.batches.filter(b=>b.alive).length);$('progress').max=d.mission.targetProducts;$('progress').value=d.completed;
 if(d.continuous){put('completed',`${d.completed} / ∞`);put('unit','확인한 구매처 상품 수');put('model','규칙 기반 연속 실행기');put('turns','중지 요청까지 계속');put('process',d.controllerAlive?'연속 실행기 동작 중':'연속 실행기 종료');put('workers',(d.agents||[]).filter(a=>a.role==='worker'&&a.status==='working').length);$('progress').max=1;$('progress').value=0;}
 if($('budget').dataset.run!==selected){$('budget').value=d.mission.maxTurns??'';$('budget').dataset.run=selected;}
 $('batches').replaceChildren(...d.batches.map(b=>{const n=el('section',null,'batch');n.append(el('h3',`${label(b.status)} · ${b.alive?'워커 실행 중':'워커 종료'} · ${b.paneId||'pane 미기록'}`),el('small',b.runId),el('p',b.reason));if(b.error)n.append(el('p',b.error));
 for(const p of b.products){const row=el('div',null,'product');row.append(el('strong',`${p.productId} · ${label(p.decision||p.status)}`),el('small',p.verified?'독립 검수 기록 확인됨':'독립 검수 완료 미확인'),el('p',p.reason||p.error||'판단 기록 대기'),el('small',`상품 담당: ${model(p.model)} · 승격 ${p.upgrades}회`));for(const a of p.actors)row.append(el('small',`${label(a.role)} · ${model(a)}${a.reason?' · '+a.reason:''}`));n.append(row);}
 for(const s of b.sources.filter(s=>s.status==='skipped'))n.append(el('p',`${s.sourceId||s.productId||'상품'} · 수집 단계 제외 · ${s.reason||'사유 미기록'}`));return n;}));
 if(!d.batches.length)$('batches').append(el('p','아직 배정된 워커가 없습니다.','empty'));
 const expanded=new Set([...$('events').querySelectorAll('details[open]')].map(n=>n.dataset.key));
 $('events').replaceChildren(...d.events.map(e=>{const n=el('details'),summary=el('summary');n.dataset.key=selected+':'+e.at+':'+e.type+':'+(e.tool||'');n.open=expanded.has(n.dataset.key);summary.append(el('time',e.at?new Date(e.at).toLocaleTimeString('ko-KR'):'—'),document.createTextNode(`${e.type}${e.tool?' / '+e.tool:''}${e.reason?' · '+e.reason:''}`));n.append(summary,el('pre',JSON.stringify(e,null,2)));return n;}));buttons();
}
async function refresh(){if(loading)return;loading=true;const requested=selected;try{const r=await fetch('/api/herdr'+(selected?'?run='+encodeURIComponent(selected):''),{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('기록 조회 실패');const d=await r.json();if(requested!==selected)return;fresh=true;document.body.classList.remove('feed-offline');render(d);put('connection','● 연결됨 · 2초 갱신');$('connection').className='';}catch(e){fresh=false;put('connection','연결 끊김 · 마지막 기록');$('connection').className='disconnected';buttons();}finally{loading=false;}}
async function action(kind){if(busy)return;busy=true;buttons();const runId=selected;put('feedback',kind==='stop'?'중지 요청 중…':'재개 요청 중…');try{const r=await fetch('/api/herdr/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId,action:kind,...(kind==='resume'?{maxTurns:Number($('budget').value)}:{})})});const result=await r.json();if(!r.ok)throw Error(result.error||'요청 실패');put('feedback',result.message);await refresh();}catch(e){put('feedback',e.message==='TURN_BUDGET_EXHAUSTED'?'사용한 턴보다 큰 총 턴 한도를 입력해 주세요.':e.message);}finally{busy=false;buttons();}}
for(const kind of ['stop','resume'])$(kind).onclick=()=>action(kind);
 $('runs').onchange=()=>{selected=$('runs').value;fresh=false;buttons();put('feedback','');const url=new URL(location.href);url.searchParams.set('run',selected);history.replaceState(null,'',url);refresh();};$('refresh').onclick=refresh;refresh();setInterval(refresh,2000);
