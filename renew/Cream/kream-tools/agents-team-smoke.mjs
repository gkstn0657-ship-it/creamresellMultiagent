// Explicit paid-model integration check. Synthetic evidence only; no website or order.
import fs from 'node:fs';
import path from 'node:path';
import {teamFixture} from './tests/team-fixture.mjs';
import {runAgents} from './agents-run.mjs';
import {writeJson,readJson} from './agents-core.mjs';
const dir=process.argv[2]&&path.resolve(process.argv[2]);
if(!dir || !process.argv.includes('--live')) throw Error('사용: node agents-team-smoke.mjs <새 빈 폴더> --live');
if(fs.existsSync(dir)&&fs.readdirSync(dir).length) throw Error('빈 검증 폴더 필요');
fs.mkdirSync(dir,{recursive:true});const now=new Date().toISOString();teamFixture(dir,now);
// Fixtures use fixed trade dates. Refresh only synthetic trade dates, never archive data.
const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'2-digit',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','/');
const market=readJson(dir,'dump-K123.json');market.text=market.text.replaceAll('26/11/08',date);writeJson(dir,'dump-K123.json',market);
const started=Date.now();const result=await runAgents(dir,{runId:'live-team-smoke-'+Date.now().toString(36),roleAi:true,onRole:e=>console.log(JSON.stringify(e))});
const ai=readJson(dir,'agents-team-ai.json'),team=result.final.meta.에이전트팀;
const report={syntheticOnly:true,model:'gpt-6.1-sol',reasoning:'high',elapsedMs:Date.now()-started,team,usage:ai.usage||[],candidateCount:result.final.rows.filter(r=>r['판정']==='후보').length,passed:team.complete&&ai.calls===6};
writeJson(dir,'model-smoke.json',report);console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
