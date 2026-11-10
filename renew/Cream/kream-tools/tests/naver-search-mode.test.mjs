import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { naverSearchMode } from '../naver-search-mode.mjs';
test('retired API flag uses pages while preserving offline replay', () => {
  assert.equal(naverSearchMode({apiRequested:true,replay:false}), 'page');
  assert.equal(naverSearchMode({apiRequested:true,replay:true}), 'saved-api-cards');
  assert.equal(naverSearchMode({apiRequested:false,replay:true}), 'page');
});
test('live converter rejects retired service before credentials or network access', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'cream-api-retired-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const guard = path.join(dir,'guard.mjs');
  fs.writeFileSync(guard,"globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };\n");
  const script = fileURLToPath(new URL('../naver-api.mjs',import.meta.url));
  const r = spawnSync(process.execPath,[script,dir],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:`--import=${pathToFileURL(guard).href}`}});
  assert.equal(r.status,4); assert.match(r.stderr,/2026-07-31/); assert.doesNotMatch(r.stderr,/NETWORK_FORBIDDEN|키가 없음/);
  assert.equal(fs.existsSync(path.join(dir,'n-cards.json')),false);
});
