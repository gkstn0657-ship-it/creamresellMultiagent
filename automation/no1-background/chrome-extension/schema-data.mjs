// Whitelisted fields from No1 1.35.8's KreamPriceTable and history push contract.
const fail=()=>{throw Error('NO1_INVALID_RESPONSE');};
const number=v=>v==null?null:typeof v==='number'&&Number.isFinite(v)?v:fail();
const count=v=>v==null?null:typeof v==='number'&&Number.isFinite(v)&&v>=0?v:fail();
const text=v=>v==null?null:typeof v==='string'&&v.length<=300?v:fail();
const bool=v=>typeof v==='boolean'?v:fail();
const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o?.[k]!==undefined).map(k=>[k,text(o[k])]));
export function projectHistory(data,payload){
  if(String(data.productCode)!==payload.productCode||!['partial','final'].includes(data.stage)||!data.perSize||Array.isArray(data.perSize)||typeof data.perSize!=='object'||Object.keys(data.perSize).length>1000)fail();
  const perSize=Object.fromEntries(Object.entries(data.perSize).map(([size,v])=>{
    if(!v||typeof v!=='object'||size.length>100)fail();
    return [size,{estimated30d:count(v.estimated30d),confidence:typeof v.confidence==='number'?count(v.confidence):text(v.confidence),mode:text(v.mode)}];
  }));
  return {productCode:payload.productCode,taskId:text(data.taskId),stage:data.stage,mode:text(data.mode),perSize,
    cacheInfo:data.cacheInfo?{...pick(data.cacheInfo,['fetchedAt','nextResetAt','refreshAvailableAt','state']),refreshWaitMs:count(data.cacheInfo.refreshWaitMs)}:null,
    meta:pick(data.meta,['productType','subMode','source']),errorCode:text(data.errorCode)};
}
export function projectMarginSettings(data){
  if(data.source!=='no1_web_saved_settings')fail();
  const feePercent=count(data.feePercent),inspectionFee=count(data.inspectionFee);
  if(feePercent===null||feePercent>100||inspectionFee===null)fail();
  return {source:data.source,feePercent,inspectionFee,taxMode:bool(data.taxMode),observedAt:text(data.observedAt)};
}
export function projectDisplayedSchema(data,payload){
  if(typeof data.available!=='boolean')fail();
  if(!data.available)return {available:false,reason:text(data.reason)};
  if(String(data.productCode)!==payload.productCode||!Array.isArray(data.rows)||data.rows.length>1000||!data.inputs)fail();
  const i=data.inputs;
  if(!['fast','normal','instant','desired'].includes(i.marginMode))fail();
  return {available:true,productCode:payload.productCode,source:'no1_web_displayed_table',observedAt:text(data.observedAt),
    inputs:{marginMode:i.marginMode,purchasePrice:count(i.purchasePrice),desiredSellingPrice:count(i.desiredSellingPrice),feePercent:count(i.feePercent),inspectionFee:count(i.inspectionFee),taxMode:bool(i.taxMode),applyFeeEvent:bool(i.applyFeeEvent)},
    totalText:text(data.totalText),asOfText:text(data.asOfText),salesStopped:bool(data.salesStopped),
    rows:data.rows.map(r=>({size:text(r.size),option:text(r.option),sales30d:count(r.sales30d),sales30dStatus:text(r.sales30dStatus),sales30dReasonCode:text(r.sales30dReasonCode),isEstimated:bool(r.isEstimated),confidence:typeof r.confidence==='number'?count(r.confidence):text(r.confidence),mode:text(r.mode),
      fast100:count(r.fast100),normal:count(r.normal),highestBid:count(r.highestBid),marginAmount:number(r.marginAmount),marginRate:number(r.marginRate),marginAmountText:text(r.marginAmountText),marginRateText:text(r.marginRateText),salesText:text(r.salesText)}))};
}

