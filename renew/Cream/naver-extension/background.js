// 릴레이의 /jobs 에서 URL을 하나씩 받아 열고, 화면 텍스트+링크를 /dump 로 보낸다. 해석은 하지 않는다.
// 안전장치: 작업은 로컬 릴레이가 만든 것만 / 1회 최대 MAX_PER_RUN건 / 작업 간 6~11초 / 차단·캡차 화면 감지 시 즉시 중단.
const RELAY = 'http://127.0.0.1:8787';
importScripts('stock-dialog-main.js');
const MAX_PER_RUN = 200;
const BLOCK_RE = /접속이 (일시적으로 )?제한|비정상적인 접근|쇼핑 서비스 접속|captcha|보안 문자|자동입력 방지|robot|not allowed due to safety/i;
let running = false, tabId = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (a, b) => a + Math.random() * (b - a);

async function log(msg) {
  console.log(msg);
  const { logs = [] } = await chrome.storage.local.get('logs');
  logs.push(new Date().toLocaleTimeString('ko-KR') + ' ' + msg);
  await chrome.storage.local.set({ logs: logs.slice(-40) });
}

// 페이지 로딩 대기: 예전엔 onUpdated 'complete' 이벤트만 기다려 (리스너를 붙이기 전에 이벤트가 지나가면) 40초 타임아웃까지 멈췄다 → 약 5건 중 1건이 48초.
// 지금은 tabs.get 으로 status 를 0.3초마다 직접 확인하고, 'loading' 을 한 번 본 뒤 'complete' 가 되면(또는 1.5초 지나 complete 면) 바로 진행. 최대 15초.
async function waitComplete(id, timeoutMs = 15000) {
  const t0 = Date.now(); let sawLoading = false;
  while (Date.now() - t0 < timeoutMs) {
    let st = 'complete'; try { st = (await chrome.tabs.get(id)).status; } catch { return; }
    if (st === 'loading') sawLoading = true;
    else if (sawLoading || Date.now() - t0 > 1500) return;
    await sleep(300);
  }
}
// 네이버 쇼핑 광고 링크(cr.shopping.naver.com/adcr)는 "해당 쇼핑몰로 이동중입니다" 안내 페이지를 약 7초 보여준 뒤 판매처로 자동 이동한다.
// 이동 전에 글자를 읽기 시작하면 도중에 페이지가 바뀌어 수집이 실패하므로(2026-11-07 판매처 13건 중 6건), 주소가 바뀌고 로딩이 끝날 때까지 최대 20초 기다린다.
// 안내 페이지의 SKIP 버튼은 누르지 않는다(화면 조작 없이 자동 이동만 기다림).
async function waitRedirect(id, jobId, timeoutMs = 20000) {
  const isInterstitial = (t) => t && (/^https?:\/\/cr\d*\.shopping\.naver\.com\/adcr/.test(t.url || '') || /잠깐! 네이버쇼핑/.test(t.title || ''));
  let t; try { t = await chrome.tabs.get(id); } catch { return; }
  if (!isInterstitial(t)) return;
  await prog(jobId, '판매처로 이동 대기');
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(500);
    try { t = await chrome.tabs.get(id); } catch { return; }
    if (!isInterstitial(t)) { await waitComplete(id); await log(`이동 완료 ${jobId} (${Math.round((Date.now() - t0) / 1000)}초)`); return; }
  }
  await log(`이동 대기 시간 초과 ${jobId}: 안내 페이지에 머묾`);
}
// 2026-11-08: 작업 탭이 연 새 탭·팝업 창(로그인 창, 새 창 링크 등)은 작업이 끝나면 닫는다. 사용자의 다른 탭은 건드리지 않는다.
const openedByJob = new Set();
chrome.tabs.onCreated.addListener((t) => { if (tabId !== null && t.openerTabId === tabId) openedByJob.add(t.id); });
async function closeOpenedByJob() { for (const x of [...openedByJob]) { openedByJob.delete(x); try { await chrome.tabs.remove(x); } catch {} } }
async function ensureTab() {
  if (tabId !== null) { try { await chrome.tabs.get(tabId); return tabId; } catch { tabId = null; } }
  const w = await chrome.windows.create({ url: 'about:blank', focused: false, width: 1200, height: 900 });
  tabId = w.tabs[0].id; return tabId;
}

