import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DiscoveryStore} from '../agent-team/discovery-store.mjs';
import {createDiscoveryFeed} from '../agent-team/discovery-feed.mjs';
import {startWork,reserveWork,continueWorkUntilStopped,withWorkLock,workOrders,workSummary,stopWork} from '../agent-team/work-orders.mjs';
import {writeJsonAtomic as write} from '../agent-team/atomic-json.mjs';
import {read,alive} from './state.mjs';
import {BackgroundClient} from '../no1-background/client.mjs';
import {readRankingFeed} from '../no1-background/ranking-feed.mjs';
import {digest} from '../agent-team/store.mjs';
import {connection} from './connection.mjs';
const worker=fileURLToPath(new URL('./worker.mjs',import.meta.url));
export function verifiedResult(dir,row) {
  if(row.status!=='complete'||!row.assessment?.reviewId||!/^(?:\d{1,12}|poizon-\d{1,18})$/.test(row.productId))return false;
  const team=read(path.join(dir,'judgments',row.productId,'team-state.json'));
  if(!team||team.status!=='complete'||team.assessment?.id!==row.assessment.id)return false;
  const basis=digest({mission:team.mission,observations:team.observations.filter(x=>x.active!==false).map(x=>x.id),calculations:team.calculations.filter(x=>x.active!==false).map(x=>x.id)});
  const review=team.reviews.find(r=>r.id===row.assessment.reviewId);
  return Boolean(review&&review.verdict==='pass'&&review.threadId!==team.ownerThreadId&&review.basis===basis&&team.assessment.evidenceBasis===basis);
}
export class Backend {
  constructor({journal,root,herdr,workspaceId,feed=createDiscoveryFeed(),rankingFeed=()=>readRankingFeed(new BackgroundClient(),{limit:1000})}) {Object.assign(this,{journal,root,herdr,workspaceId,feed,rankingFeed});this.ranking=journal.data.mission.source==='musinsa-ranking';}
  async initialize() {
    await withWorkLock(this.root,()=>{
      if(this.journal.data.mission.replaceWorkId){
        const old=workOrders(this.root).find(w=>w.id===this.journal.data.mission.replaceWorkId);
        if(!old||old.continuous!==true||workSummary(this.root,old).activeRunIds.length||workSummary(this.root,old).exploration?.workerAlive)throw Error('REPLACED_WORK_NOT_IDLE_CONTINUOUS');
        if(old.status!=='stopped')stopWork(this.root,old.id);
      }
      const others=workOrders(this.root).filter(w=>w.id!==this.journal.data.workId&&w.status!=='stopped'&&workSummary(this.root,w).status!=='complete');
      if(others.length)throw Error('EXISTING_WORK_REQUIRES_RECONCILIATION');
      if(!this.journal.data.workId) {
        const work=startWork(this.root,{...(this.ranking?{targetSources:this.journal.data.mission.targetProducts}:{targetProducts:this.journal.data.mission.targetProducts}),userInstruction:this.journal.data.mission.instruction,requestId:'herdr:'+crypto.createHash('sha256').update(this.journal.dir).digest('hex')});
        this.journal.data.workId=work.workId||work.id;this.journal.save();
        if(this.journal.data.mission.continuous)continueWorkUntilStopped(this.root,this.journal.data.workId);
      }
    });
    if(!this.ranking){this.store=new DiscoveryStore(path.join(this.root,'discovery'));this.store.importCompleted(this.root);}
  }
  status() {
    const batches=this.journal.data.batches.map(b=>{
      const dir=path.join(this.root,b.runId),state=read(path.join(dir,'batch-state.json')),proc=read(path.join(dir,'process.json'));
      const sourceState=read(path.join(dir,'source-state.json'));
      return {...b,status:state?.status||'launch_pending',workerAlive:alive(proc?.pid),error:state?.error||null,sourceResults:sourceState?.results||[],
        results:(state?.results||[]).map(r=>({productId:r.productId,status:r.status,decision:r.assessment?.decision,reviewId:r.assessment?.reviewId,verified:verifiedResult(dir,r),error:r.error}))};
    });
    const result={workId:this.journal.data.workId,status:this.journal.data.status,continuous:this.journal.data.mission.continuous===true,target:this.journal.data.mission.continuous?null:this.journal.data.mission.targetProducts,
      unit:this.ranking?'inspected-sources':'reviewed-products',assigned:batches.reduce((n,b)=>n+b.productIds.length,0),completed:batches.reduce((n,b)=>n+(this.ranking?(b.status==='complete'?b.sourceResults.filter(r=>r.status==='skipped'||b.results.some(p=>p.productId===r.packetProductId&&p.verified)).length:0):b.results.filter(r=>r.verified).length),0),batches};
    if(this.ranking&&this.journal.data.workId)write(path.join(this.root,'explorations',this.journal.data.workId,'state.json'),{managedBy:'herdr-autonomous',checkedSources:result.completed,status:!result.continuous&&result.completed===result.target?'complete':this.journal.data.status});
    return result;
  }
  assertNoActive() {
    if(this.status().batches.some(b=>b.workerAlive||['launch_pending','collecting','judging'].includes(b.status)))throw Error('BATCH_PENDING_READ_STATUS_OR_RECOVER');
  }
  async launch(b) {
    const created=await this.herdr.call('tab','create','--workspace',this.workspaceId,'--cwd',fileURLToPath(new URL('../../',import.meta.url)),'--label',b.runId,'--no-focus');
    const pane=created.root_pane?.pane_id;if(!pane)throw Error('HERDR_PANE_RESPONSE_INVALID');
    b.paneId=pane;this.journal.save();
    await this.herdr.launch(pane,worker,[`--root=${this.root}`,`--run=${b.runId}`,`--session=${this.herdr.session}`]);
    return {runId:b.runId,paneId:pane,status:'launch_pending',executionConfirmed:false};
  }
  async execute(tool,args) {
    if(this.journal.stopped())throw Error('STOP_REQUESTED');
    if(tool==='connection'){if(typeof args.repairLocalBridge!=='boolean')throw Error('INVALID_REPAIR_FLAG');return connection(args);}
    if(tool==='status')return this.status();
    if(tool==='catalog') {
      if(typeof args.fetchNext!=='boolean')throw Error('INVALID_FETCH_FLAG');
      this.assertNoActive();
      if(this.ranking){
        if(args.fetchNext||!this.journal.data.catalog){const feed=await this.rankingFeed();
          if(this.journal.data.catalog&&JSON.stringify(this.journal.data.catalog.settings)!==JSON.stringify(feed.settings))throw Error('RANKING_SETTINGS_CHANGED');
          this.journal.data.catalog=feed;this.journal.save();}
        const memory=read(path.join(this.root,'musinsa-discovery','state.json'))||{};
        const seen=new Set([...(memory.seenSourceIds||[]),...this.journal.data.batches.flatMap(b=>b.productIds)]);
        const feed=this.journal.data.catalog,candidates=feed.products.filter(p=>!seen.has(p.productId));
        return {source:'musinsa-ranking',settings:feed.settings,coverage:'current-selected-ranking-context',exhausted:candidates.length===0&&feed.products.length===feed.total,candidates:candidates.slice(0,100),instruction:this.journal.data.mission.continuous?'productIds are Musinsa source IDs. Inspect unseen sources until user STOP; skips remain visible and are never profitable results.':'productIds are Musinsa source IDs. Target counts inspected sources, not profitable products. Skips remain visible.'};
      }
      if(args.fetchNext&&!this.store.get('exhausted'))this.store.appendPage(await this.feed(this.store.get('cursor')));
      return {exhausted:this.store.get('exhausted'),cursor:this.store.get('cursor'),candidates:this.store.db.prepare('SELECT payload FROM candidates WHERE batch_id IS NULL ORDER BY rank LIMIT 100').all().map(r=>JSON.parse(r.payload))};
    }
    if(tool==='analyze') {
      this.assertNoActive();const ids=args.productIds;
      if(!Array.isArray(ids)||ids.length<1||ids.length>5||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^\d{1,12}$/.test(id)))throw Error('INVALID_PRODUCT_IDS');
      if(typeof args.reason!=='string'||!args.reason.trim())throw Error('DECISION_REASON_REQUIRED');
      if(!this.journal.data.mission.continuous&&this.status().assigned+ids.length>this.journal.data.mission.targetProducts)throw Error('TARGET_SCOPE_EXCEEDED');
      const runId='batch-'+crypto.randomUUID(),dir=path.join(this.root,runId);
      let products;
      await withWorkLock(this.root,()=>{
        if(this.ranking){
          const memory=read(path.join(this.root,'musinsa-discovery','state.json'))||{},seen=new Set([...(memory.seenSourceIds||[]),...this.journal.data.batches.flatMap(b=>b.productIds)]);
          products=ids.map(id=>{const p=this.journal.data.catalog?.products.find(p=>p.productId===id);if(!p||seen.has(id))throw Error('UNOBSERVED_OR_ASSIGNED_PRODUCT');return {...p,category:this.journal.data.catalog.settings.category,observedAt:this.journal.data.catalog.observedAt};});
        }else products=ids.map(id=>{const row=this.store.db.prepare('SELECT payload FROM candidates WHERE id=? AND batch_id IS NULL').get(id);if(!row)throw Error('UNOBSERVED_OR_ASSIGNED_PRODUCT');return JSON.parse(row.payload);});
        // Persist the reservation before any external launch. A crash leaves explicit recovery work.
        reserveWork(this.root,{workId:this.journal.data.workId,runId,productCount:ids.length,requestId:runId,scopeHash:crypto.createHash('sha256').update(JSON.stringify(ids)).digest('hex')});
        const b={runId,productIds:ids,retries:0,reason:args.reason,createdAt:new Date().toISOString()};this.journal.data.batches.push(b);this.journal.save();
        if(!this.ranking)this.store.transaction(()=>{ids.forEach((id,i)=>{const updated=this.store.db.prepare('UPDATE candidates SET batch_id=? WHERE id=? AND batch_id IS NULL').run(runId,id);if(updated.changes!==1)throw Error('PRODUCT_CLAIM_CONFLICT');this.store.db.prepare('INSERT INTO claims VALUES(?,?,?)').run(runId,i,id);});});
        fs.mkdirSync(dir,{recursive:true});write(path.join(dir,'products.json'),products);if(this.ranking)write(path.join(dir,'sources.json'),products);
        write(path.join(dir,'launch.json'),{workId:this.journal.data.workId,analysisProfile:this.ranking?'musinsa-ranking':'general',concurrency:2,managedBy:'herdr-autonomous'});
      });
      return this.launch(this.journal.data.batches.find(b=>b.runId===runId));
    }
    if(tool==='retry_batch') {
      const b=this.journal.data.batches.find(b=>b.runId===args.runId);if(!b)throw Error('UNKNOWN_BATCH');
      const current=this.status().batches.find(x=>x.runId===b.runId);
      if(this.status().batches.some(x=>x.runId!==b.runId&&(x.workerAlive||['launch_pending','collecting','judging'].includes(x.status))))throw Error('ANOTHER_BATCH_ACTIVE');
      if(current.status==='complete')return {reused:true,...current};
      if(current.workerAlive)throw Error('BATCH_ALREADY_RUNNING');
      if(Date.now()-Date.parse(b.lastLaunchAt||b.createdAt)<30000)throw Error('LAUNCH_ACK_PENDING');
      if(b.retries>=2)throw Error('RETRY_BUDGET_EXHAUSTED');
      if(fs.existsSync(path.join(this.root,b.runId,'STOP')))throw Error('STOP_REQUIRES_USER_RESUME');
      if(typeof args.reason!=='string'||!args.reason.trim())throw Error('RECOVERY_REASON_REQUIRED');
      if(!read(path.join(this.root,b.runId,'products.json')))throw Error('RESERVATION_INCOMPLETE_REQUIRES_REPAIR');
      b.retries++;b.lastLaunchAt=new Date().toISOString();b.recoveryReason=args.reason;this.journal.save();return this.launch(b);
    }
    if(tool==='wait') {
      if(!Number.isInteger(args.seconds)||args.seconds<5||args.seconds>60)throw Error('INVALID_WAIT');
      for(let i=0;i<args.seconds*2;i++){if(this.journal.stopped())throw Error('STOP_REQUESTED');await new Promise(r=>setTimeout(r,500));}
      return this.status();
    }
    if(tool==='finish') {
      const status=this.status();
      if(!['complete','blocked','source_exhausted'].includes(args.outcome)||typeof args.reason!=='string'||!args.reason.trim())throw Error('INVALID_FINISH');
      if(this.journal.data.mission.continuous)throw Error('CONTINUOUS_WORK_STOPS_ONLY_ON_USER_STOP');
      if(status.batches.some(b=>b.workerAlive||b.status==='launch_pending'))throw Error('WORKERS_STILL_ACTIVE');
      if(args.outcome!=='complete'&&status.completed===status.target&&status.batches.every(b=>b.status==='complete'))throw Error('INSPECTION_TARGET_REACHED_USE_COMPLETE_REPORT_SKIPS');
      if(args.outcome==='complete'&&(status.completed!==status.target||status.batches.some(b=>b.status!=='complete')))throw Error('UNVERIFIED_COMPLETION');
      if(args.outcome==='source_exhausted'){
        const exhausted=this.ranking?(await this.execute('catalog',{fetchNext:false})).exhausted:this.store.get('exhausted')&&!this.store.queued();
        if(!exhausted)throw Error('SOURCE_NOT_EXHAUSTED');
      }
      this.journal.data.status=args.outcome;this.journal.data.reason=args.reason;this.journal.save();return this.status();
    }
    throw Error('UNKNOWN_TOOL');
  }
  async stop() {if(this.journal.data.workId)await withWorkLock(this.root,()=>stopWork(this.root,this.journal.data.workId));}
  close(){this.store?.close();}
}
