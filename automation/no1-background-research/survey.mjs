import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {readInstalledCode, codeHits} from './inspect-asar.mjs';

// Static evidence only: do not execute bundled code or connect to the running app.
const main = readInstalledCode('dist-electron/electron/main.js');
const preload = readInstalledCode('dist-electron/electron/preload.js');
const pkg = JSON.parse(readInstalledCode('package.json'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const locate = term => codeHits(main, term, {before: 0, after: 0, limit: 4})
  .map(({offset, line}) => ({offset, line}));
const symbols = [
  'function buildReqEnvelope(',
  'function isRemoteDispatchAllowed(',
  'async dispatch(traceId, cmd, payload)',
  'channel: "stock:check"',
  'channel: "market:kream:prices"',
  'channel: "market:kream:details"',
  'channel: "musinsa:product:benefit"',
  'channel: "musinsa:ranking:check-login"',
  'function planMusinsaGuestRoute(',
  'async function sendViaChromium(',
  'sessionFor: (partition) =>',
  'async function withMusinsaSession(',
  'async function ensureBrowserReady()',
  'function resolveKreamBrowserHostFrom(',
  'async function launchElectronBrowserSession(',
  'const uiResult = await deps6.kreamSearchViaUi(keyword);',
  'async fetchStockViaCartBatched(',
  'async processBatchInWindow(',
  'headless: false'
];
const evidence = {
  surveyedAt: new Date().toISOString(),
  kind: 'static-installed-code-survey',
  app: {name: pkg.name, version: pkg.version},
  code: {
    main: {path: 'dist-electron/electron/main.js', sha256: sha256(main)},
    preload: {path: 'dist-electron/electron/preload.js', sha256: sha256(preload)}
  },
  boundaries: {
    appCodeExecuted: false,
    accountStorageRead: false,
    appConfigurationRead: false,
    uiOperated: false,
    authenticatedRemoteCommandsSent: false,
    liveBackgroundLookupVerified: false
  },
  locations: Object.fromEntries(symbols.map(term => [term, locate(term)]))
};
const missing = Object.entries(evidence.locations).filter(([, hits]) => !hits.length).map(([term]) => term);
if (missing.length) throw new Error(`Installed code changed; review missing symbols: ${missing.join(', ')}`);
fs.writeFileSync(new URL('./static-evidence.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({version: pkg.version, locatedSymbols: symbols.length, liveBackgroundLookupVerified: false}));
