import {sameColor} from './discovery-collector.mjs';
import {sizeKey} from '../no1-background/size-binding.mjs';
import {buildPoizonSchema} from './poizon-schema.mjs';
import {makePacket,validatePacket} from './packets.mjs';
const modelKey=s=>String(s||'').trim().toUpperCase().replace(/\s+/g,'');
const available=o=>Number.isSafeInteger(o.limitedQty)&&o.limitedQty>0&&o.isAvailable!==false;
export function matchPoizonOptions(stock,product){
 const models=String(product.styleCode||'').split('/').map(modelKey),base=modelKey(stock.makerNumber);
 if(!base||base==='-')return [];
 return (stock.combinedOptions||[]).filter(o=>{
  const colorCode=String(o.firstOption||'').match(/^\((\d{1,3})\)/)?.[1];
  return models.includes(base)||(colorCode&&models.includes(`${base}-${colorCode}`));
 });
}
export function bindPoizonSize(stock,market,option){
 // No implicit EU -> KR / UK -> US shoe conversion. No1's sizeKR can be
 // synthesized upstream, so shoes require an explicitly labelled source region.
 const source=sizeKey(option.size),region=source.match(/^(EU|US|KR)\s*([\d.]+)$/);
 const colorRows=(market.sizes||[]).filter(r=>sameColor(option.firstOption,r.color||market.product.colorName)||sizeKey(option.firstOption)===source);
 const matches=colorRows.filter(r=>{
  if(market.isApparel){const label=r.apparelSize||r.size;if(sizeKey(label)===source)return true;
   return stock.combinedOptions.length===1&&colorRows.length===1&&['NONE','FREE','ONESIZE','OS'].includes(source)&&['FREE','ONESIZE','OS'].includes(sizeKey(label));}
  // EU/US are returned region labels; KR may be a generic fallback conversion.
  return region&&region[1]!=='KR'&&sizeKey(r[`size${region[1]}`])===region[2];
 });
 if(matches.length!==1)return null;
 return {row:matches[0],evidence:{kind:market.isApparel?'exact-apparel-label':'explicit-region-label',sourceSize:option.size,marketSize:matches[0].size||matches[0].apparelSize||option.size,skuId:matches[0].skuId}};
}
export async function collectPoizonCandidate(candidate,{client,seenKreamIds=new Set()}={}){
 const stock=await client.request('stock:check',{url:candidate.productUrl});
 if(!stock.combinedOptions?.some(available))return {status:'skipped',reason:'NO_AVAILABLE_STOCK'};
 const model=String(stock.makerNumber||'').trim();
 if(!model||model==='-')return {status:'skipped',reason:'SOURCE_MODEL_MISSING'};
 if(!/^[\p{L}\p{N}][\p{L}\p{N} ._()/+-]{0,99}$/u.test(model))return {status:'skipped',reason:'UNSUPPORTED_SOURCE_MODEL_FORMAT'};
 let cursor='1';const seen=new Set(),products=[];
 for(let i=0;i<3&&!seen.has(cursor);i++){
  seen.add(cursor);const search=await client.request('market:poizon:search',{keyword:model,cursor});products.push(...search.products);
  if(products.some(p=>matchPoizonOptions(stock,p).length)||!search.nextCursor)break;cursor=search.nextCursor;
 }
 const matches=[...new Map(products.filter(p=>matchPoizonOptions(stock,p).length).map(p=>[p.spuId,p])).values()].sort((a,b)=>a.spuId.localeCompare(b.spuId,'en',{numeric:true}));
 if(!matches.length)return {status:'skipped',reason:'POIZON_EXACT_MODEL_NOT_FOUND'};
 let lastReason='POIZON_AVAILABLE_OPTION_NOT_BOUND';
 for(const product of matches){
  if(seenKreamIds.has(`poizon-${product.spuId}`)){lastReason='DUPLICATE_POIZON_PRODUCT';continue;}
  if(product.bidStatus===0||product.cannotBidMessage){lastReason='POIZON_BID_UNAVAILABLE';continue;}
  const scope={spuId:product.spuId,...(product.globalSpuId?{globalSpuId:product.globalSpuId}:{})};
  const market=await client.request('market:poizon:prices',{...scope,styleCode:product.styleCode});
  if(market.product.bidStatus===0||market.product.cannotBidMessage){lastReason='POIZON_BID_UNAVAILABLE';continue;}
  const options=matchPoizonOptions(stock,product).filter(available).map(option=>({option,binding:bindPoizonSize(stock,market,option)})).filter(x=>x.binding);
  if(!options.length)continue;
  const benefits=await client.request('musinsa:product:benefit',{productId:candidate.productId});
  if(modelKey(benefits.styleNo)!==modelKey(stock.makerNumber)||String(benefits.productId)!==candidate.productId)throw Error('NO1_IDENTITY_MISMATCH');
  const marginSettings=await client.request('market:poizon:margin-settings',{});
  const displayedSchema=await client.request('market:poizon:displayed-schema',{spuId:product.spuId});
  const scored=options.map(({option,binding})=>{
   const request={market:'poizon',poizonId:product.spuId,productUrl:candidate.productUrl,model:stock.makerNumber,color:option.firstOption,option:option.size};
   const payload={mode:'background-relay',request,observedAt:new Date().toISOString(),identity:{sourceProductVerified:true,sourceModelVerified:true,sourceOptionVerified:true,marketModelIndependentlyVerified:true},stock:{...stock,selectedOption:option,selectedStockQuantity:option.limitedQty},benefits,market,sizeBinding:binding.evidence,marketResearch:{marginSettings,displayedSchema},marketIdentityEvidence:{source:'no1-poizon-exact-model-search',market:product,sourceModel:stock.makerNumber,sourceProductId:candidate.productId},rankingSource:{...candidate,source:'no1-musinsa-ranking'},upstreamFreshnessConfirmed:false,actualCheckoutPriceConfirmed:false,missingFields:['upstreamDataAsOf','actualCheckoutPrice','shippingAndSellerFees','couponQuantityEligibilityAtCheckout']};
   const schema=buildPoizonSchema({payload,mode:'live',observedAt:payload.observedAt}),row=schema.rows.find(r=>r.sourceOptionMatched);
   return {payload,best:schema.purchaseMatchesSourceQuote?row?.margins.cn.marginAmount:null};
  }).filter(x=>x.best>0).sort((a,b)=>b.best-a.best||a.payload.request.option.localeCompare(b.payload.request.option));
  if(!scored.length){lastReason='POIZON_NO_POSITIVE_MARGIN';continue;}
  const observations=[];
  for(const {payload} of scored.slice(0,3)){
   const charts={};for(const saleRegion of ['GLOBAL','LOCAL'])charts[saleRegion]=await client.request('market:poizon:chart',{...scope,skuId:payload.sizeBinding.skuId,range:1,saleRegion});
   payload.marketResearch.charts=charts;payload.observedAt=new Date().toISOString();
   observations.push({kind:'no1_product',mode:'live',observedAt:payload.observedAt,payload});
  }
  const id=`poizon-${product.spuId}`;
  return {status:'collected',poizonId:product.spuId,packet:validatePacket(makePacket({productId:id,offers:observations.map(o=>o.payload.request)},observations))};
 }
 return {status:'skipped',reason:lastReason};
}
