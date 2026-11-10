import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../../kream-runs/20261108/index.html', import.meta.url), 'utf8');
test('standalone HTML preserves all matches and excludes the verified wrong Moncler model', () => {
  assert.ok(html.startsWith('<!doctype html>')); assert.match(html, /<html lang="ko">/);
  const data = JSON.parse(html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.rows.length, 23);
  const wrong = data.rows.find((r) => r.kreamId === '314483'); assert.ok(wrong); assert.equal(wrong.group, 'excluded'); assert.equal(wrong.net, null); assert.match(wrong.kreamModel, /9B50700/); assert.match(wrong.verification.reason, /9B00002/);
  assert.equal(data.brandList.length, 21); assert.doesNotMatch(html, /dash\.onData|dash\.data\(/);
});
test('interactive script compiles and declares filters, details, CSV and keyboard handling', () => {
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].filter((m) => !m[0].includes('application/json'));
  assert.equal(scripts.length, 1); for (const m of scripts) new vm.Script(m[1]);
  for (const id of ['search','brand','sort','detail','download','prev','next']) assert.ok(html.includes(`id="${id}"`));
  assert.match(html, /ArrowRight/); assert.match(html, /noopener noreferrer/); assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /<script[^>]*\ssrc=/); assert.doesNotMatch(html, /<link[^>]*href=["']https?:/);
});
