import fs from 'node:fs';import path from 'node:path';
import {alive} from '../../herdr-runtime/state.mjs';
import {modelPolicy} from '../model-routing.mjs';
import {agentActivity} from './agent-activity.mjs';
import {verifiedResult} from '../../herdr-runtime/backend.mjs';
import {resultDetails} from './result-data.mjs';
const read=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return null;}};
const pid=f=>{try{return alive(Number(fs.readFileSync(f,'utf8')));}catch{return false;}};
const list=d=>{try{return fs.readdirSync(d);}catch{return [];}};
export function continuousRuns(root){return list(path.join(root,'work-orders')).filter(n=>/^work-[a-f0-9-]{36}\.json$/.test(n)).flatMap(n=>{const w=read(path.join(root,'work-orders',n));if(!w?.continuous)return [];const s=read(path.join(root,'explorations',w.id,'state.json'))||{};return [{id:w.id,status:w.status==='stopped'?'stopped':s.status||'ready',source:'continuous-ranking',target:null,updatedAt:w.createdAt,continuous:true}];});}
export function continuousData(root,id,runs){
 const work=read(path.join(root,'work-orders',id+'.json'));if(!work?.continuous)throw Error('RUN_NOT_FOUND');
 const dir=path.join(root,'explorations',id),s=read(path.join(dir,'state.json'))||{},live=pid(path.join(dir,'continuous.lock')),terminal=work.status==='stopped',status=terminal?'stopped':s.status||'ready';
 const batchIds=[...new Set([...(work.entries||[]),...(s.batches||[]),{runId:s.currentRunId}].map(b=>b.runId).filter(b=>/^batch-[a-f0-9-]{36}$/.test(b)))];
 const agents=[{id:'supervisor:'+id,role:'supervisor',status:terminal?'finished':!live?'offline':status==='waiting_for_retry'?'quiet':'working',live,model:null,phase:status,events:[],message:s.waitReason||null},
 {id:'collector:'+id,role:'worker',status:terminal?'finished':!live?'offline':status==='discovering'?'working':'idle',live,model:null,phase:status,currentTool:status==='discovering'?'collect_no1':null,productId:s.currentSource?.productId,productName:s.currentSource?.productName,events:[]}];
 const batches=batchIds.map(runId=>{const base=path.join(root,runId),b=read(path.join(base,'batch-state.json'))||{};const products=list(path.join(base,'judgments')).filter(n=>/^(?:\d{1,12}|poizon-\d{1,18})$/.test(n)).flatMap(productId=>{const teamDir=path.join(base,'judgments',productId),t=read(path.join(teamDir,'team-state.json'));if(!t)return [];const teamLive=pid(path.join(teamDir,'runtime.lock'));
 for(const a of t.actors||[])agents.push({...agentActivity({id:a.threadId,role:a.role,model:{model:a.effectiveModel||a.requestedModel||a.model,effort:a.effort},events:(t.events||[]).filter(e=>e.threadId===a.threadId),live:teamLive,terminal:t.status==='complete'||(t.reviews||[]).some(r=>r.threadId===a.threadId),retired:a.role==='owner_retired'}),productId,runId});
 let verified=false;try{verified=verifiedResult(base,(b.results||[]).find(r=>r.productId===productId)||{});}catch{}
 return [{productId,details:resultDetails(t,(b.results||[]).find(r=>r.productId===productId)),status:t.status,decision:t.assessment?.decision,reason:t.assessment?.reason,verified,model:t.ownerModel,actors:[],upgrades:t.modelUpgradeCount||0}];});return {runId,status:b.status||'pending',alive:alive(read(path.join(base,'process.json'))?.pid),products,sources:[],error:b.error};});
 return {runs,selected:id,continuous:true,engine:'continuous',agents,observedAt:new Date().toISOString(),policy:modelPolicy.defaults,mission:{instruction:work.userInstruction,source:'무신사 연속 탐색',targetProducts:null,maxTurns:null},status,controllerAlive:live,stopping:fs.existsSync(path.join(dir,'STOP')),trusted:true,turns:null,model:null,error:s.error||s.waitReason||null,completed:s.checkedSources||0,reviewed:batches.flatMap(b=>b.products).filter(p=>p.verified).length,skipped:s.skipped?.length||0,batches,events:[],canStop:!terminal,canResume:false,current:s.currentSource};
}
