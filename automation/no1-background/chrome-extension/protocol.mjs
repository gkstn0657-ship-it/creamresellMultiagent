import {projectHistory,projectMarginSettings,projectDisplayedSchema} from './schema-data.mjs';
import {validRankingRequest,projectRankingSettings,projectRankingProducts} from './ranking-data.mjs';
export const RELAY_URL = 'wss://relay.certi.life/ws/v2';
export const CLIENT_VERSION = '1.35.8';
export const CONNECTOR_VERSION = '0.8.0';
export const PRODUCT_COMMANDS = Object.freeze(['musinsa:ranking:settings','musinsa:ranking:products','mecro:inventory:search', 'stock:check', 'market:kream:prices', 'market:kream:details', 'market:kream:trades', 'market:kream:askPreviewBatch', 'market:kream:history:start', 'market:kream:displayed-schema', 'musinsa:product:benefit']);
export const COMMANDS = Object.freeze(['stock:supportedSites', 'musinsa:ranking:check-login', 'settings:get', 'platform:status', 'market:margin-settings', ...PRODUCT_COMMANDS]);
const errorCodes = new Set(['NO_ELECTRON_CONNECTED', 'ELECTRON_DISCONNECTED', 'ELECTRON_OFFLINE', 'ELECTRON_SEND_FAILED', 'RECONNECTING', 'CMD_NOT_FOUND', 'REMOTE_COMMAND_FORBIDDEN', 'MAINTENANCE', 'TIMEOUT', 'NO1_AUTH_REQUIRED', 'NO1_WEB_TAB_REQUIRED', 'NO1_MULTIPLE_WEB_SESSIONS', 'NO1_BROWSER_ACCESS_FAILED', 'NO1_RELAY_CONNECTION_FAILED', 'NO1_RELAY_CLOSED', 'NO1_RELAY_TIMEOUT', 'NO1_INVALID_RESPONSE', 'NO1_COMMAND_FORBIDDEN', 'NO1_INVALID_PAYLOAD', 'NO1_BRIDGE_TIMEOUT', 'NO1_BRIDGE_DISCONNECTED', 'NO1_BRIDGE_BUSY', 'NO1_CONNECTION_STOPPED', 'NO1_BRIDGE_NOT_CONFIGURED', 'NO1_BRIDGE_UNAVAILABLE', 'NO1_INVALID_BRIDGE_CONFIG', 'NO1_PRODUCT_QUERIES_UNVERIFIED']);

