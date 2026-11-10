import {buildMarketSchema} from './market-schema.mjs';
import {sizeKey} from '../no1-background/size-binding.mjs';
const DAY=86400000;
const median=xs=>{const a=xs.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
export function recentSales(trades,size) {
  const end=Date.parse(trades?.windowEnd);
  if(!Number.isFinite(end)||!Array.isArray(trades?.items))return {status:'unavailable',direction:null};
  const valid=trades.items.filter(t=>Number.isFinite(Date.parse(t.date))&&Date.parse(t.date)<=end&&Number.isFinite(t.price)&&t.price>=0);
  const oldest=valid.length?Math.min(...valid.map(t=>Date.parse(t.date))):Infinity;
  const issues=trades.issues||[];
  const complete=valid.length===trades.items.length&&issues.length===0&&(trades.coverageComplete===true||oldest<end-14*DAY);
  const rows=valid.filter(t=>sizeKey(t.size)===sizeKey(size));
  const current=rows.filter(t=>Date.parse(t.date)>end-7*DAY),previous=rows.filter(t=>Date.parse(t.date)<=end-7*DAY&&Date.parse(t.date)>end-14*DAY);
  const currentMedian=median(current.map(t=>t.price)),previousMedian=median(previous.map(t=>t.price));
  const latest=rows.slice().sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0];
  return {status:complete?'complete':'observed_only',windowEnd:trades.windowEnd,size,
    latestTrade:latest?{date:latest.date,price:latest.price}:null,
    last7d:{observedCount:current.length,medianPrice:currentMedian},previous7d:{observedCount:previous.length,medianPrice:previousMedian},
    direction:complete?(current.length>previous.length?'increasing':current.length<previous.length?'decreasing':'unchanged'):null,
    medianPriceChange:complete&&currentMedian!==null&&previousMedian!==null?currentMedian-previousMedian:null};
}
export function musinsaSignals(observations=[]) {
  const latest=new Map();
  for(const o of observations)if(o.active!==false&&['no1_product','collection_error'].includes(o.kind)) {
    const r=o.payload?.request;if(!r)continue;
    const key=JSON.stringify([r.market||'kream',r.poizonId||r.kreamId,r.productUrl,r.color,r.option]);
    if(!latest.has(key)||Date.parse(o.observedAt)>=Date.parse(latest.get(key).observedAt))latest.set(key,o);
  }
  return [...latest.values()].map(o=>{
    if(o.kind==='collection_error')return {observationId:o.id||null,productId:o.payload.request.kreamId,observedAt:o.observedAt,status:'collection_failed',error:o.payload.code,stock:null,rows:[],purchaseAuthorized:false};
    const p=o.payload,s=buildMarketSchema(o),research=p.marketResearch||{};
    return {observationId:o.id||null,platform:s.platform||'kream',marketProductId:s.marketProductId||s.productId,productId:s.productId,sourceUrl:s.sourceUrl,sourceOption:s.sourceOption,observedAt:o.observedAt,marketChecks:p.marketChecks||null,
      sourceModelVerified:p.identity?.sourceModelVerified===true,marketModelVerified:p.identity?.marketModelIndependentlyVerified===true,
      stock:{quantity:p.stock?.selectedStockQuantity??null,available:p.stock?.selectedOption?.isAvailable??null},
      marginInputs:s.inputs,purchaseMatchesSourceQuote:s.purchaseMatchesSourceQuote,
      salesAsOf:s.salesAsOf,rows:s.rows.map(r=>{
        const selected=research.selectedTrades?.selectedSize;
        const trades=selected&&sizeKey(selected)===sizeKey(r.size)?research.selectedTrades:research.trades;
        return {size:r.size,sourceOptionMatched:r.sourceOptionMatched,referenceOnly:!r.sourceOptionMatched,
          margins:Object.fromEntries(Object.entries(r.margins).map(([mode,m])=>[mode,{salePrice:m.salePrice,amount:m.marginAmount,rate:m.marginRate,status:m.status,source:m.source,feeEventVerified:m.feeEventVerified??false}])),
          sales30d:{count:r.expectedSales30d,status:r.salesStatus,estimated:r.salesIsEstimated,basis:r.salesBasis,...(s.platform==='poizon'?{region:'GLOBAL',localSellerCount:r.localSales30d,localRegion:'LOCAL'}:{})},recent:s.platform==='poizon'?r.recent:recentSales(trades,r.size),...(s.platform==='poizon'?{localRecent:r.localRecent}:{})};
      }),purchaseAuthorized:false};
  });
}
// Materialize deterministic calculations so the independent reviewer can read
// their evidence ID, exact source IDs and formula, rather than recomputing them.
export function saveMusinsaSignals(store) {
  const sources=store.data.observations.filter(o=>o.active!==false&&['no1_product','collection_error'].includes(o.kind));
  const sourceIds=sources.map(o=>o.id);
  const old=store.data.observations.findLast(o=>o.active!==false&&o.kind==='musinsa_screening_signals');
  if(old?.payload.version===2&&JSON.stringify(old.payload.sourceIds)===JSON.stringify(sourceIds))return old;
  if(old)old.active=false;
  return store.observe('musinsa_screening_signals',{
    version:2,sourceIds,calculationSource:'deterministic_from_saved_no1_records',
    method:{margin:'No1 formula or directly displayed value; see per-mode source and marginInputs',
      recent:'KREAM: per-size individual record counts and median prices. POIZON: per-SKU daily aggregate counts and count-weighted chart prices; GLOBAL and LOCAL separately. No direction claim without complete 14-day coverage. Missing/abbreviated table counts stay unknown.',
      stock:'Selected source option only; zero and unknown preserved'},
    signals:musinsaSignals(sources)
  },{mode:sources.length&&sources.every(o=>o.mode==='live')?'live':'replay',observedAt:sources.length?new Date(Math.min(...sources.map(o=>Date.parse(o.observedAt)))).toISOString():new Date().toISOString()});
}
export function readSavedMusinsaSignals(store) {
  const saved=store.data.observations.findLast(o=>o.active!==false&&o.kind==='musinsa_screening_signals');
  return saved?saved.payload.signals.map(s=>({...s,calculationObservationId:saved.id})):musinsaSignals(store.data.observations);
}
