// No1 web marketMargin semantics observed 2026-11-10. This is a calculation
// from evidence, not a claim to have read the user's UI or fee preferences.
import {sizeKey} from '../no1-background/size-binding.mjs';

export const MARGIN_VERSION='no1-margin-v1';
export const SALE_MODES={fast:'보판',normal:'일판',instant:'즉판',desired:'희망 판매가'};
export const DEFAULT_MARGIN_FEES=Object.freeze({kreamPercent:6,kreamInspectionFee:2500,poizonPercent:10,poizonMinFee:15000,poizonMaxFee:45000});
const money=v=>Number.isSafeInteger(v)&&v>=0;
const positive=v=>money(v)&&v>0;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.trim().toUpperCase()===b.trim().toUpperCase();

export function marginOptions(options={}) {
  const allowed=['desiredSellingPrice','taxMode','fees'];
  if(!options||Object.keys(options).some(k=>!allowed.includes(k)))throw Error('MARGIN_OPTIONS_INVALID');
  const {desiredSellingPrice=null,taxMode=false}=options;
  if(desiredSellingPrice!==null&&!money(desiredSellingPrice)||typeof taxMode!=='boolean')throw Error('MARGIN_OPTIONS_INVALID');
  const supplied=options.fees||{};
  if(typeof supplied!=='object'||Array.isArray(supplied)||Object.keys(supplied).some(k=>!Object.hasOwn(DEFAULT_MARGIN_FEES,k)))throw Error('MARGIN_FEES_INVALID');
  const fees={...DEFAULT_MARGIN_FEES,...supplied};
  for(const [k,v] of Object.entries(fees))if(k.endsWith('Percent')?typeof v!=='number'||!Number.isFinite(v)||v<0||v>100:!money(v))throw Error('MARGIN_FEES_INVALID');
  if(fees.poizonMinFee>fees.poizonMaxFee)throw Error('MARGIN_FEES_INVALID');
  return {desiredSellingPrice,taxMode,fees,feeSettingsBasis:Object.keys(supplied).length?'explicit_overrides_with_no1_defaults':'no1_defaults_not_user_settings'};
}

export function calculateMargin({platform='kream',salePrice,purchasePrice,feeEvent=null,...options}) {
  if(!['kream','poizon'].includes(platform))throw Error('MARGIN_PLATFORM_INVALID');
  const {fees,taxMode,feeSettingsBasis}=marginOptions(options);
  const missing=[];
  if(!positive(salePrice))missing.push('salePrice');
  if(!money(purchasePrice))missing.push('purchasePrice');
  let amount=null,fee=null,denominator=null,basis=feeSettingsBasis;
  if(!missing.length){
    if(platform==='kream'){
      const eventValid=feeEvent?.hasFeeEvent===true&&[feeEvent.processingFee?.value,feeEvent.authenticationFee?.value].every(v=>Number.isSafeInteger(v));
      if(feeEvent?.hasFeeEvent&&!eventValid)missing.push('feeEvent');
      else {
        const variable=Math.round(salePrice*fees.kreamPercent/100);
        fee=eventValid?Math.abs(feeEvent.processingFee.value)+Math.abs(feeEvent.authenticationFee.value):(taxMode?Math.round(variable*1.1):variable)+fees.kreamInspectionFee;
        basis=eventValid?'no1_account_fee_event_preview':basis;
        denominator=taxMode?Math.round(salePrice/1.1):salePrice;
        amount=taxMode?denominator-Math.round(fee/1.1)-Math.round(purchasePrice/1.1):salePrice-fee-purchasePrice;
      }
    }else{
      fee=Math.min(Math.max(Math.round(salePrice*fees.poizonPercent/100),fees.poizonMinFee),fees.poizonMaxFee);
      denominator=salePrice;
      amount=salePrice-fee-(taxMode&&purchasePrice>0?Math.round(purchasePrice/1.1):purchasePrice);
    }
  }
  const status=amount===null?'unknown':amount>0?'profit':amount<0?'loss':'break_even';
  return {salePrice:positive(salePrice)?salePrice:null,purchasePrice:money(purchasePrice)?purchasePrice:null,
    feeAmount:fee,marginAmount:amount,marginRate:amount===null||!denominator?null:amount/denominator*100,
    status,label:{profit:'남음',loss:'손해',break_even:'본전',unknown:'계산 불가'}[status],missing,
    feeBasis:basis,taxMode,rateDenominator:taxMode&&platform==='kream'?'sale_price_excluding_vat':'sale_price'};
}

export function marginReport(observations=[],options={},now=Date.now()) {
  const settings=marginOptions(options),rows=[];
  // Retain only the newest active evidence for each exact source offer. Never
  // substitute another size/color's profitable quote or resurrect a failed refresh.
  const offers=new Map();
  for(const o of observations.filter(o=>o.active!==false&&['no1_product','collection_error'].includes(o.kind))){
    const r=o.payload?.request;
    if(!r?.productUrl||!r.option)continue;
    const key=JSON.stringify([r.kreamId,r.productUrl,r.color,r.option]);
    const prior=offers.get(key);
    if(!prior||Date.parse(o.observedAt)>=Date.parse(prior.observedAt))offers.set(key,o);
  }
  for(const o of offers.values()){
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
      '현재 수집기는 KREAM 일판·즉판 가격을 제공합니다. 보판 가격과 POIZON 시세는 수집하지 않습니다.'],
    missing:rows.length?[]:['matchedSourceOfferEvidence'],purchaseAuthorized:false};
}
