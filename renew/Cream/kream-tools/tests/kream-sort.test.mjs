import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const code = fs.readFileSync(new URL('../../naver-extension/kream-sort.js', import.meta.url), 'utf8');
let browser;
test.before(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
test.after(async () => { await browser?.close(); });
async function fixture(html, fn) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://kream.co.kr/search?sort=popular_score'); await page.addScriptTag({ content: code });
  try { await fn(page); } finally { await ctx.close(); }
}
test('recommended dropdown changes to popular and verifies the selected trigger label', async () => {
  await fixture(`<button id="sort" aria-expanded="false">추천순</button><ul role="listbox" hidden><li role="option">추천순</li><li role="option">인기순</li></ul><button onclick="window.bad=true">구매하기</button><script>const b=document.querySelector('#sort'),u=document.querySelector('ul');b.onclick=()=>{u.hidden=false;b.setAttribute('aria-expanded','true')};u.onclick=e=>{b.textContent=e.target.textContent;u.hidden=true;b.setAttribute('aria-expanded','false')};</script>`, async (page) => {
    const result = await page.evaluate(() => kreamEnsureSort()); assert.equal(result.verified, true); assert.equal(result.selectedLabel, '인기순'); assert.ok(result.verifiedAt); assert.equal(await page.evaluate(() => window.bad), undefined);
  });
});
test('popular URL and a menu entry alone cannot establish selected popular sorting', async () => {
  await fixture('<button>추천순</button><ul role="listbox"><li role="option">인기순</li></ul>', async (page) => {
    const result = await page.evaluate(() => kreamEnsureSort('인기순', 500)); assert.equal(result.verified, false); assert.equal(result.selectedLabel, '추천순');
  });
});
test('native sort selection and already-selected popular are verified', async () => {
  await fixture('<select><option>추천순</option><option>인기순</option></select>', async (page) => {
    assert.equal((await page.evaluate(() => kreamEnsureSort())).verified, true);
    assert.equal((await page.evaluate(() => kreamEnsureSort())).selectedLabel, '인기순');
  });
});
test('collector rejects unverified ordering and writes provenance for confirmed dumps', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-sort-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../collect-ids.mjs', import.meta.url));
  const dump = { url: 'https://kream.co.kr/categories/50/24?sort=popular_score', at: '2026-11-08T03:00:00Z', links: [{ h: 'https://kream.co.kr/products/123' }] };
  fs.writeFileSync(path.join(dir, 'dump-S1.json'), JSON.stringify(dump));
  assert.notEqual(spawnSync(process.execPath, [script, dir, 'extract', '10'], { encoding: 'utf8' }).status, 0);
  assert.equal(fs.existsSync(path.join(dir, 'k50-ids.json')), false);
  dump.kreamSort = { requested: '인기순', verified: true, selectedLabel: '인기순', verifiedAt: dump.at };
  fs.writeFileSync(path.join(dir, 'dump-S1.json'), JSON.stringify(dump));
  assert.equal(spawnSync(process.execPath, [script, dir, 'extract', '10', '--include-explored'], { encoding: 'utf8' }).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'k50-ids.json'), 'utf8')), ['123']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'k50-id-evidence.json'), 'utf8')).items[0].selectedSort, '인기순');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'k50-id-evidence.json'), 'utf8')).items[0].sortParameter, 'popular_score');
});
