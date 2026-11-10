import {validateProbeArgs} from '../no1-background/product-probe.mjs';
export const offerProductId=s=>s.market==='poizon'?(s.productGroupId||`poizon-${s.poizonId}`):s.kreamId;
export const offerMarketKey=s=>s.market==='poizon'?`poizon-${s.poizonId}`:s.kreamId;
export const safeProductId=id=>typeof id==='string'&&/^(?:\d{1,12}|poizon-\d{1,18})$/.test(id);
export function validateOffer(s){
 if(s?.market!=='poizon')return validateProbeArgs(s);
 const allowed=['market','poizonId','productGroupId','productUrl','model','color','option'];
 if(Object.keys(s).some(k=>!allowed.includes(k))||typeof s.poizonId!=='string'||!/^\d{1,18}$/.test(s.poizonId)||s.productGroupId!==undefined&&(typeof s.productGroupId!=='string'||!/^\d{1,12}$/.test(s.productGroupId)))throw Error('NO1_INVALID_PAYLOAD');
 validateProbeArgs({kreamId:'1',productUrl:s.productUrl,model:s.model,color:s.color,option:s.option});
}
