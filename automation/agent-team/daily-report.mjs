import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {workOrders} from './work-orders.mjs';
import {workspacePaths} from './workspace-paths.mjs';

const {ledger: defaultRoot, reports, writer} = workspacePaths();
const kst = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'});
const decisions = {adopt: '채택 후보', hold: '보류', exclude: '제외'};
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function marker(root, workId) {
  if (!/^work-[a-f0-9-]{36}$/.test(workId)) throw Error('INVALID_WORK_ID');
  return path.join(root, 'explorations', workId, 'daily-report.enabled');
}

function appendEntry(day, entry) {
  const args = ['-X', 'utf8', writer, '--date', day, '--entry', '-'];
  const options = {input: JSON.stringify(entry), encoding: 'utf8', windowsHide: true,
    env: {...process.env, CREAM_REPORTS_DIR: reports}};
  const venv = path.join(path.dirname(path.dirname(writer)), '.venv', 'Scripts', 'python.exe');
  const python = process.env.CREAM_PYTHON || (fs.existsSync(venv) ? venv : null);
  const useLauncher = !python && process.platform === 'win32';
  let result = spawnSync(python || (useLauncher ? 'py' : 'python3'), useLauncher ? ['-3', ...args] : args, options);
  if (useLauncher && result.error?.code === 'ENOENT') result = spawnSync('python', args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr.trim() || 'DAILY_REPORT_WRITE_FAILED');
}

function reportEntry(workId, runId, row, packet) {
  const assessment = row.assessment;
  if (!/^\d{1,12}$/.test(row.productId) || packet.productId !== row.productId ||
      !assessment?.reviewId || !Object.hasOwn(decisions, assessment.decision) || !assessment.reason) {
    throw Error('DAILY_REPORT_INVALID_ASSESSMENT');
  }
  const sources = [{label: 'KREAM 상품', url: 'https://kream.co.kr/products/' + row.productId}];
  const seen = new Set(sources.map(source => source.url));
  for (const offer of [...(packet.offers || []), ...(packet.sourceQuotes || [])]) {
    const value = offer.productUrl;
    if (!URL.canParse(value) || seen.has(value)) continue;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    seen.add(value);
    sources.push({label: url.hostname + (offer.option ? ' · ' + offer.option : ''), url: value});
  }
  const name = packet.candidate?.title || packet.offers?.[0]?.model || ('KREAM ' + row.productId);
  const gaps = (assessment.unresolved || []).filter(Boolean);
  return {
    id: [workId, runId, row.productId].join('/'),
    title: name.replace(/\s+/g, ' ').replaceAll('<!--', '&lt;!--'),
    status: decisions[assessment.decision],
    details: [assessment.reason, ...(gaps.length ? ['확인할 항목 · ' + gaps.join(', ')] : [])]
      .join('\n\n').replaceAll('<!--', '&lt;!--'),
    sources
  };
}

export function syncDailyReports(root, workId, runId, append = appendEntry) {
  if (!fs.existsSync(marker(root, workId))) return;
  const work = workOrders(root).find(item => item.id === workId);
  if (!work) throw Error('USER_WORK_SCOPE_REQUIRED');
  let products = 0;
  for (const entry of work.entries.filter(item => !runId || item.runId === runId)) {
    if (!/^batch-[a-f0-9-]{36}$/.test(entry.runId)) throw Error('INVALID_RUN_ID');
    const dir = path.join(root, entry.runId);
    const file = path.join(dir, 'batch-result.json');
    if (!fs.existsSync(file)) continue;
    const launch = read(path.join(dir, 'launch.json'));
    const batch = read(file);
    if (launch.workId !== workId || launch.managedBy !== 'deterministic-exploration' ||
        batch.mode !== 'live' || batch.status !== 'complete' || (batch.analysisProfile || 'general') !== 'general') continue;
    for (const row of batch.results) {
      if (row.status !== 'complete' || !/^\d{1,12}$/.test(row.productId)) throw Error('DAILY_REPORT_INVALID_ROW');
      const packet = read(path.join(dir, 'packets', 'product-' + row.productId + '.json'));
      if (!packet.observations?.length || packet.observations.some(obs => obs.mode !== 'live')) continue;
      const date = new Date(row.assessment?.at || batch.finishedAt);
      if (!Number.isFinite(date.getTime())) throw Error('DAILY_REPORT_INVALID_TIMESTAMP');
      append(kst.format(date), reportEntry(workId, entry.runId, row, packet));
      products++;
    }
  }
  return {products};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const arg = key => process.argv.find(value => value.startsWith('--' + key + '='))?.slice(key.length + 3);
  const root = path.resolve(arg('root') || defaultRoot);
  const workId = arg('work');
  const file = marker(root, workId);
  if (process.argv.includes('--enable')) {
    const work = workOrders(root).find(item => item.id === workId);
    if (!work || ['profitable-results','inspected-sources'].includes(work.scopeMode)) throw Error('GENERAL_WORK_REQUIRED');
    if (!fs.existsSync(writer)) throw Error('LOCAL_DAILY_REPORT_WRITER_MISSING');
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.closeSync(fs.openSync(file, 'a'));
  }
  if (!fs.existsSync(file)) throw Error('DAILY_REPORT_NOT_ENABLED');
  console.log(JSON.stringify(syncDailyReports(root, workId)));
}
