import fs from 'node:fs';
import path from 'node:path';
import { buildKreamListUrl, POPULAR_SORT } from './kream-list-url.mjs';
const stamp = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()).replace(/\D/g,'');
const dir = path.resolve(`kream-runs/${stamp}-legacy-sourcing-five`);
fs.mkdirSync(dir, { recursive:false });
const policy = JSON.parse(fs.readFileSync('kream-runs/sourcing-five-20261108/agent-policy.json','utf8'));
fs.writeFileSync(path.join(dir,'agent-policy.json'),JSON.stringify(policy,null,2));
const url = buildKreamListUrl('https://kream.co.kr/categories/50/24?sort=popular_score');
fs.writeFileSync(path.join(dir,'jobs.json'),JSON.stringify({jobs:[{id:'S1',url,expectedSort:POPULAR_SORT,actions:[{wait:1500},{kreamSort:'인기순'}]}]},null,2));
fs.writeFileSync(path.join(dir,'sourcing-state.json'),JSON.stringify({at:new Date().toISOString(),status:'awaiting-list-capture',targetProducts:5,
  sourceMode:'existing-local-extension-and-relay',actualOrdersAllowed:false,policyFile:'agent-policy.json'},null,2));
fs.writeFileSync('kream-runs/active-sourcing-run.json',JSON.stringify({dir,at:new Date().toISOString(),sourceMode:'legacy-extension'},null,2));
console.log(JSON.stringify({dir,queuedJobs:1,sort:POPULAR_SORT}));
