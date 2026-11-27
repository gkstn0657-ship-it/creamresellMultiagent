import fs from 'node:fs';
export const modelPolicy=JSON.parse(fs.readFileSync(new URL('./model-policy.json',import.meta.url),'utf8'));
const allowed=new Set(['gpt-6-luna:medium','gpt-6-luna:high','gpt-6.1-sol:medium','gpt-6.1-sol:high']);
export function modelConfig(value){
  if(!value||!allowed.has(`${value.model}:${value.effort}`))throw Error('MODEL_NOT_ALLOWED');
  return {model:value.model,effort:value.effort};
}
for(const value of Object.values(modelPolicy.defaults))modelConfig(value);
for(const value of Object.values(modelPolicy.upgrades))modelConfig(value);
if(modelPolicy.maxAgentUpgrades!==1||modelPolicy.adoptReviewFloor!=='sol-high'||modelPolicy.upgrades.reviewer.model!=='gpt-6.1-sol'||modelPolicy.upgrades.reviewer.effort!=='high')throw Error('MODEL_POLICY_GUARD_INVALID');
export const defaultModel=role=>modelConfig(modelPolicy.defaults[role]);
export function reviewSelection(proposal,{needsDeepReview=false,reworkCount=0}={}) {
  const reason=proposal?.decision==='adopt'?'adopt-review-floor':needsDeepReview?'owner-requested-deep-review':reworkCount>0?'review-disagreement':'measured-role-default';
  const config=reason==='measured-role-default'?defaultModel('reviewer'):modelConfig(modelPolicy.upgrades.reviewer);
  return {...config,reason,policyVersion:modelPolicy.version};
}
export const upgradeTool={name:'request_model_upgrade',description:'Request one stronger reasoning session when evidence conflicts or repeated reasoning failures cannot be resolved. Missing source facts alone are not fixed by a larger model. Give a concrete reason and actual evidence IDs (coordinator may use an empty list). After acceptance end this turn without more tool calls. The host transfers saved state to a separate upgraded session; never spawn your own replacement.',inputSchema:{type:'object',properties:{reason:{type:'string',minLength:15,maxLength:2000},evidenceIds:{type:'array',items:{type:'string'},maxItems:20,uniqueItems:true}},required:['reason','evidenceIds'],additionalProperties:false}};
export const upgradeInstructions=' You may call request_model_upgrade once if conflicting evidence or reasoning complexity warrants a stronger session. Explain why and cite evidence IDs. Missing facts alone require hold or collection, not upgrading. Once accepted, end your turn immediately; the host will hand saved facts to the upgraded session. Never publish or launch more work after requesting an upgrade.';
export function queueUpgrade(state,role,args,{readEvidence=()=>{},current}={}) {
  if(!['owner','coordinator'].includes(role))throw Error('UPGRADE_ROLE_FORBIDDEN');
  if(state.pendingModelUpgrade)throw Error('MODEL_UPGRADE_ALREADY_PENDING');
  if((state.modelUpgradeCount||0)>=modelPolicy.maxAgentUpgrades)throw Error('MODEL_UPGRADE_LIMIT');
  if(typeof args.reason!=='string'||args.reason.trim().length<15||args.reason.length>2000||!Array.isArray(args.evidenceIds)||args.evidenceIds.length>20||new Set(args.evidenceIds).size!==args.evidenceIds.length||args.evidenceIds.some(id=>typeof id!=='string'))throw Error('MODEL_UPGRADE_REASON_REQUIRED');
  if(role==='owner'&&!args.evidenceIds.length)throw Error('MODEL_UPGRADE_EVIDENCE_REQUIRED');
  args.evidenceIds.forEach(readEvidence);
  const target=modelConfig(modelPolicy.upgrades[role]),from=modelConfig(current||defaultModel(role));
  if(from.model===target.model&&from.effort===target.effort)return {accepted:false,reason:'ALREADY_AT_UPGRADE_TIER'};
  state.modelUpgradeCount=(state.modelUpgradeCount||0)+1;
  state.pendingModelUpgrade={...target,from,reason:args.reason.trim(),evidenceIds:args.evidenceIds,policyVersion:modelPolicy.version,requestedAt:new Date().toISOString()};
  return {accepted:true,target,instruction:'End this turn now. The host will resume saved work in the upgraded session.'};
}
