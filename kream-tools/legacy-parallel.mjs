import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {appendNaverDaily} from './legacy-daily-report.mjs';
import {fileURLToPath} from 'node:url';
import {acquireRunLock,writeJson} from '../renew/Cream/kream-tools/agents-core.mjs';

const project=fileURLToPath(new URL('../',import.meta.url));
const [runArg,upstreamArg,orderId]=process.argv.slice(2);
if(!runArg||!upstreamArg||!/^work-[a-f0-9-]{36}$/.test(orderId||''))throw Error('run folder, upstream folder and order id required');
const run=path.resolve(runArg),upstream=path.resolve(upstreamArg);
const initial=JSON.parse(fs.readFileSync(path.join(run,'naver-live.json'),'utf8'));
const lockDir=path.join(run,'supervision');fs.mkdirSync(lockDir,{recursive:true});
const unlock=acquireRunLock(lockDir);process.on('exit',unlock);
const read=(dir,name,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}};
let notePending=false;
async function updateWorkflowNote(){
  if(notePending||!fs.existsSync(path.join(project,'kream-tools','legacy-workflow-note.mjs')))return;
  notePending=true;
  try{const {writeVerifiedWorkflowNote}=await import('./legacy-workflow-note.mjs');await writeVerifiedWorkflowNote(project,active);}
  catch(error){console.error('작업방식 기록 점검:',error.message);}
  finally{notePending=false;}
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state={...initial,startedAt:new Date().toISOString(),pid:process.pid,upstreamWorkId:orderId,completedBatches:initial.completedBatches||[],activeBatch:initial.activeBatch||'.'};
let active=path.join(run,state.activeBatch);
const ledger=(status,stage,reason='')=>{
  const dir=active,files=fs.readdirSync(dir);
  const stageData=read(dir,'stage.json',{}),registered=read(dir,'k50-ids.json',[]);
  Object.assign(state,{status,stage,reason,updatedAt:new Date().toISOString(),target:registered.length+state.completedBatches.filter(x=>x.folder!==state.activeBatch).reduce((n,x)=>n+x.ids.length,0),
      activeStage:stageData.stage||null,kreamCaptured:files.filter(f=>/^dump-K\d+\.json$/.test(f)).length,naverCaptured:files.filter(f=>/^dump-N\d+-s\.json$/.test(f)).length,
      collectedBatches:state.completedBatches.length});
  writeJson(run,'naver-live.json',state);
};
const source=(used)=>{
  const order=read(path.join(upstream,'work-orders'),orderId+'.json');
  if(!order)throw Error('upstream order unavailable');
  const result=[];
  for(const entry of order.entries||[]){
    if(!/^batch-[a-f0-9-]{36}$/.test(entry.runId))continue;
    for(const seed of read(path.join(upstream,entry.runId),'products.json',[])){
      if(!['clothing','accessories'].includes(seed.category)||!/^[1-9]\d*$/.test(String(seed.kreamId))||used.has(String(seed.kreamId)))continue;
      used.add(String(seed.kreamId));result.push(Number(seed.kreamId));if(result.length===8)return result;
    }
  }
  return result;
};
async function runBatch(){
  const args=[path.join(project,'kream-tools','run-all.mjs'),active,'--public-product','--relay-dir='+run];
  const fd=fs.openSync(path.join(active,'driver.log'),'a');
  let child;
  try{child=spawn(process.execPath,args,{cwd:project,stdio:['ignore',fd,fd],windowsHide:true});}
  finally{fs.closeSync(fd);}
  state.driverPid=child.pid;ledger('running','수집 준비');
  const ticker=setInterval(()=>{try{const s=read(active,'stage.json',{});ledger(s.status==='failed'?'blocked':'running',s.stage||'수집 준비',s.error||'');void updateWorkflowNote();}catch{}},8000);
  try{const code=await new Promise((done,fail)=>{child.once('error',fail);child.once('close',done);});if(code)throw Error(read(active,'stage.json',{}).error||'실행 중단 · driver.log 확인');}
  finally{clearInterval(ticker);delete state.driverPid;}
}
try{
 while(true){
  if(fs.existsSync(path.join(run,'STOP')))throw Error('릴레이 STOP 감지 · 원인 확인 전 수집 중지');
  if(!state.completedBatches.some(x=>x.folder===state.activeBatch)){
    await runBatch();
    const navEvidence=read(active,'n-cards.json',{});
    if(!Object.values(navEvidence).some(x=>x.inspectedSlots>0))throw Error('네이버 검색결과 카드 미확인 · 다음 후보에 앞서 원인 점검');
    await updateWorkflowNote();
    await appendNaverDaily(project,active);
    state.completedBatches.push({folder:state.activeBatch,ids:read(active,'k50-ids.json',[]),finishedAt:new Date().toISOString()});
  }
  const used=new Set(state.completedBatches.flatMap(x=>x.ids.map(String)));
  const next=source(used);
  if(!next.length){
    const s=read(path.join(upstream,'explorations',orderId),'state.json',{});
    if(['complete','stopped','source_exhausted'].includes(s.status)){ledger('completed','탐색 완료');break;}
    ledger('running','다음 의류·잡화 후보 대기');await wait(15000);continue;
  }
  state.activeBatch='batch-'+String(state.completedBatches.length+1).padStart(4,'0')+'-public';active=path.join(run,state.activeBatch);
  fs.mkdirSync(active,{recursive:true});writeJson(active,'k50-ids.json',next);ledger('running','다음 후보 배정');
 }
}catch(error){
 const reason=String(error.message).slice(0,420);
 ledger('blocked','수집 중지',reason);
 try{await appendNaverDaily(project,active,reason);}catch(reportError){console.error(reportError.message)}
 console.error(reason);process.exitCode=1;
}
