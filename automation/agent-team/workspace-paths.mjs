import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));

export function workspacePaths(checkout = repo, env = process.env) {
  const root = path.resolve(checkout);
  const parent = path.dirname(root);
  const oldLedger = path.join(parent, 'Cream', 'kream-runs', 'agent-teams');
  const split = path.basename(parent).toLowerCase() === '1109renew' &&
    fs.statSync(path.join(oldLedger, 'work-orders'), {throwIfNoEntry: false})?.isDirectory();
  return {
    ledger: path.resolve(env.CREAM_AGENT_TEAMS_ROOT || (split ? oldLedger : path.join(root, 'kream-runs', 'agent-teams'))),
    reports: path.resolve(env.CREAM_REPORTS_DIR || path.join(split ? path.dirname(parent) : root, '상품탐색결과')),
    writer: path.join(root, '상품탐색결과', 'append_result.py')
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(workspacePaths().ledger);
}
