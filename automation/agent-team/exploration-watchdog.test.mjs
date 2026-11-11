import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {pollExplorationWatchdog} from './exploration-watchdog.mjs';
import {startExploration} from './exploration.mjs';
const workId='work-11111111-2222-3333-4444-555555555555',runId='batch-11111111-2222-3333-4444-555555555555';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-auto-resume-')),dir=path.join(root,'explorations',workId);
 const save=(p,x)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(x));};
 const workFile=path.join(root,'work-orders',workId+'.json'),stateFile=path.join(dir,'state.json'),batchFile=path.join(root,runId,'batch-state.json');
 save(workFile,{id:workId,status:'open',targetProducts:300,entries:[{runId}]});
 save(stateFile,{status:'needs_attention',error:'BATCH_NEEDS_ATTENTION',currentRunId:runId});
 save(batchFile,{status:'needs_attention',results:[{productId:'1',status:'needs_attention',error:'ASSESSMENT_NOT_COMPLETE'}]});
 let launches=0,time=1000000,requests=0;
 const options={root,workId,alive:()=>false,now:()=>time,client:{status:async()=>({browserConnected:true,connectorVersion:'v',requiredConnectorVersion:'v'}),request:async(cmd)=>{assert.equal(cmd,'settings:get');requests++;return {}; }},resume:async(r,args)=>{assert.equal(r,root);assert.deepEqual(args,{workId,resume:true});launches++;return {launched:true,pid:123};}};
 return {options,dir,save,workFile,stateFile,batchFile,counts:()=>({launches,requests}),advance:()=>time+=120001};
}
test('saved work is resumed once, cooldown and durable batch budget prevent repeated loops',async()=>{
 const f=fixture();assert.equal((await pollExplorationWatchdog(f.options)).status,'restarted');
 assert.equal((await pollExplorationWatchdog(f.options)).status,'cooldown');
 f.advance();assert.equal((await pollExplorationWatchdog(f.options)).status,'restarted');
 f.advance();assert.equal((await pollExplorationWatchdog(f.options)).reason,'BATCH_RETRY_LIMIT');
 assert.deepEqual(f.counts(),{launches:2,requests:2});
});
test('live worker, completed work and explicit stop never launch',async()=>{
 const f=fixture();assert.equal((await pollExplorationWatchdog({...f.options,alive:()=>true})).status,'watching');
 f.save(f.stateFile,{status:'complete'});assert.equal((await pollExplorationWatchdog(f.options)).terminal,true);
 fs.writeFileSync(path.join(f.dir,'STOP'),'stop');assert.equal((await pollExplorationWatchdog(f.options)).reason,'USER_STOPPED');
 assert.equal(f.counts().launches,0);assert.equal(f.counts().requests,0);
});
test('unknown and authentication failures are not retried and missing session spends no attempts',async()=>{
 const f=fixture();
 for(const error of ['NO1_INVALID_RESPONSE','NO1_AUTH_REQUIRED','UNKNOWN']){
  f.save(f.batchFile,{results:[{status:'needs_attention',error}]});assert.equal((await pollExplorationWatchdog(f.options)).status,'blocked');
 }
 f.save(f.batchFile,{results:[{status:'needs_attention',error:'CODEX_TURN_TIMEOUT'}]});
 f.options.client.request=async()=>{throw Error('NO1_WEB_TAB_REQUIRED');};
 const result=await pollExplorationWatchdog(f.options);assert.equal(result.reason,'NO1_SESSION_NOT_READY');assert.equal(result.attempts.length,0);assert.equal(f.counts().launches,0);
});
test('automatic resume honors a stop arriving after its initial check',async()=>{
 const f=fixture();
 f.save(f.workFile,{id:workId,status:'stopped',targetProducts:300,entries:[{runId}]});
 await assert.rejects(startExploration(f.options.root,{workId,resume:true},{requireOpenWork:true,launchExploration:()=>assert.fail('must not launch')}),/STOP_REQUESTED/);
 assert.equal(JSON.parse(fs.readFileSync(f.workFile,'utf8')).status,'stopped');
});
