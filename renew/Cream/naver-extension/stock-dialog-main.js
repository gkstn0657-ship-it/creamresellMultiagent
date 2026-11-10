// Serialized by executeScript: keep this function independent of worker globals.
function installStockDialogBridge(token, deadline) {
  const key = '__kreamStockDialogBridgeV1';
  window[key]?.restore();
  if (!Number.isFinite(deadline) || deadline <= Date.now()) return false;
  const saved = Object.fromEntries(['alert', 'confirm', 'prompt'].map((k) => [k, Object.getOwnPropertyDescriptor(window, k)]));
  const hooks = {};
  const send = (kind, message = '') => window.postMessage({ source: 'kream-stock-main', token, kind, message: String(message).slice(0, 600) }, location.origin);
  let timer;
  const restore = () => {
    clearTimeout(timer);
    window.removeEventListener('message', receive);
    for (const k of Object.keys(hooks)) if (window[k] === hooks[k]) {
      if (saved[k]) Object.defineProperty(window, k, saved[k]); else delete window[k];
    }
    if (window[key]?.token === token) delete window[key];
  };
  const receive = (e) => {
    if (e.source !== window || e.origin !== location.origin || e.data?.source !== 'kream-stock-isolated' || e.data.token !== token) return;
    if (e.data.kind === 'stop') restore();
    if (e.data.kind === 'ping') send(Object.keys(hooks).every((k) => window[k] === hooks[k]) ? 'ready' : 'broken');
  };
  try {
    for (const k of ['alert', 'confirm', 'prompt']) {
      // A confirm must NEVER approve an operation. A prompt is cancelled too.
      hooks[k] = (message) => { send(k, message); return k === 'confirm' ? false : k === 'prompt' ? null : undefined; };
      Object.defineProperty(window, k, { configurable: true, writable: true, value: hooks[k] });
    }
    window[key] = { token, restore };
    window.addEventListener('message', receive);
    timer = setTimeout(restore, Math.max(0, deadline - Date.now()));
    return true;
  } catch { restore(); return false; }
}
