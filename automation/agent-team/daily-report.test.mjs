import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {syncDailyReports} from './daily-report.mjs';

test('opted-in general work publishes only completed live judgments under their Korean date', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-daily-report-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const workId = 'work-00000000-0000-0000-0000-000000000001';
  const runId = 'batch-00000000-0000-0000-0000-000000000002';
  const save = (file, data) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, JSON.stringify(data));
  };
  save('work-orders/' + workId + '.json', {id: workId, entries: [{runId}]});
  save(runId + '/launch.json', {workId, managedBy: 'deterministic-exploration'});
  const row = {status: 'complete', productId: '123', assessment: {
    decision: 'hold', reason: '재고 확인 필요', reviewId: 'review-1', at: '2026-11-21T15:01:00Z'
  }};
  const batch = {status: 'complete', mode: 'live', results: [row], finishedAt: '2026-11-22T15:01:00Z'};
  const packet = {productId: '123', candidate: {title: '예시'}, observations: [{mode:'live'}],
    offers: [{productUrl:'https://www.musinsa.com/products/99', option:'M'}]};
  save(runId + '/batch-result.json', batch);
  save(runId + '/packets/product-123.json', packet);
  const received = [];
  const append = (day, entry) => received.push({day, entry});
  syncDailyReports(root, workId, runId, append);
  assert.equal(received.length, 0);
  save('explorations/' + workId + '/daily-report.enabled', true);
  syncDailyReports(root, workId, undefined, append);
  assert.equal(received[0].day, '2026-11-22');
  assert.deepEqual(received[0].entry.sources.map(s => s.url),
    ['https://kream.co.kr/products/123', 'https://www.musinsa.com/products/99']);
  syncDailyReports(root, workId, runId, append);
  assert.deepEqual(received[1], received[0]);
  if (process.platform === 'win32') {
    const output = path.join(root, '별도 저장 폴더');
    const cli = fileURLToPath(new URL('./daily-report.mjs', import.meta.url));
    const replay = spawnSync(process.execPath, [cli, '--work=' + workId], {cwd: root,
      env: {...process.env, CREAM_AGENT_TEAMS_ROOT:root, CREAM_REPORTS_DIR:output}, encoding:'utf8', windowsHide:true});
    assert.equal(replay.status, 0, replay.stderr);
    assert.match(fs.readFileSync(path.join(output, '2026-11', '2026-11-22.md'), 'utf8'), /예시/);
    assert.equal(fs.existsSync(path.join(output,'append_result.py')), false);
  }
  for (const change of [{mode: 'fixture'}, {status: 'needs_attention'}, {analysisProfile: 'musinsa-ranking'}]) {
    save(runId + '/batch-result.json', {...batch, ...change});
    syncDailyReports(root, workId, undefined, append);
  }
  save(runId + '/batch-result.json', batch);
  save(runId + '/packets/product-123.json', {...packet, observations:[{mode:'replay'}]});
  syncDailyReports(root, workId, undefined, append);
  assert.equal(received.length, 2);
});
