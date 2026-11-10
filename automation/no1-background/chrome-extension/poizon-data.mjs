// Read-only contracts from No1 Seller Center 1.35.8 and its public price table.
export const POIZON_COMMANDS=['market:poizon:search','market:poizon:prices','market:poizon:chart','market:poizon:margin-settings','market:poizon:displayed-schema'];
const fail=()=>{throw Error('NO1_INVALID_RESPONSE');};
const id=v=>typeof v==='string'&&/^\d{1,18}$/.test(v);
const txt=v=>v==null?null:typeof v==='string'&&v.length<=500?v:fail();
const num=v=>v==null?null:typeof v==='number'&&Number.isFinite(v)&&v>=0?v:fail();
const signed=v=>v==null?null:typeof v==='number'&&Number.isFinite(v)?v:fail();
const fields=(o,allowed,required)=>required.every(k=>Object.hasOwn(o,k))&&Object.keys(o).every(k=>allowed.includes(k));
const model=v=>typeof v==='string'&&/^[\p{L}\p{N}][\p{L}\p{N} ._()/+-]{0,99}$/u.test(v);
const rows=v=>Array.isArray(v)&&v.length<=1000?v:fail();
export function validPoizonRequest(cmd,p){
 if(cmd.endsWith(':margin-settings'))return Object.keys(p).length===0;
 if(cmd.endsWith(':search'))return fields(p,['keyword','cursor'],['keyword','cursor'])&&model(p.keyword)&&/^[1-9]\d{0,2}$/.test(p.cursor);
 if(cmd.endsWith(':displayed-schema'))return fields(p,['spuId'],['spuId'])&&id(p.spuId);
 if(cmd.endsWith(':prices'))return fields(p,['spuId','styleCode','globalSpuId'],['spuId','styleCode'])&&id(p.spuId)&&model(p.styleCode)&&(p.globalSpuId===undefined||id(p.globalSpuId));
 if(cmd.endsWith(':chart'))return fields(p,['spuId','globalSpuId','skuId','range','saleRegion'],['spuId','skuId','range','saleRegion'])&&id(p.spuId)&&id(p.skuId)&&(p.globalSpuId===undefined||id(p.globalSpuId))&&p.range===1&&['GLOBAL','LOCAL'].includes(p.saleRegion);
 return false;
}
function product(p){if(!p||!id(String(p.spuId))||!model(p.styleCode))fail();return {spuId:String(p.spuId),globalSpuId:p.globalSpuId==null?null:id(String(p.globalSpuId))?String(p.globalSpuId):fail(),styleCode:p.styleCode,name:txt(p.name),colorName:txt(p.colorName),brandName:txt(p.brandName),level1CategoryName:txt(p.level1CategoryName),bidStatus:p.bidStatus==null?null:[0,1].includes(p.bidStatus)?p.bidStatus:fail(),cannotBidMessage:txt(p.cannotBidMessage)};}
function size(r){if(!r||!id(String(r.skuId)))fail();return {skuId:String(r.skuId),...Object.fromEntries(['size','sizeKR','sizeUS','sizeEU','color','apparelSize','salesCount','localSalesCount'].map(k=>[k,txt(r[k])])),cnBuyBox:num(r.cnBuyBox),avg30d:num(r.avg30d),editions:Object.fromEntries(Object.entries(r.editions||{}).map(([k,v])=>[txt(k),txt(v)]))};}
function fee(f){if(!f)fail();const result={rate:num(f.rate),minFee:num(f.minFee),maxFee:num(f.maxFee)};if(Object.values(result).some(v=>v===null)||result.rate>100||result.minFee>result.maxFee)fail();return result;}
export function projectPoizon(cmd,d,p){
 if(cmd.endsWith(':search'))return {products:rows(d.products).map(product),nextCursor:d.nextCursor==null?null:/^[1-9]\d{0,2}$/.test(d.nextCursor)?String(d.nextCursor):fail()};
 if(cmd.endsWith(':prices')){const prod=product(d.product);if(prod.spuId!==p.spuId||prod.styleCode.toUpperCase().replace(/\s/g,'')!==p.styleCode.toUpperCase().replace(/\s/g,''))throw Error('NO1_IDENTITY_MISMATCH');if(typeof d.isApparel!=='boolean')fail();return {product:prod,isApparel:d.isApparel,sizes:rows(d.sizes).map(size)};}
 if(cmd.endsWith(':chart'))return {request:{...p},chart:rows(d.chart).map(r=>{if(typeof r.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date))fail();return {date:r.date,price:num(r.price),count:num(r.count)};}),meta:{symbol:txt(d.meta?.symbol),avgPrice:num(d.meta?.avgPrice),minPrice:num(d.meta?.minPrice),maxPrice:num(d.meta?.maxPrice),salesCount:txt(d.meta?.salesCount),soldInfo:txt(d.meta?.soldInfo),tabName:txt(d.meta?.tabName)}};
 if(cmd.endsWith(':margin-settings')){if(d.source!=='no1_web_saved_settings'||typeof d.taxMode!=='boolean'||!['apparelShoes','goods'].includes(d.category))fail();return {source:d.source,category:d.category,taxMode:d.taxMode,fees:{apparelShoes:fee(d.fees?.apparelShoes),goods:fee(d.fees?.goods)},observedAt:txt(d.observedAt)};}
 if(cmd.endsWith(':displayed-schema')){
  if(d.available===false)return {available:false,reason:txt(d.reason)};
  if(d.available!==true||String(d.spuId)!==p.spuId||!d.inputs||typeof d.inputs.taxMode!=='boolean'||typeof d.inputs.useDesiredPrice!=='boolean')fail();
  return {available:true,spuId:p.spuId,source:'no1_web_displayed_table',observedAt:txt(d.observedAt),inputs:{purchasePrice:num(d.inputs.purchasePrice),desiredSellingPrice:num(d.inputs.desiredSellingPrice),useDesiredPrice:d.inputs.useDesiredPrice,taxMode:d.inputs.taxMode,fee:fee(d.inputs.fee)},rows:rows(d.rows).map(r=>({...size(r),marginAmount:signed(r.marginAmount),marginRate:signed(r.marginRate),marginAmountText:txt(r.marginAmountText),marginRateText:txt(r.marginRateText)}))};
 }
 fail();
}
// Runs in the existing No1 tab; reads only fee keys, never account stores.
export function readPoizonMarginSettings(){
 if(location.origin!=='https://no1.certi.life'||!location.pathname.startsWith('/sourcing/'))return null;
 let saved={};try{saved=JSON.parse(localStorage.getItem('priceCompareFee.v2')||'{}');}catch{}
 const defaults={apparelShoes:{rate:10,minFee:15000,maxFee:45000},goods:{rate:14,minFee:18000,maxFee:45000}};
 const p=saved.schemaVersion>=3?saved.poizon||{}:{apparelShoes:saved.poizon?.shoes||saved.poizon?.apparel||{}};
 const fees=Object.fromEntries(Object.entries(defaults).map(([category,d])=>[category,Object.fromEntries(Object.entries(d).map(([k,v])=>{const raw=p[category]?.[k],n=k==='rate'?parseFloat(raw):parseInt(raw,10);return [k,raw==null||raw===''||Number.isNaN(n)?v:n];}))]));
 return {source:'no1_web_saved_settings',category:['apparelShoes','goods'].includes(p.category)?p.category:'apparelShoes',fees,taxMode:localStorage.getItem('market:poizonTaxMode')==='true',observedAt:new Date().toISOString()};
}
// Read mounted table props and rendered margins without opening/switching tabs.
export function readPoizonDisplayedTable(spuId){
 if(location.origin!=='https://no1.certi.life'||!location.pathname.startsWith('/sourcing/'))return null;
 const result=[],seen=new Set(),queue=[...document.querySelectorAll('[data-v-app]')].map(el=>el._vnode);
 while(queue.length&&seen.size<50000){const v=queue.pop();if(!v||typeof v!=='object'||seen.has(v))continue;seen.add(v);if(Array.isArray(v)){queue.push(...v);continue;}
  if(v.component){const c=v.component;queue.push(c.subTree);if(c.type?.__name==='PoizonPriceTable'&&String(c.props?.data?.spuId)===spuId){
   const p=c.props,selected=p.selectedEditions||{},sizes=p.data.sizes.filter(r=>Object.entries(selected).every(([k,value])=>r.editions?.[k]===value));
   const lines=[...c.subTree.el.querySelectorAll('tbody > tr')].filter(tr=>tr.querySelector('.margin-value'));if(lines.length!==sizes.length)continue;
   const numeric=s=>{const clean=s.replace(/[,원%\s]/g,'');return /^[+-]?\d+(\.\d+)?$/.test(clean)?Number(clean):null;};
   result.push({available:true,spuId,observedAt:new Date().toISOString(),inputs:p.marginInputs,rows:sizes.map((r,i)=>{const amount=lines[i].querySelector('.margin-value')?.innerText?.trim()||'',rate=lines[i].querySelector('.ros-value')?.innerText?.trim()||'';return {...r,marginAmount:numeric(amount),marginRate:numeric(rate),marginAmountText:amount,marginRateText:rate};})});
  }}
  if(Array.isArray(v.children))queue.push(v.children);if(v.suspense?.activeBranch)queue.push(v.suspense.activeBranch);
 }
 return result;
}
