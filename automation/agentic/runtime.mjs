import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context, readJson, writeJson, hash, acquireRunLock, fresh, profit, money, normalizeSize, moneyInQuote, validateQuote } from '../../renew/Cream/kream-tools/agents-core.mjs';
import { collectOffers, locateDump } from '../../renew/Cream/kream-tools/agents-offers.mjs';
import { searchOffers } from '../../renew/Cream/kream-tools/margin-screen.mjs';
import { writeAutomationOutput } from '../report.mjs';
import { invokeAgent } from './codex-provider.mjs';
import { ROLES, TOOL_GUIDE, validateDecision } from './roles.mjs';
import { SourcingTools, evidenceFiles, inputDigest } from './tools.mjs';
import { parseNo1Benefits, validPointsSpend } from './benefits.mjs';
import { modelFromDump } from '../../kream-tools/model-evidence.mjs';

const DEFAULTS = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OBSERVATION_TOOLS = new Set(['discover','market_page','search_sources','catalog_page','inspect_offer','no1_market','no1_stock']);
export function reusableAction(receipt, tool, now, ttl) {
  return Boolean(receipt && (!OBSERVATION_TOOLS.has(tool) || fresh(receipt.at, now, ttl)));
}
export function validateConfig(input = {}) {
  const config = { ...DEFAULTS, ...input };
  for (const key of ['maxAgentCalls','maxToolActions','maxRecoveries','maxSameActionRetries','maxNoProgressTurns','agentTimeoutMs','pageTimeoutMs','maxPagesPerRun','maxNo1Queries','targetCount','freshnessMinutes']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw Error(`CONFIG_INVALID:${key}`);
  }
  if (config.targetCount > 500 || config.maxAgentCalls > 500 || config.maxToolActions > 2000) throw Error('CONFIG_LIMIT_INVALID');
  return config;
}
function initialize(dir, options, config) {
  fs.mkdirSync(dir, { recursive: true });
  if (options.ids && !fs.existsSync(path.join(dir, 'k50-ids.json'))) writeJson(dir, 'k50-ids.json', options.ids.map(String));
  const ids = readJson(dir, 'k50-ids.json', []);
  if (!Array.isArray(ids) || ids.some(id => !/^\d{1,12}$/.test(String(id))) || new Set(ids.map(String)).size !== ids.length) throw Error('PRODUCT_IDS_INVALID');
  const basePolicy = readJson(ROOT, 'sourcing-policy.json', readJson(ROOT, 'kream-runs/sourcing-five-20261108/agent-policy.json', {}));
  const policy = readJson(dir, 'agent-policy.json', basePolicy);
  // Eligibility is established by same-option evidence, not by ten mixed-size
  // trades or a brand-name blacklist. All final source/seller checks still run.
  writeJson(dir, 'agent-policy.json', { ...policy, eligibilityMode: 'option-evidence', exploreAllMatchedSellers: true });
  if (!fs.existsSync(path.join(dir, 'jobs.json'))) writeJson(dir, 'jobs.json', { jobs: [] });
  if (!fs.existsSync(path.join(dir, 'k50.json'))) writeJson(dir, 'k50.json', []);
  if (!fs.existsSync(path.join(dir, 'n-cards.json'))) writeJson(dir, 'n-cards.json', {});
  if (!fs.existsSync(path.join(dir, 'n-cat.json'))) writeJson(dir, 'n-cat.json', {});
  return readJson(dir, 'agentic-state.json') || { version: 'cream-agentic-v1', status: 'running', stage: 'planner',
    mode: options.mode || 'live', startedAt: new Date().toISOString(), calls: 0, toolActions: 0, recoveries: 0,
    noProgress: 0, events: [], decisions: [], completedActions: {}, retries: {}, pendingAction: null,
    failedAction: null, stageVisits: {}, configHash: hash(config), unresolved: [] };
}
function requestFor(dir, state, tools, options) {
  const ctx = tools.ctx(), offers = collectOffers(ctx), files = evidenceFiles(dir);
  const briefUrl = url => { try { return url.length > 350 ? new URL(url).origin + '/… (use offerId or catalogIndex)' : url; } catch { return url; } };
  const sourceDetails = offers.map(offer => {
    const { dump, file } = locateDump(ctx, offer);
    return { offerId: offer.id, file: dump ? file : null, at: dump?.at, title: dump?.title, url: dump?.url,
      stockProbe: dump?.stockProbe, excerpt: String(dump?.text || '').slice(0, 1800) };
  });
  const no1 = files.filter(file => file.startsWith('no1-')).map(file => ({ file, value: readJson(dir, file), ...(file.startsWith('no1-stock-') ? { benefits: parseNo1Benefits(readJson(dir, file)) } : {}) }));
  const schema = readJson(path.join(ROOT, 'renew/Cream/kream-tools'), 'agent-evidence.example.json');
  const calculated = readJson(dir, 'agentic-calculation.json');
  const calculation = calculated && { ...calculated, options: calculated.options.map(option => ({ ...option,
    row: Object.fromEntries(['판정','매입가(원)','판매처 배송비(원)','예상순수익(원)','하락가정 순수익(원)','수량검토','사유'].map(key => [key, option.row?.[key]])) })) };
  return { stage: state.stage, mode: state.mode, now: tools.now(), objective: '할인·마일리지·동일 옵션·수량까지 근거로 확인한 수익 상품 탐색. 확보 못한 정보는 명시하고 다음 탐색에 반영.',
    integrations: { no1: { transport: 'background-only', liveQueriesAvailable: false,
      reason: '사용자가 No1 창 표시·화면 조작을 금지함. 비화면 조회 연결은 아직 없으므로 No1 도구를 재시도하지 말고 판매처 원문 또는 보류로 진행.' } },
    targetCount: tools.config.targetCount, sources: options.sources || [], productIds: readJson(dir, 'k50-ids.json', []),
    products: ctx.products.map(p => { const dump = readJson(dir, `dump-K${p.id}.json`), parsed = modelFromDump(dump); return { ...p,
      identityAlreadyMatchedToOriginal: Boolean(p.model && parsed === p.model), originalModel: parsed,
      identityInstruction: parsed === p.model ? '모델번호는 원문과 이미 일치함. 모순이 없으면 재바인딩 불필요.' : '필요시 원문 확인' }; }), policy: ctx.policy,
    searchResults: Object.fromEntries(Object.entries(ctx.cards).map(([pid, card]) => [pid, { name: card.name, cards: card.cards,
      eligibleMatches: searchOffers(card).map((offer, index) => ({ ...offer, index, link: briefUrl(offer.link || '') })) }])),
    catalogs: Object.fromEntries(Object.entries(ctx.catalogs).map(([pid, cat]) => [pid, { usable: cat.usable, rows: cat.rows }])),
    offers: offers.map(({ product, ...offer }) => ({ ...offer, url: briefUrl(offer.url) })), sourceDetails, no1,
    evidenceFiles: files, evidenceSchema: schema, existingEvidence: ctx.evidence,
    benefitsReview: readJson(dir, 'benefit-assessments.json', {}), calculation,
    tools: Object.fromEntries(ROLES[state.stage].tools.map(name => [name, TOOL_GUIDE[name]])),
    availableStages: Object.fromEntries(Object.entries(ROLES).map(([key, value]) => [key, { model: value.model, purpose: value.instructions }])),
    failedAction: state.failedAction, progress: { calls: state.calls, toolActions: state.toolActions, stageVisits: state.stageVisits,
      remainingCalls: tools.config.maxAgentCalls - state.calls, remainingTools: tools.config.maxToolActions - state.toolActions,
      pageAndNo1Use: readJson(dir, 'agentic-tool-counts.json', {pages:0,no1:0}), maxPages: tools.config.maxPagesPerRun, maxNo1Queries: tools.config.maxNo1Queries },
    recentDecisions: state.decisions.slice(-4).map(d => ({ stage: d.stage, summary: d.summary, nextStage: d.nextStage, unresolved: d.unresolved })),
    recentResults: state.events.slice(-3),
    completedActions: Object.values(state.completedActions).map(x => ({ tool: x.tool, args: x.args, inputHash: x.inputHash })).slice(-30) };
}