// Runs in the official page's MAIN world, with no writes, navigation or UI actions.
// Props identify the exact product; displayed DOM values preserve the UI rounding.
export function readDisplayedTable(productCode){
  if(location.origin!=='https://no1.certi.life'||!location.pathname.startsWith('/sourcing/'))return null;
  const snapshots=[];
  // Production Vue omits __vueParentComponent, but retains the mounted VNode.
  const tableComponents=new Map(),seen=new Set(),queue=[...document.querySelectorAll('[data-v-app]')].map(el=>el._vnode);
  while(queue.length&&seen.size<50000){const v=queue.pop();if(!v||typeof v!=='object'||seen.has(v))continue;seen.add(v);
    if(Array.isArray(v)){queue.push(...v);continue;}
    if(v.component){if(v.component.type?.__name==='KreamPriceTable')tableComponents.set(v.component.subTree?.el,v.component);queue.push(v.component.subTree);}
    if(Array.isArray(v.children))queue.push(v.children);if(v.suspense?.activeBranch)queue.push(v.suspense.activeBranch);
  }
  for(const table of document.querySelectorAll('table.kream-table')){
    let component=tableComponents.get(table)||table.__vueParentComponent;
    for(let n=0;component&&n<30;n++,component=component.parent){
      if(component.type?.__name!=='KreamPriceTable')continue;
      const p=component.props;
      if(String(p.data?.productCode)!==productCode)break;
      const lines=[...table.querySelectorAll('tbody > tr')].filter(tr=>tr.querySelector('.size-cell'));
      if(lines.length!==p.data.sizes.length)break;
      const numeric=s=>{const clean=s.replace(/[,원%\s]/g,'');return /^[+-]?\d+(\.\d+)?$/.test(clean)?Number(clean):null;};
      snapshots.push({available:true,productCode,observedAt:new Date().toISOString(),inputs:{...Object.fromEntries(['marginMode','purchasePrice','desiredSellingPrice','feePercent','inspectionFee','taxMode'].map(k=>[k,p.marginInputs[k]])),applyFeeEvent:p.applyFeeEvent??true},
        totalText:table.querySelector('.sum-value')?.innerText?.trim()||null,asOfText:table.querySelector('.sum-asof-text')?.innerText?.trim()||null,salesStopped:p.salesStopped===true,
        rows:p.data.sizes.map((r,n)=>{const line=lines[n],amount=line.querySelector('.margin-value')?.innerText?.trim()||'',rate=line.querySelector('.ros-value')?.innerText?.trim()||'';
          return {...Object.fromEntries(['size','option','sales30d','sales30dStatus','sales30dReasonCode','isEstimated','confidence','mode','fast100','normal','highestBid'].map(k=>[k,r[k]??(k==='isEstimated'?false:null)])),marginAmount:numeric(amount),marginRate:numeric(rate),marginAmountText:amount,marginRateText:rate,salesText:line.querySelector('.sales-cell')?.innerText?.trim()||null};})});break;
    }
  }
  return snapshots;
}

export function readSavedMarginSettings(){
  if(location.origin!=='https://no1.certi.life'||!location.pathname.startsWith('/sourcing/'))return null;
  let saved={};try{saved=JSON.parse(localStorage.getItem('priceCompareFee.v2')||'{}');}catch{}
  let percent=saved.kream?.percent;
  if(saved.schemaVersion>=3&&saved.schemaVersion<4&&(!percent||percent==='4'))percent='6';
  const feePercent=percent==null||percent===''?6:parseFloat(percent);
  const stored=localStorage.getItem('market:kreamInspectionFee');
  const inspectionFee=!stored||stored==='5000'?2500:parseInt(stored,10);
  return {source:'no1_web_saved_settings',feePercent:Number.isNaN(feePercent)?6:feePercent,inspectionFee:Number.isNaN(inspectionFee)?2500:inspectionFee,taxMode:localStorage.getItem('market:taxMode')==='true',observedAt:new Date().toISOString()};
}
