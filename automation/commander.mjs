import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {startPipeline} from '../kream-tools/run-all.mjs';
import {codexExecutable} from './codex-cli.mjs';

const ROOT = fileURLToPath(new URL('../',import.meta.url));
const RUNS = path.join(ROOT,'kream-runs','automation');
const STOP = path.join(RUNS,'STOP');
const read = file => {try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const alive = pid => {if (!Number.isSafeInteger(pid) || pid < 1) return false;try{process.kill(pid,0);return true;}catch{return false;}};
const health = async () => fetch('http://127.0.0.1:8787/health',{signal:AbortSignal.timeout(3000)}).then(r=>r.json()).catch(()=>null);
const installedVersion = () => read(path.join(ROOT,'naver-extension','manifest.json'))?.version || null;
function lastCapture() {
  const runs = path.join(ROOT,'kream-runs');
  if (!fs.existsSync(runs)) return null;
  for (const entry of fs.readdirSync(runs,{withFileTypes:true}).filter(x=>x.isDirectory())
    .map(x=>({name:x.name,dir:path.join(runs,x.name)})).sort((a,b)=>fs.statSync(b.dir).mtimeMs-fs.statSync(a.dir).mtimeMs).slice(0,12)) {
    const files = fs.readdirSync(entry.dir);
    const kream = files.find(file=>/^dump-K\d+\.json$/.test(file));
    if (!kream) continue;
    const dump = read(path.join(entry.dir,kream));
    return {run:entry.name,at:dump?.at || null,loginRedirect:/^https:\/\/kream\.co\.kr\/login/.test(dump?.url || '')};
  }
  return null;
}

export async function commander(command, options = {}) {
  const operatingConfig=read(path.join(ROOT,'automation','loop-config.json'));
  if(command==='start'&&operatingConfig?.engine==='dot-agent-team')return {command,status:'awaiting-user-scope',orchestrator:'Dot',dailyLimit:null,collectionStarted:false,instruction:'Tell Dot how many products for this work; it opens a work order before collecting.'};
  const relay = await health();
  const state = read(path.join(RUNS,'loop-state.json'));
  const pid = read(path.join(RUNS,'loop-process.json'))?.pid;
  if (command === 'status' || command === 'doctor') {
    const executable = command === 'doctor' ? codexExecutable() : null;
    const login = executable ? spawnSync(executable,['login','status'],{encoding:'utf8',windowsHide:true}) : null;
    return {command,orchestrator:operatingConfig?.engine,scopeMode:operatingConfig?.scopeMode,dailyLimit:operatingConfig?.dailyLimit,loopRunning:alive(pid),stop:fs.existsSync(STOP),relay:relay && {
      ok:relay.ok,pending:relay.pending,dumps:relay.dumps,lastPollAt:relay.lastPollAt,capped:relay.capped},
      extensionVersion:installedVersion(),lastKreamCapture:lastCapture(),state,
      ...(login ? {codexExecutable:executable,codexSignedIn:login.status===0 && /Logged in using ChatGPT/.test((login.stdout||'')+(login.stderr||''))} : {})};
  }
  if (command === 'stop') {
    fs.mkdirSync(RUNS,{recursive:true});fs.writeFileSync(STOP,`Stopped by commander at ${new Date().toISOString()}\n`);
    if (state?.status === 'running' && state.dir) fs.writeFileSync(path.join(state.dir,'STOP'),`Stopped by commander at ${new Date().toISOString()}\n`);
    return {command,status:'stop-requested',file:STOP,activeRun:state?.status === 'running' ? state.dir : null};
  }
  if (command === 'reset-stop') {
    if (alive(pid)) throw new Error('Loop is still running');
    if (fs.existsSync(STOP)) fs.unlinkSync(STOP);
    if (state?.status === 'failed' && state.error === 'STOP requested' && state.dir) {
      const cycleDir = path.resolve(state.dir);
      if (!cycleDir.startsWith(path.resolve(RUNS) + path.sep)) throw new Error('Unexpected cycle directory');
      const cycleStop = path.join(cycleDir,'STOP');
      if (fs.existsSync(cycleStop)) fs.unlinkSync(cycleStop);
    }
    if (state?.status === 'running') fs.writeFileSync(path.join(RUNS,'loop-state.json'),JSON.stringify({...state,status:'stopped',at:new Date().toISOString()},null,2));
    return {command,status:'ready'};
  }
  if (command === 'start') {
    if (fs.existsSync(STOP)) throw new Error(`STOP file exists: ${STOP}`);
    if (alive(pid)) return {command,status:'already-running',pid};
    const config = read(path.join(ROOT,'automation','loop-config.json'));
    if (config?.runOnce === true && ['done','under-target'].includes(state?.status))
      return {command,status:'already-complete',processed:state.processed,target:state.target};
    fs.mkdirSync(RUNS,{recursive:true});
    const stdout = fs.openSync(path.join(RUNS,'loop.log'),'a'),stderr = fs.openSync(path.join(RUNS,'loop-error.log'),'a');
    const child = spawn(process.execPath,[path.join(ROOT,'automation','loop.mjs')],{
      cwd:ROOT,detached:true,windowsHide:true,stdio:['ignore',stdout,stderr]});
    fs.closeSync(stdout);fs.closeSync(stderr);child.unref();
    fs.writeFileSync(path.join(RUNS,'loop-process.json'),JSON.stringify({pid:child.pid,at:new Date().toISOString()}));
    return {command,status:'started',pid:child.pid};
  }
  if (command === 'smoke') {
    const dir = path.join(ROOT,'kream-runs',options.dirName || `live-smoke-${new Date().toISOString().replace(/[-:.]/g,'').slice(0,15)}`);
    const result = await startPipeline(dir,['--limit=3','--codex-efficient','--max-prod=1'],{listTimeoutMs:90000});
    return {command,status:'done',dir,automation:result.automation};
  }
  throw new Error('Usage: node automation/commander.mjs status|doctor|start|stop|reset-stop|smoke');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {console.log(JSON.stringify(await commander(process.argv[2] || 'status'),null,2));}
  catch (error) {console.error(error.message);process.exitCode=1;}
}
