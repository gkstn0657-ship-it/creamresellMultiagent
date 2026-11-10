import {sizeKey} from './size-binding.mjs';
const connectionBlocked=e=>/^(NO1_AUTH_REQUIRED|NO1_PLATFORM_LOGIN_REQUIRED|KREAM_LOGIN_REQUIRED|KREAM_TOKEN_EXPIRED|NO1_BACKGROUND_MODE_REQUIRED|NO1_WEB_TAB_REQUIRED|ELECTRON_OFFLINE|ELECTRON_DISCONNECTED|NO_ELECTRON_CONNECTED)$/.test(e.message);
export function summarizeTrades(pages,{now=Date.now(),size,scope='all_product_options'}={}){
  const seen=new Set(),items=[],issues=new Set(),cutoff=now-30*86400000;
  for(const page of pages){
    const key=JSON.stringify(page.items);
    if(page.items.length&&seen.has(key)){issues.add('repeated_page');continue;}
    seen.add(key);items.push(...page.items);
  }
  let previous=Infinity;
  for(const item of items){
    const date=Date.parse(item.date);
    if(!Number.isFinite(date)||date>now)issues.add('invalid_or_future_date');
    else {if(date>previous)issues.add('not_newest_first');previous=date;}
    if(scope==='selected_option'&&sizeKey(item.size)!==sizeKey(size))issues.add('size_filter_mismatch');
  }
  const dated=items.filter(x=>Number.isFinite(Date.parse(x.date))&&Date.parse(x.date)<=now);
  const inWindow=dated.filter(x=>Date.parse(x.date)>=cutoff);
  const last=pages.at(-1),exhausted=last?.hasNext===false;
  const crossed=dated.length>0&&Date.parse(dated.at(-1).date)<cutoff&&!issues.has('not_newest_first');
  const complete=Boolean(last&&(exhausted||crossed)&&![...issues].some(x=>x!=='not_newest_first'||!exhausted));
  const selected=size?inWindow.filter(x=>sizeKey(x.size)===sizeKey(size)):null;
  return {windowDays:30,windowStart:new Date(cutoff).toISOString(),windowEnd:new Date(now).toISOString(),scope,pages:pages.length,
    coverageComplete:complete,coverageBasis:complete?(exhausted?'exhausted':'newest-first-cutoff-crossed'):null,
    observedCount30d:inWindow.length,transactions30d:complete?inWindow.length:null,
    selectedSize:size||null,selectedObservedCount30d:selected?.length??null,selectedTransactions30d:complete&&selected?selected.length:null,
    selectedTrades:selected||[],items,issues:[...issues],recordIdentity:'Upstream trade records; no unique transaction IDs are provided.',
    immediateDeliveryObserved30d:inWindow.filter(x=>x.isImmediateDelivery===true).length,
    limitation:complete?null:'Bounded or inconsistent pages; observed records are not a confirmed 30-day total.'};
}
async function readTrades(client,args,{maxPages,now,size}){
  const pages=[],seen=new Set();let cursor='1',error=null;
  try{for(let n=0;n<maxPages;n++){
    if(seen.has(cursor))throw Error('MARKET_CURSOR_REPEATED');seen.add(cursor);
    const page=await client.request('market:kream:trades',{productCode:args.kreamId,cursor,...(size?{size}:{})});pages.push(page);
    const summary=summarizeTrades(pages,{now,size,scope:size?'selected_option':'all_product_options'});
    if(summary.issues.includes('repeated_page'))throw Error('MARKET_PAGE_REPEATED');
    if(summary.issues.includes('size_filter_mismatch'))throw Error('MARKET_SIZE_FILTER_MISMATCH');
    if(!page.hasNext||summary.coverageComplete)break;
    if(!page.nextCursor)throw Error('MARKET_CURSOR_MISSING');cursor=page.nextCursor;
  }}catch(e){error=e;}
  return {pages,error};
}
export function settlementBreakdown(preview){
  const amount=v=>Number.isSafeInteger(v)?v:null;
  const processing=amount(preview.processingFee?.value),authentication=amount(preview.authenticationFee?.value),payout=amount(preview.totalPayout),price=amount(preview.price);
  const allKnown=[processing,authentication,payout,price].every(v=>v!==null);
  const reconciled=allKnown?price+processing+authentication===payout:null;
  return {currency:'KRW',quotedSalePrice:price,processingAdjustment:processing,authenticationAdjustment:authentication,
    quotedPayout:payout,observedSellerFee:reconciled&&processing<=0&&authentication<=0?-(processing+authentication):null,
    reconciled,shippingCost:null,actualSettlementConfirmed:false,
    basis:'No1 account preview amounts, including current fee event; no percentage or shipping assumption.'};
}
export async function marketEvidence(client,args,prices,{maxPages=3,maxSelectedPages=3,now=Date.now()}={}){
  if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>10||!Number.isSafeInteger(maxSelectedPages)||maxSelectedPages<0||maxSelectedPages>10)throw Error('MARKET_PAGE_BUDGET_INVALID');
  const errors={},result={observedAt:new Date(now).toISOString(),priceMeaning:{buyPrice:'lowest normal seller ask; not guaranteed proceeds',sellPrice:'highest buyer bid; immediate sale quote before fees',source:'No1 1.35.8 buildMarketPrices / parseSizeOptions, statically verified'},details:null,trades:null,selectedTrades:null,settlement:null};
  try{result.details=await client.request('market:kream:details',{productCode:args.kreamId,includeFastDelivery:false});}catch(e){errors.details=e.message;if(connectionBlocked(e))return {...result,errors};}
  const matches=args.option?prices.prices.filter(x=>sizeKey(x.size)===sizeKey(args.option)):[];
  result.selectedPrice=matches.length===1?matches[0]:null;
  if(args.option&&matches.length!==1)errors.option='MARKET_SIZE_AMBIGUOUS';
  const all=await readTrades(client,args,{maxPages,now});
  if(all.pages.length)result.trades=summarizeTrades(all.pages,{now,size:result.selectedPrice?.size});
  if(all.error){errors.trades=all.error.message;if(connectionBlocked(all.error))return {...result,errors};}
  if(result.selectedPrice){
    const p=result.selectedPrice;
    if(result.trades?.coverageComplete)result.selectedTrades={...result.trades,scope:'selected_option',derivedFrom:'complete_all_product_options',
      items:result.trades.items.filter(x=>sizeKey(x.size)===sizeKey(p.size)),observedCount30d:result.trades.selectedObservedCount30d,
      transactions30d:result.trades.selectedTransactions30d,immediateDeliveryObserved30d:result.trades.selectedTrades.filter(x=>x.isImmediateDelivery===true).length};
    else if(maxSelectedPages){
      const selected=await readTrades(client,args,{maxPages:maxSelectedPages,now,size:p.size});
      if(selected.pages.length)result.selectedTrades=summarizeTrades(selected.pages,{now,size:p.size,scope:'selected_option'});
      if(selected.error){errors.selectedTrades=selected.error.message;if(connectionBlocked(selected.error))return {...result,errors};}
    }
    // One item per request avoids No1's cross-option fee interpolation.
    const scenarios=[{price:p.sellPrice,isInstant:true},{price:p.buyPrice,isInstant:false}].filter(x=>Number.isSafeInteger(x.price)&&x.price>0);
    result.settlement=[];
    for(const item of scenarios)try{
      const response=await client.request('market:kream:askPreviewBatch',{productCode:args.kreamId,items:[{option:p.option,...item}]});
      const breakdown=response.previews.length===1?settlementBreakdown(response.previews[0]):null;
      if(!breakdown||response.failures.length||breakdown.reconciled!==true)errors.settlement='MARKET_SETTLEMENT_INCOMPLETE';
      result.settlement.push({...item,...response,breakdown,observedAt:new Date().toISOString(),kind:'preview_not_order'});
    }catch(e){errors.settlement=e.message;break;}
  }
  return {...result,errors};
}
