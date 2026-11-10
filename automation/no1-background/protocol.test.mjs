import test from 'node:test';
test('No1 missing colorway is valid unknown data, never a schema error',()=>{
 assert.deepEqual(projectData('market:kream:details',{totalSales:0,colorway:null,sizeOptions:[]}),{totalSales:0,colorway:null,sizeOptions:[]});
 assert.throws(()=>projectData('market:kream:details',{colorway:{bad:true},sizeOptions:[]}),/INVALID_RESPONSE/);
});
import assert from 'node:assert/strict';
import {relayRequest, validateCommand, projectData, validateProjectedData} from './chrome-extension/protocol.mjs';

class FakeSocket extends EventTarget {
  static behavior = null; static instances = [];
  constructor(url) { super(); this.url = url; this.sent = []; this.readyState = 0; FakeSocket.instances.push(this); queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }); }
  send(raw) { const value = JSON.parse(raw); this.sent.push(value); FakeSocket.behavior?.(this, value); }
  receive(value) { this.dispatchEvent(new MessageEvent('message', {data: typeof value === 'string' ? value : JSON.stringify(value)})); }
  close(code = 1000) { this.readyState = 3; const e = new Event('close'); e.code = code; this.dispatchEvent(e); }
}
const call = options => relayRequest({cmd: 'musinsa:ranking:check-login', payload: {}, token: 'test-no1-secret', Socket: FakeSocket, timeoutMs: 100, traceId: 'trace-one', ...options});
const response = (req, data = {isLoggedIn: true}) => ({type: 'RES', v: 2, traceId: req.traceId, cmd: req.cmd, ok: true, data});

