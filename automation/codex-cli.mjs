import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../',import.meta.url));

export function findBundledCodex(homes = [process.env.USERPROFILE,os.homedir(),path.resolve(ROOT,'../../../../..')]) {
  const found = [];
  for (const home of new Set(homes.filter(Boolean))) {
    for (const base of ['.vscode','.vscode-insiders']) {
      const extensions = path.join(home,base,'extensions');
      if (!fs.existsSync(extensions)) continue;
      for (const entry of fs.readdirSync(extensions,{withFileTypes:true})) {
        if (!entry.isDirectory() || !entry.name.startsWith('openai.chatgpt-')) continue;
        const executable = path.join(extensions,entry.name,'bin','windows-x86_64','codex.exe');
        if (fs.existsSync(executable)) found.push({executable,mtime:fs.statSync(executable).mtimeMs});
      }
    }
  }
  return found.sort((a,b)=>b.mtime-a.mtime)[0]?.executable || null;
}

export function codexExecutable() {
  const configured = process.env.CREAM_CODEX_EXE;
  if (configured && fs.existsSync(configured)) return configured;
  const bundled = findBundledCodex();
  if (bundled) {
    process.env.CREAM_CODEX_EXE = bundled;
    return bundled;
  }
  return 'codex';
}
