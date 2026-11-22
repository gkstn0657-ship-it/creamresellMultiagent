import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {codexExecutable} from '../codex-cli.mjs';

export const servers = {
  no1: {args: [fileURLToPath(new URL('../no1-mcp-prototype/server-stock.mjs', import.meta.url)), '--background-only'],
    requiredTools: ['no1_background_ranking_feed', 'no1_background_product_probe']},
  cream_team: {args: [fileURLToPath(new URL('./control-mcp.mjs', import.meta.url))],
    requiredTools: ['cream_open_panel', 'cream_explore_start', 'cream_musinsa_batch_start']}
};

function run(executable, args, input) {
  const result = spawnSync(executable, args, {input, encoding:'utf8', windowsHide:true,
    timeout:30000, maxBuffer:2 * 1024 * 1024});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${path.basename(executable)} ${args[0]} failed (exit ${result.status})`);
  return result.stdout;
}

// Handshake and capability discovery only. Do not invoke a product, model, or browser tool here.
export function checkServers() {
  for (const [name, server] of Object.entries(servers)) {
    const calls = [{id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'cream-install',version:'1'}}},
      {id:2,method:'tools/list'}];
    if (name === 'cream_team') calls.push({id:3,method:'resources/read',params:{uri:'ui://cream/management-v2.html'}});
    const input = calls.map(call => JSON.stringify({jsonrpc:'2.0',...call})).join('\n') + '\n';
    const responses = new Map(run(process.execPath,server.args,input).trim().split('\n').map(line => {
      const msg=JSON.parse(line); return [msg.id,msg.result];
    }));
    const available = new Set(responses.get(2)?.tools?.map(t=>t.name));
    if (!responses.get(1)?.serverInfo || server.requiredTools.some(tool=>!available.has(tool))) {
      throw Error(name + ': required MCP capabilities missing');
    }
    if (name === 'cream_team' && !responses.get(3)?.contents?.[0]?.text?.includes('</html>')) {
      throw Error('cream_team: missing management panel');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const mode = process.argv[2] || '--check';
  if (!['--check','--register'].includes(mode) || process.argv.length > 3) throw Error('Use --check or --register');
  checkServers();
  if (mode === '--register') {
    const codex=codexExecutable();
    for (const [name, server] of Object.entries(servers)) {
      run(codex,['mcp','add',name,'--',process.execPath,...server.args]);
      const value=JSON.parse(run(codex,['mcp','get',name,'--json']));
      if (!value.enabled || value.transport?.type!=='stdio' ||
          path.relative(value.transport.command,process.execPath)!=='' ||
          JSON.stringify(value.transport.args)!==JSON.stringify(server.args)) throw Error(name + ': registration mismatch');
    }
  }
  console.log(mode === '--check' ? 'No1 and cream_team passed offline MCP checks.' : 'Registered no1 and cream_team for this Codex account on this PC.');
}
