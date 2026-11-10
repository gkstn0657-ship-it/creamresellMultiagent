import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';import {createHmac} from 'node:crypto';
import {eventMethod,acceptEvent,deliverEvents,eventsStatus,callbackUrl,sendWebhook} from './events.mjs';
function setup(){const db=new DatabaseSync(':memory:');for(const file of ['0002_events.sql','0003_event_diagnostic.sql'])db.exec(fs.readFileSync(new URL('./drizzle/'+file,import.meta.url),'utf8'));return {db,env:{DB:{prepare(sql){const statement=(values=[])=>({async run(){return db.prepare(sql).run(...values);},async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};}});return {...statement(),bind(...values){return statement(values);}};}}}};}
const secret='whsec_'+Buffer.alloc(32,7).toString('base64');
const subscription=(overrides={})=>({method:'events/subscribe',params:{name:'cream.batch.finished',arguments:{},delivery:{mode:'webhook',url:'https://chatgpt.com/mcp-events/test',secret},...overrides}});
const event=(id='a',run='11111111-1111-1111-1111-111111111111')=>({eventId:'evt-'+id.repeat(64),name:'cream.batch.finished',timestamp:new Date().toISOString(),data:{runId:'batch-'+run,status:'complete',productCount:1,judged:1,adopt:0,hold:1,exclude:0,error:null,mode:'live'}});
const verify=async(url,options)=>{assert.equal(options.redirect,'manual');const value=JSON.parse(options.body);return Response.json({challenge:value.challenge});};
test('only first-party HTTPS callbacks accepted',()=>{for(const url of ['http://chatgpt.com/cb','https://localhost/cb','https://127.0.0.1/cb','https://chatgpt.com.evil.test/cb','https://user@chatgpt.com/cb'])assert.throws(()=>callbackUrl(url));assert.equal(callbackUrl('https://chatgpt.com/cb'),'https://chatgpt.com/cb');});
test('signature matches independent Standard Webhooks HMAC and exact bytes',async()=>{
 const e=event();await sendWebhook({id:'sub-test',secret,url:'https://chatgpt.com/cb'},e,async(url,o)=>{const h=o.headers;const expected=createHmac('sha256',Buffer.alloc(32,7)).update(`${e.eventId}.${h['webhook-timestamp']}.${o.body}`).digest('base64');assert.equal(h['webhook-signature'],'v1,'+expected);assert.equal(JSON.parse(o.body).eventId,e.eventId);return new Response(null,{status:204});});
});
test('subscription is owner-bound, verified, idempotent and expires',async()=>{
 const {env,db}=setup();await assert.rejects(eventMethod(subscription(),env,null,verify),/OWNER/);
 const a=await eventMethod(subscription({ttlMs:1000}),env,'owner',verify),b=await eventMethod(subscription(),env,'owner',verify);assert.equal(a.id,b.id);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cream_subscriptions').get().n,1);
 await assert.rejects(eventMethod(subscription(),env,'other',async()=>Response.json({challenge:'wrong'})),/VERIFICATION/);
 db.prepare('UPDATE cream_subscriptions SET expires_at=0').run();assert.equal((await eventsStatus(env)).activeSubscriptions,0);
});
test('mismatched filter and fixture never create deliveries',async()=>{
 const {env,db}=setup();await eventMethod(subscription({arguments:{runId:'batch-22222222-2222-2222-2222-222222222222'}}),env,'owner',verify);
 await acceptEvent(event(),env);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cream_deliveries').get().n,0);
 const e=event('b');e.data.mode='fixture';await assert.rejects(acceptEvent(e,env),/INVALID_EVENT_DATA/);
});
test('duplicate event is delivered once; transient errors retry without changing event ID',async()=>{
 const {env,db}=setup();await eventMethod(subscription(),env,'owner',verify);const e=event();await acceptEvent(e,env);await acceptEvent(e,env);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cream_deliveries').get().n,1);
 let calls=0;const receiver=async(url,o)=>{assert.equal(JSON.parse(o.body).eventId,e.eventId);calls++;return new Response(null,{status:calls===1?503:204});};
 await deliverEvents(env,receiver);assert.equal(db.prepare('SELECT state FROM cream_deliveries').get().state,'pending');db.prepare('UPDATE cream_deliveries SET next_at=0').run();await deliverEvents(env,receiver);await deliverEvents(env,receiver);assert.equal(calls,2);assert.equal(db.prepare('SELECT state FROM cream_deliveries').get().state,'delivered');
});
test('unsubscribe stops pending deliveries, and 410 is terminal',async()=>{
 const {env,db}=setup();await eventMethod(subscription(),env,'owner',verify);await acceptEvent(event(),env);await deliverEvents(env,async()=>new Response(null,{status:410}));assert.equal(db.prepare('SELECT state FROM cream_deliveries').get().state,'failed');
 await acceptEvent(event('b'),env);await eventMethod({...subscription(),method:'events/unsubscribe'},env,'owner',verify);await deliverEvents(env,async()=>{throw Error('Must not send after unsubscribe');});assert.equal((await eventsStatus(env)).activeSubscriptions,0);
});

test('callback failures retain a safe category and never activate a subscription',async()=>{
 const {env,db}=setup();
 for(const [fetcher,reason,status] of [[async()=>new Response(null,{status:403}),'http_error',403],[async()=>Response.json({challenge:'wrong'}),'challenge_failed',200],[async()=>{throw Object.assign(Error('private request body'),{name:'TimeoutError'});},'timeout',undefined]]){
  await assert.rejects(eventMethod(subscription(),env,'owner',fetcher),e=>e.message==='CALLBACK_VERIFICATION_FAILED'&&e.reason===reason&&e.callbackStatus===status);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cream_subscriptions').get().n,0);
 }
});

test('redirect response is rejected without following its location or activating delivery',async()=>{
 const {env}=setup();let calls=0;
 await assert.rejects(eventMethod(subscription(),env,'owner',async(url,options)=>{
  calls++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://example.invalid/not-allowed'}});
 }),e=>e.message==='CALLBACK_VERIFICATION_FAILED'&&e.reason==='redirect_not_allowed'&&e.callbackStatus===302);
 assert.equal(calls,1);assert.equal((await eventsStatus(env)).activeSubscriptions,0);
});
