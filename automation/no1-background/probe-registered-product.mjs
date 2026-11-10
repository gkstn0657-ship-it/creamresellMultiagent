import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {codexExecutable} from '../codex-cli.mjs';
const outDir = process.argv.find(arg => arg.startsWith('--out='))?.slice(6);
if (!outDir || !fs.existsSync(path.join(outDir, 'observer-ready.json'))) throw Error('WINDOW_OBSERVER_REQUIRED');
const ready = JSON.parse(fs.readFileSync(path.join(outDir, 'observer-ready.json'), 'utf8').replace(/^\uFEFF/, ''));
if (Date.now() - Date.parse(ready.startedAt) > 15000) throw Error('WINDOW_OBSERVER_STALE');
const registered = spawnSync(codexExecutable(), ['mcp', 'get', 'no1', '--json'], {encoding: 'utf8', windowsHide: true, timeout: 15000});
if (registered.status !== 0) throw Error('NO1_MCP_REGISTRATION_UNAVAILABLE');
const config = JSON.parse(registered.stdout); const t = config.transport;
const expected = fileURLToPath(new URL('../no1-mcp-prototype/server-stock.mjs', import.meta.url));
if (!config.enabled || t?.type !== 'stdio' || !t.args?.includes('--background-only') || !t.args.some(arg => path.resolve(arg) === expected)) throw Error('NO1_MCP_REGISTRATION_MISMATCH');
const request = {jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'no1_background_product_probe', arguments: {kreamId: '1120286', productUrl: 'https://www.musinsa.com/products/7481180', model: 'NBNPG41033', color: '(19)BLACK', option: 'L(100)'}}};
try {
  const result = spawnSync(t.command, t.args, {cwd: t.cwd || process.cwd(), env: {...process.env, ...(t.env || {})}, input: JSON.stringify(request) + '\n', encoding: 'utf8', windowsHide: true, timeout: 230000, maxBuffer: 1000000});
  if (result.status !== 0) throw Error('NO1_MCP_PRODUCT_PROCESS_FAILED');
  const response = JSON.parse(result.stdout.trim());
  fs.writeFileSync(path.join(outDir, 'product-result.json'), JSON.stringify(response, null, 2));
  if (response.result?.isError) { console.log(JSON.stringify({ok: false, error: response.result.content[0].text})); process.exitCode = 1; }
  else {
    const data = JSON.parse(response.result.content[0].text);
    console.log(JSON.stringify({ok: true, queryStatus: data.queryStatus, errors: data.errors, mode: data.mode, sourceModel: data.stock?.makerNumber, stockQuantity: data.stock?.selectedStockQuantity, maxBenefitPrice: data.benefits?.maxBenefitPrice, memberBenefits: data.benefits?.memberBenefits, priceRowCount: data.market?.prices?.length ?? 0, promotionAllowed: data.promotionAllowed}));
  }
} finally { fs.writeFileSync(path.join(outDir, 'STOP-OBSERVER'), 'done'); }
