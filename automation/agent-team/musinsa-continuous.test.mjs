import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {runContinuousMusinsa} from './musinsa-continuous.mjs';import {startWork,continueWorkUntilStopped} from './work-orders.mjs';
test('continuous supervisor resets only the ranking cycle and stops on explicit marker',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-continuous-')),w=startWork(root,{targetProfitableProducts:1,userInstruction:'until stopped',requestId:'loop'});continueWorkUntilStopped(root,w.workId);
 const settings={category:'103000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'};const dir=path.join(root,'explorations',w.workId);const memoryFile=path.join(root,'musinsa-discovery','state.json');fs.mkdirSync(path.dirname(memoryFile),{recursive:true});fs.writeFileSync(memoryFile,JSON.stringify({seenSourceIds:['1'],seenKreamIds:['2'],contexts:{[JSON.stringify(settings)]:{categoryIndex:1}}}));
 let calls=0;const result=await runContinuousMusinsa({root,workId:w.workId,run:async()=>{calls++;return {status:'source_exhausted',settings,profitableProductsFound:1};},intervals:{sourceExhausted:1000},sleep:async()=>fs.writeFileSync(path.join(dir,'STOP'),'user stop')});
 assert.equal(calls,1);assert.equal(result.status,'stopped');const memory=JSON.parse(fs.readFileSync(memoryFile,'utf8'));assert.equal(memory.contexts[JSON.stringify(settings)].categoryIndex,0);assert.deepEqual(memory.seenSourceIds,['1']);assert.deepEqual(memory.seenKreamIds,['2']);
});
test('completed finite source inspection can continue until explicitly stopped',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-continuous-sources-')),w=startWork(root,{targetSources:3,userInstruction:'inspect three',requestId:'sources'}),dir=path.join(root,'explorations',w.workId);
 fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({status:'complete',checkedSources:3,batches:[],pendingSourceIds:[]}));
 const scope=continueWorkUntilStopped(root,w.workId);assert.equal(scope.continuous,true);assert.equal(scope.checkedSources,3);assert.equal(scope.remainingProducts,5);
 const settings={category:'103000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'},memoryFile=path.join(root,'musinsa-discovery','state.json');fs.mkdirSync(path.dirname(memoryFile),{recursive:true});fs.writeFileSync(memoryFile,JSON.stringify({seenSourceIds:['1','2','3'],seenKreamIds:[],contexts:{[JSON.stringify(settings)]:{categoryIndex:1}}}));
 let calls=0;const result=await runContinuousMusinsa({root,workId:w.workId,run:async()=>{calls++;return {status:'source_exhausted',settings,checkedSources:4};},intervals:{sourceExhausted:1000},sleep:async()=>fs.writeFileSync(path.join(dir,'STOP'),'user stop')});
 assert.equal(calls,1);assert.equal(result.status,'stopped');assert.equal(JSON.parse(fs.readFileSync(memoryFile,'utf8')).contexts[JSON.stringify(settings)].categoryIndex,0);
});
test('finite supervisor waits through an environment failure, then ends at its target without resetting the cycle',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-finite-supervisor-')),w=startWork(root,{targetSources:3,userInstruction:'inspect three',requestId:'finite-supervised'}),dir=path.join(root,'explorations',w.workId);
 const settings={category:'103000',period:'REALTIME',gender:'A',ageBand:'AGE_BAND_ALL'},memoryFile=path.join(root,'musinsa-discovery','state.json');fs.mkdirSync(path.dirname(memoryFile),{recursive:true});fs.writeFileSync(memoryFile,JSON.stringify({seenSourceIds:['1'],seenKreamIds:[],contexts:{[JSON.stringify(settings)]:{categoryIndex:2}}}));
 const results=[{status:'needs_attention',error:'NO1_WEB_TAB_REQUIRED',settings,checkedSources:1},{status:'complete',settings,checkedSources:3}];let calls=0,slept=0;const events=[];
 const result=await runContinuousMusinsa({root,workId:w.workId,run:async()=>results[calls++],intervals:{otherFailure:3000},sleep:async()=>{slept++;},onEvent:e=>events.push(e)});
 assert.equal(calls,2);assert.equal(slept,3);assert.equal(result.status,'complete');
 assert.ok(events.some(e=>e.type==='continuous_wait'&&e.reason==='NO1_WEB_TAB_REQUIRED'));
 assert.equal(JSON.parse(fs.readFileSync(memoryFile,'utf8')).contexts[JSON.stringify(settings)].categoryIndex,2);
 assert.equal(fs.existsSync(path.join(dir,'continuous.lock')),false);
});
test('finite supervisor reports source exhaustion instead of restarting the ranking cycle',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-finite-exhausted-')),w=startWork(root,{targetSources:3,userInstruction:'inspect three',requestId:'finite-exhausted'});
 let calls=0;const result=await runContinuousMusinsa({root,workId:w.workId,run:async()=>{calls++;return {status:'source_exhausted',settings:{},checkedSources:2};},sleep:async()=>assert.fail('must not wait')});
 assert.equal(calls,1);assert.equal(result.status,'source_exhausted');
});
