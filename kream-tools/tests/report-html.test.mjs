import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
let dir, html;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-report-test-'));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const products = [{id:'314483',name:'테스트 가디건',keyword:'몽클레르'}, {id:'123',name:'테스트 셔츠',keyword:'셔츠'}];
  const rows = products.map((p, i) => ({...p, bestTitle:i ? '테스트 셔츠' : '몽클레르 9B00002', net:100}));
  write('multi.json', products);
  write('n-multi.json', []);
  write('final-multi.json', {rows:[], meta:{}});
  write('dump-K314483.json', {text:'모델번호 J2-091-9B50700-A9341-999/U99\n색상 Black'});
  write('report-data.json', {funnel:{}, brandList:['몽클레르','셔츠'], candidates:[rows[0]], reference:[rows[1]]});
  execFileSync(process.execPath, [fileURLToPath(new URL('../build-report-html.mjs', import.meta.url)), dir]);
  html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
});
after(() => {
  if (dir && path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('cream-report-test-')) {
    fs.rmSync(dir, {recursive:true, force:true});
  }
});
test('standalone HTML preserves all matches and excludes the verified wrong Moncler model', () => {
  assert.ok(html.startsWith('<!doctype html>')); assert.match(html, /<html lang="ko">/);
  const data = JSON.parse(html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.rows.length, 2);
  const wrong = data.rows.find((r) => r.kreamId === '314483'); assert.ok(wrong); assert.equal(wrong.group, 'excluded'); assert.equal(wrong.net, null); assert.match(wrong.kreamModel, /9B50700/); assert.match(wrong.verification.reason, /9B00002/);
  assert.equal(data.brandList.length, 2); assert.doesNotMatch(html, /dash\.onData|dash\.data\(/);
});
test('interactive script compiles and declares filters, details, CSV and keyboard handling', () => {
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].filter((m) => !m[0].includes('application/json'));
  assert.equal(scripts.length, 1); for (const m of scripts) new vm.Script(m[1]);
  for (const id of ['search','brand','sort','detail','download','prev','next']) assert.ok(html.includes(`id="${id}"`));
  assert.match(html, /ArrowRight/); assert.match(html, /noopener noreferrer/); assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /<script[^>]*\ssrc=/); assert.doesNotMatch(html, /<link[^>]*href=["']https?:/);
});