// 페이지 안에서 실행: (선택) 화면 조작 actions 수행 → 천천히 스크롤(지연 로딩 대응) → 텍스트와 링크 수집
// actions: { wait:ms } | { click:'텍스트', exact?:bool, after?:ms } | { toggleOff:'텍스트' } | { selectMalls:['판매처',...], apply?:['적용','확인'] }
async function pageDump(actions, stockConfig = null) {
  // 2026-11-08: href="javascript:void(0)" 같은 빈 링크를 확장이 누르면 크롬이 그 주소를 확장 보안 규칙(CSP)으로 실행하려다 막고 오류를 남긴다.
  // 사이트의 클릭 처리기는 그대로 실행되도록 전파는 막지 않고, javascript: 주소 실행(기본 동작)만 취소한다. 이 작업 탭에서만 동작.
  if (!globalThis.__kreamJsUrlGuard) {
    globalThis.__kreamJsUrlGuard = true;
    document.addEventListener('click', (e) => { const el = e.target && e.target.closest ? e.target.closest('a[href]') : null; if (el && /^\s*javascript:/i.test(el.getAttribute('href') || '')) e.preventDefault(); }, true);
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const vis = (e) => e && e.offsetParent !== null;
  // 2026-11-08: 엄격한 안전검사(조상 요소까지 검사)는 판매처 재고 탐색(stockConfig)에만 적용한다. 크림·네이버 검색 작업에 걸면 '거래 내역 더보기' 같은 무해한 버튼도 막혀 크림 체결 수집이 통째로 실패했다.
  // 그 외 작업은 누르는 요소 자신의 글자가 구매·판매·결제·주문·장바구니일 때만 막는다.
  const guardOk = (el) => (stockConfig ? !!globalThis.kreamStockSafeTarget?.(el) : !/^(구매|판매|구매하기|판매하기)$|즉시\s*(구매|판매)|결제|주문|장바구니/.test(norm(el && (el.innerText || el.textContent || ''))));
  const safeClick = (el) => { if (!guardOk(el)) throw new Error('구매/주문 또는 안전 미확인 클릭 차단'); el.click(); };
  // The function lives in this extension's ISOLATED world, loaded by executeScript(files).
  const stockProbe = globalThis.kreamStockProbe;
  // 2026-11-08 AI 지정 순서 탐색(aiSteps): 확장은 지정된 순서대로 누르고 장면마다 저장만 한다. 해석은 나중에 AI가 한다.
  //   { domScan: true }                         옵션 영역 구조 수집(AI가 누를 순서를 정할 자료)
  //   { click: 'css', text?: '105', after?: ms } 화면에 보이는 요소 중 css 와 글자로 찾아 누름(구매·주문 버튼 차단 검사 통과 필수)
  //   { select: 'css', option: '105' }          <select> 에서 글자가 맞는 옵션 선택
  //   { snap: '라벨' }                           그 순간의 수량 칸 값·안내 문구·팝업·옵션 주변 글자 저장
  const aiAct = (actions || []).find((a) => a && Array.isArray(a.aiSteps));
  const aiProbe = aiAct ? await (async (steps) => {
    const out = { steps: [], snaps: [], dom: null, dialogs: [], stopped: '' };
    const deadline = Date.now() + 38000;
    const dialogs = [];
    const onMsg = (e) => { if (e.source === window && e.data && e.data.source === 'kream-stock-main' && (!stockConfig || e.data.token === stockConfig.token) && /alert|confirm|prompt/.test(e.data.kind)) dialogs.push(`${e.data.kind}: ${e.data.message}`); };
    window.addEventListener('message', onMsg);
    const visible = (e) => !!e && e.isConnected && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const press = (el) => { if (!globalThis.kreamStockSafeTarget?.(el)) throw new Error('위험 클릭 차단'); for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); };
    const lab = (e) => norm(e && (e.innerText || e.textContent || e.getAttribute('aria-label') || e.value)).slice(0, 80);
    const cssPath = (e) => { const parts = []; for (let n = e, i = 0; n && n.nodeType === 1 && i < 5; n = n.parentElement, i++) { let seg = n.tagName.toLowerCase(); if (n.id) { seg += '#' + n.id; parts.unshift(seg); break; } const cls = [...n.classList].slice(0, 2).join('.'); if (cls) seg += '.' + cls; parts.unshift(seg); } return parts.join(' > '); };
    const scrub = (h) => String(h || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\svalue="[^"]*"/gi, '').replace(/\s(on\w+|data-[\w-]+)="[^"]*"/gi, '').replace(/\s+/g, ' ');
    const KEY = /사이즈|size|옵션|option|수량|qty|quantity|선택|품절|재고|구매\s*가능/i;
    const snap = (labelText) => {
      const qty = [...document.querySelectorAll('input')].filter((i) => visible(i) && !/search|keyword|word/i.test(i.name + ' ' + i.id + ' ' + i.className) && !/^(button|submit|hidden|checkbox|radio)$/i.test(i.type) && (i.type === 'number' || /(^|[^a-z])(qty|quantity|amount|count|cnt|ea|num)([^a-z]|$)|수량/i.test(i.name + ' ' + i.id + ' ' + i.className))).map((i) => ({ path: cssPath(i), value: i.value }));
      const notes = [...document.querySelectorAll('div,p,span,li,strong,em')].filter((e) => visible(e) && e.children.length < 3 && /재고|수량|품절|최대|최소|구매\s*가능|주문\s*가능|선택/.test(e.textContent || '') && norm(e.textContent).length < 120).map((e) => norm(e.textContent)).filter((t, i, a) => a.indexOf(t) === i).slice(0, 25);
      out.snaps.push({ label: labelText, at: Date.now(), qty, notes, dialogs: dialogs.splice(0) });
    };
    try {
      for (const st of steps) {
        if (Date.now() > deadline) { out.stopped = '시간 초과'; break; }
        try {
          if (st.domScan) {
            const els = [...document.querySelectorAll('select,button,a,li,div,span,td,tr,input,label,[role=button],[role=option],[role=listbox]')]
              .filter((e) => visible(e) && e.getBoundingClientRect().top + scrollY < 2600 && (e.tagName === 'SELECT' || /input/i.test(e.tagName) || KEY.test(lab(e) + ' ' + e.id + ' ' + e.className)) && lab(e).length < 80)
              .slice(0, 120)
              .map((e) => ({ tag: e.tagName, id: e.id, cls: String(e.className || '').slice(0, 80), role: e.getAttribute('role') || '', text: lab(e), path: cssPath(e), disabled: !!(e.disabled || e.getAttribute('aria-disabled') === 'true'), safe: !!globalThis.kreamStockSafeTarget?.(e),
                options: e.tagName === 'SELECT' ? [...e.options].slice(0, 30).map((o) => ({ text: norm(o.text), disabled: o.disabled })) : undefined }));
            const boxes = [...document.querySelectorAll('div,section,form,table,ul,dl')].filter((e) => visible(e) && e.getBoundingClientRect().top + scrollY < 2600 && /사이즈|SIZE|옵션|수량/.test(e.innerText || '') && (e.innerText || '').length < 1500).sort((x, y) => (x.innerText || '').length - (y.innerText || '').length).slice(0, 4).map((e) => scrub(e.outerHTML).slice(0, 3500));
            out.dom = { elements: els, boxes };
            out.steps.push('구조 수집: 요소 ' + els.length + '개, 영역 ' + boxes.length + '개');
          } else if (st.click) {
            const el = [...document.querySelectorAll(st.click)].filter((e) => visible(e) && (!st.text || lab(e).includes(st.text)))[0];
            if (!el) { out.steps.push('없음: ' + st.click + (st.text ? ' [' + st.text + ']' : '')); continue; }
            press(el); out.steps.push('클릭: ' + st.click + (st.text ? ' [' + st.text + ']' : '') + ' → ' + lab(el).slice(0, 40));
            await wait(st.after || 900);
          } else if (st.select) {
            const sel = [...document.querySelectorAll(st.select)].filter(visible)[0] || document.querySelector(st.select);
            const opt = sel && [...sel.options].find((o) => norm(o.text).includes(st.option));
            if (!sel || !opt) { out.steps.push('선택 없음: ' + st.select + ' [' + st.option + ']'); continue; }
            if (!globalThis.kreamStockSafeTarget?.(sel)) throw new Error('위험 선택 차단');
            sel.value = opt.value; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true }));
            out.steps.push('선택: ' + st.select + ' → ' + norm(opt.text)); await wait(st.after || 900);
          } else if (st.snap) { await wait(300); snap(st.snap); out.steps.push('장면: ' + st.snap); }
        } catch (e) { out.steps.push('오류: ' + String(e && e.message || e).slice(0, 120)); if (/차단/.test(String(e && e.message))) { out.stopped = '안전 차단'; break; } }
      }
    } finally { window.removeEventListener('message', onMsg); out.dialogs = dialogs; }
    return out;
  })(aiAct.aiSteps) : null;
  const stock = stockConfig && !aiAct ? await stockProbe(stockConfig) : null;
  // 쇼핑몰선택 팝업(저장/취소/쇼핑몰선택 문구를 모두 가진 가장 작은 요소)
  const layerRoot = () => {
    const els = [...document.querySelectorAll('div,section,aside,form')].filter((e) => vis(e) && ['저장', '취소', '쇼핑몰선택'].every((t) => norm(e.textContent).includes(t)));
    els.sort((a, b) => norm(a.textContent).length - norm(b.textContent).length); return els[0] || null;
  };
  const findText = (text, exact, inLayer) => {
    const root = inLayer ? (layerRoot() || document) : document;
    const els = [...root.querySelectorAll('a,button,label,li,span,div,input,[role=button],[role=switch],[role=tab],[role=checkbox]')]
      .filter((e) => vis(e) && (exact ? norm(e.textContent) === text : norm(e.textContent).includes(text)));
    els.sort((a, b) => norm(a.textContent).length - norm(b.textContent).length); return els[0] || null;
  };
  const html = (el, n) => (el ? el.outerHTML.replace(/\s+/g, ' ').slice(0, n || 500) : null);
  // 클릭 이벤트를 여러 방식으로 전달 (React 등 일반 click 만으로 반응하지 않는 요소 대비)
  const fire = (el) => { if (!guardOk(el)) throw new Error('위험 클릭 차단'); for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); };
  const activeTab = () => { const r = layerRoot(); const li = r && r.querySelector('ul li.active'); return li ? norm(li.textContent) : null; };
  const isOn = (sw) => sw.checked === true || sw.getAttribute('aria-checked') === 'true' || sw.getAttribute('aria-pressed') === 'true' || /(^|\s)(on|active|checked|is_on)(\s|$)/i.test(sw.className || '');
  const findSwitch = (el) => { let root = el; for (let i = 0; i < 5 && root; i++) { const sw = root.querySelector('input[type=checkbox],[role=switch],button[aria-pressed],button[aria-checked]'); if (sw) return sw; root = root.parentElement; } return null; };
  const log = [];
  let kreamSort = null;
  // Product probing replaces old blind text-click actions, including queued legacy jobs.
  for (const a of stockConfig ? [] : actions || []) {
    try {
      if (a.kreamSort) { kreamSort = await globalThis.kreamEnsureSort(a.kreamSort); log.push(`KREAM 정렬 ${kreamSort.verified ? '확인' : '실패'}: ${kreamSort.selectedLabel || kreamSort.reason}`); }
      else if (a.wait) { await wait(a.wait); log.push('wait ' + a.wait); }
      else if (a.click) { const el = findText(a.click, a.exact, a.inLayer); if (el) { safeClick(el); log.push('click ok: ' + a.click); await wait(a.after || 1500); } else log.push('click NOT FOUND: ' + a.click); }
      else if (a.switchTab) {
        const el = findText(a.switchTab, true, true); if (!el) { log.push('switchTab NOT FOUND: ' + a.switchTab); continue; }
        const tries = [() => safeClick(el), () => fire(el), () => { const c = el.querySelector('a,button,span'); if (c) { safeClick(c); fire(c); } }, () => { if (el.parentElement) fire(el); }];
        let ok = false;
        for (let i = 0; i < tries.length && !ok; i++) { tries[i](); await wait(900); ok = (activeTab() || '').includes(a.switchTab); log.push('switchTab try' + (i + 1) + ': active=' + activeTab()); }
        log.push('switchTab result: ' + (ok ? 'OK' : 'FAIL') + ' | li.inner: ' + (el.innerHTML || '').replace(/\s+/g, ' ').slice(0, 200));
      }
      else if (a.selectAllLis) {
        const r = layerRoot(); const lis = r ? [...r.querySelectorAll('li[data-shp-area-id="shop"]')].filter((e) => vis(e)) : [];
        const names = [];
        for (const li of lis) { const cls0 = li.className; fire(li); await wait(250); names.push(norm(li.textContent) + '(' + (cls0 === li.className ? 'cls같음' : 'cls변경') + ')'); }
        log.push('selectAllLis: ' + lis.length + '개 → ' + names.join(', '));
      }
      else if (a.debugHtml) { const el = findText(a.debugHtml, a.exact, a.inLayer); log.push('html[' + a.debugHtml + ']: ' + html(el, 400) + ' || parent: ' + html(el && el.parentElement, 500)); }
      else if (a.toggleOff) {
        const el = findText(a.toggleOff); if (!el) { log.push('toggle text NOT FOUND: ' + a.toggleOff); continue; }
        // 문구를 포함한 가장 가까운 조상 중, 글자가 정확히 ON/OFF인 말단 요소를 가진 컨테이너를 찾는다
        let cont = el, onEl = null;
        for (let i = 0; i < 6 && cont; i++) { onEl = [...cont.querySelectorAll('*')].find((e) => e.children.length === 0 && /^(ON|OFF)$/i.test(norm(e.textContent))); if (onEl) break; cont = cont.parentElement; }
        const sw = findSwitch(el);
        log.push('toggle container html: ' + html(cont, 700));
        const state = () => (sw ? (isOn(sw) ? 'ON' : 'OFF') : (onEl ? norm(cont.textContent).includes('OFF') ? 'OFF' : 'ON' : '?'));
        const before = state(); log.push('toggle before: ' + before);
        if (before !== 'OFF') {
          const target = sw || (onEl && (onEl.closest('button,label,[role=switch],[role=button]') || onEl.parentElement));
          if (target) { safeClick(target); await wait(1500); log.push('toggle after: ' + state()); } else log.push('toggle target NOT FOUND');
        }
      }
      else if (a.selectMalls) {
        const done = [], missing = [];
        for (const name of a.selectMalls) {
          const el = findText(name, true, true); if (!el) { missing.push(name); continue; }
          const cb = el.matches('input[type=checkbox]') ? el : (el.querySelector('input[type=checkbox]') || (el.closest('label, li') && el.closest('label, li').querySelector('input[type=checkbox]')));
          const cls0 = el.className;
          if (cb) { if (!cb.checked) safeClick(cb); } else { fire(el); }
          done.push(name + '(' + (cb ? 'checkbox' : (cls0 === el.className ? 'cls같음' : 'cls변경')) + ')'); await wait(400);
        }
        log.push('selectMalls selected: ' + done.join(',') + ' | missing: ' + missing.join(','));
        for (const t of a.apply || ['저장']) { const b = findText(t, true, true); if (b) { safeClick(b); log.push('apply click: ' + t); await wait(2500); break; } }
      }
    } catch (e) { log.push('action error: ' + (e && e.message)); }
  }
  if (!aiAct && !/blocked|captcha|login/.test(stock?.reason || '') && !(actions || []).some((a) => a && a.noScroll)) { for (let i = 0; i < 6; i++) { window.scrollBy(0, window.innerHeight); await wait(500); } window.scrollTo(0, document.body.scrollHeight); await wait(600); }
  const links = [...document.querySelectorAll('a[href]')].map((a) => ({
    t: (a.innerText || a.getAttribute('aria-label') || a.title || '').replace(/\s+/g, ' ').trim().slice(0, 200), h: a.href,
  })).filter((x) => /^https?:/.test(x.h));
  return { url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0, 300000), links: links.slice(0, 1500), ...(kreamSort ? { kreamSort } : {}), ...(stock ? { stockProbe: stock } : {}), ...(aiProbe ? { aiProbe } : {}), actionLog: log, at: new Date().toISOString() };
}

