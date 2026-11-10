import test from 'node:test';
import {CONNECTOR_VERSION} from '../no1-background/chrome-extension/protocol.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DiscoveryStore} from './discovery-store.mjs';
import {startWork} from './work-orders.mjs';
import {preflight,inspectDotConfig} from './preflight.mjs';
const temp=t=>{const p=fs.mkdtempSync(path.join(os.tmpdir(),'cream-preflight-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;};
const codex=()=>({installed:true,authenticated:true});
const dot=()=>({configured:false});
const goodClient={status:async()=>({browserConnected:true,connectorVersion:CONNECTOR_VERSION}),request:async cmd=>cmd==='settings:get'?{kreamApiBrowser:'electron'}:cmd==='platform:status'?{sessions:[{status:'active'}]}:{isLoggedIn:true}};
test('fresh clone preflight never creates a DB, work order, or product request',async t=>{
 const root=temp(t),calls=[];const r=await preflight({root,codex,dot,client:{...goodClient,request:async cmd=>{calls.push(cmd);return goodClient.request(cmd);}}});
 assert.equal(r.localReady,true);assert.equal(r.dotReady,false);assert.equal(r.liveProductWorkflowVerified,false);
 assert.equal(r.nextAction,'await_new_product_count');assert.deepEqual(fs.readdirSync(root),[]);
 assert.deepEqual(calls,['settings:get','musinsa:ranking:check-login','platform:status']);
});
test('continuity inspection leaves database bytes and quota unchanged',async t=>{
 const root=temp(t),store=new DiscoveryStore(path.join(root,'discovery'));store.set('cursor','7');store.close();
 startWork(root,{targetProducts:3,userInstruction:'test 3',requestId:'test'});
 const file=path.join(root,'discovery','discovery.sqlite'),before=fs.readFileSync(file);
 const r=await preflight({root,codex,dot,client:goodClient});
 assert.equal(r.checks.continuity.cursor,'7');assert.equal(r.resumableWorks[0].remainingProducts,3);
 assert.deepEqual(fs.readFileSync(file),before);assert.equal(r.workScopeChanged,false);
});
test('old work without DB is blocked; no silent reset',async t=>{
 const root=temp(t);startWork(root,{targetProducts:3,userInstruction:'test 3',requestId:'test'});
 const r=await preflight({root,codex,dot,client:goodClient});assert.equal(r.localReady,false);
 assert.ok(r.blockers.some(x=>x.code==='DISCOVERY_DATABASE_MISSING'));assert.equal(fs.existsSync(path.join(root,'discovery')),false);
});
test('disconnection and foreground mode fail before platform queries; errors do not leak secrets',async t=>{
 const root=temp(t);let calls=0;
 const a=await preflight({root,codex,dot,client:{status:async()=>({browserConnected:false}),request:()=>{calls++;}}});assert.equal(a.localReady,false);assert.equal(calls,0);
 const b=await preflight({root,codex,dot,client:{...goodClient,request:async()=>{calls++;return {kreamApiBrowser:'system-chrome'};}}});assert.equal(calls,1);assert.equal(b.localReady,false);
 const c=await preflight({root,codex,dot,client:{status:()=>{throw Error('private secret token');}}});assert.ok(!JSON.stringify(c).includes('private secret'));
});
test('Dot connection diagnostic never returns credential fields',t=>{
 const root=temp(t);fs.mkdirSync(path.join(root,'CreamDotBridge'));fs.writeFileSync(path.join(root,'CreamDotBridge','connection.json'),JSON.stringify({origin:'https://example.chatgpt.site',serviceToken:'private-token',bridgeKey:'private-key'}));
 assert.deepEqual(inspectDotConfig(root),{configured:true,remoteRoundTripVerified:false});
});
