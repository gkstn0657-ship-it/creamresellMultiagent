import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Journal,lock,validateMission} from './state.mjs';
import {Backend} from './backend.mjs';
import {Herdr} from './herdr.mjs';
import {coordinate} from './coordinator.mjs';
import {rankingWorker} from './ranking-worker.mjs';
import {worker} from './worker.mjs';
import {startWork,continueWorkUntilStopped,workOrders} from '../agent-team/work-orders.mjs';
import {makePacket} from '../agent-team/packets.mjs';
const mission={instruction:'Inspect two products, no purchases',targetProducts:2,source:'kream-popularity',maxTurns:3};
test('coordinator upgrade transfers progress and preserves turn budget',async t=>{
 const journal=new Journal(fixture(t),mission);journal.data.modelSelection={model:'gpt-6-luna',effort:'medium'};let opts;const starts=[];
 await coordinate({journal,backend:{execute:async name=>{if(name==='finish'){journal.data.status='complete';journal.save();}return {completed:2};},stop:async()=>{}},serverFactory:o=>{opts=o;return {
 start:async()=>{},close:async()=>{},startThread:async config=>{starts.push(config);return {thread:{id:'t'+starts.length},model:config.model};},
 runTurn:async(id,text)=>{assert.equal(JSON.parse(text).status.completed,2);if(id==='t1'){
 await opts.onTool({threadId:id,tool:'request_model_upgrade',arguments:{reason:'Conflicting saved work status requires deeper reasoning',evidenceIds:[]}});
 await assert.rejects(opts.onTool({threadId:id,tool:'status',arguments:{}}),/PENDING/);
 }else await opts.onTool({threadId:id,tool:'finish',arguments:{outcome:'complete',reason:'fixture'}});}
 };}});
 assert.equal(starts.length,2);assert.equal(starts[1].model,'gpt-6.1-sol');assert.equal(journal.data.turns,2);assert.equal(journal.data.modelUpgradeCount,1);
});
function clean(dir){if(path.dirname(dir)!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('cream-herdr-'))throw Error('UNSAFE_TEST_CLEANUP');fs.rmSync(dir,{recursive:true,force:true});}
function fixture(t,manualCleanup=false){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cream-herdr-'));if(!manualCleanup)t.after(()=>clean(dir));return dir;}
async function backend(t){const dir=fixture(t,true),journal=new Journal(path.join(dir,'controller'),mission);journal.save();const calls=[];
 const h={session:'test',call:async(...a)=>{calls.push(a);return {root_pane:{pane_id:'test-pane'}};},launch:async()=>({queued:true})};
 const b=new Backend({journal,root:path.join(dir,'root'),workspaceId:'test-workspace',herdr:h,feed:async cursor=>({cursor,nextCursor:null,observedAt:new Date().toISOString(),items:[1,2,3].map(id=>({productCode:String(id),titleKo:'shoe',brandProductCode:'M'+id}))})});await b.initialize();t.after(()=>{b.close();clean(dir);});return b;}
test('scope validation rejects missing target and unsupported source',()=>{assert.throws(()=>validateMission({...mission,targetProducts:NaN}));assert.throws(()=>validateMission({...mission,source:'invented'}));assert.throws(()=>validateMission({...mission,continuous:true}),/CONTINUOUS_MUSINSA_ONLY/);});
test('continuous Musinsa work has no completion target and stops only on STOP',async t=>{
 const dir=fixture(t),journal=new Journal(path.join(dir,'controller'),{...mission,source:'musinsa-ranking',continuous:true});journal.save();
 const b=new Backend({journal,root:path.join(dir,'root'),herdr:{},workspaceId:'w',rankingFeed:async()=>({settings:{category:'001'},total:0,products:[],observedAt:new Date().toISOString()})});
 await b.initialize();t.after(()=>b.close());
 assert.equal(b.status().target,null);assert.equal(b.status().continuous,true);
 await assert.rejects(b.execute('finish',{outcome:'complete',reason:'count reached'}),/CONTINUOUS_WORK/);
 await assert.rejects(b.execute('finish',{outcome:'source_exhausted',reason:'current ranking empty'}),/CONTINUOUS_WORK/);
});
test('continuous coordinator outlives a finite turn budget until STOP',async t=>{
 const journal=new Journal(fixture(t),{...mission,source:'musinsa-ranking',continuous:true,maxTurns:1});let turns=0;
 await assert.rejects(coordinate({journal,backend:{execute:async()=>({completed:0,target:null,batches:[]}),stop:async()=>{}},serverFactory:()=>({start:async()=>{},startThread:async()=>({thread:{id:'t'}}),runTurn:async()=>{if(++turns===2)fs.writeFileSync(path.join(journal.dir,'STOP'),'stop');},close:async()=>{}})}),/STOP_REQUESTED/);
 assert.equal(turns,2);assert.equal(journal.data.status,'stopped');
});
test('explicit continuous handoff stops only the selected idle work',async t=>{
 const dir=fixture(t),root=path.join(dir,'root');
 const old=startWork(root,{targetSources:5,userInstruction:'previous continuous run',requestId:'previous-run'});
 continueWorkUntilStopped(root,old.workId);
 const journal=new Journal(path.join(dir,'controller'),{...mission,source:'musinsa-ranking',continuous:true,replaceWorkId:old.workId});journal.save();
 const b=new Backend({journal,root,herdr:{},workspaceId:'w'});await b.initialize();t.after(()=>b.close());
 assert.equal(workOrders(root).find(w=>w.id===old.workId).status,'stopped');
 assert.notEqual(journal.data.workId,old.workId);
 assert.equal(workOrders(root).find(w=>w.id===journal.data.workId).continuous,true);
});
test('controller lock refuses duplicate execution',t=>{const dir=fixture(t),release=lock(dir);assert.throws(()=>lock(dir),/ALREADY_RUNNING/);release();lock(dir)();});
test('launch quoting preserves shell metacharacters as literal argv',async()=>{let call;const h=new Herdr({run:async(...a)=>{call=a;return {stdout:'{"result":{"ok":true}}'};}});await h.launch('p1',"C:/a'b/$x.mjs",['$(Get-Secret)']);const command=call[1].at(-1),script=Buffer.from(command.split(' ').at(-1),'base64').toString('utf16le');assert.match(script,/'C:\/a''b\/\$x.mjs'/);assert.match(script,/'\$\(Get-Secret\)'/);});
test('unobserved products, duplicates and count overflow cannot launch',async t=>{const b=await backend(t);await b.execute('catalog',{fetchNext:true});await assert.rejects(b.execute('analyze',{productIds:['9'],reason:'x'}),/UNOBSERVED/);await assert.rejects(b.execute('analyze',{productIds:['1','1'],reason:'x'}),/INVALID/);await assert.rejects(b.execute('analyze',{productIds:['1','2','3'],reason:'x'}),/SCOPE/);assert.equal(b.status().assigned,0);});
test('reservation persists and pending launch prevents duplicate batch',async t=>{const b=await backend(t);await b.execute('catalog',{fetchNext:true});const result=await b.execute('analyze',{productIds:['1','2'],reason:'observed candidates'});assert.equal(result.executionConfirmed,false);assert.equal(b.status().assigned,2);await assert.rejects(b.execute('analyze',{productIds:['3'],reason:'again'}),/PENDING/);assert.equal(b.store.claimed(result.runId).length,2);});
test('unreviewed results cannot finish and false exhaustion is rejected',async t=>{const b=await backend(t);await assert.rejects(b.execute('finish',{outcome:'complete',reason:'done'}),/UNVERIFIED/);await assert.rejects(b.execute('finish',{outcome:'source_exhausted',reason:'done'}),/SOURCE_NOT/);});
test('STOP blocks all AI actions',async t=>{const b=await backend(t);fs.writeFileSync(path.join(b.journal.dir,'STOP'),'stop');await assert.rejects(b.execute('catalog',{fetchNext:true}),/STOP/);});
test('completed source inspections with skips are complete, not blocked or profitable',async t=>{const b=await backend(t);b.status=()=>({unit:'inspected-sources',completed:2,target:2,batches:[{status:'complete',workerAlive:false}]});await assert.rejects(b.execute('finish',{outcome:'blocked',reason:'No AI reviews'}),/TARGET_REACHED/);await b.execute('finish',{outcome:'complete',reason:'2 inspected, 2 skipped, 0 reviewed'});assert.equal(b.journal.data.status,'complete');});
test('coordinator continues after prose-only turns and enforces budget',async t=>{const journal=new Journal(fixture(t),{...mission,maxTurns:2});let turns=0,closed=false;const server={start:async()=>{},startThread:async()=>({thread:{id:'t1'}}),runTurn:async()=>{turns++;},close:async()=>{closed=true;}};await assert.rejects(coordinate({journal,backend:{execute:async()=>({}),stop:async()=>{}},serverFactory:()=>server}),/TURN_BUDGET/);assert.equal(turns,2);assert.equal(closed,true);assert.equal(journal.data.status,'needs_attention');});
test('Musinsa source selection preserves settings and cross-request deduplication',async t=>{
 const dir=fixture(t),journal=new Journal(path.join(dir,'controller'),{...mission,source:'musinsa-ranking'});journal.save();
 let settings={category:'001',period:'daily'};
 const b=new Backend({journal,root:path.join(dir,'root'),herdr:{},workspaceId:'w',rankingFeed:async()=>({settings:{...settings},total:2,products:[{productId:'1'},{productId:'2'}],observedAt:new Date().toISOString()})});await b.initialize();
 fs.mkdirSync(path.join(b.root,'musinsa-discovery'),{recursive:true});fs.writeFileSync(path.join(b.root,'musinsa-discovery','state.json'),JSON.stringify({seenSourceIds:['1']}));
 assert.deepEqual((await b.execute('catalog',{fetchNext:true})).candidates.map(x=>x.productId),['2']);
 settings.category='002';await assert.rejects(b.execute('catalog',{fetchNext:true}),/SETTINGS_CHANGED/);b.close();
});
test('Musinsa skipped source is recorded once and is never a profitable judgment',async t=>{
 const root=fixture(t),dir=path.join(root,'batch');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'sources.json'),JSON.stringify([{productId:'1',productUrl:'https://www.musinsa.com/products/1'}]));let calls=0;
 const options={root,dir,collect:async()=>{calls++;return {status:'skipped',reason:'NO_AVAILABLE_STOCK'};},client:{},execute:async()=>{throw Error('SHOULD_NOT_JUDGE');}};
 const result=await rankingWorker(options);assert.equal(result.status,'complete');assert.equal(result.results.length,0);assert.equal(result.sourceResults[0].reason,'NO_AVAILABLE_STOCK');await rankingWorker(options);assert.equal(calls,1);
});
test('Musinsa authentication failures do not consume a source or become skips',async t=>{
 const root=fixture(t),dir=path.join(root,'batch');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'sources.json'),JSON.stringify([{productId:'1'}]));
 await assert.rejects(rankingWorker({root,dir,client:{},collect:async()=>{throw Error('MUSINSA_LOGIN_REQUIRED');}}),/LOGIN_REQUIRED/);
 assert.equal(fs.existsSync(path.join(root,'musinsa-discovery','state.json')),false);
});
test('packet checkpoint reconstructs source progress and both market dedup keys without recollection',async t=>{
 const root=fixture(t),dir=path.join(root,'batch');fs.mkdirSync(dir);
 const source={productId:'1',productUrl:'https://www.musinsa.com/products/1'};
 const offers=[{kreamId:'123',productUrl:source.productUrl,model:'MODEL',color:'BLACK',option:'L'},
 {market:'poizon',poizonId:'456',productGroupId:'123',productUrl:source.productUrl,model:'MODEL',color:'BLACK',option:'L'}];
 const packet=makePacket({productId:'123',offers},offers.map(request=>({kind:'no1_product',mode:'fixture',observedAt:new Date().toISOString(),payload:{request}})));
 fs.writeFileSync(path.join(dir,'sources.json'),JSON.stringify([source]));fs.writeFileSync(path.join(dir,'source-1.json'),JSON.stringify(packet));
 const opts={root,dir,client:{},collect:async()=>{throw Error('MUST_NOT_RECOLLECT');},execute:async()=>({status:'complete',results:[]})};
 await rankingWorker(opts);await rankingWorker(opts);
 const saved=JSON.parse(fs.readFileSync(path.join(dir,'source-state.json'))),memory=JSON.parse(fs.readFileSync(path.join(root,'musinsa-discovery','state.json')));
 assert.equal(saved.results.length,1);assert.equal(saved.results[0].packetId,packet.id);assert.equal(saved.results[0].packetProductId,'123');
 assert.deepEqual(saved.results[0].marketKeys,['123','poizon-456']);assert.deepEqual(memory.seenSourceIds,['1']);assert.deepEqual(memory.seenKreamIds,['123','poizon-456']);
 // Corrupted checkpoints must not be promoted into progress.
 packet.productId='999';fs.writeFileSync(path.join(dir,'source-1.json'),JSON.stringify(packet));await assert.rejects(rankingWorker(opts),/INTEGRITY/);
});
test('Herdr reporting failure at start and finish cannot downgrade durable batch completion',async t=>{
 const root=fixture(t),runId='batch-11111111-1111-1111-1111-111111111111',dir=path.join(root,runId);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'products.json'),'[]');let executed=0;
 const result={status:'complete',results:[],proof:'preserved'};
 const actual=await worker({root,runId,paneId:'test',herdr:{report:async()=>{throw Error('DISPLAY_OFFLINE');}},execute:async()=>{executed++;fs.writeFileSync(path.join(dir,'batch-state.json'),JSON.stringify(result));return result;}});
 assert.deepEqual(actual,result);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'batch-state.json'))),result);assert.equal(executed,1);
 assert.equal(fs.readFileSync(path.join(dir,'display-errors.jsonl'),'utf8').trim().split('\n').length,2);
});
test('actual worker errors remain visible even when Herdr reporting fails',async t=>{
 const root=fixture(t),runId='batch-22222222-2222-2222-2222-222222222222',dir=path.join(root,runId);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'products.json'),'[]');
 await assert.rejects(worker({root,runId,paneId:'test',herdr:{report:async()=>{throw Error('DISPLAY_OFFLINE');}},execute:async()=>{throw Error('REAL_COLLECTION_FAILURE');}}),/REAL_COLLECTION_FAILURE/);
 const saved=JSON.parse(fs.readFileSync(path.join(dir,'batch-state.json')));assert.equal(saved.status,'needs_attention');assert.equal(saved.error,'REAL_COLLECTION_FAILURE');
});
test('coordinator timeout settles old turn then resumes same thread without stopping or relaunching workers',async t=>{
 const journal=new Journal(fixture(t),{...mission,maxTurns:3});let calls=0,settled=false,stops=0,factoryOptions;const threads=[];
 const backend={execute:async name=>{if(name==='finish'){journal.data.status='complete';journal.save();}return {batches:[{workerAlive:calls<2,status:'collecting'}]};},stop:async()=>{stops++;}};
 await coordinate({journal,backend,report:async()=>{throw Error('DISPLAY_OFFLINE');},serverFactory:opts=>{factoryOptions=opts;return {
 start:async()=>{},startThread:async()=>({thread:{id:'same-thread'}}),waitTurn:async id=>{assert.equal(id,'turn-1');settled=true;return {turn:{status:'interrupted'}};},
 runTurn:async(id,text,{onStart})=>{threads.push(id);calls++;onStart('turn-'+calls);if(calls===1)throw Error('CODEX_TURN_TIMEOUT');assert.equal(settled,true);await factoryOptions.onTool({tool:'finish',arguments:{outcome:'complete',reason:'fixture'}});},close:async()=>{}};}});
 assert.equal(journal.data.status,'complete');assert.equal(journal.data.timeoutRecoveries,1);assert.equal(stops,0);assert.deepEqual(threads,['same-thread','same-thread']);assert.equal(journal.data.turns,2);
});
test('coordinator will not overlap turns when interrupted turn cannot settle',async t=>{
 const journal=new Journal(fixture(t),mission);let calls=0;
 await assert.rejects(coordinate({journal,backend:{execute:async()=>({}),stop:async()=>{}},serverFactory:()=>({start:async()=>{},startThread:async()=>({thread:{id:'t'}}),runTurn:async(id,text,{onStart})=>{calls++;onStart('active');throw Error('CODEX_TURN_TIMEOUT');},waitTurn:async()=>{throw Error('TURN_NOT_SETTLED');},close:async()=>{}})}),/TURN_NOT_SETTLED/);
 assert.equal(calls,1);assert.equal(journal.data.status,'needs_attention');
});
test('timeout after persisted finish keeps completed outcome',async t=>{
 const journal=new Journal(fixture(t),mission);let opts;
 await coordinate({journal,backend:{execute:async name=>{if(name==='finish'){journal.data.status='complete';journal.save();}return {};},stop:async()=>{}},serverFactory:o=>{opts=o;return {start:async()=>{},startThread:async()=>({thread:{id:'t'}}),runTurn:async(id,text,{onStart})=>{onStart('a');await opts.onTool({tool:'finish',arguments:{outcome:'complete',reason:'saved'}});throw Error('CODEX_TURN_TIMEOUT');},close:async()=>{}};}});
 assert.equal(journal.data.status,'complete');assert.ok(journal.data.history.some(e=>e.type==='turn_timeout_after_finish'));
});
test('timeout recovery respects STOP and never starts a new turn',async t=>{
 const journal=new Journal(fixture(t),mission);let calls=0,stops=0;
 await assert.rejects(coordinate({journal,backend:{execute:async()=>({}),stop:async()=>{stops++;}},serverFactory:()=>({start:async()=>{},startThread:async()=>({thread:{id:'t'}}),runTurn:async(id,text,{onStart})=>{calls++;onStart('a');fs.writeFileSync(path.join(journal.dir,'STOP'),'stop');throw Error('CODEX_TURN_TIMEOUT');},close:async()=>{}})}),/STOP_REQUESTED/);
 assert.equal(calls,1);assert.equal(stops,1);assert.equal(journal.data.status,'stopped');
});
test('repeated timeout recovery remains bounded by the saved turn budget',async t=>{
 const journal=new Journal(fixture(t),{...mission,maxTurns:2});let calls=0;
 await assert.rejects(coordinate({journal,backend:{execute:async()=>({}),stop:async()=>{}},serverFactory:()=>({start:async()=>{},startThread:async()=>({thread:{id:'t'}}),runTurn:async(id,text,{onStart})=>{calls++;onStart('a'+calls);throw Error('CODEX_TURN_TIMEOUT');},waitTurn:async()=>({turn:{status:'interrupted'}}),close:async()=>{}})}),/TURN_BUDGET/);
 assert.equal(calls,2);assert.equal(journal.data.timeoutRecoveries,2);
});
test('timeout drains an in-flight launch and reconciles it instead of launching twice',async t=>{
 const journal=new Journal(fixture(t),mission);let opts,calls=0,launches=0,launched=false,pending;
 await coordinate({journal,backend:{execute:async name=>{
   if(name==='analyze'){launches++;await new Promise(resolve=>setTimeout(resolve,5));launched=true;return {runId:'existing'};}
   if(name==='finish'){assert.equal(launched,true);journal.data.status='complete';journal.save();}
   return {batches:launched?[{runId:'existing'}]:[]};
 },stop:async()=>{}},serverFactory:o=>{opts=o;return {start:async()=>{},startThread:async()=>({thread:{id:'t'}}),waitTurn:async()=>({turn:{status:'interrupted'}}),runTurn:async(id,text,{onStart})=>{
   calls++;onStart('a'+calls);
   if(calls===1){pending=opts.onTool({tool:'analyze',arguments:{productIds:['1'],reason:'fixture'}});await new Promise(resolve=>setTimeout(resolve,0));throw Error('CODEX_TURN_TIMEOUT');}
   assert.deepEqual(JSON.parse(text).status.batches,[{runId:'existing'}]);await opts.onTool({tool:'finish',arguments:{outcome:'complete',reason:'fixture'}});
 },close:async()=>{}};}});
 await pending;assert.equal(launches,1);assert.equal(journal.data.status,'complete');
});