export async function finalize(dir, state, tools, decision, options = {}) {
  const reviewed = readJson(dir, 'agentic-calculation.json');
  if (!reviewed) throw Error('CALCULATION_REQUIRED_BEFORE_AUDIT');
  const originalDigest = inputDigest(dir), unchanged = reviewed.inputHash === originalDigest;
  const calculation = await tools.calculate(), ctx = tools.ctx(), offers = collectOffers(ctx), at = tools.now();
  const reviews = new Map(decision.recommendations.map(item => [item.optionId, item]));
  if (decision.recommendations.some(item => !calculation.options.some(option => option.optionId === item.optionId))) throw Error('AUDIT_UNKNOWN_OPTION');
  const rows = calculation.options.map(option => {
    const row = option.row, offer = offers.find(o => o.id === option.offerId), review = reviews.get(option.optionId);
    const market = readJson(dir, `no1-market-${option.pid}.json`), quote = market?.sizes?.find(s => normalizeSize(s.size) === option.size);
    const reasons = [...option.issues.map(item => item.code)];
    if (row?.['판정'] !== '후보') reasons.push('PIPELINE_EVIDENCE_INCOMPLETE');
    if (!unchanged) reasons.push('AUDIT_INPUT_CHANGED');
    if (!review || review.decision !== 'clear') reasons.push(review?.decision === 'exclude' ? 'AUDITOR_EXCLUDED' : 'AUDITOR_HOLD');
    if (options.forceHold || state.mode === 'replay') reasons.push(state.mode === 'replay' ? 'HISTORICAL_REPLAY_ONLY' : 'AGENT_RUN_INCOMPLETE');
    if (!market || market.mode !== 'live-visible-ui' || market.kreamId !== option.pid || market.model !== offer?.model || market.identityVerifiedFromVisibleLink !== true) reasons.push('NO1_MARKET_UNVERIFIED');
    if (!fresh(market?.capturedAt, at, ctx.policy.freshnessMinutes) || !fresh(market?.dataAsOf, at, ctx.policy.freshnessMinutes)) reasons.push('NO1_MARKET_STALE');
    if (!money(quote?.instantBidKrw)) reasons.push('NO1_OPTION_BID_MISSING');
    const { dump, file } = offer ? locateDump(ctx, offer) : {};
    const ev = ctx.evidence.offers?.[offer?.id]?.[option.size], points = ev?.pointsUsed;
    let pointsUsed = 0;
    const pointText = String(dump?.text || '').split('\n').filter(line => /적립금|마일리지/.test(line) && !/사용 제외|사용 불가/.test(line)).join('\n');
    if (points) {
      if (!validPointsSpend(points, option.size, dump, file, row?.['매입가(원)'])) reasons.push('POINTS_SPEND_UNCONFIRMED');
      else pointsUsed = points.value;
    } else if (/사용|차감/.test(pointText)) reasons.push('POINTS_SPEND_UNCONFIRMED');
    const cashCost = money(row?.['매입가(원)']) && money(row?.['판매처 배송비(원)']) ? row['매입가(원)'] + row['판매처 배송비(원)'] : null;
    const pointsKnown = !reasons.includes('POINTS_SPEND_UNCONFIRMED');
    const instantProfit = pointsKnown && cashCost != null && money(quote?.instantBidKrw) ? profit(quote.instantBidKrw, cashCost + pointsUsed, ctx.policy) : null;
    const economicStressProfit = pointsKnown && cashCost != null && money(quote?.instantBidKrw) ? profit(Math.floor(quote.instantBidKrw * (1 - ctx.policy.stressPriceDrop)), cashCost + pointsUsed, ctx.policy) : null;
    if (instantProfit != null && instantProfit <= ctx.policy.minCashProfit) reasons.push('INSTANT_EXIT_UNPROFITABLE');
    if (economicStressProfit != null && economicStressProfit <= ctx.policy.minCashProfit) reasons.push('ECONOMIC_STRESS_UNPROFITABLE');
    const excluded = option.status === 'excluded' || review?.decision === 'exclude';
    return { optionId: option.optionId, kreamId: option.pid, model: offer?.model || '', size: option.size,
      sourceUrl: offer?.url || '', capturedAt: dump?.at || '', dataAsOf: market?.dataAsOf || '', no1CapturedAt: market?.capturedAt || '',
      sameSizeTrades30d: option.market.count, sourceStock: dump?.stockProbe?.results?.find(r => normalizeSize(r.size) === option.size)?.maxQty ?? null,
      sourceStockMeaning: 'selected-option UI limit; not warehouse inventory', checkoutCost: pointsKnown ? cashCost : null, existingPointsUsed: pointsKnown ? pointsUsed : null,
      instantBid: quote?.instantBidKrw ?? null, instantProfit, economicStressProfit, cashProfit: pointsKnown && cashCost != null && money(quote?.instantBidKrw) ? profit(quote.instantBidKrw, cashCost, ctx.policy) : null,
      newPointsEarned: null, status: excluded ? 'excluded' : reasons.length ? 'hold' : 'candidate', reasons: [...new Set(reasons)],
      audit: review || null, evidence: { source: file || null, no1: market ? `no1-market-${option.pid}.json` : null } };
  });
  for (const pid of readJson(dir, 'k50-ids.json', []).map(String)) if (!rows.some(row => row.kreamId === pid)) {
    const product = ctx.products.find(p => String(p.id) === pid);
    rows.push({ optionId: '', kreamId: pid, model: product?.model || '', size: '', sourceUrl: '', status: 'hold',
      sameSizeTrades30d: null, sourceStock: null, instantProfit: null, reasons: [!product?.model ? 'PRODUCT_IDENTITY_MISSING' : !ctx.cards[pid] ? 'SEARCH_MISSING' : 'SOURCE_EVIDENCE_INCOMPLETE'] });
  }
  const output = { version: 'cream-agentic-result-v1', at, engine: 'codex-cli-agents', mode: state.mode,
    summary: { total: rows.length, candidate: rows.filter(r => r.status === 'candidate').length, hold: rows.filter(r => r.status === 'hold').length,
      excluded: rows.filter(r => r.status === 'excluded').length, productsProcessed: readJson(dir, 'k50-ids.json', []).length,
      no1Observations: evidenceFiles(dir).filter(f => f.startsWith('no1-')).length,
      aiUsage: (state.aiAttempts || state.decisions).map(d => ({ stage: d.stage, model: d.model, effort: d.effort, status: d.status || 'done', ...(d.usage || {}) })) },
    rows, screeningSummary: calculation.margin, unresolved: [...new Set([...(options.forceHold ? state.unresolved : []), ...decision.unresolved])], sourceCoverage: calculation.sourceCoverage,
    benefitScenarios: calculation.benefits, auditInputHash: originalDigest, independentReview: { provider: 'Codex CLI', role: 'audit', model: ROLES.audit.model, effort: ROLES.audit.effort, completed: !options.forceHold } };
  writeJson(dir, 'agentic-final.json', output); writeAutomationOutput(dir, output, { xlsx: options.xlsx !== false });
  return output;
}

