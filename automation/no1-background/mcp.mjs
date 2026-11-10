import {BackgroundClient} from './client.mjs';
import {safeCode} from './chrome-extension/protocol.mjs';
import {productProbeTool, probeProduct} from './product-probe.mjs';
import {projectDisplayedSchema} from './chrome-extension/schema-data.mjs';
export const displayedSchemaTool = {
  name:'no1_background_displayed_schema',
  description:'Read the already-open matching No1 KREAM price table, including displayed margin/rate and its purchase/fee/tax/sale-mode inputs. No clicks, navigation, stock check or purchase. Requires Connector 0.6.0. A displayed margin does not verify sourcing availability or actual profit.',
  inputSchema:{type:'object',properties:{kreamId:{type:'string',pattern:'^\\d{1,12}$'}},required:['kreamId'],additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true}
};
const descriptors = [
  ['no1_background_status', 'Local connection status. Does not query No1 or operate any window.', null],
  ['no1_background_supported_sites', 'Read No1 supported-site metadata through its official relay. No desktop UI operations.', 'stock:supportedSites'],
  ['no1_background_musinsa_login', 'Read No1 Musinsa login status. Returns a boolean, never credentials. No login window is opened by this adapter.', 'musinsa:ranking:check-login'],
  ['no1_background_runtime_settings', 'Read only the KREAM browser type and whether a benefit account is configured. Credentials and account details are omitted.', 'settings:get']
];
export const backgroundTools = descriptors.map(([name, description]) => ({name, description, inputSchema: {type: 'object', properties: {}, additionalProperties: false}, annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: true}}));
backgroundTools.push(productProbeTool);
backgroundTools.push(displayedSchemaTool);
export function handlesBackgroundTool(name) { return name === displayedSchemaTool.name || name === productProbeTool.name || descriptors.some(([candidate]) => candidate === name); }
export async function dispatchBackground(req, client = new BackgroundClient()) {
  const entry = descriptors.find(([name]) => name === req.params?.name);
  const answer = (text, isError = false) => ({jsonrpc: '2.0', id: req.id, result: {content: [{type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text)}], isError}});
  if (req.id === undefined) return null;
  if (req.params?.name === displayedSchemaTool.name) {
    try {
      const args=req.params.arguments;
      if(!args||Object.keys(args).join(',')!=='kreamId'||typeof args.kreamId!=='string'||!/^\d{1,12}$/.test(args.kreamId))throw Error('NO1_INVALID_PAYLOAD');
      const payload={productCode:args.kreamId};
      const data=projectDisplayedSchema(await client.request('market:kream:displayed-schema',payload),payload);
      return answer({mode:'background-page-read',productId:args.kreamId,displayedValueVerified:data.available,
        sourceAvailabilityVerified:false,actualProfitVerified:false,purchaseAuthorized:false,data});
    } catch(error) { return answer(safeCode(error.message),true); }
  }
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
