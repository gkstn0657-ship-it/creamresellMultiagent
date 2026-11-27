import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, writeJson } from './agents-core.mjs';

const directory = 'agent-token-usage';
const keys = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens'];

export function measuredUsage(raw) {
  if (!raw || !keys.some(key => Number.isSafeInteger(raw[key]) && raw[key] >= 0)) return null;
  return Object.fromEntries(keys.map(key => [key, Number.isSafeInteger(raw[key]) && raw[key] >= 0 ? raw[key] : null]));
}

// One atomic file per actual CLI attempt. A crash leaves a visible open attempt;
// cached results and repeated writes of the same receipt never create another call.
export function tokenAttempt(ctx, role, requestHash, inputChars, model = 'gpt-6.1-sol', provider = 'codex') {
  const attemptId = randomUUID();
  const file = path.join(directory, attemptId + '.json');
  const receipt = {attemptId, runId:ctx.runId, role, requestHash, inputChars,
    model, provider, reasoning:provider === 'codex' ? 'high' : null, startedAt:new Date().toISOString(), status:'started', usage:null};
  writeJson(ctx.dir, file, receipt);
  return {
    receipt,
    observed(raw) {
      receipt.usage = measuredUsage(raw);
      writeJson(ctx.dir, file, receipt);
    },
    finish(status, raw) {
      receipt.status = status;
      receipt.finishedAt = new Date().toISOString();
      receipt.usage = measuredUsage(raw) || receipt.usage;
      writeJson(ctx.dir, file, receipt);
    },
  };
}

// Older batch reports contain only the latest run. Preserve its surviving
// receipts before replacement; missing usage is explicitly unknown.
export function preserveLegacyUsage(dir, report) {
  if (!report?.runId || report.receiptVersion === 1) return;
  const known = report.usage || [];
  for (let index = 0; index < Math.max(known.length, report.calls || 0); index++) {
    const item = known[index];
    if (item?.attemptId) continue;
    const attemptId = 'legacy-' + hash([report.runId, index]);
    const file = path.join(directory, attemptId + '.json');
    if (!fs.existsSync(path.join(dir, file))) {
      writeJson(dir, file, {attemptId, runId:report.runId, role:item?.role || null,
        model:item?.model || report.roles?.[item?.role]?.model || null, reasoning:null, status:'legacy', usage:measuredUsage(item)});
    }
    known[index] = {...item, role:item?.role || null, attemptId};
  }
  report.usage = known;
  report.receiptVersion = 1;
}
