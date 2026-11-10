import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readJson, writeJson } from '../../renew/Cream/kream-tools/agents-core.mjs';
import { runAgentic } from './runtime.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export function copyReplayInput(source, destination) {
  source = path.resolve(source); destination = path.resolve(destination);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw Error('REPLAY_SOURCE_MISSING');
  if (source === destination || destination.startsWith(source + path.sep)) throw Error('REPLAY_MUST_BE_OUTSIDE_SOURCE');
  if (fs.existsSync(destination) && fs.readdirSync(destination).length) throw Error('REPLAY_OUTPUT_MUST_BE_EMPTY');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync(source)) if (/^(?:dump-|no1-market-|no1-stock-).*\.json$/.test(name) ||
    /^(?:k50(?:-ids|-all)?|agent-policy|agent-evidence|batch-evidence|n-cards|n-cat|chart)\.json$/.test(name)) {
    fs.copyFileSync(path.join(source, name), path.join(destination, name));
  }
  writeJson(destination, 'replay-source.json', { source, copiedAt: new Date().toISOString(), originalTimestampsPreserved: true });
}
export async function startAgenticPipeline(dir, args = [], options = {}) {
  dir = path.resolve(dir);
  const arg = key => args.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
  const replayFrom = arg('replay-from');
  if (replayFrom && !fs.existsSync(path.join(dir, 'agentic-state.json'))) copyReplayInput(replayFrom, dir);
  const configFile = arg('agent-config');
  const config = configFile ? JSON.parse(fs.readFileSync(path.resolve(configFile), 'utf8')) : {};
  const sourcesFile = arg('sources-file');
  const sources = sourcesFile ? JSON.parse(fs.readFileSync(path.resolve(sourcesFile), 'utf8')) : [arg('source') || 'https://kream.co.kr/categories/50/24?sort=popular_score'];
  const runtime = readJson(ROOT, 'sourcing-runtime.json', {});
  const relayDir = arg('relay-dir') || runtime.relayRunDir;
  return runAgentic(dir, { ...options, config: { ...config, ...options.config, ...(arg('limit') ? { targetCount: Number(arg('limit')) } : {}) }, sources,
    mode: args.includes('--replay') || replayFrom ? 'replay' : 'live', discoveryOnly: options.collectOnly === true,
    relayDir: relayDir ? path.resolve(ROOT, relayDir) : null,
    onEvent: options.onEvent || (event => console.log(`[${new Date().toISOString()}] ${event.type} ${event.stage || ''} ${event.summary || event.message || event.model || ''}`)) });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dir = process.argv.find(arg => arg.startsWith('--out='))?.slice(6);
  if (!dir) throw Error('Usage: node automation/agentic/run.mjs --out=<run-dir> [--replay-from=<saved-run>] [--limit=5]');
  try {
    const result = await startAgenticPipeline(dir, process.argv.slice(2));
    console.log(JSON.stringify({ dir, summary: result.summary, status: readJson(dir, 'agentic-state.json')?.status }));
    if (readJson(dir, 'agentic-state.json')?.status !== 'complete') process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
