import {probeProduct} from '../no1-background/product-probe.mjs';
import {matchMarketSize,sizeKey} from '../no1-background/size-binding.mjs';
import {buildMarketSchema} from './market-schema.mjs';
import {sameColor} from './discovery-collector.mjs';
import {makePacket,validatePacket} from './packets.mjs';
const modelKey=s=>String(s||'').trim().toUpperCase().replace(/\s+/g,'');
const codes=s=>String(s||'').split('/').map(modelKey).filter(s=>s&&s!=='-');
const available=o=>Number.isSafeInteger(o.limitedQty)&&o.limitedQty>0&&o.isAvailable!==false;
export function matchRankingModels(stock,items){
  const base=modelKey(stock.makerNumber);if(!base||base==='-')return [];
  return items.flatMap(item=>{
    const models=codes(item.brandProductCode);
    const options=(stock.combinedOptions||[]).filter(o=>{
      const color=String(o.firstOption||'').match(/^\((\d{1,3})\)/)?.[1];
      return models.includes(base)||(color&&models.includes(`${base}-${color}`));
    });
    return options.length?[{item,options}]:[];
  });
}
export function rankingSizeMatch(stock,market,sourceSize){
  // Scope this fallback to independently exact-model-matched products, one
  // source option with no size choice and one explicit market ONE SIZE option.
  const normal=matchMarketSize({...market,stock,sourceSize});if(normal)return normal;
  if(stock.combinedOptions?.length===1&&['NONE','FREE','ONESIZE','OS'].includes(sizeKey(sourceSize))&&market.prices.length===1&&['ONESIZE','OS','FREE'].includes(sizeKey(market.prices[0].size)))return {
    price:market.prices[0],evidence:{kind:'exact-model-single-option',sourceSize,marketSize:market.prices[0].size}
  };
  return null;
}
export async function collectRankingCandidate(candidate,{client,onEvidence=()=>{},seenKreamIds=new Set()}={}){
  const cache=new Map();const cached={status:()=>client.status(),request:async(cmd,payload={})=>{
    const key=JSON.stringify([cmd,payload]);if(!cache.has(key)){const data=await client.request(cmd,payload);cache.set(key,data);await onEvidence(cmd,payload,data);}return structuredClone(cache.get(key));
  }};
  const stock=await cached.request('stock:check',{url:candidate.productUrl});
  if(!stock.combinedOptions?.some(available))return {status:'skipped',reason:'NO_AVAILABLE_STOCK'};
  const model=String(stock.makerNumber||'').trim();if(!model||model==='-')return {status:'skipped',reason:'SOURCE_MODEL_MISSING'};
  const items=[],cursors=new Set();let cursor='1';
  for(let page=0;page<3;page++){
    if(cursors.has(cursor))break;cursors.add(cursor);
    const search=await cached.request('mecro:inventory:search',{keyword:model,cursor});items.push(...search.items);
    if(matchRankingModels(stock,items).length||!search.nextCursor)break;cursor=search.nextCursor;
  }
  const unique=new Map(matchRankingModels(stock,items).map(m=>[m.item.productCode,m]));
  if(!unique.size)return {status:'skipped',reason:'EXACT_MARKET_MODEL_NOT_FOUND'};
  // Multiple registrations of the same exact manufacturer code are listing
  // alternatives, not fuzzy product matches. Prefer the listing with observed
  // historical trades; recent demand is still checked independently below.
  const alternatives=[...unique.values()].sort((a,b)=>(b.item.totalSales||0)-(a.item.totalSales||0)||a.item.productCode.localeCompare(b.item.productCode,'en',{numeric:true}));
  const match=alternatives[0],id=match.item.productCode;
  if(seenKreamIds.has(id))return {status:'skipped',reason:'DUPLICATE_KREAM_PRODUCT',kreamId:id};
  const prices=await cached.request('market:kream:prices',{productCode:id});
  const details=await cached.request('market:kream:details',{productCode:id,includeFastDelivery:true});
  const options=match.options.filter(available).filter(o=>sizeKey(o.firstOption)===sizeKey(o.size)||sameColor(o.firstOption,details.colorway)).map(o=>({option:o,binding:rankingSizeMatch(stock,{prices:prices.prices,productUrl:candidate.productUrl,kreamId:id},o.size)})).filter(x=>x.binding);
  if(!options.length)return {status:'skipped',reason:'AVAILABLE_OPTION_NOT_BOUND',kreamId:id};
  // Compare every mapped in-stock size before selecting up to three richest
  // positive-margin options. This is numeric ordering, never AI discovery.
  const benefits=await cached.request('musinsa:product:benefit',{productId:candidate.productId});
  const marginSettings=await cached.request('market:margin-settings',{});
  const scored=options.map(({option,binding})=>{
    const seed={kreamId:id,productUrl:candidate.productUrl,model:stock.makerNumber,color:option.firstOption,option:option.size};
    const payload={request:seed,identity:{sourceProductVerified:true,sourceOptionVerified:true},stock:{...stock,selectedStockQuantity:option.limitedQty},benefits,sizeBinding:binding.evidence,marketResearch:{details,marginSettings}};
    const schema=buildMarketSchema({kind:'no1_product',mode:'live',observedAt:new Date().toISOString(),payload});
    const row=schema.rows.find(r=>r.sourceOptionMatched),amounts=row?Object.entries(row.margins).filter(([k,m])=>k!=='desired'&&Number.isFinite(m.marginAmount)).map(([,m])=>m.marginAmount):[];
    return {seed,binding,best:amounts.length?Math.max(...amounts):null};
  }).filter(x=>x.best!==null&&x.best>0).sort((a,b)=>b.best-a.best||a.seed.option.localeCompare(b.seed.option));
  if(!scored.length)return {status:'skipped',reason:'NO_POSITIVE_MARGIN_IN_BOUND_AVAILABLE_OPTIONS',kreamId:id};
  const offers=[],observations=[];
  for(const item of scored.slice(0,3)){
    const payload=await probeProduct(cached,item.seed,{matchSize:()=>item.binding});
    payload.identity.marketModelIndependentlyVerified=true;
    payload.identity.marketBinding='exact model code from No1 KREAM search matched to merchant maker model; source option bound separately';
    payload.marketIdentityEvidence={source:'no1-kream-model-search',market:match.item,sourceModel:stock.makerNumber,sourceProductId:candidate.productId,listingSelection:'exact model; highest historical totalSales, then product ID; not a 30-day demand claim',alternativeListingIds:alternatives.map(m=>m.item.productCode)};
    payload.missingFields=payload.missingFields.filter(x=>x!=='marketModelIndependentEvidence');
    payload.rankingSource={...candidate,source:'no1-musinsa-ranking'};
    offers.push(item.seed);observations.push({kind:'no1_product',mode:'live',observedAt:payload.observedAt,payload});
  }
  return {status:'collected',kreamId:id,packet:validatePacket(makePacket({productId:id,offers},observations))};
}
export function qualifyRankingResult(result,packet){
  const checks={adopted:result.status==='complete'&&result.assessment?.decision==='adopt',independentReview:Boolean(result.assessment?.reviewId),matchedStockMarginSales:false};
  const eligible=[];
  for(const o of packet.observations.filter(o=>o.kind==='no1_product')){
    const p=o.payload;if(!p.identity?.marketModelIndependentlyVerified||p.stock?.selectedOption?.isAvailable===false)continue;
    const schema=buildMarketSchema(o);
    for(const row of schema.rows)if(row.sourceOptionMatched&&row.stockQuantity>0&&row.salesStatus==='ok'&&row.expectedSales30d>0&&Object.entries(row.margins).some(([mode,m])=>mode!=='desired'&&m.marginAmount>0&&m.marginRate>0))eligible.push({size:row.size,sourceOption:p.request.option,stock:row.stockQuantity,expectedSales30d:row.expectedSales30d});
  }
  checks.matchedStockMarginSales=eligible.length>0;
  return {passed:Object.values(checks).every(Boolean),checks,eligibleOptions:eligible,purchaseAuthorized:false};
}
