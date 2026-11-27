import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {alive,validateMission} from '../../herdr-runtime/state.mjs';
import {verifiedResult} from '../../herdr-runtime/backend.mjs';
import {modelPolicy} from '../model-routing.mjs';
import {agentActivity} from './agent-activity.mjs';
import {continuousRuns,continuousData} from './continuous-data.mjs';
import {withWorkLock,stopWork} from '../work-orders.mjs';
import {resultDetails} from './result-data.mjs';
import {explorationStatus} from './exploration-status.mjs';
const exec=promisify(execFile);
export const defaultRuns=fileURLToPath(new URL('../../../kream-runs/',import.meta.url));
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const dirs=dir=>{try{return fs.readdirSync(dir,{withFileTypes:true}).filter(x=>x.isDirectory()&&!x.isSymbolicLink()).map(x=>x.name);}catch{return [];}};
const safe=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]+$/.test(id);
function recoveredProducts(runDir,sourceId,retry){
 const name=typeof retry?.batchDir==='string'?path.basename(retry.batchDir):'';
 if(!new RegExp('^'+sourceId+'-\\d{10,16}$').test(name)||retry?.reviewed!==true)return [];
 const base=path.join(runDir,'exclusion-resolution','rechecks',name),batch=read(path.join(base,'batch-state.json'))||{};
 return (batch.results||[]).filter(result=>/^(?:\d{1,12}|poizon-\d{1,18})$/.test(String(result.productId))).flatMap(result=>{
  let verified=false;try{verified=verifiedResult(base,result);}catch{}
  if(!verified)return [];
  const team=read(path.join(base,'judgments',result.productId,'team-state.json'))||{};
  return [{productId:result.productId,batchId:name,status:result.status,decision:result.assessment?.decision,reason:result.assessment?.reason,verified,details:resultDetails(team,result),model:team.ownerModel||null,actors:(team.actors||[]).map(a=>({role:a.role,model:a.effectiveModel||a.requestedModel||a.model||null,effort:a.effort,reason:a.routingReason})),upgrades:team.modelUpgradeCount||0}];
 });
}
export function herdrRuns(root=defaultRuns){
 return [...continuousRuns(path.join(root,'agent-teams')),...dirs(root).flatMap(id=>{if(!safe(id))return [];const state=read(path.join(root,id,'state.json'));try{validateMission(state?.mission);}catch{return [];}
 if(!Array.isArray(state.batches)||!state.session)return [];
 return [{id,status:state.status,source:state.mission.source,target:state.mission.continuous?null:state.mission.targetProducts,updatedAt:fs.statSync(path.join(root,id,'state.json')).mtime.toISOString()}];
 })].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export function herdrData(root=defaultRuns,id){
 const runs=herdrRuns(root);id=id||runs[0]?.id;
 if(!id)return {runs,selected:null,policy:modelPolicy.defaults,observedAt:new Date().toISOString()};
 if(!safe(id)||!runs.some(r=>r.id===id))throw Error('RUN_NOT_FOUND');
 if(runs.find(r=>r.id===id)?.continuous)return continuousData(path.join(root,'agent-teams'),id,runs);
 const dir=path.join(root,id),state=read(path.join(dir,'state.json'));
 // Only the configured local data root is trusted for control and evidence reads.
 const trustedRoot=path.resolve(root,'agent-teams');
 const trusted=typeof state.root==='string'&&path.resolve(state.root).toLowerCase()===trustedRoot.toLowerCase();
 const controllerAlive=alive(read(path.join(dir,'controller.lock'))?.pid),stopping=fs.existsSync(path.join(dir,'STOP'));
 const batches=trusted?state.batches.filter(b=>/^batch-[a-f0-9-]{36}$/.test(b.runId)).map(b=>{
  const base=path.join(trustedRoot,b.runId),batch=read(path.join(base,'batch-state.json'))||{},sources=read(path.join(base,'source-state.json'))?.results||[];
  const productIds=new Set([...(batch.results||[]).map(r=>String(r.productId)),...dirs(path.join(base,'judgments'))]);
  const products=[...productIds].filter(p=>/^(?:\d{1,12}|poizon-\d{1,18})$/.test(p)).map(productId=>{
   const row=(batch.results||[]).find(r=>String(r.productId)===productId)||{},team=read(path.join(base,'judgments',productId,'team-state.json'))||{};
   let verified=false;try{verified=verifiedResult(base,row);}catch{}
   let teamLive=false;try{teamLive=alive(Number(fs.readFileSync(path.join(base,'judgments',productId,'runtime.lock'),'utf8')));}catch{}
   const activities=(team.actors||[]).map(a=>({...agentActivity({id:a.threadId,role:a.role,model:{model:a.effectiveModel||a.requestedModel||a.model||null,effort:a.effort},events:(team.events||[]).filter(e=>e.threadId===a.threadId),live:teamLive,terminal:team.status==='complete'||(team.reviews||[]).some(r=>r.threadId===a.threadId),retired:a.role==='owner_retired'}),productId,runId:b.runId}));
   return {productId,details:resultDetails(team,row),activities,status:team.status||row.status||'pending',decision:row.assessment?.decision||team.assessment?.decision,reason:row.assessment?.reason||team.assessment?.reason,verified,error:row.error,model:team.ownerModel||null,actors:(team.actors||[]).map(a=>({role:a.role,model:a.effectiveModel||a.requestedModel||a.model||null,effort:a.effort,reason:a.routingReason})),upgrades:team.modelUpgradeCount||0};
  });
  const savedSources=read(path.join(base,'sources.json'));
  const sourceItems=(Array.isArray(savedSources)?savedSources:[]).map(s=>({productId:String(s.productId),rank:s.rank,productName:s.productName,productUrl:s.productUrl}));
  return {runId:b.runId,paneId:b.paneId,reason:b.reason,status:batch.status||'launch_pending',alive:alive(read(path.join(base,'process.json'))?.pid),error:batch.error,products,sources,sourceItems};
 }):[];
 const reviewed=batches.flatMap(b=>b.products).filter(p=>p.verified).length;
 const skipped=batches.reduce((n,b)=>n+b.sources.filter(s=>s.status==='skipped').length,0);
 const completed=state.mission.source==='musinsa-ranking'?batches.filter(b=>b.status==='complete').reduce((n,b)=>n+b.sources.filter(s=>s.status==='skipped'||b.products.some(p=>p.productId===s.packetProductId&&p.verified)).length,0):reviewed;
 const agents=[agentActivity({id:state.threadId||'coordinator',role:'coordinator',model:state.modelSelection,events:state.history||[],live:controllerAlive,terminal:['complete','blocked','source_exhausted','stopped'].includes(state.status)}),...batches.flatMap(b=>[{id:b.runId,role:'worker',status:b.status==='complete'?'finished':b.alive?'working':'offline',live:b.alive,phase:b.status,model:null,paneId:b.paneId,events:[],message:b.error||null},...b.products.flatMap(p=>p.activities)])];
 const exploration=explorationStatus(batches);
 for(const row of exploration.rows.filter(r=>r.status==='skipped')){
  const saved=read(path.join(dir,'exclusion-diagnostics','cases',row.sourceId+'.json'))||read(path.join(trustedRoot,row.batchId,'exclusion-diagnostics','cases',row.sourceId+'.json'));
  if(saved?.batchId===row.batchId&&saved.facts?.sourceId===row.sourceId&&saved.facts?.summaryCode===row.reason)row.diagnosis={kream:saved.facts.kream,poizon:saved.facts.poizon,confidence:saved.facts.confidence,agent:saved.agent};
  const resolution=read(path.join(dir,'exclusion-resolution','cases',row.sourceId+'.json'));
  if(resolution?.batchId===row.batchId&&resolution.basisHash===saved?.facts?.basisHash){const products=recoveredProducts(dir,row.sourceId,resolution.retry);row.resolution={status:resolution.status==='recovered'&&!products.length?'needs_attention':resolution.status,reason:resolution.reason,nextCheck:resolution.nextCheck,retryAt:resolution.retryAt,retry:resolution.retry||null,products};}
 }
 exploration.counts.diagnosed=exploration.rows.filter(r=>r.diagnosis?.agent?.status==='complete').length;
 exploration.counts.recovered=exploration.rows.filter(r=>r.resolution?.status==='recovered').length;
 return {runs,selected:id,agents,observedAt:new Date().toISOString(),policy:modelPolicy.defaults,mission:state.mission,status:state.status,controllerAlive,stopping,trusted,turns:state.turns,model:state.modelSelection||null,error:state.error||(!trusted?'DATA_ROOT_NOT_SUPPORTED':null),completed,reviewed,skipped,exploration,batches,events:(state.history||[]).slice(-30).reverse(),canStop:trusted&&(controllerAlive||batches.some(b=>b.alive)),canResume:trusted&&!controllerAlive&&!batches.some(b=>b.alive)&&!['complete','source_exhausted'].includes(state.status)};
}
export function adoptedCandidate(root=defaultRuns,id,productId){
 if(typeof productId!=='string'||!/^(?:\d{1,12}|poizon-\d{1,18})$/.test(productId))throw Error('ADOPTED_CANDIDATE_NOT_FOUND');
 const data=herdrData(root,id);
 const products=[...(data.batches||[]).flatMap(b=>(b.products||[]).map(p=>({...p,batchId:b.runId}))),...(data.exploration?.rows||[]).flatMap(r=>r.resolution?.products||[])].filter(p=>p.productId===productId&&p.status==='complete'&&p.verified&&p.decision==='adopt');
 const product=products.sort((a,b)=>String(b.details?.at||'').localeCompare(String(a.details?.at||'')))[0];
 if(!product)throw Error('ADOPTED_CANDIDATE_NOT_FOUND');
 const source=data.exploration?.rows.find(r=>r.markets.some(m=>m.productId===productId)||r.resolution?.products?.some(p=>p.productId===productId))||null;
 return {runId:id,productId,product:{batchId:product.batchId,name:product.details?.name||productId,platform:productId.startsWith('poizon-')?'POIZON':'KREAM',reason:product.reason,reviewedAt:product.details?.at||null,readiness:product.details?.readiness||null,sourceUrl:product.details?.sourceUrl||null,unresolved:product.details?.unresolved||[],options:product.details?.options||[],model:product.model,actors:product.actors||[],upgrades:product.upgrades||0},source:source?{sourceId:source.sourceId,rank:source.rank,name:source.name,url:source.url}:null};
}
export async function herdrAction(root,id,action,maxTurns){
 const data=herdrData(root,id);
 if(!['stop','resume'].includes(action))throw Error('INVALID_ACTION');
 if(!(action==='stop'?data.canStop:data.canResume))throw Error('ACTION_NOT_AVAILABLE');
 if(data.continuous){await withWorkLock(path.join(root,'agent-teams'),()=>stopWork(path.join(root,'agent-teams'),id));return {ok:true,action,runId:id,message:'연속 탐색 중지를 요청했습니다.'};}
 const args=[fileURLToPath(new URL('../../herdr-runtime/run.mjs',import.meta.url)),action,`--dir=${path.join(root,id)}`];
 if(action==='resume'){
  if(!data.mission.continuous){const limit=maxTurns??data.mission.maxTurns;
    validateMission({...data.mission,maxTurns:limit});
    if(limit<=data.turns)throw Error('TURN_BUDGET_EXHAUSTED');
    args.push(`--max-turns=${limit}`);}
 }
 await exec(process.execPath,args,{windowsHide:true,timeout:30000,maxBuffer:1024*1024});
 return {ok:true,action,runId:id,message:action==='stop'?'중지를 요청했습니다. 프로세스 종료 여부를 확인 중입니다.':'재개를 요청했습니다. 지휘자 연결 여부를 확인 중입니다.'};
}
