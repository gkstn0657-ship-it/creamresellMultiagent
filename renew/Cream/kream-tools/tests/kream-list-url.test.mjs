import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildKreamListUrl, isKreamListUrl } from '../kream-list-url.mjs';
test('supplied category URL is retained verbatim with popular_score', () => {
  const url = 'https://kream.co.kr/categories/50/24?sort=popular_score'; assert.equal(buildKreamListUrl(url), url);
  const changed = new URL(buildKreamListUrl('https://kream.co.kr/categories/50/24?sort=recommend&gender=men'));
  assert.equal(changed.pathname, '/categories/50/24'); assert.equal(changed.searchParams.get('gender'), 'men'); assert.equal(changed.searchParams.get('sort'), 'popular_score');
});
test('keyword searches use popular_score and unsafe or product URLs are rejected', () => {
  const url = new URL(buildKreamListUrl('스톤아일랜드')); assert.equal(url.searchParams.get('keyword'), '스톤아일랜드'); assert.equal(url.searchParams.get('sort'), 'popular_score');
  for (const input of ['https://notkream.co.kr/categories/50/24','http://kream.co.kr/search','https://kream.co.kr/products/123','javascript:alert(1)']) { assert.equal(isKreamListUrl(input), false); assert.throws(() => buildKreamListUrl(input)); }
});
test('job generation is idempotent, handles sparse job IDs and is atomic on invalid input', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-score-url-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../collect-ids.mjs', import.meta.url));
  const original = { jobs: [{ id: 'S3', url: 'https://kream.co.kr/search?keyword=old' }] }; fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(original));
  const url = 'https://kream.co.kr/categories/50/24?sort=popular_score';
  assert.equal(spawnSync(process.execPath, [script, dir, 'jobs', url]).status, 0);
  let jobs = JSON.parse(fs.readFileSync(path.join(dir, 'jobs.json'), 'utf8')).jobs; assert.equal(jobs[1].id, 'S4'); assert.equal(jobs[1].url, url); assert.equal(jobs[1].expectedSort, 'popular_score');
  assert.equal(spawnSync(process.execPath, [script, dir, 'jobs', url]).status, 0); assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'jobs.json'), 'utf8')).jobs.length, 2);
  const before = fs.readFileSync(path.join(dir, 'jobs.json'), 'utf8'); assert.notEqual(spawnSync(process.execPath, [script, dir, 'jobs', '몽클레어', 'https://wrong.example/search']).status, 0); assert.equal(fs.readFileSync(path.join(dir, 'jobs.json'), 'utf8'), before);
});
