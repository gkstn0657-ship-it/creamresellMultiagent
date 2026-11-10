import fs from 'node:fs';
import {BackgroundClient} from '../no1-background/client.mjs';
import {createCollector} from './collector.mjs';
import {marketEvidence} from '../no1-background/market-evidence.mjs';
import {digest} from './store.mjs';
import {validateCandidate} from './discovery-policy.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('./catalog-evidence.json',import.meta.url),'utf8'));
const normalize=s=>String(s||'').toUpperCase().replace(/\s+/g,'');
const sizeKey=s=>normalize(s).replace(/\([^)]*\)/g,'');
export function sameColor(a,b){
 const aliases={'블랙':'BLACK','화이트':'WHITE','차콜':'CHARCOAL','그레이':'GREY','GRAY':'GREY','네이비':'NAVY','브라운':'BROWN','베이지':'BEIGE','핑크':'PINK','레드':'RED','블루':'BLUE','그린':'GREEN','체스넛':'CHESTNUT','체스트넛':'CHESTNUT'};
 const clean=s=>[...new Set(String(s||'').toUpperCase().replace(/\(\d+\)/g,'').split(/[\s/,+]+/).filter(Boolean).map(x=>aliases[x]||x))].sort().join('/');
 return Boolean(clean(a))&&clean(a)===clean(b);
}
export function sourceOptionColor(stock,option){
 if(normalize(option.firstOption)!==normalize(option.size))return {value:option.firstOption,basis:'stock-color-option'};
 // A one-axis shoe option is a size, never a color. Accept only the explicit
 // merchant color segment in "name - color / exact-model"; no fuzzy guessing.
 const match=String(stock.name||'').match(/ - ([^/]+)\s*\/\s*([^/]+)$/);
 return match&&normalize(match[2])===normalize(stock.makerNumber)?{value:match[1].trim(),basis:'merchant-name-explicit-color-and-exact-model'}:null;
}
export {parseMusinsaSearch,searchMusinsa} from './source-search.mjs';
import {searchMusinsa} from './source-search.mjs';
export const fatalCollectionError=e=>/LOGIN_REQUIRED|TOKEN_EXPIRED|NO1_(?:AUTH|BRIDGE|BACKGROUND|CONNECTOR|WEB_TAB|BROWSER|RELAY|CONNECTION|COMMAND)|ELECTRON_|CMD_NOT_FOUND|REMOTE_COMMAND_FORBIDDEN/.test(e.message);
export async function collectCandidate(candidate,{client=new BackgroundClient(),search=searchMusinsa,collect=null,mode='live',stopped=()=>false}={}){
 validateCandidate(candidate);const observations=[],offers=[],sourceQuotes=[],gaps=new Set(),started=Date.now(),requestTimings=[];
 const observe=(kind,payload,observedAt=new Date().toISOString())=>observations.push({kind,mode,observedAt,payload});
 observe('catalog_candidate',candidate,candidate.discovery.observedAt);
 const check=()=>{if(stopped())throw Error('BATCH_STOP_REQUESTED');};
 const cached=new Map(),failures=new Map();const readClient={status:()=>client.status(),request:async(cmd,args)=>{
  check();const key=JSON.stringify([cmd,args]);if(failures.has(key))throw failures.get(key);
  if(!cached.has(key)){const at=Date.now();try{cached.set(key,await client.request(cmd,args));requestTimings.push({cmd,durationMs:Date.now()-at,ok:true});}catch(e){requestTimings.push({cmd,durationMs:Date.now()-at,ok:false,code:e.message});if(e.message==='NO1_INVALID_RESPONSE')failures.set(key,e);throw e;}}
  return structuredClone(cached.get(key));
 }};
 const collectOffer=collect||createCollector({client:readClient});
 let market=null,details=null;
 try{
  market=await readClient.request('market:kream:prices',{productCode:candidate.kreamId});
 }catch(e){if(fatalCollectionError(e))throw e;gaps.add(e.message);observe('collection_error',{cmd:'market:kream:prices',request:{kreamId:candidate.kreamId},code:e.message});}
 try{details=await readClient.request('market:kream:details',{productCode:candidate.kreamId,includeFastDelivery:false});}
 catch(e){if(fatalCollectionError(e))throw e;gaps.add(e.message);observe('collection_error',{cmd:'market:kream:details',request:{kreamId:candidate.kreamId},code:e.message});}
 if(market||details)observe('market_overview',{productId:candidate.kreamId,prices:market?.prices||null,details});
 const known=catalog[candidate.kreamId];
 const models=[...new Set([known?.model,...candidate.model.split(/\/(?=[A-Za-z0-9._ -]{2,})/)].filter(x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._ /-]{1,99}$/.test(x)))].slice(0,3);
 if(!models.length)gaps.add('sourceModelMissing');
 const visited=new Set();let checkedSources=0;
 for(const model of models){
  check();let result;
  try{result=await search(model);observe('source_search',{...result,items:result.items.slice(0,10),coverage:'first-page; up to 3 source products inspected'});}
  catch(e){if(fatalCollectionError(e))throw e;gaps.add(e.message);observe('source_search_error',{retailer:'musinsa',query:model,code:e.message});continue;}
  if(result.hasNext||result.items.length>3)gaps.add('sourceSearchCoveragePartial');
  for(const source of result.items){
   if(visited.has(source.productUrl))continue;if(checkedSources>=3)break;visited.add(source.productUrl);checkedSources++;
   if(!/^https:\/\/www\.musinsa\.com\/products\/\d{1,12}$/.test(source.productUrl))throw Error('SOURCE_URL_INVALID');
   let stock;try{stock=await readClient.request('stock:check',{url:source.productUrl});observe('source_identity',{productId:candidate.kreamId,productUrl:source.productUrl,stock});}
   catch(e){if(fatalCollectionError(e))throw e;gaps.add(e.message);observe('source_lookup_error',{productUrl:source.productUrl,cmd:'stock:check',code:e.message});continue;}
   if(!models.some(m=>normalize(m)===normalize(stock.makerNumber))){gaps.add('sourceModelMismatch');continue;}
   let benefits=null;try{benefits=await readClient.request('musinsa:product:benefit',{productId:stock.productNumber});if(normalize(benefits.styleNo)!==normalize(stock.makerNumber))throw Error('NO1_IDENTITY_MISMATCH');}
   catch(e){benefits=null;if(fatalCollectionError(e))throw e;gaps.add(e.message);observe('source_lookup_error',{productUrl:source.productUrl,cmd:'musinsa:product:benefit',code:e.message});}
   const quote={productUrl:source.productUrl,productId:candidate.kreamId,model:stock.makerNumber,stock,benefits,modelVerified:true,optionBinding:'unverified-until-matched',actualCheckoutPriceConfirmed:false,upstreamFreshnessConfirmed:false};
   observe('source_quote',quote);sourceQuotes.push({productUrl:source.productUrl,model:stock.makerNumber});
   const marketColor=details?.colorway;
   for(const option of stock.combinedOptions||[]){
    if(option.limitedQty===0)continue;
    const sourceColor=sourceOptionColor(stock,option);
    if(!sourceColor||!sameColor(sourceColor.value,marketColor)){gaps.add('sourceColorUnmatched');continue;}
    const matches=(market?.prices||[]).filter(p=>sizeKey(p.size)===sizeKey(option.size));
    if(matches.length!==1){gaps.add('sourceSizeUnmatched');continue;}
    if(offers.length>=3){gaps.add('sourceOptionCoveragePartial');break;}
    const seed={kreamId:candidate.kreamId,productUrl:source.productUrl,model:stock.makerNumber,color:option.firstOption,option:option.size};
    if(offers.some(o=>JSON.stringify(o)===JSON.stringify(seed)))continue;
    check();try{
     const payload=await collectOffer(seed);
     // Identity comes from independent market listing and merchant stock responses,
     // not a title similarity guess. Price/benefit conditions remain unconfirmed.
     payload.marketIdentityEvidence={source:'no1-kream-popularity-response',productId:candidate.kreamId,marketModel:candidate.model,sourceModel:stock.makerNumber,marketColor,sourceColor:sourceColor.value,sourceColorBasis:sourceColor.basis,sourceOptionLabel:option.firstOption,observedAt:candidate.discovery.observedAt};
     payload.identity.marketModelIndependentlyVerified=true;
     payload.missingFields=payload.missingFields.filter(x=>x!=='marketModelIndependentEvidence');
     observe('no1_product',payload,payload.observedAt);offers.push(seed);
    }catch(e){if(fatalCollectionError(e))throw e;gaps.add(e.message);observe('collection_error',{request:seed,code:e.message});}
   }
  }
 }
 if(!offers.length){
  gaps.add('verifiedSourceOfferMissing');gaps.add('otherRetailerAdaptersUnavailable');
  if(market&&sourceQuotes.length)try{const research=await marketEvidence(readClient,{kreamId:candidate.kreamId,option:''},market);observe('market_research',{productId:candidate.kreamId,...research});}catch(e){if(fatalCollectionError(e))throw e;gaps.add(e.message);}
  else if(!sourceQuotes.length)gaps.add('deepMarketCollectionDeferredUntilSourceFound');
 }
 for(const o of observations)for(const gap of o.payload.missingFields||[])gaps.add(gap);
 observe('collection_summary',{productId:candidate.kreamId,offers,sourceQuotes,gaps:[...gaps],retailersSearched:['musinsa'],searchQueries:models,checkedSources,coverage:'First search page; up to 3 source products and 3 matched options. Other retailers are not connected.',durationMs:Date.now()-started,requestTimings});
 const packet={version:'cream-product-packet-v1',productId:candidate.kreamId,candidate,offers,sourceQuotes,collectedAt:new Date().toISOString(),observations,gaps:[...gaps],collectionStatus:offers.length?(gaps.size?'partial':'collected'):'partial'};
 return {...packet,id:digest(packet)};
}
