import fs from 'node:fs';
import path from 'node:path';
import {CodexServer} from './app-server.mjs';
import {BackgroundClient} from '../no1-background/client.mjs';
const dir = path.resolve('kream-runs/agent-team-bootstrap');
const calls = [], events = [];
const server = new CodexServer({cwd:dir,onTool: async p => {calls.push({threadId:p.threadId,tool:p.tool});return {check:'CREAM_TOOL_OK',value:7};}});
server.on('notification',m=>{ if(['thread/started','item/completed','turn/completed'].includes(m.method))events.push(m); });
try {
  await server.start();
  const status = await new BackgroundClient().status().catch(e=>({error:e.message}));
  const models = await server.call('model/list',{});
  const tool = {type:'function',name:'cream_check',description:'Read the local integration check.',inputSchema:{type:'object',properties:{},additionalProperties:false}};
  const thread = await server.startThread({instructions:'Call cream_check once and report its value. No other work.',tools:[tool],model:'gpt-6-luna',effort:'high'});
  await server.runTurn(thread.thread.id,'Run the integration check now.',{timeoutMs:90000});
  fs.writeFileSync(path.join(dir,'smoke.json'),JSON.stringify({threadId:thread.thread.id,status,models:models.data?.map(m=>({id:m.id,model:m.model})),calls,events},null,2));
  console.log(JSON.stringify({ok:calls.length===1,threadId:thread.thread.id,no1:status,calls}));
} catch(e) {console.error(e.message);console.error(server.stderr);process.exitCode=1;}
finally {await server.close();}
