import fs from 'node:fs';import path from 'node:path';
import {writeJsonAtomic as write} from './atomic-json.mjs';
import {classifyError} from './error-catalog.mjs';
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
export function heartbeatCode(finding){return classifyError(finding).code;}
export function routeHeartbeat(signal){const {handler,action}=classifyError(signal);return {handler,action};}
export function coordinatorAccept(signal,dir){
 if(!signal||!Number.isSafeInteger(signal.sequence)||signal.sequence<1||typeof signal.id!=='string'||typeof signal.reason!=='string')throw Error('INVALID_HEARTBEAT_SIGNAL');
 const prior=read(path.join(dir,'coordinator.json'));
 if(prior?.sequence>signal.sequence||prior?.sequence===signal.sequence&&prior.signalId!==signal.id)throw Error('STALE_HEARTBEAT_SIGNAL');
 if(prior?.signalId===signal.id)return prior;
 const classified=classifyError(signal);
 const ack={signalId:signal.id,sequence:signal.sequence,receivedCode:signal.code,code:classified.code,reason:classified.reason,handler:classified.handler,action:classified.action,corrected:signal.code!==classified.code,acceptedAt:new Date().toISOString(),from:'coordinator',to:'commander'};
 write(path.join(dir,'coordinator.json'),ack);return ack;
}
export async function commanderHandle(signal,ack,dir,handlers={}){
 if(ack.signalId!==signal.id||ack.sequence!==signal.sequence)throw Error('HEARTBEAT_ACK_MISMATCH');
 const old=read(path.join(dir,'commander.json'));if(old?.signalId===signal.id)return old;
 const route={handler:ack.handler,action:ack.action},handler=handlers[route.action];
 const result=handler?await handler({...signal,code:ack.code,reason:ack.reason},route):{status:'recorded'};
 const decision={signalId:signal.id,sequence:signal.sequence,code:ack.code,reason:ack.reason,handler:route.handler,action:route.action,result,handledAt:new Date().toISOString()};
 write(path.join(dir,'commander.json'),decision);return decision;
}
export async function sendHeartbeat({root,workId,finding,handlers={},channel='main'}){
 if(!['main','remote'].includes(channel))throw Error('INVALID_HEARTBEAT_CHANNEL');
 const dir=path.join(root,'explorations',workId,'heartbeats',...(channel==='main'?[]:[channel]));fs.mkdirSync(dir,{recursive:true});
 // A signal persisted just before a crash is delivered before creating a new one.
 const pending=read(path.join(dir,'monitor.json')),last=read(path.join(dir,'commander.json'));
 if(pending&&last?.signalId!==pending.id){const ack=coordinatorAccept(pending,dir);await commanderHandle(pending,ack,dir,handlers);}
 const sequence=(pending?.sequence||0)+1;
 const signal={id:`${workId}:${channel}:${sequence}`,sequence,at:new Date().toISOString(),from:'monitor_agent',to:'coordinator',workId,channel,code:heartbeatCode(finding),reason:String(finding.reason||'RUNNING'),status:finding.status,checked:finding.checked||0,qualified:finding.qualified||0};
 write(path.join(dir,'monitor.json'),signal);
 const ack=coordinatorAccept(signal,dir),decision=await commanderHandle(signal,ack,dir,handlers);
 return {signal,ack,decision};
}
