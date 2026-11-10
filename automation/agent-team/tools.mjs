import fs from 'node:fs';
import path from 'node:path';
import {BackgroundClient} from '../no1-background/client.mjs';
import {probeProduct,validateProbeArgs} from '../no1-background/product-probe.mjs';
import {SourcingTools} from '../agentic/tools.mjs';
import {calculateScenario,evidenceGaps,publishAssessment,uid,digest,proposalHash} from './store.mjs';
import {marginReport} from './margin-report.mjs';
const schema=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'}, arr={type:'array',items:str}, num={type:['number','null']};
const proposalSchema=schema({decision:{type:'string',enum:['adopt','hold','exclude']},reason:str,basis:arr,unresolved:arr});
const def=(name,description,inputSchema)=>({type:'function',name,description,inputSchema});
export const TOOL_DEFINITIONS=[
  def('team_state','Read the mission, saved observations, calculations, reviews and progress.',schema({})),
  def('read_margin_report','Read per-option No1-compatible margin amount, return rate and profit/loss/break-even/unknown for fast, normal, instant and desired selling prices. Uses collected evidence only, no network/UI. Default fees are explicit No1 defaults, not user settings. Desired price is hypothetical; missing prices stay unknown.',schema({desiredSellingPrice:num,taxMode:{type:'boolean'},fees:schema({kreamPercent:{type:'number',minimum:0,maximum:100},kreamInspectionFee:{type:'integer',minimum:0},poizonPercent:{type:'number',minimum:0,maximum:100},poizonMinFee:{type:'integer',minimum:0},poizonMaxFee:{type:'integer',minimum:0}},[])},[])),
  def('read_observation','Read immutable original evidence or a saved numeric scenario by its ID.',schema({id:str})),
  def('collect_no1','Collect the scoped product through the authenticated background No1 adapter. May use an isolated guest cart internally. Never opens a UI or purchases.',schema({refreshReason:str})),
  def('investigate','Choose a collection operation for the current product only. Arguments are JSON encoded. market_page:{pid}; bind_identity:{pid,model,title,quote,file}; search_sources:{pid,query}; catalog_page:{pid,catalogIndex}; inspect_offer:{offerId}; read_evidence:{file,offset?,length?}. No desktop UI. Do not repeat an authentication failure.',schema({operation:{type:'string',enum:['market_page','bind_identity','search_sources','catalog_page','inspect_offer','read_evidence']},arguments:str})),
  def('calculate_scenario','Compute per-unit and quantity cash/economic profit. All costs are per unit; discounts already included in purchaseBeforePoints. null means unknown. Assumptions and evidence IDs must be explicit; this tool makes no adoption decision.',schema({purchaseBeforePoints:num,existingPointsSpent:num,inboundShipping:num,salePrice:num,sellerFeeRate:num,sellerFixedFee:num,outboundShipping:num,newPointsExpected:num,quantity:{type:'integer'},basis:arr,assumptions:arr})),
  def('request_review','Product owner submits its exact proposed judgment for independent review. Routine review uses Luna; adopt or complex/conflicting cases use Sol high. Publish exactly this reviewed proposal afterward.',schema({question:str,proposal:proposalSchema,needsDeepReview:{type:'boolean'}})),
  def('record_review','Independent reviewer only. Record source verification and inconsistencies; pass is not a profitability or purchase approval.',schema({verdict:{type:'string',enum:['pass','rework']},issues:arr,basis:arr})),
  def('publish_assessment','Product owner only. Persist AI adoption/hold/exclude judgment with a current independent review. Unknown facts remain visible; never purchases.',schema({decision:{type:'string',enum:['adopt','hold','exclude']},reason:str,basis:arr,unresolved:arr,reviewId:str})),
];
export const reviewTools=TOOL_DEFINITIONS.filter(x=>['team_state','read_margin_report','read_observation','record_review'].includes(x.name));
export const ownerTools=TOOL_DEFINITIONS.filter(x=>x.name!=='record_review');

