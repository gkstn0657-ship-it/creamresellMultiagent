import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const configPath = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'CreamNo1Bridge', 'connection.json');
export function readConfig() {
  let value;
  try { value = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { throw Error('NO1_BRIDGE_NOT_CONFIGURED'); }
  if (value.url !== 'http://127.0.0.1:8871' || !/^[a-f0-9]{64}$/.test(value.key || '')) throw Error('NO1_INVALID_BRIDGE_CONFIG');
  return value;
}
export function ensureConfig() {
  if (fs.existsSync(configPath())) return readConfig();
  const value = {url: 'http://127.0.0.1:8871', key: crypto.randomBytes(32).toString('hex')};
  fs.mkdirSync(path.dirname(configPath()), {recursive: true});
  fs.writeFileSync(configPath(), JSON.stringify(value), {mode: 0o600, flag: 'wx'});
  return value;
}
