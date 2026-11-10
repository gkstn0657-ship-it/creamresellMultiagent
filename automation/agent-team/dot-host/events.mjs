const name='cream.batch.finished';
export const eventDefinition={name,description:'A real product batch finished, stopped, or needs attention. Inspect the saved result, then decide whether to investigate gaps, move to new products, or wait. Never repeat a completed batch from the same evidence.',delivery:['webhook'],inputSchema:{type:'object',properties:{runId:{type:'string',pattern:'^batch-[a-f0-9-]{36}$'}},additionalProperties:false},payloadSchema:{type:'object',properties:{runId:{type:'string'},status:{type:'string'},productCount:{type:'integer'},judged:{type:'integer'},adopt:{type:'integer'},hold:{type:'integer'},exclude:{type:'integer'},error:{type:['string','null']},mode:{type:'string'}},required:['runId','status','productCount','judged','adopt','hold','exclude','error','mode'],additionalProperties:false}};
const runId=s=>typeof s==='string'&&/^batch-[a-f0-9-]{36}$/.test(s);
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const enc=new TextEncoder();
export function callbackUrl(raw){
 const u=new URL(raw);
 // This private integration delivers exclusively to the ChatGPT event service.
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!/(^|\.)(chatgpt\.com|openai\.com)$/.test(u.hostname))throw Error('CALLBACK_HOST_NOT_ALLOWED');
 return u.href;
}
function secretBytes(secret){
 if(typeof secret!=='string'||!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))throw Error('INVALID_SIGNING_SECRET');
 const bytes=Uint8Array.from(atob(secret.slice(6)),c=>c.charCodeAt(0));if(bytes.length<24||bytes.length>64)throw Error('INVALID_SIGNING_SECRET');return bytes;
}
async function signature(secret,id,ts,body){const key=await crypto.subtle.importKey('raw',secretBytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(`${id}.${ts}.${body}`)));return 'v1,'+btoa(String.fromCharCode(...bytes));}
export async function sendWebhook(sub,event,fetcher=fetch){
 const raw=JSON.stringify(event);if(enc.encode(raw).length>262144)throw Error('EVENT_TOO_LARGE');
 const id=event.eventId||'verification-'+crypto.randomUUID(),ts=String(Math.floor(Date.now()/1000));
 let sig=await signature(sub.secret,id,ts,raw);
 if(sub.previous_secret&&Date.now()-sub.rotated_at<300000)sig+=' '+await signature(sub.previous_secret,id,ts,raw);
 // Workers rejects redirect:'error' before sending. manual preserves the no-redirect policy.
 return fetcher(callbackUrl(sub.url),{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','webhook-id':id,'webhook-timestamp':ts,'webhook-signature':sig,'X-MCP-Subscription-Id':sub.id},body:raw});
}
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;let d=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return d===0;};
export async function eventMethod(q,env,owner,fetcher=fetch){
 if(q.method==='events/list')return {events:[eventDefinition]};
 if(!owner)throw Error('AUTHENTICATED_OWNER_REQUIRED');
 const p=q.params||{},filters=p.arguments||{};
 if(p.name!==name||Object.keys(filters).some(k=>k!=='runId')||(filters.runId!==undefined&&!runId(filters.runId))||p.delivery?.mode!=='webhook')throw Error('INVALID_EVENT_SUBSCRIPTION');
 const url=callbackUrl(p.delivery.url),canonical=JSON.stringify(filters.runId?{runId:filters.runId}:{});
 const id='sub_'+hex(await crypto.subtle.digest('SHA-256',enc.encode(JSON.stringify([owner,url,name,canonical]))));
 if(q.method==='events/unsubscribe'){await env.DB.prepare('DELETE FROM cream_subscriptions WHERE id=? AND owner=?').bind(id,owner).run();return {};}
 if(q.method!=='events/subscribe')throw Error('UNKNOWN_EVENT_METHOD');
 secretBytes(p.delivery.secret);
 if(p.ttlMs!==undefined&&p.ttlMs!==null&&(!Number.isFinite(p.ttlMs)||p.ttlMs<=0))throw Error('INVALID_TTL');
 const expires=Date.now()+Math.min(7*86400000,p.ttlMs??86400000);
 const old=await env.DB.prepare('SELECT * FROM cream_subscriptions WHERE id=?').bind(id).first();
 const sub={id,url,secret:p.delivery.secret};
 const challenge=crypto.randomUUID();let response;
 try{response=await sendWebhook(sub,{type:'verification',challenge},fetcher);}
 catch(e){throw Object.assign(Error('CALLBACK_VERIFICATION_FAILED'),{reason:e.name==='TimeoutError'?'timeout':'connection_failed'});}
 if(!response.ok)throw Object.assign(Error('CALLBACK_VERIFICATION_FAILED'),{reason:response.status>=300&&response.status<400?'redirect_not_allowed':'http_error',callbackStatus:response.status});
 let answer;try{answer=await response.json();}catch{throw Object.assign(Error('CALLBACK_VERIFICATION_FAILED'),{reason:'invalid_response',callbackStatus:response.status});}
 if(!equal(answer.challenge,challenge))throw Object.assign(Error('CALLBACK_VERIFICATION_FAILED'),{reason:'challenge_failed',callbackStatus:response.status});
 const previous=old&&old.secret!==sub.secret?old.secret:null;
 await env.DB.prepare('INSERT INTO cream_subscriptions(id,owner,name,filters,url,secret,previous_secret,rotated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET secret=excluded.secret,previous_secret=excluded.previous_secret,rotated_at=excluded.rotated_at,expires_at=excluded.expires_at').bind(id,owner,name,canonical,url,sub.secret,previous,previous?Date.now():null,expires).run();
 return {id,refreshBefore:new Date(expires).toISOString(),cursor:null,truncated:false};
}
export async function acceptEvent(data,env){
 const required=Object.keys(eventDefinition.payloadSchema.properties);
 if(!data||typeof data.eventId!=='string'||!/^evt-[a-f0-9]{64}$/.test(data.eventId)||data.name!==name||!Number.isFinite(Date.parse(data.timestamp)))throw Error('INVALID_EVENT');
 const d=data.data;
 if(!d||Object.keys(d).some(k=>!required.includes(k))||required.some(k=>!Object.hasOwn(d,k))||!runId(d.runId)||!['complete','needs_attention','stopped'].includes(d.status)||d.mode!=='live'||!['productCount','judged','adopt','hold','exclude'].every(k=>Number.isSafeInteger(d[k])&&d[k]>=0)||!(d.error===null||typeof d.error==='string'&&d.error.length<=500))throw Error('INVALID_EVENT_DATA');
 await env.DB.prepare('INSERT OR IGNORE INTO cream_events(id,name,occurred_at,data,created_at) VALUES(?,?,?,?,?)').bind(data.eventId,name,data.timestamp,JSON.stringify(d),Date.now()).run();
 const subs=(await env.DB.prepare('SELECT * FROM cream_subscriptions WHERE expires_at>?').bind(Date.now()).all()).results;
 for(const sub of subs){const f=JSON.parse(sub.filters);if(f.runId&&f.runId!==d.runId)continue;await env.DB.prepare('INSERT OR IGNORE INTO cream_deliveries(event_id,subscription_id,state,next_at) VALUES(?,?,?,?)').bind(data.eventId,sub.id,'pending',Date.now()).run();}
 return {accepted:true,subscribers:subs.filter(s=>!JSON.parse(s.filters).runId||JSON.parse(s.filters).runId===d.runId).length};
}
export async function deliverEvents(env,fetcher=fetch){
 const rows=(await env.DB.prepare("SELECT d.*,s.url,s.secret,s.previous_secret,s.rotated_at,s.expires_at,e.name,e.occurred_at,e.data FROM cream_deliveries d JOIN cream_subscriptions s ON s.id=d.subscription_id JOIN cream_events e ON e.id=d.event_id WHERE d.state='pending' AND d.next_at<=? AND s.expires_at>? LIMIT 3").bind(Date.now(),Date.now()).all()).results;
 for(const row of rows){
   const claimed=await env.DB.prepare("UPDATE cream_deliveries SET next_at=? WHERE event_id=? AND subscription_id=? AND state='pending' AND next_at<=? RETURNING event_id").bind(Date.now()+30000,row.event_id,row.subscription_id,Date.now()).first();if(!claimed)continue;
   let status=0;try{status=(await sendWebhook({...row,id:row.subscription_id},{eventId:row.event_id,name:row.name,timestamp:row.occurred_at,data:JSON.parse(row.data),cursor:null},fetcher)).status;}catch{}
   const attempts=row.attempts+1,state=status>=200&&status<300?'delivered':[410,413].includes(status)||attempts>=5?'failed':'pending';
   await env.DB.prepare('UPDATE cream_deliveries SET state=?,attempts=?,next_at=?,last_status=? WHERE event_id=? AND subscription_id=?').bind(state,attempts,Date.now()+Math.min(300000,5000*2**attempts),status,row.event_id,row.subscription_id).run();
 }
}
export async function eventsStatus(env){
 const subscriptions=await env.DB.prepare('SELECT COUNT(*) AS n FROM cream_subscriptions WHERE expires_at>?').bind(Date.now()).first();
 const deliveries=(await env.DB.prepare('SELECT state,COUNT(*) AS n FROM cream_deliveries GROUP BY state').all()).results;
 const latest=await env.DB.prepare('SELECT at,details FROM cream_event_diagnostic WHERE id=1').first();
 return {activeSubscriptions:subscriptions?.n||0,deliveries,lastSubscriptionAttempt:latest?{at:latest.at,...JSON.parse(latest.details)}:null};
}

export function subscriptionDiagnostic(q,owner,error=null){
 const codes=['AUTHENTICATED_OWNER_REQUIRED','INVALID_EVENT_SUBSCRIPTION','CALLBACK_HOST_NOT_ALLOWED','INVALID_SIGNING_SECRET','INVALID_TTL','CALLBACK_VERIFICATION_FAILED'];
 let callbackHost=null;try{callbackHost=new URL(q.params?.delivery?.url).hostname.slice(0,253);}catch{}
 return {ok:!error,code:error?(codes.includes(error.message)?error.message:'EVENT_INTERNAL_ERROR'):null,
  reason:error?.reason||null,callbackStatus:error?.callbackStatus||null,callbackHost,
  authenticated:Boolean(owner),eventRecognized:q.params?.name===name,deliveryMode:q.params?.delivery?.mode==='webhook'?'webhook':'other',
  argumentsType:Array.isArray(q.params?.arguments)?'array':typeof q.params?.arguments,
  signingSecretPresent:typeof q.params?.delivery?.secret==='string'};
}
export async function recordSubscriptionAttempt(env,diagnostic){
 await env.DB.prepare('INSERT INTO cream_event_diagnostic(id,at,details) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET at=excluded.at,details=excluded.details').bind(new Date().toISOString(),JSON.stringify(diagnostic)).run();
}

// Local cryptography and Request construction in the actual hosting runtime; no callback or product data is sent.
export async function webhookRuntimeCheck(){
 const url='https://connectors.api.openai.com/';let legacyRedirectSupported=true,legacyErrorType=null;
 try{new Request(url,{redirect:'error'});}catch(e){legacyRedirectSupported=false;legacyErrorType=e.name;}
 const secret='whsec_'+btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
 let signedRequestConstructed=false;
 await sendWebhook({id:'runtime-check',url,secret},{type:'verification',challenge:'runtime-check'},async(target,options)=>{
  const request=new Request(target,options);
  signedRequestConstructed=request.redirect==='manual'&&request.headers.get('webhook-signature')?.startsWith('v1,')===true;
  return new Response(null,{status:204});
 });
 return {legacyRedirectSupported,legacyErrorType,signedRequestConstructed,networkRequestSent:false};
}
