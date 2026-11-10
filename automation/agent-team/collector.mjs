import fs from 'node:fs';
import {BackgroundClient} from '../no1-background/client.mjs';
import {probeProduct} from '../no1-background/product-probe.mjs';
const normalize=s=>String(s).replace(/\s/g,'').toUpperCase();
const catalog=JSON.parse(fs.readFileSync(new URL('./catalog-evidence.json',import.meta.url),'utf8'));
export function attachIdentity(payload,entry){
  if(!entry||normalize(entry.model)!==normalize(payload.request.model)||normalize(entry.color)!==normalize(payload.request.color))return payload;
  if(payload.marketResearch?.details?.colorway&&normalize(entry.marketColor)!==normalize(payload.marketResearch.details.colorway)){
    payload.errors.marketIdentity='MARKET_COLOR_MISMATCH';payload.queryStatus='partial';return payload;
  }
  payload.marketIdentityEvidence=entry;
  payload.identity.marketModelIndependentlyVerified=true;
  payload.identity.marketBinding='source model+color matched to independently read official KREAM product page';
  payload.missingFields=payload.missingFields.filter(x=>x!=='marketModelIndependentEvidence');
  return payload;
}
export function createCollector({client=new BackgroundClient(),ttlMs=300000}={}){
  const cache=new Map();
  return async seed=>{
    const reads=[];
    const cachedClient={status:()=>client.status(),async request(cmd,args={}){
      const key=JSON.stringify([cmd,args]);const old=cache.get(key);const now=Date.now();
      // Cache successful read results only; never cache or retry authentication failures.
      if(old&&now-old.at<ttlMs){reads.push({cmd,at:new Date(old.at).toISOString(),reused:true});return structuredClone(old.data);}
      const data=await client.request(cmd,args);cache.set(key,{at:now,data});reads.push({cmd,at:new Date(now).toISOString(),reused:false});return structuredClone(data);
    }};
    const result=attachIdentity(await probeProduct(cachedClient,seed),catalog[seed.kreamId]);
    result.requestObservations=reads;result.observedAt=reads.reduce((min,x)=>x.at<min?x.at:min,result.observedAt);
    result.collectedAt=new Date().toISOString();return result;
  };
}
