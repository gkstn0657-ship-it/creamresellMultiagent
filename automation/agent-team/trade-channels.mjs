import {sizeKey} from '../no1-background/size-binding.mjs';
import {calculateMargin} from './margin-calculation.mjs';
const DAY=86400000;
const finite=Number.isFinite;
const median=xs=>{const a=xs.filter(finite).sort((x,y)=>x-y);return a.length?Math.round((a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2):null;};
// KREAM trade records carry isImmediateDelivery=true for ⚡ storage-sale (보관판매,
// fast delivery) trades. Records without the flag are counted as normal trades.
export const CHANNEL_FOR_MODE=Object.freeze({fast:'storage',normal:'normal'});
export const CHANNEL_BASIS='isImmediateDelivery=true is a ⚡ storage-sale (보관판매) trade; records without the flag are counted as normal-channel trades';

// Use the selected-size query when it covers this size, otherwise the all-option query.
export function tradesForSize(research={},size){
  const selected=research.selectedTrades?.selectedSize;
  return selected&&sizeKey(selected)===sizeKey(size)?research.selectedTrades:research.trades;
}

export function channelTrades(trades,size){
  const end=Date.parse(trades?.windowEnd);
  if(!finite(end)||!Array.isArray(trades?.items))return {status:'unavailable',basis:CHANNEL_BASIS,storage:null,normal:null};
  const start=finite(Date.parse(trades.windowStart))?Date.parse(trades.windowStart):end-30*DAY;
  const rows=trades.items.filter(t=>{const at=Date.parse(t.date);return finite(at)&&at<=end&&at>=start&&finite(t.price)&&t.price>0&&sizeKey(t.size)===sizeKey(size);});
  const summarize=storage=>{
    const own=rows.filter(t=>(t.isImmediateDelivery===true)===storage);
    const last7=own.filter(t=>Date.parse(t.date)>end-7*DAY),prev7=own.filter(t=>Date.parse(t.date)<=end-7*DAY&&Date.parse(t.date)>end-14*DAY);
    const latest=own.slice().sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0];
    return {count30d:own.length,last7dCount:last7.length,previous7dCount:prev7.length,median30d:median(own.map(t=>t.price)),median7d:median(last7.map(t=>t.price)),latestTrade:latest?{date:latest.date,price:latest.price}:null};
  };
  const complete=trades.coverageComplete===true&&!(trades.issues||[]).length;
  return {status:complete?'complete':'observed_only',basis:CHANNEL_BASIS,windowEnd:trades.windowEnd,size,storage:summarize(true),normal:summarize(false)};
}

// Recompute a mode's margin at the same channel's 30-day median trade price with
// the observed fee settings. Account fee-event previews are price specific and
// therefore not reused; the result is a reference check, not a displayed value.
export function tradePriceCheck(mode,margin,channels,inputs={}){
  const channel=CHANNEL_FOR_MODE[mode];
  if(!channel)return null;
  const stats=channels?.[channel]||null;
  const base={channel,channelStatus:channels?.status||'unavailable',count30d:stats?.count30d??null,median30d:stats?.median30d??null,latestTrade:stats?.latestTrade??null,askPrice:margin?.salePrice??null};
  const feesKnown=finite(inputs.feePercent)&&finite(inputs.inspectionFee)&&typeof inputs.taxMode==='boolean';
  if(!stats||!stats.count30d||!finite(stats.median30d))return {...base,marginAtMedian:null,rateAtMedian:null,status:'no_channel_trades'};
  if(!feesKnown||!finite(inputs.purchasePrice))return {...base,marginAtMedian:null,rateAtMedian:null,status:'inputs_unknown'};
  const r=calculateMargin({salePrice:stats.median30d,purchasePrice:inputs.purchasePrice,taxMode:inputs.taxMode,fees:{kreamPercent:inputs.feePercent,kreamInspectionFee:inputs.inspectionFee}});
  return {...base,marginAtMedian:r.marginAmount,rateAtMedian:r.marginRate,status:r.marginAmount>0?'profit_at_trade_median':'no_profit_at_trade_median',source:'no1_formula_at_channel_trade_median_without_fee_event'};
}

// A positive ask-price margin in fast/normal mode counts as profit evidence only
// when the same channel traded in 30 days and its median trade price still
// leaves a positive margin. Instant sales settle against an existing bid.
export function modeHasTradeEvidence(mode,margin,check){
  if(mode==='desired'||!(margin?.marginAmount>0&&margin?.marginRate>0))return false;
  if(mode==='instant')return true;
  return check?.status==='profit_at_trade_median';
}
