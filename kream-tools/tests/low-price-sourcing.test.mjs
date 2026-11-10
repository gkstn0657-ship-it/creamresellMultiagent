import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
test('multi-brand search includes low-price high-volume products and honors an explicit floor', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-low-price-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  write('multi.json', [{id:'1',status:'ok',n:100,kreamMed:20000,name:'나이키 양말',model:'SX7676-100',keyword:'나이키'},
    {id:'2',status:'ok',n:100,kreamMed:0,name:'가격 없음'}]); write('jobs.json', { jobs:[] });
  const script = fileURLToPath(new URL('../make-n-jobs-multi.mjs', import.meta.url));
  const run = () => spawnSync(process.execPath, [script, dir], { encoding:'utf8' });
  assert.equal(run().status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'n-eligible.json'),'utf8')).map(p => p.id), ['1']);
  write('agent-policy.json', { minMarketPrice:100000 }); assert.equal(run().status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'n-eligible.json'),'utf8')).length, 0);
});
