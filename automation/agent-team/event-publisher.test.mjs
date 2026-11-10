import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createEventPublisher} from './event-publisher.mjs';
test('slow event delivery is single-flight and retries failures without recording false success',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-events-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let release,attempts=0,errors=0;const calls=[];
 const publisher=createEventPublisher({eventDir:root,intervalMs:0,readEvents:()=>[{eventId:'evt-test'}],onError:()=>errors++,send:async endpoint=>{
  calls.push(endpoint);if(endpoint==='/bridge/events'&&attempts++===0)await new Promise((_,reject)=>{release=reject;});return {accepted:true};
 }});
 const pending=publisher.tick();await new Promise(r=>setImmediate(r));assert.equal(publisher.tick(),pending);assert.equal(calls.length,1);
 release(Error('timeout'));await pending;assert.equal(errors,1);assert.deepEqual(fs.readdirSync(root),[]);
 await publisher.tick();assert.equal(attempts,2);assert.equal(fs.readdirSync(root).length,1);
 await publisher.tick();assert.equal(attempts,2);assert.equal(calls.filter(x=>x==='/bridge/event-tick').length,2);
});
test('events remain unsent until the native subscriber exists',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-events-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let ready=false;const calls=[];const publisher=createEventPublisher({eventDir:root,intervalMs:0,enabled:async()=>ready,readEvents:()=>[{eventId:'evt-later'}],send:async endpoint=>{calls.push(endpoint);return {accepted:true};}});
 await publisher.tick();assert.deepEqual(calls,[]);assert.deepEqual(fs.readdirSync(root),[]);
 ready=true;await publisher.tick();assert.deepEqual(calls,['/bridge/events','/bridge/event-tick']);assert.equal(fs.readdirSync(root).length,1);
});