export async function runAgentic(dir, options = {}) {
  dir = path.resolve(dir); const config = validateConfig(options.config); fs.mkdirSync(dir, { recursive: true });
  const release = acquireRunLock(dir); let state;
  const save = () => writeJson(dir, 'agentic-state.json', { ...state, updatedAt: new Date().toISOString() });
  const emit = event => options.onEvent?.(event);
  try {
    state = initialize(dir, options, config);
    if (state.mode !== (options.mode || 'live')) throw Error('RESUME_MODE_MISMATCH');
    if (state.status === 'complete') {
      const final = readJson(dir, 'agentic-final.json');
      if (state.mode === 'live' && final?.summary?.candidate > 0) {
        const now = options.clock?.() || new Date().toISOString(), ttl = Math.min(config.freshnessMinutes, context(dir, {now}).policy.freshnessMinutes);
        if (!fresh(final.at, now, ttl) || final.rows.filter(r => r.status === 'candidate').some(row =>
          [row.capturedAt,row.dataAsOf,row.no1CapturedAt].some(at => !fresh(at, now, ttl)))) throw Error('COMPLETED_RESULT_STALE_START_NEW_RUN');
        if (final.auditInputHash !== inputDigest(dir)) throw Error('COMPLETED_INPUT_CHANGED_START_NEW_RUN');
      }
      return final;
    }
    if (state.configHash !== hash(config)) throw Error('RESUME_CONFIG_MISMATCH');
    const tools = options.tools || new SourcingTools(dir, { ...options, config });
    if (state.pendingAction) { state.events.push({ type: 'interrupted-action', ...state.pendingAction }); state.pendingAction = null; state.stage = 'planner'; }
    state.status = 'running'; save();
    while (state.calls < config.maxAgentCalls && state.toolActions < config.maxToolActions) {
      if (tools.stopped()) { state.status = 'stopped'; state.unresolved.push('STOP_REQUESTED'); save(); break; }
      if (state.noProgress >= config.maxNoProgressTurns || state.recoveries >= config.maxRecoveries) { state.unresolved.push('NO_PROGRESS_OR_RECOVERY_LIMIT'); break; }
      const beforeHash = inputDigest(dir), request = requestFor(dir, state, tools, options);
      state.calls++; state.stageVisits[state.stage] = (state.stageVisits[state.stage] || 0) + 1; save();
      const stage = state.stage;
      const attempt = { call: state.calls, stage, model: ROLES[stage].model, effort: ROLES[stage].effort, status: 'running' };
      state.aiAttempts ||= []; state.aiAttempts.push(attempt); save();
      emit({ type: 'agent-start', stage, model: ROLES[stage].model, effort: ROLES[stage].effort, call: state.calls });
      const heartbeat = setInterval(() => emit({ type: 'agent-wait', stage, call: state.calls }), 20000);
      let response, decision;
      try {
        response = await (options.provider || invokeAgent)(request, { timeoutMs: config.agentTimeoutMs });
        Object.assign(attempt, { model: response.model || attempt.model, effort: response.effort || attempt.effort, usage: response.usage, elapsedMs: response.elapsedMs });
        decision = validateDecision(response.decision, stage);
        attempt.status = 'done';
      } catch (error) {
        attempt.status = 'failed'; attempt.error = error.message;
        writeJson(dir, `agent-decisions/rejected-${String(state.calls).padStart(3, '0')}.json`, { stage, error: error.message, response: response || null });
        state.recoveries++; state.events.push({ type: 'agent-error', stage, message: error.message });
        state.unresolved.push(`${stage}: ${error.message}`); state.stage = stage === 'recovery' ? 'audit' : 'recovery'; save(); continue;
      } finally { clearInterval(heartbeat); }
      const record = { call: state.calls, stage, model: response.model || ROLES[stage].model, effort: response.effort || ROLES[stage].effort,
        usage: response.usage, elapsedMs: response.elapsedMs, inputHash: beforeHash, ...decision };
      state.decisions.push(record); writeJson(dir, `agent-decisions/turn-${String(state.calls).padStart(3, '0')}.json`, { request, response: record });
      emit({ type: 'agent-decision', stage, summary: decision.summary, actions: decision.actions.length });
      state.unresolved = [...new Set([...state.unresolved, ...decision.unresolved])];
      if (options.discoveryOnly && readJson(dir, 'k50-ids.json', []).length && !decision.actions.length && decision.nextStage !== 'discovery') {
        state.status = 'discovery_complete'; save(); return { dir, ids: readJson(dir, 'k50-ids.json', []), discovery: true };
      }
      if (decision.complete) {
        if (!readJson(dir, 'k50-ids.json', []).length) { state.unresolved.push('NO_PRODUCTS_DISCOVERED'); break; }
        const missingRole = ['identity','sourcing','benefits','valuation'].find(role => !state.decisions.some(d => d.stage === role));
        if (!options.discoveryOnly && readJson(dir, 'k50-ids.json', []).length && missingRole) { state.events.push({ type: 'validation-error', message: `SPECIALIST_REQUIRED:${missingRole}` }); state.stage = missingRole; save(); continue; }
        if (!readJson(dir, 'agentic-calculation.json')) { state.events.push({ type: 'validation-error', message: 'CALCULATION_REQUIRED_BEFORE_AUDIT' }); state.stage = 'valuation'; state.noProgress++; save(); continue; }
        const result = await finalize(dir, state, tools, decision, options);
        state.status = 'complete'; state.finishedAt = tools.now(); state.summary = result.summary; save(); return result;
      }
      let failed = false, newToolResult = false;
      for (const action of decision.actions) {
        if (state.toolActions >= config.maxToolActions) break;
        let tool = action.tool, args = JSON.parse(action.arguments), origin = stage;
        if (tool === 'retry') {
          if (stage !== 'recovery' || !state.failedAction) { state.events.push({ type: 'tool-error', message: 'NOTHING_TO_RETRY' }); failed = true; break; }
          const retryKey = hash([state.failedAction.tool, state.failedAction.args]);
          if ((state.retries[retryKey] || 0) >= config.maxSameActionRetries) { state.events.push({ type: 'tool-error', message: 'RETRY_LIMIT_REACHED' }); state.stage = 'audit'; failed = true; break; }
          state.retries[retryKey] = (state.retries[retryKey] || 0) + 1;
          ({ tool, args, origin } = state.failedAction);
        }
        const basis = inputDigest(dir), key = hash([tool, args, basis]);
        if (reusableAction(state.completedActions[key], tool, tools.now(), Math.min(config.freshnessMinutes, tools.ctx().policy.freshnessMinutes))) { state.events.push({ type: 'duplicate-action', tool, args, message: 'NO_NEW_EVIDENCE_EXPECTED' }); continue; }
        state.toolActions++; state.pendingAction = { key, tool, args, origin, inputHash: basis }; save();
        try {
          const result = await tools.execute(tool, args);
          newToolResult = true;
          writeJson(dir, `agent-tool-results/action-${String(state.toolActions).padStart(3, '0')}.json`, { ...state.pendingAction, result });
          const serialized = JSON.stringify(result);
          state.events.push({ type: 'tool-result', tool, args, result: serialized.length <= 16000 ? result : { excerpt: serialized.slice(0, 16000), truncated: true, fullResult: `agent-tool-results/action-${String(state.toolActions).padStart(3, '0')}.json` } });
          state.completedActions[key] = { tool, args, inputHash: basis, at: tools.now() };
          // Also suppress an identical repeat on the state produced by this action.
          state.completedActions[hash([tool, args, inputDigest(dir)])] = { tool, args, inputHash: inputDigest(dir), at: tools.now() };
          state.failedAction = null; state.pendingAction = null; save();
        } catch (error) {
          state.failedAction = { tool, args, origin, error: error.message }; state.pendingAction = null;
          state.events.push({ type: 'tool-error', ...state.failedAction }); state.stage = 'recovery'; state.recoveries++; failed = true; save(); break;
        }
      }
      if (!failed) state.stage = decision.nextStage;
      if (state.stage === 'audit' && readJson(dir, 'k50-ids.json', []).length) {
        state.stage = ['identity','sourcing','benefits','valuation'].find(role => !state.decisions.some(d => d.stage === role)) || 'audit';
      }
      state.noProgress = inputDigest(dir) === beforeHash && !newToolResult && state.stageVisits[stage] > 1 ? state.noProgress + 1 : 0;
      if (options.discoveryOnly && readJson(dir, 'k50-ids.json', []).length >= config.targetCount) {
        state.status = 'discovery_complete'; save(); return { dir, ids: readJson(dir, 'k50-ids.json', []), discovery: true };
      }
      save();
    }
    // A budget/STOP/error is an explicit incomplete result, never silent success.
    state.status = state.status === 'stopped' ? 'stopped' : 'needs_attention';
    if (!state.unresolved.length) state.unresolved.push('AGENT_OR_TOOL_LIMIT_REACHED');
    const toolsAtEnd = options.tools || new SourcingTools(dir, { ...options, config });
    if (!readJson(dir, 'agentic-calculation.json')) await toolsAtEnd.calculate();
    const result = await finalize(dir, state, toolsAtEnd, { recommendations: [], unresolved: state.unresolved }, { ...options, forceHold: true });
    state.summary = result.summary; save(); return result;
  } catch (error) { if (state && state.status !== 'complete') { state.status = 'failed'; state.error = error.message; save(); } throw error; }
  finally { release(); }
}
