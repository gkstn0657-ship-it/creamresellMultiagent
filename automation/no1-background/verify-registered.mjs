import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {codexExecutable} from '../codex-cli.mjs';
const registered = spawnSync(codexExecutable(), ['mcp', 'get', 'no1', '--json'], {encoding: 'utf8', windowsHide: true, timeout: 15000});
if (registered.status !== 0) throw Error('NO1_MCP_REGISTRATION_UNAVAILABLE');
const config = JSON.parse(registered.stdout);
const transport = config.transport;
const serverPath = fileURLToPath(new URL('../no1-mcp-prototype/server-stock.mjs', import.meta.url));
if (!config.enabled || transport?.type !== 'stdio' || !transport.args?.includes('--background-only') || !transport.args.some(arg => path.resolve(arg) === serverPath)) throw Error('NO1_MCP_REGISTRATION_MISMATCH');

function batch(requests) {
  const result = spawnSync(transport.command, transport.args, {cwd: transport.cwd || process.cwd(), env: {...process.env, ...(transport.env || {})}, input: requests.map(value => JSON.stringify(value)).join('\n') + '\n', encoding: 'utf8', windowsHide: true, timeout: 65000 * requests.length, maxBuffer: 1000000});
  if (result.status !== 0) throw Error('NO1_MCP_PROCESS_FAILED');
  return result.stdout.trim().split('\n').map(line => JSON.parse(line));
}
const responses = batch([
  {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'no1-background-verifier', version: '0.1.0'}}},
  {jsonrpc: '2.0', id: 2, method: 'tools/list'},
  {jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'no1_background_status', arguments: {}}},
  {jsonrpc: '2.0', id: 4, method: 'tools/call', params: {name: 'no1_search_price_comparison', arguments: {kreamId: '1120286', model: 'NBNPG41033-19'}}}
]);
const byId = new Map(responses.map(value => [value.id, value]));
const tools = byId.get(2)?.result?.tools?.map(tool => tool.name) || [];
const localResponse = byId.get(3)?.result;
const local = localResponse?.isError ? {error: localResponse.content?.[0]?.text} : JSON.parse(localResponse?.content?.[0]?.text || '{}');
const legacyUiBlocked = byId.get(4)?.result?.isError === true && byId.get(4).result.content[0].text === 'NO1_BACKGROUND_ONLY_UI_DISABLED';
const report = {checkedAt: new Date().toISOString(), serverInfo: byId.get(1)?.result?.serverInfo, tools, local, legacyUiBlocked, remoteNo1Verified: false, productQueryVerified: false, readiness: local.data?.browserConnected ? 'ready-for-remote-diagnostics' : 'awaiting-browser-pairing'};
if (process.argv.includes('--remote') && local.data?.browserConnected) {
  const names = ['no1_background_supported_sites', 'no1_background_musinsa_login', 'no1_background_runtime_settings'];
  report.remote = [];
  for (const [index, name] of names.entries()) {
    const [response] = batch([{jsonrpc: '2.0', id: index + 10, method: 'tools/call', params: {name, arguments: {}}}]);
    report.remote.push({id: response.id, isError: response.result?.isError, result: response.result?.content?.[0]?.text});
    if (response.result?.isError !== false) break;
  }
  report.remoteNo1Verified = report.remote.length === names.length && report.remote.every(item => item.isError === false);
  report.readiness = report.remoteNo1Verified ? 'remote-metadata-verified-product-queries-not-enabled' : 'remote-diagnostics-failed';
}
const out = process.argv.find(arg => arg.startsWith('--out='))?.slice(6);
if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), {recursive: true}); fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify(report, null, 2));
if (!legacyUiBlocked || !tools.includes('no1_background_status') || localResponse?.isError) process.exitCode = 1;
if (process.argv.includes('--remote') && !report.remoteNo1Verified) process.exitCode = 2;
