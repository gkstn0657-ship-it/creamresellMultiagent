import {digest} from './store.mjs';
import {defaultModel} from './model-routing.mjs';

export const purchaseBasis = assessment => {
  const {purchaseJudgment, ...reviewed} = assessment || {};
  return digest(reviewed);
};
export const purchaseJudgmentCurrent = assessment => assessment?.decision !== 'adopt' ||
  assessment.purchaseJudgment?.version === 2 && assessment.purchaseJudgment?.assessmentBasis === purchaseBasis(assessment);
export const PURCHASE_JUDGE = `You are the final inventory purchasing judge, separate from the product owner and evidence reviewer.
An adopt assessment only admits a research candidate. Decide whether spending money on inventory is justified.
Read the reviewed assessment and EVERY original via read_purchase_evidence before recording your judgment.
Consider option-specific recent 7/30-day sales, each sale channel separately, the number and age of actual trades behind a median,
current asks versus completed trades, immediate liquidation profit/loss, source stock and competitive supply, all fees/shipping,
coupon eligibility, evidence freshness, and alternative platforms only when the exact option is verified.
Source stock is not the number of competing resellers. Missing data is unknown, never zero. Do not infer turnover time from one or two trades.
A large theoretical margin is not sufficient to recommend buying. Explain whether likely holding time and downside justify that margin.
KC9299 illustrates the distinction: 30-day M sales of only two, seven-day sales of zero, a single storage trade,
and a loss on immediate liquidation can justify do_not_buy despite a passed adopt review. This is an example, not a model-specific rule.
Use recommend_buy, do_not_buy, or hold. hold means missing evidence prevents judgment; do_not_buy means available evidence argues against buying.
Write concise Korean reasoning and concrete reconsideration conditions. Do not invent facts or place orders.
You have no collection, purchase, shell or delegation permission. Call record_purchase_judgment; prose alone is not completion.`;

const array = {type:'array',items:{type:'string',minLength:1},minItems:1};
export const purchaseTools = [
  {type:'function',name:'read_purchase_evidence',description:'Read next batch of full original evidence. Repeat until remaining=0.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {type:'function',name:'record_purchase_judgment',description:'Save an advisory inventory purchase judgment, never an order or authorization.',inputSchema:{type:'object',additionalProperties:false,required:['decision','reason','risks','reconsiderWhen','basis'],properties:{decision:{type:'string',enum:['recommend_buy','do_not_buy','hold']},reason:{type:'string',minLength:20},risks:array,reconsiderWhen:array,basis:array}}}
];

export class PurchaseJudge {
  constructor(store){this.store=store;this.threadId=null;this.seen=new Set();this.offset=0;}
  owns(id){return Boolean(this.threadId)&&id===this.threadId;}
  execute({tool,arguments:args={}}){
    const s=this.store;
    if(s.basis()!==this.evidenceBasis||purchaseBasis(s.data.assessment)!==this.assessmentBasis)throw Error('PURCHASE_BASIS_CHANGED');
    if(tool==='read_purchase_evidence'){
      const id=this.ids.find(id=>!this.seen.has(id));
      if(!id)return {remaining:0};
      const raw=JSON.stringify(s.read(id)),offset=this.offset,content=raw.slice(offset,offset+12000);
      this.offset+=content.length;const complete=this.offset>=raw.length;
      if(complete){this.seen.add(id);this.offset=0;}
      return {id,offset,content,complete,remaining:this.ids.length-this.seen.size};
    }
    if(tool!=='record_purchase_judgment')throw Error('PURCHASE_JUDGE_READ_ONLY');
    if(this.seen.size!==this.ids.length)throw Error('PURCHASE_MUST_READ_ORIGINALS');
    if(!['recommend_buy','do_not_buy','hold'].includes(args.decision)||typeof args.reason!=='string'||args.reason.trim().length<20||
      ['risks','reconsiderWhen','basis'].some(k=>!Array.isArray(args[k])||!args[k].length||args[k].some(v=>typeof v!=='string'||!v.trim()))||
      args.basis.some(id=>!this.seen.has(id)))throw Error('PURCHASE_JUDGMENT_INVALID');
    const result={version:2,decision:args.decision,reason:args.reason,risks:args.risks,reconsiderWhen:args.reconsiderWhen,basis:args.basis,
      assessmentBasis:this.assessmentBasis,evidenceBasis:this.evidenceBasis,threadId:this.threadId,at:new Date().toISOString(),purchaseAuthorized:false};
    s.data.assessment.purchaseJudgment=result;s.save();return result;
  }
  async run(server,actor,checkStop,emit){
    const s=this.store;
    if(s.data.assessment?.decision!=='adopt'||purchaseJudgmentCurrent(s.data.assessment))return;
    const a=s.data.assessment,review=s.data.reviews.find(r=>r.id===a.reviewId);
    if(a.evidenceBasis!==s.basis()||review?.verdict!=='pass'||review.basis!==s.basis())throw Error('PURCHASE_REQUIRES_CURRENT_REVIEW');
    checkStop();this.evidenceBasis=s.basis();this.assessmentBasis=purchaseBasis(a);
    this.ids=[...s.data.observations,...s.data.calculations].filter(o=>o.active!==false).map(o=>o.id);this.seen.clear();this.offset=0;
    const model=defaultModel('deepReviewer');
    const response=await server.startThread({instructions:PURCHASE_JUDGE,tools:purchaseTools,...model,config:{'agents.enabled':false,'mcp_servers.cream_evidence.enabled':false}});
    this.threadId=response.thread.id;
    Object.assign(actor(this.threadId,'purchase_judge'),{...model,effectiveModel:response.model||null});s.save();
    s.data.status='purchase_review';emit('purchase_judgment_started',{threadId:this.threadId});
    for(let attempt=0;attempt<2;attempt++){
      checkStop();
      try{await server.runTurn(this.threadId,attempt?'Read any remaining originals and call record_purchase_judgment. Your prior prose did not save a judgment.':JSON.stringify({mission:s.data.mission,reviewedAssessment:a,independentReview:review,evidenceIds:this.ids}),{timeoutMs:180000});}
      catch(e){if(!purchaseJudgmentCurrent(s.data.assessment))throw e;}
      checkStop();if(purchaseJudgmentCurrent(s.data.assessment)){emit('purchase_judgment_complete',{decision:s.data.assessment.purchaseJudgment.decision});return;}
    }
    throw Error('PURCHASE_JUDGMENT_NOT_RECORDED');
  }
}