async function executeDump(id, job) {
  const actions = Array.isArray(job.actions) ? job.actions : [];
  const probing = /-prod$/.test(job.id) || actions.some((a) => a.stockProbe);
  const aiSteps = actions.some((a) => a && Array.isArray(a.aiSteps));
  const config = probing ? { token: crypto.randomUUID(), deadline: Date.now() + (aiSteps ? 40000 : 19500) } : null;
  let target = { tabId: id };
  try {
    // Pin all subsequent injections to the same document, not a newly navigated page.
    const injected = await chrome.scripting.executeScript({ target, world: 'ISOLATED', files: ['stock-probe.js', 'kream-sort.js'] });
    if (!injected[0]?.documentId) throw new Error('documentId unavailable');
    target = { tabId: id, documentIds: [injected[0].documentId] };
    if (probing) {
      const hook = await chrome.scripting.executeScript({ target, world: 'MAIN', func: installStockDialogBridge, args: [config.token, config.deadline] });
      if (!hook[0]?.result) throw new Error('MAIN dialog hook unavailable');
    }
    return await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: pageDump, args: [actions, config] });
  } finally {
    if (probing) await chrome.scripting.executeScript({ target, world: 'MAIN', func: (token) => { const b = window.__kreamStockDialogBridgeV1; if (b?.token === token) b.restore(); }, args: [config.token] }).catch(() => {});
  }
}

