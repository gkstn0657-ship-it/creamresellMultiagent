import {calculateMargin,SALE_MODES} from './margin-report.mjs';
import {sizeKey} from '../no1-background/size-binding.mjs';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
// No1 fc/XA size keys, preserving its 30-day table mapping (not shoe conversion).
export function no1SalesKey(value){const s=String(value??'').trim(),fit=s.match(/^(\d{2})\s*-\s*([SRT])$/i);return fit?`${fit[1]}-${fit[2].toUpperCase()}`:(s.match(/[\d.]+/g)?.join('.')||s.toLowerCase());}
export function salesAsOf(cache,now=Date.now()){
  const ms=Date.parse(cache?.fetchedAt),shift=9*3600000;
  if(!Number.isFinite(ms))return {timestamp:null,timeLabel:null,state:cache?.state||null};
  const d=new Date(ms+shift),days=Math.floor((now+shift)/86400000)-Math.floor((ms+shift)/86400000),time=`${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
  return {timestamp:cache.fetchedAt,timeLabel:(days===0?'오늘':days===1?'어제':`${d.getUTCMonth()+1}월 ${d.getUTCDate()}일`)+` ${time}`,state:cache.state||null};
}
export function buildMarketSchema(observation,{desiredSellingPrice}={},now=Date.now()){
  const p=observation.payload||{},request=p.request||{},research=p.marketResearch||{},history=research.sales30d;
  const screen=research.displayedSchema?.available&&research.displayedSchema.productCode===request.kreamId?research.displayedSchema:null;
  const stored=research.marginSettings?.source==='no1_web_saved_settings'?research.marginSettings:null;
  const identified=p.identity?.sourceProductVerified===true&&p.identity?.sourceOptionVerified===true;
  const validQuote=identified&&String(p.benefits?.productId)===request.productUrl?.split('/').at(-1)&&String(p.benefits?.styleNo||'').trim().toUpperCase()===String(request.model||'').trim().toUpperCase();
  const sourceQuote=validQuote&&finite(p.benefits?.maxBenefitPrice)?p.benefits.maxBenefitPrice:null;
  const inputs=screen?{...screen.inputs}:{purchasePrice:sourceQuote,desiredSellingPrice:desiredSellingPrice??null,feePercent:stored?.feePercent??null,inspectionFee:stored?.inspectionFee??null,taxMode:stored?.taxMode??null,applyFeeEvent:true,marginMode:null};
  if(desiredSellingPrice!==undefined){if(!Number.isSafeInteger(desiredSellingPrice)||desiredSellingPrice<0)throw Error('MARGIN_OPTIONS_INVALID');inputs.desiredSellingPrice=desiredSellingPrice;}
  const rawRows=screen?.rows||research.details?.sizeOptions?.map(r=>({size:r.size,option:r.option,fast100:r.fastDeliveryPrice??null,normal:r.lowestNormal,highestBid:r.highestBid}))||[];
  const perSize=new Map(),duplicates=new Set();
  if(history?.productCode===request.kreamId)for(const [key,value] of Object.entries(history.perSize||{})){const normalized=no1SalesKey(key);if(perSize.has(normalized))duplicates.add(normalized);perSize.set(normalized,value);}
  const final=history?.stage==='final'&&!history.errorCode&&!['updating','collecting-elsewhere','failed'].includes(history.cacheInfo?.state);
  const rows=rawRows.map(r=>{
    const keys=[no1SalesKey(r.size),no1SalesKey(r.option)],collision=keys.some(k=>duplicates.has(k)),sales=collision?null:perSize.get(keys[0])??perSize.get(keys[1]);
    const count=screen?r.sales30d:history?.productCode===request.kreamId&&!collision?(sales?.estimated30d??(final?0:null)):null;
    const status=screen?(screen.salesStopped||r.mode==='collecting'?'partial':r.sales30dStatus):collision?'ambiguous':!history?'unavailable':final?'ok':'partial';
    const boundSize=p.sizeBinding?.marketSize||request.option,sourceOptionMatched=identified&&sizeKey(r.size)===sizeKey(boundSize);
    const margins=Object.fromEntries(Object.entries(SALE_MODES).map(([mode,label])=>{
      const price=mode==='fast'?r.fast100:mode==='normal'?r.normal:mode==='instant'?r.highestBid:inputs.desiredSellingPrice;
      // Only the actually displayed mode is a directly observed margin.
      if(screen&&mode===screen.inputs.marginMode&&(mode!=='desired'||desiredSellingPrice===undefined||desiredSellingPrice===screen.inputs.desiredSellingPrice))return [mode,{saleModeLabel:label,salePrice:price,marginAmount:r.marginAmount,marginRate:r.marginRate,marginAmountText:r.marginAmountText,marginRateText:r.marginRateText,source:'no1_displayed_value',status:r.marginAmount===null?'unknown':r.marginAmount>0?'profit':r.marginAmount<0?'loss':'break_even'}];
      const feesKnown=[inputs.feePercent,inputs.inspectionFee].every(finite)&&typeof inputs.taxMode==='boolean';
      const previews=(research.settlement||[]).flatMap(s=>s.previews||[]).filter(v=>String(v.productCode)===request.kreamId&&v.option===r.option&&v.price===price&&v.isInstant===(mode==='instant'));
      const result=calculateMargin({salePrice:price,purchasePrice:feesKnown?inputs.purchasePrice:null,taxMode:inputs.taxMode??false,...(feesKnown?{fees:{kreamPercent:inputs.feePercent,kreamInspectionFee:inputs.inspectionFee}}:{}),feeEvent:inputs.applyFeeEvent&&previews.length===1?previews[0]:null});
      return [mode,{...result,saleModeLabel:label,source:'no1_formula_with_observed_inputs',feeSettingsVerified:feesKnown,feeEventVerified:previews.length===1,screenValueVerified:false}];
    }));
    return {size:r.size,option:r.option,sourceOptionMatched,stockQuantity:sourceOptionMatched?p.stock?.selectedStockQuantity??null:null,
      expectedSales30d:count,salesStatus:status,salesIsEstimated:screen?r.isEstimated:history?.mode==='estimated',salesConfidence:screen?r.confidence:sales?.confidence??null,salesMode:screen?r.mode:sales?.mode??history?.mode??null,
      salesText:screen?r.salesText:null,salesBasis:screen?'no1_displayed_table':'no1_history_per_size',missingSizeMappedToZero:!screen&&final&&!sales&&!collision,
      fastDeliveryPrice:r.fast100??null,normalDeliveryPrice:r.normal??null,instantSalePrice:r.highestBid??null,margins};
  });
  const counts=rows.map(r=>r.expectedSales30d).filter(finite);
  const total=counts.length?counts.reduce((a,b)=>a+b,0):null;
  return {version:'no1-price-table-v1',productId:request.kreamId,model:request.model,sourceUrl:request.productUrl,sourceOption:request.option,observationId:observation.id||null,observationMode:observation.mode||'unknown',observedAt:observation.observedAt,
    schemaColumns:['사이즈','30일 예상 거래량','빠른배송','일반배송','즉시 판매가','마진금 (수익률)','보판·일판·즉판','희망 판매가'],
    source:screen?'no1_displayed_table':'no1_relay_table_sources',displayedValueVerified:Boolean(screen),inputs,settingsSource:screen?'no1_displayed_inputs':stored?.source||'unavailable',
    purchaseMatchesSourceQuote:screen?sourceQuote!==null&&inputs.purchasePrice===sourceQuote:sourceQuote!==null,
    totalExpectedSales30d:total,totalSalesStatus:rows.length&&rows.every(r=>r.salesStatus==='ok')?'ok':total===null?'unavailable':'partial',totalText:screen?.totalText||null,
    salesAsOf:{...salesAsOf(history?.cacheInfo,now),displayText:screen?.asOfText||null},historyStage:history?.stage||null,historyMode:history?.mode||null,rows,
    actualRecordedTrades30d:research.trades?.transactions30d??null,actualRecordedTradesCoverageComplete:research.trades?.coverageComplete===true,
    limitations:['30일 예상 거래량은 No1 원본 집계이며 확정 실거래 건수와 구분합니다.','조회 시각과 집계 기준 시각은 별개입니다.','화면 원본 마진은 선택된 판매 방식만 직접 확인됩니다. 다른 방식은 명시된 매입가·수수료 조건의 계산값입니다.','수수료 이벤트 미확인 사이즈는 기본 수수료 조건이며 화면 일치가 검증되지 않았습니다.'],purchaseAuthorized:false};
}
export function marketSchemas(observations=[],options={},now=Date.now()){
  const latest=new Map();
  for(const o of observations){if(o.active===false||!['no1_product','collection_error'].includes(o.kind)||!o.payload?.request)continue;
    const r=o.payload.request,key=JSON.stringify([r.kreamId,r.productUrl,r.color,r.option]),old=latest.get(key);
    if(!old||Date.parse(o.observedAt)>=Date.parse(old.observedAt))latest.set(key,o);
  }
  return [...latest.values()].map(o=>buildMarketSchema(o,options,now));
}
