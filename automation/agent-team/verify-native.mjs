import fs from 'node:fs';
import path from 'node:path';
import {CodexServer} from './app-server.mjs';
import {TeamStore} from './store.mjs';
import {startEvidenceServer} from './evidence-server.mjs';
import {fileURLToPath} from 'node:url';
const dir=path.resolve('kream-runs/agent-team-native-verification');
const store=new TeamStore(dir,{objective:'Native child evidence access verification'});
const observation=store.observe('integration_fixture',{marker:'CREAM_NATIVE_READ_OK',value:37},{mode:'fixture'});
const evidence=await startEvidenceServer(store),events=[];
const config={'mcp_servers.cream_evidence.command':process.execPath,'mcp_servers.cream_evidence.args':[fileURLToPath(new URL('./evidence-mcp.mjs',import.meta.url)),evidence.file],'mcp_servers.cream_evidence.enabled':true};
const server=new CodexServer({cwd:dir,config});
server.on('notification',m=>{if(['item/completed','turn/completed'].includes(m.method))events.push(m);});
try{
  await server.start();
  const root=await server.startThread({instructions:'Use an actual native subagent to read the requested immutable observation through cream_evidence MCP. You must not read the value yourself first. Wait for its result and report the marker and value. No other tasks.',model:'gpt-6.1-sol',effort:'low'});
  await server.runTurn(root.thread.id,`Delegate to one gpt-6-luna/high subagent. Ask it to call cream_evidence.read_observation with id ${observation.id}, then return the exact marker and value.`,{timeoutMs:90000});
  const native=events.filter(x=>x.method==='item/completed'&&x.params.item.type==='subAgentActivity'&&x.params.item.kind==='started');
  const childIds=new Set(native.map(x=>x.params.item.agentThreadId));
  const calls=events.filter(x=>x.method==='item/completed'&&x.params.item.type==='mcpToolCall'&&childIds.has(x.params.threadId));
  const success=calls.some(x=>x.params.item.tool==='read_observation'&&x.params.item.status==='completed');
  const report={verified:success,nativeChildCount:childIds.size,childMcpCalls:calls,events};
  fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({verified:success,nativeChildCount:childIds.size,childMcpCallCount:calls.length}));
  if(!success)process.exitCode=2;
}catch(e){console.error(e.message);process.exitCode=1;}
finally{await server.close();await evidence.close();}
