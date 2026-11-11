import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {liveDashboardData,createDashboardServer,startDashboardWork} from './server.mjs';
test('separate AI health monitor reports stale or exited supervision honestly',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-health-panel-')),id='work-11111111-2222-3333-4444-555555555555',dir=path.join(root,'explorations',id);
 fs.mkdirSync(path.join(root,'work-orders'),{recursive:true});fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(root,'work-orders',id+'.json'),JSON.stringify({id,status:'open'}));
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({status:'discovering'}));
 const file=path.join(dir,'health-monitor.json'),report={at:new Date().toISOString(),pid:process.pid,status:'healthy',reason:'RUNNING',code:200,ai:{status:'idle'}};
 fs.writeFileSync(file,JSON.stringify(report));assert.equal(liveDashboardData(root,id).healthMonitor.active,true);
 fs.writeFileSync(file,JSON.stringify({...report,at:'2020-01-01T00:00:00Z'}));assert.equal(liveDashboardData(root,id).healthMonitor.active,false);
 fs.writeFileSync(file,JSON.stringify({...report,endedAt:new Date().toISOString()}));assert.equal(liveDashboardData(root,id).healthMonitor.active,false);
});
test('skipped lookup list distinguishes failed queries from screening exclusions and preserves actual attempts',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-skipped-')),id='work-11111111-2222-3333-4444-555555555555',dir=path.join(root,'explorations',id);
 fs.mkdirSync(path.join(root,'work-orders'),{recursive:true});fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(root,'work-orders',id+'.json'),JSON.stringify({id,status:'open'}));
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({skipped:[{sourceId:'1',reason:'NO_AVAILABLE_STOCK'},{sourceId:'2',lookupFailed:true,reason:'STOCK_CHECK_FAILED',attempts:4},{sourceId:'3',productName:'상품 이름',lookupFailed:true,reason:'NO1_RELAY_TIMEOUT',attempts:2,at:'2026-11-10T17:00:00Z'},{sourceId:'bad/path',lookupFailed:true,reason:'STOCK_CHECK_FAILED'},{sourceId:'2',lookupFailed:true,reason:'STOCK_CHECK_FAILED',attempts:4}]}));
 const data=liveDashboardData(root,id);assert.equal(data.lookupSkippedCount,3);assert.equal(data.lookupSkipped.find(s=>s.sourceId==='2').attempts,4);assert.equal(data.lookupSkipped.find(s=>s.sourceId==='2').name,null);assert.equal(data.lookupSkipped.find(s=>s.sourceId==='3').url,'https://www.musinsa.com/products/3');assert.equal(data.lookupSkipped.find(s=>s.sourceId==='bad/path').url,null);assert.ok(!data.lookupSkipped.some(s=>s.sourceId==='1'));
 assert.deepEqual(liveDashboardData(fs.mkdtempSync(path.join(os.tmpdir(),'cream-empty-'))).lookupSkipped,[]);
});
test('dashboard reports waiting as waiting and shows only saved reviewed results',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-live-desk-')),id='work-11111111-2222-3333-4444-555555555555',batch='batch-11111111-2222-3333-4444-555555555555',dir=path.join(root,'explorations',id);
 fs.mkdirSync(path.join(root,'work-orders'),{recursive:true});fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(root,batch),{recursive:true});
 fs.writeFileSync(path.join(root,'work-orders',id+'.json'),JSON.stringify({id,status:'open',continuous:true,targetProfitableProducts:10,createdAt:'2026-11-10T00:00:00Z'}));
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({status:'waiting_for_retry',checkedSources:368,profitableProductsFound:1,waitReason:'NO1_WEB_TAB_REQUIRED',retryAt:'2026-11-10T13:16:00Z',batches:[{runId:batch}],currentRunId:batch,currentSource:{rank:44,productId:'7',productName:'jacket'}}));
 fs.writeFileSync(path.join(root,batch,'batch-state.json'),JSON.stringify({status:'complete',results:[{productId:'123',status:'complete',assessment:{decision:'adopt',reviewId:'review-1',reason:'validated'},qualification:{passed:true}}]}));
 const data=liveDashboardData(root,id);assert.equal(data.status,'offline');assert.equal(data.workerAlive,false);assert.equal(data.checked,368);assert.equal(data.qualified,1);assert.equal(data.reviewed,1);assert.equal(data.recent[0].qualified,true);assert.equal(data.featured.productId,'123');assert.equal(data.waitReason,'NO1_WEB_TAB_REQUIRED');
 fs.writeFileSync(path.join(dir,'continuous.lock'),String(process.pid));
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({status:'discovering',checkedSources:368,profitableProductsFound:1,batches:[{runId:batch}]}));
 fs.writeFileSync(path.join(dir,'monitor.json'),JSON.stringify({at:new Date().toISOString(),severity:'error',status:'connector_disconnected',reason:'NO1_BRIDGE_DISCONNECTED',code:503,handler:'connector_agent',action:'wait_for_connector'}));
 const watched=liveDashboardData(root,id);assert.equal(watched.status,'waiting');assert.equal(watched.waitReason,'NO1_BRIDGE_DISCONNECTED');assert.equal(watched.monitor.code,503);
 const app=createDashboardServer({root,workId:id,port:0});const address=await app.listen();try{const response=await fetch(`http://127.0.0.1:${address.port}/api/state`);assert.equal(response.status,200);assert.equal((await response.json()).checked,368);const page=await fetch(`http://127.0.0.1:${address.port}/`);assert.match(await page.text(),/수익 상품 탐색 현황/);assert.equal((await fetch(`http://127.0.0.1:${address.port}/missing`)).status,404);}finally{app.server.close();}
});
test('start endpoint accepts only a same-origin request for the displayed work',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-start-endpoint-')),id='work-11111111-2222-3333-4444-555555555555';
 fs.mkdirSync(path.join(root,'work-orders'),{recursive:true});fs.writeFileSync(path.join(root,'work-orders',id+'.json'),JSON.stringify({id,status:'open',continuous:true,createdAt:'2026-11-10T00:00:00Z'}));
 let calls=0;const app=createDashboardServer({root,workId:id,port:0,start:async()=>{calls++;return {ok:true,code:200,reason:'RETRY_WOKEN'};}});
 const address=await app.listen(),url=`http://127.0.0.1:${address.port}/api/start`,headers={'Content-Type':'application/json',Origin:`http://127.0.0.1:${address.port}`};
 try{
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workId:id})})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({workId:'work-00000000-0000-0000-0000-000000000000'})})).status,400);
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({workId:id})});assert.equal(response.status,200);assert.equal((await response.json()).reason,'RETRY_WOKEN');assert.equal(calls,1);
  const page=await fetch(`http://127.0.0.1:${address.port}/`);assert.match(await page.text(),/id="start-button"/);
 }finally{app.server.close();}
});
test('start resumes the saved retry only when the background connector is connected',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-start-work-')),workId='work-11111111-2222-3333-4444-555555555555',dir=path.join(root,'explorations',workId);
 fs.mkdirSync(path.join(root,'work-orders'),{recursive:true});fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(root,'work-orders',workId+'.json'),JSON.stringify({id:workId,status:'open',scopeMode:'profitable-results',continuous:true,entries:[],createdAt:'2026-11-10T00:00:00Z'}));
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({status:'waiting_for_retry',waitReason:'NO1_BRIDGE_DISCONNECTED'}));
 let calls=0,connected=false;const continueWork=async()=>{calls++;return {reused:true};};
 const client={status:async()=>({browserConnected:connected,connectorVersion:'0.8.0',requiredConnectorVersion:'0.8.0'})};
 const blocked=await startDashboardWork({root,workId,client,continueWork});assert.equal(blocked.code,503);assert.equal(fs.existsSync(path.join(dir,'WAKE')),false);
 connected=true;const resumed=await startDashboardWork({root,workId,client,continueWork});assert.equal(resumed.code,200);assert.equal(fs.readFileSync(path.join(dir,'WAKE'),'utf8'),'dashboard start');assert.equal(calls,2);
 const workFile=path.join(root,'work-orders',workId+'.json');const stopped=JSON.parse(fs.readFileSync(workFile,'utf8'));stopped.status='stopped';fs.writeFileSync(workFile,JSON.stringify(stopped));fs.writeFileSync(path.join(dir,'STOP'),'stopped');
 const restarted=await startDashboardWork({root,workId,client,continueWork});assert.equal(restarted.code,200);assert.equal(JSON.parse(fs.readFileSync(workFile,'utf8')).status,'open');assert.equal(fs.existsSync(path.join(dir,'STOP')),false);
});
