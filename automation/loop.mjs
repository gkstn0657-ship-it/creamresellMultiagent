import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {startPipeline} from '../kream-tools/run-all.mjs';
import {acquireRunLock} from '../renew/Cream/kream-tools/agents-core.mjs';
import {codexExecutable} from './codex-cli.mjs';
import {splitIds,remainingHourlyPages,aggregateBatchReports} from './batches.mjs';

const ROOT = fileURLToPath(new URL('../',import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const write = (file,value) => {fs.mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.${process.pid}.tmp`;fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,file);};
const kstDay = date => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);

export function readLoopConfig(file) {
  const config = JSON.parse(fs.readFileSync(file,'utf8'));
  if(config.engine==='dot-agent-team')return config;
  if (!Number.isSafeInteger(config.dailyTarget) || config.dailyTarget < 1 || config.dailyTarget > 500) throw new Error('dailyTarget must be 1-500');
  if (!Number.isSafeInteger(config.batchSize) || config.batchSize < 1 || config.batchSize > 20) throw new Error('batchSize must be 1-20');
  if (!Number.isSafeInteger(config.minimumHourlyPages) || config.minimumHourlyPages < 1 || config.minimumHourlyPages > 150) throw new Error('minimumHourlyPages must be 1-150');
  if (!Number.isSafeInteger(config.intervalMinutes) || config.intervalMinutes < 15) throw new Error('intervalMinutes must be >=15');
  const sourcesFile = path.resolve(path.dirname(file),config.sourcesFile);
  const sources = JSON.parse(fs.readFileSync(sourcesFile,'utf8'));
  if (!Array.isArray(sources) || !sources.length) throw new Error('sourcesFile is empty');
  return {...config,sourcesFile,runRoot:path.resolve(path.dirname(file),config.runRoot || '../kream-runs/automation')};
}

export async function runLoop(configFile, options = {}) {
  const config = readLoopConfig(path.resolve(configFile));
  if(config.engine==='dot-agent-team')return {status:'managed-by-dot',scopeMode:'ask-user-per-work',dailyLimit:null,collectionStarted:false};
  const once = options.once || config.runOnce === true;
  const stateFile = path.join(config.runRoot,'loop-state.json'), stopFile = path.join(config.runRoot,'STOP');
  if (options.dryRun) return {mode:'dry-run',target:config.dailyTarget,batchSize:config.batchSize,
    sources:JSON.parse(fs.readFileSync(config.sourcesFile,'utf8')).length,runRoot:config.runRoot,codexLoginRequired:true};
  const venv = path.join(ROOT,'.venv','Scripts');
  if (fs.existsSync(path.join(venv,'python.exe'))) process.env.PATH = `${venv};${process.env.PATH || ''}`;
  const login = spawnSync(codexExecutable(),['login','status'],{encoding:'utf8',windowsHide:true});
  if (login.status !== 0 || !/Logged in using ChatGPT/.test((login.stdout || '')+(login.stderr || ''))) throw new Error('Codex CLI must be signed in with ChatGPT');
  const relay = spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'Start-Relay.ps1')],{encoding:'utf8',windowsHide:true});
  if (relay.status !== 0) throw new Error(`Relay startup failed: ${String(relay.stderr || relay.stdout).slice(0,300)}`);
  fs.mkdirSync(config.runRoot,{recursive:true});
  if (fs.existsSync(stopFile)) throw new Error(`STOP file exists: ${stopFile}`);
  const release = acquireRunLock(config.runRoot);
  try {
  let previous = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile,'utf8')) : null;
  let cycle = previous?.day === kstDay(new Date()) ? previous.cycle || 0 : 0;
  const relayConfig = JSON.parse(fs.readFileSync(path.join(ROOT,'sourcing-runtime.json'),'utf8'));
  const relayDir = path.resolve(ROOT,relayConfig.relayRunDir);
  const stopped = () => fs.existsSync(stopFile);
  do {
    if (stopped()) break;
    const started = new Date(), day = kstDay(started);
    const resume = previous?.day === day && ['running','failed'].includes(previous.status) && previous.dir &&
      !fs.existsSync(path.join(previous.dir,'STOP')) && fs.existsSync(path.join(previous.dir,'batches.json'));
    const dir = resume ? previous.dir : path.join(config.runRoot,`${day}-cycle-${String(++cycle).padStart(2,'0')}`);
    const engineArgs = config.engine === 'agentic-codex' ? ['--agentic'] : ['--codex-efficient'];
    const args = [`--limit=${config.dailyTarget}`,`--sources-file=${config.sourcesFile}`,...engineArgs,`--max-prod=${config.maxProductPages || 2}`];
    fs.mkdirSync(dir,{recursive:true});
    const idsFile=path.join(dir,'k50-ids.json');
    if (!resume && !fs.existsSync(idsFile) && previous?.day === day && previous.dir) {
      const priorIds=path.join(previous.dir,'k50-ids.json');
      if (fs.existsSync(priorIds)) write(idsFile,JSON.parse(fs.readFileSync(priorIds,'utf8')));
    }
    write(stateFile,{status:'running',phase:'discovering',startedAt:started.toISOString(),day,cycle,dir,args});
    try {
      if (!fs.existsSync(idsFile)) await startPipeline(dir,args,{collectOnly:true,stopFile});
      const ids = JSON.parse(fs.readFileSync(idsFile,'utf8'));
      if (!ids.length) throw new Error('NO_PRODUCTS_DISCOVERED');
      const manifestFile=path.join(dir,'batches.json');
      const groups=splitIds(ids,config.batchSize);
      const manifest=fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile,'utf8')) :
        {version:'cream-batches-v1',ids,batchSize:config.batchSize,batches:groups.map((group,i)=>({index:i+1,ids:group,status:'pending',attempt:0,dir:null}))};
      if (JSON.stringify(manifest.ids)!==JSON.stringify(ids) || manifest.batches.length!==groups.length) throw new Error('Batch manifest does not match discovered IDs');
      write(manifestFile,manifest);
      for (const batch of manifest.batches) {
        if (stopped()) throw new Error('STOP requested');
        if (batch.status==='done') continue;
        while (remainingHourlyPages(relayDir).remaining < config.minimumHourlyPages) {
          if (stopped()) throw new Error('STOP requested');
          write(stateFile,{status:'running',phase:'waiting-relay-cap',at:new Date().toISOString(),day,cycle,dir,
            processed:manifest.batches.filter(item=>item.status==='done').reduce((n,item)=>n+item.ids.length,0),target:ids.length,
            nextBatch:batch.index,capacity:remainingHourlyPages(relayDir)});
          await sleep(15000);
        }
        batch.attempt=(batch.attempt || 0)+1;
        batch.dir=path.join(dir,'batches',`batch-${String(batch.index).padStart(3,'0')}-attempt-${String(batch.attempt).padStart(2,'0')}`);
        batch.status='running';
        write(manifestFile,manifest);
        write(path.join(batch.dir,'k50-ids.json'),batch.ids);
        write(stateFile,{status:'running',phase:'screening',at:new Date().toISOString(),day,cycle,dir,
          batch:batch.index,batches:manifest.batches.length,processed:manifest.batches.filter(item=>item.status==='done').reduce((n,item)=>n+item.ids.length,0),target:ids.length});
        try {
          const pipelineResult = await startPipeline(batch.dir,[...engineArgs,`--max-prod=${config.maxProductPages || 2}`], { stopFile });
          if (config.engine === 'agentic-codex') {
            const agentState = JSON.parse(fs.readFileSync(path.join(batch.dir,'agentic-state.json'),'utf8'));
            if (agentState.status !== 'complete') throw new Error(`Agent pipeline ${agentState.status}: ${(pipelineResult.unresolved || []).join(' / ').slice(0,300)}`);
          }
          batch.status='done';batch.finishedAt=new Date().toISOString();write(manifestFile,manifest);
          const aggregate=aggregateBatchReports(dir,manifest);
          write(stateFile,{status:'running',phase:'screening',at:new Date().toISOString(),day,cycle,dir,
            batch:batch.index,batches:manifest.batches.length,processed:aggregate.summary.productsProcessed,target:ids.length,automation:aggregate.summary});
        } catch (error) {
          batch.status='failed';batch.error=String(error.message).slice(0,500);write(manifestFile,manifest);
          throw error;
        }
      }
      const result=aggregateBatchReports(dir,manifest);
      write(stateFile,{status:ids.length < config.dailyTarget ? 'under-target' : 'done',at:new Date().toISOString(),day,cycle,dir,
        explored:ids.length,target:config.dailyTarget,processed:result.summary.productsProcessed,automation:result.summary});
    } catch (error) {
      write(stateFile,{status:'failed',at:new Date().toISOString(),day,cycle,dir,error:String(error.message).slice(0,500)});
      if (once) throw error;
    }
    previous = JSON.parse(fs.readFileSync(stateFile,'utf8'));
    if (once) break;
    const until = Date.now()+config.intervalMinutes*60000;
    while (Date.now()<until && !stopped()) await sleep(Math.min(30000,until-Date.now()));
  } while (!stopped());
  return JSON.parse(fs.readFileSync(stateFile,'utf8'));
  } finally {release();}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const file = process.argv.find(a => a.startsWith('--config='))?.slice(9) || path.join(ROOT,'automation/loop-config.json');
  try {console.log(JSON.stringify(await runLoop(file,{once:process.argv.includes('--once'),dryRun:process.argv.includes('--dry-run')})));}
  catch (error) {console.error(error.message);process.exitCode=1;}
}
