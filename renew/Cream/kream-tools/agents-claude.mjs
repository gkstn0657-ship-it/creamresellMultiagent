// Stateless, structured Claude review. Only the allowlisted rows from agents-team.mjs reach this module.
const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings'], properties: {
    findings: {type: 'array', items: {type: 'object', additionalProperties: false,
      required: ['id', 'action', 'reason'], properties: {
        id: {type: 'string'}, action: {type: 'string', enum: ['none', 'hold', 'exclude']}, reason: {type: 'string'}
      }}}
  }
};

export function claudeModelForRole(role, rows, env = process.env) {
  if (role === 'final_auditor') {
    const highRisk = rows.some(row => (row.risk || []).reduce((sum, point) => sum + (point.pts || 0), 0) >= 7);
    return highRisk ? (env.CREAM_CLAUDE_OPUS_MODEL || 'claude-opus-5-5') : (env.CREAM_CLAUDE_SONNET_MODEL || 'claude-sonnet-5-5');
  }
  return env.CREAM_CLAUDE_HAIKU_MODEL || 'claude-haiku-5-5';
}

export async function invokeClaude(request, options = {}) {
  const key = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is missing');
  const model = options.model || claudeModelForRole(request.role, request.rows);
  const body = {
    model, max_tokens: Math.min(options.maxTokens || 2000, 4096),
    system: `${options.instructions || ''}\nReturn exactly one finding for every input id. Never invent evidence, raise an approval, order, bid, or purchase.`,
    messages: [{role: 'user', content: JSON.stringify(request)}],
    output_config: {format: {type: 'json_schema', schema: FINDINGS_SCHEMA}}
  };
  const response = await (options.fetchImpl || fetch)('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: {'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key},
    body: JSON.stringify(body), signal: AbortSignal.timeout(options.timeoutMs || 45000)
  });
  if (!response.ok) throw new Error(`Claude API HTTP ${response.status}`);
  const message = await response.json();
  if (message.stop_reason !== 'end_turn') throw new Error(`Claude incomplete: ${message.stop_reason || 'unknown'}`);
  const block = message.content?.find(item => item.type === 'text');
  if (!block) throw new Error('Claude returned no text');
  const output = JSON.parse(block.text);
  Object.defineProperty(output, '_usage', {value: {
    model: message.model || model,
    input_tokens: message.usage?.input_tokens || 0,
    output_tokens: message.usage?.output_tokens || 0,
    cache_creation_input_tokens: message.usage?.cache_creation_input_tokens || 0,
    cache_read_input_tokens: message.usage?.cache_read_input_tokens || 0
  }, enumerable: false});
  return output;
}
