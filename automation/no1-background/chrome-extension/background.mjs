import {relayRequest, validateCommand, projectData, safeCode, PRODUCT_COMMANDS, CONNECTOR_VERSION} from './protocol.mjs';
import {readDisplayedTable,readSavedMarginSettings} from './schema-data.mjs';
const BASE = 'http://127.0.0.1:8871';
let busy = false, nextPoll=null,connectionGeneration=0;

async function localRequest(key, route, body) {
  const res = await fetch(BASE + route, {method: body ? 'POST' : 'GET', headers: {'X-No1-Bridge-Key': key, 'X-No1-Connector-Version': CONNECTOR_VERSION, ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {}), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(route.startsWith('/next')?25000:5000)});
  if (!res.ok) throw Error('NO1_BRIDGE_UNAVAILABLE');
  return res.json();
}

// Only the existing official No1 web tab is read. No tabs/windows are opened,
// activated, navigated, or closed. This function never returns user/password data.
async function existingWebToken() {
  const tabs = await chrome.tabs.query({url: ['https://no1.certi.life/sourcing/*', 'https://onebox.team/sourcing/*']});
  if (!tabs.length) throw Error('NO1_WEB_TAB_REQUIRED');
  const tokens = new Set(),authenticatedTabs=[];
  let inspected = false;
  for (const tab of tabs) {
    try {
      const frames = await chrome.scripting.executeScript({
        target: {tabId: tab.id, allFrames: true}, world: 'ISOLATED',
        func: () => {
          if (location.origin !== 'https://no1.certi.life' || !location.pathname.startsWith('/sourcing/')) return null;
          const storage = localStorage.getItem('no1seller:persistLogin') === 'true' ? localStorage : sessionStorage;
          const token = storage.getItem('appToken');
          return typeof token === 'string' && token.length > 0 && token.length <= 16384 && !/\s/.test(token) ? token : null;
        }
      });
      inspected = true;
      for (const frame of frames) if (typeof frame.result === 'string') {tokens.add(frame.result);if(!authenticatedTabs.includes(tab.id))authenticatedTabs.push(tab.id);}
    } catch { /* Do not log browser exceptions: they may contain page details. */ }
  }
  if (!inspected) throw Error('NO1_BROWSER_ACCESS_FAILED');
  if (tokens.size > 1) throw Error('NO1_MULTIPLE_WEB_SESSIONS');
  if (!tokens.size) throw Error('NO1_AUTH_REQUIRED');
  return {token:tokens.values().next().value,tabIds:authenticatedTabs};
}

async function pageSchema(cmd,payload,tabIds){
  const values=[];
  for(const tabId of tabIds){
    const frames=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:cmd==='market:kream:displayed-schema'?'MAIN':'ISOLATED',func:cmd==='market:kream:displayed-schema'?readDisplayedTable:readSavedMarginSettings,args:cmd==='market:kream:displayed-schema'?[payload.productCode]:[]});
    for(const frame of frames)if(frame.result)values.push(...(Array.isArray(frame.result)?frame.result:[frame.result]));
  }
  const unique=new Map(values.map(v=>{const {observedAt,...stable}=v;return [JSON.stringify(stable),v];}));
  if(unique.size>1)throw Error('NO1_SCHEMA_AMBIGUOUS');
  const value=unique.values().next().value;
  if(!value&&cmd==='market:margin-settings')throw Error('NO1_SCHEMA_NOT_AVAILABLE');
  return projectData(cmd,value||{available:false,reason:'MATCHING_PRICE_TABLE_NOT_OPEN'},payload);
}

