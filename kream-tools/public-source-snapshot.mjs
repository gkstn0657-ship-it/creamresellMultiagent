import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const dir = path.resolve('kream-runs/sourcing-five-20261108/public-sources');
fs.mkdirSync(dir, { recursive: true });
const urls = process.argv.slice(2);
for (const raw of urls) {
  const url = new URL(raw);
  // Public non-authenticated merchant pages only. Do not use for blocked Naver
  // domains or the user's browser, cookies, account or checkout.
  if (!['www.7942camp.com', 'thegearshop.co.kr'].includes(url.hostname) || url.protocol !== 'https:') throw new Error('허용한 공개 판매처 상품 페이지만 수집');
  const at = new Date().toISOString(), id = createHash('sha256').update(url.href).digest('hex').slice(0, 16);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) { console.log(JSON.stringify({ url: raw, status: res.status, stopped: true })); continue; }
    const html = await res.text();
    fs.writeFileSync(path.join(dir, `${id}.html`), html);
    const selects = [...html.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/gi)].map(m => m[0].replace(/\s+/g, ' ').slice(0, 6000));
    const snippets = [...html.matchAll(/.{0,80}(?:optionFl|optionStock|stockCnt|soldOut|goodsData|goodsOption|optionValue|stockQuantity|optionSno|optionName|productOptions|productData|stock_qty).{0,300}/gi)].slice(0, 30).map(m => m[0]);
    const snapshot = { url: raw, at, status: res.status, bytes: html.length, file: `${id}.html`, selects, snippets };
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(snapshot, null, 2));
    console.log(JSON.stringify(snapshot));
  } catch (e) { console.log(JSON.stringify({ url: raw, at, stopped: true, error: e.message })); }
}
