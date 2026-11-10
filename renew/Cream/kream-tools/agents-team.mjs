import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash,readJson,writeJson } from './agents-core.mjs';
import { invokeCodex,validateFindings } from './agents-llm.mjs';
import { AGENT_ROLES,agentEvent } from './agents-lifecycle.mjs';
const DEFINITION_DIR = fileURLToPath(new URL('../../../.codex/agents/',import.meta.url));
export function roleDefinition(role, dir = DEFINITION_DIR) {
  const name = AGENT_ROLES.find(([key]) => key === role)?.[1];
  if (!name) throw new Error('알 수 없는 에이전트');
  const file = path.join(dir,`${name}.toml`), source = fs.readFileSync(file,'utf8');
  const instructions = source.match(/developer_instructions\s*=\s*"""([\s\S]*?)"""/)?.[1];
  if (!instructions || !source.includes(`name = "${name}"`)) throw new Error(`에이전트 정의 오류: ${name}`);
  return {name,file,instructions,hash:hash(source)};
}
// Deliberate allowlist: no titles, URLs, source text, seller identity, or business numbers.
export function safeChecks(items) {
  return items.map(item => ({id:item.id || item.offerId,size:item.size || null,status:item.status,
    issues:(item.issues || []).map(x => String(x.code).replace(/[^A-Z0-9_]/g,'').slice(0,80)),
    unitPrice:item.unitPrice ?? null,shipping:item.shipping ?? null,cost:item.cost ?? null,
    marketCount:item.market?.count ?? null,marketPrice:item.market?.price ?? null,
    evidenceHash:hash({...item,cached:undefined}),risk:item.risk?.points?.map(p => ({pts:p.pts})) ?? null,
    role:['direct','marketplace'].includes(item.role) ? item.role : null}));
}
export async function runRoleAi(ctx,role,rows,options = {}) {
  if (options.efficientAi && !rows.length) return skipRoleAi(ctx,role,'no eligible rows');
  const definition = roleDefinition(role,options.definitionDir);
  const data = rows.length ? rows : [{id:`${role}-empty`,status:'no-input',count:0}];
  if (new Set(data.map(r => r.id)).size !== data.length) throw new Error('에이전트 입력 ID 중복');
  const cache = readJson(ctx.dir,'agents-team-cache.json',{entries:{}});
  const report = readJson(ctx.dir,'agents-team-ai.json',{runId:ctx.runId,roles:{},calls:0,inputChars:0});
  if (report.runId !== ctx.runId) Object.assign(report,{runId:ctx.runId,roles:{},calls:0,inputChars:0,usage:[]});
  const findings = [],errors = []; let calls = 0,cached = 0;
  const model = options.modelForRole?.(role,data) || 'gpt-6.1-sol';
  agentEvent(ctx,role,'ai',options.replay ? 'disabled_replay' : 'running',{model,definitionHash:definition.hash});
  if (options.replay) {
    const result = {role,mode:'offline-replay',calls:0,cached:0,findings:[],errors:[],inputItems:data.length};
    report.roles[role] = result; writeJson(ctx.dir,'agents-team-ai.json',report); return result;
  }
  const batchSize = options.efficientAi ? 32 : 16;
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i,i+batchSize),request = {role,rows:batch},batchModel = options.modelForRole?.(role,batch) || model,
      key = hash(['team-v3',options.providerId || 'codex',batchModel,definition.hash,request]);
    try {
      let output = cache.entries[key];
      if (output) cached++;
      else {
        const chars = JSON.stringify(request).length;
        if (report.calls >= (ctx.policy.maxRoleAiCalls ?? 24)) throw new Error('에이전트 팀 AI 호출 한도 초과');
        if (report.inputChars + chars > (ctx.policy.maxRoleAiInputChars ?? 40000)) throw new Error('에이전트 팀 입력 한도 초과');
        report.calls++; report.inputChars += chars; calls++;
        options.onRole?.({role,status:'calling',call:report.calls});
        output = await (options.roleProvider || invokeCodex)(request,{...options,instructions:definition.instructions + '\n현재 역할은 '+definition.name+'이다. 아래 구조화된 요약만 읽는다. 원문·실시간 자료가 없으면 확인 불가로 남기고, 없는 판매처·재고·가격·실현 성과를 만들지 않는다. 모든 입력 ID를 정확히 한 번 반환한다. action은 추가 의심 hold, 명백한 불일치 exclude, 추가 지적 없음 none이다. 데이터 수집·주문·파일·웹 도구 호출은 하지 않는다. 이 의견은 규칙의 필수 근거를 대신하지 않는다.'});
        if (output._usage) report.usage = [...(report.usage || []),{role,...output._usage}];
      }
      findings.push(...validateFindings(output,new Set(batch.map(r => r.id)))); cache.entries[key] = output;
    } catch (error) { errors.push({ids:batch.map(r => r.id),message:error.message}); }
    writeJson(ctx.dir,'agents-team-cache.json',cache); writeJson(ctx.dir,'agents-team-ai.json',report);
  }
  const result = {role,mode:'model',model,calls,cached,findings,errors,inputItems:data.length,definitionHash:definition.hash,rowHashes:Object.fromEntries(data.map(r => [r.id,hash(r)]))};
  report.roles[role] = result; writeJson(ctx.dir,'agents-team-ai.json',report);
  agentEvent(ctx,role,'ai',errors.length ? 'failed' : 'done',{calls,cached,errors:errors.length});
  options.onRole?.({role,status:errors.length ? 'failed' : 'done',calls,cached}); return result;
}
export function skipRoleAi(ctx,role,reason) {
  const report = readJson(ctx.dir,'agents-team-ai.json',{runId:ctx.runId,roles:{},calls:0,inputChars:0});
  if (report.runId !== ctx.runId) Object.assign(report,{runId:ctx.runId,roles:{},calls:0,inputChars:0,usage:[]});
  report.roles[role] = {role,mode:'rules',model:null,calls:0,cached:0,findings:[],errors:[],reason};
  writeJson(ctx.dir,'agents-team-ai.json',report);
  agentEvent(ctx,role,'ai','skipped_by_policy',{reason});
  return report.roles[role];
}
export function applyCheckReview(items,review) {
  if (review.mode === 'offline-replay') return items;
  review = currentReview(review,safeChecks(items));
  const findings = new Map(review.findings.map(f => [f.id,f])),failed = new Set(review.errors.flatMap(e => e.ids));
  for (const item of items) {
    const id = item.id || item.offerId, finding = findings.get(id);
    if (failed.has(id) || !finding) { if (item.status !== 'excluded') item.status = 'hold'; item.issues.push({code:'AGENT_AI_INCOMPLETE',detail:`${review.role} AI 검토 미완료`}); }
    else if (finding.action !== 'none') { item.status = finding.action === 'exclude' ? 'excluded' : item.status === 'excluded' ? 'excluded' : 'hold'; item.issues.push({code:'AGENT_AI_FINDING',detail:`${review.role}: ${finding.reason}`}); }
  }
  return items;
}
export function currentReview(review,rows) {
  if (!review.rowHashes) return review;
  const changed = rows.filter(row => review.rowHashes[row.id] !== hash(row)).map(row => row.id);
  return {...review,errors:[...review.errors,...(changed.length ? [{ids:changed,message:'AI 검토 이후 입력 근거 변경'}] : [])]};
}
export function teamSummary(ctx) {
  const state = readJson(ctx.dir,'agents-execution.json',{roles:{}}),ai = readJson(ctx.dir,'agents-team-ai.json',{roles:{}});
  return {roles:AGENT_ROLES.map(([role,name]) => ({role,name,rules:state.roles[role]?.rules || 'waiting',ai:state.roles[role]?.ai || 'waiting'})),
    calls:ai.calls || 0,complete:AGENT_ROLES.every(([role]) => state.roles[role]?.rules === 'done' && ['done','skipped_by_policy'].includes(state.roles[role]?.ai))};
}
