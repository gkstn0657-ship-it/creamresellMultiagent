import {spawn, spawnSync} from 'node:child_process';
import readline from 'node:readline';
import {EventEmitter} from 'node:events';
import {codexExecutable} from '../codex-cli.mjs';

// Codex owns the reasoning/tool loop. This transport only delivers protocol messages.
export class CodexServer extends EventEmitter {
  constructor({cwd, config = {}, executable = codexExecutable(), onTool} = {}) {
    super(); this.cwd = cwd; this.config = config; this.executable = executable;
    this.onTool = onTool; this.pending = new Map(); this.seq = 0; this.finished = new Map();
  }
  async start() {
    const config = {'features.shell_tool': false, 'features.apps': false, 'features.plugins': false,
      'features.memories': false, 'web_search': 'disabled', 'agents.enabled': true,
      'agents.max_concurrent_threads_per_session': 3, ...this.config};
    // app-server has no --ignore-user-config. Disable inherited MCP registrations
    // explicitly while retaining normal Codex account authentication.
    const registered = spawnSync(this.executable, ['mcp','list','--json'], {encoding:'utf8',windowsHide:true,timeout:15000});
    if (registered.status !== 0) throw Error('MCP_ISOLATION_FAILED');
    for (const entry of JSON.parse(registered.stdout)) {
      if (!/^[A-Za-z0-9_-]+$/.test(entry.name)) throw Error('MCP_NAME_UNSUPPORTED');
      config[`mcp_servers.${entry.name}.enabled`] = false;
      if (entry.transport?.type === 'stdio') {
        config[`mcp_servers.${entry.name}.command`] = process.execPath;
        config[`mcp_servers.${entry.name}.args`] = [];
      }
    }
    config['skills.bundled.enabled'] = false; config['skills.include_instructions'] = false;
    const args = ['app-server'];
    for (const [key,value] of Object.entries(config)) args.push('-c', `${key}=${JSON.stringify(value)}`);
    this.child = spawn(this.executable, args, {cwd: this.cwd, windowsHide: true, shell: false, stdio: ['pipe','pipe','pipe']});
    this.stderr = '';
    this.child.stderr.on('data', b => { this.stderr = (this.stderr + b.toString()).slice(-4000); });
    this.child.on('error', e => this.failAll(e));
    this.child.on('close', code => this.failAll(Error(`CODEX_SERVER_CLOSED:${code}`)));
    this.lines = readline.createInterface({input: this.child.stdout});
    this.lines.on('line', line => { this.receive(line).catch(e => this.emit('transport-error', e.message)); });
    await this.call('initialize', {clientInfo: {name: 'cream_agent_team', version: '0.1.0'}, capabilities: {experimentalApi: true}});
    this.send({method: 'initialized'}); return this;
  }
  send(value) { this.child.stdin.write(JSON.stringify(value) + '\n'); }
  call(method, params = {}, timeoutMs = 30000) {
    const id = ++this.seq;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`CODEX_RPC_TIMEOUT:${method}`)); }, timeoutMs);
      this.pending.set(id, {resolve,reject,timer}); this.send({id,method,params});
    });
  }
  async receive(line) {
    let message; try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id); if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(Error(`CODEX_RPC_ERROR:${JSON.stringify(message.error)}`)); else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined) {
      if (message.method === 'item/tool/call') {
        try {
          const result = await this.onTool?.(message.params);
          this.send({id: message.id, result: {success: true, contentItems: [{type:'inputText',text:JSON.stringify(result ?? null)}]}});
        } catch(e) {
          this.send({id: message.id, result: {success: false, contentItems: [{type:'inputText',text:String(e.message).slice(0,1000)}]}});
        }
      } else {
        this.send({id: message.id, error: {code:-32601,message:'Unattended team does not handle this request'}});
      }
      return;
    }
    if (message.method === 'turn/completed') this.finished.set(message.params.turn.id, message.params);
    this.emit('notification', message);
  }
  async startThread({instructions, tools = [], model = 'gpt-6.1-sol', effort = 'medium', config = {}, ...rest} = {}) {
    return this.call('thread/start', {cwd: this.cwd, model, developerInstructions: instructions,
      allowProviderModelFallback: false,
      ephemeral: false, sandbox: 'read-only', approvalPolicy: 'never', dynamicTools: tools,
      config: {'model_reasoning_effort': effort,...config}, ...rest});
  }
  async runTurn(threadId, text, {timeoutMs = 240000, onStart} = {}) {
    const response = await this.call('turn/start', {threadId, input:[{type:'text',text}]});
    const turnId = response.turn.id; onStart?.(turnId);
    const result = await this.waitTurn(turnId, timeoutMs).catch(async e => {
      await this.call('turn/interrupt', {threadId,turnId}).catch(()=>{}); throw e;
    });
    if (result.turn.status !== 'completed') throw Error(`CODEX_TURN_${result.turn.status}:${result.turn.error?.message || ''}`);
    return result;
  }
  waitTurn(turnId, timeoutMs) {
    if (this.finished.has(turnId)) return Promise.resolve(this.finished.get(turnId));
    return new Promise((resolve,reject) => {
      const listener = message => { if(message.method === 'turn/completed' && message.params.turn.id === turnId) { cleanup(); resolve(message.params); } };
      const ended = error => { cleanup(); reject(error); };
      const timer = setTimeout(()=>{cleanup();reject(Error('CODEX_TURN_TIMEOUT'));},timeoutMs);
      const cleanup = () => {clearTimeout(timer);this.off('notification',listener);this.off('closed',ended);};
      this.on('notification',listener);this.on('closed',ended);
    });
  }
  failAll(error) { for (const p of this.pending.values()) {clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.emit('closed',error); }
  async close() {
    if (!this.child || this.child.exitCode !== null) return;
    this.child.stdin.end();
    await new Promise(resolve=>{const timer=setTimeout(()=>{this.child.kill();resolve();},3000);this.child.once('close',()=>{clearTimeout(timer);resolve();});});
    this.lines.close();
  }
}
