import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runs = path.join(root, 'kream-runs', 'automation');
const state = JSON.parse(fs.readFileSync(path.join(runs, 'loop-state.json'), 'utf8'));
const pid = JSON.parse(fs.readFileSync(path.join(runs, 'loop-process.json'), 'utf8')).pid;
try { process.kill(pid, 0); throw new Error('Stop the loop before changing its target'); }
catch (error) { if (error.message === 'Stop the loop before changing its target') throw error; }
if (state.status !== 'failed' || state.error !== 'STOP requested') throw new Error('Expected a stopped cycle');
const cycle = path.resolve(state.dir);
if (!cycle.startsWith(path.resolve(runs) + path.sep)) throw new Error('Unexpected cycle directory');
const target = Number(process.argv[2]);
if (!Number.isSafeInteger(target) || target < 1 || target > 500) throw new Error('Target must be 1–500');
const idsFile = path.join(cycle, 'k50-ids.json');
const batchesFile = path.join(cycle, 'batches.json');
const ids = JSON.parse(fs.readFileSync(idsFile, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(batchesFile, 'utf8'));
if (!Array.isArray(ids) || ids.length !== manifest.ids.length || ids.some((id,i) => String(id) !== String(manifest.ids[i])))
  throw new Error('ID files disagree');
if (target > ids.length || target % manifest.batchSize !== 0) throw new Error('Target must fit whole existing batches');
const kept = manifest.batches.slice(0, target / manifest.batchSize);
if (kept.length !== target / manifest.batchSize || manifest.batches.slice(kept.length).some(batch => batch.status !== 'pending'))
  throw new Error('Target would omit started batches');
for (const [file,data] of [[idsFile,ids],[batchesFile,manifest]]) {
  const backup = file.replace(/\.json$/, '-full.json');
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify(data,null,2) + '\n');
}
const write = (file,data) => { const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n'); fs.renameSync(temp,file); };
write(idsFile,ids.slice(0,target));
write(batchesFile,{...manifest,ids:manifest.ids.slice(0,target),batches:kept});
console.log(JSON.stringify({cycle,target,alreadyDone:kept.filter(batch=>batch.status==='done').reduce((n,batch)=>n+batch.ids.length,0),
  archivedIds:path.join(cycle,'k50-ids-full.json')}));
