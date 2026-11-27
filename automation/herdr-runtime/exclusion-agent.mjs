import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {CodexServer} from '../agent-team/app-server.mjs';
import {defaultModel} from '../agent-team/model-routing.mjs';
import {writeJsonAtomic} from '../agent-team/atomic-json.mjs';
import {exclusionFacts} from './exclusion-facts.mjs';
import {read} from './state.mjs';

const schema=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const textField={type:'string',minLength:1,maxLength:1200};
const tools=[
 {name:'read_case',description:'Read one source exclusion, both market-specific saved evidence conclusions, and the immutable evidence basis. No network request.',inputSchema:schema({sourceId:{type:'string',pattern:'^\\d{1,12}$'}})},
 {name:'record_diagnosis',description:'Save a concise Korean explanation and next evidence check for a case already read. The host preserves verified reason codes and evidence references separately.',inputSchema:schema({sourceId:{type:'string',pattern:'^\\d{1,12}$'},basisHash:{type:'string'},summary:textField,nextCheck:textField})}
];
const instructions=`You are Cream's independent source-exclusion diagnostician. Use read_case for every assigned source and record_diagnosis for each. The saved case contains deterministic facts reconstructed from immutable No1 background responses or recorded per-market checks. Explain the KREAM and POIZON outcomes separately in Korean. A search failure is limited to the observed search pages; never claim that a product does not exist anywhere. A missing exact size/color binding is unknown eligibility, not evidence of no stock or no profit. Never label a skipped source an AI-reviewed rejection. If confidence is partial, say that the detailed cause cannot be confirmed from saved evidence and name the missing check. Cite only facts and evidence IDs returned by read_case. Give one practical next evidence check; do not run a network request, change source code, purchase, alter filters, or restart sourcing. Finish only after every assigned case is recorded.`;
const log=(dir,event)=>fs.appendFileSync(path.join(dir,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),...event})+'\n');