export function safeCode(code) { return errorCodes.has(code) ? code : 'NO1_REMOTE_ERROR'; }
for (const code of ['NO1_BACKGROUND_MODE_REQUIRED', 'NO1_PLATFORM_LOGIN_REQUIRED', 'NO1_IDENTITY_MISMATCH', 'NO1_OPTION_NOT_FOUND', 'NO1_CONNECTOR_UPDATE_REQUIRED', 'MUSINSA_LOGIN_REQUIRED', 'MUSINSA_BENEFIT_FETCH_FAILED', 'STOCK_CHECK_FAILED', 'KREAM_LOGIN_REQUIRED', 'KREAM_TOKEN_EXPIRED', 'NO1_UPSTREAM_LOOKUP_FAILED']) errorCodes.add(code);
errorCodes.add('NO1_RANKING_SETTINGS_UNAVAILABLE');
errorCodes.add('MUSINSA_RANKING_ERROR');
const id = value => typeof value === 'string' && /^\d{1,12}$/.test(value);
errorCodes.add('KREAM_SEARCH_FAILED');
for(const code of ['NO1_SCHEMA_AMBIGUOUS','NO1_SCHEMA_NOT_AVAILABLE','NO1_HISTORY_TIMEOUT'])errorCodes.add(code);
const keys = (value, allowed, required) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.includes(key));
export function validateCommand(cmd, payload) {
  if (!COMMANDS.includes(cmd)) throw Error('NO1_COMMAND_FORBIDDEN');
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw Error('NO1_INVALID_PAYLOAD');
  let valid;
  if (cmd === 'musinsa:ranking:products') valid = validRankingRequest(payload);
  else if (cmd === 'mecro:inventory:search') valid = keys(payload, ['keyword','cursor'], ['keyword','cursor']) && (payload.keyword === ' ' || typeof payload.keyword === 'string' && payload.keyword.trim() === payload.keyword && /^[\p{L}\p{N}][\p{L}\p{N} ._()/+-]{0,99}$/u.test(payload.keyword)) && typeof payload.cursor === 'string' && /^\d{1,12}$/.test(payload.cursor);
  else if (cmd === 'stock:check') valid = keys(payload, ['url'], ['url']) && typeof payload.url === 'string' && /^https:\/\/www\.musinsa\.com\/products\/\d{1,12}$/.test(payload.url);
  else if (cmd === 'market:kream:prices') valid = keys(payload, ['productCode', 'size'], ['productCode']) && id(payload.productCode) && (payload.size === undefined || typeof payload.size === 'string' && payload.size.length > 0 && payload.size.length <= 64 && payload.size.trim() === payload.size && !/[\x00-\x1f]/.test(payload.size));
  else if (cmd === 'market:kream:details') valid = keys(payload, ['productCode', 'includeFastDelivery'], ['productCode', 'includeFastDelivery']) && id(payload.productCode) && typeof payload.includeFastDelivery === 'boolean';
  else if (cmd === 'market:kream:history:start') valid = keys(payload,['productCode','useSharedSales30d'],['productCode','useSharedSales30d'])&&id(payload.productCode)&&payload.useSharedSales30d===true;
  else if (cmd === 'market:kream:displayed-schema') valid = keys(payload,['productCode'],['productCode'])&&id(payload.productCode);
  else if (cmd === 'market:kream:trades') valid = keys(payload, ['productCode', 'cursor', 'size'], ['productCode', 'cursor']) && id(payload.productCode) && typeof payload.cursor === 'string' && /^[A-Za-z0-9_=-]{1,200}$/.test(payload.cursor) && (payload.size === undefined || typeof payload.size === 'string' && /^[A-Za-z0-9._() /-]{1,64}$/.test(payload.size));
  else if (cmd === 'market:kream:askPreviewBatch') valid = keys(payload, ['productCode','items'], ['productCode','items']) && id(payload.productCode) && Array.isArray(payload.items) && payload.items.length > 0 && payload.items.length <= 3 && payload.items.every(x => x && keys(x,['option','price','isInstant'],['option','price','isInstant']) && typeof x.option === 'string' && /^[A-Za-z0-9._() /-]{1,64}$/.test(x.option) && Number.isSafeInteger(x.price) && x.price > 0 && x.price <= 100000000 && typeof x.isInstant === 'boolean');
  else if (cmd === 'musinsa:product:benefit') valid = keys(payload, ['productId'], ['productId']) && id(payload.productId);
  else if (cmd === 'platform:status') valid = keys(payload, ['platform'], ['platform']) && payload.platform === 'kream';
  else valid = Object.keys(payload).length === 0;
  if (!valid) throw Error('NO1_INVALID_PAYLOAD');
}
const numberOrNull = value => value === null || value === undefined ? null : Number.isFinite(value) && value >= 0 ? value : (() => { throw Error('NO1_INVALID_RESPONSE'); })();
function safeTree(value, depth = 0) {
  if (depth > 8) throw Error('NO1_INVALID_RESPONSE');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') { if (value.length > 4000) throw Error('NO1_INVALID_RESPONSE'); return value; }
  if (Array.isArray(value)) { if (value.length > 1000) throw Error('NO1_INVALID_RESPONSE'); return value.map(item => safeTree(item, depth + 1)); }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key, item]) => item !== undefined && !/password|token|cookie|authorization|email|loginid|accountid|userid|phone|address|memberpoint/i.test(key)).map(([key, item]) => [key, safeTree(item, depth + 1)]));
  return null;
}
export function projectData(cmd, data, payload = {}) {
  if (!data || typeof data !== 'object') throw Error('NO1_INVALID_RESPONSE');
  if(cmd==='musinsa:ranking:settings')return projectRankingSettings(data);
  if(cmd==='musinsa:ranking:products')return projectRankingProducts(data);
  if(cmd==='market:kream:history:start')return projectHistory(data,payload);
  if(cmd==='market:margin-settings')return projectMarginSettings(data);
  if(cmd==='market:kream:displayed-schema')return projectDisplayedSchema(data,payload);
  if (cmd === 'mecro:inventory:search') {
    if (!Array.isArray(data.items) || data.items.length > 200) throw Error('NO1_INVALID_RESPONSE');
    const nextCursor=data.nextCursor == null ? null : String(data.nextCursor);
    if(nextCursor !== null && !/^\d{1,12}$/.test(nextCursor)) throw Error('NO1_INVALID_RESPONSE');
    return {items:data.items.map(row=>{
      if(!id(String(row.productCode)) || typeof row.titleKo!=='string' || typeof row.brandProductCode!=='string')throw Error('NO1_INVALID_RESPONSE');
      return {productCode:String(row.productCode),brandProductCode:row.brandProductCode.slice(0,100),titleKo:row.titleKo.slice(0,300),titleEn:String(row.titleEn||'').slice(0,300),totalSales:numberOrNull(row.totalSales),wishCount:numberOrNull(row.wishCount)};
    }),nextCursor};
  }
  if (cmd === 'market:kream:details') {
    if (!Array.isArray(data.sizeOptions) || data.sizeOptions.length > 1000 || !(data.colorway==null||typeof data.colorway === 'string')) throw Error('NO1_INVALID_RESPONSE');
    return {totalSales:numberOrNull(data.totalSales),colorway:data.colorway==null?null:data.colorway.slice(0,200),sizeOptions:data.sizeOptions.map(row=>{
      if(typeof row.size!=='string'||typeof row.option!=='string')throw Error('NO1_INVALID_RESPONSE');
      return {size:row.size,option:row.option,lowestNormal:numberOrNull(row.lowestNormal),highestBid:numberOrNull(row.highestBid),...(row.fastDeliveryPrice!==undefined?{fastDeliveryPrice:numberOrNull(row.fastDeliveryPrice)}:{})};
    })};
  }
  if (cmd === 'market:kream:trades') {
    if (!Array.isArray(data.items) || data.items.length > 1000 || typeof data.hasNext !== 'boolean') throw Error('NO1_INVALID_RESPONSE');
    const items=data.items.map(row=>{
      if(typeof row.date!=='string'||typeof row.size!=='string'||!Number.isFinite(Date.parse(row.date)))throw Error('NO1_INVALID_RESPONSE');
      return {date:row.date,price:numberOrNull(row.price),size:row.size,...(row.isImmediateDelivery===true?{isImmediateDelivery:true}:{})};
    });
    return {items,cursor:String(data.cursor),nextCursor:data.nextCursor==null?null:String(data.nextCursor),total:numberOrNull(data.total),hasNext:data.hasNext};
  }
  if (cmd === 'market:kream:askPreviewBatch') {
    if(!Array.isArray(data.previews)||!Array.isArray(data.failures)||data.previews.length>3)throw Error('NO1_INVALID_RESPONSE');
    const previews=data.previews.map(row=>{
      if(String(row.productCode)!==payload.productCode||!payload.items.some(x=>x.option===row.option&&x.price===row.price&&x.isInstant===row.isInstant))throw Error('NO1_IDENTITY_MISMATCH');
      return safeTree(Object.fromEntries(['productCode','option','price','isInstant','processingFee','authenticationFee','totalPayout','originalPayout','processingFeeTooltipMessage','hasFeeEvent'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]])));
    });
    return {previews,failures:data.failures.map(x=>({option:String(x.option||'').slice(0,64),code:String(x.code||'PREVIEW_FAILED').slice(0,100)}))};
  }
  if (cmd === 'platform:status') {
    if (!Array.isArray(data.sessions) || data.sessions.length !== 1 || data.sessions[0].platform !== 'kream' || !['active', 'logged_out', 'requires_2fa'].includes(data.sessions[0].status)) throw Error('NO1_INVALID_RESPONSE');
    return {sessions: [{platform: 'kream', status: data.sessions[0].status}]};
  }
  if (cmd === 'market:kream:prices') {
    if (!Array.isArray(data.prices) || data.prices.length > 1000) throw Error('NO1_INVALID_RESPONSE');
    return {prices: data.prices.map(row => {
      if (typeof row.size !== 'string' || typeof row.option !== 'string') throw Error('NO1_INVALID_RESPONSE');
      return {size: row.size, option: row.option, buyPrice: numberOrNull(row.buyPrice), sellPrice: numberOrNull(row.sellPrice), lastSalePrice: numberOrNull(row.lastSalePrice)};
    })};
  }
  if (cmd === 'stock:check') {
    if (data.status !== 'success') throw Error('NO1_UPSTREAM_LOOKUP_FAILED');
    if (data.siteType !== 'musinsa' || data.productNumber !== payload.url?.split('/').at(-1)) throw Error('NO1_IDENTITY_MISMATCH');
    if (typeof data.makerNumber !== 'string' || !Array.isArray(data.combinedOptions) || data.combinedOptions.length > 1000) throw Error('NO1_INVALID_RESPONSE');
    const fields = ['status', 'siteType', 'siteName', 'brand', 'name', 'productNumber', 'makerNumber', 'price', 'originalPrice', 'discountRate', 'purchaseLimit', 'sellStartDate', 'quantityKind', 'quantityReason', 'combinedOptions'];
    return Object.fromEntries(fields.filter(key => data[key] !== undefined).map(key => [key, safeTree(data[key])]));
  }
  if (cmd === 'musinsa:product:benefit') {
    if (String(data.productId) !== payload.productId || typeof data.styleNo !== 'string') throw Error('NO1_IDENTITY_MISMATCH');
    const fields = ['productId', 'styleNo', 'goodsSaleType', 'normalPrice', 'salePrice', 'maxBenefitPrice', 'maxBenefitPriceWithoutCartCoupon', 'hasCoupon', 'productCouponDiscount', 'productCouponTerms', 'quantityAnalysis', 'productCouponName', 'lowestPriceDiscount', 'cartCouponDiscount', 'cartCouponName', 'cartCouponKind', 'cartCouponValue', 'hasCartCoupon', 'cartCouponCandidates', 'potentialCartCouponDiscount', 'potentialCartCouponName', 'paymentInstantDiscountOptions', 'benefitFetchFailures', 'benefitScenarios', 'memberBenefits', 'restrictions'];
    const projected = Object.fromEntries(fields.filter(key => data[key] !== undefined).map(key => [key, safeTree(data[key])]));
    for (const key of ['normalPrice', 'salePrice', 'maxBenefitPrice']) projected[key] = numberOrNull(data[key]);
    return projected;
  }
  if (cmd === 'stock:supportedSites') {
    if (!Array.isArray(data.sites) || data.sites.length > 1000) throw Error('NO1_INVALID_RESPONSE');
    const sites = data.sites.map(site => {
      if (!site || typeof site.key !== 'string' || typeof site.name !== 'string' || site.key.length > 100 || site.name.length > 200) throw Error('NO1_INVALID_RESPONSE');
      return {key: site.key, name: site.name};
    });
    return {sites};
  }
  if (cmd === 'musinsa:ranking:check-login') {
    if (typeof data.isLoggedIn !== 'boolean') throw Error('NO1_INVALID_RESPONSE');
    return {isLoggedIn: data.isLoggedIn};
  }
  if (cmd === 'settings:get') {
    const settings = data.settings;
    if (!settings || typeof settings !== 'object') throw Error('NO1_INVALID_RESPONSE');
    const browser = settings.kreamApiBrowser ?? 'electron';
    if (!['electron', 'system-chrome'].includes(browser)) throw Error('NO1_INVALID_RESPONSE');
    return {kreamApiBrowser: browser, benefitAccountConfigured: typeof settings.benefitAccountId === 'string' && settings.benefitAccountId.length > 0};
  }
  throw Error('NO1_COMMAND_FORBIDDEN');
}
export function validateProjectedData(cmd, data, payload = {}) {
  if (cmd === 'settings:get') {
    if (!data || !['electron', 'system-chrome'].includes(data.kreamApiBrowser) || typeof data.benefitAccountConfigured !== 'boolean') throw Error('NO1_INVALID_RESPONSE');
    return {kreamApiBrowser: data.kreamApiBrowser, benefitAccountConfigured: data.benefitAccountConfigured};
  }
  return projectData(cmd, data, payload);
}

