import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
export function writeJsonAtomic(file,data,{rename=fs.renameSync,pause=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}={}){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const temp=file+'.'+process.pid+'.'+crypto.randomUUID()+'.tmp';
 fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
 try{for(let attempt=0;;attempt++)try{rename(temp,file);return;}catch(e){if(!['EPERM','EBUSY','EACCES'].includes(e.code)||attempt>=8)throw e;pause(Math.min(200,10*2**attempt));}}
 finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
