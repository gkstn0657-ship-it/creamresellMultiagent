import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CodexServer} from '../agent-team/app-server.mjs';
import {digest} from '../agent-team/store.mjs';
import {writeJsonAtomic as write} from '../agent-team/atomic-json.mjs';
import {cases,variants,rubric} from './cases.mjs';
const arg=n=>process.argv.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const dir=path.resolve(arg('out')||'kream-runs/model-placement-20261126');fs.mkdirSync(dir,{recursive:true});
const selectedCases=arg('case')?cases.filter(c=>c.id===arg('case')):cases;if(!selectedCases.length)throw Error('UNKNOWN_CASE');
const schema=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const tools=[{name:'read_evidence',description:'Read one original evidence record by ID.',inputSchema:schema({id:{type:'string'}})},
 {name:'submit',description:'Record the final control action, product judgment or independent review.',inputSchema:schema({action:{type:'string'},issues:{type:'array',items:{type:'string'}},basis:{type:'array',items:{type:'string'}},purchaseAuthorized:{type:'boolean'},reason:{type:'string'}})}];
const plan={version:2,mode:'synthetic',repeats:2,concurrency:2,variants,cases:selectedCases.map(c=>({id:c.id,role:c.role,difficulty:c.difficulty})),suiteHash:digest({cases:selectedCases,rubric,tools}),callLimit:selectedCases.length*8,timeoutMs:90000,selectionRule:'Per role: require 4/4 exact action+issues, all-original reads and no purchase authorization. Prefer fastest eligible variant only if >=15% faster than current default. Keep Sol/high adoption-review floor; do not infer real-profit accuracy or dollar costs.'};
const planFile=path.join(dir,'plan.json');if(fs.existsSync(planFile)&&JSON.parse(fs.readFileSync(planFile)).suiteHash!==plan.suiteHash)throw Error('EXPERIMENT_SUITE_CHANGED');write(planFile,plan);
const contexts=new Map();
const server=new CodexServer({cwd:dir,config:{'agents.enabled':false},onTool:async p=>{
 const ctx=contexts.get(p.threadId);if(!ctx)throw Error('UNKNOWN_EXPERIMENT_THREAD');if(++ctx.toolCalls>12)throw Error('EXPERIMENT_TOOL_LIMIT');const a=p.arguments||{};
 if(p.tool==='read_evidence'){const record=ctx.case.evidence.find(e=>e.id===a.id);if(!record)throw Error('UNKNOWN_EVIDENCE');ctx.reads.add(a.id);return record;}
 if(p.tool==='submit'){if(ctx.answer)throw Error('ALREADY_SUBMITTED');ctx.answer=a;ctx.readsAtSubmit=[...ctx.reads];return {recorded:true};}
 throw Error('EXPERIMENT_TOOL_FORBIDDEN');
}});
server.on('notification',m=>{if(m.method==='thread/tokenUsage/updated'){const ctx=contexts.get(m.params.threadId);if(ctx)ctx.tokenUsage=m.params.tokenUsage;}});
const jobs=[];for(let repeat=0;repeat<2;repeat++)for(let ci=0;ci<selectedCases.length;ci++)for(let vi=0;vi<variants.length;vi++)jobs.push({repeat,case:selectedCases[ci],variant:variants[(vi+ci+repeat)%variants.length]});
const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
let next=0;
try{
 await server.start();
 await Promise.all(Array.from({length:2},async()=>{while(next<jobs.length){
  const job=jobs[next++],id=`${job.case.id}--${job.variant.id}--${job.repeat}`,file=path.join(dir,id+'.json');if(fs.existsSync(file))continue;
  const ctx={case:job.case,reads:new Set(),toolCalls:0},started=Date.now();let response,error;
  try{response=await server.startThread({instructions:rubric,tools,model:job.variant.model,effort:job.variant.effort,config:{'agents.enabled':false}});contexts.set(response.thread.id,ctx);
    await server.runTurn(response.thread.id,JSON.stringify({role:job.case.role,task:job.case.task,proposal:job.case.proposal,evidenceIds:job.case.evidence.map(e=>e.id)}),{timeoutMs:90000});
  }catch(e){error=e.message;}
  const answer=ctx.answer,readAll=same(ctx.readsAtSubmit||[],job.case.evidence.map(e=>e.id));
  const checks={action:answer?.action===job.case.gold.action,issues:Array.isArray(answer?.issues)&&same(answer.issues,job.case.gold.issues),readAll,basis:Array.isArray(answer?.basis)&&same(answer.basis,job.case.evidence.map(e=>e.id)),noPurchase:answer?.purchaseAuthorized===false,completed:!error,effectiveModel:response?.model===job.variant.model};
  const row={id,caseId:job.case.id,role:job.case.role,difficulty:job.case.difficulty,repeat:job.repeat,variant:job.variant,requestedModel:job.variant.model,effectiveModel:response?.model||null,elapsedMs:Date.now()-started,toolCalls:ctx.toolCalls,reads:[...ctx.reads],answer,error:error||null,tokenUsage:ctx.tokenUsage||null,checks,passed:Object.values(checks).every(Boolean)};
  write(file,row);console.log(JSON.stringify({id,passed:row.passed,elapsedMs:row.elapsedMs,error:row.error}));
 }}));
}finally{await server.close();}
const rows=jobs.map(j=>JSON.parse(fs.readFileSync(path.join(dir,`${j.case.id}--${j.variant.id}--${j.repeat}.json`))));
const median=a=>{a=[...a].sort((x,y)=>x-y);const n=a.length;return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;};
const summary={suiteHash:plan.suiteHash,total:rows.length,groups:[]};
for(const role of ['coordinator','owner','reviewer'])for(const variant of variants){const r=rows.filter(x=>x.role===role&&x.variant.id===variant.id);if(!r.length)continue;summary.groups.push({role,variant:variant.id,passed:r.filter(x=>x.passed).length,total:r.length,medianMs:median(r.map(x=>x.elapsedMs)),failures:r.filter(x=>!x.passed).map(x=>({id:x.id,checks:x.checks,error:x.error}))});}
write(path.join(dir,'summary.json'),summary);console.log(JSON.stringify(summary));
