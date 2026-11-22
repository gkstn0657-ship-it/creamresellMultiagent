import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function findBundledCodex(homes = [process.env.USERPROFILE,os.homedir()]) {
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
  if (process.platform === 'win32') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const triple = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
    for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
      const exe = path.join(dir,'codex.exe');
      if (fs.existsSync(exe)) return exe;
      // npm's .cmd launchers cannot be spawned with shell:false; use its native binary.
      if (!fs.existsSync(path.join(dir,'codex.cmd'))) continue;
      const packages = path.join(dir,'node_modules','@openai');
      for (const pkg of [path.join(packages,'codex'), path.join(packages,'codex-win32-'+arch),
        path.join(packages,'codex','node_modules','@openai','codex-win32-'+arch)]) {
        const native = path.join(pkg,'vendor',triple,'codex','codex.exe');
        if (fs.existsSync(native)) return native;
      }
    }
  }
  const bundled = findBundledCodex();
  if (bundled) {
    process.env.CREAM_CODEX_EXE = bundled;
    return bundled;
  }
  return 'codex';
}
