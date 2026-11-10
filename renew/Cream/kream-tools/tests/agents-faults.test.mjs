import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { acquireRunLock, readJson, writeJson } from '../agents-core.mjs';
test('killed writer leaves prior final intact; dead lock is recoverable and retry is idempotent', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-fault-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeJson(dir, 'final-all.json', { rows: [{ id: 'original' }] });
  const helper = path.join(dir, 'writer.mjs'), core = new URL('../agents-core.mjs', import.meta.url).href;
  fs.writeFileSync(helper, `import fs from 'node:fs';import path from 'node:path';import{acquireRunLock}from ${JSON.stringify(core)};const dir=process.argv[2];acquireRunLock(dir);fs.writeFileSync(path.join(dir,'final-all.json.interrupted.tmp'),'{partial');process.stdout.write('READY\\n');setInterval(()=>{},1000);`);
  const child = spawn(process.execPath, [helper, dir], { windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  t.after(() => { if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL'); });
  await Promise.race([once(child.stdout, 'data'), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('fault worker timeout')), 5000); timer.unref(); })]);
  assert.throws(() => acquireRunLock(dir), /실행 중/);
  const closed = once(child, 'close'); child.kill('SIGKILL'); await closed;
  assert.deepEqual(readJson(dir, 'final-all.json'), { rows: [{ id: 'original' }] });
  const release = acquireRunLock(dir); writeJson(dir, 'final-all.json', { rows: [{ id: 'retried' }] }); release();
  assert.deepEqual(readJson(dir, 'final-all.json'), { rows: [{ id: 'retried' }] }); assert.equal(fs.existsSync(path.join(dir, '.cream-run.lock')), false);
});
test('malformed lock fails closed without deleting another writer marker', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-lock-fault-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, '.cream-run.lock'), '{partial');
  assert.throws(() => acquireRunLock(dir), /읽을 수 없음/); assert.equal(fs.readFileSync(path.join(dir, '.cream-run.lock'), 'utf8'), '{partial');
});
