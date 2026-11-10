import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {spawn, spawnSync} from 'node:child_process';
import {codexExecutable} from '../codex-cli.mjs';

// Exercise the saved Codex registration over MCP stdio without a model call.
// All UI operations are sequential; historical evidence is never overwritten.
const outArg = process.argv.find(arg => arg.startsWith('--out='))?.slice(6);
if (!outArg || !process.argv.includes('--live')) throw Error('Usage: node test-registered-mcp.mjs --live --out=<new-empty-directory>');
const outDir = path.resolve(outArg);
if (fs.existsSync(outDir) && fs.readdirSync(outDir).length) throw Error('Output directory must be new and empty');
fs.mkdirSync(outDir, {recursive:true});
const cli = process.env.CODEX_CLI_PATH && fs.existsSync(process.env.CODEX_CLI_PATH)
  ? process.env.CODEX_CLI_PATH : codexExecutable();
const registered = spawnSync(cli, ['mcp','get','no1','--json'], {encoding:'utf8',windowsHide:true,timeout:15000});
if (registered.status !== 0) throw Error('CODEX_NO1_REGISTRATION_UNAVAILABLE');
const config = JSON.parse(registered.stdout);
if (!config.enabled || config.transport?.type !== 'stdio') throw Error('NO1_STDIO_NOT_ENABLED');
const transport = config.transport;
const child = spawn(transport.command, transport.args || [], {
  cwd:transport.cwd || process.cwd(), env:{...process.env,...(transport.env || {})},
  windowsHide:true, stdio:['pipe','pipe','pipe']
});
const pending = new Map();
let sequence = 0;
let stderrBytes = 0;
child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
const lines = readline.createInterface({input:child.stdout,crlfDelay:Infinity});
lines.on('line', line => {
  try {
    const message = JSON.parse(line);
    const entry = pending.get(message.id);
    if (entry) {clearTimeout(entry.timer);pending.delete(message.id);entry.resolve(message);}
  } catch {
    for (const entry of pending.values()) {clearTimeout(entry.timer);entry.reject(Error('INVALID_MCP_STDOUT'));}
    pending.clear();
  }
});
const failPending = error => {
  for (const entry of pending.values()) {clearTimeout(entry.timer);entry.reject(error);}
  pending.clear();
};
child.on('error', () => failPending(Error('MCP_PROCESS_START_FAILED')));
child.on('exit', () => failPending(Error('MCP_PROCESS_EXITED')));
function request(method, params = {}, timeoutMs = 55000) {
  const id = ++sequence;
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => {pending.delete(id);reject(Error(`MCP_TIMEOUT:${method}`));},timeoutMs);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
}
const report = {version:'no1-registered-mcp-check-v1',startedAt:new Date().toISOString(),
  registration:{name:config.name,enabled:config.enabled,command:transport.command,args:transport.args},
  steps:[],passed:false,pipelineWrites:false,transactionsPerformed:false};
async function call(label,name,args) {
  const start = Date.now();
  const response = await request('tools/call',{name,arguments:args});
  const text = response.result?.content?.find(item => item.type === 'text')?.text;
  let evidence = null;
  if (text && !response.result?.isError) {try {evidence=JSON.parse(text);} catch {}}
  const step = {label,name,arguments:args,durationMs:Date.now()-start,response,evidence};
  report.steps.push(step);
  console.log(JSON.stringify({step:label,ok:!response.error && response.result?.isError===false,
    error:response.error?.message || (response.result?.isError ? text : null),
    freshEvidence:evidence?.freshEvidence,stockQuantity:evidence?.stockQuantity,
    maximumBenefitPriceKrw:evidence?.maximumBenefitPriceKrw}));
  return step;
}
try {
  report.initialize = await request('initialize',{protocolVersion:'2025-06-18',capabilities:{},
    clientInfo:{name:'cream-codex-registration-check',version:'1.0.0'}},10000);
  if (report.initialize.error) throw Error('MCP_INITIALIZE_FAILED');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  report.catalog = await request('tools/list',{},10000);
  const names = report.catalog.result?.tools?.map(tool=>tool.name) || [];
  const expected = ['no1_read_price_comparison','no1_search_price_comparison','no1_search_stock_estimate'];
  if (JSON.stringify(names)!==JSON.stringify(expected)) throw Error('UNEXPECTED_TOOL_CATALOG');
  console.log(JSON.stringify({step:'registered-tool-discovery',tools:names}));
  const seed = JSON.parse(fs.readFileSync(new URL('../no1-first-seeds.example.json',import.meta.url),'utf8')).items[0];
  const marketArgs = {kreamId:String(seed.kreamId),model:seed.kreamModel};
  const stockArgs = {productUrl:seed.sourceUrl,model:seed.sourceModel,color:seed.sourceColor,option:seed.options[0].sourceOption};
  const market = await call('matched-product-market','no1_search_price_comparison',marketArgs);
  const stock = await call('matched-product-stock','no1_search_stock_estimate',stockArgs);
  if (market.evidence && stock.evidence) {
    const wrong = await call('wrong-model-rejected','no1_search_stock_estimate',{...stockArgs,model:'WRONG-MODEL-TEST'});
    const back = await call('stock-to-market','no1_search_price_comparison',marketArgs);
    report.passed = wrong.response.result?.isError===true &&
      wrong.response.result.content?.[0]?.text==='STOCK_PRODUCT_IDENTITY_MISMATCH' && !!back.evidence &&
      market.evidence.kreamId===marketArgs.kreamId && stock.evidence.productUrl===stockArgs.productUrl &&
      market.evidence.promotionAllowed===false && stock.evidence.actualCheckoutPriceConfirmed===false;
  }
} catch (error) {
  report.error = String(error.message);
} finally {
  child.stdin.end();
  child.kill();
  lines.close();
  report.completedAt = new Date().toISOString();
  report.stderrBytes = stderrBytes;
  fs.writeFileSync(path.join(outDir,'registered-mcp-result.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({passed:report.passed,error:report.error || null,result:path.join(outDir,'registered-mcp-result.json')}));
if (!report.passed) process.exitCode=1;
