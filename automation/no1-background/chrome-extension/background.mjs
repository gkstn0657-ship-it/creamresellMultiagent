import {relayRequest, validateCommand, projectData, safeCode, PRODUCT_COMMANDS, CONNECTOR_VERSION} from './protocol.mjs';
import {readDisplayedTable,readSavedMarginSettings} from './schema-data.mjs';
import {readRankingSettings} from './ranking-data.mjs';
import {createConnectionLoop} from './connection-loop.mjs';
import {readPoizonMarginSettings,readPoizonDisplayedTable} from './poizon-data.mjs';
const BASE = 'http://127.0.0.1:8871';

async function localRequest(key, route, body, signal) {
  const timeout=AbortSignal.timeout(route.startsWith('/next')?25000:5000);
  const res = await fetch(BASE + route, {method: body ? 'POST' : 'GET', headers: {'X-No1-Bridge-Key': key, 'X-No1-Connector-Version': CONNECTOR_VERSION, ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {}), redirect: 'error', cache: 'no-store', signal: signal?AbortSignal.any([signal,timeout]):timeout});
  if (!res.ok) throw Error('NO1_BRIDGE_UNAVAILABLE');
  return res.json();
}

// Only the existing official No1 web tab is read. No tabs/windows are opened,
// activated, navigated, or closed. This function never returns user/password data.
async function existingWebToken() {
  const found = await chrome.tabs.query({url: ['https://no1.certi.life/sourcing/*', 'https://onebox.team/sourcing/*']});
  // The main sourcing page is the session authority. Detached comparison
  // windows can retain an older session; never combine them with main pages.
  const main=found.filter(tab=>{try{return new URL(tab.url).hash.startsWith('#/main/');}catch{return false;}});
  const tabs=main.length?main:found;
  if (!tabs.length) throw Error('NO1_WEB_TAB_REQUIRED');
  const tokens = new Set(),authenticatedTabs=[];
  let inspected = false;
  for (const tab of tabs) {
    try {
      const frames = await chrome.scripting.executeScript({
        target: {tabId: tab.id, frameIds: [0]}, world: 'ISOLATED',
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
  await chrome.storage.local.set({sessionDiagnostics:{tabCount:found.length,mainTabCount:main.length,inspectedTabCount:tabs.length,authenticatedTabCount:authenticatedTabs.length,distinctSessionCount:tokens.size}});
  if (!inspected) throw Error('NO1_BROWSER_ACCESS_FAILED');
  if (tokens.size > 1) throw Error('NO1_MULTIPLE_WEB_SESSIONS');
  if (!tokens.size) throw Error('NO1_AUTH_REQUIRED');
  return {token:tokens.values().next().value,tabIds:authenticatedTabs};
}

async function pageSchema(cmd,payload,tabIds,signal){
  const values=[];
  for(const tabId of tabIds){
    if(signal?.aborted)throw Error('NO1_RELAY_CLOSED');
    const functions={'musinsa:ranking:settings':readRankingSettings,'market:kream:displayed-schema':readDisplayedTable,'market:margin-settings':readSavedMarginSettings,'market:poizon:margin-settings':readPoizonMarginSettings,'market:poizon:displayed-schema':readPoizonDisplayedTable};
    const frames=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:cmd.endsWith(':displayed-schema')||cmd==='musinsa:ranking:settings'?'MAIN':'ISOLATED',func:functions[cmd],args:cmd==='market:kream:displayed-schema'?[payload.productCode]:cmd==='market:poizon:displayed-schema'?[payload.spuId]:[]});
    for(const frame of frames)if(frame.result)values.push(...(Array.isArray(frame.result)?frame.result:[frame.result]));
  }
  const unique=new Map(values.map(v=>{const {observedAt,...stable}=v;return [JSON.stringify(stable),v];}));
  if(unique.size>1)throw Error('NO1_SCHEMA_AMBIGUOUS');
  const value=unique.values().next().value;
  if(!value&&cmd==='musinsa:ranking:settings')throw Error('NO1_RANKING_SETTINGS_UNAVAILABLE');
  if(!value&&cmd.endsWith(':margin-settings'))throw Error('NO1_SCHEMA_NOT_AVAILABLE');
  return projectData(cmd,value||{available:false,reason:'MATCHING_PRICE_TABLE_NOT_OPEN'},payload);
}

async function executeJob(job,signal){
      if(job.cmd==='connector:session-status'){
        let error=null;try{await existingWebToken();}catch(e){error=safeCode(e.message);}
        return {...(await chrome.storage.local.get('sessionDiagnostics')).sessionDiagnostics,error};
      }
      const check=()=>{if(signal.aborted)throw Error('NO1_RELAY_CLOSED');if(job.deadline-Date.now()<=1000)throw Error('NO1_BRIDGE_TIMEOUT');};
      const relay=(cmd,payload={},max=20000)=>{check();return relayRequest({cmd,payload,token,signal,timeoutMs:Math.min(max,job.deadline-Date.now()-1000)});};
      check();
      validateCommand(job.cmd, job.payload);
      const {token,tabIds} = await existingWebToken();
      check();
      const pageOnly=['market:margin-settings','market:kream:displayed-schema','musinsa:ranking:settings','market:poizon:margin-settings','market:poizon:displayed-schema'].includes(job.cmd);
      if (!pageOnly&&PRODUCT_COMMANDS.includes(job.cmd)) {
        const settings = await relay('settings:get');
        if (settings.kreamApiBrowser !== 'electron') throw Error('NO1_BACKGROUND_MODE_REQUIRED');
        if (job.cmd.startsWith('market:kream:') || job.cmd === 'mecro:inventory:search') {
          const state = await relay('platform:status',{platform:'kream'});
          if (state.sessions[0].status !== 'active') throw Error('NO1_PLATFORM_LOGIN_REQUIRED');
        }
        if(job.cmd.startsWith('market:poizon:')){const state=await relay('platform:status',{platform:'poizon'});if(state.sessions[0].status!=='active')throw Error('POIZON_LOGIN_REQUIRED');}
        if (job.cmd === 'musinsa:product:benefit') {
          const state = await relay('musinsa:ranking:check-login');
          if (!state.isLoggedIn) throw Error('NO1_PLATFORM_LOGIN_REQUIRED');
        }
      }
      check();
      return pageOnly?await pageSchema(job.cmd,job.payload,tabIds,signal):await relay(job.cmd,job.payload,['stock:check','market:kream:history:start'].includes(job.cmd)?95000:40000);
}

const connection=createConnectionLoop({storage:chrome.storage.local,alarms:chrome.alarms,request:localRequest,execute:executeJob,safeCode});
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (!['connect', 'disconnect'].includes(message?.type)) return false;
  (message.type==='connect'?connection.connect(message.key):connection.disconnect()).then(reply).catch(()=>reply({ok:false,code:'NO1_BRIDGE_UNAVAILABLE'}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='no1-background-poll')void connection.start();});
chrome.runtime.onStartup.addListener(()=>void connection.start());
chrome.runtime.onInstalled?.addListener(()=>void connection.start());
void connection.start();
