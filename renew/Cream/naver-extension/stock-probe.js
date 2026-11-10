// MV3 ISOLATED world. No libraries, eval, network requests or bot bypasses.
(() => {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const attr = (e, k) => e?.getAttribute?.(k) || '';
  const visible = (e) => !!e?.isConnected && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden],[aria-hidden="true"], [inert]');
  const label = (e) => norm(e?.innerText || e?.textContent || attr(e, 'aria-label') || attr(e, 'title') || e?.value);
  const metadata = (e) => ['class', 'id', 'name', 'aria-label', 'title', 'data-action', 'onclick', 'href', 'formaction'].map((k) => attr(e, k)).join(' ');
  const forbidden = /장\s*바\s*구\s*니|(?:즉시|바로)\s*구매|구매\s*(?:하기|신청)|결제|주문|담기|쇼핑백|구입|buy|purchase|checkout|cart|basket|payment|order|pay[_-]?now/i;
  // Inspect the target, descendants and every ancestor BEFORE dispatching events.
  // Container classes such as buy_area intentionally fail closed.
  function safeTarget(el) {
    if (!el?.isConnected || label(el) === '구매' || forbidden.test(label(el)) || forbidden.test(metadata(el))) return false;
    if ([...el.querySelectorAll('*')].some((x) => forbidden.test(metadata(x)))) return false;
    for (let p = el; p; p = p.parentElement) {
      if (forbidden.test(metadata(p))) return false;
      if (p.matches('button,input,a,[role="button"]') && (label(p) === '구매' || forbidden.test(label(p)))) return false;
      if (p.matches('button') && p.form && p.type !== 'button') return false;
      if (p.matches('input[type="submit"],input[type="image"],input[type="reset"]')) return false;
      if (p.matches('a[href]') && !/^(?:#?|javascript:\s*void\(0\);?)$/i.test(attr(p, 'href'))) return false;
    }
    return true;
  }
  const soldRE = /품절|매진|재입고\s*알림|일시\s*품절|sold\s*out|out[ -]of[ -]stock/i;
  const unavailable = (e) => {
    const reasons = [];
    if (e.matches(':disabled') || e.closest('[disabled]')) reasons.push('disabled');
    if (e.closest('[aria-disabled="true"]')) reasons.push('aria-disabled');
    if (e.closest('[hidden],[aria-hidden="true"],[inert]')) reasons.push('hidden');
    if (e.tagName !== 'SELECT' && soldRE.test(label(e))) reasons.push('soldout-text');
    if (/(?:^|[\s_-])(?:sold[_-]?out|out[_-]?of[_-]?stock|disabled|unavailable|is-disabled)(?:$|[\s_-])/i.test(attr(e, 'class'))) reasons.push('disabled-class');
    return reasons;
  };
  const sizeOf = (text) => norm(text).replace(/\([^)]*(?:품절|매진|남음|원)[^)]*\)|\[[^\]]*(?:품절|매진)[^\]]*\]/g, '').replace(/품절|매진|재입고\s*알림|sold\s*out/ig, '').trim();
  const isSize = (s) => /^(?:(?:KR|EU|US|UK)\s*)?(?:\d{2,3}(?:\.5)?|[2-6]?X{0,3}[SML]|FREE|ONE\s*SIZE|OS|프리)(?:\s*\([^)]{1,20}\))?$/i.test(sizeOf(s));
  const sizeContext = (e) => /사이즈|size|옵션|option/i.test(metadata(e) + ' ' + [...(e.labels || [])].map(label).join(' '));
  const all = (selector, root = document) => { try { return [...root.querySelectorAll(selector)]; } catch { return []; } };
  // These are semantic selector STRATEGIES, not claimed verified seller DOM IDs.
  const adapters = [
    { name: 'rexmonde', host: /(^|\.)rexmonde\.com$/, roots: '[class*="size" i],[class*="option" i],[data-option-group]', open: /사이즈|size|옵션|선택하세요/i },
    { name: 'ssg', host: /(^|\.)ssg\.com$/, roots: '[class*="opt" i],[class*="size" i],[role="listbox"]', open: /선택하세요|사이즈|size|옵션\s*선택/i },
    { name: 'lotteon', host: /(^|\.)lotteon\.com$/, roots: '[class*="option" i],[class*="size" i],[role="listbox"]', open: /size\s*선택|사이즈|옵션\s*(보기|선택)|선택하세요/i },
    { name: 'mustit', host: /(^|\.)mustit\.co\.kr$/, roots: '[class*="option" i],[class*="size" i],[role="listbox"]', open: /사이즈|size|옵션\s*(보기|선택)|선택하세요/i },
  ];

  async function stockProbe(config = {}) {
    const started = Date.now();
    const deadline = Math.min(Number(config.deadline) || started + 19500, started + 19500);
    const token = config.token;
    const adapter = adapters.find((a) => a.host.test(location.hostname)) || { name: 'generic', roots: '[class*="option" i],[class*="size" i],[data-option-group],[role="listbox"]', open: /사이즈|size|옵션\s*(보기|선택)|선택하세요/i };
    const result = { version: 1, build: 'live-adapters-2', adapter: adapter.name, results: [], complete: false, enumerationComplete: false, reason: '', elapsedMs: 0, messages: [], diagnostics: {} };
    // Confirmed on the two user-supplied product pages. Scope away from size
    // charts, favourites counts and SSG's duplicate sticky purchase bar.
    const site = adapter.name === 'rexmonde' && document.querySelector('#CateOptionName') ? {
      roots: '#ProductOPTList tbody', opener: '#CateOptionName', scope: '#sel_product_container',
      quantities: '#sel_product_container input[type="text"],#sel_product_container input[type="number"]'
    } : adapter.name === 'ssg' && document.querySelector('#_ordOpt_area') ? {
      roots: '#_ordOpt_area ._drop_list', opener: '#_ordOpt_area ._drop_select', scope: '#_ordOpt_area',
      quantities: '#cdtl_opt_bx_uitem input[id^="cdtl_item_amount"]'
    } : null;
    const optionSize = (e) => site && adapter.name === 'rexmonde'
      ? norm(e.cells?.[2]?.textContent).replace(/\s*전후$/, '')
      : sizeOf(label(e).replace(/\([^)]*남은수량[^)]*\)/g, '').trim());
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let stopped = '', ready = false, observer;
    const send = (kind) => window.postMessage({ source: 'kream-stock-isolated', token, kind }, location.origin);
    const message = (kind, text) => {
      const s = norm(text).slice(0, 600);
      if (s && result.messages.length < 150) result.messages.push({ kind, text: s, at: Date.now() });
    };
    const receive = (e) => {
      if (e.source !== window || e.origin !== location.origin || e.data?.source !== 'kream-stock-main' || e.data.token !== token) return;
      if (e.data.kind === 'ready') ready = true;
      else if (e.data.kind === 'broken') stopped = 'dialog-hook-lost';
      else if (['alert', 'confirm', 'prompt'].includes(e.data.kind) && typeof e.data.message === 'string') message(e.data.kind, e.data.message);
    };
    const blockReason = () => {
      const t = norm(document.body?.innerText).slice(0, 12000);
      if (/접속이\s*(?:일시적으로\s*)?제한|비정상적인\s*접근|자동입력\s*방지|보안\s*문자|로봇이\s*아닙|access denied|verify you are human|not allowed due to safety|captcha/i.test(t)) return 'blocked-or-captcha';
      if (all('iframe[src*="captcha"],iframe[src*="challenge"],input[autocomplete="current-password"],input[type="password"]').some(visible)) return 'login-or-captcha';
      if (/(?:로그인|본인\s*인증)(?:이|을|이\s*먼저)?\s*(?:필요|해주세요|해\s*주세요|후|하셔야)|sign in to continue/i.test(t) || /\/(?:login|signin)(?:[/?#]|$)/i.test(location.href)) return 'login-required';
      return '';
    };
    const check = (reserve = 0) => {
      if (!stopped) stopped = blockReason();
      if (!stopped && Date.now() + reserve >= deadline) stopped = 'time-budget';
      if (stopped) throw new Error(stopped);
    };
    const guardEvent = (e) => {
      if (e.type === 'submit' || !safeTarget(e.target?.closest?.('button,a,input,li,[role="button"],[role="option"]') || e.target)) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    // Every interaction goes through this gate. 600ms settling after each click/change.
    const act = async (el, fn) => {
      check(850);
      if (!visible(el) || !safeTarget(el) || unavailable(el).length) throw new Error('unsafe-or-disabled-target');
      ready = false; send('ping');
      for (let i = 0; !ready && i < 10; i++) await delay(10);
      if (!ready) throw new Error('dialog-bridge-unavailable');
      check(650);
      fn ? fn() : el.click();
      await delay(600);
      check();
    };
    const shortNotice = (el) => {
      if (el?.nodeType !== 1 || el === document.body || el === document.documentElement || !visible(el) || el.closest('select,[role="listbox"],[role="option"]')) return;
      const region = el.closest('[role="alert"],[role="status"],[aria-live],[role="dialog"],[class*="toast" i],[class*="alert" i],[class*="message" i],[class*="notice" i]');
      const t = label(region || el);
      if (!region && !/재고.*(?:부족|없|초과)|최대.*(?:구매|수량|개)|수량.*(?:초과|제한)|품절(?:입니다|되었습니다)|로그인.*(?:필요|주세요)/i.test(t)) return;
      if (t.length <= 400 && /재고|품절|최대|구매\s*수량|구매\s*제한|수량.*(?:초과|제한)|stock|limit|로그인|captcha/i.test(t)) message('dom', t);
    };
    const optionNodes = (root) => {
      if (site && adapter.name === 'rexmonde') return all('tr[name="selectOption"]', root).filter(visible);
      if (site && adapter.name === 'ssg') return all('li', root).filter((e) => visible(e) && isSize(optionSize(e)));
      const nodes = all('[role="option"],li,button,[data-option-value],div,span', root).filter((e) => visible(e) && isSize(label(e)));
      // Prefer the semantic/clickable wrapper over its decorative span.
      return nodes.filter((e) => !nodes.some((p) => p !== e && p.contains(e)));
    };
    const selectNodes = () => site ? [] : all('select').filter((e) => visible(e) && (sizeContext(e) || [...e.options].some((o) => isSize(label(o)))) && !/수량|qty|quantity/i.test(metadata(e)));
    const customGroups = () => {
      if (site) return all(site.roots).filter(visible).filter((e) => optionNodes(e).length);
      const linked = all('[aria-controls]').map((e) => document.getElementById(attr(e, 'aria-controls'))).filter(Boolean);
      const roots = [...new Set([...all(adapter.roots + ',[role="listbox"]'), ...linked])].filter(visible).filter((e) => optionNodes(e).length > 0);
      return roots.filter((e) => !roots.some((x) => x !== e && e.contains(x)));
    };
    const openers = () => site ? all(site.opener).filter((e) => visible(e) && safeTarget(e)) : all('button,[role="combobox"],[role="button"],a,div,span').filter((e) => visible(e) && label(e).length < 70 && adapter.open.test(label(e)) && !/구매\s*가능\s*사이즈/.test(label(e)) && safeTarget(e))
      .filter((e, _, arr) => !arr.some((c) => c !== e && e.contains(c)));
    const selected = (e) => e?.matches('[aria-selected="true"],[aria-checked="true"],[aria-pressed="true"],:checked') || /(?:^|\s)(?:selected|active|on|is-selected)(?:\s|$)/i.test(attr(e, 'class'));
    const qtySelector = site?.quantities || 'input[type="number"],input[name*="qty" i],input[name*="quantity" i],input[id*="quantity" i],[role="spinbutton"],[data-stock-quantity],[class*="quantity_value"],[class*="qty_value"]';
    const number = (el) => { const s = norm(el?.value ?? (attr(el, 'aria-valuenow') || label(el))); return /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null; };
    const hasSize = (root, size) => {
      const item = result.results.find((r) => r.size === size);
      return all('span,div,dt,dd,strong,em,li,td,[data-size]', root).some((e) => {
        if (!visible(e) || e.closest('#ProductOPTList,#_ordOpt_area')) return false;
        const t = label(e);
        return sizeOf(t) === size || attr(e, 'data-size') === size || (site?.scope === '#_ordOpt_area' && t.includes('사이즈 : ' + size)) ||
          (item?.tagSize && t.length < 100 && t.includes(item.color) && t.split(/[^A-Za-z0-9]+/).includes(item.tagSize));
      });
    };
    const plus = (root) => all('button,a,[role="button"],input[type="button"]', root).filter(visible).filter((e) => /^(?:\+|＋|수량\s*(?:증가|추가)|증가|더하기|plus|increase(?: quantity)?)$/i.test(label(e)) || /(?:qty|quantity|count)[_-]?(?:plus|up|increase)|(?:plus|increase)[_-]?(?:qty|quantity)|(?:^|\s)(?:btn_plus|btn-plus|cdtl_b_plus)(?:$|\s)/i.test(metadata(e)));
    const quantity = (size, selectionVerified) => {
      const inputs = all(qtySelector).filter(visible).filter((e) => number(e) !== null);
      const candidates = [];
      for (const input of inputs) {
        let group = input.parentElement;
        for (let depth = 0; group && group !== document.body && depth < 5; depth++, group = group.parentElement) {
          const inc = plus(group);
          if (inc.length !== 1 || all(qtySelector, group).filter(visible).length !== 1) continue;
          // Multi-row widgets require exact row/size association, never the first + on the page.
          let row = group, associated = false;
          for (let n = 0; row && row !== document.body && n < 4; n++, row = row.parentElement) {
            if (all(qtySelector, row).filter(visible).length > 1) break;
            if (hasSize(row, size)) { associated = true; break; }
          }
          if (associated || (selectionVerified && inputs.length === 1)) candidates.push({ input, plus: inc[0], value: number(input), associated });
          break;
        }
      }
      return candidates.length === 1 ? candidates[0] : null;
    };
    const summarize = (from) => result.messages.slice(from).map((m) => m.text).filter((s, i, a) => a.indexOf(s) === i).join(' | ').slice(0, 900);
    let group, groupIndex = 0, native = false;
    const getRoot = () => native ? selectNodes()[groupIndex] : customGroups()[groupIndex];
    const getOptions = () => { const r = getRoot(); return r ? native ? [...r.options] : optionNodes(r) : []; };
    const keyOf = (e) => native ? e.value : attr(e, 'sinfo') || attr(e, 'data-option-value') || attr(e, 'data-value') || optionSize(e);
    const resolve = (item) => getOptions().find((e) => keyOf(e) === item.optionKey && optionSize(e) === item.size);
    try {
      window.addEventListener('message', receive);
      window.addEventListener('click', guardEvent, true);
      window.addEventListener('submit', guardEvent, true);
      check();
      if (!token) throw new Error('dialog-bridge-unavailable');
      observer = new MutationObserver((records) => {
        for (const rec of records.slice(0, 80)) {
          const parent = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement;
          shortNotice(parent);
          for (const node of [...rec.addedNodes].slice(0, 20)) {
            shortNotice(node);
            if (node.nodeType === 1) all('[role="alert"],[role="status"],[aria-live],[role="dialog"],[class*="toast" i]', node).slice(0, 20).forEach(shortNotice);
          }
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'style', 'aria-hidden'] });
      let selects = selectNodes(), groups = customGroups();
      if (!selects.length && !groups.length) {
        const buttons = openers();
        if (buttons.length !== 1) throw new Error(buttons.length ? 'ambiguous-option-openers' : 'no-option-control');
        await act(buttons[0]);
        selects = selectNodes(); groups = customGroups();
      }
      native = selects.length > 0;
      const pool = native ? selects : groups;
      if (pool.length !== 1) throw new Error(pool.length ? 'multiple-option-groups' : 'no-option-list');
      group = pool[0];
      // Do not silently choose an arbitrary color/add-on before a size.
      const otherSelects = all(site ? site.scope + ' select' : 'select').filter((e) => visible(e) && e !== group && !/qty|quantity|수량/i.test(metadata(e)) && [...e.options].some((o) => o.value && !o.disabled));
      if (otherSelects.length) throw new Error('dependent-options-need-adapter');
      const options = getOptions().filter((e) => isSize(optionSize(e)));
      if (!options.length) throw new Error('no-size-options');
      // Unknown non-placeholder labels may represent sizes this parser missed.
      // Custom/virtualized lists may hide unrendered sizes, even when visible rows end.
      result.enumerationComplete = native && [...group.options].every((e) => isSize(label(e)) || /선택|choose|select|^-+$/i.test(label(e)));
      if (options.length > 150) throw new Error('too-many-options');
      const keys = options.map((e) => keyOf(e));
      if (new Set(keys).size !== keys.length) throw new Error('ambiguous-option-keys');
      result.results = options.map((e) => {
        const disabledReasons = unavailable(e), explicitSold = soldRE.test(label(e)) || /sold.?out|out[_-]?of[_-]?stock/i.test(attr(e, 'class'));
        return { size: optionSize(e), ...(site && adapter.name === 'rexmonde' ? { tagSize: norm(e.cells?.[1]?.textContent), color: norm(e.cells?.[0]?.textContent) } : {}), optionKey: keyOf(e), state: explicitSold ? 'soldout' : 'unknown', maxQty: null, message: disabledReasons.length ? disabledReasons.join(', ') : '미탐색', disabledReasons, tested: false, plusClicks: 0, quantityHistory: [], evidence: explicitSold ? 'option-soldout' : 'unverified', reason: disabledReasons.length ? 'option-disabled' : 'not-tested' };
      });
      // Enumerate every visible option first so deadline leaves explicit unknown rows.
      for (const item of result.results) {
        check();
        if (item.disabledReasons.length) continue;
        const from = result.messages.length;
        try {
          let el = resolve(item);
          if (!el && !native) {
            const buttons = openers();
            if (buttons.length !== 1) throw new Error('cannot-reopen-options');
            await act(buttons[0]); el = resolve(item);
          }
          if (!el) throw new Error('option-disappeared');
          const reasons = unavailable(el);
          if (reasons.length) { item.disabledReasons = reasons; throw new Error('option-became-disabled'); }
          if (native) {
            const select = getRoot(), value = el.value;
            await act(select, () => {
              Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
              select.dispatchEvent(new Event('input', { bubbles: true }));
              select.dispatchEvent(new Event('change', { bubbles: true }));
            });
          } else await act(el);
          item.tested = true;
          const current = resolve(item);
          const verified = native ? getRoot()?.value === item.optionKey : selected(current);
          let q = quantity(item.size, verified);
          const selectionMessage = summarize(from);
          if (soldRE.test(selectionMessage)) { item.state = 'soldout'; item.evidence = 'selection-message'; item.reason = 'soldout-message'; continue; }
          if (!verified && !q?.associated) throw new Error('selection-not-confirmed');
          item.state = 'available'; item.evidence = 'selection-ui'; item.reason = 'quantity-unavailable';
          // Capture evidence from a selected row, never a page-wide or multi-quantity total.
          if (q?.value === 1 && /(^|\.)(?:ssg\.com|mustit\.co\.kr|trenbe\.com)$/.test(location.hostname)) {
            let row = q.input.parentElement;
            for (let depth = 0; row && row !== document.body && depth < 6; depth++, row = row.parentElement) {
              if (all(qtySelector, row).filter(visible).length > 1) break;
              const snippet = norm(row.innerText);
              if (hasSize(row, item.size) && snippet.length <= 500 && /판매가|단가|가격|금액/.test(snippet) && /[\d,]+\s*원/.test(snippet)) {
                item.offerText = snippet; item.offerQuantity = 1; break;
              }
            }
          }
          if (!q) continue;
          item.maxQty = q.value; item.quantityHistory.push(q.value);
          for (let click = 0; click < 5; click++) {
            check();
            // Re-query after every React/Vue render.
            q = quantity(item.size, native ? getRoot()?.value === item.optionKey : selected(resolve(item)));
            if (!q) { item.reason = 'quantity-binding-lost'; break; }
            if (unavailable(q.plus).length) { item.state = 'limit'; item.reason = 'plus-disabled'; break; }
            const before = q.value, mark = result.messages.length;
            await act(q.plus, () => { q.plus.click(); item.plusClicks++; });
            const after = quantity(item.size, native ? getRoot()?.value === item.optionKey : selected(resolve(item)));
            if (!after) { item.reason = 'quantity-binding-lost'; break; }
            item.quantityHistory.push(after.value); item.maxQty = Math.max(item.maxQty, after.value);
            const notice = summarize(mark);
            if (/재고.*(?:부족|초과|없)|최대.*(?:수량|구매|개)|구매.*제한|수량.*(?:초과|제한)|stock.*(?:insufficient|limit)|purchase limit/i.test(notice) || soldRE.test(notice)) { item.state = 'limit'; item.reason = 'limit-message'; break; }
            if (after.value <= before) { item.reason = 'quantity-unchanged'; break; }
            item.reason = 'click-cap';
          }
        } catch (e) {
          item.reason = String(e.message).slice(0, 160);
          if (stopped) { item.message = summarize(from) || item.reason; throw e; }
        } finally { item.message = summarize(from) || item.reason; }
      }
      result.complete = result.results.every((r) => r.state !== 'unknown' && !['quantity-binding-lost', 'quantity-unavailable', 'quantity-unchanged'].includes(r.reason));
      result.reason = result.complete ? 'finished' : 'partial';
    } catch (e) { result.reason = stopped || String(e.message).slice(0, 160); }
    finally {
      observer?.disconnect();
      window.removeEventListener('message', receive);
      window.removeEventListener('click', guardEvent, true);
      window.removeEventListener('submit', guardEvent, true);
      send('stop');
      if (/blocked|captcha|login|dialog/.test(result.reason)) for (const r of result.results) { r.state = 'unknown'; r.reason = result.reason; r.message = result.reason; }
      if (!result.results.length) result.results.push({ size: '*', state: 'unknown', maxQty: null, message: result.reason, reason: result.reason });
      // Read-only evidence for Rexmonde-like text. It does not prove selectable stock.
      result.diagnostics.availableSizeText = (document.body?.innerText || '').match(/구매\s*가능\s*사이즈[^\n]{0,150}/)?.[0] || '';
      result.diagnostics.controls = all('select,[role="combobox"],[role="listbox"]').slice(0, 15).map((e) => ({ tag: e.tagName, id: e.id, class: attr(e, 'class'), role: attr(e, 'role'), text: label(e).slice(0, 180) }));
      const describe = (e) => ({ tag: e.tagName, id: e.id, class: attr(e, 'class'), text: label(e).slice(0, 180), visible: !!visible(e), safe: safeTarget(e), attrs: Object.fromEntries(['role', 'name', 'type', 'onclick', 'onchange', 'aria-label', 'aria-controls'].map((k) => [k, attr(e, k)])) });
      const parents = (e) => { const out = []; for (let p = e.parentElement; p && out.length < 4; p = p.parentElement) out.push({ tag: p.tagName, id: p.id, class: attr(p, 'class') }); return out; };
      result.diagnostics.candidateGroups = customGroups().slice(0, 12).map((e) => ({ ...describe(e), parents: parents(e), options: optionNodes(e).slice(0, 8).map(describe) }));
      result.diagnostics.candidateSelects = selectNodes().slice(0, 8).map((e) => ({ ...describe(e), parents: parents(e), options: [...e.options].slice(0, 12).map((o) => ({ text: label(o), value: o.value, disabled: o.disabled })) }));
      result.diagnostics.openers = openers().slice(0, 8).map((e) => ({ ...describe(e), parents: parents(e) }));
      result.diagnostics.productControls = all('.prd_option,#_ordOpt_area,#cdtl_opt_bx_uitem').flatMap((root) => all('button,a,input:not([type="hidden"]):not([type="password"]),select,img,[onclick]', root).slice(0, 85).map((e) => ({ ...describe(e), parents: parents(e), alt: attr(e, 'alt'), value: /^\\d+$/.test(e.value || '') ? e.value : '', href: attr(e, 'href').slice(0, 180) })));
      result.elapsedMs = Date.now() - started;
    }
    return result;
  }
  globalThis.kreamStockProbe = stockProbe;
  globalThis.kreamStockSafeTarget = safeTarget;
})();
