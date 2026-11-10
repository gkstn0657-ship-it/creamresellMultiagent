import fs from 'node:fs';
import path from 'node:path';
import {digest} from './store.mjs';
import {validateProbeArgs} from '../no1-background/product-probe.mjs';
import {createCollector} from './collector.mjs';
import {validateCandidate} from './discovery-policy.mjs';
import {collectCandidate} from './discovery-collector.mjs';
export function groupProducts(seeds) {
  if(!Array.isArray(seeds)||!seeds.length||seeds.length>500)throw Error('PRODUCTS_REQUIRED');
  const groups=new Map(),seen=new Set();
  for(const seed of seeds){seed.kind==='catalog-candidate'?validateCandidate(seed):validateProbeArgs(seed);const key=digest(seed);if(seen.has(key))continue;seen.add(key);
    if(!groups.has(seed.kreamId))groups.set(seed.kreamId,[]);groups.get(seed.kreamId).push(seed);}
  return [...groups].map(([productId,offers])=>({productId,offers}));
}
export function makePacket(product,observations) {
  const packet={version:'cream-product-packet-v1',productId:product.productId,offers:product.offers,
    collectedAt:new Date().toISOString(),observations,
    gaps:[...new Set(observations.flatMap(x=>x.kind==='collection_error'?[x.payload.code]:(x.payload.missingFields||[])))],
    collectionStatus:observations.some(x=>x.kind==='no1_product')?(observations.some(x=>x.kind==='collection_error'||x.payload.missingFields?.length)?'partial':'collected'):'blocked'};
  return {...packet,id:digest(packet)};
}
export function validatePacket(packet) {
  const {id,...body}=packet||{};
  if(body.version!=='cream-product-packet-v1'||id!==digest(body)||!Array.isArray(body.observations)||!body.observations.length)throw Error('PACKET_INTEGRITY_FAILED');
  for(const offer of body.offers){validateProbeArgs(offer);if(offer.kreamId!==body.productId)throw Error('PACKET_PRODUCT_MISMATCH');}
  if(body.candidate){validateCandidate(body.candidate);if(body.candidate.kreamId!==body.productId)throw Error('PACKET_PRODUCT_MISMATCH');}
  if(!body.offers.length&&!body.candidate)throw Error('PACKET_PRODUCT_MISSING');
  for(const observation of body.observations){
    if(!Number.isFinite(Date.parse(observation.observedAt))||!['live','replay','fixture'].includes(observation.mode))throw Error('PACKET_OBSERVATION_INVALID');
    if(observation.kind==='no1_product'&&!body.offers.some(offer=>Object.keys(offer).every(k=>observation.payload.request?.[k]===offer[k])))throw Error('PACKET_PRODUCT_MISMATCH');
  }
  return packet;
}
export async function collectPackets(seeds,dir,{collect=createCollector(),collectDiscovered=collectCandidate,mode='live',onEvent=()=>{},stopped=()=>false}={}) {
  const groups=groupProducts(seeds),packets=[];fs.mkdirSync(dir,{recursive:true});
  for(const group of groups){
    if(stopped())throw Error('BATCH_STOP_REQUESTED');
    if(group.offers[0]?.kind==='catalog-candidate'){
      if(group.offers.length!==1)throw Error('DISCOVERY_MIXED_PRODUCT_INPUT');
      const packet=validatePacket(await collectDiscovered(group.offers[0],{mode,stopped}));
      packets.push(packet);fs.writeFileSync(path.join(dir,`product-${group.productId}.json`),JSON.stringify(packet,null,2)+'\n');
      onEvent({type:'product_collected',productId:group.productId,collected:packets.length,total:groups.length,status:packet.collectionStatus});continue;
    }
    const observations=[];
    // The authenticated No1 bridge accepts one outstanding request at a time.
    for(const offer of group.offers){
      if(stopped())throw Error('BATCH_STOP_REQUESTED');
      try {const payload=await collect(offer);observations.push({kind:'no1_product',mode,observedAt:payload.observedAt||new Date().toISOString(),payload});}
      catch(e){observations.push({kind:'collection_error',mode,observedAt:new Date().toISOString(),payload:{request:offer,code:String(e.message).slice(0,500)}});}
    }
    const packet=validatePacket(makePacket(group,observations));packets.push(packet);
    fs.writeFileSync(path.join(dir,`product-${group.productId}.json`),JSON.stringify(packet,null,2)+'\n');
    onEvent({type:'product_collected',productId:group.productId,collected:packets.length,total:groups.length,status:packet.collectionStatus});
  }
  return packets;
}
