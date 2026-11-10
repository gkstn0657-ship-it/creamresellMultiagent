import test from 'node:test';
import assert from 'node:assert/strict';
import {relayRequest,projectData,validateCommand} from './chrome-extension/protocol.mjs';
import {readDisplayedTable,readSavedMarginSettings} from './chrome-extension/schema-data.mjs';
const cmd='market:kream:history:start',payload={productCode:'123',useSharedSales30d:true};
const push=(taskId='task',stage='final',extra={})=>({type:'PUSH',v:2,channel:'market:kream:history:'+stage,data:{productCode:'123',taskId,data:{mode:'estimated',perSize:{L:{estimated30d:3076,confidence:'high',mode:'estimated',token:'secret'}}},meta:{source:'cache'},cacheInfo:{fetchedAt:'2026-11-09T16:06:00Z',state:'fresh'},...extra}});
class Socket extends EventTarget{
  static run;
  constructor(){super();this.readyState=1;queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
  send(raw){const q=JSON.parse(raw);if(q.type==='REQ')Socket.run(this,q);}
  recv(m){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(m)}));}
  close(){this.readyState=3;}
}
const call=timeoutMs=>relayRequest({cmd,payload,token:'test-only',Socket,timeoutMs:timeoutMs||100});
const ack=q=>({type:'RES',v:2,cmd,traceId:q.traceId,ok:true,data:{taskId:'task'}});
test('sales source waits for exact product/task; supports PUSH arriving before ack',async()=>{
  Socket.run=(s,q)=>{s.recv(push('other'));s.recv(push('task','final',{productCode:'999'}));s.recv(push());s.recv(ack(q));};
  const r=await call();assert.equal(r.perSize.L.estimated30d,3076);assert.equal(r.stage,'final');assert.equal(r.cacheInfo.fetchedAt,'2026-11-09T16:06:00Z');assert.ok(!JSON.stringify(r).includes('secret'));
});
test('partial timeout preserves partial counts and never upgrades them to final',async()=>{
  Socket.run=(s,q)=>{s.recv(ack(q));s.recv(push('task','partial'));};
  const r=await call(10);assert.equal(r.stage,'partial');assert.equal(r.errorCode,'NO1_HISTORY_TIMEOUT');
  Socket.run=(s,q)=>s.recv(ack(q));await assert.rejects(call(10),/NO1_HISTORY_TIMEOUT/);
});
test('malformed and cross-product projected history cannot enter stored evidence',()=>{
  const raw={productCode:'123',taskId:'task',stage:'final',perSize:{L:{estimated30d:-1}}};
  assert.throws(()=>projectData(cmd,raw,payload));assert.throws(()=>projectData(cmd,{...raw,productCode:'456'},payload));
  assert.throws(()=>validateCommand(cmd,{...payload,force:true}));
  validateCommand('market:kream:details',{productCode:'123',includeFastDelivery:true});
});
test('fast-delivery field survives both wire projection passes',()=>{
  const p={productCode:'123',includeFastDelivery:true},data={sizeOptions:[{size:'L',option:'l',fastDeliveryPrice:300000,lowestNormal:280000,highestBid:250000}]};
  const once=projectData('market:kream:details',data,p);assert.equal(projectData('market:kream:details',once,p).sizeOptions[0].fastDeliveryPrice,300000);
});
test('actual saved fee/tax configuration follows No1 migration semantics',t=>{
  const old={location:globalThis.location,localStorage:globalThis.localStorage};t.after(()=>Object.assign(globalThis,old));
  globalThis.location={origin:'https://no1.certi.life',pathname:'/sourcing/'};
  const data={'priceCompareFee.v2':JSON.stringify({schemaVersion:4,kream:{percent:'7'}}),'market:kreamInspectionFee':'3000','market:taxMode':'true'};
  globalThis.localStorage={getItem:k=>data[k]??null};
  const r=readSavedMarginSettings();assert.equal(r.feePercent,7);assert.equal(r.inspectionFee,3000);assert.equal(r.taxMode,true);
  data['priceCompareFee.v2']=JSON.stringify({schemaVersion:3,kream:{percent:'4'}});data['market:kreamInspectionFee']='5000';
  assert.equal(readSavedMarginSettings().feePercent,6);assert.equal(readSavedMarginSettings().inspectionFee,2500);
});
test('production mounted VNode yields exact displayed margin and rate without clicks',t=>{
  const old={location:globalThis.location,document:globalThis.document};t.after(()=>Object.assign(globalThis,old));
  globalThis.location={origin:'https://no1.certi.life',pathname:'/sourcing/'};
  const line={querySelector:s=>s==='.size-cell'?{}:{innerText:({'.margin-value':'-11,600원','.ros-value':'-4.4%','.sales-cell':'3,076'})[s]}};
  const table={querySelectorAll:()=>[line],querySelector:s=>({innerText:s==='.sum-value'?'3,076건':'오늘 01:06 기준 최신'})};
  const component={type:{__name:'KreamPriceTable'},subTree:{el:table},props:{data:{productCode:'123',sizes:[{size:'L',option:'l',sales30d:3076,sales30dStatus:'ok',isEstimated:true,fast100:300000,normal:265000,highestBid:200000}]},marginInputs:{marginMode:'normal',purchasePrice:258200,desiredSellingPrice:0,feePercent:6,inspectionFee:2500,taxMode:false},applyFeeEvent:true}};
  globalThis.document={querySelectorAll:s=>s==='[data-v-app]'?[{_vnode:{component}}]:[table]};
  const r=projectData('market:kream:displayed-schema',readDisplayedTable('123')[0],{productCode:'123'});
  assert.equal(r.rows[0].marginAmount,-11600);assert.equal(r.rows[0].marginRate,-4.4);assert.equal(r.rows[0].sales30d,3076);assert.equal(r.asOfText,'오늘 01:06 기준 최신');assert.equal(readDisplayedTable('999').length,0);
});
