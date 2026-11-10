import {calculateMargin} from './margin-calculation.mjs';
import {offerProductId} from './market-offer.mjs';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const key=v=>String(v??'').trim().toUpperCase().replace(/\s+/g,'');
const DAY=86400000;
// Abbreviations, plus signs, and unknown counts are not exact sales counts.
export const exactPoizonCount=v=>typeof v==='string'&&/^\d+(?:,\d{3})*$/.test(v.trim())&&Number.isSafeInteger(Number(v.replaceAll(',','')))?Number(v.replaceAll(',','')):null;
export function poizonRecent(chart,observedAt){
 const all=chart?.chart||[],valid=all.filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&Number.isFinite(Date.parse(r.date))&&new Date(r.date).toISOString().startsWith(r.date)&&Number.isSafeInteger(r.count)&&r.count>=0);
 const rows=[...valid].sort((a,b)=>a.date.localeCompare(b.date)),end=rows.length?Date.parse(rows.at(-1).date):NaN;
 const now=Date.parse(observedAt),dates=new Set(rows.map(r=>r.date));
 const complete=valid.length===all.length&&dates.size===rows.length&&now-end>=0&&now-end<=2*DAY&&Array.from({length:14},(_,i)=>new Date(end-i*DAY).toISOString().slice(0,10)).every(d=>dates.has(d));
 const summarize=items=>{const priced=items.filter(r=>r.price>0&&r.count>0),n=priced.reduce((n,r)=>n+r.count,0);return {observedCount:items.reduce((n,r)=>n+r.count,0),weightedChartPrice:n?priced.reduce((s,r)=>s+r.price*r.count,0)/n:null};};
 const last7d=summarize(rows.filter(r=>Date.parse(r.date)>end-7*DAY)),previous7d=summarize(rows.filter(r=>Date.parse(r.date)<=end-7*DAY&&Date.parse(r.date)>end-14*DAY));
 return {status:!rows.length?'unavailable':complete?'complete':'observed_only',basis:'no1_poizon_daily_aggregate_not_individual_trades',saleRegion:chart?.request?.saleRegion||null,windowEnd:Number.isFinite(end)?new Date(end).toISOString():null,last7d,previous7d,direction:complete?(last7d.observedCount>previous7d.observedCount?'increasing':last7d.observedCount<previous7d.observedCount?'decreasing':'unchanged'):null,priceChange:complete&&last7d.weightedChartPrice!==null&&previous7d.weightedChartPrice!==null?last7d.weightedChartPrice-previous7d.weightedChartPrice:null};
}
export function buildPoizonSchema(observation,{desiredSellingPrice}={}){
 const p=observation.payload||{},r=p.request||{},research=p.marketResearch||{},market=p.market||{};
 const identity=p.identity?.sourceProductVerified===true&&p.identity?.sourceOptionVerified===true;
 const validQuote=identity&&String(p.benefits?.productId)===r.productUrl?.split('/').at(-1)&&key(p.benefits?.styleNo)===key(r.model);
 const purchase=validQuote&&Number.isSafeInteger(p.benefits?.maxBenefitPrice)&&p.benefits.maxBenefitPrice>=0?p.benefits.maxBenefitPrice:null;
 const screen=research.displayedSchema?.available===true&&research.displayedSchema.spuId===r.poizonId?research.displayedSchema:null;
 const stored=research.marginSettings?.source==='no1_web_saved_settings'?research.marginSettings:null;
 const inputs=screen?{...screen.inputs}:{purchasePrice:purchase,desiredSellingPrice:null,useDesiredPrice:false,taxMode:stored?.taxMode??null,fee:stored?.fees?.[stored.category]||null,feeCategory:stored?.category||null};
 if(desiredSellingPrice!==undefined){if(!Number.isSafeInteger(desiredSellingPrice)||desiredSellingPrice<0)throw Error('MARGIN_OPTIONS_INVALID');inputs.desiredSellingPrice=desiredSellingPrice;}
 const fee=inputs.fee,feesKnown=fee&&[fee.rate,fee.minFee,fee.maxFee].every(finite)&&fee.rate>=0&&fee.rate<=100&&fee.minFee>=0&&fee.minFee<=fee.maxFee&&typeof inputs.taxMode==='boolean';
 const priceIdentity=market.product?.spuId===r.poizonId&&key(market.product?.styleCode)===key(p.marketIdentityEvidence?.market?.styleCode);
 const raw=screen?.rows||market.sizes||[],skuCounts=new Map();for(const row of raw)skuCounts.set(row.skuId,(skuCounts.get(row.skuId)||0)+1);
 const rows=raw.map(row=>{
  const bound=identity&&priceIdentity&&skuCounts.get(row.skuId)===1&&p.sizeBinding?.skuId===row.skuId&&key(p.sizeBinding.sourceSize)===key(r.option);
  const global=research.charts?.GLOBAL,local=research.charts?.LOCAL;
  const scoped=(c,region)=>c?.request?.spuId===r.poizonId&&c.request.skuId===row.skuId&&c.request.range===1&&c.request.saleRegion===region;
  const count=exactPoizonCount(row.salesCount),localCount=exactPoizonCount(row.localSalesCount);
  const margins=Object.fromEntries([['cn','CN 최저입찰'],['desired','희망 판매가']].map(([mode,label])=>{
   const salePrice=mode==='cn'?row.cnBuyBox:inputs.desiredSellingPrice;
   const direct=screen&&mode===(screen.inputs.useDesiredPrice?'desired':'cn')&&(mode!=='desired'||desiredSellingPrice===undefined||desiredSellingPrice===screen.inputs.desiredSellingPrice);
   const calculation=calculateMargin({platform:'poizon',salePrice,purchasePrice:feesKnown?inputs.purchasePrice:null,taxMode:inputs.taxMode??false,...(feesKnown?{fees:{poizonPercent:fee.rate,poizonMinFee:fee.minFee,poizonMaxFee:fee.maxFee}}:{})});
   return [mode,{...calculation,...(direct?{marginAmount:row.marginAmount,marginRate:row.marginRate,marginAmountText:row.marginAmountText,marginRateText:row.marginRateText,status:row.marginAmount==null?'unknown':row.marginAmount>0?'profit':row.marginAmount<0?'loss':'break_even'}:{}),saleModeLabel:label,source:direct?'no1_displayed_value':'no1_formula_with_observed_inputs',feeSettingsVerified:Boolean(feesKnown),screenValueVerified:Boolean(direct),hypothetical:mode==='desired'}];
  }));
  return {skuId:row.skuId,size:row.size||row.apparelSize||row.sizeKR||row.sizeEU||row.skuId,option:row.skuId,sourceOptionMatched:bound,stockQuantity:bound?p.stock?.selectedStockQuantity??null:null,expectedSales30d:count,localSales30d:localCount,salesText:row.salesCount,localSalesText:row.localSalesCount,salesStatus:count===null?'unavailable':scoped(global,'GLOBAL')?'ok':'partial',salesIsEstimated:false,salesBasis:'no1_poizon_sku_30d_aggregate_not_individual_records',saleRegion:'GLOBAL',localSaleRegion:'LOCAL',margins,recent:poizonRecent(scoped(global,'GLOBAL')?global:null,observation.observedAt),localRecent:poizonRecent(scoped(local,'LOCAL')?local:null,observation.observedAt)};
 });
 return {version:'no1-poizon-price-table-v1',platform:'poizon',productId:offerProductId(r),marketProductId:r.poizonId,model:r.model,sourceUrl:r.productUrl,sourceOption:r.option,observationId:observation.id||null,observationMode:observation.mode||'unknown',observedAt:observation.observedAt,source:screen?'no1_displayed_table':'no1_relay_table_sources',displayedValueVerified:Boolean(screen),inputs,settingsSource:screen?'no1_displayed_inputs':stored?.source||'unavailable',purchaseMatchesSourceQuote:purchase!==null&&inputs.purchasePrice===purchase,bidStatus:market.product?.bidStatus??null,cannotBidMessage:market.product?.cannotBidMessage||null,salesAsOf:{timestamp:null,observationAt:observation.observedAt,state:'upstream_timestamp_unavailable'},rows,limitations:['CN 최저입찰은 체결 보장이 아닙니다.','글로벌 30일 판매와 한국 판매자 30일 판매는 별도 집계이며 합산하지 않습니다.','상류 캐시 시각·실결제 혜택 자격·배송비는 미확인입니다.','포이즌 일별 차트는 개별 체결 기록이 아닙니다.'],purchaseAuthorized:false};
}
