const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const names={all:'전체',adopt:'채택 후보',hold:'보류',exclude:'제외',pending:'진행·확인 필요'};
const modes={fast:'보관',normal:'일반',instant:'즉시',cn:'CN'};
const num=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('ko-KR'):'미확인';
let run='',filter='all',query='',data=null;
const classification=p=>p.verified&&p.status==='complete'&&['adopt','hold','exclude'].includes(p.decision)?p.decision:'pending';
export function renderResults(d){
 data=d;if(run!==d.selected){run=d.selected;filter='all';query='';}
 const host=document.getElementById('results');if(!host)return;
 const open=new Set([...host.querySelectorAll('details[open]')].map(n=>n.dataset.id));
 const map=new Map();for(const b of d.batches||[])for(const p of b.products||[]){const old=map.get(p.productId);if(!old||String(p.details?.at||'')>=String(old.details?.at||''))map.set(p.productId,p);}
 const rows=[...map.values()].sort((a,b)=>Number(classification(b)==='adopt')-Number(classification(a)==='adopt')||String(b.details?.at||'').localeCompare(String(a.details?.at||'')));
 const counts={all:rows.length,adopt:0,hold:0,exclude:0,pending:0};for(const p of rows)counts[classification(p)]++;
 const tabs=document.getElementById('result-tabs');tabs.replaceChildren(...Object.entries(names).map(([key,name])=>{const b=el('button');b.type='button';b.className=filter===key?'selected':'';b.setAttribute('aria-pressed',String(filter===key));b.append(el('span',name),el('strong',counts[key]));b.onclick=()=>{filter=key;renderResults(data);};return b;}));
 const search=document.getElementById('result-search');if(document.activeElement!==search)search.value=query;search.oninput=()=>{query=search.value;renderResults(data);};
 const filtered=rows.filter(p=>(filter==='all'||classification(p)===filter)&&[p.productId,p.details?.name,p.reason].join(' ').toLowerCase().includes(query.toLowerCase()));
 document.getElementById('result-caption').textContent='선택한 작업 · 시장별 상품 판단 '+rows.length+'건 · 수집 단계 제외 '+(d.skipped||0)+'건은 별도';
 host.replaceChildren(...filtered.map(p=>{
 const detail=el('details',null,'result-item');detail.dataset.id=p.productId;detail.open=open.has(p.productId);const summary=el('summary');
 const title=el('div',null,'result-title');title.append(el('strong',p.details?.name||p.productId),el('small',(String(p.productId).startsWith('poizon-')?'POIZON':'KREAM')+' · '+p.productId));
 const badge=el('span',names[classification(p)],'result-badge '+classification(p));summary.append(title,badge,el('span',p.verified?'검수 확인':'검수 미완료','result-review'));detail.append(summary);
 const content=el('div',null,'result-body');content.append(el('p',p.reason||p.error||'판단 결과를 기다리고 있습니다.','result-reason'));
 if(p.details?.sourceUrl){try{const u=new URL(p.details.sourceUrl);if(u.protocol==='https:'&&['www.musinsa.com','musinsa.com'].includes(u.hostname)){const link=el('a','구매처 상품 보기 ↗');link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';content.append(link);}}catch{}}
 const table=el('table'),thead=el('thead'),tr=el('tr');for(const h of ['시장 / 옵션','재고','30일 판매량¹','판매 방식','예상 마진²','수익률²'])tr.append(el('th',h));thead.append(tr);table.append(thead);const body=el('tbody');
 for(const o of p.details?.options||[])for(const m of o.margins||[]){const r=el('tr');const known=typeof m.amount==='number'&&Number.isFinite(m.amount);for(const v of [(o.platform||'kream').toUpperCase()+' / '+o.size,num(o.stock),num(o.sales)+(o.salesEstimated===true?' (추정)':o.salesEstimated===false?' (기록)':' (구분 미확인)'),modes[m.mode]||m.mode,known?num(m.amount)+'원':'계산 불가',typeof m.rate==='number'&&Number.isFinite(m.rate)?m.rate.toFixed(2)+'%':'—'])r.append(el('td',v));r.children[4].className=known?(m.amount>0?'positive':m.amount<0?'negative':''):'unknown';body.append(r);}
 table.append(body);const wrap=el('div',null,'result-table-wrap');wrap.append(table);if(body.children.length)content.append(wrap);else content.append(el('p','연결된 옵션의 수치 자료가 없습니다.','result-note'));
 const times=[...new Set((p.details?.options||[]).map(o=>o.observedAt).filter(Boolean))];content.append(el('p','관측: '+(times.length?times.map(t=>new Date(t).toLocaleString('ko-KR')).join(' / '):'시각 미확인'),'result-note'));
 content.append(el('p','¹ 옵션별 저장 판매량이며 추정/기록을 구분합니다. ² 저장된 수수료·이벤트 조건의 예상값이며 확정 순이익이 아닙니다. 모든 표시 옵션이 채택된 것은 아닙니다.','result-note'));
 const bases=[...new Set((p.details?.options||[]).flatMap(o=>(o.margins||[]).map(m=>m.feeBasis)).filter(Boolean))];if(bases.length)content.append(el('p','수수료 근거: '+bases.join(', '),'result-note'));
 if(p.details?.unresolved?.length){const gaps=el('div',null,'result-gaps');gaps.append(el('strong','미확인·유의사항'));const list=el('ul');for(const g of p.details.unresolved)list.append(el('li',g));gaps.append(list);content.append(gaps);}
 detail.append(content);return detail;
 }));
 if(!filtered.length)host.append(el('p',rows.length?'조건에 맞는 결과가 없습니다.':'아직 저장된 상품 판단이 없습니다. 수집 제외는 채택·보류·제외 판단으로 집계하지 않습니다.','empty'));
}
