import {analysisProfile,MUSINSA_PROFILE,MUSINSA_MESSAGE,MUSINSA_OWNER,MUSINSA_REVIEWER} from './analysis-profiles.mjs';
import {saveMusinsaSignals} from './musinsa-signals.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {CodexServer} from './app-server.mjs';
import {TeamStore,proposalHash,digest} from './store.mjs';
import {TeamTools,ownerTools,reviewTools} from './tools.mjs';
import {OWNER,REVIEWER,MODELS,reviewModel,GENERAL_PACKET_MESSAGE} from './roles.mjs';
import {startEvidenceServer} from './evidence-server.mjs';
import {validatePacket} from './packets.mjs';
import {offerProductId} from './market-offer.mjs';
import {sourceAvailability, SourceAvailabilityReview} from './source-availability.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));

function loadPacket(store,packet) {
  if(packet.productId!==offerProductId(store.data.mission?.product||{}))throw Error('PACKET_MISSION_MISMATCH');
  const originals=[...packet.observations];
  if(!originals.some(o=>o.kind==='collection_summary'))originals.push({kind:'collection_summary',
    payload:{productId:packet.productId,offers:packet.offers,sourceQuotes:packet.sourceQuotes||[],gaps:packet.gaps,collectionStatus:packet.collectionStatus},
    mode:originals[0].mode,observedAt:packet.collectedAt});
  if(store.data.packetId===packet.id){
    const saved=store.data.observations.filter(row=>row.active!==false);
    const complete=originals.every((o,i)=>saved[i]?.kind===o.kind && saved[i].mode===o.mode &&
      saved[i].observedAt===o.observedAt && digest(saved[i].payload)===digest(o.payload));
    if(complete)return;
  }
  const entries=originals.map(o=>store.createObservation(o.kind,o.payload,{mode:o.mode,observedAt:o.observedAt}));
  for(const old of [...store.data.observations,...store.data.calculations])old.active=false;
  store.data.observations.push(...entries);
  store.data.assessment=null;
  if(store.data.packetId!==packet.id)store.data.materialReviewConflict=false;
  store.data.packetMode=packet.observations.every(x=>x.mode!=='live')?'offline':'live';
  store.data.packetId=packet.id;
  store.save();
}

