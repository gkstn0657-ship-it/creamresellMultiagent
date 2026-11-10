import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleMcp,controlTools} from './control-mcp.mjs';
import {batchEvents} from './batch-events.mjs';
import {createEventPublisher} from './event-publisher.mjs';
const home=path.join(process.env.LOCALAPPDATA,'CreamDotBridge'),config=JSON.parse(fs.readFileSync(path.join(home,'connection.json'),'utf8'));
const rootArg=process.argv.find(x=>x.startsWith('--root='))?.slice(7);
const root=rootArg?path.resolve(rootArg):fileURLToPath(new URL('../../kream-runs/agent-teams/',import.meta.url));
if(!/^https:\/\/[a-z0-9.-]+\.chatgpt\.site$/.test(config.origin))throw Error('INVALID_BRIDGE_ORIGIN');
fs.mkdirSync(path.join(home,'jobs'),{recursive:true});
const lock=path.join(home,'worker.pid');
if(fs.existsSync(lock)){const old=Number(fs.readFileSync(lock,'utf8'));let alive=false;try{process.kill(old,0);alive=true;}catch{}if(alive)throw Error('BRIDGE_ALREADY_RUNNING');}
fs.writeFileSync(lock,String(process.pid));
const headers={'content-type':'application/json','OAI-Sites-Authorization':'Bearer '+config.serviceToken,'x-cream-bridge-key':config.bridgeKey};
const delay=ms=>new Promise(r=>setTimeout(r,ms));let stopped=false;
const eventDir=path.join(home,'events');fs.mkdirSync(eventDir,{recursive:true});
process.on('SIGTERM',()=>stopped=true);process.on('SIGINT',()=>stopped=true);
async function send(endpoint,body){const r=await fetch(config.origin+endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('BRIDGE_HTTP_'+r.status);return r.json();}
const publisher=createEventPublisher({eventDir,send,
  enabled:async()=>{const state=await send('/bridge/check',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'cream_connection_status',arguments:{}}});return state.result?.structuredContent?.events?.activeSubscriptions>0;},
  readEvents:()=>batchEvents(root),onError:e=>console.error(JSON.stringify({type:'event_retry',code:e.message}))});
console.log(JSON.stringify({type:'bridge_started',at:new Date().toISOString(),backgroundOnly:true}));
try{while(!stopped){
  try{
    // Retry delivery of completed work, never re-execute a claimed command after a crash.
    for(const name of fs.readdirSync(path.join(home,'jobs')).filter(n=>n.endsWith('.result.json'))){const file=path.join(home,'jobs',name),saved=JSON.parse(fs.readFileSync(file,'utf8'));await send('/bridge/result',saved);fs.unlinkSync(file);}
    const {job}=await send('/bridge/claim',{});
    fs.writeFileSync(path.join(home,'status.json'),JSON.stringify({connected:true,at:new Date().toISOString(),pid:process.pid}));
    // Do not await callbacks in the 24-second remote command acknowledgement path.
    publisher.tick();
    if(job){
      if(!/^[a-f0-9-]{36}$/.test(job.id)||!controlTools.some(t=>t.name===job.name))throw Error('INVALID_REMOTE_JOB');
      const marker=path.join(home,'jobs',job.id+'.claimed');let result;
      if(fs.existsSync(marker))result={isError:true,content:[{type:'text',text:'COMMAND_ALREADY_CLAIMED: 상태를 확인하고 중복 실행하지 마세요.'}]};
      else{fs.writeFileSync(marker,new Date().toISOString(),{flag:'wx'});result=await handleMcp({method:'tools/call',params:{name:job.name,arguments:job.arguments}},{root});}
      if(result._meta?.panel)result._meta.panel.integration={transport:'private-remote-mcp',connectedPc:true,dotUiRenderingVerified:false};
      const file=path.join(home,'jobs',job.id+'.result.json');fs.writeFileSync(file,JSON.stringify({id:job.id,result}));await send('/bridge/result',{id:job.id,result});fs.unlinkSync(file);
    }
    await delay(1200);
  }catch(e){fs.writeFileSync(path.join(home,'status.json'),JSON.stringify({connected:false,at:new Date().toISOString(),code:e.message,pid:process.pid}));console.error(JSON.stringify({type:'connection_retry',code:e.message}));await delay(5000);}
}}finally{if(fs.existsSync(lock)&&Number(fs.readFileSync(lock,'utf8'))===process.pid)fs.unlinkSync(lock);}
