import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {marginReport} from './margin-report.mjs';
const ROOT=fileURLToPath(new URL('../../kream-runs/agent-teams/',import.meta.url));
const validId=id=>typeof id==='string'&&/^batch-[a-f0-9-]{36}$/.test(id);
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw Error('SAVED_DATA_UNREADABLE');}};
const alive=pid=>{if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch{return false;}};
const short=(value,n=16000)=>typeof value==='string'?value.slice(0,n):value;
const fields=(object,keys)=>Object.fromEntries(keys.filter(k=>object?.[k]!==undefined).map(k=>[k,object[k]]));
export function panelData({runId,productId}={},options={}) {
  const root=options.root||ROOT;
  if(runId!==undefined&&!validId(runId))throw Error('INVALID_RUN_ID');
  if(productId!==undefined&&!/^\d+$/.test(productId))throw Error('INVALID_PRODUCT_ID');
  const runs=(fs.existsSync(root)?fs.readdirSync(root):[]).filter(validId).map(id=>{
    const dir=path.join(root,id),state=read(path.join(dir,'batch-state.json'))||{},seeds=read(path.join(dir,'products.json'));
    if(!Array.isArray(seeds))return null;
    const workerAlive=(options.isAlive||alive)(read(path.join(dir,'process.json'))?.pid);
    const status=state.status||'starting',active=['starting','collecting','judging'].includes(status);
    return {runId:id,status:active&&!workerAlive?'interrupted':status,savedStatus:status,workerAlive,
      stopRequested:fs.existsSync(path.join(dir,'STOP')),startedAt:state.startedAt||fs.statSync(path.join(dir,'products.json')).mtime.toISOString(),
      finishedAt:state.finishedAt||null,productCount:state.productCount||new Set(seeds.map(p=>p.kreamId)).size,
      collected:state.collected||0,judged:state.judged||0,error:short(state.error||null),
      counts:{adopt:0,hold:0,exclude:0,...Object.fromEntries(['adopt','hold','exclude'].map(d=>[d,(state.results||[]).filter(r=>r.assessment?.decision===d).length]))}};
  }).filter(Boolean).sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  const selected=runs.find(r=>r.runId===(runId||runs[0]?.runId));
  if(runId&&!selected)throw Error('BATCH_NOT_FOUND');
  const result={version:'cream-dot-panel-v1',updatedAt:new Date().toISOString(),runs:runs.slice(0,50),selectedRun:selected||null,products:[],detail:null,
    policy:{backgroundOnly:true,decisionOwner:'product_ai',profitIsScenario:true},integration:{transport:'local-mcp',cloudDotConnectionVerified:false}};
  if(!selected)return result;
  const dir=path.join(root,selected.runId),seeds=read(path.join(dir,'products.json')),state=read(path.join(dir,'batch-state.json'))||{};
  for(const id of [...new Set(seeds.map(s=>s.kreamId))]) {
    const offers=seeds.filter(s=>s.kreamId===id),p=read(path.join(dir,'packets',`product-${id}.json`));
    const team=read(path.join(dir,'judgments',id,'team-state.json')),row=state.results?.find(r=>r.productId===id),assessment=team?.assessment||row?.assessment||null;
    const calculations=(team?.calculations||[]).filter(c=>c.active!==false),calc=calculations.at(-1)?.result;
    const events=team?.events||[],last=events.at(-1),observations=(team?.observations||p?.observations||[]).filter(o=>o.active!==false);
    let status=team?.status||row?.status||(p?'collected':'waiting');
    if(status==='running'&&!selected.workerAlive)status=selected.status==='stopped'?'stopped':'interrupted';
    const item={productId:id,model:offers[0].model,color:offers[0].color,options:offers.map(s=>s.option),status,
      collectionStatus:p?.collectionStatus||'pending',mode:[...new Set(observations.map(o=>o.mode))].join(', ')||'unknown',
      decision:assessment?.decision||null,reason:short(assessment?.reason||''),readiness:assessment?.readiness||null,
      unresolved:assessment?.unresolved||p?.gaps||[],observedAt:observations.map(o=>o.observedAt).filter(Boolean).sort().at(-1)||null,
      scenario:calc?{...fields(calc,['perUnit','totalEconomicProfit','totalCashProfit','quantity','missing']),inputs:calc.inputs}:null,
      margins:marginReport(observations),
      actors:(team?.actors||[]).map(a=>({...fields(a,['role','model','requestedModel','effectiveModel','effort']),lastEvent:events.filter(e=>e.threadId===a.threadId).at(-1)?.type||null})),
      lastEvent:last?fields(last,['at','type','tool','status']):null,error:short(row?.error||null),toolCalls:team?.toolCalls||0};
    result.products.push(item);
    if(id===productId)result.detail={...item,offers,assessment,calculations,
      observations:observations.map(o=>({...fields(o,['id','kind','mode','observedAt']),payload:o.payload})),
      reviews:team?.reviews||[],events:events.slice(-30).map(e=>({...fields(e,['at','type','tool','status','decision','code']),text:short(e.text,4000)}))};
  }
  if(productId&&!result.detail)throw Error('PRODUCT_NOT_IN_BATCH');
  return result;
}