export async function ensureReviewRecorded({store,server,threadId,expectedBasis,stopped=()=>false}){
  let review=store.data.reviews.findLast(x=>x.threadId===threadId);
  if(!review){
    if(stopped())throw Error('STOP_REQUESTED');
    if(store.basis()!==expectedBasis)throw Error('REVIEW_BASIS_CHANGED');
    await server.runTurn(threadId,'The review was NOT saved. Your previous text did not call record_review. Call record_review now with your independent verdict, issues, and the evidence IDs you actually read. A prose reply does not persist a review. Do not invent IDs or report success without a successful tool result.',{timeoutMs:60000});
    review=store.data.reviews.findLast(x=>x.threadId===threadId);
  }
  if(!review)throw Error('REVIEW_NOT_RECORDED');
  if(review.basis!==store.basis())throw Error('REVIEW_BASIS_CHANGED');
  return review;
}
export async function runTeam({dir,mission,packet=null,resume=false,replay=null,message=null,timeoutMs=300000,onEvent=()=>{},serverFactory=options=>new CodexServer(options)}={}) {
  dir=path.resolve(dir);fs.mkdirSync(dir,{recursive:true});
  if(packet)validatePacket(packet);
  const lock=path.join(dir,'runtime.lock');
  if(fs.existsSync(lock)) {
    const pid=Number(fs.readFileSync(lock,'utf8'));let alive=false;
    try{process.kill(pid,0);alive=true;}catch{}
    if(alive)throw Error('TEAM_ALREADY_RUNNING');fs.unlinkSync(lock);
  }
  const fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);
  const store=new TeamStore(dir,mission),actors=store.data.actors;
  const previousPacketId=store.data.packetId;
  if(packet)loadPacket(store,packet);
  const focused=analysisProfile(store.data.mission?.analysisProfile)===MUSINSA_PROFILE;
  const gapFacts=!focused && (!message || message===GENERAL_PACKET_MESSAGE) && !resume && !previousPacketId && !store.data.ownerThreadId &&
    !store.data.calculations.length && store.data.observations.every(x=>x.active!==false) ? sourceAvailability(packet) : null;
  let gapReview;
  if(focused)saveMusinsaSignals(store);
  const ownerInstructions=focused?MUSINSA_OWNER:OWNER,reviewInstructions=focused?MUSINSA_REVIEWER:REVIEWER;
  const selectedOwnerTools=focused?ownerTools.filter(t=>!['collect_no1','investigate'].includes(t.name)):ownerTools;
  const active=new Map();let stopped=false,controlTimer,controlBusy=false,evidenceServer,reviewsThisTurn=0;
  const emit=(type,data={})=>{store.event(type,data);onEvent({type,...data});};
  const checkStop=()=>{if(stopped||fs.existsSync(path.join(dir,'STOP')))throw Error('STOP_REQUESTED');};
  const server=serverFactory({cwd:dir,onTool:async p=>{
    if(gapReview?.owns(p.threadId)){checkStop();return gapReview.record(p);}
    try{return await tools.execute(p);}catch(e){
      const code=String(e.message).slice(0,500);emit('tool_error',{tool:p.tool,threadId:p.threadId,code});
      // A failed collection is evidence of a blocker, never evidence of no stock/profit.
      if(['collect_no1','investigate'].includes(p.tool))store.observe('collection_error',{tool:p.tool,code},{threadId:p.threadId});
      throw e;
    }
  }});
  const actor=(threadId,role)=>{
    let row=actors.find(x=>x.threadId===threadId);
    if(!row){row={threadId,role,tokenUsage:null};actors.push(row);}
    else row.role=role;
    store.save();return row;
  };
  server.on('notification',m=>{
    if(m.method==='thread/tokenUsage/updated')store.recordTokenUsage(m.params.threadId,m.params.tokenUsage?.total);
    if(m.method==='thread/started'){const t=m.params.thread;if(!actors.some(x=>x.threadId===t.id))actor(t.id,'native_subagent');emit('thread_started',{threadId:t.id,source:t.source,agentNickname:t.agentNickname,agentRole:t.agentRole});}
    if(m.method==='turn/started')active.set(m.params.threadId,m.params.turn.id);
    if(m.method==='turn/completed'){active.delete(m.params.threadId);emit('turn_completed',{threadId:m.params.threadId,status:m.params.turn.status});}
    if(m.method==='item/completed'){
      const item=m.params.item;
      if(item.type==='agentMessage')emit('agent_message',{threadId:m.params.threadId,text:item.text?.slice(0,5000)});
      else if(/collab|agent/i.test(item.type))emit('collaboration',{threadId:m.params.threadId,item});
    }
  });
  const settings=fs.existsSync(path.join(ROOT,'sourcing-runtime.json'))?JSON.parse(fs.readFileSync(path.join(ROOT,'sourcing-runtime.json'),'utf8')):{};
  const tools=new TeamTools(store,{replay,offline:store.data.packetMode==='offline',relayDir:settings.relayRunDir?path.resolve(ROOT,settings.relayRunDir):null,stopCheck:()=>stopped,
    requestReview:async(question,proposal,needsDeepReview)=>{
      if(reviewsThisTurn++>=3)throw Error('REVIEW_BUDGET_REACHED');
      const before=store.basis();
      const materialConflict=Boolean(store.data.materialReviewConflict || (needsDeepReview && question?.trim()));
      const selected=reviewModel(proposal,materialConflict);
      const response=await server.startThread({instructions:reviewInstructions,tools:reviewTools,...selected,config:{'agents.enabled':false,'mcp_servers.cream_evidence.enabled':false}});
      const threadId=response.thread.id;actor(threadId,'reviewer');
      const ids=[...store.data.observations,...store.data.calculations].filter(x=>x.active!==false).map(x=>x.id);
      Object.assign(actors.find(x=>x.threadId===threadId),{model:selected.model,effort:selected.effort,materialConflict,
        proposal,proposedBy:store.data.ownerThreadId,proposalHash:proposalHash(proposal),reviewBasis:before,requiredReads:ids});store.save();
      await server.runTurn(threadId,JSON.stringify({task:'read_next_originals를 remaining=0까지 호출해 모든 원자료와 계산을 읽고 제안을 독립 검증한다. record_review에 verdict와 issues를 보내라. basis를 생략하면 확인한 필수 원문이 연결된다. 계산을 반복하지 않는다.',question,proposal}),{timeoutMs:120000});
      return ensureReviewRecorded({store,server,threadId,expectedBasis:before,stopped:()=>stopped||fs.existsSync(path.join(dir,'STOP'))});
    }});
  try {
    if(fs.existsSync(path.join(dir,'STOP')))throw Error('STOP_REQUESTED');
    const explicitReassessment=Boolean(message && message!==GENERAL_PACKET_MESSAGE && message!==MUSINSA_MESSAGE);
    if(resume&&!explicitReassessment&&store.data.assessment?.evidenceBasis===store.basis()){
      store.data.status='complete';emit('assessment_complete',{decision:store.data.assessment.decision,readiness:store.data.assessment.readiness,recoveredFrom:'PERSISTED_ASSESSMENT'});return store.data;
    }
    if(resume || previousPacketId){
      if(explicitReassessment)store.data.assessment=null;
      for(const row of store.data.observations)if(row.kind==='source_availability_projection')row.active=false;
      store.save();
    }
    evidenceServer=await startEvidenceServer(store);
    Object.assign(server.config,{'mcp_servers.cream_evidence.command':process.execPath,
      'mcp_servers.cream_evidence.args':[fileURLToPath(new URL('./evidence-mcp.mjs',import.meta.url)),evidenceServer.file],
      'mcp_servers.cream_evidence.enabled':true});
    await server.start();
    let threadId=store.data.ownerThreadId;
    const control=path.join(dir,'control');fs.mkdirSync(control,{recursive:true});
    controlTimer=setInterval(async()=>{
      if(controlBusy)return;controlBusy=true;
      try{
        if(fs.existsSync(path.join(dir,'STOP'))&&!stopped){stopped=true;store.data.status='stopping';emit('stop_requested');for(const [id,turnId] of active)await server.call('turn/interrupt',{threadId:id,turnId}).catch(()=>{});}
        for(const file of fs.readdirSync(control).filter(x=>/^message-[a-f0-9-]+\.json$/.test(x))){
          const location=path.join(control,file),command=JSON.parse(fs.readFileSync(location,'utf8'));
          if(typeof command.message!=='string'||command.message.length>12000)throw Error('CONTROL_MESSAGE_INVALID');
          const turnId=active.get(threadId);if(!turnId)continue;
          await server.call('turn/steer',{threadId,expectedTurnId:turnId,input:[{type:'text',text:command.message}]});
          fs.renameSync(location,location+'.delivered');emit('dot_instruction_delivered',{message:command.message});
        }
      }catch(e){emit('control_error',{code:e.message});}finally{controlBusy=false;}
    },1000);
    if(gapFacts){
      gapReview=new SourceAvailabilityReview(store,packet,gapFacts);
      store.data.status='running';emit('source_availability_started',{packetId:packet.id});
      const hasNewInstruction=()=>fs.readdirSync(control).some(name=>/^message-[a-f0-9-]+\.json$/.test(name));
      if(await gapReview.evaluate(server,actor,checkStop,timeoutMs,hasNewInstruction)){
        store.data.status='complete';emit('assessment_complete',{decision:'hold',readiness:store.data.assessment.readiness});
        return store.data;
      }
      gapReview.discardProjection();
      emit('source_availability_full_review',{materialConflict:Boolean(store.data.materialReviewConflict)});
    }
    const toolsHash=digest(selectedOwnerTools);
    let resumed=false;
    if(resume&&threadId&&store.data.toolSchemaHash===toolsHash){
      try{await server.call('thread/resume',{threadId,cwd:dir,developerInstructions:ownerInstructions,model:MODELS.owner.model,sandbox:'read-only',approvalPolicy:'never',config:{'model_reasoning_effort':MODELS.owner.effort,...(focused?{'agents.enabled':false,'mcp_servers.cream_evidence.enabled':false}:{})}});resumed=true;}
      catch(e){
        // A crash between thread creation and its first persisted turn can leave a thread ID without a rollout.
        // Recover only this explicit missing-thread condition; authentication/transport errors still fail.
        if(!/no rollout found for thread id|thread not found/i.test(e.message))throw e;
        emit('owner_thread_recovery',{previousThreadId:threadId,reason:'CLI_ROLLOUT_MISSING',savedEvidencePreserved:true});
      }
    }
    if(!resumed) {
      if(threadId&&!resume)throw Error('EXISTING_TEAM_REQUIRES_RESUME');
      if(threadId)emit('owner_schema_migration',{previousThreadId:threadId});
      const response=await server.startThread({instructions:ownerInstructions,tools:selectedOwnerTools,...MODELS.owner,...(focused?{config:{'agents.enabled':false,'mcp_servers.cream_evidence.enabled':false}}:{})});threadId=response.thread.id;
      store.data.ownerThreadId=threadId;store.data.toolSchemaHash=toolsHash;actor(threadId,'owner');
      Object.assign(actors.find(x=>x.threadId===threadId),{requestedModel:MODELS.owner.model,effectiveModel:response.model||null,effort:MODELS.owner.effort});store.save();
    }
    store.data.status='running';store.save();emit('owner_ready',{threadId});
    await server.runTurn(threadId,message||JSON.stringify({mission:store.data.mission,
      instruction:'수집된 상품 정보 묶음을 먼저 확인하고 AI가 해당 상품의 수익성/채택을 판단하라. 이미 있는 자료는 재조회하지 않는다. 복잡한 분석에만 하위 에이전트를 사용하고 독립 검증 후 publish_assessment로 기록한다. 미확인을 수익 없음으로 단정하지 말라.'}),{timeoutMs});
    if(!store.data.assessment||store.data.assessment.evidenceBasis!==store.basis())throw Error('ASSESSMENT_NOT_COMPLETE');
    store.data.status='complete';emit('assessment_complete',{decision:store.data.assessment.decision,readiness:store.data.assessment.readiness});
    return store.data;
  }catch(e){
    // publish_assessment persists the reviewed result before the Codex turn
    // itself is acknowledged. If that acknowledgement times out, keep the
    // valid current-basis assessment instead of downgrading the product and
    // retrying the same completed review forever.
    const persisted=fs.existsSync(store.file)?JSON.parse(fs.readFileSync(store.file,'utf8')):null;
    const assessment=store.data.assessment||persisted?.assessment;
    if(!stopped&&e.message!=='STOP_REQUESTED'&&assessment?.evidenceBasis===store.basis()){
      store.data.assessment=assessment;store.data.status='complete';emit('assessment_complete',{decision:assessment.decision,readiness:assessment.readiness,recoveredFrom:e.message});return store.data;
    }
    store.data.status=stopped||e.message==='STOP_REQUESTED'?'stopped':'needs_attention';emit('run_incomplete',{code:e.message});throw e;
  }
  finally{clearInterval(controlTimer);await server.close();await evidenceServer?.close();store.save();if(fs.existsSync(lock)&&fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const arg=name=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
  const dir=arg('out');if(!dir)throw Error('Use --out=<run directory> --mission=<mission.json> or --resume');
  let replay=null;if(arg('replay')){const saved=JSON.parse(fs.readFileSync(arg('replay'),'utf8'));replay=saved.result?.content?JSON.parse(saved.result.content[0].text):saved;}
  const mission=arg('mission')?JSON.parse(fs.readFileSync(arg('mission'),'utf8')):undefined;
  try {const result=await runTeam({dir,mission,resume:process.argv.includes('--resume'),replay,message:arg('message'),onEvent:e=>console.log(JSON.stringify(e))});console.log(JSON.stringify({status:result.status,assessment:result.assessment}));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
