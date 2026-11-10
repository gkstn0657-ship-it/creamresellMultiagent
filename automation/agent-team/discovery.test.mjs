import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DiscoveryStore} from './discovery-store.mjs';
import {selectNext} from './discovery-feed.mjs';
import {candidateFromItem,classifyProduct} from './discovery-policy.mjs';
import {parseMusinsaSearch,collectCandidate,sameColor} from './discovery-collector.mjs';
import {startWork,scopeStatus,stopWork} from './work-orders.mjs';
import {runExploration,startExploration} from './exploration.mjs';
import {runBatch} from './batch.mjs';
import {validatePacket} from './packets.mjs';
import {digest} from './store.mjs';
import {batchEvents} from './batch-events.mjs';
import {control} from './control-mcp.mjs';
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'cream-discovery-'));
const id=n=>'batch-00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const item=(n,title)=>({productCode:String(n),brandProductCode:'MODEL-'+n,titleKo:title,titleEn:'',totalSales:10,wishCount:1});
const page=(items,cursor='1',nextCursor=null)=>({items,cursor,nextCursor,observedAt:new Date().toISOString()});
const work=(root,n,key)=>startWork(root,{targetProducts:n,userInstruction:`Fixture ${n} products`,requestId:key});
const partial=c=>{const p={version:'cream-product-packet-v1',productId:c.kreamId,candidate:c,offers:[],collectedAt:new Date().toISOString(),observations:[{kind:'catalog_candidate',mode:'fixture',observedAt:c.discovery.observedAt,payload:c}],gaps:['verifiedSourceOfferMissing'],collectionStatus:'partial'};return {...p,id:digest(p)};};
test('rotation and rank persist across independent work batches and reopening the DB',()=>{
 const root=temp();let s=new DiscoveryStore(root);
 s.appendPage(page([item(1,'스니커즈'),item(2,'운동화'),item(3,'티셔츠'),item(4,'맨투맨'),item(5,'향수'),item(6,'알수없는물품')]));
 assert.deepEqual(s.claim(id(1),2).map(c=>c.kreamId),['1','3']);s.close();s=new DiscoveryStore(root);
 assert.deepEqual(s.claim(id(2),2).map(c=>c.kreamId),['5','6']);assert.deepEqual(s.claim(id(3),2).map(c=>c.kreamId),['2','4']);
 assert.deepEqual(s.claim(id(1),2).map(c=>c.kreamId),['1','3']);assert.equal(s.queued(),0);s.close();
});
test('duplicate products/pages, cursor loops, and failed reads cannot lose the cursor',async()=>{
 const s=new DiscoveryStore(temp());s.appendPage(page([item(1,'스니커즈')],'1','2'));s.appendPage(page([item(1,'스니커즈'),item(2,'후드')],'2','3'));
 assert.equal(s.queued(),2);assert.equal(s.appendPage(page([],'1',null)).reused,true);
 assert.throws(()=>s.appendPage(page([item(3,'가방')],'3','1')),/CURSOR_LOOP/);assert.equal(s.get('cursor'),'3');
 await assert.rejects(()=>selectNext(s,id(1),5,{feed:async()=>{throw Error('KREAM_LOGIN_REQUIRED');}}),/LOGIN/);
 assert.equal(s.get('cursor'),'3');assert.equal(s.claimed(id(1)).length,0);s.close();
});
test('completed real products from the existing pipeline are not selected again',()=>{
 const root=temp(),dir=path.join(root,id(9));fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'batch-state.json'),JSON.stringify({mode:'live',results:[{productId:'1',status:'complete'}]}));
 const s=new DiscoveryStore(path.join(root,'discovery'));s.importCompleted(root);s.appendPage(page([item(1,'스니커즈'),item(2,'스니커즈')]));assert.deepEqual(s.claim(id(1),2).map(x=>x.kreamId),['2']);s.close();
});
test('ambiguous and unclassified products stay in the searchable universe',()=>{
 assert.equal(classifyProduct(item(1,'스니커즈 키링')).category,'unclassified');
 assert.equal(classifyProduct(item(2,'unknown')).category,'unclassified');
});
test('a crash after candidate claim reuses precisely the same products without fetching',async()=>{
 const s=new DiscoveryStore(temp());s.appendPage(page([item(1,'스니커즈'),item(2,'후드')]));const selected=s.claim(id(1),2);
 assert.deepEqual(await selectNext(s,id(1),2,{feed:()=>{throw Error('UNEXPECTED_NETWORK');}}),selected);s.close();
});
test('unbound candidates produce valid partial packets rather than fake loss decisions',async()=>{
 const c=candidateFromItem(item(1,'향수'),{cursor:'1',rank:1,observedAt:new Date().toISOString()});
 const client={request:async(cmd)=>cmd==='market:kream:prices'?{prices:[]}:cmd==='market:kream:details'?{sizeOptions:[],colorway:'BLACK',totalSales:null}:{items:[],hasNext:false,cursor:'1',nextCursor:null,total:0}};
 const packet=await collectCandidate(c,{client,search:async()=>({items:[],hasNext:false}),mode:'fixture'});
 validatePacket(packet);assert.equal(packet.offers.length,0);assert.ok(packet.gaps.includes('verifiedSourceOfferMissing'));assert.equal(packet.collectionStatus,'partial');
});
test('source parser binds the actual query and refuses changed HTML; colors require equality',()=>{
 const html='<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{dehydratedState:{queries:[{queryKey:['search','goods',{keyword:'ABC'}],state:{data:{pages:[{items:[{goodsNo:123,goodsName:'ABC'}],pagination:{hasNext:false}}]}}}]}}}})+'</script>';
 assert.equal(parseMusinsaSearch(html,'ABC').items[0].productUrl,'https://www.musinsa.com/products/123');assert.throws(()=>parseMusinsaSearch(html,'DEF'),/QUERY_MISMATCH/);
 assert.equal(sameColor('(19)BLACK','블랙'),true);assert.equal(sameColor('BLACK/WHITE','BLACK'),false);
});
test('two N-product work requests continue the catalog, keep the collection barrier, and never exceed N',async()=>{
 const root=temp(),s=new DiscoveryStore(path.join(root,'discovery'));s.appendPage(page(Array.from({length:9},(_,i)=>item(i+1,i%2?'티셔츠':'스니커즈'))));s.close();
 const judged=[],events=[];
 const executeBatch=args=>runBatch({...args,mode:'fixture',collectDiscovered:async c=>{events.push('collect:'+c.kreamId);return partial(c);},analyze:async({packet})=>{events.push('judge:'+packet.productId);judged.push(packet.productId);return {status:'complete',assessment:{decision:'hold'}};}});
 const first=work(root,3,'first');assert.equal((await runExploration({root,workId:first.workId,executeBatch,mode:'fixture'})).status,'complete');
 assert.equal(events.slice(0,3).every(e=>e.startsWith('collect:')),true);assert.equal(scopeStatus(root).reservedProducts,3);
 const second=work(root,4,'second');assert.equal((await runExploration({root,workId:second.workId,executeBatch,mode:'fixture'})).status,'complete');
 assert.equal(judged.length,7);assert.equal(new Set(judged).size,7);assert.equal(scopeStatus(root).reservedProducts,4);
 const db=new DiscoveryStore(path.join(root,'discovery'));assert.equal(db.queued(),2);db.close();
});
test('failed discovery preserves scope, resumes safely, and stops when all source items are consumed',async()=>{
 const root=temp(),w=work(root,3,'one');
 const failed=await runExploration({root,workId:w.workId,feed:async()=>{throw Error('NO1_BRIDGE_DISCONNECTED');},mode:'fixture'});assert.equal(failed.status,'needs_attention');assert.equal(scopeStatus(root).reservedProducts,0);
 const result=await runExploration({root,workId:w.workId,feed:async cursor=>page([item(1,'스니커즈')],cursor),mode:'fixture',executeBatch:args=>runBatch({...args,collectDiscovered:async c=>partial(c),analyze:async()=>({status:'complete'})})});
 assert.equal(result.status,'source_exhausted');assert.equal(scopeStatus(root).remainingProducts,2);
 stopWork(root,w.workId);assert.equal(scopeStatus(root).status,'stopped');
});
test('failure before selecting products emits an attention event without spending work quota',async()=>{
 const root=temp(),w=work(root,2,'two');const r=await runExploration({root,workId:w.workId,feed:async()=>{throw Error('NO1_BRIDGE_DISCONNECTED');},mode:'live'});
 assert.equal(r.status,'needs_attention');assert.equal(scopeStatus(root).reservedProducts,0);
 const events=batchEvents(root);assert.equal(events.length,1);assert.equal(events[0].data.productCount,0);assert.match(events[0].data.error,/DISCOVERY_STAGE/);
});
test('start requires real work and idempotent retry never silently relaunches a failed worker',async()=>{
 const root=temp();await assert.rejects(()=>startExploration(root,{workId:'work-00000000-0000-0000-0000-000000000001'}),/SCOPE_REQUIRED/);
 const w=work(root,1,'one');let calls=0;const options={launchExploration:async()=>{calls++;return {pid:2147483647,launched:true};}};
 await startExploration(root,{workId:w.workId},options);const r=await startExploration(root,{workId:w.workId},options);assert.equal(calls,1);assert.equal(r.launched,false);assert.equal(r.status,'needs_attention');
 await assert.rejects(()=>control('cream_batch_start',{products:[{kreamId:'123',productUrl:'https://www.musinsa.com/products/1',model:'ABC',color:'BLACK',option:'L'}]},{root,launch:()=>{throw Error('MUST_NOT_LAUNCH');}}),/EXPLORATION_MANAGES_BATCHES/);
});
test('a larger N runs 5 plus remainder without Dot choosing another batch',async()=>{
 const root=temp(),s=new DiscoveryStore(path.join(root,'discovery'));s.appendPage(page(Array.from({length:12},(_,i)=>item(i+1,'스니커즈'))));s.close();
 const w=work(root,7,'seven'),sizes=[];
 const result=await runExploration({root,workId:w.workId,mode:'fixture',executeBatch:args=>{sizes.push(args.seeds.length);return runBatch({...args,collectDiscovered:async c=>partial(c),analyze:async()=>({status:'complete'})});}});
 assert.equal(result.status,'complete');assert.deepEqual(sizes,[5,2]);assert.equal(scopeStatus(root).reservedProducts,7);
});
test('stop during a batch does not start the next batch and later explicit resume continues its reservations',async()=>{
 const root=temp(),s=new DiscoveryStore(path.join(root,'discovery'));s.appendPage(page(Array.from({length:7},(_,i)=>item(i+1,'티셔츠'))));s.close();
 const w=work(root,7,'seven');let calls=0;
 const result=await runExploration({root,workId:w.workId,mode:'fixture',executeBatch:async args=>{calls++;stopWork(root,w.workId);return runBatch({...args,collectDiscovered:async c=>partial(c),analyze:async()=>({status:'complete'})}).catch(()=>({status:'stopped'}));}});
 assert.equal(result.status,'stopped');assert.equal(calls,1);assert.equal(scopeStatus(root).reservedProducts,5);
 for(const e of scopeStatus(root).entries)fs.writeFileSync(path.join(root,e.runId,'process.json'),JSON.stringify({pid:2147483647}));
 await startExploration(root,{workId:w.workId,resume:true},{launchExploration:async()=>({pid:2147483647,launched:true})});
 const resumed=await runExploration({root,workId:w.workId,mode:'fixture',executeBatch:args=>runBatch({...args,collectDiscovered:async c=>partial(c),analyze:async()=>({status:'complete'})})});
 assert.equal(resumed.status,'complete');assert.equal(scopeStatus(root).reservedProducts,7);
});
