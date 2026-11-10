import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { context, readJson, writeJson, envelope, hash, acquireRunLock } from './agents-core.mjs';
import { collectOffers, verifyOffers, planFallback } from './agents-offers.mjs';
import { verifySellers } from './agents-sellers.mjs';
import { auditFinal } from './agents-audit.mjs';
import { trackOutcomes } from './agents-outcomes.mjs';
import { recordIncident } from './agents-incidents.mjs';
import { reviewWithLlm, applyLlmReview } from './agents-llm.mjs';
import { autoEvidence } from './agents-extract.mjs';
import { evaluateBatches } from './agents-batch.mjs';
import { roleRules } from './agents-lifecycle.mjs';
import { runRoleAi,skipRoleAi,safeChecks,applyCheckReview,currentReview,teamSummary } from './agents-team.mjs';
import { invokeClaude,claudeModelForRole } from './agents-claude.mjs';

export function prepareAgents(dir, options = {}) {
  const ctx = context(dir, options), offers = collectOffers(ctx), automatic = autoEvidence(ctx, offers);
  roleRules(ctx,'error_manager',() => recordIncident(dir,null,'에이전트 입력 점검'));
  // Operator-reviewed fields take precedence. Generated evidence never overwrites the source file.
  const manual = ctx.evidence;
  ctx.evidence = { offers: { ...automatic.offers }, sellers: { ...automatic.sellers } };
  for (const [id, sizes] of Object.entries(manual.offers || {})) { ctx.evidence.offers[id] = { ...(automatic.offers[id] || {}) }; for (const [size, fields] of Object.entries(sizes)) ctx.evidence.offers[id][size] = { ...(automatic.offers[id]?.[size] || {}), ...fields }; }
  for (const [id, fields] of Object.entries(manual.sellers || {})) ctx.evidence.sellers[id] = { ...(automatic.sellers[id] || {}), ...fields };
  const verified = roleRules(ctx,'offer_verifier',() => verifyOffers(ctx, offers));
  const sellers = roleRules(ctx,'seller_verifier',() => verifySellers(ctx, offers));
  const fallback = roleRules(ctx,'source_fallback',() => planFallback(ctx, offers, verified, sellers));
  writeJson(dir, 'agent-offers.json', envelope(ctx, offers.map(({ product, ...o }) => o)));
  return { ctx, offers, verified, sellers, fallback };
}
export async function prepareAgentTeam(dir, options = {}) {
  const prepared = prepareAgents(dir,options),{ctx,offers,verified,sellers} = prepared;
  if (options.efficientAi) {
    const explicit = readJson(dir,'agent-policy.json',{});
    if (explicit.maxRoleAiCalls == null) ctx.policy.maxRoleAiCalls = 160;
    if (explicit.maxRoleAiInputChars == null) ctx.policy.maxRoleAiInputChars = 1500000;
  }
  const mode = { ...options,replay:options.replay === true };
  if (options.efficientAi) skipRoleAi(ctx,'error_manager','incident rules already recorded');
  else await runRoleAi(ctx,'error_manager',[{id:'operation',status:readJson(dir,'incident.json')?.current?.kind || 'OK',offers:offers.length}],mode);
  const offerReview = await runRoleAi(ctx,'offer_verifier',safeChecks(verified),mode);
  applyCheckReview(verified,offerReview);
  const sellerReview = options.efficientAi && sellers.every(s => s.status === 'verified')
    ? skipRoleAi(ctx,'seller_verifier','all sellers passed deterministic checks')
    : await runRoleAi(ctx,'seller_verifier',safeChecks(sellers),mode);
  if (sellerReview.mode !== 'rules') applyCheckReview(sellers,sellerReview);
  prepared.fallback = roleRules(ctx,'source_fallback',() => planFallback(ctx,offers,verified,sellers));
  const fallbackRows = prepared.fallback.items.map(i => ({id:`fallback-${i.pid}`,status:i.status,inspected:i.inspected,pending:!!i.nextJob}));
  const fallbackReview = options.efficientAi && !prepared.fallback.jobs.length
    ? skipRoleAi(ctx,'source_fallback','no fallback jobs')
    : await runRoleAi(ctx,'source_fallback',fallbackRows,mode);
  if (!options.replay) {
    const allowed = new Set(fallbackReview.findings.filter(f => f.action === 'none').map(f => f.id));
    prepared.fallback.jobs = prepared.fallback.jobs.filter(job => {
      const item = prepared.fallback.items.find(i => i.nextJob === job.id);
      if (allowed.has(`fallback-${item?.pid}`)) return true;
      if (item) { item.status='held-by-ai';item.reason='대체 탐색 AI 검토 보류 또는 미완료'; }
      return false;
    });
    writeJson(dir,'fallback-results.json',prepared.fallback);
  }
  writeJson(dir,'verified-offers.json',envelope(ctx,verified)); writeJson(dir,'seller-checks.json',envelope(ctx,sellers));
  return prepared;
}
export async function runAgents(dir, options = {}) {
  writeJson(dir, 'agent-state.json', { version: 'cream-agents-v1', at: options.now || new Date().toISOString(), status: 'running' });
  try {
  const prepared = options.roleAi ? await prepareAgentTeam(dir,options) : prepareAgents(dir, options);
  const { ctx, offers, verified, sellers } = prepared;
  const legacy = options.legacy || readJson(dir, 'final-legacy.json', readJson(dir, 'final-all.json'));
  if (!legacy?.rows) throw new Error('최종 감사 입력(final-all.json) 없음');
  // Persist baseline before writing the new final. Standalone reruns reuse this baseline.
  writeJson(dir, 'final-legacy.json', legacy);
  let final = roleRules(ctx,'final_auditor',() => auditFinal(ctx, offers, verified, sellers, legacy));
  let review = null;
  if (options.roleAi) review = await runRoleAi(ctx,'final_auditor',safeChecks(readJson(dir,'audit.json').items.filter(i => !options.efficientAi || i.status !== 'excluded')),options);
  else if (options.llm) review = await reviewWithLlm(ctx, readJson(dir, 'audit.json'), options);
  if (options.roleAi) {
    const existing = readJson(dir,'outcomes.json',{});
    if (options.efficientAi) skipRoleAi(ctx,'outcome_tracker','deterministic snapshot and due-date rules');
    else await runRoleAi(ctx,'outcome_tracker',[{id:'outcomes',phase:'precommit',rows:final.rows.length,reviewedCandidates:final.rows.filter(r => r['판정'] === '후보').length,recordedSnapshots:existing.snapshots?.length || 0,due:existing.due?.length || 0,changesApplied:false}],options);
  }
  const completedAt = options.clock ? options.clock() : options.now || new Date().toISOString();
  if (completedAt !== ctx.now || options.roleAi) {
    // AI review can outlive a price/stock snapshot. Re-run mandatory checks at commit time.
    const latest = prepareAgents(dir, { ...options, now: completedAt, runId: ctx.runId });
    // Apply model restrictions again after deterministic freshness revalidation.
    if (options.roleAi && !options.replay) {
      const team = readJson(dir,'agents-team-ai.json');
      applyCheckReview(latest.verified,team.roles.offer_verifier);
      if (team.roles.seller_verifier.mode !== 'rules') applyCheckReview(latest.sellers,team.roles.seller_verifier);
    }
    Object.assign(prepared, latest); Object.assign(ctx, latest.ctx);
    final = roleRules(ctx,'final_auditor',() => auditFinal(ctx, latest.offers, latest.verified, latest.sellers, legacy));
  }
  if (review && review.mode !== 'offline-replay') {
    if (options.roleAi) review = currentReview(review,safeChecks(readJson(dir,'audit.json').items.filter(i => !options.efficientAi || i.status !== 'excluded')));
    final = applyLlmReview(final, review);
    const audit = readJson(dir, 'audit.json'), byId = new Map(final.rows.map((r) => [r['옵션ID'], r]));
    for (const item of audit.items) { const row = byId.get(item.id); if (row) { item.status = row['검증상태']; item.llmFinding = review.findings.find((f) => f.id === item.id) || null; } }
    writeJson(dir, 'audit.json', audit);
  }
  const batches = evaluateBatches(ctx, final);
  if (batches) {
    final.meta.수량검토 = { options: batches.items.length, source: 'batch-scenarios.json' };
    prepared.fallback = planFallback(ctx, prepared.offers, prepared.verified, prepared.sellers, new Set(final.rows.filter(r => r['판정'] === '후보').map(r => r['옵션ID'])));
    const audit = readJson(dir, 'audit.json'), rowsById = new Map(final.rows.map(r => [r['옵션ID'], r]));
    for (const item of audit.items) { const row = rowsById.get(item.id); if (row && row['검증사유코드'].includes('BATCH_UNCONFIRMED')) { item.status = 'hold'; item.issues.push({ code: 'BATCH_UNCONFIRMED', detail: row['수량검토'] }); } }
    writeJson(dir, 'audit.json', audit);
  }
  // All model calls finish before the last freshness check and immutable snapshot.
  if (options.roleAi) {
    const team = teamSummary(ctx);
    if (!options.replay && !team.roles.every(r => ['done','skipped_by_policy'].includes(r.ai))) {
      for (const row of final.rows.filter(r => r['판정'] === '후보')) { row['판정']='사람 검토';row['검증상태']='hold';row['검증사유코드'] += ' · AGENT_TEAM_INCOMPLETE';row['사유'] += ' / 필수 6개 에이전트 팀 실행 미완료'; }
    }
  }
  const outcomes = roleRules(ctx,'outcome_tracker',() => trackOutcomes(ctx,final));
  if (options.roleAi) final.meta.에이전트팀 = teamSummary(ctx);
  final.meta.성과스냅샷수 = outcomes.snapshots; final.meta.AI검토 = options.roleAi ? options.replay ? '6역할 재생(모델 미호출)' : options.efficientAi ? `6개 규칙 역할 + ${options.providerId === 'claude' ? 'Claude API' : 'Codex CLI'} 선택 호출` : '6개 역할: gpt-6.1-sol / high' : options.llm ? 'Codex CLI: gpt-6.1-sol / high' : '규칙 검증(LLM 미호출)';
  writeJson(dir, 'final-all.json', final);
  writeJson(dir, 'agent-state.json', envelope(ctx, [], { status: options.roleAi && !options.replay && !teamSummary(ctx).complete ? 'needs-attention' : 'done', inputHash: hash([prepared.offers, ctx.evidence, ctx.policy]),
    counts: { offers: prepared.offers.length, options: prepared.verified.length, candidates: final.rows.filter((r) => r['판정'] === '후보').length, review: final.rows.filter((r) => r['판정'] === '사람 검토').length, fallbackPending: prepared.fallback.jobs.length } }));
  return { ...prepared, final };
  } catch (error) {
    writeJson(dir, 'agent-state.json', { version: 'cream-agents-v1', at: new Date().toISOString(), status: 'failed', error: error.message });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dir = process.argv[2], mode = process.argv[3] || 'finalize';
  if (!dir || !fs.existsSync(dir)) { console.error('사용: node agents-run.mjs <실행폴더> [prepare|finalize|incident] [--llm]'); process.exitCode = 1; }
  else { let release;
   try {
    release = acquireRunLock(dir);
    const efficientAi = process.argv.includes('--claude-efficient') || process.argv.includes('--codex-efficient');
    const aiOptions = {roleAi:!process.argv.includes('--rules-only'),replay:process.argv.includes('--replay'),efficientAi,
      ...(process.argv.includes('--claude-efficient') ? {roleProvider:invokeClaude,modelForRole:claudeModelForRole,providerId:'claude'} : {}),
      onRole:e => console.log(`agent ${e.role}: ${e.status}`)};
    if (mode === 'prepare') { const r = aiOptions.roleAi ? await prepareAgentTeam(dir,aiOptions) : prepareAgents(dir); console.log(`판매처 ${r.offers.length} / 대기 작업 ${r.fallback.jobs.length}`); }
    else if (mode === 'incident') console.log(JSON.stringify(recordIncident(dir), null, 2));
    else if (mode === 'finalize') { const r = await runAgents(dir, aiOptions); console.log(`에이전트 완료: ${r.final.rows.length}행 / 후보 ${r.final.rows.filter((r) => r['판정'] === '후보').length}`); if (aiOptions.roleAi && !aiOptions.replay && !r.final.meta.에이전트팀.complete) process.exitCode=1; }
    else throw new Error(`알 수 없는 모드: ${mode}`);
   } catch (e) { if (release) { try { recordIncident(dir, e, '에이전트'); } catch (diagnostic) { console.error(`진단 기록 실패: ${diagnostic.message}`); } } console.error(e.message); process.exitCode = 1; }
   finally { if (release) release(); }
  }
}