async function setStatus(code) { await chrome.storage.local.set({lastStatus: code, lastCheckedAt: new Date().toISOString()}); }
async function poll() {
  if (busy) return;
  clearTimeout(nextPoll);busy = true;let repeat=false,delay=0;const generation=connectionGeneration;
  try {
    const {enabled, bridgeKey} = await chrome.storage.local.get(['enabled', 'bridgeKey']);
    if (!enabled || !/^[a-f0-9]{64}$/.test(bridgeKey || '')) return;
    repeat=true;
    const {job} = await localRequest(bridgeKey, '/next?wait=20000');
    if(generation!==connectionGeneration)return;
    if (!job) return;
    let result;
    try {
      if (typeof job.id !== 'string' || !Number.isFinite(job.deadline) || job.deadline <= Date.now()) throw Error('NO1_BRIDGE_TIMEOUT');
      validateCommand(job.cmd, job.payload);
      const {token,tabIds} = await existingWebToken();
      const pageOnly=['market:margin-settings','market:kream:displayed-schema'].includes(job.cmd);
      if (!pageOnly&&PRODUCT_COMMANDS.includes(job.cmd)) {
        const settings = await relayRequest({cmd: 'settings:get', token});
        if (settings.kreamApiBrowser !== 'electron') throw Error('NO1_BACKGROUND_MODE_REQUIRED');
        if (job.cmd.startsWith('market:kream:') || job.cmd === 'mecro:inventory:search') {
          const state = await relayRequest({cmd: 'platform:status', payload: {platform: 'kream'}, token});
          if (state.sessions[0].status !== 'active') throw Error('NO1_PLATFORM_LOGIN_REQUIRED');
        }
        if (job.cmd === 'musinsa:product:benefit') {
          const state = await relayRequest({cmd: 'musinsa:ranking:check-login', token});
          if (!state.isLoggedIn) throw Error('NO1_PLATFORM_LOGIN_REQUIRED');
        }
      }
      const data = pageOnly?await pageSchema(job.cmd,job.payload,tabIds):await relayRequest({cmd: job.cmd, payload: job.payload, token, timeoutMs: Math.min(['stock:check','market:kream:history:start'].includes(job.cmd) ? 95000 : 40000, Math.max(1, job.deadline - Date.now() - 1000))});
      result = {id: job.id, ok: true, data};
    } catch (error) { result = {id: job.id, ok: false, error: {code: safeCode(error.message)}}; }
    await localRequest(bridgeKey, '/result', result);
    await setStatus(result.ok ? 'VERIFIED_READ' : result.error.code);
  } catch { delay=3000;if(generation===connectionGeneration)await setStatus('NO1_BRIDGE_UNAVAILABLE'); }
  finally { busy = false;if(repeat&&generation===connectionGeneration)nextPoll=setTimeout(()=>void poll(),delay); }
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (!['connect', 'disconnect'].includes(message?.type)) return false;
  (async () => {
    if (message.type === 'connect') {
      if (!/^[a-f0-9]{64}$/.test(message.key || '')) return {ok: false, code: 'INVALID_PAIRING_CODE'};
      try { await localRequest(message.key, '/status'); } catch { return {ok: false, code: 'NO1_BRIDGE_UNAVAILABLE'}; }
      await chrome.storage.local.set({bridgeKey: message.key, enabled: true, lastStatus: 'CONNECTED'});
      await chrome.alarms.create('no1-background-poll', {periodInMinutes: 0.5});
      void poll(); return {ok: true};
    }
    connectionGeneration++;
    const {bridgeKey} = await chrome.storage.local.get('bridgeKey');
    await chrome.storage.local.set({enabled: false, lastStatus: 'DISCONNECTED'});
    clearTimeout(nextPoll);
    await chrome.storage.local.remove('bridgeKey');
    await chrome.alarms.clear('no1-background-poll');
    if (bridgeKey) await localRequest(bridgeKey, '/disconnect', {}).catch(() => {});
    return {ok: true};
  })().then(reply).catch(() => reply({ok: false, code: 'NO1_BRIDGE_UNAVAILABLE'}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'no1-background-poll') void poll(); });
chrome.runtime.onStartup.addListener(() => { void poll(); });
setInterval(() => { void poll(); }, 3000);
void poll();
