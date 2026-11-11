import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscoveryFeed} from './discovery-feed.mjs';
import {CONNECTOR_VERSION} from '../no1-background/chrome-extension/protocol.mjs';
test('discovery accepts current protocol and preserves supplied cursor',async()=>{
 let request;const feed=createDiscoveryFeed({client:{status:async()=>({browserConnected:true,connectorVersion:CONNECTOR_VERSION}),request:async(...args)=>{request=args;return {items:[],nextCursor:null};}}});
 const r=await feed('2');assert.equal(r.cursor,'2');assert.deepEqual(request,['mecro:inventory:search',{keyword:' ',cursor:'2'}]);
});
test('discovery rejects incompatible protocol before request',async()=>{
 let called=false;const feed=createDiscoveryFeed({client:{status:async()=>({browserConnected:true,connectorVersion:'0.6.0'}),request:async()=>{called=true;}}});
 await assert.rejects(()=>feed('2'),/NO1_CONNECTOR_UPDATE_REQUIRED/);assert.equal(called,false);
});
test('discovery preserves disconnected transport guard',async()=>{
 const feed=createDiscoveryFeed({client:{status:async()=>({browserConnected:false,connectorVersion:CONNECTOR_VERSION}),request:async()=>{throw Error('UNEXPECTED_REQUEST');}}});
 await assert.rejects(()=>feed('2'),/NO1_BRIDGE_DISCONNECTED/);
});
