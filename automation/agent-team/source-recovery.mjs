const transient = new Set(['KREAM_SEARCH_FAILED','STOCK_CHECK_FAILED','MUSINSA_BENEFIT_FETCH_FAILED','MUSINSA_RANKING_ERROR','NO1_UPSTREAM_LOOKUP_FAILED','TIMEOUT','NO1_RELAY_TIMEOUT','NO1_BRIDGE_TIMEOUT','NO1_BRIDGE_BUSY','NO1_BRIDGE_UNAVAILABLE','NO1_RELAY_CONNECTION_FAILED','NO1_RELAY_CLOSED','RECONNECTING','NO_ELECTRON_CONNECTED','ELECTRON_DISCONNECTED','ELECTRON_OFFLINE']);
export const isTransientSourceError = code => transient.has(code);
// Read-only retries stay on the same request. Never consume a source, move the
// ranking cursor, restart a desktop app, or change an account to recover.
export function recoveringClient(client,{stopped=()=>false,onRecovery=()=>{},delays=[5000,20000,60000],sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  return {status:()=>client.status(),async request(cmd,payload={}){
    for(let attempt=0;;attempt++){
      if(stopped())throw Error('STOP_REQUESTED');
      try{const data=await client.request(cmd,payload);if(attempt)await onRecovery({type:'source_recovered',cmd,attempt:attempt+1});return data;}
      catch(e){
        if(!transient.has(e.message))throw e;
        if(attempt>=delays.length){await onRecovery({type:'source_recovery_exhausted',cmd,error:e.message,attempts:attempt+1});throw e;}
        await onRecovery({type:'source_retry',cmd,error:e.message,attempt:attempt+1,retryAfterMs:delays[attempt]});
        for(let remaining=delays[attempt];remaining>0;remaining-=1000){if(stopped())throw Error('STOP_REQUESTED');await sleep(Math.min(1000,remaining));}
      }
    }
  }};
}