test('official endpoint only; token never enters request payload or result', async () => {
  FakeSocket.behavior = (s, req) => s.receive(response(req, {isLoggedIn: true, token: 'must-be-discarded'}));
  const result = await call(); const s = FakeSocket.instances.at(-1); const url = new URL(s.url);
  assert.equal(url.origin, 'wss://relay.certi.life'); assert.equal(url.pathname, '/ws/v2');
  assert.equal(url.searchParams.get('token'), 'test-no1-secret');
  assert.deepEqual(result, {isLoggedIn: true}); assert.ok(!JSON.stringify(s.sent).includes('test-no1-secret'));
});
test('unknown response trace ignored; wrong matching command rejected', async () => {
  FakeSocket.behavior = (s, req) => { s.receive({...response(req), traceId: 'someone-else'}); s.receive({...response(req), cmd: 'stock:check'}); };
  await assert.rejects(call(), /NO1_INVALID_RESPONSE/);
});
test('handles heartbeat, ignores PUSH, and accepts only matching response', async () => {
  FakeSocket.behavior = (s, req) => {
    if (req.type !== 'REQ') return;
    s.receive({type: 'PING', v: 2}); s.receive({type: 'PUSH', v: 2, data: {password: 'private'}}); s.receive(response(req));
  };
  assert.deepEqual(await call(), {isLoggedIn: true});
  assert.ok(FakeSocket.instances.at(-1).sent.some(x => x.type === 'PONG'));
});
test('auth rejection closes request without falling back to a login window', async () => {
  FakeSocket.behavior = s => s.close(4001); await assert.rejects(call(), /NO1_AUTH_REQUIRED/);
});
test('No1 offline is preserved as a failure, not an empty product result', async () => {
  FakeSocket.behavior = (s, req) => s.receive({...response(req), ok: false, error: {code: 'NO_ELECTRON_CONNECTED', message: 'secret-value'}});
  await assert.rejects(call(), {message: 'NO_ELECTRON_CONNECTED'});
});
test('untrusted error text and codes cannot expose secrets', async () => {
  FakeSocket.behavior = (s, req) => s.receive({...response(req), ok: false, error: {code: 'secret-value', message: 'secret-value'}});
  await assert.rejects(call(), {message: 'NO1_REMOTE_ERROR'});
});
test('timeout closes the socket and never retries the command', async () => {
  FakeSocket.behavior = () => {}; await assert.rejects(call({timeoutMs: 10}), /NO1_RELAY_TIMEOUT/);
  const s = FakeSocket.instances.at(-1); assert.equal(s.readyState, 3); assert.equal(s.sent.length, 1);
});
for (const bad of [null, '', 'has whitespace']) test(`missing/invalid token: ${String(bad)}`, async () => { await assert.rejects(call({token: bad}), /NO1_AUTH_REQUIRED/); });
for (const cmd of ['market:kream:search', 'stock:openProductPage', 'auth:get-token', 'orders:cancel']) test(`unverified command blocked: ${cmd}`, () => assert.throws(() => validateCommand(cmd, {}), /NO1_COMMAND_FORBIDDEN/));
test('extra payload and non-object payload rejected', () => {
  for (const value of [null, [], {url: 'https://other.test'}]) assert.throws(() => validateCommand('stock:supportedSites', value), /NO1_INVALID_PAYLOAD/);
});
test('settings projection strips all accounts and credential fields', () => {
  assert.deepEqual(projectData('settings:get', {settings: {accounts: [{password: 'secret'}], platforms: {token: 'secret'}, benefitAccountId: 'private-account', kreamApiBrowser: 'electron'}}), {kreamApiBrowser: 'electron', benefitAccountConfigured: true});
  assert.deepEqual(projectData('settings:get', {settings: {}}), {kreamApiBrowser: 'electron', benefitAccountConfigured: false});
  assert.throws(() => projectData('settings:get', {settings: {kreamApiBrowser: 'unknown'}}));
});
test('site result projection drops unexpected nested secrets', () => {
  assert.deepEqual(projectData('stock:supportedSites', {sites: [{key: 'musinsa', name: 'Musinsa', password: 'secret'}]}), {sites: [{key: 'musinsa', name: 'Musinsa'}]});
  assert.throws(() => projectData('stock:supportedSites', {sites: [{key: 'musinsa'}]}));
  assert.throws(() => validateProjectedData('settings:get', {kreamApiBrowser: 'electron', benefitAccountConfigured: 'yes'}));
});
test('invalid JSON and oversized responses fail closed', async () => {
  for (const raw of ['invalid-json', 'x'.repeat(1000001)]) {
    FakeSocket.behavior = s => s.receive(raw); await assert.rejects(call(), /NO1_INVALID_RESPONSE/);
  }
});
test('product payloads reject unrelated URLs, extra keys and missing identifiers', () => {
  validateCommand('stock:check', {url: 'https://www.musinsa.com/products/7481180'});
  validateCommand('market:kream:prices', {productCode: '1120286'});
  validateCommand('musinsa:product:benefit', {productId: '7481180'});
  for (const [cmd, payload] of [['stock:check', {url: 'https://other.test/7481180'}], ['market:kream:prices', {}], ['musinsa:product:benefit', {productId: '7481180', accountId: 'other'}], ['platform:status', {platform: 'other'}]]) assert.throws(() => validateCommand(cmd, payload), /NO1_INVALID_PAYLOAD/);
});
test('stock and benefit identity are bound to the requested product', () => {
  assert.throws(() => projectData('stock:check', {status: 'success', siteType: 'musinsa', productNumber: 'other'}, {url: 'https://www.musinsa.com/products/7481180'}), /NO1_IDENTITY_MISMATCH/);
  assert.throws(() => projectData('musinsa:product:benefit', {productId: 'other', styleNo: 'model'}, {productId: '7481180'}), /NO1_IDENTITY_MISMATCH/);
  const data = projectData('musinsa:product:benefit', {productId: '7481180', styleNo: 'model', salePrice: 100, maxBenefitPrice: 90, memberPoint: 999999, memberBenefits: {usablePoint: 10}, productCouponTerms: {quantity: 1, accountId: 'private'}}, {productId: '7481180'});
  assert.equal(data.normalPrice, null); assert.equal(data.memberPoint, undefined); assert.deepEqual(data.memberBenefits, {usablePoint: 10}); assert.deepEqual(data.productCouponTerms, {quantity: 1});
});
test('platform status drops login ID; unavailable prices remain null', () => {
  assert.deepEqual(projectData('platform:status', {sessions: [{platform: 'kream', status: 'active', loginId: 'private-email'}]}), {sessions: [{platform: 'kream', status: 'active'}]});
  assert.deepEqual(projectData('market:kream:prices', {prices: [{size: 'L', option: '100', buyPrice: null, sellPrice: 100}]}), {prices: [{size: 'L', option: '100', buyPrice: null, sellPrice: 100, lastSalePrice: null}]});
});
