// No1 web marketMargin semantics observed 2026-11-10. This is a calculation
// from evidence, not a claim to have read the user's UI or fee preferences.
import {sizeKey} from '../no1-background/size-binding.mjs';

import {calculateMargin,marginOptions,SALE_MODES,MARGIN_VERSION} from './margin-calculation.mjs';
export {calculateMargin,marginOptions,SALE_MODES,MARGIN_VERSION,DEFAULT_MARGIN_FEES} from './margin-calculation.mjs';
import {buildPoizonSchema} from './poizon-schema.mjs';
const money=v=>Number.isSafeInteger(v)&&v>=0;
const positive=v=>money(v)&&v>0;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.trim().toUpperCase()===b.trim().toUpperCase();

export function marginReport(observations=[],options={},now=Date.now()) {
  const settings=marginOptions(options),rows=[];
  // Retain only the newest active evidence for each exact source offer. Never
  // substitute another size/color's profitable quote or resurrect a failed refresh.
  const offers=new Map();
  for(const o of observations.filter(o=>o.active!==false&&['no1_product','collection_error'].includes(o.kind))){
    const r=o.payload?.request;
    if(!r?.productUrl||!r.option)continue;
    const key=JSON.stringify([r.market||'kream',r.poizonId||r.kreamId,r.productUrl,r.color,r.option]);
    const prior=offers.get(key);
    if(!prior||Date.parse(o.observedAt)>=Date.parse(prior.observedAt))offers.set(key,o);
  }
  for(const o of offers.values()){
    if(o.payload.request.market==='poizon'){
      const s=buildPoizonSchema(o,options.desiredSellingPrice==null?{}:{desiredSellingPrice:options.desiredSellingPrice});
      for(const row of s.rows.filter(r=>r.sourceOptionMatched))for(const [saleMode,m] of Object.entries(row.margins))rows.push({...m,platform:'poizon',productId:s.productId,marketProductId:s.marketProductId,model:s.model,sourceUrl:s.sourceUrl,sourceSize:s.sourceOption,marketSize:row.size,stockQuantity:row.stockQuantity,observationId:o.id||null,observedAt:o.observedAt,observationMode:o.mode||'unknown',saleMode,classification:'estimated_margin',confirmedProfit:false,purchaseMatchesSourceQuote:s.purchaseMatchesSourceQuote,inputs:s.inputs});
      continue;
    }
    const p=o.payload,r=p.request,sourceValid=o.kind==='no1_product'&&p.identity?.sourceProductVerified===true&&p.identity?.sourceOptionVerified===true;
    const benefitValid=sourceValid&&String(p.benefits?.productId)===r.productUrl.split('/').at(-1)&&same(p.benefits?.styleNo,r.model);
    const purchasePrice=benefitValid&&positive(p.benefits.maxBenefitPrice)?p.benefits.maxBenefitPrice:null;
    const prices=p.market?.prices||[];
    // Older packets predate sizeBinding. Their exact, normalized size label is
    // still usable; regional shoe-size conversion must have an explicit binding.
    const bound=p.sizeBinding||{kind:'same-size-label',sourceSize:r.option,marketSize:r.option};
    const candidates=sourceValid&&bound&&sizeKey(bound.sourceSize)===sizeKey(r.option)?prices.filter(x=>sizeKey(x.size)===sizeKey(bound.marketSize)):[];
    const selected=candidates.length===1?candidates[0]:null;
    const observedMs=Date.parse(o.observedAt),age=now-observedMs;
    const freshness=!Number.isFinite(age)||age<0?'unknown':age>600000?'stale':'recent_observation';
    for(const [saleMode,saleModeLabel] of Object.entries(SALE_MODES)){
      // The current relay projection does not provide fast-delivery prices.
      const salePrice=selected?(saleMode==='normal'?selected.buyPrice:saleMode==='instant'?selected.sellPrice:saleMode==='desired'?settings.desiredSellingPrice:null):null;
      const previews=(p.marketResearch?.settlement||[]).flatMap(s=>s.previews||[]).filter(v=>String(v.productCode)===r.kreamId&&v.option===selected?.option&&v.price===salePrice&&v.isInstant===(saleMode==='instant'));
      const calculation=calculateMargin({salePrice,purchasePrice,taxMode:settings.taxMode,...(options.fees?{fees:options.fees}:{}),feeEvent:previews.length===1?previews[0]:null});
      const missing=[...calculation.missing,...(!selected?['marketSizeBinding']:[]),...(saleMode==='fast'?['fastDeliveryPriceNotCollected']:[]),...(saleMode==='desired'&&!positive(settings.desiredSellingPrice)?['desiredSellingPriceNotEntered']:[])];
      rows.push({...calculation,missing:[...new Set(missing)],platform:'kream',productId:r.kreamId,model:r.model,color:r.color,
        sourceUrl:r.productUrl,sourceSize:r.option,marketSize:selected?.size||null,sizeBindingBasis:selected?(bound.kind||'saved_binding'):null,saleMode,saleModeLabel,
        stockQuantity:sourceValid&&money(p.stock?.selectedStockQuantity)?p.stock.selectedStockQuantity:null,
        purchaseBasis:purchasePrice===null?'unavailable':'no1_max_benefit_amount',observationId:o.id||null,
        observedAt:o.observedAt,observationMode:o.mode||'unknown',freshness,
        hypothetical:saleMode==='desired',classification:'estimated_margin',confirmedProfit:false});
    }
  }
  return {version:MARGIN_VERSION,resultSource:'calculated_from_collected_evidence',settings,rows,
    counts:Object.fromEntries(['profit','loss','break_even','unknown'].map(s=>[s,rows.filter(r=>r.status===s).length])),
    limitations:['No1 최대혜택가 원금액 기준의 예상 마진입니다. 할인율로 매입가를 재계산하지 않습니다.',
      '기본 수수료는 No1 웹 기본값이며 사용자 화면 설정을 읽은 값이 아닙니다. 입력한 수수료와 일치할 때 같은 결과가 납니다.',
      '배송비·추가 비용·실결제 혜택 자격·실제 체결은 확정하지 않습니다. 남음/손해는 위 계산 조건에서의 결과입니다.',
      'POIZON CN 최저입찰 마진은 별도로 관측한 POIZON 수수료·세금 설정을 사용합니다. 미수집 가격은 미확인으로 남깁니다.'],
    missing:rows.length?[]:['matchedSourceOfferEvidence'],purchaseAuthorized:false};
}
