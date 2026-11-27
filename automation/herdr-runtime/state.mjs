import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {writeJsonAtomic} from '../agent-team/atomic-json.mjs';
export const read=file=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
export const alive=pid=>{if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch{return false;}};
export function lock(dir) {
  fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'controller.lock');
  const old=read(file);if(old&&alive(old.pid))throw Error('CONTROLLER_ALREADY_RUNNING');
  if(old)fs.unlinkSync(file);
  const token=crypto.randomUUID();fs.writeFileSync(file,JSON.stringify({pid:process.pid,token}),{flag:'wx'});
  return ()=>{if(read(file)?.token===token)fs.unlinkSync(file);};
}
export function validateMission(m) {
  if(!m||typeof m.instruction!=='string'||!m.instruction.trim()||m.instruction.length>4000)throw Error('MISSION_INSTRUCTION_REQUIRED');
  if(m.continuous!==undefined&&typeof m.continuous!=='boolean')throw Error('INVALID_CONTINUOUS_SCOPE');
  if(m.replaceWorkId!==undefined&&!/^work-[a-f0-9-]{36}$/.test(m.replaceWorkId))throw Error('INVALID_REPLACED_WORK');
  if(!Number.isSafeInteger(m.targetProducts)||m.targetProducts<1||m.targetProducts>500)throw Error('TARGET_PRODUCTS_REQUIRED_1_TO_500');
  if(!['kream-popularity','musinsa-ranking'].includes(m.source))throw Error('UNSUPPORTED_SOURCE');
  if(m.continuous&&m.source!=='musinsa-ranking')throw Error('CONTINUOUS_MUSINSA_ONLY');
  if(!Number.isSafeInteger(m.maxTurns)||m.maxTurns<1||m.maxTurns>1000)throw Error('INVALID_TURN_BUDGET');
  return m;
}
export class Journal {
  constructor(dir,mission) {this.dir=dir;fs.mkdirSync(dir,{recursive:true});this.file=path.join(dir,'state.json');this.data=read(this.file)||{version:1,mission:validateMission(mission),status:'ready',turns:0,batches:[],history:[],threadId:null};
    if(mission&&JSON.stringify(this.data.mission)!==JSON.stringify(mission))throw Error('MISSION_CHANGED');}
  save(){writeJsonAtomic(this.file,this.data);}
  event(type,data){const event={at:new Date().toISOString(),type,...data};fs.appendFileSync(path.join(this.dir,'events.jsonl'),JSON.stringify(event)+'\n');this.data.history.push(event);this.data.history=this.data.history.slice(-30);this.save();}
  stopped(){return fs.existsSync(path.join(this.dir,'STOP'));}
}
