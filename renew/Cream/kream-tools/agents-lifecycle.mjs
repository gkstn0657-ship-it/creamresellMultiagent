import { readJson, writeJson } from './agents-core.mjs';
export const AGENT_ROLES = Object.freeze([
  ['error_manager','kream-error-manager'], ['offer_verifier','kream-offer-verifier'],
  ['source_fallback','kream-source-fallback'], ['final_auditor','kream-final-auditor'],
  ['seller_verifier','kream-seller-verifier'], ['outcome_tracker','kream-outcome-tracker'],
]);
export function agentEvent(ctx, role, phase, status, details = {}) {
  if (!AGENT_ROLES.some(([key]) => key === role)) throw new Error('알 수 없는 에이전트 역할');
  let state = readJson(ctx.dir, 'agents-execution.json', null);
  if (!state || state.runId !== ctx.runId) state = { version:'cream-agent-team-v2',runId:ctx.runId,roles:Object.fromEntries(AGENT_ROLES.map(([key,name]) => [key,{name,rules:'waiting',ai:'waiting',runs:0}])),events:[] };
  const event = { role,phase,status,at:new Date().toISOString(),...details };
  state.roles[role][phase] = status;
  if (phase === 'rules' && status === 'running') state.roles[role].runs++;
  state.roles[role].last = event; state.events.push(event); state.at = event.at;
  writeJson(ctx.dir,'agents-execution.json',state); return state;
}
export function roleRules(ctx, role, action) {
  agentEvent(ctx,role,'rules','running');
  try { const result = action(); agentEvent(ctx,role,'rules','done',{items:Array.isArray(result) ? result.length : result?.items?.length ?? result?.rows?.length ?? null}); return result; }
  catch (error) { agentEvent(ctx,role,'rules','failed',{error:error.message}); throw error; }
}
