import fs from 'node:fs';
import path from 'node:path';
import { invokeCodex, validateFindings } from './agents-llm.mjs';
import { writeJson } from './agents-core.mjs';
const out = path.resolve(process.argv[2] || 'agent-model-smoke'); fs.mkdirSync(out, { recursive: true });
const start = Date.now();
// Fully synthetic, non-personal data. Never read browser dumps or credentials here.
const rows = [
  { id: 'synthetic-option-1', size: 'S', status: 'hold', issues: ['PRICE_UNCONFIRMED'], marketCount: 3, risk: [{ name: '가격 확정성', pts: 2 }] },
  { id: 'synthetic-option-2', size: 'M', status: 'hold', issues: ['MODEL_MISMATCH'], marketCount: 5, risk: [{ name: '상품 일치', pts: 2 }] },
];
let result;
try {
  const answer = await invokeCodex({ rows }, { timeoutMs: 45000 });
  const findings = validateFindings(answer, new Set(rows.map((r) => r.id)));
  result = { at: new Date().toISOString(), model: 'gpt-6.1-sol', reasoning: 'high', status: 'passed', calls: 1, elapsedMs: Date.now() - start, inputChars: JSON.stringify({ rows }).length,
    usage: answer._usage || null, monetaryCost: null, costNote: 'CLI가 금액을 제공하지 않으면 비용을 추정하지 않음', syntheticOnly: true, findings };
} catch (e) {
  result = { at: new Date().toISOString(), model: 'gpt-6.1-sol', reasoning: 'high', status: 'failed', calls: 1, elapsedMs: Date.now() - start, syntheticOnly: true, error: e.message };
  process.exitCode = 1;
}
writeJson(out, 'model-smoke.json', result); console.log(JSON.stringify(result));
