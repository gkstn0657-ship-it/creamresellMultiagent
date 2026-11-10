import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createBridge} from './bridge.mjs';
import {BackgroundClient} from './client.mjs';
import {dispatchBackground} from './mcp.mjs';
const key = 'a'.repeat(64);
test('pipeline capability follows connector connectivity, not authentication proof',async t=>{
 const {bridge,send}=await fixture(t);assert.equal(bridge.status().pipelineProductQueriesEnabled,false);
 await send('/next',null,{'X-No1-Connector-Version':'0.5.0'});
 assert.equal(bridge.status().pipelineProductQueriesEnabled,true);
 assert.equal(bridge.status().authentication,'check-platform-status-separately');
 await send('/disconnect',{});assert.equal(bridge.status().pipelineProductQueriesEnabled,false);
});
async function fixture(t, options = {}) {
  const bridge = createBridge({key, requestTimeoutMs: 200, ...options});
  await new Promise(resolve => bridge.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${bridge.server.address().port}`;
  t.after(() => bridge.close());
  const send = (route, body, headers = {}) => fetch(url + route, {method: body ? 'POST' : 'GET', headers: {'X-No1-Bridge-Key': key, ...headers}, ...(body ? {body: JSON.stringify(body)} : {})});
  const client = new BackgroundClient({config: () => ({url, key}),serialize:false});
  return {bridge, url, send, client};
}
async function pendingJob(send) {
  for (let i = 0; i < 20; i++) { const result = await (await send('/next')).json(); if (result.job) return result.job; await new Promise(r => setTimeout(r, 5)); }
  throw Error('TEST_JOB_NOT_DELIVERED');
}
test('localhost auth, origin, host and oversized key checks', async t => {
  const {url, send} = await fixture(t);
  assert.equal((await fetch(url + '/status')).status, 401);
  assert.equal((await send('/status', null, {'X-No1-Bridge-Key': 'é'.repeat(64)})).status, 401);
  assert.equal((await send('/status', null, {Origin: 'https://evil.example'})).status, 403);
  const wrongHostStatus = await new Promise((resolve, reject) => {
    const req = http.get(url + '/status', {headers: {Host: 'evil.example', 'X-No1-Bridge-Key': key}}, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(wrongHostStatus, 403);
  const res = await send('/status', null, {Origin: 'chrome-extension://' + 'b'.repeat(32)});
  assert.equal(res.status, 200); assert.equal(res.headers.get('access-control-allow-origin'), 'chrome-extension://' + 'b'.repeat(32));
});
test('end-to-end HTTP client -> broker -> simulated extension -> matching result', async t => {
  const {send, client} = await fixture(t); await send('/next');
  const pending = client.request('stock:supportedSites'); const job = await pendingJob(send);
  assert.equal(job.cmd, 'stock:supportedSites'); assert.deepEqual(job.payload, {});
  assert.equal((await send('/result', {id: 'wrong', ok: true, data: {sites: []}})).status, 409);
  await send('/result', {id: job.id, ok: true, data: {sites: [{key: 'musinsa', name: 'Musinsa', token: 'secret'}]}});
  assert.deepEqual(await pending, {sites: [{key: 'musinsa', name: 'Musinsa'}]});
  assert.equal((await send('/result', {id: job.id, ok: true, data: {sites: []}})).status, 409);
});
test('unpaired browser and product queries fail before a job is delivered', async t => {
  const {client, send} = await fixture(t);
  await assert.rejects(client.request('stock:supportedSites'), /NO1_BRIDGE_DISCONNECTED/);
  await assert.rejects(client.request('market:kream:prices', {productCode: '1120286'}), /NO1_CONNECTOR_UPDATE_REQUIRED/);
  assert.equal((await send('/rpc', {cmd: 'orders:cancel', payload: {}})).status, 400);
  assert.equal((await (await send('/next')).json()).job, null);
});
test('expired request is removed; late results cannot satisfy another request', async t => {
  // Allow the HTTP job to be delivered under concurrent test-runner load before
  // testing expiry; a 20 ms deadline could expire before pendingJob sees it.
  const {send, client} = await fixture(t, {requestTimeoutMs: 500}); await send('/next');
  const request = client.request('stock:supportedSites'); const rejection = assert.rejects(request, /NO1_BRIDGE_TIMEOUT/); const job = await pendingJob(send);
  await rejection;
  assert.equal((await send('/result', {id: job.id, ok: true, data: {sites: []}})).status, 409);
  const next=client.request('stock:supportedSites');const nextJob=await pendingJob(send);
  assert.notEqual(nextJob.id,job.id);
  assert.equal((await send('/result',{id:job.id,ok:true,data:{sites:[]}})).status,409);
  await send('/result',{id:nextJob.id,ok:true,data:{sites:[]}});assert.deepEqual(await next,{sites:[]});
});
test('only one active request; explicit disconnect settles it immediately', async t => {
  const {send, client} = await fixture(t); await send('/next');
  const pending = client.request('stock:supportedSites'); const rejected = assert.rejects(pending, /NO1_CONNECTION_STOPPED/); await pendingJob(send);
  await assert.rejects(client.request('stock:supportedSites'), /NO1_BRIDGE_BUSY/);
  await send('/disconnect', {}); await rejected; assert.equal((await client.status()).browserConnected, false);
});
test('malformed successful result is rejected without leaking its payload', async t => {
  const {send, client} = await fixture(t); await send('/next');
  const pending = client.request('musinsa:ranking:check-login'); const rejected = assert.rejects(pending, {message: 'NO1_INVALID_RESPONSE'}); const job = await pendingJob(send);
  assert.equal((await send('/result', {id: job.id, ok: true, data: {password: 'secret'}})).status, 400); await rejected;
});
test('metadata MCP result is never marked as verified product evidence', async () => {
  const req = {id: 1, method: 'tools/call', params: {name: 'no1_background_musinsa_login', arguments: {}}};
  const response = await dispatchBackground(req, {request: async () => ({isLoggedIn: true})});
  const value = JSON.parse(response.result.content[0].text);
  assert.equal(value.productDataVerified, false); assert.equal(value.promotionAllowed, false);
  assert.equal((await dispatchBackground({...req, params: {...req.params, arguments: {script: 'x'}}})).result.isError, true);
});

test('waiting extension receives a new job immediately and records dispatch latency',async t=>{
 const {send,client,bridge}=await fixture(t,{requestTimeoutMs:1000});
 const waiting=send('/next?wait=2000').then(r=>r.json());
 await new Promise(r=>setTimeout(r,30));
 const pending=client.request('stock:supportedSites');const {job}=await waiting;
 assert.equal(job.cmd,'stock:supportedSites');
 await send('/result',{id:job.id,ok:true,data:{sites:[]}});await pending;
 const timing=bridge.status().recentTimings.at(-1);assert.ok(timing.queueMs<100);assert.equal(timing.ok,true);
});

test('collectors in the same worker share a FIFO No1 queue and failures release it',async()=>{
 let active=0,maxActive=0,calls=0;
 const fetcher=async()=>{active++;maxActive=Math.max(maxActive,active);const n=++calls;await new Promise(r=>setTimeout(r,10));active--;return {ok:true,json:async()=>n===1?{ok:false,error:{code:'NO1_REMOTE_ERROR'}}:{ok:true,data:{sites:[]}}};};
 const config=()=>({url:'http://queue.test',key});const a=new BackgroundClient({config,fetcher}),b=new BackgroundClient({config,fetcher});
 const results=await Promise.allSettled([a.request('stock:supportedSites'),b.request('stock:supportedSites')]);
 assert.equal(maxActive,1);assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');
});

test('a legitimate long No1 request does not lose browser connection while it is in flight',async t=>{
 let clock=1;const {send,client,bridge}=await fixture(t,{requestTimeoutMs:100000,now:()=>clock});await send('/next');
 const pending=client.request('stock:supportedSites');const job=await pendingJob(send);clock+=45000;
 assert.equal(bridge.status().browserConnected,true);
 await send('/result',{id:job.id,ok:true,data:{sites:[]}});await pending;
 assert.equal(bridge.status().browserConnected,false);await send('/next');assert.equal(bridge.status().browserConnected,true);
});
