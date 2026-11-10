const sizeKey=s=>String(s).trim().toUpperCase().replace(/\(\d+(?:\.\d+)?\)$/,'').replace(/\s/g,'');
const connectionBlocked=e=>/^(NO1_AUTH_REQUIRED|NO1_PLATFORM_LOGIN_REQUIRED|KREAM_LOGIN_REQUIRED|KREAM_TOKEN_EXPIRED|NO1_BACKGROUND_MODE_REQUIRED|NO1_WEB_TAB_REQUIRED|ELECTRON_OFFLINE|ELECTRON_DISCONNECTED|NO_ELECTRON_CONNECTED)$/.test(e.message);
export function summarizeTrades(pages,{now=Date.now(),size}={}){
  const items=pages.flatMap(p=>p.items),cutoff=now-30*86400000;
  const dated=items.filter(x=>Number.isFinite(Date.parse(x.date))&&Date.parse(x.date)<=now);
  const inWindow=dated.filter(x=>Date.parse(x.date)>=cutoff);
  const last=pages.at(-1),complete=Boolean(last&&(!last.hasNext||dated.some(x=>Date.parse(x.date)<cutoff)));
  const selected=inWindow.filter(x=>sizeKey(x.size)===sizeKey(size));
  return {windowDays:30,scope:'all_product_options',pages:pages.length,coverageComplete:complete,
    observedCount30d:inWindow.length,transactions30d:complete?inWindow.length:null,
    selectedSize:size,selectedObservedCount30d:selected.length,selectedTransactions30d:complete?selected.length:null,
    selectedTrades:selected,items,limitation:complete?null:'Bounded pages; observed counts are lower bounds, never estimated totals.'};
}
export async function marketEvidence(client,args,prices,{maxPages=3,now=Date.now()}={}){
  const errors={},result={observedAt:new Date(now).toISOString(),priceMeaning:{buyPrice:'lowest normal seller ask; not guaranteed proceeds',sellPrice:'highest buyer bid; immediate sale quote before fees',source:'No1 1.35.8 buildMarketPrices / parseSizeOptions, statically verified'},details:null,trades:null,settlement:null};
  try{result.details=await client.request('market:kream:details',{productCode:args.kreamId,includeFastDelivery:false});}catch(e){errors.details=e.message;if(connectionBlocked(e))return {...result,errors};}
  const matches=prices.prices.filter(x=>sizeKey(x.size)===sizeKey(args.option));
  result.selectedPrice=matches.length===1?matches[0]:null;
  if(matches.length!==1)errors.option='MARKET_SIZE_AMBIGUOUS';
  const pages=[];let cursor='1';const seen=new Set();
  try{for(let n=0;n<maxPages;n++){
    if(seen.has(cursor))throw Error('MARKET_CURSOR_REPEATED');seen.add(cursor);
    const page=await client.request('market:kream:trades',{productCode:args.kreamId,cursor});pages.push(page);
    if(!page.hasNext||page.items.some(x=>Date.parse(x.date)<now-30*86400000))break;
    if(!page.nextCursor)throw Error('MARKET_CURSOR_MISSING');cursor=page.nextCursor;
  }}catch(e){errors.trades=e.message;if(connectionBlocked(e))return {...result,trades:pages.length?summarizeTrades(pages,{now,size:result.selectedPrice?.size||args.option}):null,errors};}
  if(pages.length)result.trades=summarizeTrades(pages,{now,size:result.selectedPrice?.size||args.option});
  if(result.selectedPrice){
    const p=result.selectedPrice;
    // One item per request avoids No1's cross-option fee interpolation.
    const scenarios=[{price:p.sellPrice,isInstant:true},{price:p.buyPrice,isInstant:false}].filter(x=>Number.isSafeInteger(x.price)&&x.price>0);
    result.settlement=[];
    for(const item of scenarios)try{
      const response=await client.request('market:kream:askPreviewBatch',{productCode:args.kreamId,items:[{option:p.option,...item}]});
      result.settlement.push({...item,...response,observedAt:new Date().toISOString(),kind:'preview_not_order'});
    }catch(e){errors.settlement=e.message;break;}
  }
  return {...result,errors};
}
