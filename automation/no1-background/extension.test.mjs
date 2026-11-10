import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('extension worker reads only existing No1 session and sends only projected results locally', async t => {
  const original = Object.fromEntries(['chrome', 'fetch', 'WebSocket', 'setInterval', 'location', 'localStorage', 'sessionStorage'].map(key => [key, globalThis[key]]));
  t.after(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const localKey = 'b'.repeat(64), no1Token = 'no1-session-secret-never-leaves-browser';
  const store = {}; const localResults = []; const storageReads = []; const socketUrls = [];
  let listener, alarmListener, job, tabCount = 1, loggedIn = true;
  const waitFor = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); } throw Error('TEST_WORKER_TIMEOUT'); };
  globalThis.location = {origin: 'https://no1.certi.life', pathname: '/sourcing/'};
  globalThis.localStorage = {getItem: key => { storageReads.push(key); return key === 'no1seller:persistLogin' ? 'true' : key === 'appToken' && loggedIn ? no1Token : null; }};
  globalThis.sessionStorage = {getItem: () => { throw Error('WRONG_STORAGE'); }};
  globalThis.chrome = {
    storage: {local: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, store[key]])),
      set: async values => { Object.assign(store, values); }, remove: async key => { delete store[key]; }
    }},
    tabs: {query: async query => { assert.deepEqual(query.url, ['https://no1.certi.life/sourcing/*', 'https://onebox.team/sourcing/*']); return Array.from({length: tabCount}, (_, id) => ({id})); }},
    scripting: {executeScript: async options => {
      assert.equal(options.world, 'ISOLATED'); assert.deepEqual(options.target.frameIds, [0]);
      return [{result: options.func()}];
    }},
    runtime: {onMessage: {addListener: fn => { listener = fn; }}, onStartup: {addListener: () => {}}},
    alarms: {get:async()=>null,create: async () => {}, clear: async () => {}, onAlarm: {addListener: fn => { alarmListener = fn; }}}
  };
  globalThis.fetch = async (url, options) => {
    assert.ok(url.startsWith('http://127.0.0.1:8871/')); assert.equal(options.headers['X-No1-Bridge-Key'], localKey);
    let data = {};
    if (url.includes('/next?wait=')) { data = {job}; job = null;if(!data.job)await new Promise(r=>setTimeout(r,10)); }
    if (url.endsWith('/result')) localResults.push(JSON.parse(options.body));
    return {ok: true, json: async () => data};
  };
  globalThis.WebSocket = class extends EventTarget {
    constructor(url) { super(); socketUrls.push(url); this.readyState = 0; queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }); }
    send(raw) {
      const request = JSON.parse(raw);
      const data = {settings: {kreamApiBrowser: 'electron', benefitAccountId: 'private-account', password: 'must-be-removed', token: 'must-be-removed'}};
      this.dispatchEvent(new MessageEvent('message', {data: JSON.stringify({type: 'RES', v: 2, traceId: request.traceId, cmd: request.cmd, ok: true, data})}));
    }
    close() { this.readyState = 3; }
  };
  globalThis.setInterval = () => 0;
  await import('./chrome-extension/background.mjs');
  await new Promise(r => setTimeout(r, 0));
  const request = message => new Promise(resolve => listener(message, {}, resolve));
  job = {id: 'one', cmd: 'settings:get', payload: {}, deadline: Date.now() + 5000};
  assert.deepEqual(await request({type: 'connect', key: localKey}), {ok: true});
  await waitFor(() => localResults.length === 1 && store.lastStatus === 'VERIFIED_READ');
  assert.deepEqual(localResults[0], {id: 'one', ok: true, data: {kreamApiBrowser: 'electron', benefitAccountConfigured: true}});
  assert.equal(new URL(socketUrls[0]).searchParams.get('token'), no1Token);
  assert.ok(!JSON.stringify({store, localResults}).includes(no1Token));
  assert.ok(!JSON.stringify(localResults).includes('must-be-removed'));
  assert.deepEqual([...new Set(storageReads)].sort(), ['appToken', 'no1seller:persistLogin']);

  // A detached price-comparison page must not override the main session.
  const oldQuery=chrome.tabs.query,oldExecute=chrome.scripting.executeScript;
  chrome.tabs.query=async()=>[{id:10,url:'https://no1.certi.life/sourcing/#/main/seller-integration'},{id:11,url:'https://no1.certi.life/sourcing/#/price-comparison'}];
  chrome.scripting.executeScript=async options=>{assert.equal(options.target.tabId,10);assert.deepEqual(options.target.frameIds,[0]);return [{result:no1Token}];};
  job={id:'diagnostic',cmd:'connector:session-status',payload:{},deadline:Date.now()+5000};
  await waitFor(()=>localResults.length===2);
  assert.equal(localResults[1].data.distinctSessionCount,1);assert.equal(localResults[1].data.mainTabCount,1);
  assert.ok(!JSON.stringify(localResults[1]).includes(no1Token));
  localResults.pop();chrome.tabs.query=oldQuery;chrome.scripting.executeScript=oldExecute;

  loggedIn = false;
  job = {id: 'two', cmd: 'settings:get', payload: {}, deadline: Date.now() + 5000};
  alarmListener({name: 'no1-background-poll'});
  await waitFor(() => localResults.length === 2 && store.lastStatus === 'NO1_AUTH_REQUIRED');
  assert.equal(localResults[1].error.code, 'NO1_AUTH_REQUIRED'); assert.equal(socketUrls.length, 1);
  tabCount = 0;
  job = {id: 'three', cmd: 'settings:get', payload: {}, deadline: Date.now() + 5000};
  alarmListener({name: 'no1-background-poll'});
  await waitFor(() => localResults.length === 3 && store.lastStatus === 'NO1_WEB_TAB_REQUIRED');
  assert.equal(localResults[2].error.code, 'NO1_WEB_TAB_REQUIRED');
  assert.deepEqual(await request({type: 'disconnect'}), {ok: true});
  assert.equal(store.enabled, false); assert.equal(store.bridgeKey, undefined);
});

test('extension package has explicit hosts and all entrypoints exist', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('./chrome-extension/manifest.json', import.meta.url), 'utf8'));
  assert.ok(!manifest.host_permissions.includes('<all_urls>'));
  assert.ok(!manifest.permissions.includes('debugger'));
  for (const file of ['background.mjs', 'protocol.mjs', 'popup.html', 'popup.mjs', 'popup.css']) assert.ok(fs.existsSync(new URL('./chrome-extension/' + file, import.meta.url)));
});
