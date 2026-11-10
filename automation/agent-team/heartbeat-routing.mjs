import fs from 'node:fs';import path from 'node:path';
import {writeJsonAtomic as write} from './atomic-json.mjs';
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const codes=new Set([200,401,404,426,429,500,501,502,503,504]);
export function heartbeatCode(finding){
 const reason=String(finding.reason||'');
 if(finding.status==='healthy'||finding.status==='stopped'||finding.status==='waiting'&&reason==='new_ranking_cycle')return 200;
 if(/AUTH|LOGIN|TOKEN/.test(reason))return 401;
 if(reason==='NO1_WEB_TAB_REQUIRED'||reason==='NO1_BROWSER_ACCESS_FAILED')return 404;
 if(reason==='NO1_CONNECTOR_UPDATE_REQUIRED')return 426;
 if(reason==='RATE_LIMITED')return 429;
 if(finding.status==='worker_stopped')return 500;
 if(finding.status==='bridge_unavailable'||reason==='NO1_BRIDGE_DISCONNECTED')return 503;
 if(finding.status==='stalled'||/TIMEOUT|STALE/.test(reason))return 504;
 if(reason==='KREAM_SEARCH_FAILED'||reason==='STOCK_CHECK_FAILED'||reason==='NO1_UPSTREAM_LOOKUP_FAILED')return 502;
 return 501;
}
export function routeHeartbeat(signal){
 const code=signal.code,reason=signal.reason;
 if(code===200)return {handler:'commander',action:'keep_running'};
 if(code===401)return {handler:'auth_agent',action:'request_login'};
 if(code===404)return {handler:'browser_connection_agent',action:'wait_for_authenticated_tab'};
 if(code===426)return {handler:'connector_agent',action:'request_connector_reload'};
 if(code===429)return {handler:'rate_agent',action:'honor_backoff'};
 if(code===500)return {handler:'worker_agent',action:'restart_worker'};
 if(code===502)return {handler:'upstream_agent',action:'retry_saved_request'};
 if(code===503)return reason==='NO1_BRIDGE_DISCONNECTED'?{handler:'connector_agent',action:'wait_for_connector'}:{handler:'bridge_agent',action:'restart_bridge'};
 if(code===504)return {handler:'latency_agent',action:'inspect_stall'};
 return {handler:'diagnostic_agent',action:'record_unknown_error'};
}
export function coordinatorAccept(signal,dir){
 if(!signal||!Number.isSafeInteger(signal.sequence)||signal.sequence<1||!codes.has(signal.code)||typeof signal.id!=='string'||typeof signal.reason!=='string')throw Error('INVALID_HEARTBEAT_SIGNAL');
 const ack={signalId:signal.id,sequence:signal.sequence,code:signal.code,acceptedAt:new Date().toISOString(),from:'monitor_agent',to:'commander'};
 write(path.join(dir,'coordinator.json'),ack);return ack;
}
export async function commanderHandle(signal,ack,dir,handlers={}){
 if(ack.signalId!==signal.id||ack.sequence!==signal.sequence)throw Error('HEARTBEAT_ACK_MISMATCH');
 const old=read(path.join(dir,'commander.json'));if(old?.signalId===signal.id)return old;
 const route=routeHeartbeat(signal),handler=handlers[route.action];
 const result=handler?await handler(signal,route):{status:'recorded'};
 const decision={signalId:signal.id,sequence:signal.sequence,code:signal.code,reason:signal.reason,handler:route.handler,action:route.action,result,handledAt:new Date().toISOString()};
 write(path.join(dir,'commander.json'),decision);return decision;
}
export async function sendHeartbeat({root,workId,finding,handlers={}}){
 const dir=path.join(root,'explorations',workId,'heartbeats');fs.mkdirSync(dir,{recursive:true});
 // A signal persisted just before a crash is delivered before creating a new one.
 const pending=read(path.join(dir,'monitor.json')),last=read(path.join(dir,'commander.json'));
 if(pending&&last?.signalId!==pending.id){const ack=coordinatorAccept(pending,dir);await commanderHandle(pending,ack,dir,handlers);}
 const sequence=(pending?.sequence||0)+1;
 const signal={id:`${workId}:${sequence}`,sequence,at:new Date().toISOString(),from:'monitor_agent',to:'coordinator',workId,code:heartbeatCode(finding),reason:String(finding.reason||'RUNNING'),status:finding.status,checked:finding.checked||0,qualified:finding.qualified||0};
 write(path.join(dir,'monitor.json'),signal);
 const ack=coordinatorAccept(signal,dir),decision=await commanderHandle(signal,ack,dir,handlers);
 return {signal,ack,decision};
}
