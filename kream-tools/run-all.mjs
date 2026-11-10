// Canonical root entry point: all six agents are mandatory in live runs.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { RelayTransport } from './relay-transport.mjs';
import { readJson,writeJson,context } from '../renew/Cream/kream-tools/agents-core.mjs';
import { recordIncident } from '../renew/Cream/kream-tools/agents-incidents.mjs';
import { agentEvent } from '../renew/Cream/kream-tools/agents-lifecycle.mjs';
import { runRoleAi } from '../renew/Cream/kream-tools/agents-team.mjs';
import { buildAutomationReport } from '../automation/report.mjs';
const ROOT = fileURLToPath(new URL('../',import.meta.url));
export async function startPipeline(inputDir, args = [], options = {}) {
  if (args.includes('--agentic')) {
    const { startAgenticPipeline } = await import('../automation/agentic/run.mjs');
    return startAgenticPipeline(inputDir, args, options);
  }
  const dir = path.resolve(inputDir); fs.mkdirSync(dir,{recursive:true});
  const replay = args.includes('--replay'), rulesOnly = args.includes('--rules-only');
  if (!fs.existsSync(path.join(dir,'agent-policy.json'))) {
    const policy = readJson(ROOT,'sourcing-policy.json',readJson(ROOT,'kream-runs/sourcing-five-20261108/agent-policy.json',{}));
    writeJson(dir,'agent-policy.json',policy);
  }
  const runId = Date.now().toString(36),ctx = context(dir,{runId});
  agentEvent(ctx,'error_manager','rules','running'); recordIncident(dir,null,'탐색 시작'); agentEvent(ctx,'error_manager','rules','done');
  const transportConfig = readJson(ROOT,'sourcing-runtime.json',{});
  const relayArg = args.find(a => a.startsWith('--relay-dir='))?.slice(12);
  let transport = null,timer = null,syncing = Promise.resolve(),failure = null,child = null;
  const modelOptions = {replay,onRole:e => console.log(`[에이전트] ${e.role}: ${e.status}`)};
  try {
    if (!replay) {
      transport = new RelayTransport(dir,relayArg || transportConfig.relayRunDir || dir,options.transportOptions);
      await transport.verify();
      const sync = () => { syncing = syncing.then(() => transport.sync()).catch(error => { failure = error; if (child) child.kill(); }); };
      await transport.sync(); timer = setInterval(sync,1000);
    }
    if (!fs.existsSync(path.join(dir,'k50-ids.json'))) {
      const sourcesFile = args.find(a => a.startsWith('--sources-file='))?.slice(15);
      const sources = sourcesFile ? JSON.parse(fs.readFileSync(path.resolve(sourcesFile),'utf8'))
        : [args.find(a => a.startsWith('--source='))?.slice(9) || 'https://kream.co.kr/categories/50/24?sort=popular_score'];
      if (!Array.isArray(sources) || !sources.length || sources.length > 50 || sources.some(x => typeof x !== 'string')) throw new Error('sources-file must contain 1-50 search terms or KREAM list URLs');
      const {buildKreamListUrl,POPULAR_SORT} = await import('./kream-list-url.mjs');
      const queue = readJson(dir,'jobs.json',{jobs:[]});
      const listIds = [];
      for (const [index,source] of sources.entries()) {
        const id = `S${index+1}`; listIds.push(id);
        const url = buildKreamListUrl(source);
        if (!queue.jobs.some(j => j.id === id)) queue.jobs.push({id,url,expectedSort:POPULAR_SORT,actions:[{wait:1500},{kreamSort:'인기순'}]});
      }
      writeJson(dir,'jobs.json',queue);
      if (!replay && !rulesOnly && !args.some(a => ['--claude-efficient','--codex-efficient'].includes(a))) await runRoleAi(ctx,'error_manager',[{id:'startup',status:'waiting-popular-list',pending:1}],modelOptions);
      const until = Date.now()+(options.listTimeoutMs ?? Math.max(90000,sources.length*25000));
      const collectorDeadline = Date.now()+60000;
      while (listIds.some(id => !fs.existsSync(path.join(dir,`dump-${id}.json`)))) {
        if (replay) throw new Error('재생 입력에 인기순 목록 원본 없음');
        if (failure) throw failure;
        if (transport.stopped()) throw new Error('STOP 감지: 목록 수집 중단');
        if (Date.now() > collectorDeadline) {
          const health = await fetch('http://127.0.0.1:8787/health').then(r=>r.json()).catch(()=>null);
          if (!health?.lastPollAt) throw new Error('Chrome 수집 확장이 릴레이를 폴링하지 않음: 확장 로드·자동 실행 확인 필요');
        }
        if (Date.now() > until) throw new Error('인기순 목록 수집 시간 초과: Naver Price Dumper 실행·자동 실행 상태 확인 필요');
        await new Promise(resolve => setTimeout(resolve,1000));
      }
      const {spawnSync} = await import('node:child_process');
      const limit = args.find(a => a.startsWith('--limit='))?.slice(8) || '30';
      const extract = spawnSync(process.execPath,[path.join(ROOT,'kream-tools/collect-ids.mjs'),dir,'extract',limit,'--include-explored'],{encoding:'utf8',windowsHide:true});
      if (extract.status !== 0) throw new Error(String(extract.stderr || extract.stdout).slice(0,500));
      process.stdout.write(extract.stdout);
    }
    if (options.collectOnly) return {dir,runId,ids:readJson(dir,'k50-ids.json',[])};
    const forwarded = args.filter(a => !/^--(?:relay-dir|source|sources-file|limit|run-id)=/.test(a) && a !== '--rules-only');
    if (rulesOnly) forwarded.push('--rules-only');
    child = spawn(process.execPath,[path.join(ROOT,'renew/Cream/kream-tools/run-all.mjs'),dir,...forwarded,`--run-id=${runId}`],{cwd:ROOT,windowsHide:true,shell:false,stdio:'inherit',env:{...process.env,...(transport ? {CREAM_RELAY_SERVICE_DIR:transport.service} : {})}});
    const exit = await new Promise((resolve,reject) => {child.on('error',reject);child.on('close',resolve);});
    if (failure) throw failure;
    if (exit !== 0) throw new Error(`전체 파이프라인 종료 코드 ${exit}`);
    const automation = buildAutomationReport(dir);
    return {dir,runId,exitCode:0,automation:automation.summary};
  } catch (error) {
    recordIncident(dir,error,'통합 실행'); agentEvent(ctx,'error_manager','rules','done',{incident:true});
    if (!replay && !rulesOnly && !args.some(a => ['--claude-efficient','--codex-efficient'].includes(a))) await runRoleAi(ctx,'error_manager',[{id:'operation-failure',status:'failed',code:/STOP/.test(error.message)?'BLOCKED':'PIPELINE_FAILED'}],modelOptions);
    throw error;
  } finally {
    if (timer) clearInterval(timer); await syncing;
    if (transport) transport.cancelPending();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(ROOT,'kream-runs',new Date().toISOString().replace(/[-:.]/g,'')+'-team');
  const args = process.argv.slice(process.argv[2] === dir ? 3 : 2);
  try { const result = await startPipeline(dir,args); console.log(JSON.stringify(result)); }
  catch (error) { console.error(error.message);process.exitCode=1; }
}
