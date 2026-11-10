import fs from 'node:fs';import path from 'node:path';

// Event delivery is independent of the command queue: a slow callback must not lose a claimed job.
export function createEventPublisher({readEvents,eventDir,send,enabled=async()=>true,onError=()=>{},now=Date.now,intervalMs=15000}){
 fs.mkdirSync(eventDir,{recursive:true});let pending=null,lastScan=-Infinity;
 return {tick(){
  if(pending||now()-lastScan<intervalMs)return pending;
  lastScan=now();
  pending=Promise.resolve().then(async()=>{
   if(!await enabled())return;
   for(const event of readEvents()){
    const receipt=path.join(eventDir,event.eventId+'.json');if(fs.existsSync(receipt))continue;
    const result=await send('/bridge/events',event);
    fs.writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),...result}));
   }
   await send('/bridge/event-tick',{});
  }).catch(onError).finally(()=>{pending=null;});
  return pending;
 }};
}
