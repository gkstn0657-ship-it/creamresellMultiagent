import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const venv = fileURLToPath(new URL(process.platform === 'win32'
  ? '../.venv/Scripts/python.exe' : '../.venv/bin/python', import.meta.url));
const configuredPython = process.env.CREAM_PYTHON || (fs.existsSync(venv) ? venv : null);
export const projectPython = configuredPython || 'python';

// Before setup, a legacy Excel environment and the Windows Python 3 launcher
// may coexist. Daily-report scripts use the latter's current standard library.
const launcher = !configuredPython && process.platform === 'win32' &&
  (process.env.PATH || '').split(path.delimiter).filter(Boolean)
    .map(dir => path.join(dir, 'py.exe')).find(file => fs.existsSync(file));
export const reportPython = launcher ? [launcher, '-3'] : [projectPython];
