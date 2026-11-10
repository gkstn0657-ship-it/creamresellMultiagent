import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const config=JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA,'CreamDotBridge','connection.json'),'utf8'));
const headers={'content-type':'application/json','OAI-Sites-Authorization':'Bearer '+config.serviceToken,'x-cream-bridge-key':config.bridgeKey};let id=0;
async function rpc(method,params={}){const r=await fetch(config.origin+'/bridge/check',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('DIAGNOSTIC_HTTP_'+r.status);const j=await r.json();if(j.error||j.result?.isError)throw Error('DIAGNOSTIC_RPC_FAILED');return j.result;}
const init=await rpc('initialize');assert.equal(init.serverInfo.version,'0.5.0');assert.match(init.instructions,/NO AI/);
const list=await rpc('tools/list');assert.ok(list.tools.some(t=>t.name==='cream_explore_start'));
const connected=(await rpc('tools/call',{name:'cream_connection_status',arguments:{}})).structuredContent;assert.equal(connected.online,true);assert.equal(connected.discoveryPolicy.runtimeAI,false);
const state=(await rpc('tools/call',{name:'cream_discovery_status',arguments:{}})).structuredContent;assert.ok(state.discovery);assert.equal(state.work.status,'awaiting_user_scope');
const result={at:new Date().toISOString(),passed:true,version:init.serverInfo.version,remotePcRoundTrip:true,discoveryAI:false,productionWorkStatus:state.work.status,productionDiscoveryStatus:state.discovery.status,activeSubscriptions:connected.events.activeSubscriptions,tools:list.tools.filter(t=>/explore|discovery/.test(t.name)).map(t=>t.name),nativeDotInvocationVerified:false,noCollectionOrAiInvoked:true};
fs.writeFileSync(new URL('../../kream-runs/discovery-verification/remote-verification.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