export class TeamTools {
  constructor(store,{client=new BackgroundClient(),replay=null,offline=false,relayDir=null,requestReview,stopCheck=()=>false,maxCalls=50}={}) {
    Object.assign(this,{store,client,replay,offline,requestReview,stopCheck,maxCalls});this.no1Pending=null;this.pageQueue=Promise.resolve();this.reviewReads=new Map();
    this.initialCalls=store.data.toolCalls;
    const evidenceDir=path.join(store.dir,'evidence');fs.mkdirSync(evidenceDir,{recursive:true});
    const seed=store.data.mission?.product;
    for(const [name,value] of Object.entries({'k50-ids.json':seed?[seed.kreamId]:[],'k50.json':[],'n-cards.json':{},'n-cat.json':{},'agent-policy.json':{}}))if(!fs.existsSync(path.join(evidenceDir,name)))fs.writeFileSync(path.join(evidenceDir,name),JSON.stringify(value));
    this.sourcing=new SourcingTools(evidenceDir,{mode:replay?'replay':'live',relayDir,config:{maxPagesPerRun:16,maxNo1Queries:10,pageTimeoutMs:60000,freshnessMinutes:10},stopFile:path.join(store.dir,'STOP')});
  }
  async execute(p) {
    const {tool,threadId}=p,args=p.arguments||{};
    if(this.stopCheck()||fs.existsSync(path.join(this.store.dir,'STOP')))throw Error('STOP_REQUESTED');
    if(this.store.data.toolCalls-this.initialCalls>=this.maxCalls)throw Error('TEAM_TOOL_BUDGET_REACHED');
    this.store.data.toolCalls++;this.store.event('tool_call',{tool,threadId});
    const reviewer=this.store.data.actors.some(x=>x.threadId===threadId&&x.role==='reviewer');
    if(reviewer&&!reviewTools.some(x=>x.name===tool))throw Error('REVIEWER_READ_ONLY');
    if(tool==='team_state')return {...this.store.summary(),evidenceGaps:evidenceGaps(this.store)};
    if(tool==='read_margin_report')return marginReport(this.store.data.observations,args);
    if(tool==='read_observation'){
      const observation=this.store.read(args.id);
      if(reviewer){if(!this.reviewReads.has(threadId))this.reviewReads.set(threadId,new Set());this.reviewReads.get(threadId).add(args.id);}
      return observation;
    }
    if(tool==='collect_no1') {
      if(!this.store.data.mission?.product)throw Error('PRODUCT_SEED_REQUIRED');
      const seed=this.store.data.mission.product;
      if(!seed.productUrl)throw Error('VERIFIED_SOURCE_OFFER_REQUIRED: retain unknown costs; no source has been bound');
      const prior=this.store.data.observations.filter(x=>x.active!==false&&x.kind==='no1_product'&&Object.keys(seed).every(k=>x.payload.request?.[k]===seed[k])).at(-1);
      if(prior&&Date.now()-Date.parse(prior.observedAt)<600000)return {...prior,cacheHit:true};
      if(this.offline)throw Error('OFFLINE_PACKET_NETWORK_DISABLED');
      if(this.no1Pending)return this.no1Pending;
      this.no1Pending=this.collect(threadId).finally(()=>{this.no1Pending=null;});return this.no1Pending;
    }
    if(tool==='investigate') {
      if(this.store.data.mission?.candidate&&args.operation!=='read_evidence')throw Error('DISCOVERY_PACKET_SCOPE: use collected observations; unresolved source matching stays unknown. No browser fallback.');
      if(this.offline&&args.operation!=='read_evidence')throw Error('OFFLINE_PACKET_NETWORK_DISABLED');
      if(!TOOL_DEFINITIONS.find(x=>x.name===tool).inputSchema.properties.operation.enum.includes(args.operation))throw Error('OPERATION_FORBIDDEN');
      const action=JSON.parse(args.arguments);
      const key=digest([args.operation,action]);
      const old=this.store.data.observations.findLast(x=>x.active!==false&&x.kind==='investigation'&&x.payload.key===key&&Date.now()-Date.parse(x.observedAt)<600000);
      if(old)return {...old,cacheHit:true};
      const job=()=>this.sourcing.execute(args.operation,action).then(result=>this.store.observe('investigation',{tool:args.operation,key,result},{threadId,mode:this.replay?'replay':'live'}));
      const result=this.pageQueue.then(job);this.pageQueue=result.catch(()=>{});return result;
    }
    if(tool==='calculate_scenario') {
      for(const id of args.basis||[])this.store.read(id);
      const result=calculateScenario(args),entry={id:uid('calc'),threadId,at:new Date().toISOString(),result};
      this.store.data.calculations.push(entry);this.store.save();return entry;
    }
    if(tool==='request_review') {
      if(threadId!==this.store.data.ownerThreadId)throw Error('ONLY_OWNER_REQUESTS_REVIEW');
      const proposal=args.proposal;
      if(!proposal||!['adopt','hold','exclude'].includes(proposal.decision)||typeof proposal.reason!=='string'||!Array.isArray(proposal.basis)||!proposal.basis.length||!Array.isArray(proposal.unresolved))throw Error('REVIEW_PROPOSAL_REQUIRED');
      for(const id of proposal.basis)this.store.read(id);
      return this.requestReview(args.question,proposal,args.needsDeepReview===true);
    }
    if(tool==='record_review') {
      if(!reviewer||!['pass','rework'].includes(args.verdict)||!Array.isArray(args.issues)||!Array.isArray(args.basis)||!args.basis.length)throw Error('REVIEW_INVALID');
      for(const id of args.basis)this.store.read(id);
      const actor=this.store.data.actors.find(x=>x.threadId===threadId);
      if(!actor.proposalHash||actor.reviewBasis!==this.store.basis())throw Error('REVIEW_BASIS_CHANGED');
      if(args.basis.some(id=>!this.reviewReads.get(threadId)?.has(id))||actor.requiredReads.some(id=>!this.reviewReads.get(threadId)?.has(id)))throw Error('REVIEW_MUST_READ_ORIGINALS');
      const entry={...args,id:uid('review'),threadId,basisIds:args.basis,basis:actor.reviewBasis,proposalHash:actor.proposalHash,model:actor.model,at:new Date().toISOString()};
      this.store.data.reviews.push(entry);this.store.save();return entry;
    }
    if(tool==='publish_assessment')return publishAssessment(this.store,args,threadId);
    throw Error('UNKNOWN_TEAM_TOOL');
  }
  async collect(threadId) {
    const args=this.store.data.mission.product;validateProbeArgs(args);
    const payload=this.replay?structuredClone(this.replay):await probeProduct(this.client,args);
    if(JSON.stringify(payload.request)!==JSON.stringify(args)) {
      if(Object.keys(args).some(k=>payload.request?.[k]!==args[k]))throw Error('PRODUCT_EVIDENCE_SCOPE_MISMATCH');
    }
    return this.store.observe('no1_product',payload,{threadId,mode:this.replay?'replay':'live'});
  }
}
