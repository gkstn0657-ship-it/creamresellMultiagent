import {BackgroundClient} from './client.mjs';
import {safeCode} from './chrome-extension/protocol.mjs';
import {productProbeTool, probeProduct} from './product-probe.mjs';
const descriptors = [
  ['no1_background_status', 'Local connection status. Does not query No1 or operate any window.', null],
  ['no1_background_supported_sites', 'Read No1 supported-site metadata through its official relay. No desktop UI operations.', 'stock:supportedSites'],
  ['no1_background_musinsa_login', 'Read No1 Musinsa login status. Returns a boolean, never credentials. No login window is opened by this adapter.', 'musinsa:ranking:check-login'],
  ['no1_background_runtime_settings', 'Read only the KREAM browser type and whether a benefit account is configured. Credentials and account details are omitted.', 'settings:get']
];
export const backgroundTools = descriptors.map(([name, description]) => ({name, description, inputSchema: {type: 'object', properties: {}, additionalProperties: false}, annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: true}}));
backgroundTools.push(productProbeTool);
export function handlesBackgroundTool(name) { return name === productProbeTool.name || descriptors.some(([candidate]) => candidate === name); }
export async function dispatchBackground(req, client = new BackgroundClient()) {
  const entry = descriptors.find(([name]) => name === req.params?.name);
  const answer = (text, isError = false) => ({jsonrpc: '2.0', id: req.id, result: {content: [{type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text)}], isError}});
  if (req.id === undefined) return null;
  if (req.params?.name === productProbeTool.name) {
    try { return answer(await probeProduct(client, req.params.arguments)); }
    catch (error) { return answer(safeCode(error.message), true); }
  }
  if (!entry) return answer('NO1_COMMAND_FORBIDDEN', true);
  const args = req.params.arguments ?? {};
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) return answer('NO1_INVALID_PAYLOAD', true);
  try {
    const data = entry[2] ? await client.request(entry[2], {}) : await client.status();
    return answer({mode: entry[2] ? 'background-relay' : 'local-status', observedAt: new Date().toISOString(), productDataVerified: false, promotionAllowed: false, data});
  } catch (error) { return answer(safeCode(error.message), true); }
}
