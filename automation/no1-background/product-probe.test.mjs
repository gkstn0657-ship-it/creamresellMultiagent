import test from 'node:test';
import assert from 'node:assert/strict';
import {probeProduct} from './product-probe.mjs';
const args = {kreamId: '1120286', productUrl: 'https://www.musinsa.com/products/7481180', model: 'NBNPG41033', color: '(19)BLACK', option: 'L(100)'};
function fixture(overrides = {}) {
  const calls = [];
  const responses = {'settings:get': {kreamApiBrowser: 'electron'}, 'stock:check': {makerNumber: args.model, productNumber: '7481180', combinedOptions: [{firstOption: '(19)BLACK', size: 'L(100)', limitedQty: 40}]}, 'musinsa:product:benefit': {productId: '7481180', styleNo: args.model, maxBenefitPrice: 355280}, 'market:kream:prices': {prices: [{size: 'L', sellPrice: 380000}]}, ...overrides};
  return {calls, status: async () => ({connectorVersion: '0.2.0'}), request: async (cmd, payload) => { calls.push({cmd, payload}); return responses[cmd]; }};
}
test('ranking connector 0.7 retains full product and market schema collection', async () => {
  const client=fixture({'market:kream:trades':{items:[],hasNext:false}});client.status=async()=>({connectorVersion:'0.7.0'});
  const result=await probeProduct(client,args);
  assert.equal(result.stock.selectedStockQuantity,40);
  assert.equal(client.calls.find(c=>c.cmd==='market:kream:details').payload.includeFastDelivery,true);
  assert.ok(client.calls.some(c=>c.cmd==='market:kream:history:start'));
  assert.ok(client.calls.some(c=>c.cmd==='market:margin-settings'));
});
test('one-product background probe preserves unknown freshness and cannot approve a purchase', async () => {
  const client = fixture(); const result = await probeProduct(client, args);
  assert.equal(result.stock.selectedStockQuantity, 40); assert.equal(result.benefits.maxBenefitPrice, 355280);
  assert.equal(result.promotionAllowed, false); assert.equal(result.upstreamFreshnessConfirmed, false); assert.equal(result.sourceDataAsOf, null);
  assert.equal(result.identity.marketModelIndependentlyVerified, false);
  assert.deepEqual(client.calls.map(call => call.cmd), ['settings:get', 'stock:check', 'musinsa:product:benefit', 'market:kream:prices']);
});
test('system Chrome mode stops before any product request', async () => {
  const client = fixture({'settings:get': {kreamApiBrowser: 'system-chrome'}});
  await assert.rejects(probeProduct(client, args), /NO1_BACKGROUND_MODE_REQUIRED/); assert.equal(client.calls.length, 1);
});
test('wrong source model prevents subsequent benefit and market requests', async () => {
  const client = fixture({'stock:check': {makerNumber: 'wrong', productNumber: '7481180', combinedOptions: []}});
  await assert.rejects(probeProduct(client, args), /NO1_IDENTITY_MISMATCH/); assert.equal(client.calls.length, 2);
});
test('missing or ambiguous exact color-size combination is rejected', async () => {
  for (const options of [[], [{firstOption: '(19)BLACK', size: 'XL(105)' }], Array(2).fill({firstOption: '(19)BLACK', size: 'L(100)'})]) {
    const client = fixture({'stock:check': {makerNumber: args.model, productNumber: '7481180', combinedOptions: options}});
    await assert.rejects(probeProduct(client, args), /NO1_OPTION_NOT_FOUND/);
  }
});
test('missing stock quantity remains unknown', async () => {
  const client = fixture({'stock:check': {makerNumber: args.model, productNumber: '7481180', combinedOptions: [{firstOption: '(19)BLACK', size: 'L(100)'}]}});
  assert.equal((await probeProduct(client, args)).stock.selectedStockQuantity, null);
});
test('older connector cannot receive product requests', async () => {
  const client = fixture(); client.status = async () => ({connectorVersion: null});
  await assert.rejects(probeProduct(client, args), /NO1_CONNECTOR_UPDATE_REQUIRED/); assert.equal(client.calls.length, 0);
});
test('KREAM login failure preserves successful stock and benefit data as partial', async () => {
  const client = fixture(); const request = client.request;
  client.request = (cmd, payload) => { if (cmd === 'market:kream:prices') throw Error('NO1_PLATFORM_LOGIN_REQUIRED'); return request(cmd, payload); };
  const result = await probeProduct(client, args);
  assert.equal(result.queryStatus, 'partial'); assert.equal(result.errors.market, 'NO1_PLATFORM_LOGIN_REQUIRED');
  assert.equal(result.stock.selectedStockQuantity, 40); assert.equal(result.benefits.maxBenefitPrice, 355280);
  assert.equal(result.market, null); assert.equal(result.promotionAllowed, false);
});
test('wrong benefit identity cannot contaminate the stock result', async () => {
  const result = await probeProduct(fixture({'musinsa:product:benefit': {productId: 'other', styleNo: args.model}}), args);
  assert.equal(result.benefits, null); assert.equal(result.errors.benefits, 'NO1_IDENTITY_MISMATCH'); assert.equal(result.stock.selectedStockQuantity, 40);
});
