import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {writeJsonAtomic} from './atomic-json.mjs';
import {marginReport} from './margin-report.mjs';
import {marketSchemas} from './market-schema.mjs';
export const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const uid = prefix => `${prefix}-${crypto.randomUUID()}`;
export const proposalHash = p => digest({decision:p.decision,reason:p.reason,basis:p.basis,unresolved:p.unresolved});
export class TeamStore {
  constructor(dir, mission) {
    this.dir = path.resolve(dir); fs.mkdirSync(this.dir,{recursive:true});
    this.file = path.join(this.dir,'team-state.json');
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file,'utf8')) : {
      version:'cream-agent-team-v1', runId:uid('run'), status:'prepared', createdAt:new Date().toISOString(),
      mission, ownerThreadId:null, actors:[], observations:[], calculations:[], reviews:[], assessment:null, events:[], toolCalls:0,
    };
    if (this.data.version !== 'cream-agent-team-v1') throw Error('TEAM_STATE_VERSION');
    this.save();
  }
  save() { writeJsonAtomic(this.file,this.data); }
  event(type,data={}) {this.data.events.push({at:new Date().toISOString(),type,...data});this.save();}
  basis() {return digest({mission:this.data.mission,observations:this.data.observations.filter(x=>x.active!==false).map(x=>x.id),calculations:this.data.calculations.filter(x=>x.active!==false).map(x=>x.id)});}
  observe(kind,payload,{mode='live',threadId=null,observedAt=new Date().toISOString()}={}) {
    if(!Number.isFinite(Date.parse(observedAt)))throw Error('OBSERVATION_TIME_INVALID');
    const entry={id:uid('obs'),kind,mode,threadId,observedAt,active:true,payload};
    this.data.observations.push(entry);this.save();return entry;
  }
  read(id) {const item=[...this.data.observations,...this.data.calculations].find(x=>x.id===id);if(!item)throw Error('OBSERVATION_NOT_FOUND');return item;}
  summary() {return {...this.data,margins:marginReport(this.data.observations),marketSchemas:marketSchemas(this.data.observations),observations:this.data.observations.filter(x=>x.active!==false).map(({payload,...x})=>({...x,summary:payload.summary||payload.queryStatus||payload.tool||null})),calculations:this.data.calculations.filter(x=>x.active!==false),events:this.data.events.slice(-12)};}
}

export function calculateScenario(args) {
  const keys=['purchaseBeforePoints','existingPointsSpent','inboundShipping','salePrice','sellerFeeRate','sellerFixedFee','outboundShipping','newPointsExpected','quantity'];
  if(!args || keys.some(k=>!Object.hasOwn(args,k)) || Object.keys(args).some(k=>![...keys,'basis','assumptions'].includes(k)))throw Error('CALCULATION_SCHEMA');
  for(const k of keys) if(args[k]!==null && (!Number.isFinite(args[k])||args[k]<0))throw Error('INVALID_NUMBER');
  if(!Number.isSafeInteger(args.quantity)||args.quantity<1||args.quantity>1000)throw Error('INVALID_QUANTITY');
  if(args.sellerFeeRate!==null&&args.sellerFeeRate>1)throw Error('INVALID_FEE_RATE');
  if(args.existingPointsSpent!==null&&args.purchaseBeforePoints!==null&&args.existingPointsSpent>args.purchaseBeforePoints)throw Error('POINTS_EXCEED_COST');
  if(!Array.isArray(args.basis)||!Array.isArray(args.assumptions)||args.assumptions.some(x=>typeof x!=='string'))throw Error('CALCULATION_BASIS_REQUIRED');
  const missing=keys.filter(k=>args[k]===null);
  const unitComplete=keys.filter(k=>!['newPointsExpected','quantity'].includes(k)).every(k=>args[k]!==null);
  const fees=unitComplete?Math.round(args.salePrice*args.sellerFeeRate)+args.sellerFixedFee:null;
  const economicProfit=unitComplete?args.salePrice-fees-args.purchaseBeforePoints-args.inboundShipping-args.outboundShipping:null;
  const cashProfit=economicProfit===null?null:economicProfit+args.existingPointsSpent;
  return {inputs:args,missing,perUnit:{economicProfit,cashProfit,newPointsExpected:args.newPointsExpected},
    quantity:args.quantity,totalEconomicProfit:economicProfit===null?null:economicProfit*args.quantity,
    totalCashProfit:cashProfit===null?null:cashProfit*args.quantity,
    classification:'scenario',quantityConditionsConfirmed:false,pointsAccounting:'Existing points are an asset spent, future points are separate; discounts must already be in purchaseBeforePoints.'};
}

export function evidenceGaps(store,now=Date.now()) {
  const gaps=new Set(); const live=store.data.observations.filter(x=>x.kind==='no1_product'&&x.mode==='live'&&x.active!==false);
  if(!live.length){const quotes=store.data.observations.filter(x=>x.kind==='source_quote'&&x.mode==='live'&&x.active!==false);
    if(!quotes.length)gaps.add('LIVE_PRODUCT_EVIDENCE_MISSING');
    else{gaps.add('SOURCE_OPTION_BINDING_UNVERIFIED');gaps.add('UPSTREAM_FRESHNESS_UNKNOWN');gaps.add('ACTUAL_CHECKOUT_PRICE_UNCONFIRMED');if(quotes.some(x=>now-Date.parse(x.observedAt)>600000))gaps.add('OBSERVATION_STALE');}
  }
  for(const x of live) {
    const p=x.payload;
    for(const gap of p.missingFields||[])gaps.add(gap);
    if(!p.upstreamFreshnessConfirmed)gaps.add('UPSTREAM_FRESHNESS_UNKNOWN');
    if(now-Date.parse(x.observedAt)>600000)gaps.add('OBSERVATION_STALE');
  }
  const calculations=store.data.calculations.filter(x=>x.active!==false);
  if(!calculations.length)gaps.add('CALCULATION_MISSING');
  for(const x of calculations)for(const k of x.result.missing)gaps.add(`CALCULATION_UNKNOWN:${k}`);
  if(calculations.some(x=>x.result.inputs.assumptions.length))gaps.add('SCENARIO_ASSUMPTIONS');
  return [...gaps];
}

export function publishAssessment(store,args,threadId) {
  if(threadId!==store.data.ownerThreadId)throw Error('ONLY_PRODUCT_OWNER_CAN_DECIDE');
  if(!['adopt','hold','exclude'].includes(args.decision)||typeof args.reason!=='string'||!args.reason.trim()||!Array.isArray(args.basis)||!args.basis.length||!Array.isArray(args.unresolved))throw Error('ASSESSMENT_INVALID');
  for(const id of args.basis)if(store.read(id).active===false)throw Error('SUPERSEDED_EVIDENCE');
  const review=store.data.reviews.find(x=>x.id===args.reviewId);
  if(!review||review.threadId===threadId||review.basis!==store.basis()||review.proposalHash!==proposalHash(args)||review.verdict!=='pass')throw Error('INDEPENDENT_CURRENT_REVIEW_REQUIRED');
  const gaps=[...new Set([...evidenceGaps(store),...args.unresolved])];
  const result={...args,id:uid('assessment'),threadId,at:new Date().toISOString(),evidenceBasis:store.basis(),unresolved:gaps,
    readiness:gaps.length?'research_only':'evidence_reviewed',confirmedProfit:null,purchaseAuthorized:false,margins:marginReport(store.data.observations),marketSchemas:marketSchemas(store.data.observations)};
  store.data.assessment=result;store.save();return result;
}
