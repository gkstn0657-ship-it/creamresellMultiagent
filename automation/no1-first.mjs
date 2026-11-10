import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalUrl,hash,profit,saleFee} from '../renew/Cream/kream-tools/agents-core.mjs';

const same = (a,b) => String(a ?? '').trim().toUpperCase().replace(/\s+/g,'') ===
  String(b ?? '').trim().toUpperCase().replace(/\s+/g,'');
const money = x => Number.isSafeInteger(x) && x >= 0;
const fresh = (time,now) => {
  const age=Date.parse(now)-Date.parse(time);
  return Number.isFinite(age) && age>=-60000 && age<=600000;
};
const sameUrl = (a,b) => !!a && !!b && canonicalUrl(a)===canonicalUrl(b);

export function screenNo1First(seed,market,stock,policy,now=new Date().toISOString()) {
  const kreamModel=seed?.kreamModel || seed?.model;
  const sourceModel=seed?.sourceModel || seed?.model;
  if (!/^\d+$/.test(String(seed?.kreamId ?? '')) || !kreamModel || !sourceModel ||
      !Array.isArray(seed.options) || !seed.options.length || !canonicalUrl(seed.sourceUrl)) throw Error('Invalid No1 seed');
  const modelMappingOk=same(kreamModel,sourceModel) ||
    (seed.identityMappingVerified===true && typeof seed.identityBasis==='string' && seed.identityBasis.trim().length>=20);
  const marketOk = market?.mode==='live-visible-ui' && market.identityVerifiedFromVisibleLink===true &&
    String(market.kreamId)===String(seed.kreamId) && same(market.model,kreamModel) &&
    fresh(market.capturedAt,now) && fresh(market.dataAsOf,now) &&
    Date.parse(market.dataAsOf)<=Date.parse(market.capturedAt)+60000;
  const stockUrl=stock?.sourceUrl || stock?.productUrl;
  const stockPrice=stock?.maxBenefitPriceKrw ?? stock?.maximumBenefitPriceKrw;
  const stockOptions=stock?.options || (stock?.option ? [{size:stock.option,color:stock.color,quantity:stock.stockQuantity}] : []);
  const stockLive=stock?.mode==='live-visible-ui' ||
    (stock?.source==='No1 stock lookup UI' && stock.resultUrlVerifiedFromCopy===true &&
      stock.previousResultCleared===true && !!stock.queryCompletedAt);
  const stockOk = stockLive && stock.identityVerified===true &&
    modelMappingOk && sameUrl(stockUrl,seed.sourceUrl) && same(stock.model,sourceModel) &&
    (!seed.sourceColor && !seed.color || same(stock.color,seed.sourceColor || seed.color)) &&
    fresh(stock.capturedAt,now);
  const options=seed.options.map(option=>{
    const quote=marketOk ? market.sizes?.find(x=>same(x.size,option.size)) : null;
    const available=stockOk ? stockOptions.find(x=>same(x.size,option.sourceOption || option.size) &&
      (!option.sourceColor && !option.color || same(x.color,option.sourceColor || option.color))) : null;
    const bid=money(quote?.instantBidKrw) ? quote.instantBidKrw : null;
    const trades=Number.isSafeInteger(quote?.estimatedTrades30d) ? quote.estimatedTrades30d : null;
    const stockQty=Number.isSafeInteger(available?.quantity) ? available.quantity : null;
    const estimate=money(stockPrice) && stockOk ? stockPrice : null;
    const maxBuyCost=bid===null ? null : Math.max(0,bid-saleFee(bid,policy)-policy.outboundShipping-
      (policy.packingCost ?? 0)-(policy.minCashProfit ?? 0));
    // No1's maximum-benefit price may depend on account coupons and excludes unverified delivery costs.
    const optimisticProfit=bid!==null && estimate!==null ? profit(bid,estimate,policy) : null;
    const reasons=[];
    if (!modelMappingOk) reasons.push('CROSS_SITE_MODEL_MAPPING_UNVERIFIED');
    if (!marketOk) reasons.push('NO1_MARKET_UNAVAILABLE_OR_STALE');
    else if (bid===null) reasons.push('NO1_BID_MISSING');
    if (trades===null || trades<3) reasons.push('NO1_LOW_VOLUME_OR_MISSING');
    if (!stockOk || stockQty===null) reasons.push('NO1_STOCK_UNCONFIRMED');
    else if (stockQty<1) reasons.push('NO1_OUT_OF_STOCK');
    if (estimate===null) reasons.push('NO1_COST_ESTIMATE_MISSING');
    if (stockOk && stock?.benefitStatus==='login-required') reasons.push('NO1_BENEFITS_LOGIN_REQUIRED');
    if (estimate!==null && maxBuyCost!==null && estimate>maxBuyCost) reasons.push('NO1_ESTIMATE_ABOVE_COST_CEILING');
    const lowPotential=reasons.includes('NO1_LOW_VOLUME_OR_MISSING') && marketOk && trades!==null && trades<3 ||
      reasons.includes('NO1_OUT_OF_STOCK') || reasons.includes('NO1_ESTIMATE_ABOVE_COST_CEILING');
    const missing=[];
    if (!modelMappingOk) missing.push('product_identity');
    if (!marketOk || bid===null || trades===null) missing.push('market_quote');
    if (!stockOk || stockQty===null || stock.upstreamFreshnessConfirmed!==true) missing.push('source_stock');
    if (!lowPotential) missing.push('checkout_cost','discount_conditions','seller_identity','shipping_cost');
    return {size:option.size,color:option.color || seed.color || '',sourceOption:option.sourceOption || option.size,
      sourceColor:option.sourceColor || seed.sourceColor || seed.color || '',status:lowPotential?'low_potential':'needs_fallback',
      instantBidKrw:bid,estimatedTrades30d:trades,sourceStockEstimate:stockQty,
      maxBenefitPriceKrw:estimate,maxBuyCostKrw:maxBuyCost,optimisticProfitKrw:optimisticProfit,
      reasons,missingFields:missing};
  });
  return {kreamId:String(seed.kreamId),model:kreamModel,sourceModel,sourceUrl:seed.sourceUrl,
    identityMappingVerified:modelMappingOk,
    marketCapturedAt:marketOk?market.capturedAt:null,marketDataAsOf:marketOk?market.dataAsOf:null,
    stockCapturedAt:stockOk?stock.capturedAt:null,decision:'hold',options};
}

