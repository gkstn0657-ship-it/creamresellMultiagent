import fs from 'node:fs';
import path from 'node:path';
import {BackgroundClient} from '../no1-background/client.mjs';
import {collectRankingCandidate,qualifyRankingResult} from '../agent-team/musinsa-ranking-collector.mjs';
import {recoveringClient,isProductLookupFailure} from '../agent-team/source-recovery.mjs';
import {runBatch} from '../agent-team/batch.mjs';
import {writeJsonAtomic as write} from '../agent-team/atomic-json.mjs';
import {syncQualifiedProducts} from '../agent-team/qualified-products.mjs';
import {read} from './state.mjs';
import {validatePacket} from '../agent-team/packets.mjs';
import {offerMarketKey} from '../agent-team/market-offer.mjs';
function validateSourcePacket(packet,source) {
  validatePacket(packet);
  if(!packet.offers.length||packet.offers.some(o=>o.productUrl!==source.productUrl))throw Error('SOURCE_PACKET_MISMATCH');
  return packet;
}
export async function rankingWorker({root,dir,execute=runBatch,collect=collectRankingCandidate,client=new BackgroundClient()}) {
  const sources=read(path.join(dir,'sources.json'));if(!Array.isArray(sources)||!sources.length)throw Error('SOURCES_REQUIRED');
  const stopped=()=>fs.existsSync(path.join(dir,'STOP'));
  const sourceFile=path.join(dir,'source-state.json'),state=read(sourceFile)||{results:[]};
  const memoryFile=path.join(root,'musinsa-discovery','state.json');
  const memory=read(memoryFile)||{version:1,seenSourceIds:[],seenKreamIds:[],contexts:{}};
  // Recover the checkpoint boundary between source result and shared dedup writes.
  memory.seenSourceIds=[...new Set([...(memory.seenSourceIds||[]),...state.results.map(r=>r.sourceId)])];
  memory.seenKreamIds=[...new Set([...(memory.seenKreamIds||[]),...state.results.flatMap(r=>r.marketKeys||[])])];
  if(state.results.length)write(memoryFile,memory);
  let lastFailure;
  const safeClient=recoveringClient(client,{stopped,lookupDelays:[1000],delays:[],onRecovery:e=>{if(e.type==='source_recovery_exhausted')lastFailure=e;}});
  const packets=[];
  for(const source of sources){
    if(stopped())throw Error('STOP_REQUESTED');
    const file=path.join(dir,`source-${source.productId}.json`);
    let previous=state.results.find(r=>r.sourceId===source.productId);
    let packet=read(file);
    const judgment=packet?read(path.join(dir,'judgments',packet.productId,'team-state.json')):null;
    if(previous?.status==='skipped')continue;
    if(packet){
      validateSourcePacket(packet,source);
      if(previous?.packetProductId&&previous.packetProductId!==packet.productId)throw Error('SOURCE_PACKET_MISMATCH');
      if(previous?.packetId!==packet.id){
        // Packet is the durable checkpoint. Rebuild its missing/older progress row
        // before freshness handling, so restart does not lose count or dedup keys.
        previous={sourceId:source.productId,status:'collected',reason:null,lookupFailed:false,packetProductId:packet.productId,packetId:packet.id,marketKeys:[...new Set(packet.offers.map(offerMarketKey))]};
        state.results=state.results.filter(r=>r.sourceId!==source.productId);state.results.push(previous);write(sourceFile,state);
        memory.seenSourceIds=[...new Set([...memory.seenSourceIds,source.productId])];
        memory.seenKreamIds=[...new Set([...memory.seenKreamIds,...previous.marketKeys])];write(memoryFile,memory);
      }
    }
    const stale=packet?.observations.some(o=>Date.now()-Date.parse(o.observedAt)>600000);
    if(!packet||(stale&&judgment?.status!=='complete')){
      const seen=new Set(memory.seenKreamIds);for(const id of previous?.marketKeys||[])seen.delete(id);
      let result;lastFailure=null;
      try {result=await collect(source,{client:safeClient,seenKreamIds:seen,onEvidence:async(cmd,payload,data)=>{
        const evidenceDir=path.join(dir,'source-evidence',source.productId);fs.mkdirSync(evidenceDir,{recursive:true});write(path.join(evidenceDir,`${Date.now()}-${fs.readdirSync(evidenceDir).length}.json`),{cmd,payload,data,observedAt:new Date().toISOString()});
      }});}catch(e){if(lastFailure&&isProductLookupFailure(lastFailure.cmd,e.message))result={status:'skipped',reason:e.message,lookupFailed:true};else throw e;}
      if(!['collected','skipped'].includes(result?.status))throw Error('INVALID_SOURCE_RESULT');
      if(previous?.packetProductId&&result.packet?.productId!==previous.packetProductId)throw Error('REFRESHED_PRODUCT_SCOPE_CHANGED');
      packet=result.packet||null;
      if(result.status==='collected')validateSourcePacket(packet,source);
      if(packet)write(file,packet);
      const marketChecks=result.marketChecks&&typeof result.marketChecks==='object'?Object.fromEntries(Object.entries(result.marketChecks).filter(([market])=>['kream','poizon'].includes(market)).map(([market,check])=>[market,{status:check.status,reason:check.reason||null,lookupFailed:check.lookupFailed===true}])):null;
      const row={sourceId:source.productId,status:result.status,reason:result.reason||null,lookupFailed:result.lookupFailed===true,marketChecks,packetProductId:packet?.productId,packetId:packet?.id,marketKeys:packet?[...new Set(packet.offers.map(offerMarketKey))]:[]};
      state.results=state.results.filter(r=>r.sourceId!==source.productId);state.results.push(row);write(sourceFile,state);
      memory.seenSourceIds=[...new Set([...memory.seenSourceIds,source.productId])];
      memory.seenKreamIds=[...new Set([...memory.seenKreamIds,...row.marketKeys])];write(memoryFile,memory);
    }
    if(packet)packets.push(packet);
  }
  if(!packets.length){const result={status:'complete',mode:'live',analysisProfile:'musinsa-ranking',productCount:0,judged:0,results:[],sourceResults:state.results};write(path.join(dir,'batch-state.json'),result);write(path.join(dir,'batch-result.json'),result);return result;}
  const seeds=packets.flatMap(p=>p.offers);write(path.join(dir,'products.json'),seeds);
  const payloads=new Map(packets.flatMap(p=>p.observations.filter(o=>o.kind==='no1_product').map(o=>[JSON.stringify(o.payload.request),o.payload])));
  const result=await execute({dir,seeds,concurrency:2,analysisProfile:'musinsa-ranking',mode:'live',resume:fs.existsSync(path.join(dir,'collection-complete.json')),collect:async seed=>{
    const p=payloads.get(JSON.stringify(seed));if(!p)throw Error('MUSINSA_PACKET_MISSING');return structuredClone(p);
  },onEvent:e=>console.log(JSON.stringify(e))});
  for(const row of result.results)row.qualification=qualifyRankingResult(row,packets.find(p=>p.productId===row.productId));
  result.sourceResults=state.results;write(path.join(dir,'batch-state.json'),result);write(path.join(dir,'batch-result.json'),result);syncQualifiedProducts(root);return result;
}
