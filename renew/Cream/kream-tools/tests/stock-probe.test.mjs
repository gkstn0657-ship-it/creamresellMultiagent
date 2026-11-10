import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { stockSummary } from '../stock-summary.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); // Test dependency only; extension has none.
const core = fs.readFileSync(new URL('../../naver-extension/stock-probe.js', import.meta.url), 'utf8');
const bridge = fs.readFileSync(new URL('../../naver-extension/stock-dialog-main.js', import.meta.url), 'utf8');
let browser;
test.before(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
test.after(async () => { await browser?.close(); });

async function fixture(html, { budget = 19500, host = 'shop.example.test', before = '' } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html><head><meta charset="utf-8"></head><body>${html}</body></html>` }));
  await page.goto(`https://${host}/product`);
  await page.evaluate(() => { window.originalAlert = window.alert; window.originalConfirm = window.confirm; });
  await page.addScriptTag({ content: bridge });
  if (before) await page.evaluate(before);
  const cdp = await context.newCDPSession(page);
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'stock-test-isolated' });
  const evalIsolated = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await evalIsolated(core);
  const config = { token: 'fixture-token', deadline: Date.now() + budget };
  assert.equal(await page.evaluate((c) => installStockDialogBridge(c.token, c.deadline), config), true);
  const result = await evalIsolated(`kreamStockProbe(${JSON.stringify(config)})`);
  // Flush postMessage cleanup without altering probe timers.
  await page.waitForFunction(() => window.alert === window.originalAlert && window.confirm === window.originalConfirm);
  return { result, page, context, evalIsolated };
}

const native = (opts, extra = '') => `<label for="sizes">사이즈</label><select id="sizes"><option value="">선택하세요</option>${opts}</select>
  <section id="row"><input type="number" value="1" min="1"><button type="button" aria-label="수량 증가">+</button></section>
  <script>document.querySelector('select').onchange=()=>document.querySelector('input').value=1;
  document.querySelector('button').onclick=()=>{const q=document.querySelector('input'); ${extra || 'q.value=Number(q.value)+1;'}};</script>`;

test('selected option price evidence is captured at quantity one before increment probing', async () => {
  const html = native('<option value="S">S</option>');
  const f = await fixture(html.replace('<section id="row">', '<section id="row"><span data-size="S">옵션 S / 판매가 120,000원</span>'), { host: 'www.trenbe.com' });
  try { const row = f.result.results[0]; assert.equal(row.state, 'available'); assert.match(row.offerText, /S.*120,000원/); assert.equal(row.offerQuantity, 1); assert.ok(row.maxQty > 1); }
  finally { await f.context.close(); }
});

test('native select: records soldout/disabled, MAIN alert, limit, cleanup', async () => {
  const f = await fixture(native('<option value="100" disabled>100 (품절)</option><option value="105">105</option><option value="110" disabled>110</option>', "if(+q.value>=3)alert('재고가 부족합니다');else q.value=+q.value+1;"));
  try {
    const [sold, limited, disabled] = f.result.results;
    assert.equal(sold.state, 'soldout'); assert.equal(limited.state, 'limit'); assert.equal(limited.maxQty, 3);
    assert.deepEqual(limited.quantityHistory, [1, 2, 3, 3]); assert.match(limited.message, /재고가 부족/);
    assert.equal(disabled.state, 'unknown'); assert.ok(disabled.disabledReasons.includes('disabled'));
    assert.equal(f.result.enumerationComplete, true);
  } finally { await f.context.close(); }
});

test('5 increments means observed 6, not stock 5; no unsafe buttons clicked', async () => {
  const f = await fixture(native('<option value="105">105</option>') + '<button class="btn_cart" onclick="window.bad=true">장바구니</button><button onclick="window.bad=true">구매하기</button>');
  try {
    const r = f.result.results[0];
    assert.equal(r.maxQty, 6); assert.equal(r.plusClicks, 5); assert.equal(r.state, 'available');
    assert.equal(await f.page.evaluate(() => window.bad), undefined);
    assert.equal(await f.evalIsolated("kreamStockSafeTarget(document.querySelector('.btn_cart'))"), false);
  } finally { await f.context.close(); }
});

