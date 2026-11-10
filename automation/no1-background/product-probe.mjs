import {safeCode} from './chrome-extension/protocol.mjs';
import {marketEvidence} from './market-evidence.mjs';
import {matchMarketSize} from './size-binding.mjs';
const same = (left, right) => typeof left === 'string' && typeof right === 'string' && left.trim().toUpperCase().replace(/\s+/g, '') === right.trim().toUpperCase().replace(/\s+/g, '');
export const productProbeTool = {
  name: 'no1_background_product_probe',
  description: 'Query one KREAM product and one Musinsa product through the background relay after hidden-browser/login checks. Includes stock and benefit breakdown. No desktop UI actions or purchase approval. No1 stock internals may use an isolated guest cart.',
  inputSchema: {type: 'object', properties: {kreamId: {type: 'string', pattern: '^\\d{1,12}$'}, productUrl: {type: 'string', pattern: '^https://www\\.musinsa\\.com/products/\\d{1,12}$'}, model: {type: 'string'}, color: {type: 'string'}, option: {type: 'string'}}, required: ['kreamId', 'productUrl', 'model', 'color', 'option'], additionalProperties: false},
  annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: true}
};
export function validateProbeArgs(args) {
  if (!args || Object.keys(args).sort().join(',') !== 'color,kreamId,model,option,productUrl' || !/^\d{1,12}$/.test(args.kreamId) || typeof args.kreamId !== 'string' || typeof args.productUrl !== 'string' || !/^https:\/\/www\.musinsa\.com\/products\/\d{1,12}$/.test(args.productUrl)) throw Error('NO1_INVALID_PAYLOAD');
  for (const key of ['model', 'color', 'option']) if (typeof args[key] !== 'string' || !args[key] || args[key].length > 100 || args[key].trim() !== args[key] || /[\x00-\x1f]/.test(args[key])) throw Error('NO1_INVALID_PAYLOAD');
}
export async function probeProduct(client, args) {
  validateProbeArgs(args);
  const productId = args.productUrl.split('/').at(-1);
  const startedAt = new Date().toISOString();
  const local = await client.status();
  if (!['0.2.0','0.3.0','0.4.0','0.5.0','0.6.0'].includes(local.connectorVersion)) throw Error('NO1_CONNECTOR_UPDATE_REQUIRED');
  const settings = await client.request('settings:get');
  if (settings.kreamApiBrowser !== 'electron') throw Error('NO1_BACKGROUND_MODE_REQUIRED');
  const stock = await client.request('stock:check', {url: args.productUrl});
  if (!same(stock.makerNumber, args.model) || stock.productNumber !== productId) throw Error('NO1_IDENTITY_MISMATCH');
  const matching = stock.combinedOptions.filter(row => same(row.firstOption, args.color) && same(row.size, args.option));
  if (matching.length !== 1) throw Error('NO1_OPTION_NOT_FOUND');
  const selected = matching[0];
  const stockQuantity = Number.isSafeInteger(selected.limitedQty) && selected.limitedQty >= 0 ? selected.limitedQty : null;
  const errors = {};
  let benefits = null, market = null;
  try {
    benefits = await client.request('musinsa:product:benefit', {productId});
    if (!same(benefits.styleNo, args.model) || String(benefits.productId) !== productId) throw Error('NO1_IDENTITY_MISMATCH');
  } catch (error) { benefits = null; errors.benefits = safeCode(error.message); }
  try { market = await client.request('market:kream:prices', {productCode: args.kreamId}); }
  catch (error) { errors.market = safeCode(error.message); }
  let marketResearch=null;
  const binding=market?matchMarketSize({stock,productUrl:args.productUrl,kreamId:args.kreamId,sourceSize:args.option,prices:market.prices}):null;
  if(market&&['0.3.0','0.4.0','0.5.0','0.6.0'].includes(local.connectorVersion))marketResearch=await marketEvidence(client,{...args,option:binding?.price.size||args.option},market,{schema:local.connectorVersion==='0.6.0'});
  if(marketResearch)for(const [key,value] of Object.entries(marketResearch.errors))errors['market_'+key]=value;
  return {
    mode: 'background-relay', queryStatus: Object.keys(errors).length ? 'partial' : 'complete', errors, startedAt, observedAt: new Date().toISOString(), request: args,
    identity: {sourceProductVerified: true, sourceModelVerified: true, sourceOptionVerified: true, marketModelIndependentlyVerified: false, marketBinding: 'requested-product-id-and-matched-relay-response'},
    stock: {...stock, selectedOption: selected, selectedStockQuantity: stockQuantity}, benefits, market, marketResearch, sizeBinding:binding?.evidence||null,
    sourceDataAsOf: marketResearch?.sales30d?.cacheInfo?.fetchedAt||null, upstreamFreshnessConfirmed: false, actualCheckoutPriceConfirmed: false,
    promotionAllowed: false, decision: 'hold',
    missingFields: [...(benefits ? [] : ['benefitQuote']), ...(market ? [] : ['marketPrices']), ...(binding?[]:['marketSizeBinding']), 'marketModelIndependentEvidence', 'upstreamDataAsOf', ...(marketResearch?.trades?.coverageComplete?[]:['transactions30d']), ...(marketResearch?.selectedTrades?.coverageComplete?[]:['selectedOptionTransactions30d']), 'actualCheckoutPrice', 'shippingAndSellerFees', 'couponQuantityEligibilityAtCheckout',...Object.values(marketResearch?.errors||{})]
  };
}
