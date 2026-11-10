// Offline diagnostic: copy saved observations, reparse, and compare exploration
// decisions. Never visits websites or approves a purchase candidate.
// node automation/replay-margin-screen.mjs <cycle-dir> <new-output-dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { context, readJson, writeJson } from '../renew/Cream/kream-tools/agents-core.mjs';
import { screenListing, searchOffers, screenInitialMargins, planMarginCatalogs, planMarginPages } from '../renew/Cream/kream-tools/margin-screen.mjs';
import { trustedMall } from '../renew/Cream/kream-tools/agents-offers.mjs';

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) throw new Error('Usage: replay-margin-screen.mjs <cycle-dir> <new-output-dir>');
const source = path.resolve(sourceArg), output = path.resolve(outputArg);
if (!fs.existsSync(path.join(source, 'batches'))) throw new Error('Saved cycle batches not found');
if (fs.existsSync(output)) throw new Error('Output must be a new directory; saved evidence must not be overwritten');
if (output.startsWith(source + path.sep)) throw new Error('Output must be outside the original cycle');
fs.mkdirSync(output, { recursive: true });
const result = { mode: 'historical-replay', source, generatedAt: new Date().toISOString(), promotionAllowed: false,
  approvedCandidates: 0, batches: [], recoveredExistingOffers: [], recoveredReparsedOffers: [], summary: {} };

function recovered(ctx) {
  return ctx.products.flatMap((p) => {
    const dump = readJson(ctx.dir, `dump-K${p.id}.json`);
    if (!dump?.at) return [];
    return searchOffers(ctx.cards[p.id]).flatMap((offer) => {
      const screen = screenListing(p, offer, dump, ctx.policy, dump.at);
      return screen.status === 'potential' && screen.mixedProfit <= 0 && screen.potentialOptions.length ? [{
        pid: String(p.id), model: p.model, price: offer.price, shipping: offer.shipFee, url: offer.link,
        marketObservedAt: dump.at, mixedProfit: screen.mixedProfit, options: screen.potentialOptions,
        sourceCheckoutAndStockConfirmed: false }] : [];
    });
  });
}

for (const name of fs.readdirSync(path.join(source, 'batches')).filter((name) => /^batch-/.test(name)).sort()) {
  const original = path.join(source, 'batches', name), dir = path.join(output, name);
  if (!fs.statSync(original).isDirectory()) continue;
  fs.mkdirSync(dir);
  const before = context(original);
  const times = before.products.map((p) => readJson(original, `dump-K${p.id}.json`)?.at).filter((at) => Number.isFinite(Date.parse(at))).sort();
  if (!times.length) throw new Error(`No original market capture time: ${name}`);
  for (const file of fs.readdirSync(original)) if (/^(?:k50(?:-all|-ids)?|agent-policy|n-cards|n-cat|chart)\.json$/.test(file) || /^dump-(?:K\d+|N\d+-s2?)\.json$/.test(file)) {
    fs.copyFileSync(path.join(original, file), path.join(dir, file));
  }
  const parsed = spawnSync(process.execPath, [fileURLToPath(new URL('../renew/Cream/kream-tools/parse-si.mjs', import.meta.url)), dir, 'N', 'k50.json', 'n-cards.json'], { encoding: 'utf8' });
  if (parsed.status !== 0) throw new Error(`${name}: ${parsed.stderr}`);
  const ctx = context(dir, { now: times.at(-1) }), screen = screenInitialMargins(ctx);
  writeJson(dir, 'margin-screen.json', screen); writeJson(dir, 'margin-1st.json', screen.shortlist);
  const jobs = { catalog: planMarginCatalogs(screen), product: planMarginPages(ctx, screen, { trustedMall, maxReferencePages: 2 }) };
  writeJson(dir, 'planned-jobs.json', jobs);
  const oldMargin = readJson(original, 'margin-1st.json', []);
  result.batches.push({ name, now: ctx.now, oldFirstMargin: oldMargin.length,
    oldUsedFirstMargin: oldMargin.filter((row) => row.best?.used || /중고|하자|모조품/.test(row.best?.title || '')).length,
    oldEligibleSources: Object.values(before.cards).reduce((n, entry) => n + searchOffers(entry).length, 0),
    newEligibleSources: Object.values(ctx.cards).reduce((n, entry) => n + searchOffers(entry).length, 0),
    ...screen.summary, catalogJobs: jobs.catalog.length, productJobs: jobs.product.length });
  result.recoveredExistingOffers.push(...recovered(before).map((row) => ({ batch: name, ...row })));
  result.recoveredReparsedOffers.push(...recovered(ctx).map((row) => ({ batch: name, ...row })));
}
for (const key of ['products', 'searched', 'oldFirstMargin', 'oldUsedFirstMargin', 'oldEligibleSources', 'newEligibleSources', 'potential', 'needs_verification', 'low_potential', 'inspectableProducts', 'catalogJobs', 'productJobs']) {
  result.summary[key] = result.batches.reduce((n, batch) => n + batch[key], 0);
}
result.summary.existingOffersRecovered = result.recoveredExistingOffers.length;
result.summary.existingProductsRecovered = new Set(result.recoveredExistingOffers.map((row) => row.pid)).size;
result.summary.reparsedOffersRecovered = result.recoveredReparsedOffers.length;
result.summary.reparsedProductsRecovered = new Set(result.recoveredReparsedOffers.map((row) => row.pid)).size;
writeJson(output, 'replay-result.json', result);
console.log(JSON.stringify({ output, ...result.summary }, null, 2));
