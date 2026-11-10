// Executed only by an explicit collector action. Never infers selection from URL parameters.
globalThis.kreamEnsureSort = async function (requested = '인기순', timeoutMs = 5000) {
  const result = { requested, selectedLabel: null, verified: false, verifiedAt: null, url: location.href, reason: '' };
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const label = (e) => norm(e?.innerText || e?.textContent);
  const visible = (e) => e && e.isConnected && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden],[aria-hidden="true"]');
  const inMenu = (e) => e.closest('li,[role="option"],[role="menuitem"],[role="listbox"],[role="menu"]');
  const safe = (e) => !e.matches('input[type=submit],button[type=submit]') && !(e.matches('button') && e.form && e.type !== 'button') && !(e.matches('a[href]') && !/^(?:#|javascript:\s*void\(0\);?)$/.test(e.getAttribute('href') || ''));
  const all = (s) => [...document.querySelectorAll(s)].filter(visible);
  const unique = (xs) => xs.filter((e, i) => xs.indexOf(e) === i).filter((e, _, a) => !a.some((p) => p !== e && p.contains(e)));
  const triggers = () => unique(all('button,[role="combobox"],[aria-haspopup],[class*="sort"],a,span').filter((e) => ['추천순','인기순','최신순','낮은 가격순','높은 가격순'].includes(label(e)) && !inMenu(e)).map((e) => e.closest('button,[role="combobox"],[aria-haspopup]') || e).filter(safe));
  const selected = () => {
    const selects = all('select').filter((s) => [...s.options].some((o) => norm(o.text) === requested));
    if (selects.length === 1) return norm(selects[0].selectedOptions[0]?.text);
    const t = triggers(); return t.length === 1 && t[0].getAttribute('aria-expanded') !== 'true' ? label(t[0]) : null;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms)), deadline = Date.now() + timeoutMs;
  const blocked = () => /보안\s*문자|자동입력\s*방지|captcha|접속이.*제한/i.test(String(document.body?.innerText || '').slice(0, 3000));
  const done = () => { result.selectedLabel = selected(); result.verified = result.selectedLabel === requested; result.verifiedAt = result.verified ? new Date().toISOString() : null; result.url = location.href; return result; };
  if (!/(^|\.)kream\.co\.kr$/.test(location.hostname) || requested !== '인기순') { result.reason = 'unsupported-source-or-sort'; return result; }
  if (blocked()) { result.reason = 'blocked'; return result; }
  if (selected() === requested) return done();
  const selects = all('select').filter((s) => [...s.options].some((o) => norm(o.text) === requested));
  if (selects.length === 1) {
    const select = selects[0], option = [...select.options].find((o) => norm(o.text) === requested);
    if (option.disabled) { result.reason = 'disabled-sort-option'; return result; }
    select.value = option.value; select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    const current = triggers(); if (current.length !== 1) { result.reason = 'sort-trigger-unavailable-or-ambiguous'; return result; }
    current[0].click(); await wait(150);
    const options = unique(all('button,a,li,[role="option"],[role="menuitem"],span').filter((e) => label(e) === requested && inMenu(e)).map((e) => e.closest('li,[role="option"],[role="menuitem"]') || e).filter(safe));
    if (options.length !== 1) { result.reason = 'popular-option-unavailable-or-ambiguous'; return result; }
    options[0].click();
  }
  while (Date.now() < deadline) { if (blocked()) { result.reason = 'blocked'; return result; } if (selected() === requested) { await wait(300); return done(); } await wait(100); }
  result.reason = 'selection-not-confirmed'; return done();
};
