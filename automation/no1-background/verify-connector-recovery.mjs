// Isolated real Chromium + local HTTP verification. No user Chrome profile,
// No1 page, credential, relay request or production bridge is used.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
import {createBridge} from './bridge.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const executablePath=process.argv.find(a=>a.startsWith('--browser='))?.slice(10)||chromium.executablePath();
if(!fs.existsSync(executablePath))throw Error('TEST_CHROMIUM_REQUIRED');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'cream-connector-recovery-')),extension=path.join(temporary,'extension'),profile=path.join(temporary,'profile');
const source=fileURLToPath(new URL('./chrome-extension/',import.meta.url)),key='c'.repeat(64);
let bridge,context,port=0,polls=0;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
// /next deliberately long-polls for 20 seconds. Allow its response to update
// extension storage after the bridge has already observed the request.
async function until(predicate){const end=Date.now()+35000;while(Date.now()<end){if(await predicate())return;await pause(100);}throw Error('CONNECTOR_RECOVERY_NOT_OBSERVED');}
async function startBridge(){bridge=createBridge({key});bridge.server.on('request',req=>{if(req.url.startsWith('/next'))polls++;});await new Promise((resolve,reject)=>{bridge.server.once('error',reject);bridge.server.listen(port,'127.0.0.1',resolve);});port=bridge.server.address().port;}
async function launch(){context=await chromium.launchPersistentContext(profile,{executablePath,headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});return context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});}
try{
 await startBridge();fs.cpSync(source,extension,{recursive:true});
 // Temporary fixture uses a random loopback port, leaving production 8871 alone.
 for(const name of ['manifest.json','background.mjs']){const file=path.join(extension,name);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('127.0.0.1:8871',`127.0.0.1:${port}`));}
 let worker=await launch(),id=new URL(worker.url()).host;
 let page=await context.newPage();await page.goto(`chrome-extension://${id}/popup.html`);
 assert.deepEqual(await page.evaluate(key=>chrome.runtime.sendMessage({type:'connect',key}),key),{ok:true});await until(()=>bridge.status().browserConnected);
 await bridge.close();bridge=null;
 await until(()=>page.evaluate(async()=>(await chrome.storage.local.get('lastTransportStatus')).lastTransportStatus==='RECONNECTING'));
 await startBridge();await until(()=>bridge.status().browserConnected);
 await until(()=>page.evaluate(async()=>(await chrome.storage.local.get('lastReconnectedAt')).lastReconnectedAt));
 await page.evaluate(()=>chrome.alarms.clear('no1-background-poll'));
 await context.close();context=null;const before=polls;
 worker=await launch();await until(()=>polls>before);
 const alarm=await worker.evaluate(()=>chrome.alarms.get('no1-background-poll'));assert.equal(alarm.periodInMinutes,0.5);
 page=await context.newPage();await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
 assert.deepEqual(await page.evaluate(()=>chrome.runtime.sendMessage({type:'disconnect'})),{ok:true});await until(()=>!bridge.status().browserConnected);
 const disconnectedPolls=polls;await pause(500);assert.equal(polls,disconnectedPolls);
 const result={transportReconnect:true,browserRestartReconnect:true,missingAlarmRestored:true,manualDisconnectRespected:true,no1AuthenticatedTest:false};
 fs.writeFileSync(path.join(temporary,'validation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,evidence:path.join(temporary,'validation.json')}));
}finally{if(context)await context.close();if(bridge)await bridge.close();}
