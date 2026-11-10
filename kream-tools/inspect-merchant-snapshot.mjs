import fs from 'node:fs';
const html = fs.readFileSync(process.argv[2], 'utf8');
const records = [];
for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
  try { const v = JSON.parse(m[1]); if (v[0] === 1 && typeof v[1] === 'string') records.push(v[1]); } catch {}
}
const objects = [];
for (const record of records) for (const line of record.split('\n')) {
  const colon = line.indexOf(':'); if (colon < 0) continue;
  try { objects.push(JSON.parse(line.slice(colon + 1))); } catch {}
}
const found = [];
function walk(value, trail = '') {
  if (!value || typeof value !== 'object') return;
  if (value.product && typeof value.product === 'object' && value.product.id) {
    found.push({ trail, keys: Object.keys(value), product: value.product, details: Object.fromEntries(Object.entries(value).filter(([k]) => /option|deliver|stock|seller|price|policy/i.test(k))) });
    return;
  }
  for (const [k, v] of Object.entries(value)) walk(v, `${trail}/${k}`);
}
for (const o of objects) walk(o);
const out = process.argv[2].replace(/\.html$/, '.parsed.json');
fs.writeFileSync(out, JSON.stringify(found, null, 2));
console.log(JSON.stringify(found.map(f => {
  const p = f.product, colors = p.options?.find(o => !o.is_leaf)?.values || [];
  return { id:p.id, name:p.name, code:p.code, price:p.last_price, sale_state:p.sale_state,
    options:p.options?.filter(o => o.is_leaf).flatMap(o => o.values.filter(v => v.is_orderable && v.stock > 0).map(v => ({
      color:colors.find(c => v.parent_ids?.includes(c.id))?.value, size:v.value, stock:v.stock, price:v.last_price, id:v.id }))) };
}), null, 2));
