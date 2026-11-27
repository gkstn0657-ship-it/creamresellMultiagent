import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {CodexServer} from '../agent-team/app-server.mjs';
import {defaultModel} from '../agent-team/model-routing.mjs';
import {writeJsonAtomic} from '../agent-team/atomic-json.mjs';
import {BackgroundClient} from '../no1-background/client.mjs';
import {collectRankingCandidate,rankingSizeMatch} from '../agent-team/musinsa-ranking-collector.mjs';
import {runBatch} from '../agent-team/batch.mjs';
import {validatePacket} from '../agent-team/packets.mjs';
import {verifiedResult} from './backend.mjs';
import {recoveringClient,isTransientSourceError} from '../agent-team/source-recovery.mjs';
import {savedExclusionCases} from './exclusion-agent.mjs';
import {read,alive} from './state.mjs';

const schema=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const textField={type:'string',minLength:10,maxLength:1000};
const tools=[
 {name:'read_case',description:'Read verified exclusion facts, independent diagnosis and permitted retry status.',inputSchema:schema({sourceId:{type:'string',pattern:'^\\d{1,12}$'}})},
 {name:'record_action',description:'Record one evidence-bound resolution action. The host alone executes a permitted retry and preserves the original result.',inputSchema:schema({sourceId:{type:'string',pattern:'^\\d{1,12}$'},basisHash:{type:'string'},action:{type:'string',enum:['retry_once','wait_for_change','needs_evidence']},reason:textField,nextCheck:textField})}
];
const instructions=`You are Cream's independent exclusion resolution agent. Read each case before recording an action. Handle the KREAM and POIZON findings separately. When retryAllowed is true, choose retry_once to actively test bounded alternate manufacturer-code searches, an explicit market option label, and refreshed stock, price and margin evidence. The host invokes the existing exact-model, exact-option, margin and independent product review pipeline; it cannot override those checks. When retryAllowed is false, choose wait_for_change or needs_evidence and state what remains missing. Never claim an exclusion was resolved merely by writing a plan. Never change source code, identity rules, stock, prices, account state, or user STOP. Never purchase. Respond briefly in Korean.`;
const interval={EXACT_MARKET_MODEL_NOT_FOUND:24*3600000,POIZON_EXACT_MODEL_NOT_FOUND:24*3600000,AVAILABLE_OPTION_NOT_BOUND:12*3600000,POIZON_AVAILABLE_OPTION_NOT_BOUND:12*3600000,NO_POSITIVE_MARGIN_IN_BOUND_AVAILABLE_OPTIONS:6*3600000,POIZON_NO_POSITIVE_MARGIN:6*3600000};
const log=(dir,event)=>fs.appendFileSync(path.join(dir,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),...event})+'\n');
function observedAt(batchDir,sourceId){const dir=path.join(batchDir,'source-evidence',sourceId);if(!fs.existsSync(dir))return 0;return Math.max(0,...fs.readdirSync(dir).filter(f=>/^[\w-]+\.json$/.test(f)).map(f=>Date.parse(read(path.join(dir,f))?.observedAt)||0));}
function explicitOptionOpportunity(item){
 if(item.facts.kream.code!=='AVAILABLE_OPTION_NOT_BOUND')return 0;
 const dir=path.join(item.batchDir,'source-evidence',item.facts.sourceId);if(!fs.existsSync(dir))return 0;
 const evidence=fs.readdirSync(dir).filter(f=>/^[\w-]+\.json$/.test(f)).map(f=>read(path.join(dir,f))),stock=evidence.find(e=>e.cmd==='stock:check')?.data,prices=evidence.find(e=>e.cmd==='market:kream:prices')?.data?.prices;
 if(!stock||!Array.isArray(prices))return 0;
 return stock.combinedOptions?.filter(o=>o.isAvailable!==false&&o.limitedQty>0&&rankingSizeMatch(stock,{prices},o.size,{allowExplicitMarketOption:true,sourceFirstOption:o.firstOption})?.evidence.kind==='same-market-option-label').length||0;
}
function retryPolicy(item,previous,now){
 const codes=[item.facts.kream.code,item.facts.poizon.code],delay=Math.max(...codes.map(c=>interval[c]||0));
 const first=observedAt(item.batchDir,item.facts.sourceId),last=Date.parse(previous?.attemptedAt)||first;
 const transient=previous?.status==='needs_attention'&&isTransientSourceError(previous.retry?.reason);
 const retryAt=transient?last+300000:Math.max(last+Math.max(delay,3600000),Date.parse(previous?.retryAt)||0);
 const lookupFailed=item.sourceRow?.lookupFailed===true||Object.values(item.sourceRow?.marketChecks||{}).some(c=>c.lookupFailed===true);
 const allowed=Boolean(first)&&(!previous||now>=retryAt)&&(lookupFailed||item.facts.confidence==='partial'||delay>0)&&!previous?.retry?.inProgress;
 return {retryAllowed:allowed,retryAt:new Date(retryAt||now).toISOString(),lookupFailed,previousAttempt:previous?.attemptedAt||null};
}
export function resolutionCases(batchDirs,diagnosticDirs=[]){
 return savedExclusionCases(batchDirs).map(item=>{
  const batchDir=batchDirs.find(dir=>path.basename(dir)===item.batchId),sourceState=read(path.join(batchDir,'source-state.json'));
  const sourceRow=sourceState.results.find(r=>String(r.sourceId)===item.facts.sourceId);
  const diagnosis=diagnosticDirs.map(dir=>read(path.join(dir,'cases',item.facts.sourceId+'.json'))).find(d=>d?.batchId===item.batchId&&d.facts?.basisHash===item.facts.basisHash&&d.agent?.status==='complete');
  return {...item,batchDir,sourceRow,diagnosis:diagnosis?.agent||null,explicitOptionOpportunity:explicitOptionOpportunity({...item,batchDir})};
 });
}
export async function retryExcludedSource(item,{root,outDir,stopCheck=()=>false,collect=collectRankingCandidate,review=runBatch,client=new BackgroundClient(),retryDelays=[2000,5000,10000,30000]}={}){
 if(stopCheck())throw Error('RESOLUTION_STOP_REQUESTED');
 const source=(read(path.join(item.batchDir,'sources.json'))||[]).find(s=>String(s.productId)===item.facts.sourceId);
 if(!source)throw Error('EXCLUSION_SOURCE_NOT_FOUND');
 const dir=path.join(outDir,'rechecks',item.facts.sourceId+'-'+Date.now());
 fs.mkdirSync(dir,{recursive:true});
 writeJsonAtomic(path.join(dir,'sources.json'),[source]);
 const watch=setInterval(()=>{if(stopCheck())fs.writeFileSync(path.join(dir,'STOP'),'user stop');},500);
 try{
  const memory=read(path.join(root,'musinsa-discovery','state.json'))||{};
  const safeClient=recoveringClient(client,{stopped:stopCheck,delays:retryDelays});
  const result=await collect(source,{client:safeClient,seenKreamIds:new Set(memory.seenKreamIds||[]),searchVariants:true,allowExplicitMarketOption:true,onEvidence:async(cmd,payload,data)=>{
   const evidenceDir=path.join(dir,'source-evidence',item.facts.sourceId);fs.mkdirSync(evidenceDir,{recursive:true});
   writeJsonAtomic(path.join(evidenceDir,Date.now()+'-'+fs.readdirSync(evidenceDir).length+'.json'),{cmd,payload,data,observedAt:new Date().toISOString()});
  }});
  if(stopCheck())throw Error('RESOLUTION_STOP_REQUESTED');
  if(result.status==='skipped')return {status:'still_excluded',reason:result.reason||null,reviewed:false,batchDir:dir};
  if(result.status!=='collected')throw Error('INVALID_RECHECK_RESULT');
  const packet=validatePacket(result.packet);writeJsonAtomic(path.join(dir,'source-'+item.facts.sourceId+'.json'),packet);
  const seenNow=new Set((read(path.join(root,'musinsa-discovery','state.json'))||{}).seenKreamIds||[]);
  if(packet.offers.some(o=>seenNow.has(o.market==='poizon'?'poizon-'+o.poizonId:o.kreamId)))return {status:'still_excluded',reason:'DUPLICATE_MARKET_PRODUCT',reviewed:false,batchDir:dir};
  const payloads=new Map(packet.observations.filter(o=>o.kind==='no1_product').map(o=>[JSON.stringify(o.payload.request),o.payload]));
  const assessed=await review({dir,seeds:packet.offers,concurrency:2,analysisProfile:'musinsa-ranking',mode:'live',collect:async seed=>{
   const payload=payloads.get(JSON.stringify(seed));if(!payload)throw Error('RESOLUTION_PACKET_MISSING');return structuredClone(payload);
  }});
  const reviewed=assessed.status==='complete'&&assessed.results?.length>0&&assessed.results.every(row=>verifiedResult(dir,row));
  return {status:reviewed?'recovered':'needs_attention',reason:reviewed?null:'INDEPENDENT_REVIEW_INCOMPLETE',reviewed:Boolean(reviewed),batchDir:dir,productIds:reviewed?assessed.results.map(r=>r.productId):[]};
 }finally{clearInterval(watch);}
}
export async function resolveCases({cases,outDir,root,serverFactory=options=>new CodexServer(options),retry=retryExcludedSource,stopCheck=()=>false,now=Date.now(),maxCases=2}={}){
 fs.mkdirSync(path.join(outDir,'cases'),{recursive:true});
 const ready=cases.filter(item=>item.diagnosis).map(item=>{
  const file=path.join(outDir,'cases',item.facts.sourceId+'.json'),prior=read(file);
  return {...item,prior,policy:retryPolicy(item,prior,now)};
 }).filter(item=>item.prior?.basisHash!==item.facts.basisHash||item.policy.retryAllowed&&item.prior?.status!=='recovered'&&item.prior?.status!=='needs_evidence')
  .sort((a,b)=>(b.explicitOptionOpportunity||0)-(a.explicitOptionOpportunity||0)||Number(b.facts.kream.code==='AVAILABLE_OPTION_NOT_BOUND')-Number(a.facts.kream.code==='AVAILABLE_OPTION_NOT_BOUND')||a.batchId.localeCompare(b.batchId)||a.facts.sourceId.localeCompare(b.facts.sourceId)).slice(0,maxCases);
 if(!ready.length)return summary(cases,outDir);
 const model=defaultModel('deepReviewer');let server,threadId=null,active=new Map(),readIds=new Set(),responseModel=model.model;
 try{
  server=serverFactory({cwd:outDir,config:{'agents.enabled':false},onTool:async call=>{
   if(stopCheck())throw Error('RESOLUTION_STOP_REQUESTED');
   const args=typeof call.arguments==='string'?JSON.parse(call.arguments):call.arguments||{},item=active.get(args.sourceId);
   if(call.threadId!==threadId||!item)throw Error('RESOLUTION_CASE_OUT_OF_SCOPE');
   if(call.tool==='read_case'){readIds.add(args.sourceId);return {facts:item.facts,diagnosis:item.diagnosis,policy:item.policy,previous:item.prior||null};}
   if(call.tool!=='record_action')throw Error('UNKNOWN_RESOLUTION_TOOL');
   if(!readIds.has(args.sourceId)||args.basisHash!==item.facts.basisHash)throw Error('RESOLUTION_BASIS_NOT_READ');
   if(!['retry_once','wait_for_change','needs_evidence'].includes(args.action)||args.action==='retry_once'&&!item.policy.retryAllowed)throw Error('RESOLUTION_ACTION_NOT_ALLOWED');
   if(typeof args.reason!=='string'||args.reason.trim().length<10||typeof args.nextCheck!=='string'||args.nextCheck.trim().length<10)throw Error('RESOLUTION_EXPLANATION_REQUIRED');
   const file=path.join(outDir,'cases',args.sourceId+'.json'),saved={sourceId:args.sourceId,batchId:item.batchId,basisHash:item.facts.basisHash,model:responseModel,threadId,action:args.action,reason:args.reason.trim(),nextCheck:args.nextCheck.trim(),status:args.action==='retry_once'?'rechecking':args.action,recordedAt:new Date().toISOString(),retryAt:args.action==='wait_for_change'?new Date(now+Math.max(...[item.facts.kream.code,item.facts.poizon.code].map(code=>interval[code]||3600000))).toISOString():item.policy.retryAt};
   writeJsonAtomic(file,saved);log(outDir,{type:'action_saved',sourceId:args.sourceId,action:args.action});
   if(args.action==='retry_once'){
    try{saved.attemptedAt=new Date().toISOString();writeJsonAtomic(file,saved);saved.retry=await retry(item,{root,outDir,stopCheck});saved.status=saved.retry.status;}
    catch(error){saved.status='needs_attention';saved.retry={status:'needs_attention',reason:error.message};}
    writeJsonAtomic(file,saved);log(outDir,{type:'retry_finished',sourceId:args.sourceId,status:saved.status});
   }
   return {saved:true,status:saved.status};
  }});
  await server.start();
  for(const group of groupByBatch(ready)){
   if(stopCheck())throw Error('RESOLUTION_STOP_REQUESTED');
   active=new Map(group.map(item=>[item.facts.sourceId,item]));readIds=new Set();
   const response=await server.startThread({instructions,tools,...model,config:{'agents.enabled':false}});threadId=response.thread.id;responseModel=response.model||model.model;
   await server.runTurn(threadId,JSON.stringify({task:'Read each case and record one permitted resolution action. Actively retry when permitted. Do not claim success without a completed recheck and independent review.',sourceIds:group.map(c=>c.facts.sourceId)}),{timeoutMs:900000});
   const missing=group.filter(c=>read(path.join(outDir,'cases',c.facts.sourceId+'.json'))?.basisHash!==c.facts.basisHash);
   if(missing.length)throw Error('RESOLUTION_CASES_INCOMPLETE:'+missing.map(c=>c.facts.sourceId).join(','));
  }
 }catch(error){log(outDir,{type:'resolution_error',error:error.message});throw error;}
 finally{await server?.close();}
 return summary(cases,outDir);
}
function groupByBatch(cases){return cases.map(item=>[item]);}
function summary(cases,outDir){const counts={};for(const c of cases){const status=read(path.join(outDir,'cases',c.facts.sourceId+'.json'))?.status||'pending';counts[status]=(counts[status]||0)+1;}const result={total:cases.length,counts,updatedAt:new Date().toISOString()};writeJsonAtomic(path.join(outDir,'summary.json'),result);return result;}
export async function resolveRun(runDir,options={}){
 const state=read(path.join(runDir,'state.json'));if(!state||state.mission?.source!=='musinsa-ranking'||!Array.isArray(state.batches))throw Error('MUSINSA_HERDR_RUN_REQUIRED');
 const dirs=state.batches.filter(b=>/^batch-[a-f0-9-]{36}$/.test(b.runId)).map(b=>path.join(state.root,b.runId));
 const cases=resolutionCases(dirs,[path.join(runDir,'exclusion-diagnostics'),...dirs.map(d=>path.join(d,'exclusion-diagnostics'))]);
 return resolveCases({cases,outDir:path.join(runDir,'exclusion-resolution'),root:state.root,stopCheck:()=>fs.existsSync(path.join(runDir,'STOP')),...options});
}
export async function watchResolution(runDir,{intervalMs=60000,...options}={}){
 const lock=path.join(runDir,'exclusion-resolution.lock'),old=read(lock);
 if(alive(old?.pid))throw Error('RESOLUTION_ALREADY_RUNNING');
 if(fs.existsSync(lock))fs.rmSync(lock,{force:true});
 fs.writeFileSync(lock,JSON.stringify({pid:process.pid,at:new Date().toISOString()}),{flag:'wx'});
 try{while(!fs.existsSync(path.join(runDir,'STOP'))){
  try{await resolveRun(runDir,options);}catch(error){const dir=path.join(runDir,'exclusion-resolution');fs.mkdirSync(dir,{recursive:true});log(dir,{type:'watch_error',error:error.message});}
  await new Promise(resolve=>setTimeout(resolve,intervalMs));
 }}
 finally{if(read(lock)?.pid===process.pid)fs.rmSync(lock,{force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const arg=process.argv.find(x=>x.startsWith('--dir='))?.slice(6);if(!arg)throw Error('RUN_DIRECTORY_REQUIRED');
 const task=process.argv.includes('--watch')?watchResolution:resolveRun;
 task(path.resolve(arg)).then(result=>{if(result)console.log(JSON.stringify(result));}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