// Runs in the extension worker. The No1 token is sent only to the official relay.
// It is never part of the result and must never be logged or persisted.
export function relayRequest({cmd, payload = {}, token, Socket = WebSocket, timeoutMs = 20000, traceId = crypto.randomUUID()}) {
  validateCommand(cmd, payload);
  if (typeof token !== 'string' || !token || token.length > 16384 || /\s/.test(token)) return Promise.reject(Error('NO1_AUTH_REQUIRED'));
  const url = new URL(RELAY_URL);
  url.searchParams.set('token', token);
  url.searchParams.set('client', 'web');
  url.searchParams.set('cv', CLIENT_VERSION);
  url.searchParams.set('ua', globalThis.navigator?.userAgent || 'CreamNo1Bridge');
  return new Promise((resolve, reject) => {
    let socket; let settled = false;
    const history=cmd==='market:kream:history:start';let taskId=null,lastPartial=null;const buffered=[];
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (socket && socket.readyState < 2) { try { socket.close(1000); } catch {} }
      if (error) reject(Error(safeCode(error))); else resolve(value);
    };
    const timer = setTimeout(() => lastPartial?finish(null,{...lastPartial,errorCode:'NO1_HISTORY_TIMEOUT'}):finish(history?'NO1_HISTORY_TIMEOUT':'NO1_RELAY_TIMEOUT'), timeoutMs);
    const push=message=>{
      if(!history||message.type!=='PUSH'||message.v!==2||!['market:kream:history:partial','market:kream:history:final','market:kream:history:error'].includes(message.channel))return;
      const p=message.data;if(p?.productCode!==payload.productCode)return;
      if(taskId===null){if(buffered.length<50)buffered.push(message);return;}
      if(p.taskId!==taskId)return;
      if(message.channel.endsWith(':error')){if(lastPartial)finish(null,{...lastPartial,errorCode:safeCode(p.error?.code)});else finish(safeCode(p.error?.code));return;}
      try{const projected=projectHistory({productCode:p.productCode,taskId:String(p.taskId),stage:message.channel.endsWith(':final')?'final':'partial',mode:p.data?.mode,perSize:p.data?.perSize,cacheInfo:p.cacheInfo,meta:p.meta},payload);
        if(projected.stage==='final')finish(null,projected);else lastPartial=projected;
      }catch(e){finish(e.message);}
    };
    try { socket = new Socket(url.href); } catch { finish('NO1_RELAY_CONNECTION_FAILED'); return; }
    socket.addEventListener('open', () => {
      if (settled) return;
      try { socket.send(JSON.stringify({type: 'REQ', v: 2, traceId, cmd, payload})); }
      catch { finish('NO1_RELAY_CONNECTION_FAILED'); }
    });
    socket.addEventListener('message', event => {
      if (settled) return;
      if (typeof event.data !== 'string' || event.data.length > 1000000) { finish('NO1_INVALID_RESPONSE'); return; }
      let message; try { message = JSON.parse(event.data); } catch { finish('NO1_INVALID_RESPONSE'); return; }
      if (message?.type === 'PING' && message.v === 2) {
        try { socket.send(JSON.stringify({type: 'PONG', v: 2})); } catch { finish('NO1_RELAY_CONNECTION_FAILED'); }
        return;
      }
      if(message?.type==='PUSH'){push(message);return;}
      if (message?.type !== 'RES' || message.traceId !== traceId) return;
      if (message.v !== 2 || message.cmd !== cmd || typeof message.ok !== 'boolean') { finish('NO1_INVALID_RESPONSE'); return; }
      if (!message.ok) { finish(message.error?.code); return; }
      if(history){
        const value=message.data?.taskId;if(!['string','number'].includes(typeof value)||String(value).length>300){finish('NO1_INVALID_RESPONSE');return;}
        taskId=value;for(const p of buffered.splice(0))push(p);return;
      }
      try { finish(null, projectData(cmd, message.data, payload)); } catch (error) { finish(error.message); }
    });
    socket.addEventListener('error', () => finish('NO1_RELAY_CONNECTION_FAILED'));
    socket.addEventListener('close', event => finish([4001, 4003].includes(event.code) ? 'NO1_AUTH_REQUIRED' : 'NO1_RELAY_CLOSED'));
  });
}
