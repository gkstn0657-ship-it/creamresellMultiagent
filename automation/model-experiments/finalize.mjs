import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {variants} from './cases.mjs';
import {writeJsonAtomic as write} from '../agent-team/atomic-json.mjs';
import {digest} from '../agent-team/store.mjs';
const original=path.resolve('kream-runs/model-placement-20261126'),clarified=path.resolve('kream-runs/model-placement-20261126-clarified');
const readRows=dir=>fs.readdirSync(dir).filter(f=>f.includes('--')&&f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f))));
const first=readRows(original),second=readRows(clarified);
if(first.length!==48||second.length!==8)throw Error('EXPERIMENT_INCOMPLETE');
const rows=[...first.filter(r=>r.caseId!=='owner-conflict'),...second];
const median=a=>{a=[...a].sort((x,y)=>x-y);return (a[(a.length-1)>>1]+a[a.length>>1])/2;};
const groups=[];for(const role of ['coordinator','owner','reviewer'])for(const v of variants){const r=rows.filter(x=>x.role===role&&x.variant.id===v.id);groups.push({role,variant:v.id,passed:r.filter(x=>x.passed).length,total:r.length,medianMs:median(r.map(x=>x.elapsedMs)),medianOutputTokens:median(r.map(x=>x.tokenUsage?.total?.outputTokens||0)),failures:r.filter(x=>!x.passed).map(x=>({id:x.id,checks:x.checks,error:x.error}))});}
const baseline={coordinator:'luna-high',owner:'luna-high',reviewer:'luna-medium'},decisions={};
for(const [role,current] of Object.entries(baseline)){
 const measured=groups.filter(x=>x.role===role),old=measured.find(x=>x.variant===current),eligible=measured.filter(x=>x.total===4&&x.passed===4).sort((a,b)=>a.medianMs-b.medianMs);
 if(!eligible.length)throw Error('NO_QUALIFIED_MODEL:'+role);
 const fastest=eligible[0],selected=old.passed!==4||fastest.medianMs<=old.medianMs*0.85?fastest:old;
 decisions[role]={baseline:current,selected:selected.variant,reason:selected.variant===current?'No fully passing challenger was at least 15% faster.':'All pilot checks passed; at least 15% faster than prior default, or prior default did not qualify.',medianMs:selected.medianMs,baselineMedianMs:old.medianMs};
}
const config=id=>{const {model,effort}=variants.find(v=>v.id===id);return {model,effort};};
const report={version:1,totalCalls:56,scoredCalls:48,excludedCalls:8,amendment:'The initial owner-conflict case omitted shipping and KREAM fee flags. Eight runs are excluded for input ambiguity, not counted as model errors. All four variants repeated the clarified case twice. Other 40 runs are unchanged.',groups,decisions,limits:['Synthetic tool-contract pilot; two cases per role, two repeats per variant.','No statistical significance claim. Latency includes tool turns and shared local transport; cache/network conditions vary.','No dollar-cost comparison; reported token totals are not account billing.','No live profitability accuracy or production SLA inferred. Adoption review floor remains Sol/high.']};
write(path.join(original,'final-report.json'),report);
write(fileURLToPath(new URL('../agent-team/model-policy.json',import.meta.url)),{version:'placement-pilot-20261126-v1',experimentHash:digest(report),experimentReport:'kream-runs/model-placement-20261126/final-report.json',defaults:{coordinator:config(decisions.coordinator.selected),owner:config(decisions.owner.selected),reviewer:config(decisions.reviewer.selected),research:config('luna-medium'),deepReviewer:config('sol-high')},upgrades:{coordinator:config('sol-high'),owner:config('sol-high'),reviewer:config('sol-high')},maxAgentUpgrades:1,adoptReviewFloor:'sol-high',status:'provisional-small-synthetic-pilot'});
console.log(JSON.stringify(report,null,2));
