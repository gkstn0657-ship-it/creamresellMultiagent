const el=id=>document.getElementById(id);
const set=(id,value)=>{el(id).textContent=String(value??'—');};
const format=n=>Number(n||0).toLocaleString('ko-KR');
const kst=at=>at?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(at)):'—';
const reasonText={NO1_WEB_TAB_REQUIRED:'No1 웹 탭을 찾지 못했습니다. 로그인된 소싱 페이지가 열리면 다시 시도합니다.',NO1_AUTH_REQUIRED:'No1 로그인 상태를 확인할 수 없습니다.',NO1_BRIDGE_DISCONNECTED:'No1 Background Connector 연결이 끊겼습니다. 연결 담당이 상태를 확인하고 있습니다.',NO1_BRIDGE_UNAVAILABLE:'No1 로컬 브리지에 연결할 수 없습니다.',WORKER_NOT_RUNNING:'탐색 실행기가 종료돼 작업 담당이 재시작을 확인합니다.',WORKER_PROGRESS_STALE:'탐색 기록이 5분 넘게 갱신되지 않았습니다.',KREAM_SEARCH_FAILED:'KREAM 검색이 실패해 같은 상품을 보존하고 재시도합니다.',NO1_BRIDGE_TIMEOUT:'No1 연결 시간이 초과되어 재시도합니다.',EXACT_MARKET_MODEL_NOT_FOUND:'KREAM에서 동일 품번을 확인하지 못함',AVAILABLE_OPTION_NOT_BOUND:'재고 있는 옵션과 KREAM 사이즈를 연결하지 못함',NO_POSITIVE_MARGIN_IN_BOUND_AVAILABLE_OPTIONS:'재고 있는 옵션에서 양수 마진 없음',NO_AVAILABLE_STOCK:'구매 가능한 재고 없음'};
const eventText=e=>{
 const id=e.sourceId?` #${e.sourceId}`:'';
 if(e.type==='source_processed')return `상품${id} ${e.reason?'제외 · '+(reasonText[e.reason]||e.reason):'수집 완료'}`;
 if(e.type==='source_retry')return `조회 재시도 · ${e.reason||'잠시 지연'}`;
 if(e.type==='source_recovered')return '조회 복구 · 같은 요청으로 탐색 재개';
 if(e.type==='source_lookup_skipped')return `상품${id} 조회 실패 · 다음 상품으로 이동 · ${e.reason||''}`;
 if(e.type==='work_needs_attention')return `작업 주의 · ${e.reason||'연결 확인 필요'}`;
 if(e.type==='continuous_wait')return `자동 재시도 대기 · ${e.reason||'잠시 후 다시 확인'}`;
 if(e.type==='ranking_loaded')return '카테고리 인기순 목록 수신';
 if(e.type==='profit_progress')return `검토 통과 ${e.found??0}개`;
 if(e.type==='assessment_complete')return `AI 판단 완료 · ${e.decision||'검토'}`;
 if(e.type==='product_collected')return `상품${id} 수집 완료`;
 if(e.type==='product_judged')return `상품${id} 판정 · ${decisionText[e.decision]||'확인 필요'}`;
 if(e.type==='product_judgment_started')return `상품${id} 판단 시작`;
 if(e.type==='all_products_collected')return '현재 배치 수집 완료';
 if(e.type==='batch_prefetch_started')return '다음 배치 선행수집 시작';
 if(e.type==='batch_prefetch_complete')return '다음 배치 선행수집 완료';
 return e.type.replaceAll('_',' ');
};
const decisionText={adopt:'통과',hold:'보류',exclude:'제외',pending:'진행 중'};
const marketLabel=r=>`${(r.qualifiedPlatforms?.length?r.qualifiedPlatforms:r.platforms?.length?r.platforms:[r.productId.startsWith('poizon-')?'poizon':'kream']).map(p=>p.toUpperCase()).join(' / ')} · ${r.productId}`;
let snapshot=null,startBusy=false,startMessage='';
function renderStart(data){
 const button=el('start-button');if(!button)return;
 const running=data.workerAlive&&['discovering','collecting','judging','recovering'].includes(data.status);
 button.disabled=startBusy||!data.workId||running||data.status==='complete'||data.scopeMode==='inspected-sources';
 button.textContent=startBusy?'시작 요청 중':running?'탐색 진행 중':data.status==='waiting'?'지금 다시 시도':'탐색 시작';
 const feedback=el('start-feedback');feedback.textContent=startMessage||(!data.workId?'시작할 작업이 없습니다.':running?'저장된 인기 순위에서 탐색 중입니다.':'저장된 작업을 이어서 실행합니다.');
 feedback.classList.toggle('error',/연결|실패|오류/.test(startMessage));
}
function tickClock(){
 set('clock',new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()));
 if(snapshot?.status!=='waiting'||!snapshot.retryAt){set('next-retry','');return;}
 const seconds=Math.max(0,Math.ceil((new Date(snapshot.retryAt).getTime()-Date.now())/1000));
 set('next-retry',`다음 재시도 ${Math.floor(seconds/60)}분 ${String(seconds%60).padStart(2,'0')}초`);
}
function node(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!=null)n.textContent=String(text);return n;}
function renderResults(data){
 const list=el('results-list');list.replaceChildren();set('result-count',`${format(data.recent.length)}건 표시`);
 if(!data.recent.length){list.append(node('p','empty','아직 완료된 상품 판단이 없습니다.'));return;}
 const featured=data.featured||data.recent.find(r=>r.qualified);
 if(featured){const row=node('div','featured-result'),tag=node('span','featured-tag','✦ 검토 통과 후보'),link=node('a','',marketLabel(featured));if(featured.url)link.href=featured.url;link.target='_blank';link.rel='noopener noreferrer';row.append(tag,link);list.append(row);}
 for(const r of data.recent){
  const row=node('div','result-row'),main=node('div','result-main'),link=node('a','',marketLabel(r));
  if(r.url){link.href=r.url;link.target='_blank';link.rel='noopener noreferrer';}main.append(link,node('small','',r.reason||'판단 근거가 저장돼 있습니다.'));
  const right=node('div','result-right');if(r.reviewed)right.append(node('span','review-check','✓ 독립 검토'));
  right.append(node('span',`decision ${r.decision}`,r.qualified?'수익 후보':decisionText[r.decision]||r.decision));row.append(main,right);list.append(row);
 }
}
function renderEvents(data){
 const list=el('events-list');list.replaceChildren();
 if(!data.events.length){list.append(node('p','empty','기록이 쌓이면 여기에 표시됩니다.'));return;}
 for(const e of data.events){const warning=/retry|wait/.test(e.type),error=/attention|exhausted/.test(e.type);const row=node('div',`event-row ${error?'error':warning?'warning':''}`);row.append(node('span','event-dot'),node('span','',eventText(e)));list.append(row);}
}
function renderSkipped(data){
 const list=el('skipped-list');if(!list)return;
 list.replaceChildren();
 if(!Array.isArray(data.lookupSkipped)){set('skipped-count','확인 중');list.append(node('p','empty','새 대시보드 서버에서 실패 기록을 불러옵니다.'));return;}
 const rows=data.lookupSkipped;set('skipped-count',`${format(data.lookupSkippedCount)}개`);
 set('skipped-footnote',rows.length?`최근 ${format(rows.length)}개 표시 · 시도 횟수는 최초 조회 포함 · 상품명이 없는 이전 기록은 번호로 표시`: '');
 if(!rows.length){list.append(node('p','empty','아직 조회 실패로 건너뛴 상품이 없습니다.'));return;}
 const reasons={STOCK_CHECK_FAILED:'재고 조회 실패',KREAM_SEARCH_FAILED:'KREAM 검색 실패',MUSINSA_BENEFIT_FETCH_FAILED:'혜택 조회 실패',NO1_BRIDGE_TIMEOUT:'상품 조회 시간초과',NO1_RELAY_TIMEOUT:'상품 응답 시간초과'};
 for(const r of rows){
  const row=node('div','skipped-row'),main=node('div','skipped-main'),link=node(r.url?'a':'span','skipped-product',r.name||`무신사 #${r.sourceId}`);
  if(r.url){link.href=r.url;link.target='_blank';link.rel='noopener noreferrer';}
  main.append(link,node('small','',`#${r.sourceId} · ${reasons[r.reason]||r.reason}`));
  const meta=node('div','skipped-meta');meta.append(node('span','skip-badge',r.attempts?`${r.attempts}회 시도`:'횟수 미기록'),node('small','',r.at?kst(r.at):'시간 미기록'));
  row.append(main,meta);list.append(row);
 }
}
function render(data){
 const health=el('health-monitor-detail');
 if(health){const m=data.healthMonitor;health.textContent=!m?'AI 감시: 실행 전':!m.active?'AI 감시: 종료 또는 연결 확인 필요':m.ai?.status==='running'?`AI 감시: 이상 진단 중 · ${m.reason}`:m.status==='healthy'?'AI 감시: 정상 · 10초 주기 점검':`AI 감시: ${m.reason}${m.ai?.status==='complete'?' · '+m.ai.summary:''}`;}
 snapshot=data;renderStart(data);const active=data.workerAlive&&['discovering','collecting','judging','recovering'].includes(data.status);
 if(el('checked-caption'))set('checked-caption',!data.scopeMode?'수집 완료 · 선행수집 포함':'실제 처리된 구매처 상품');
 const waiting=data.status==='waiting',offline=data.status==='offline'||data.status==='stopped';
 el('connection').classList.toggle('offline',!data.workerAlive);
 el('connection').lastChild.textContent=data.workerAlive?'작업 기록 연결됨':'실행기 연결 끊김';
 set('checked',format(data.checked));set('qualified',format(data.qualified));set('judged',format(data.judged));set('reviewed',format(data.reviewed));
 set('target-caption',data.brandPlan?`${data.brandPlan.brands.length}개 브랜드 · 신규 ${format(data.initialTarget)}개 · 이전 확인 ${format(data.brandPlan.previouslyChecked)}개`:data.scopeMode==='inspected-sources'?'상품 '+format(data.initialTarget)+'개 확인 후 종료':data.continuous?'계속 탐색 · 최초 목표 '+format(data.initialTarget)+'개':'목표 '+format(data.initialTarget)+'개');
 el('hero-panel').dataset.state=waiting?'waiting':offline?'offline':'active';
 el('live-pill').className=`live-pill ${waiting?'waiting':offline?'offline':''}`;
 set('live-pill',waiting?`● ${data.monitor?.code||''} 자동 재시도 대기`:offline?'● 실행 중단':active?'● 실제 작업 진행 중':'● 상태 확인 중');
 set('orb-symbol',waiting?'Ⅱ':offline?'×':data.status==='judging'?'◇':'✦');
 if(waiting){set('activity-kicker','PAUSED · RETRY SCHEDULED');set('activity-title','탐색이 잠시 멈췄어요');set('activity-detail',reasonText[data.waitReason]||`오류: ${data.waitReason||'연결 확인 필요'}`);set('activity-meta','저장된 상품 위치와 판단 결과는 그대로 보존됩니다.');}
 else if(data.status==='complete'){set('activity-kicker','COMPLETE');set('activity-title','요청한 상품 확인을 마쳤어요');set('activity-detail',`${format(data.checked)}개 확인 · ${format(data.qualified)}개 검토 통과`);set('activity-meta','결과가 저장되었습니다.');set('live-pill','● 작업 완료');}
 else if(offline){set('activity-kicker','WORKER OFFLINE');set('activity-title','실행기가 작동하지 않아요');set('activity-detail',data.error||'작업 연결을 확인해 주세요.');set('activity-meta','마지막으로 저장한 결과를 표시하고 있습니다.');}
 else if(data.status==='collecting'){set('activity-kicker','PRODUCT COLLECTION');set('activity-title','상품 정보를 수집하고 있어요');set('activity-detail','가격·재고·판매 기록을 조회하고 있습니다.');set('activity-meta',`현재 배치 ${data.lastBatch.collected}/${data.lastBatch.productCount}개 수집`);}
 else if(data.status==='judging'){set('activity-kicker','AGENT REVIEW');set('activity-title','AI가 상품을 검토하고 있어요');set('activity-detail','상품별 수익성 판단과 독립 검토 결과를 기다리고 있습니다.');set('activity-meta',`현재 배치 ${data.lastBatch.judged}/${data.lastBatch.productCount}개 판단`);}
 else if(data.status==='recovering'){set('activity-kicker','SOURCE RECOVERY');set('activity-title','조회 요청을 다시 확인하고 있어요');set('activity-detail',reasonText[data.error]||'연결 및 요청 상태를 확인합니다.');set('activity-meta','상품 조회 실패는 기록 후 다음 상품으로 넘어갑니다.');}
 else{set('activity-kicker','DISCOVERY IN PROGRESS');set('activity-title','인기순 상품을 찾고 있어요');set('activity-detail','마진율, 재고, 최근 판매동향으로 후보를 선별하고 있습니다.');set('activity-meta',`누적 ${format(data.checked)}건 확인 · ${format(data.qualified)}개 검토 통과`);}
 set('last-updated',data.updatedAt?`작업 기록 ${kst(data.updatedAt)} 갱신`:'작업 기록 없음');
 set('pipeline-status',waiting?'연결 대기':data.status==='judging'?'AI 검토 중':active?'탐색 중':data.status==='stopped'?'중지됨':'확인 필요');
 for(const id of ['stage-source','stage-owner','stage-reviewer'])el(id).classList.remove('active');
 if(['discovering','collecting','recovering'].includes(data.status))el('stage-source').classList.add('active');
 if(data.status==='judging'){el('stage-owner').classList.add('active');el('stage-reviewer').classList.add('active');}
 set('source-detail',waiting?'No1 연결 후 재시도':data.status==='collecting'?'가격·재고·판매 기록 수집 중':data.status==='discovering'?`상품 ${format(data.checked)}건 처리`:data.status==='recovering'?'같은 상품 요청 재시도':'수집 대기');
 set('owner-detail',data.status==='judging'?'상품별 판단 진행 중':`${format(data.judged)}건 판단 완료`);
 set('reviewer-detail',data.status==='judging'?'검토 단계 진행 중':`${format(data.reviewed)}건 독립 검토 완료`);
 set('pipeline-note',waiting?'현재 탐색은 일시 중단됐습니다. 아래 최근 판단은 이전에 완료된 기록입니다.':'통과는 재고·마진·판매 근거와 독립 검토를 모두 확인한 상품만 셉니다.');
 set('rank',data.current.rank?`#${data.current.rank}`:'—');set('category',data.brandPlan?data.current.brand:data.current.category||'—');
 set('current-product',data.current.name||'현재 상품 기록이 없습니다.');set('current-id',data.current.sourceId?`무신사 상품 #${data.current.sourceId}`:'저장된 위치에서 이어집니다');
 renderResults(data);renderEvents(data);renderSkipped(data);tickClock();
}
async function refresh(){
 try{const response=await fetch('/api/state',{cache:'no-store',signal:AbortSignal.timeout(6000)});if(!response.ok)throw Error('DATA_UNAVAILABLE');render(await response.json());}
 catch{el('connection').classList.add('offline');set('connection','● 대시보드 서버 연결 끊김');el('hero-panel').dataset.state='offline';set('activity-title','기록을 읽을 수 없어요');set('activity-detail','대시보드 서버 연결을 다시 시도합니다.');}
}
el('start-button').addEventListener('click',async()=>{
 if(location.port==='8874'){location.assign('http://127.0.0.1:8875/');return;}
 if(!snapshot?.workId||startBusy)return;
 startBusy=true;startMessage='';renderStart(snapshot);
 try{const response=await fetch('/api/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workId:snapshot.workId}),signal:AbortSignal.timeout(15000)});
  const result=await response.json();
  startMessage=result.ok?'탐색 재개 요청을 보냈습니다.':result.reason==='NO1_BRIDGE_DISCONNECTED'?'No1 확장 연결 대기 중입니다. 연결되면 저장된 위치에서 재개합니다.':result.reason==='NO1_BRIDGE_UNAVAILABLE'?'No1 로컬 브리지 연결을 확인할 수 없습니다.':result.reason==='NO1_CONNECTOR_UPDATE_REQUIRED'?'No1 확장 버전 갱신이 필요합니다.':`시작 실패: ${result.reason||result.code||response.status}`;
 }catch(e){startMessage=`시작 요청 실패: ${e.message}`;}
 finally{startBusy=false;renderStart(snapshot);await refresh();}
});
tickClock();setInterval(tickClock,1000);refresh();setInterval(refresh,2000);