export function planFallbackJobs(screened) {
  const jobs=[],seen=new Set();
  for (const item of screened) {
    const active=item.options.filter(x=>x.status==='needs_fallback');
    if (!active.length) continue;
    const fields=new Set(active.flatMap(x=>x.missingFields));
    if ((fields.has('market_quote') || fields.has('product_identity')) && !seen.has(`K${item.kreamId}-no1fallback`)) {seen.add(`K${item.kreamId}-no1fallback`);jobs.push({id:`K${item.kreamId}-no1fallback`,
      url:`https://kream.co.kr/products/${item.kreamId}`,actions:[{wait:1000},{click:'거래 내역 더보기',after:1800},{noScroll:true}],
      requestedFields:[...fields].filter(x=>x==='market_quote'||x==='product_identity')});}
    const sourceId=`S${item.kreamId}-${hash(canonicalUrl(item.sourceUrl)).slice(0,8)}-no1fallback-prod`;
    if (item.sourceUrl && [...fields].some(x=>x!=='market_quote') && !seen.has(sourceId)) {seen.add(sourceId);jobs.push({id:sourceId,
      url:item.sourceUrl,actions:[{wait:1500},{stockProbe:true}],
      requestedFields:[...fields].filter(x=>x!=='market_quote')});}
  }
  return jobs;
}

export function buildNo1FirstReport(input,policy,now=new Date().toISOString()) {
  if (input?.version!=='no1-first-input-v1' || !Array.isArray(input.items)) throw Error('Invalid No1 input');
  const items=input.items.map(x=>screenNo1First(x.seed,x.market,x.stock,policy,now));
  return {version:'no1-first-plan-v1',at:now,items,summary:{products:new Set(items.map(x=>`${x.kreamId}|${canonicalUrl(x.sourceUrl)}`)).size,
    options:items.reduce((n,x)=>n+x.options.length,0),needsFallback:items.reduce((n,x)=>n+x.options.filter(o=>o.status==='needs_fallback').length,0),
    lowPotential:items.reduce((n,x)=>n+x.options.filter(o=>o.status==='low_potential').length,0),candidates:0},
    fallbackJobs:planFallbackJobs(items)};
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const [inputFile,policyFile,outputFile]=process.argv.slice(2);
  if (!inputFile || !policyFile || !outputFile) throw Error('Usage: node automation/no1-first.mjs <input.json> <policy.json> <output.json>');
  const input=JSON.parse(fs.readFileSync(inputFile,'utf8'));
  const policy=JSON.parse(fs.readFileSync(policyFile,'utf8'));
  const output=buildNo1FirstReport(input,policy);
  fs.writeFileSync(outputFile,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify(output.summary));
}
