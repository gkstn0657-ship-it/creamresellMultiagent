import fs from 'node:fs';import path from 'node:path';import {digest} from './store.mjs';
export function batchEvents(root){
 if(!fs.existsSync(root))return [];
 const events=[];
 for(const runId of fs.readdirSync(root).filter(x=>/^batch-[a-f0-9-]{36}$/.test(x))){
  const file=path.join(root,runId,'batch-state.json');if(!fs.existsSync(file))continue;
  let state;try{state=JSON.parse(fs.readFileSync(file,'utf8'));}catch{continue;}
  if(state.mode!=='live')continue;
  if(['collecting','judging'].includes(state.status)){
    try{const proc=JSON.parse(fs.readFileSync(path.join(root,runId,'process.json'),'utf8'));process.kill(proc.pid,0);continue;}catch{}
    state={...state,status:'needs_attention',error:'WORKER_NOT_RUNNING'};
  }
  if(!['complete','needs_attention','stopped'].includes(state.status))continue;
  const rows=state.results||[];
  const data={runId,status:state.status,productCount:state.productCount||0,judged:state.judged||0,adopt:rows.filter(r=>r.assessment?.decision==='adopt').length,hold:rows.filter(r=>r.assessment?.decision==='hold').length,exclude:rows.filter(r=>r.assessment?.decision==='exclude').length,error:state.error?.slice(0,500)||null,mode:'live'};
  const timestamp=state.finishedAt||state.startedAt;
  events.push({eventId:'evt-'+digest([data,timestamp]),name:'cream.batch.finished',timestamp,data,cursor:null});
 }
 return events;
}
