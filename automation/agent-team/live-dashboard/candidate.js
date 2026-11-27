const $=id=>document.getElementById(id);
const put=(id,value)=>{$(id).textContent=value??'—';};
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const number=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('ko-KR'):'미확인';
const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR'):'시각 미확인';
const modeName={fast:'보관판매',normal:'일반판매',instant:'즉시판매',cn:'CN 판매'};
const feeName={explicit_overrides_with_no1_defaults:'확인된 설정과 No1 기본 수수료',no1_displayed_value:'No1 화면 표시값',no1_formula_with_observed_inputs:'관측 조건으로 재계산'};
const issueName={upstreamDataAsOf:'원자료 기준시각',actualCheckoutPrice:'실제 결제 금액',shippingAndSellerFees:'배송비와 판매 수수료',couponQuantityEligibilityAtCheckout:'결제 시 쿠폰·수량 적용 가능 여부',UPSTREAM_FRESHNESS_UNKNOWN:'원자료 최신성 미확인',CALCULATION_MISSING:'계산 근거 일부 누락'};
const salesName={no1_history_per_size:'No1 옵션별 체결 기록'};
const parameters=new URL(location.href).searchParams,run=parameters.get('run'),productId=parameters.get('product');
if(run)$('back').href='/herdr?run='+encodeURIComponent(run);
function sourceLink(url){if(!url)return;try{const parsed=new URL(url);if(parsed.protocol==='https:'&&['musinsa.com','www.musinsa.com'].includes(parsed.hostname)){const link=$('source-link');link.href=parsed.href;link.hidden=false;}}catch{}}
function render(data){
 const p=data.product,options=p.options||[],platforms=[...new Set(options.map(o=>(o.platform||'kream').toUpperCase()))];
 document.title=(p.name||data.productId)+' · 채택 후보 · Cream';
 put('candidate-name',p.name||data.productId);put('candidate-identity',`${p.platform} ${data.productId} · 독립 검수된 조사 후보`);
 put('candidate-rank',data.source?.rank!=null?`${data.source.rank}위`:'—');put('candidate-reviewed','검수 판단 '+date(p.reviewedAt));
 const reviewer=p.actors?.find(a=>a.role==='reviewer');put('candidate-model',reviewer?.model?`독립 검수 ${reviewer.model} / ${reviewer.effort||'강도 미기록'}`:'독립 검수 기록 확인');
 put('candidate-options',`${options.length}개`);put('candidate-markets',platforms.length?platforms.join(' · '):'옵션 자료 없음');
 const observed=options.map(o=>o.observedAt).filter(Boolean).sort().at(-1);put('candidate-observed',date(observed));put('candidate-gaps',`${(p.unresolved||[]).length}건`);
 put('candidate-reason',p.reason||'저장된 판단 이유가 없습니다.');put('candidate-source',data.source?`${data.source.rank??'순위 미확인'}위 · 무신사 ${data.source.sourceId} · ${data.source.name}`:'매입처 순위 연결 미확인');sourceLink(data.source?.url||p.sourceUrl);
 const list=$('candidate-options-list');for(const o of options){
  const card=el('article',null,'candidate-option');const heading=el('div',null,'candidate-option-heading');heading.append(el('span',(o.platform||'kream').toUpperCase(),'candidate-platform'),el('strong',o.size||'옵션 미확인'));card.append(heading);
  const facts=el('div',null,'candidate-facts');for(const [label,value] of [['매입처 재고',number(o.stock)],['30일 판매량',`${number(o.sales)} · ${o.salesEstimated===true?'추정':o.salesEstimated===false?'기록':'구분 미확인'}`],['관측 시각',date(o.observedAt)]]){const cell=el('div');cell.append(el('small',label),el('strong',value));facts.append(cell);}card.append(facts);
  const table=el('table'),head=el('thead'),headRow=el('tr');for(const label of ['판매 방식','예상 마진','예상 수익률','수수료 근거'])headRow.append(el('th',label));head.append(headRow);table.append(head);const body=el('tbody');
  for(const margin of o.margins||[]){const row=el('tr');const amount=el('td',typeof margin.amount==='number'?number(margin.amount)+'원':'계산 불가',typeof margin.amount==='number'?(margin.amount>0?'positive':margin.amount<0?'negative':''):'unknown');const cells=[el('td',modeName[margin.mode]||margin.mode||'미확인'),amount,el('td',typeof margin.rate==='number'?margin.rate.toFixed(2)+'%':'—'),el('td',feeName[margin.feeBasis]||margin.feeBasis||'미확인')];for(const [i,cell] of cells.entries()){cell.dataset.label=['판매 방식','예상 마진','예상 수익률','수수료 근거'][i];row.append(cell);}body.append(row);}table.append(body);if(body.children.length){const wrap=el('div',null,'candidate-table-wrap');wrap.append(table);card.append(wrap);}else card.append(el('p','저장된 판매 방식별 계산값이 없습니다.','candidate-help'));
  const evidence=el('p',`판매 근거: ${salesName[o.salesBasis]||o.salesBasis||o.salesStatus||'미확인'} · 원자료 ${o.observationId||'연결 미기록'}`,'candidate-evidence');card.append(evidence);list.append(card);
 }
 if(!options.length)list.append(el('p','연결된 옵션의 수치 자료가 없습니다. 채택 판단 이유와 미확인 사항을 확인하세요.','candidate-help'));
 const unresolved=$('candidate-unresolved');for(const item of p.unresolved||[])unresolved.append(el('li',issueName[item]||item));if(!unresolved.children.length)unresolved.append(el('li','저장된 미확인 사항이 없습니다.'));
 $('loading').hidden=true;$('candidate-content').hidden=false;
}
try{
 if(!run||!productId)throw Error('작업과 상품을 지정해 주세요.');
 const response=await fetch('/api/herdr/candidate?run='+encodeURIComponent(run)+'&product='+encodeURIComponent(productId),{signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('독립 검수가 확인된 채택 후보를 찾지 못했습니다.');
 render(await response.json());
}catch(error){$('loading').hidden=true;$('candidate-error').hidden=false;$('candidate-error').textContent=error.message;}
