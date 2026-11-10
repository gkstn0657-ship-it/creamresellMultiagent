import test from 'node:test';import assert from 'node:assert/strict';
import {createConnectionLoop} from './chrome-extension/connection-loop.mjs';
import {safeCode,relayRequest} from './chrome-extension/protocol.mjs';
const key='b'.repeat(64),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate){for(let n=0;n<200;n++){if(predicate())return;await pause(5);}throw Error('TEST_CONNECTION_TIMEOUT');}
function fixture(t,{data={},request=async()=>({job:null}),execute=async()=>({sites:[]}),schedule=setTimeout}={}){
 const store={enabled:true,bridgeKey:key,...data},alarmMap=new Map(),calls=[];
 const storage={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,store[k]])),set:async v=>Object.assign(store,v),remove:async k=>{delete store[k];}};
 const alarms={get:async name=>alarmMap.get(name),create:async(name,value)=>{alarmMap.set(name,value);},clear:async name=>{alarmMap.delete(name);}};
 const loop=createConnectionLoop({storage,alarms,safeCode,execute,schedule,request:async(k,route,body,signal)=>{calls.push({route,body});return request(k,route,body,signal);}});
 t.after(()=>loop.disconnect());return {loop,store,alarmMap,calls};
}
test('slow product execution keeps polling and cannot consume a second job concurrently',async t=>{
 let polls=0,release,running=0,maxRunning=0;const results=[];
 const jobs=[{id:'slow',cmd:'stock:supportedSites',deadline:Date.now()+5000},{id:'next',cmd:'stock:supportedSites',deadline:Date.now()+5000}];
 const {loop,store}=fixture(t,{request:async(_k,route,body)=>{if(route.startsWith('/next')){polls++;await pause(5);return {job:jobs.shift()};}if(route==='/result')results.push(body);return {};},execute:async job=>{running++;maxRunning=Math.max(maxRunning,running);if(job.id==='slow')await new Promise(r=>{release=r;});running--;return {sites:[]};}});
 await loop.start();await until(()=>polls>=5&&release);assert.equal(results.length,0);assert.equal(store.pendingJob.id,'slow');
 release();await until(()=>results.length===2&&!store.pendingJob);assert.equal(maxRunning,1);assert.deepEqual(results.map(x=>x.id),['slow','next']);assert.equal(store.lastTransportStatus,'CONNECTED');
});
test('lost transport retries automatically with saved pairing and restores a missing alarm',async t=>{
 let attempts=0;const {loop,store,alarmMap}=fixture(t,{schedule:(fn,ms)=>setTimeout(fn,Math.min(ms,5)),request:async(_k,route)=>{if(route.startsWith('/next')){if(++attempts<=2)throw Error('network');await pause(5);return {job:null};}return {};}});
 await loop.start();await until(()=>attempts>=3&&store.lastReconnectedAt);assert.equal(store.enabled,true);assert.equal(store.bridgeKey,key);assert.equal(store.lastTransportStatus,'CONNECTED');assert.ok(alarmMap.has('no1-background-poll'));
 alarmMap.clear();await loop.start();assert.ok(alarmMap.has('no1-background-poll'));
});
test('worker startup returns an interrupted request before polling, without replaying it',async t=>{
 let executions=0;const {loop,store,calls,alarmMap}=fixture(t,{data:{pendingJob:{id:'interrupted',cmd:'stock:check',deadline:Date.now()+5000}},request:async(_k,route)=>{if(route.startsWith('/next'))await pause(5);return {job:null};},execute:async()=>{executions++;}});
 await loop.start();await until(()=>calls.some(x=>x.route.startsWith('/next')));
 assert.equal(calls[0].route,'/result');assert.deepEqual(calls[0].body,{id:'interrupted',ok:false,error:{code:'NO1_RELAY_CLOSED'}});assert.equal(executions,0);assert.equal(store.pendingJob,undefined);assert.ok(alarmMap.has('no1-background-poll'));
});
test('deadline cancels stuck work and the next saved request can succeed',async t=>{
 const results=[];let job={id:'stuck',cmd:'stock:supportedSites',deadline:Date.now()+550},aborted=false;
 const {loop}=fixture(t,{request:async(_k,route,body)=>{if(route.startsWith('/next')){await pause(5);const next=job;job=null;return {job:next};}if(route==='/result')results.push(body);return {};},execute:async(j,signal)=>{if(j.id!=='stuck')return {sites:[]};return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('NO1_RELAY_CLOSED'));},{once:true}));}});
 await loop.start();await until(()=>results.length===1);assert.equal(results[0].error.code,'NO1_BRIDGE_TIMEOUT');assert.equal(aborted,true);
 job={id:'retry',cmd:'stock:supportedSites',deadline:Date.now()+5000};await until(()=>results.length===2);assert.equal(results[1].ok,true);
});
test('explicit disconnect cancels work, fences late results, and stays disconnected on alarm startup',async t=>{
 let release;const results=[];let job={id:'old',cmd:'stock:supportedSites',deadline:Date.now()+5000};
 const {loop,store,alarmMap,calls}=fixture(t,{request:async(_k,route,body)=>{if(route.startsWith('/next')){await pause(5);const next=job;job=null;return {job:next};}if(route==='/result')results.push(body);return {};},execute:()=>new Promise(r=>{release=r;})});
 await loop.start();await until(()=>release);await loop.disconnect();release({sites:[]});await pause(20);
 const count=calls.length;await loop.start();await pause(20);assert.equal(calls.length,count);assert.equal(results.length,0);assert.equal(store.enabled,false);assert.equal(store.bridgeKey,undefined);assert.equal(alarmMap.size,0);
});
test('relay cancellation closes the socket without leaking a late response',async()=>{
 let socket;class Socket extends EventTarget{constructor(){super();socket=this;this.readyState=1;}close(){this.readyState=3;}}
 const controller=new AbortController(),pending=relayRequest({cmd:'stock:supportedSites',token:'session-secret',Socket,signal:controller.signal});
 controller.abort();await assert.rejects(pending,/NO1_RELAY_CLOSED/);assert.equal(socket.readyState,3);
});
test('a disconnect submitted during connect remains the final user choice',async t=>{
 let release;const {loop,store}=fixture(t,{data:{enabled:false},request:async(_k,route)=>{if(route==='/status')await new Promise(r=>{release=r;});if(route.startsWith('/next'))await pause(5);return {job:null};}});
 const connecting=loop.connect(key);await until(()=>release);const disconnecting=loop.disconnect();release();await connecting;await disconnecting;await loop.start();
 assert.equal(store.enabled,false);assert.equal(store.bridgeKey,undefined);assert.equal(store.lastStatus,'DISCONNECTED');
});
