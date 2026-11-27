import fs from 'node:fs';
import path from 'node:path';
import {digest} from '../agent-team/store.mjs';
import {matchRankingModels,rankingSizeMatch} from '../agent-team/musinsa-ranking-collector.mjs';
import {matchPoizonOptions,bindPoizonSize} from '../agent-team/poizon-ranking-collector.mjs';
import {sizeKey} from '../no1-background/size-binding.mjs';
import {sameColor} from '../agent-team/discovery-collector.mjs';

const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const available=o=>Number.isSafeInteger(o.limitedQty)&&o.limitedQty>0&&o.isAvailable!==false;
const safeId=id=>typeof id==='string'&&/^\d{1,12}$/.test(id);
const reasonLabels={EXACT_MARKET_MODEL_NOT_FOUND:'KREAM 검색 범위에서 동일 제조사 모델을 확인하지 못함',AVAILABLE_OPTION_NOT_BOUND:'KREAM 재고 옵션을 판매 색상·사이즈와 정확히 연결하지 못함',NO_POSITIVE_MARGIN_IN_BOUND_AVAILABLE_OPTIONS:'연결된 KREAM 재고 옵션에서 양의 예상 마진을 확인하지 못함',POIZON_EXACT_MODEL_NOT_FOUND:'POIZON 검색 범위에서 동일 제조사 모델을 확인하지 못함',POIZON_AVAILABLE_OPTION_NOT_BOUND:'POIZON 재고 옵션을 판매 색상·사이즈와 정확히 연결하지 못함',POIZON_NO_POSITIVE_MARGIN:'연결된 POIZON 옵션에서 양의 예상 마진을 확인하지 못함',NO_AVAILABLE_STOCK:'매입처의 구매 가능 재고 없음',SOURCE_MODEL_MISSING:'매입처 제조사 모델 코드 없음',UNVERIFIED_STAGE:'저장된 조회만으로 세부 원인 확정 불가'};

function inferredKream(stock,by){
 const searches=by('mecro:inventory:search'),matches=matchRankingModels(stock,searches.flatMap(e=>e.data.items||[]));
 if(!matches.length)return {code:'EXACT_MARKET_MODEL_NOT_FOUND',matchedListings:0,searchPages:searches.length};
 const prices=by('market:kream:prices'),details=by('market:kream:details');
 if(!prices.length||!details.length)return {code:'UNVERIFIED_STAGE',matchedListings:matches.length,searchPages:searches.length};
 const alternatives=[...new Map(matches.map(m=>[m.item.productCode,m])).values()].sort((a,b)=>(b.item.totalSales||0)-(a.item.totalSales||0)||a.item.productCode.localeCompare(b.item.productCode,'en',{numeric:true}));
 const match=alternatives[0],market={prices:prices[0].data.prices||[],kreamId:match.item.productCode};
 const bound=match.options.filter(available).filter(o=>sizeKey(o.firstOption)===sizeKey(o.size)||sameColor(o.firstOption,details[0].data.colorway)).filter(o=>rankingSizeMatch(stock,market,o.size));
 if(!bound.length)return {code:'AVAILABLE_OPTION_NOT_BOUND',matchedListings:matches.length,availableSourceOptions:match.options.filter(available).length,boundOptions:0};
 if(by('musinsa:product:benefit').length&&by('market:margin-settings').length&&!by('market:kream:history').length)return {code:'NO_POSITIVE_MARGIN_IN_BOUND_AVAILABLE_OPTIONS',matchedListings:matches.length,boundOptions:bound.length};
 return {code:'UNVERIFIED_STAGE',matchedListings:matches.length,boundOptions:bound.length};
}
function inferredPoizon(stock,by){
 const searches=by('market:poizon:search'),matches=[...new Map(searches.flatMap(e=>e.data.products||[]).filter(p=>matchPoizonOptions(stock,p).length).map(p=>[p.spuId,p])).values()];
 if(!matches.length)return {code:'POIZON_EXACT_MODEL_NOT_FOUND',matchedListings:0,searchPages:searches.length};
 const prices=by('market:poizon:prices');
 if(!prices.length)return {code:'UNVERIFIED_STAGE',matchedListings:matches.length,searchPages:searches.length};
 const bound=prices.flatMap(e=>{
  const product=matches.find(p=>p.spuId===e.data.product?.spuId)||matches[0];
  return matchPoizonOptions(stock,product).filter(available).filter(option=>bindPoizonSize(stock,e.data,option));
 });
 if(!bound.length)return {code:'POIZON_AVAILABLE_OPTION_NOT_BOUND',matchedListings:matches.length,boundOptions:0};
 if(by('musinsa:product:benefit').length&&by('market:poizon:margin-settings').length&&!by('market:poizon:chart').length)return {code:'POIZON_NO_POSITIVE_MARGIN',matchedListings:matches.length,boundOptions:bound.length};
 return {code:'UNVERIFIED_STAGE',matchedListings:matches.length,boundOptions:bound.length};
}
export function exclusionFacts(batchDir,source,row){
 if(!safeId(String(source?.productId))||String(source.productId)!==String(row?.sourceId)||row.status!=='skipped')throw Error('INVALID_EXCLUSION_SCOPE');
 const sourceId=String(source.productId),dir=path.join(batchDir,'source-evidence',sourceId);
 const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(name=>/^[\w-]+\.json$/.test(name)).sort():[];
 const evidence=files.map(name=>({id:`source-evidence/${sourceId}/${name}`,...read(path.join(dir,name))}));
 const by=cmd=>evidence.filter(e=>e.cmd===cmd),stock=by('stock:check')[0]?.data;
 let kream,poizon;
 if(row.marketChecks?.kream&&row.marketChecks?.poizon){
  kream={code:row.marketChecks.kream.reason||'UNVERIFIED_STAGE',recorded:true};
  poizon={code:row.marketChecks.poizon.reason||'UNVERIFIED_STAGE',recorded:true};
 }else if(!stock){kream={code:'UNVERIFIED_STAGE'};poizon={code:'UNVERIFIED_STAGE'};}
 else if(!stock.combinedOptions?.some(available)){kream={code:'NO_AVAILABLE_STOCK'};poizon={code:'NO_AVAILABLE_STOCK'};}
 else if(!stock.makerNumber||stock.makerNumber==='-'){kream={code:'SOURCE_MODEL_MISSING'};poizon={code:'SOURCE_MODEL_MISSING'};}
 else{kream=inferredKream(stock,by);poizon=inferredPoizon(stock,by);}
 const ids=evidence.map(e=>e.id),basisHash=digest({sourceId,row:{status:row.status,reason:row.reason,marketChecks:row.marketChecks||null},evidence:evidence.map(e=>({id:e.id,cmd:e.cmd,payload:e.payload,data:e.data}))});
 return {sourceId,sourceName:source.productName||sourceId,rank:source.rank??null,sourceUrl:source.productUrl||null,summaryCode:row.reason,kream:{...kream,label:reasonLabels[kream.code]||kream.code},poizon:{...poizon,label:reasonLabels[poizon.code]||poizon.code},evidenceIds:ids,basisHash,confidence:kream.recorded&&poizon.recorded?'recorded':kream.code==='UNVERIFIED_STAGE'||poizon.code==='UNVERIFIED_STAGE'?'partial':'reconstructed-from-saved-evidence'};
}
