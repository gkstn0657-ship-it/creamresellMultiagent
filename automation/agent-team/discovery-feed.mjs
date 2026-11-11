import {CONNECTOR_VERSION} from '../no1-background/chrome-extension/protocol.mjs';
import {BackgroundClient} from '../no1-background/client.mjs';
import {discoveryPolicy} from './discovery-policy.mjs';
export function createDiscoveryFeed({client=new BackgroundClient()}={}){
 return async cursor=>{
  const state=await client.status();if(state.connectorVersion!==CONNECTOR_VERSION)throw Error('NO1_CONNECTOR_UPDATE_REQUIRED');
  if(!state.browserConnected)throw Error('NO1_BRIDGE_DISCONNECTED');
  // This installed No1 read handler uses popular_score; no UI search fallback.
  // A whitespace search requests the unfiltered list. Live verification is required.
  const data=await client.request('mecro:inventory:search',{keyword:' ',cursor});
  return {cursor,items:data.items,nextCursor:data.nextCursor,observedAt:new Date().toISOString()};
 };
}
export async function selectNext(store,batchId,limit,{feed=createDiscoveryFeed(),stopped=()=>false}={}){
 const old=store.claimed(batchId);if(old.length)return old;
 let pages=0;
 while(!store.get('exhausted')&&(store.queued()<limit||store.queued()<40&&pages<discoveryPolicy.lookaheadPages)&&pages<discoveryPolicy.maxPagesPerBatch){
  if(stopped())throw Error('STOP_REQUESTED');
  const cursor=store.get('cursor');
  try{store.appendPage(await feed(cursor));}catch(e){store.set('lastError',{code:e.message,at:new Date().toISOString(),cursor});throw e;}
  pages++;
 }
 if(stopped())throw Error('STOP_REQUESTED');
 const selected=store.claim(batchId,limit);if(!selected.length)throw Error(store.get('exhausted')?'DISCOVERY_EXHAUSTED':'DISCOVERY_NO_NEW_CANDIDATES');return selected;
}
