import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const config=JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA,'CreamDotBridge','connection.json'),'utf8'));
const headers={'content-type':'application/json','OAI-Sites-Authorization':'Bearer '+config.serviceToken,'x-cream-bridge-key':config.bridgeKey};
let id=0;
async function rpc(method,params={}){const r=await fetch(config.origin+'/bridge/check',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('DIAGNOSTIC_HTTP_'+r.status);const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));if(j.result?.isError)throw Error(j.result.content[0].text);return j.result;}
const anonymous=await fetch(config.origin+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:1,method:'tools/list'}),redirect:'manual'});assert.notEqual(anonymous.status,200,'Private endpoint must not accept unauthenticated requests');
const status=await rpc('tools/call',{name:'cream_connection_status',arguments:{}});assert.equal(status.structuredContent.online,true);
const inventory=await rpc('tools/list');assert.ok(inventory.tools.some(t=>t.name==='cream_work_start'));
const opened=await rpc('tools/call',{name:'cream_open_panel',arguments:{}});const state=opened._meta.panel;assert.ok(state.selectedRun);assert.ok(state.products.length);
const detail=await rpc('tools/call',{name:'cream_panel_data',arguments:{runId:state.selectedRun.runId,productId:state.products[0].productId}});assert.equal(detail._meta.panel.detail.productId,state.products[0].productId);
const resource=await rpc('resources/read',{uri:inventory.tools.find(t=>t.name==='cream_open_panel')._meta.ui.resourceUri});assert.match(resource.contents[0].mimeType,/mcp-app/);
const result={at:new Date().toISOString(),passed:true,privateEndpoint:true,anonymousStatus:anonymous.status,remoteToPcRoundTrip:true,authentication:'owner-only Sites service access + independent bridge key; read-only diagnostic route',nativeMcpOAuthVerified:false,tools:inventory.tools.length,runId:state.selectedRun.runId,productId:state.products[0].productId,decision:detail._meta.panel.detail.decision,resourceBytes:resource.contents[0].text.length,noCollectionOrAiInvoked:true,nativeDotRenderVerified:false};
fs.writeFileSync(fileURLToPath(new URL('../../kream-runs/dot-panel-verification/remote-verification.json',import.meta.url)),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
