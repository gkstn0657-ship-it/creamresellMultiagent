import { readJson, writeJson, envelope, hash, money, validTime } from './agents-core.mjs';

export function trackOutcomes(ctx, final) {
  const history = readJson(ctx.dir, 'outcomes.json', { snapshots: [], events: [] });
  const rows = final.rows.map((r) => ({ id: r['옵션ID'] || `legacy-${hash([r['크림ID'], r['상품명'], r['판매처 링크']]).slice(0, 20)}`,
    pid: String(r['크림ID']), verdict: r['판정'], source: r['판매처 링크'] || '', observedAt: r['관측시각'] || null,
    price: typeof r['매입가(원)'] === 'number' ? r['매입가(원)'] : null, estimatedProfit: typeof r['예상순수익(원)'] === 'number' ? r['예상순수익(원)'] : null }));
  const id = hash([rows, ctx.policy]);
  if (!history.snapshots.some((s) => s.id === id)) history.snapshots.push({ id, runId: ctx.runId, at: ctx.now, mode: 'simulation', rows });
  const known = new Set(history.events.map((e) => e.eventId)), incoming = readJson(ctx.dir, 'outcome-events.json', []);
  const targets = new Set(history.snapshots.flatMap((s) => s.rows.map((r) => r.id)));
  for (const e of incoming) {
    if (known.has(e.eventId)) { if (hash(history.events.find((x) => x.eventId === e.eventId).input) !== hash(e)) throw new Error(`성과 이벤트 ID 충돌: ${e.eventId}`); continue; }
    if (!e.eventId || !targets.has(e.optionId) || !validTime(e.at) || Date.parse(e.at) > Date.parse(ctx.now) || !['simulation', 'actual', 'review'].includes(e.kind) || !e.source) throw new Error('outcome-events.json: 대상·시각·구분·출처 검증 실패');
    let realizedProfit = null;
    if (e.kind === 'actual') {
      if (!money(e.settlement) || !money(e.purchaseCost) || !money(e.extraCost)) throw new Error('실거래 성과는 실제 정산액·매입원가·추가 비용이 모두 필요');
      realizedProfit = e.settlement - e.purchaseCost - e.extraCost;
    }
    if (e.kind === 'review' && (typeof e.valid !== 'boolean' || !history.snapshots.some((s) => s.id === e.snapshotId && Date.parse(s.at) <= Date.parse(e.at) && s.rows.some((r) => r.id === e.optionId)))) throw new Error('수동 검증 이벤트에는 valid 및 해당 시점의 snapshotId 필요');
    history.events.push({ eventId: e.eventId, optionId: e.optionId, kind: e.kind, at: e.at, realizedProfit, input: e }); known.add(e.eventId);
  }
  const due = [];
  for (const s of history.snapshots) for (const days of [7, 14]) {
    const dueAt = new Date(Date.parse(s.at) + days * 86400000).toISOString();
    if (Date.parse(dueAt) > Date.parse(ctx.now)) continue;
    for (const row of s.rows) if (!history.events.some((e) => e.optionId === row.id && Date.parse(e.at) >= Date.parse(dueAt))) due.push({ snapshotId: s.id, optionId: row.id, days, dueAt, source: row.source, status: '재관측 필요' });
  }
  const reviews = history.events.filter((e) => e.kind === 'review');
  const submitted = new Set(history.snapshots.flatMap((s) => s.rows.filter((r) => r.verdict === '후보').map((r) => r.id)));
  // Use the latest independent review per option; repeated reviews never inflate accuracy.
  const latest = new Map(); for (const e of [...reviews].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) latest.set(`${e.input.snapshotId}|${e.optionId}`, e);
  const wasCandidate = (e) => history.snapshots.find((s) => s.id === e.input.snapshotId)?.rows.find((r) => r.id === e.optionId)?.verdict === '후보';
  const candidateReviews = [...latest.values()].filter(wasCandidate), rejectedReviews = [...latest.values()].filter((e) => !wasCandidate(e));
  const valid = candidateReviews.filter((e) => e.input.valid).length;
  const actuals = history.events.filter((e) => e.kind === 'actual');
  writeJson(ctx.dir, 'outcomes.json', { version: 'cream-agents-v1', ...history, due });
  const report = envelope(ctx, [], { snapshots: history.snapshots.length, submitted: submitted.size, reviewedCandidates: candidateReviews.length,
    candidateAccuracy: candidateReviews.length ? valid / candidateReviews.length : null,
    reviewedNonCandidates: rejectedReviews.length, missedInReviewedNonCandidates: rejectedReviews.filter((e) => e.input.valid).length,
    actualTransactions: actuals.length, realizedProfit: actuals.reduce((n, e) => n + e.realizedProfit, 0),
    simulation: { snapshots: history.snapshots.length, note: '예상 이익이며 실제 정산 성과와 합산하지 않음' },
    proposals: candidateReviews.length < 30 ? ['검증 후보 30건 전에는 기준 변경을 보류하고 표본을 확보'] : ['오류 사유·실현 성과별 기준 변경안을 사람이 검토'],
    changesApplied: false });
  writeJson(ctx.dir, 'calibration-report.json', report); return report;
}