export function savedExclusionCases(batchDirs){
 const cases=[];
 for(const dir of batchDirs){
  const sources=read(path.join(dir,'sources.json'))||[],state=read(path.join(dir,'source-state.json'))||{};
  if(!Array.isArray(sources)||!Array.isArray(state.results))continue;
  for(const row of state.results.filter(r=>r.status==='skipped')){
   const source=sources.find(s=>String(s.productId)===String(row.sourceId));if(!source)throw Error('EXCLUSION_SOURCE_NOT_FOUND');
   cases.push({batchId:path.basename(dir),facts:exclusionFacts(dir,source,row)});
  }
 }
 return cases;
}
export async function diagnoseCases({cases,outDir,serverFactory=options=>new CodexServer(options),onProgress=()=>{},stopCheck=()=>false}={}){
 fs.mkdirSync(path.join(outDir,'cases'),{recursive:true});
 const pending=cases.filter(c=>{
  const saved=read(path.join(outDir,'cases',c.facts.sourceId+'.json'));
  return saved?.facts?.basisHash!==c.facts.basisHash||saved?.agent?.status!=='complete';
 });
 for(const c of cases){const file=path.join(outDir,'cases',c.facts.sourceId+'.json');if(!fs.existsSync(file)||read(file)?.facts?.basisHash!==c.facts.basisHash)writeJsonAtomic(file,{batchId:c.batchId,facts:c.facts,agent:{status:'pending'}});}
 const model=defaultModel('deepReviewer');
 let server;
 try{
  if(pending.length){
   let active=new Map(),readIds=new Set(),threadId=null;
   server=serverFactory({cwd:outDir,config:{'agents.enabled':false},onTool:async call=>{
    if(stopCheck())throw Error('DIAGNOSTIC_STOP_REQUESTED');
    const args=typeof call.arguments==='string'?JSON.parse(call.arguments):call.arguments||{},item=active.get(args.sourceId);
    if(call.threadId!==threadId||!item)throw Error('DIAGNOSTIC_CASE_OUT_OF_SCOPE');
    if(call.tool==='read_case'){readIds.add(args.sourceId);return item.facts;}
    if(call.tool!=='record_diagnosis')throw Error('UNKNOWN_DIAGNOSTIC_TOOL');
    if(!readIds.has(args.sourceId)||args.basisHash!==item.facts.basisHash)throw Error('DIAGNOSTIC_BASIS_NOT_READ');
    if(typeof args.summary!=='string'||args.summary.trim().length<20||args.summary.length>1200||typeof args.nextCheck!=='string'||!args.nextCheck.trim()||args.nextCheck.length>1200)throw Error('DIAGNOSTIC_EXPLANATION_REQUIRED');
    const saved={batchId:item.batchId,facts:item.facts,agent:{status:'complete',threadId,model:responseModel,summary:args.summary.trim(),nextCheck:args.nextCheck.trim(),at:new Date().toISOString()}};
    writeJsonAtomic(path.join(outDir,'cases',args.sourceId+'.json'),saved);log(outDir,{type:'diagnosis_saved',sourceId:args.sourceId,basisHash:item.facts.basisHash});onProgress(saved);return {saved:true,sourceId:args.sourceId};
   }});
   await server.start();
   let responseModel=model.model;
   for(const group of groupByBatch(pending)){
    if(stopCheck())throw Error('DIAGNOSTIC_STOP_REQUESTED');
    active=new Map(group.map(c=>[c.facts.sourceId,c]));readIds=new Set();
    const response=await server.startThread({instructions,tools,...model,config:{'agents.enabled':false}});threadId=response.thread.id;responseModel=response.model||model.model;
    const ids=group.map(c=>c.facts.sourceId),message=JSON.stringify({task:'Diagnose every assigned saved exclusion using read_case then record_diagnosis. Keep each market separate and report the exact evidence limit.',sourceIds:ids});
    await server.runTurn(threadId,message,{timeoutMs:180000});
    let missing=group.filter(c=>read(path.join(outDir,'cases',c.facts.sourceId+'.json'))?.agent?.status!=='complete');
    if(missing.length){await server.runTurn(threadId,JSON.stringify({task:'Some diagnoses were not persisted. Call read_case and record_diagnosis for these source IDs now.',sourceIds:missing.map(c=>c.facts.sourceId)}),{timeoutMs:120000});missing=group.filter(c=>read(path.join(outDir,'cases',c.facts.sourceId+'.json'))?.agent?.status!=='complete');}
    if(missing.length)throw Error('DIAGNOSTIC_CASES_INCOMPLETE:'+missing.map(c=>c.facts.sourceId).join(','));
   }
  }
 }catch(error){log(outDir,{type:'diagnostic_error',error:error.message});writeSummary(cases,outDir,'needs_attention',error.message);throw error;}
 finally{await server?.close();}
 return writeSummary(cases,outDir,'complete',null);
}
function groupByBatch(cases){const groups=new Map();for(const c of cases){if(!groups.has(c.batchId))groups.set(c.batchId,[]);groups.get(c.batchId).push(c);}return [...groups.values()];}
function writeSummary(cases,outDir,status,error){
 const rows=cases.map(c=>read(path.join(outDir,'cases',c.facts.sourceId+'.json'))).filter(Boolean),counts={kream:{},poizon:{}};
 for(const row of rows)for(const market of ['kream','poizon']){const code=row.facts[market].code;counts[market][code]=(counts[market][code]||0)+1;}
 const report={status,total:cases.length,analyzed:rows.filter(r=>r.agent?.status==='complete').length,counts,error,updatedAt:new Date().toISOString()};writeJsonAtomic(path.join(outDir,'summary.json'),report);return report;
}
export async function diagnoseRun(runDir,options={}){
 const state=read(path.join(runDir,'state.json'));if(!state||state.mission?.source!=='musinsa-ranking'||!Array.isArray(state.batches))throw Error('MUSINSA_HERDR_RUN_REQUIRED');
 const dirs=state.batches.filter(b=>/^batch-[a-f0-9-]{36}$/.test(b.runId)).map(b=>path.join(state.root,b.runId));
 return diagnoseCases({cases:savedExclusionCases(dirs),outDir:path.join(runDir,'exclusion-diagnostics'),...options});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const arg=process.argv.find(x=>x.startsWith('--dir='))?.slice(6);if(!arg)throw Error('RUN_DIRECTORY_REQUIRED');
 diagnoseRun(path.resolve(arg),{onProgress:r=>console.log(JSON.stringify({sourceId:r.facts.sourceId,summary:r.agent.summary}))}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
