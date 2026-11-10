import {backgroundTools, handlesBackgroundTool, dispatchBackground} from '../no1-background/mcp.mjs';
import {assertNo1UiAllowed} from './ui-policy.mjs';
import fs from 'node:fs';import path from 'node:path';import readline from 'node:readline';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';import {dispatch as prior} from './server-general.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
export const stockTool={name:'no1_search_stock_estimate',description:'Query No1 stock lookup UI for a Musinsa product. Clears previous displayed result, verifies result URL/model/color/option and returns visible maximum-benefit estimate, stock and verbatim benefit conditions. Never checkout price or approval. Existing stock lookup page must be open. Uses result Copy link and replaces clipboard.',inputSchema:{type:'object',properties:{productUrl:{type:'string',pattern:'^https://www\\.musinsa\\.com/products/[0-9]+$'},model:{type:'string'},color:{type:'string'},option:{type:'string'}},required:['productUrl','model','color','option'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true}};
export function validateStockArgs(a){if(!a||Object.keys(a).sort().join(',')!=='color,model,option,productUrl'||!/^https:\/\/www\.musinsa\.com\/products\/\d+$/.test(a.productUrl)||!['model','color','option'].every(k=>typeof a[k]==='string'&&a[k].trim()===a[k]&&a[k].length>0&&a[k].length<=100&&!/[\x00-\x1f]/.test(a[k])))throw Error('INVALID_STOCK_REQUEST');}
export function validateStockEvidence(e,a,now=Date.now()) {
 validateStockArgs(a);
 if(!['productUrl','model','color','option'].every(k=>e[k]===a[k])||e.identityVerified!==true||e.resultUrlVerifiedFromCopy!==true||e.previousResultCleared!==true)throw Error('STOCK_IDENTITY_MISMATCH');
 if(!Number.isSafeInteger(e.stockQuantity)||e.stockQuantity<0||!Array.isArray(e.benefitConditionsVerbatim)||!e.benefitConditionsVerbatim.length||e.benefitConditionsVerbatim.some(s=>typeof s!=='string'))throw Error('STOCK_ESTIMATE_INCOMPLETE');
 const loginRequired=e.benefitStatus==='login-required';
 if(loginRequired) {
   if(e.maximumBenefitPriceKrw!==null || !e.benefitConditionsVerbatim.some(s=>/Musinsa에 로그인하시면.*최대혜택가/.test(s)))throw Error('BENEFIT_LOGIN_STATE_INVALID');
 } else if(!Number.isSafeInteger(e.maximumBenefitPriceKrw)||e.maximumBenefitPriceKrw<0)throw Error('STOCK_ESTIMATE_INCOMPLETE');
 const times=['queryStartedAt','queryCompletedAt','capturedAt'].map(k=>Date.parse(e[k]));
 if(times.some(t=>!Number.isFinite(t)||t>now||now-t>600000)||times[0]>times[1]||times[1]>times[2])throw Error('STOCK_RESULT_STALE');
 return {...e,benefitStatus:loginRequired?'login-required':'available',mode:'live-visible-ui',priceType:loginRequired?'unavailable':'maximum-benefit-estimate',actualCheckoutPriceConfirmed:false,upstreamFreshnessConfirmed:false,manualPurchasePriceUsed:false,no1DisplayedMarginUsed:false,decision:'hold',promotionAllowed:false,missingFields:[...(loginRequired?['benefitLogin','maximumBenefitPrice']:[]),'actualCheckoutPrice','benefitEligibilityAtCheckout','sellerIdentity','shippingCost','upstreamDataAsOf']};
}
async function dispatchLegacy(req){if(req.method==='tools/list'){const r=await prior(req);r.result.tools.push(stockTool);return r;}if(req.method==='tools/call'&&req.params?.name===stockTool.name){try{validateStockArgs(req.params.arguments);assertNo1UiAllowed();if(!process.argv.includes('--enable-live-ui'))throw Error('LIVE_ACCESS_DISABLED');if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');const script=fs.readFileSync(path.join(here,'search-stock-estimate.ps1'),'utf8');const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,env:{...process.env,NO1_UI_REQUEST:JSON.stringify(req.params.arguments)},encoding:'utf8',timeout:40000,maxBuffer:100000});if(r.error)throw Error('STOCK_UI_TIMEOUT_OR_START_FAILURE');let e;try{e=JSON.parse(r.stdout.replace(/^\uFEFF/,''));}catch{throw Error('STOCK_UI_INVALID_RESPONSE');}if(r.status!==0||e.error)throw Error(e.error||'STOCK_UI_FAILED');e=validateStockEvidence(e,req.params.arguments);return {jsonrpc:'2.0',id:req.id,result:{content:[{type:'text',text:JSON.stringify(e)}],isError:false}};}catch(e){return {jsonrpc:'2.0',id:req.id,result:{content:[{type:'text',text:e.message}],isError:true}};}}return prior(req);}
export async function dispatch(req) {
 if(req.method==='tools/call' && handlesBackgroundTool(req.params?.name)) return dispatchBackground(req);
 const response=await dispatchLegacy(req);
 if(req.method==='tools/list' && response?.result?.tools) response.result.tools.push(...backgroundTools);
 if(req.method==='initialize' && response?.result) response.result.serverInfo={name:'no1-background-bridge',version:'0.2.0'};
 return response;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){let chain=Promise.resolve();readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{chain=chain.then(async()=>{try{if(line.length>16384)throw Error();const r=await dispatch(JSON.parse(line.replace(/^\uFEFF/,'')));if(r)process.stdout.write(JSON.stringify(r)+'\n');}catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid request'}})+'\n');}});});}
