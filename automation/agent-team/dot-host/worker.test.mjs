import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from './worker.mjs';
const setup=()=>{const db=new DatabaseSync(':memory:');for(const file of ['0000_cream_queue.sql','0001_ui_status.sql','0002_events.sql','0003_event_diagnostic.sql'])db.exec(fs.readFileSync(new URL('./drizzle/'+file,import.meta.url),'utf8'));return {db,env:{CREAM_BRIDGE_KEY:'test-key',DB:{prepare(sql){return {bind(...values){return {async run(){return db.prepare(sql).run(...values);},async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};}};},async first(){return db.prepare(sql).get()||null;},async all(){return {results:db.prepare(sql).all()};}};}}}};};
const req=(pathname,body,headers={})=>new Request('https://test.chatgpt.site'+pathname,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
const rpc=(name,args={},authenticated=true)=>req('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},authenticated?{'oai-authenticated-user-id':'owner'}:{});
test('remote tool calls require authentication and a live PC',async()=>{const {env,db}=setup();let r=await (await worker.fetch(rpc('cream_batch_start',{},false),env)).json();assert.equal(r.result.isError,true);assert.match(r.result.content[0].text,/AUTHENTICATED/);r=await (await worker.fetch(rpc('cream_batch_start'),env)).json();assert.match(r.result.content[0].text,/PC_OFFLINE/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cream_jobs').get().n,0);});
test('bridge rejects requests without its separate key',async()=>{const {env}=setup();assert.equal((await worker.fetch(req('/bridge/claim',{}),env)).status,401);});
test('service diagnostics cannot execute write commands',async()=>{const {env,db}=setup();const r=await (await worker.fetch(req('/bridge/check',{id:1,method:'tools/call',params:{name:'cream_batch_start',arguments:{}}},{'x-cream-bridge-key':'test-key'}),env)).json();assert.match(r.result.content[0].text,/DIAGNOSTIC_READ_ONLY/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cream_jobs').get().n,0);});
test('remote MCP round trip preserves widget metadata and a command is claimed only once',async()=>{const {env}=setup(),headers={'x-cream-bridge-key':'test-key'};await worker.fetch(req('/bridge/claim',{},headers),env);const resultPromise=worker.fetch(rpc('cream_panel_data'),env);await new Promise(r=>setTimeout(r,30));const first=await (await worker.fetch(req('/bridge/claim',{},headers),env)).json();assert.ok(first.job.id);const second=await (await worker.fetch(req('/bridge/claim',{},headers),env)).json();assert.equal(second.job,null);await worker.fetch(req('/bridge/result',{id:first.job.id,result:{content:[],_meta:{panel:{version:'fixture'}}}},headers),env);const r=await (await resultPromise).json();assert.equal(r.result._meta.panel.version,'fixture');});
test('unknown tools cannot enter the command queue',async()=>{const {env}=setup();await worker.fetch(req('/bridge/claim',{}, {'x-cream-bridge-key':'test-key'}),env);const r=await (await worker.fetch(rpc('exec_shell',{cmd:'anything'}),env)).json();assert.match(r.result.content[0].text,/UNKNOWN_CONTROL_TOOL/);});
test('remote discovery exposes the panel resource and no localhost URL',async()=>{const {env}=setup();const r=await (await worker.fetch(req('/mcp',{id:1,method:'resources/list'}),env)).json();const html=await (await worker.fetch(req('/mcp',{id:2,method:'resources/read',params:{uri:r.result.resources[0].uri}}),env)).json();assert.match(html.result.contents[0].mimeType,/mcp-app/);assert.ok(!html.result.contents[0].text.includes('http://localhost'));});
test('connection status distinguishes resource delivery and client-ready report',async()=>{const {env}=setup();let r=await (await worker.fetch(rpc('cream_connection_status'),env)).json();assert.equal(r.result.structuredContent.ui.display,'not_observed');await worker.fetch(rpc('cream_panel_ready',{uiVersion:'test'}),env);r=await (await worker.fetch(rpc('cream_connection_status'),env)).json();assert.equal(r.result.structuredContent.ui.display,'client_reported_ready');});

test('native subscription failure is visible without storing callback path or signing secret',async()=>{
 const {env,db}=setup();const secret='whsec_sensitive-value',url='https://example.invalid/private-token?key=sensitive-query';
 const r=await (await worker.fetch(req('/mcp',{id:1,method:'events/subscribe',params:{name:'cream.batch.finished',arguments:{},delivery:{mode:'webhook',url,secret}}},{'oai-authenticated-user-id':'owner'}),env)).json();
 assert.equal(r.error.message,'CALLBACK_HOST_NOT_ALLOWED');
 const status=(await (await worker.fetch(rpc('cream_connection_status'),env)).json()).result.structuredContent.events;
 assert.equal(status.activeSubscriptions,0);assert.equal(status.lastSubscriptionAttempt.code,'CALLBACK_HOST_NOT_ALLOWED');assert.equal(status.lastSubscriptionAttempt.callbackHost,'example.invalid');
 const saved=JSON.stringify(db.prepare('SELECT * FROM cream_event_diagnostic').get());assert.ok(!saved.includes(secret)&&!saved.includes('private-token')&&!saved.includes('sensitive-query'));
});

test('hosting runtime check exercises signed request construction without outbound delivery',async()=>{
 const {env}=setup();assert.equal((await worker.fetch(req('/bridge/event-runtime-check',{}),env)).status,401);
 const r=await (await worker.fetch(req('/bridge/event-runtime-check',{}, {'x-cream-bridge-key':'test-key'}),env)).json();
 assert.equal(r.signedRequestConstructed,true);assert.equal(r.networkRequestSent,false);
});
test('discovery tools and instructions expose a code-owned loop without discovery AI',async()=>{
 const {env}=setup();const initialized=(await (await worker.fetch(req('/mcp',{id:1,method:'initialize'}),env)).json()).result;
 assert.match(initialized.instructions,/NO AI/);assert.match(initialized.instructions,/cream_explore_start/);
 const list=(await (await worker.fetch(req('/mcp',{id:2,method:'tools/list'}),env)).json()).result.tools;
 assert.ok(list.some(t=>t.name==='cream_explore_start'));assert.equal(list.find(t=>t.name==='cream_discovery_status').annotations.readOnlyHint,true);
 const blocked=await (await worker.fetch(req('/bridge/check',{id:3,method:'tools/call',params:{name:'cream_explore_start',arguments:{}}},{'x-cream-bridge-key':'test-key'}),env)).json();assert.match(blocked.result.content[0].text,/DIAGNOSTIC_READ_ONLY/);
});
