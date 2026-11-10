// Transport polling runs independently of product execution. Only non-secret
// request metadata survives a worker restart; a pending request is failed once
// so the PC can retry its saved source without advancing the ranking cursor.
export function createConnectionLoop({storage,alarms,request,execute,safeCode,now=Date.now,schedule=setTimeout,cancel=clearTimeout}){
 const alarmName='no1-background-poll';
 let generation=0,polling=null,next=null,active=null,failures=0,initialized=false,initializing=null,commandTail=Promise.resolve();
 const valid=c=>c.enabled===true&&/^[a-f0-9]{64}$/.test(c.bridgeKey||'');
 const status=values=>storage.set({...values,lastCheckedAt:new Date(now()).toISOString()});
 const ensureAlarm=async()=>{if(!await alarms.get(alarmName))await alarms.create(alarmName,{periodInMinutes:0.5});};
 function stopLocal(){generation++;cancel(next);next=null;polling?.controller.abort();polling=null;active?.controller.abort();active?.delivery.abort();}
 async function runJob(job,key,epoch){
  if(active){
   if(active.job.id===job.id)return;
   await active.done;
   if(epoch===generation)return runJob(job,key,epoch);
   return;
  }
  let release;const record={job,controller:new AbortController(),delivery:new AbortController(),done:new Promise(resolve=>{release=resolve;})};active=record;
  let timer,abortListener;
  try{
   if(typeof job.id!=='string'||!Number.isFinite(job.deadline)||job.deadline<=now())throw Error('NO1_BRIDGE_TIMEOUT');
   await storage.set({pendingJob:{id:job.id,cmd:job.cmd,deadline:job.deadline}});
   if(epoch!==generation)return;
   const deadline=new Promise((_,reject)=>{
    abortListener=()=>reject(Error('NO1_RELAY_CLOSED'));
    record.controller.signal.addEventListener('abort',abortListener,{once:true});
    timer=schedule(()=>{reject(Error('NO1_BRIDGE_TIMEOUT'));record.controller.abort();},Math.max(1,Math.min(115000,job.deadline-now()-500)));
   });
   let result;
   try{const data=await Promise.race([Promise.resolve().then(()=>execute(job,record.controller.signal)),deadline]);result={id:job.id,ok:true,data};}
   catch(e){result={id:job.id,ok:false,error:{code:safeCode(e.message)}};}
   cancel(timer);
   if(epoch!==generation)return;
   await request(key,'/result',result,record.delivery.signal);
   if(epoch===generation)await status({lastStatus:result.ok?'VERIFIED_READ':result.error.code});
  }catch(e){if(epoch===generation)await status({lastStatus:safeCode(e.message)}).catch(()=>{});}
  finally{
   cancel(timer);if(abortListener)record.controller.signal.removeEventListener('abort',abortListener);
   if(epoch===generation)await storage.remove('pendingJob').catch(()=>{});
   if(active===record)active=null;
   release();
  }
 }
 async function poll(){
  if(polling)return;
  cancel(next);next=null;
  const epoch=generation,turn={controller:new AbortController()};polling=turn;
  let repeat=false,delay=0;
  try{
   const config=await storage.get(['enabled','bridgeKey']);
   if(epoch!==generation||!valid(config))return;
   repeat=true;
   // This storage/API activity and the alarm also revive an idle MV3 worker.
   const {job}=await request(config.bridgeKey,'/next?wait=20000',undefined,turn.controller.signal);
   if(epoch!==generation)return;
   const recovered=failures>0;failures=0;
   await status({lastTransportStatus:'CONNECTED',lastPollAt:new Date(now()).toISOString(),reconnectAttempts:0,...(recovered?{lastStatus:'CONNECTED',lastReconnectedAt:new Date(now()).toISOString()}: {})});
   if(epoch===generation&&job)void runJob(job,config.bridgeKey,epoch);
  }catch(e){
   if(epoch===generation){failures++;delay=Math.min(15000,1000*2**Math.min(failures-1,4));await status({lastStatus:'NO1_BRIDGE_UNAVAILABLE',lastTransportStatus:'RECONNECTING',reconnectAttempts:failures}).catch(()=>{});}
  }finally{
   if(polling===turn)polling=null;
   if(repeat&&epoch===generation)next=schedule(()=>void poll(),delay);
  }
 }
 async function start(){
  if(initializing)return initializing;
  const epoch=generation;
  initializing=(async()=>{
   const config=await storage.get(['enabled','bridgeKey','pendingJob']);
   if(epoch!==generation||!valid(config))return;
   await ensureAlarm();
   if(epoch!==generation)return;
   if(!initialized){
    const pending=config.pendingJob;
    if(pending&&typeof pending.id==='string'){
     await request(config.bridgeKey,'/result',{id:pending.id,ok:false,error:{code:'NO1_RELAY_CLOSED'}}).catch(()=>{});
     if(epoch!==generation)return;
     await storage.remove('pendingJob');await status({lastRecovery:'INTERRUPTED_REQUEST_RETURNED'});
    }
    initialized=true;
   }
   if(epoch===generation)void poll();
  })().catch(()=>{}).finally(()=>{initializing=null;});
  return initializing;
 }
 async function connect(key){
  if(!/^[a-f0-9]{64}$/.test(key||''))return {ok:false,code:'INVALID_PAIRING_CODE'};
  try{await request(key,'/status');}catch{return {ok:false,code:'NO1_BRIDGE_UNAVAILABLE'};}
  stopLocal();initialized=true;failures=0;
  await storage.set({bridgeKey:key,enabled:true,lastStatus:'CONNECTED'});await storage.remove('pendingJob');await ensureAlarm();void poll();return {ok:true};
 }
 async function disconnect(){
  const {bridgeKey}=await storage.get('bridgeKey');stopLocal();
  await storage.set({enabled:false,lastStatus:'DISCONNECTED',lastTransportStatus:'DISCONNECTED'});
  await storage.remove('bridgeKey');await storage.remove('pendingJob');await alarms.clear(alarmName);
  if(bridgeKey)await request(bridgeKey,'/disconnect',{}).catch(()=>{});return {ok:true};
 }
 const serialize=fn=>{const pending=commandTail.then(fn);commandTail=pending.catch(()=>{});return pending;};
 return {start,connect:key=>serialize(()=>connect(key)),disconnect:()=>serialize(disconnect)};
}