test('custom dropdown: reopening, rerendering, separate rows, transient toast', async () => {
  const f = await fixture(`<button id="opener" type="button">SIZE 선택</button>
    <ul role="listbox" hidden><li role="option" data-value="100">100</li><li role="option" data-value="105">105</li><li role="option" class="soldout">110</li></ul><div id="rows"></div>
    <script>
      const list=document.querySelector('ul'); document.querySelector('#opener').onclick=()=>list.hidden=false;
      list.onclick=(e)=>{if(!e.target.matches('li'))return; const size=e.target.textContent; list.hidden=true;
        const row=document.createElement('section');row.innerHTML='<span data-size="'+size+'">'+size+'</span><input type="number" value="1"><button type="button">+</button>';document.querySelector('#rows').append(row);
        row.querySelector('button').onclick=()=>{const q=row.querySelector('input'); if(+q.value>=2){const toast=document.createElement('div');toast.role='alert';toast.textContent='최대 구매 수량 2개';document.body.append(toast);setTimeout(()=>toast.remove(),80);}else {const copy=q.cloneNode();copy.value=+q.value+1;q.replaceWith(copy);}};
      };
    </script>`, { host: 'www.lotteon.com' });
  try {
    assert.equal(f.result.adapter, 'lotteon');
    assert.deepEqual(f.result.results.map((r) => [r.size, r.state, r.maxQty]), [['100', 'limit', 2], ['105', 'limit', 2], ['110', 'soldout', null]]);
    assert.equal(f.result.enumerationComplete, false);
  } finally { await f.context.close(); }
});

test('nested purchase class, submit buttons and navigation links are refused', async () => {
  const f = await fixture(`<div class="btn-cart"><button type="button" onclick="window.bad=1">사이즈 선택</button></div><form><button>SIZE 선택</button></form><a href="/checkout">옵션 보기</a>`);
  try { assert.equal(f.result.results[0].state, 'unknown'); assert.equal(await f.page.evaluate(() => window.bad), undefined); }
  finally { await f.context.close(); }
});

test('login/captcha: zero interaction; confirm is captured and cancelled', async () => {
  const blocked = await fixture(native('<option value="105">105</option>') + '<div>보안 문자를 입력하세요</div>');
  try { assert.equal(blocked.result.reason, 'blocked-or-captcha'); assert.equal(blocked.result.results[0].state, 'unknown'); }
  finally { await blocked.context.close(); }
  const f = await fixture(native('<option value="105">105</option>', "window.confirmResult=confirm('최대 구매 수량입니다');"));
  try { assert.equal(await f.page.evaluate(() => window.confirmResult), false); assert.equal(f.result.results[0].state, 'limit'); }
  finally { await f.context.close(); }
});

test('time budget retains every untested option and stops later actions', async () => {
  const f = await fixture(native('<option value="100">100</option><option value="105">105</option><option value="110">110</option>'), { budget: 1600 });
  try {
    assert.equal(f.result.reason, 'time-budget'); assert.equal(f.result.results.length, 3);
    assert.equal(f.result.results[1].state, 'unknown'); assert.ok(f.result.elapsedMs < 1700);
    const q = await f.page.locator('input').inputValue(); await f.page.waitForTimeout(700); assert.equal(await f.page.locator('input').inputValue(), q);
  } finally { await f.context.close(); }
});

test('ambiguous/dependent options and no quantity response remain incomplete', async () => {
  const f = await fixture(native('<option value="105">105</option>') + '<select name="color"><option>Black</option><option>White</option></select>');
  try { assert.equal(f.result.reason, 'dependent-options-need-adapter'); assert.equal(f.result.results[0].state, 'unknown'); }
  finally { await f.context.close(); }
  const stalled = await fixture(native('<option value="105">105</option>', '/* ignored click */'));
  try { assert.equal(stalled.result.results[0].reason, 'quantity-unchanged'); assert.notEqual(stalled.result.results[0].state, 'limit'); assert.equal(stalled.result.complete, false); }
  finally { await stalled.context.close(); }
});

test('JSON parsing: mixed sizes are not product-wide soldout; blocked wins', () => {
  const d = { stockProbe: { complete: true, enumerationComplete: true, results: [{ size: '100', state: 'soldout', maxQty: null }, { size: '105', state: 'available', maxQty: 6 }] } };
  assert.equal(stockSummary(d).allSoldout, false); assert.deepEqual(stockSummary(d).available, ['105']);
  assert.match(stockSummary(d).text, /관찰 최대 6개\(실재고 아님\)/);
  assert.deepEqual(stockSummary({ ...d, blocked: true }).available, []);
  assert.match(stockSummary({ text: '구매 가능 사이즈\t100 , 105 , 110\n상품설명' }).text, /100 , 105 , 110.*미검증/);
});

test('hidden/aria-disabled options and unparsed labels prevent full-stock claims', async () => {
  const f = await fixture('<select name="size"><option value="">선택하세요</option><option value="100" disabled>100 품절</option><option value="105" aria-disabled="true">105</option><option value="110" hidden>110</option><option value="special" disabled>Special Fit</option></select>');
  try {
    assert.equal(f.result.enumerationComplete, false);
    assert.deepEqual(f.result.results.map((r) => r.state), ['soldout', 'unknown', 'unknown']);
    assert.ok(f.result.results[1].disabledReasons.includes('aria-disabled'));
    assert.ok(f.result.results[2].disabledReasons.includes('hidden'));
    assert.equal(stockSummary({ stockProbe: f.result }).allSoldout, false);
  } finally { await f.context.close(); }
});
