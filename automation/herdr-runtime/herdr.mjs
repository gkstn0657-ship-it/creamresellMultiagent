import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
const exec = promisify(execFile);
// Display transport must never change the authoritative work result.
export async function reportStatus(dir,send) {
  try {await send();}
  catch(error) {
    const event={at:new Date().toISOString(),type:'herdr_display_error',error:String(error.message).slice(0,500)};
    try {fs.appendFileSync(path.join(dir,'display-errors.jsonl'),JSON.stringify(event)+'\n');}
    catch {console.error('HERDR_DISPLAY_ERROR_LOG_UNAVAILABLE');}
  }
}
export function executable() {
  const local = path.join(process.env.LOCALAPPDATA || '', 'CreamHerdr', 'v0.9.5', 'herdr.exe');
  return process.env.CREAM_HERDR_BIN || (fs.existsSync(local) ? local : 'herdr');
}
export class Herdr {
  constructor({session='cream-autonomous',run=exec}={}) {this.session=session;this.run=run;}
  async call(...args) {
    const {stdout}=await this.run(executable(),['--session',this.session,...args],{windowsHide:true,timeout:20000,maxBuffer:4*1024*1024});
    if(!stdout.trim())return {acknowledged:true,executionConfirmed:false};
    const data=JSON.parse(stdout);if(data.error)throw Error(JSON.stringify(data.error));return data.result||data;
  }
  async create(cwd,label) {return this.call('workspace','create','--cwd',cwd,'--label',label,'--no-focus');}
  async report(pane,state,message) {return this.call('pane','report-agent',pane,'--source','custom:cream','--agent','cream','--state',state,'--message',message);}
  async launch(pane,script,args=[]) {
    // Encode a PowerShell script, never interpolate untrusted text into its syntax.
    const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
    const command='& '+[process.execPath,script,...args].map(quote).join(' ');
    const encoded=Buffer.from(command,'utf16le').toString('base64');
    return this.call('pane','run',pane,`powershell.exe -NoProfile -EncodedCommand ${encoded}`);
  }
}
