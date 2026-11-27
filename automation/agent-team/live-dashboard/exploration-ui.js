const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const names={all:'전체',pending:'진행 중',reviewed:'검수 완료',skipped:'수집 제외',attention:'확인 필요'};
const decisions={adopt:'채택 후보',hold:'보류',exclude:'제외'};
let run='',filter='all',query='',data=null;
export function renderExploration(d){
 const host=document.getElementById('exploration-rows');if(!host)return;
 const sameRun=run===d.selected;
 const expanded=new Set(sameRun?[...host.querySelectorAll('.exploration-diagnosis[open]')].map(n=>n.dataset.sourceId):[]);
 data=d;if(!sameRun){run=d.selected;filter='all';query='';}
 const rows=d.exploration?.rows||[],counts=d.exploration?.counts||{assigned:0,collected:0,skipped:0,reviewed:0,adopt:0,pending:0,attention:0};
 document.getElementById('exploration-caption').textContent=d.exploration?`무신사 매입처별 저장 기록 · 수집 제외 ${counts.skipped}건 중 원인 분석 ${counts.diagnosed||0}건, 재수집·독립 검토로 복구 ${counts.recovered||0}건. 시장별 판단은 아래 상품 결과에서 확인하세요.`:'이 실행기의 매입처별 탐색 기록은 제공되지 않습니다.';
 const counters=[['배정',counts.assigned],['수집 성공',counts.collected],['수집 제외',counts.skipped],['검수 완료',counts.reviewed],['채택 후보 포함',counts.adopt],['진행·확인 필요',counts.pending]];
 document.getElementById('exploration-counts').replaceChildren(...counters.map(([name,value])=>{const n=el('div',null,'exploration-count');n.append(el('small',name),el('strong',String(value)));return n;}));
 const tabs=document.getElementById('exploration-filters');tabs.replaceChildren(...Object.entries(names).map(([key,name])=>{const n=el('button');n.type='button';n.className=filter===key?'selected':'';n.setAttribute('aria-pressed',String(filter===key));n.append(el('span',name),el('strong',String(key==='all'?counts.assigned:key==='pending'?counts.pending:counts[key])));n.onclick=()=>{filter=key;renderExploration(data);};return n;}));
 const search=document.getElementById('exploration-search');if(document.activeElement!==search)search.value=query;search.oninput=()=>{query=search.value;renderExploration(data);};
 const selected=rows.filter(r=>(filter==='all'||(filter==='pending'?['waiting','reviewing','attention'].includes(r.status):r.status===filter))&&[r.name,r.sourceId,...r.markets.map(m=>m.productId)].join(' ').toLowerCase().includes(query.toLowerCase()));
 host.replaceChildren(...selected.slice(0,100).map(r=>{
  const item=el('article',null,'exploration-row'),title=el('div',null,'exploration-title');
  const name=el('strong',r.name);if(r.url){try{const u=new URL(r.url);if(u.protocol==='https:'&&['musinsa.com','www.musinsa.com'].includes(u.hostname)){const link=el('a');link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';link.append(name);title.append(link);}else title.append(name);}catch{title.append(name);}}else title.append(name);
  title.append(el('small',`${r.rank==null?'순위 미확인':r.rank+'위'} · 무신사 ${r.sourceId}`));
  const status=el('span',r.status==='skipped'?'수집 제외':r.status==='reviewed'?'검수 완료':r.status==='attention'?'확인 필요':r.status==='waiting'?'수집 대기':'판단 중','exploration-badge '+r.status);
  item.append(title,status);
  const market=el('div',null,'exploration-market');for(const m of r.markets){const adopted=m.verified&&m.decision==='adopt',node=el(adopted?'a':'span',`${m.productId.startsWith('poizon-')?'POIZON':'KREAM'} ${m.productId} · ${m.verified?(decisions[m.decision]||'검수 완료'):'검수 대기'}${adopted?' →':''}`,m.verified?'verified':'');if(adopted)node.href='/herdr/candidate?run='+encodeURIComponent(d.selected)+'&product='+encodeURIComponent(m.productId);market.append(node);}
  if(r.diagnosis){const detail=el('details',null,'exploration-diagnosis');detail.dataset.sourceId=String(r.sourceId);detail.open=expanded.has(String(r.sourceId));detail.append(el('summary',`제외 원인 · ${r.diagnosis.agent?.status==='complete'?'에이전트 분석 완료':'근거 분류 완료'}`));
   for(const [market,label] of [['kream','KREAM'],['poizon','POIZON']])detail.append(el('p',`${label}: ${r.diagnosis[market]?.label||'세부 원인 미확인'}`));
   if(r.diagnosis.agent?.status==='complete'){detail.append(el('p',r.diagnosis.agent.summary,'diagnosis-agent-summary'),el('p','다음 확인: '+r.diagnosis.agent.nextCheck));}
   if(r.resolution){const labels={recovered:'재수집·독립 검토 완료',still_excluded:'재조회 후에도 수집 제외',rechecking:'재조회 진행 중',wait_for_change:'새 시장 근거 대기',needs_evidence:'추가 근거 필요',needs_attention:'재확인 필요'};detail.append(el('p','해결 담당: '+(labels[r.resolution.status]||r.resolution.status)));if(r.resolution.reason)detail.append(el('p',r.resolution.reason));if(r.resolution.retry?.reason)detail.append(el('p','재조회 결과: '+r.resolution.retry.reason));if(r.resolution.nextCheck)detail.append(el('p','후속 확인: '+r.resolution.nextCheck));for(const p of r.resolution.products||[]){const node=el(p.decision==='adopt'?'a':'p',`${p.productId.startsWith('poizon-')?'POIZON':'KREAM'} ${p.productId} · 독립 검토 ${decisions[p.decision]||p.decision||'완료'}${p.decision==='adopt'?' →':''}`);if(p.decision==='adopt')node.href='/herdr/candidate?run='+encodeURIComponent(d.selected)+'&product='+encodeURIComponent(p.productId);detail.append(node);}}
   detail.append(el('small',r.diagnosis.confidence==='recorded'?'수집 당시 시장별 결과 저장':r.diagnosis.confidence==='partial'?'저장 근거 부족 · 원인 일부 미확인':'저장된 조회 근거에서 재구성'));item.append(detail);
  }else if(r.reason)item.append(el('p',r.reason,'exploration-reason'));
  if(market.childElementCount)item.append(market);
  return item;
 }));
 if(selected.length>100)host.append(el('p',`검색 결과 ${selected.length}건 중 최근 100건을 표시합니다.`,'result-note'));
 if(!selected.length)host.append(el('p',rows.length?'조건에 맞는 탐색 결과가 없습니다.':'아직 배정된 매입처 상품이 없습니다.','empty'));
}
