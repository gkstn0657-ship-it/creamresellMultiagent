const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const active=a=>['tool','thinking','working'].includes(a.status);
const names={coordinator:'AI 지휘자',supervisor:'연속 실행기',worker:'수집 워커',owner:'상품 판단',reviewer:'독립 검수',owner_retired:'이전 담당',native_subagent:'조사 에이전트'};
const states={tool:'실행 중',thinking:'응답 생성',working:'동작 중',idle:'대기',quiet:'새 기록 대기',finished:'종료',offline:'오프라인',retired:'인계 완료'};
const tools={collect_no1:'상품 수집',request_review:'검수 응답 대기',read_observations:'원자료 읽기',read_observation:'원자료 읽기',calculate_scenario:'수익 계산',catalog:'후보 탐색',analyze:'작업 배정',wait:'결과 대기',record_review:'검수 저장',publish_assessment:'판단 저장',status:'상태 확인',finish:'작업 종료',connection:'연결 확인'};
const phase={discovering:'상품 탐색',collecting:'자료 수집',judging:'상품 판단',waiting_for_retry:'재시도 대기',complete:'완료'};
let currentRun='',selectedId='',latest=[],scope='all';
function shortModel(a){if(a.role==='supervisor')return '규칙 기반 · AI 아님';if(a.role==='worker')return '수집 프로세스';return a.model?.model?a.model.model.replace('gpt-','')+(a.model.effort?' / '+a.model.effort:''):'모델 미기록';}
function activity(a){return tools[a.currentTool]||a.currentTool||phase[a.phase]||states[a.status]||'기록 대기';}
function inspector(a){
 const host=$('node-inspector');if(!host)return;host.replaceChildren();
 if(!a){host.append(el('span','노드를 선택하면 실행 정보를 확인할 수 있습니다.','monitor-muted'));return;}
 const meta=el('div',null,'inspector-meta');meta.append(el('span','SELECTED NODE','monitor-kicker'),el('strong',names[a.role]||a.role),el('span',shortModel(a),'monitor-muted'));host.append(meta);
 const metrics=el('div',null,'inspector-metrics');
 for(const [label,value] of [['상태',states[a.status]],['현재 작업',activity(a)],['담당 상품',a.productId||'—'],['최근 활동',a.age==null?'기록 없음':a.age<60?a.age+'초 전':Math.floor(a.age/60)+'분 전']]){const box=el('div');box.append(el('small',label),el('strong',value));metrics.append(box);}host.append(metrics);
 if(a.productName)host.append(el('p',a.productName,'monitor-product'));
 const details=el('details',null,'monitor-details');details.append(el('summary','공개 메시지 · 실행 로그'));
 if(a.message)details.append(el('blockquote',a.message));
 const log=el('div',null,'monitor-log');for(const e of a.events||[]){const row=el('div');row.append(el('time',e.at?new Date(e.at).toLocaleTimeString('ko-KR'):'—'),el('span',tools[e.tool]||e.tool||e.type),el('small',e.error||e.text||e.type));log.append(row);}
 if(!a.events?.length)log.append(el('p','상세 이벤트가 아직 없습니다.'));details.append(log);host.append(details);
}
export function renderAgents(agents,run=''){
 if(currentRun!==run){currentRun=run;selectedId='';scope='all';}
 latest=agents;
 if(!agents.some(a=>a.id===selectedId))selectedId=(agents.find(active)||agents[0])?.id||'';
 const host=$('agents');host.className='monitor';
 const expanded=host.querySelector('.monitor-details')?.open;
 host.replaceChildren();
 const toolbar=el('div',null,'monitor-toolbar'),legend=el('div',null,'monitor-legend');
 for(const [name,cls] of [['실행','running'],['대기','waiting'],['종료','ended']]){const key=el('span',name);key.className=cls;legend.append(key);}
 const tabs=el('div',null,'monitor-tabs');
 for(const [v,t] of [['all','전체 '+agents.length],['live','동작 중 '+agents.filter(active).length]]){const button=el('button',t);button.type='button';button.className=scope===v?'selected':'';button.onclick=()=>{scope=v;renderAgents(latest,currentRun);};tabs.append(button);}
 toolbar.append(legend,tabs);host.append(toolbar);
 const canvas=el('div',null,'monitor-canvas'),lanes=el('div',null,'monitor-lanes');
 const groups=[['CONTROL','지휘 · 제어',['coordinator','supervisor'],'01'],['COLLECT','상품 수집',['worker'],'02'],['ANALYZE','상품 판단',['owner','owner_retired','native_subagent'],'03'],['REVIEW','독립 검수',['reviewer'],'04']];
 for(const [code,title,roles,num] of groups){
 const all=agents.filter(a=>roles.includes(a.role)),visible=all.filter(a=>scope==='all'||active(a));
 const lane=el('section',null,'monitor-lane');lane.dataset.active=all.some(active)?'true':'false';
 const head=el('div',null,'lane-heading');head.append(el('span',num,'lane-number'),el('strong',title),el('small',code));lane.append(head);
 const nodes=el('div',null,'lane-nodes');
 for(const a of visible){
 const button=el('button',null,'agent-node agent-card');button.type='button';button.dataset.activity=a.status;button.setAttribute('aria-pressed',String(a.id===selectedId));button.setAttribute('aria-label',(names[a.role]||a.role)+' '+(states[a.status]||''));
 const top=el('div',null,'node-top');top.append(el('span',null,'node-chip'),el('span',states[a.status]||a.status,'node-state'));button.append(top);
 button.append(el('strong',a.productId?'#'+a.productId:names[a.role]||a.role,'node-title'),el('small',shortModel(a),'node-model'),el('span',activity(a),'node-action'));
 const bars=el('div',null,'node-signal');for(let i=0;i<12;i++)bars.append(el('i'));button.append(bars);
 button.onclick=()=>{selectedId=a.id;for(const b of host.querySelectorAll('.agent-node'))b.setAttribute('aria-pressed','false');button.setAttribute('aria-pressed','true');inspector(a);};nodes.append(button);
 }
 if(!visible.length){const empty=el('div',null,'node-empty');empty.append(el('span','○'),el('small',all.length?'동작 중인 노드 없음':'아직 배정되지 않음'));nodes.append(empty);}
 lane.append(nodes);lanes.append(lane);
 }
 canvas.append(lanes);host.append(canvas);
 const panel=el('div',null,'node-inspector');panel.id='node-inspector';host.append(panel);inspector(agents.find(a=>a.id===selectedId));if(expanded&&host.querySelector('.monitor-details'))host.querySelector('.monitor-details').open=true;
 $('agent-count').textContent=agents.filter(active).length+' RUNNING / '+agents.length+' NODES';
}
