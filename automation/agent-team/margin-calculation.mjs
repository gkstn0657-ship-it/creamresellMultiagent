export const MARGIN_VERSION='no1-margin-v1';
export const SALE_MODES={fast:'보판',normal:'일판',instant:'즉판',desired:'희망 판매가'};
export const DEFAULT_MARGIN_FEES=Object.freeze({kreamPercent:6,kreamInspectionFee:2500,poizonPercent:10,poizonMinFee:15000,poizonMaxFee:45000});
const money=v=>Number.isSafeInteger(v)&&v>=0;
const positive=v=>money(v)&&v>0;

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
