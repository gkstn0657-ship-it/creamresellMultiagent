const R = 'http://127.0.0.1:8787';
const $ = (id) => document.getElementById(id);
async function refresh() {
  const { logs = [], enabled = true, recording = false, bringToFront = false } = await chrome.storage.local.get(['logs', 'enabled', 'recording', 'bringToFront']);
  $('en').checked = enabled; $('rec').checked = recording; $('front').checked = bringToFront; $('log').textContent = logs.slice(-15).join('\n') || '(로그 없음)';
}
$('en').onchange = async () => { await chrome.storage.local.set({ enabled: $('en').checked }); };
$('front').onchange = async () => { await chrome.storage.local.set({ bringToFront: $('front').checked }); };
$('rec').onchange = async () => { await chrome.storage.local.set({ recording: $('rec').checked }); };
$('memoBtn').onclick = () => { const v = $('memo').value.trim(); if (v) { chrome.runtime.sendMessage({ memo: v }); $('memo').value = ''; } };
$('go').onclick = () => { chrome.runtime.sendMessage('run'); setTimeout(refresh, 800); };
$('stop').onclick = async () => { await fetch(R + '/stop', { method: 'POST' }); refresh(); };
$('resume').onclick = async () => { await fetch(R + '/resume', { method: 'POST' }); refresh(); };
refresh(); setInterval(refresh, 2000);