const prog = (id, step) => fetch(RELAY + '/progress', { method: 'POST', body: JSON.stringify({ id, step }) }).catch(() => {});   // 대시보드용 단계 보고
async function run() {
  if (running) return; running = true;
  try {
    const { enabled = true } = await chrome.storage.local.get('enabled'); if (!enabled) return;
    let n = 0, empty = 0;
    const skippedHosts = new Set();
    while (n < MAX_PER_RUN) {
    const r = await fetch(RELAY + '/jobs'); if (!r.ok) return;
    const { jobs = [], stop, capped } = await r.json();
    if (stop) { if (n) await log(`STOP (총 ${n}건)`); return; }
    if (!jobs.length) { if (capped) { await log('시간당 상한 도달, 다음 알람까지 대기'); return; }     // 상한이면 쉼
      if (empty++ >= 12) { if (n) await log(`묶음 종료 (총 ${n}건)`); return; }                         // 4번(약 45초) 연속 비면 진짜 할 일 없음 → 알람 대기
      await sleep(2500); continue; }                                                                 // 릴레이 최소 간격 때문에 빈 목록이면 10초 뒤 재요청
    empty = 0;
    await log(`작업 ${jobs.length}건 시작 (누적 ${n})`);
    let brk = false;
    for (const job of jobs) {
      if (n >= MAX_PER_RUN) break; if (!/^https?:\/\//.test(job.url)) continue;
      if (/-prod$/.test(job.id) && skippedHosts.has(new URL(job.url).hostname)) {
        await fetch(RELAY + '/dump?id=' + encodeURIComponent(job.id), { method: 'POST', body: JSON.stringify({ url: job.url, text: '', title: '', links: [], job, blocked: true, stockProbe: { reason: 'site-skipped', complete: false, results: [{ size: '*', state: 'unknown', maxQty: null, message: '같은 실행에서 로그인/차단 감지' }] }, at: new Date().toISOString() }) }); n++; continue;
      }
      const id = await ensureTab();
      // 판매처 상세(-prod)는 가려진/백그라운드 창에서는 로딩이 멈춘다(Chrome 창 가림 처리 때문). 이 작업만 창을 앞으로 가져오고, 끝나면 원래 창으로 되돌린다.
      let prevWin = null, jobWin = null;
      // 2026-11-08: 판매처 창을 앞으로 끌어오지 않는 것이 기본(사용자 화면 방해). 창 가림 설정을 끈 크롬이면 뒤에서도 로딩된다.
      // 판매처 페이지가 멈추면 팝업의 '판매처 창 앞으로' 를 켜면 예전처럼 앞으로 가져온다.
      const { bringToFront = false } = await chrome.storage.local.get('bringToFront');
      if (bringToFront && /-prod$/.test(job.id)) { try { prevWin = await chrome.windows.getLastFocused(); jobWin = (await chrome.tabs.get(id)).windowId; if (prevWin && prevWin.id !== jobWin) await chrome.windows.update(jobWin, { focused: true }); else prevWin = null; } catch {} }
      await prog(job.id, '페이지 열기'); await chrome.tabs.update(id, { url: job.url }); await waitComplete(id);
      await waitRedirect(id, job.id);   // 2026-11-07: 네이버 중간 이동 페이지("잠깐! 네이버쇼핑에서 알려드립니다")가 판매처로 넘어갈 때까지 기다림
      // 2026-11-08: 작업에 { capture: true } 가 있으면 첫 화면을 캡처해 덤프에 같이 보낸다(새 사이트에서 AI가 화면을 보고 누를 순서를 만들기 위함).
      // 창을 앞으로 가져오지 않는다. 캡처가 안 되면 실패 사유만 남긴다.
      let shot = null;
      if ((job.actions || []).some((a) => a && a.capture)) { try { await sleep(1500); const tw = (await chrome.tabs.get(id)).windowId; shot = await chrome.tabs.captureVisibleTab(tw, { format: 'jpeg', quality: 60 }); } catch (e) { shot = '캡처 실패: ' + (e && e.message); } }
      await prog(job.id, '로딩 완료·대기'); await sleep(jitter(1000, 2000));
      await prog(job.id, '동작 실행·텍스트 수집');
      let dumpTimer;
      const res = await Promise.race([executeDump(id, job).catch((e) => { log('스크립트 오류: ' + job.id + ' ' + (e && e.message)); return null; }), new Promise((resolve) => { dumpTimer = setTimeout(() => resolve(null), 45000); })]);
      clearTimeout(dumpTimer);
      // Promise.race alone does NOT cancel injected JS. Destroy the task tab on failure.
      if (!res) { try { await chrome.tabs.remove(id); } catch {} tabId = null; }
      if (prevWin) { try { await chrome.windows.update(prevWin.id, { focused: true }); } catch {} }
      const dump = res && res[0] && res[0].result; if (!dump) { await log('덤프 실패: ' + job.id); await fetch(RELAY + '/dump?id=' + encodeURIComponent(job.id), { method: 'POST', body: JSON.stringify({ url: job.url, title: '', text: '', links: [], actionLog: ['수집 실패(멈춤/오류) — 건너뜀'], stockProbe: { complete: false, reason: 'injection-failed-or-timeout', results: [{ size: '*', state: 'unknown', maxQty: null, message: '수집 실패/시간 초과' }] }, failed: true, job, blocked: false, at: new Date().toISOString() }) }).catch(() => {}); continue; }
      const blocked = BLOCK_RE.test(dump.text.slice(0, 3000)) || /blocked|captcha|login/.test(dump.stockProbe?.reason || ''); await prog(job.id, '저장');
      await closeOpenedByJob();
      await fetch(RELAY + '/dump?id=' + encodeURIComponent(job.id), { method: 'POST', body: JSON.stringify({ ...dump, job, blocked, ...(shot ? { screenshot: shot } : {}) }) });
      if (blocked) {
        if (dump.stockProbe) { skippedHosts.add(new URL(dump.url).hostname); await log('로그인/차단 사이트 건너뜀: ' + job.id); }
        else { await log('차단/캡차 화면 감지 → 중단: ' + job.id); await fetch(RELAY + '/stop', { method: 'POST' }); brk = true; break; }
      }
      await log(`완료 ${job.id} (텍스트 ${dump.text.length}자, 링크 ${dump.links.length}개)`); n++;
      await prog(job.id, '완료·다음 대기'); await sleep(jitter(2000, 3500));
    }
    if (brk) break;
    await sleep(1500);   // 릴레이의 최소 간격(10초)은 서버가 지킴: 간격 전에 물으면 빈 목록이 오므로 잠깐 쉬고 재요청
    }
  } catch (e) { await log('오류: ' + e.message); }
  finally { running = false; await closeOpenedByJob(); await prog('', '대기(다음 묶음)'); if (tabId !== null) { try { await chrome.tabs.remove(tabId); } catch {} tabId = null; } }
}

chrome.alarms.create('poll', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'poll') run(); });
chrome.runtime.onInstalled.addListener(() => { log('설치됨'); run(); });
chrome.runtime.onStartup.addListener(() => run());
chrome.runtime.onMessage.addListener((m, sender) => {
  if (m === 'run') { run(); return; }
  const post = (events) => fetch(RELAY + '/record', { method: 'POST', body: JSON.stringify(events) }).catch(() => {});
  if (m && m.rec) { if (sender.tab && sender.tab.id === tabId) return; post(m.rec.map((e) => ({ ...e, tab: sender.tab && sender.tab.id }))); }   // 탐색 기록기: 수집 작업용 창(tabId)은 기록하지 않음
  else if (m && m.memo) post([{ t: new Date().toISOString(), type: 'memo', text: String(m.memo).slice(0, 500) }]);
});
