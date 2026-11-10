// 탐색 기록기: 팝업에서 "탐색 기록"을 켠 동안만 동작한다. 사용자가 보는 곳(마우스 위치 아래의 카드)·클릭·스크롤·선택한 글자·페이지 글자를 이 컴퓨터의 릴레이(/record)로만 보낸다.
// 기록하지 않는 것: 키 입력, 입력칸의 값(비밀번호 포함), 로그인·결제·주문 주소의 본문. 외부 전송 없음.
(() => {
  if (window.top !== window || location.host === '127.0.0.1:8787') return;
  let on = false; const SENSITIVE = /login|signin|sign-in|auth|nid\.naver|accounts\.|pay|order|checkout|cart|password|member|join|account/i;
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const buf = []; const emit = (o) => { if (on) buf.push({ t: new Date().toISOString(), ...o }); };
  const flush = () => { if (!buf.length) return; const batch = buf.splice(0); try { chrome.runtime.sendMessage({ rec: batch }); } catch {} };
  const isField = (el) => el && el.matches && el.matches('input,textarea,select,[contenteditable="true"]');
  const cardOf = (el) => { let e = el; for (let i = 0; i < 8 && e && e !== document.body; i++, e = e.parentElement) { const t = norm(e.innerText); if (t.length >= 25 && t.length <= 700) return e; } return el; };
  const describe = (el) => { if (!el || isField(el)) return { label: '(입력칸)' }; const a = el.closest && el.closest('a[href]'); return { label: norm(el.innerText).slice(0, 60), card: norm(cardOf(el).innerText).slice(0, 220), href: a ? a.href.slice(0, 220) : undefined }; };
  const textAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && !isField(el) ? norm(cardOf(el).innerText).slice(0, 160) : ''; };
  let lastSig = '';
  const sig = () => (document.body ? document.body.innerText.length + '|' + norm(document.body.innerText).slice(0, 200) : '');
  const snap = (why) => {
    if (!on || !document.body) return; lastSig = sig();
    if (SENSITIVE.test(location.href)) { emit({ type: 'page', why, url: location.href, title: document.title, note: '민감 주소라 본문 미기록' }); return; }
    emit({ type: 'page', why, url: location.href, title: document.title, viewport: [innerWidth, innerHeight], text: document.body.innerText.slice(0, 40000) });
  };
  // 마우스: 300ms마다 위치를 보고, 같은 카드 위에 600ms 이상 머문 기록을 남긴다(어디를 보는지의 대용 지표)
  let mx = 0, my = 0, moved = false, cur = null, since = Date.now();
  addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; moved = true; }, { passive: true });
  const closeHover = () => { if (cur) { const ms = Date.now() - since; if (ms >= 600) emit({ type: 'hover', ms, x: cur.x, y: cur.y, scrollY: Math.round(scrollY), ...cur.d }); cur = null; } };
  // 0.1초(100ms)마다 마우스 위치를 기록한다. 멈춰 있어도 기록해서 머문 시간이 그대로 남는다. 카드 글자는 처음 볼 때 한 번만 'card' 로 적고, 이후 샘플은 카드 번호(c)만 쓴다.
  let seen = false, lastEl = null, lastKey = '', lastCid = 0, nextCid = 1; const cards = new Map();
  addEventListener('mousemove', () => { seen = true; }, { passive: true });
  setInterval(() => {
    if (!on || !seen) return; moved = false;
    const el = document.elementFromPoint(mx, my);
    if (el !== lastEl) {   // 요소가 바뀐 때만 글자를 계산(매 샘플마다 계산하면 느려짐)
      lastEl = el; const d = describe(el); lastKey = d.card || d.label || ''; const prev = cur;
      if (prev && prev.key !== lastKey) closeHover();
      if (!cards.has(lastKey)) { cards.set(lastKey, nextCid++); emit({ type: 'card', id: cards.get(lastKey), card: d.card, label: d.label, href: d.href }); }
      lastCid = cards.get(lastKey); if (!cur) { cur = { key: lastKey, d, x: mx, y: my }; since = Date.now(); }
    }
    if (cur) { cur.x = mx; cur.y = my; }
    emit({ type: 'm', x: mx, y: my, sy: Math.round(scrollY), c: lastCid });
  }, 100);
  addEventListener('click', (e) => { if (!on) return; closeHover(); emit({ type: 'click', x: e.clientX, y: e.clientY, scrollY: Math.round(scrollY), ...describe(e.target) }); setTimeout(() => { if (on && sig() !== lastSig) snap('클릭 후 화면 변화'); }, 1300); }, true);
  let st = null; addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(() => emit({ type: 'scroll', y: Math.round(scrollY), vh: innerHeight, top: textAt(innerWidth / 2, 120), mid: textAt(innerWidth / 2, innerHeight / 2), bottom: textAt(innerWidth / 2, innerHeight - 120) }), 700); }, { passive: true });
  addEventListener('mouseup', (e) => { if (!on || isField(e.target)) return; const s = String(getSelection() || '').trim(); if (s) emit({ type: 'select', text: s.slice(0, 200) }); });
  addEventListener('pagehide', () => { closeHover(); flush(); });
  let lastUrl = location.href; setInterval(() => { if (on && location.href !== lastUrl) { lastUrl = location.href; setTimeout(() => snap('주소 변경'), 1500); } }, 1000);
  setInterval(flush, 2000);
  const set = (v) => { const was = on; on = !!v; if (on && !was) setTimeout(() => snap('기록 시작'), 800); if (!on && was) { closeHover(); flush(); } };
  try { chrome.storage.local.get('recording').then((r) => set(r.recording)); chrome.storage.onChanged.addListener((c) => { if (c.recording) set(c.recording.newValue); }); } catch {}
})();
