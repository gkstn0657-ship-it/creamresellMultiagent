import fs from 'node:fs';
import path from 'node:path';

// Static, read-only inspection of the installed program's executable code.
// Account stores, .env files and running application state are not read.
export function readInstalledCode(file) {
  if (!['package.json','dist-electron/electron/main.js','dist-electron/electron/preload.js'].includes(file)) throw Error('CODE_FILE_NOT_ALLOWED');
  const archive=path.join(process.env.LOCALAPPDATA,'Programs/no1-center-electron/resources/app.asar');
  const fd=fs.openSync(archive,'r');
  try {
    const b=Buffer.alloc(16);fs.readSync(fd,b,0,16,0);
    const size=b.readUInt32LE(12);if(size<2||size>8000000)throw Error('ASAR_HEADER_INVALID');
    const h=Buffer.alloc(size);fs.readSync(fd,h,0,size,16);
    let entry=JSON.parse(h.toString());for(const part of file.split('/'))entry=entry.files[part];
    if(!entry||entry.unpacked||entry.size>12000000||!/^\d+$/.test(entry.offset))throw Error('ASAR_ENTRY_INVALID');
    const data=Buffer.alloc(entry.size);fs.readSync(fd,data,0,data.length,8+b.readUInt32LE(4)+Number(entry.offset));return data.toString('utf8');
  } finally {fs.closeSync(fd);}
}
export function codeHits(code, term, {before=100,after=400,limit=8}={}) {
  const hits=[];let at=0;
  while((at=code.indexOf(term,at))>=0&&hits.length<limit){hits.push({offset:at,line:code.slice(0,at).split('\n').length,text:code.slice(Math.max(0,at-before),at+after)});at+=term.length;}
  return hits;
}
