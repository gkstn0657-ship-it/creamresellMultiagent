import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';
import {BackgroundClient} from '../no1-background/client.mjs';
import {CATEGORIES,projectRankingSettings,projectRankingProducts} from '../no1-background/chrome-extension/ranking-data.mjs';
import {collectRankingCandidate,qualifyRankingResult} from './musinsa-ranking-collector.mjs';
import {workOrders,workSummary,reserveWork,withWorkLock} from './work-orders.mjs';
import {runBatch} from './batch.mjs';import {groupProducts} from './packets.mjs';import {digest} from './store.mjs';
import {writeJsonAtomic as write} from './atomic-json.mjs';
import {recoveringClient} from './source-recovery.mjs';
const read=p=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):null;
const idFor=(work,n)=>'batch-'+crypto.createHash('sha256').update(`musinsa-profit:${work}:${n}`).digest('hex').slice(0,32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
export async function runMusinsaProfitSearch({root,workId,client=new BackgroundClient(),collect=collectRankingCandidate,execute=runBatch,onEvent=()=>{},recovery={}}){
  const work=workOrders(root).find(w=>w.id===workId);
  if(!work||work.scopeMode!=='profitable-results'||work.status==='stopped')throw Error('PROFIT_TARGET_WORK_REQUIRED');
  const dir=path.join(root,'explorations',workId);fs.mkdirSync(dir,{recursive:true});
  const lock=path.join(dir,'worker.lock');
  if(fs.existsSync(lock)){let alive=false;try{process.kill(Number(fs.readFileSync(lock,'utf8')),0);alive=true;}catch{}if(alive)throw Error('EXPLORATION_ALREADY_RUNNING');fs.unlinkSync(lock);}
  fs.writeFileSync(lock,String(process.pid),{flag:'wx'});write(path.join(dir,'process.json'),{pid:process.pid,at:new Date().toISOString()});
  const sourceDir=path.join(root,'musinsa-discovery');fs.mkdirSync(sourceDir,{recursive:true});
  const memory=read(path.join(sourceDir,'state.json'))||{version:1,seenSourceIds:[],seenKreamIds:[],contexts:{}};
  const state=read(path.join(dir,'state.json'))||{workId,mode:'live',source:'no1-musinsa-ranking',targetProfitableProducts:work.targetProfitableProducts,startedAt:new Date().toISOString(),checkedSources:0,skipped:[],batches:[]};
  const stop=()=>fs.existsSync(path.join(dir,'STOP'))||workOrders(root).find(w=>w.id===workId)?.status==='stopped';
  const save=()=>{state.pendingSourceIds=pending.map(p=>p.offers[0].productUrl.split('/').at(-1));state.updatedAt=new Date().toISOString();write(path.join(dir,'state.json'),state);write(path.join(sourceDir,'state.json'),memory);};
  const emit=e=>{onEvent(e);save();};
  let pending=(state.pendingSourceIds||[]).map(id=>read(path.join(sourceDir,'evidence',id,'packet.json')));
  if(pending.some(p=>!p))throw Error('PENDING_PACKET_MISSING');
  client=recoveringClient(client,{...recovery,stopped:stop,onRecovery:e=>{
    state.recovery={...e,sourceId:state.currentSource?.productId||null,at:new Date().toISOString()};
    state.status=e.type==='source_retry'?'recovering':e.type==='source_recovered'?'discovering':'needs_attention';emit(e);
  }});
  try{
    const settings=projectRankingSettings(await client.request('musinsa:ranking:settings',{}));
    if(state.settings&&JSON.stringify(state.settings)!==JSON.stringify(settings))throw Error('RANKING_SETTINGS_CHANGED');state.settings=settings;
    // All-category scope can continue deterministically through its subcategories;
    // a specific selected category never expands to other categories.
    const categories=settings.category==='000'?['000',...CATEGORIES.filter(c=>c!=='000')]:[settings.category];
    const key=JSON.stringify(settings),context=memory.contexts[key]||{categoryIndex:0};memory.contexts[key]=context;
    const seenSources=new Set(memory.seenSourceIds),seenMarkets=new Set(memory.seenKreamIds);
    const updateProgress=()=>{const summary=workSummary(root,workOrders(root).find(w=>w.id===workId));state.profitableProductsFound=summary.profitableProductsFound;return summary;};
    const flush=async()=>{
      if(!pending.length||stop())return;
      const packets=pending;
      const current=workOrders(root).find(w=>w.id===workId),id=current.entries.find(e=>read(path.join(root,e.runId,'batch-state.json'))?.status!=='complete')?.runId||idFor(workId,current.entries.length),batchDir=path.join(root,id),seeds=packets.flatMap(p=>p.offers);
      await withWorkLock(root,()=>reserveWork(root,{workId,runId:id,productCount:packets.length,requestId:`musinsa:${id}`,scopeHash:digest(groupProducts(seeds))}));
      fs.mkdirSync(batchDir,{recursive:true});write(path.join(batchDir,'products.json'),seeds);write(path.join(batchDir,'launch.json'),{workId,concurrency:2,analysisProfile:'musinsa-ranking',managedBy:'musinsa-profit-search'});write(path.join(batchDir,'process.json'),{pid:process.pid});
      const payloads=new Map(packets.flatMap(p=>p.observations.filter(o=>o.kind==='no1_product').map(o=>[JSON.stringify(o.payload.request),o.payload])));
      state.status='running_batch';state.currentRunId=id;save();
      const result=await execute({dir:batchDir,seeds,concurrency:2,analysisProfile:'musinsa-ranking',mode:'live',resume:fs.existsSync(path.join(batchDir,'collection-complete.json')),collect:async seed=>{const p=payloads.get(JSON.stringify(seed));if(!p)throw Error('MUSINSA_PACKET_MISSING');return structuredClone(p);},onEvent:e=>onEvent({...e,runId:id})});
      for(const row of result.results)row.qualification=qualifyRankingResult(row,packets.find(p=>p.productId===row.productId));
      write(path.join(batchDir,'batch-state.json'),result);write(path.join(batchDir,'batch-result.json'),result);
      if(result.status==='complete')pending=[];
      state.batches.push({runId:id,status:result.status,qualified:result.results.filter(r=>r.qualification.passed).map(r=>r.productId)});updateProgress();emit({type:'profit_progress',found:state.profitableProductsFound,target:work.targetProfitableProducts,checkedSources:state.checkedSources});
      if(result.status!=='complete')throw Error('BATCH_NEEDS_ATTENTION');
    };
    delete state.error;delete state.finishedAt;
    state.status='discovering';updateProgress();save();if(pending.length)await flush();
    for(;context.categoryIndex<categories.length&&!stop();context.categoryIndex++){
      const category=categories[context.categoryIndex];state.currentCategory=category;state.status='discovering';save();
      const request={section:'all',...settings,...(category==='000'?{}:{category})};if(category==='000')delete request.category;
      const feed=projectRankingProducts(await client.request('musinsa:ranking:products',request));
      emit({type:'ranking_loaded',category,count:feed.products.length});
      const retrySources=(state.retrySources||[]).filter(s=>s.category===category&&!feed.products.some(p=>p.productId===s.productId));
      for(const source of [...feed.products,...retrySources].sort((a,b)=>a.rank-b.rank)){
        if(stop())break;if(!work.continuous&&updateProgress().remainingProducts===0)break;
        if(seenSources.has(source.productId))continue;
        state.currentSource={...source,category};state.status='discovering';save();
        const evidenceDir=path.join(sourceDir,'evidence',source.productId);fs.mkdirSync(evidenceDir,{recursive:true});
        let evidenceIndex=fs.readdirSync(evidenceDir).length;
        let result;try{
        result=await collect({...source,category,observedAt:new Date().toISOString()},{client,seenKreamIds:seenMarkets,onEvidence:async(cmd,payload,data)=>write(path.join(evidenceDir,`${++evidenceIndex}.json`),{cmd,payload,data,observedAt:new Date().toISOString()})});
        }catch(e){
          // Only an established product-specific mismatch is an exclusion.
          // Infrastructure, malformed responses and unexpected bugs retain the
          // source and cursor, and must reach the work-level failure handler.
          if(!['NO1_OPTION_NOT_FOUND','NO1_IDENTITY_MISMATCH'].includes(e.message))throw e;
          result={status:'skipped',reason:e.message};
        }
        state.checkedSources++;seenSources.add(source.productId);memory.seenSourceIds=[...seenSources];
        state.retrySources=(state.retrySources||[]).filter(s=>s.productId!==source.productId);
        // A failed offer must not hide a different merchant listing for the same
        // KREAM product. Deduplicate market IDs only once a packet is queued.
        if(result.kreamId&&result.status==='collected'){seenMarkets.add(result.kreamId);memory.seenKreamIds=[...seenMarkets];}
        if(result.status==='collected'){write(path.join(evidenceDir,'packet.json'),result.packet);pending.push(result.packet);}
        else state.skipped.push({sourceId:source.productId,kreamId:result.kreamId||null,reason:result.reason});
        emit({type:'source_processed',sourceId:source.productId,rank:source.rank,status:result.status,reason:result.reason,kreamId:result.kreamId,pending:pending.length});
        if(pending.length>=Math.min(5,updateProgress().remainingProducts))await flush();
      }
      await flush();if(stop()||!work.continuous&&updateProgress().remainingProducts===0)break;
    }
    state.status=stop()?'stopped':!work.continuous&&updateProgress().remainingProducts===0?'complete':'source_exhausted';
  }catch(e){
    state.status=stop()?'stopped':'needs_attention';state.error=String(e.message).slice(0,250);
    if(state.status==='needs_attention'){
      if(state.currentSource&&!memory.seenSourceIds.includes(state.currentSource.productId)&&!(state.retrySources||[]).some(s=>s.productId===state.currentSource.productId))state.retrySources=[...(state.retrySources||[]),state.currentSource];
      // Publish a real failed discovery attempt through the existing batch
      // event outbox, without reserving products or overwriting a finished batch.
      const at=new Date().toISOString(),id=idFor(workId,`failure:${at}:${state.error}`),failureDir=path.join(root,id);
      fs.mkdirSync(failureDir,{recursive:true});
      write(path.join(failureDir,'launch.json'),{workId,managedBy:'musinsa-profit-search',stage:'discovery'});
      write(path.join(failureDir,'batch-state.json'),{mode:'live',status:'needs_attention',stage:'discovery',productCount:0,collected:0,judged:0,results:[],error:`MUSINSA_DISCOVERY: ${state.error}`,startedAt:at,finishedAt:at});
      state.failureEventRunId=id;emit({type:'work_needs_attention',workId,error:state.error,failureEventRunId:id});
    }
  }
  finally{state.finishedAt=new Date().toISOString();save();if(fs.existsSync(lock)&&fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}
  return state;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const arg=n=>process.argv.find(v=>v.startsWith(`--${n}=`))?.slice(n.length+3);
  if(!arg('root')||!arg('work'))throw Error('ROOT_AND_WORK_REQUIRED');
  const result=await runMusinsaProfitSearch({root:path.resolve(arg('root')),workId:arg('work'),onEvent:e=>console.log(JSON.stringify(e))});
  console.log(JSON.stringify({status:result.status,found:result.profitableProductsFound,target:result.targetProfitableProducts,error:result.error}));if(result.status!=='complete')process.exitCode=2;
}
