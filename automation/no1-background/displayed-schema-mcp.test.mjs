import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchBackground,handlesBackgroundTool} from './mcp.mjs';
import {dispatch} from '../no1-mcp-prototype/server-stock.mjs';
const name='no1_background_displayed_schema';
const request=args=>({id:1,method:'tools/call',params:{name,arguments:args}});
const sample={available:true,productCode:'797025',observedAt:'2026-11-10T00:00:00Z',inputs:{marginMode:'normal',purchasePrice:100000,desiredSellingPrice:0,feePercent:6,inspectionFee:2500,taxMode:false,applyFeeEvent:false},totalText:null,asOfText:null,salesStopped:false,rows:[{size:'UK 4',option:'4',isEstimated:true,marginAmount:117460,marginRate:50.2,marginAmountText:'117,460원',marginRateText:'50.2%'}]};
test('read-only schema tool is exposed by the real MCP without sourcing URL',async()=>{
  assert.equal(handlesBackgroundTool(name),true);
  const tool=(await dispatch({id:1,method:'tools/list'})).result.tools.find(t=>t.name===name);
  assert.equal(tool.annotations.readOnlyHint,true);assert.deepEqual(tool.inputSchema.required,['kreamId']);
});
test('exact displayed values and inputs survive; stock and profit remain unverified',async()=>{
  const calls=[];
  const r=await dispatchBackground(request({kreamId:'797025'}),{request:async(cmd,args)=>{calls.push([cmd,args]);return {...sample,token:'must-not-leak'};}});
  const body=JSON.parse(r.result.content[0].text);
  assert.equal(r.result.isError,false);assert.equal(body.data.rows[0].marginRateText,'50.2%');assert.equal(body.data.inputs.purchasePrice,100000);
  assert.equal(body.sourceAvailabilityVerified,false);assert.equal(body.actualProfitVerified,false);assert.equal(body.purchaseAuthorized,false);
  assert.equal(JSON.stringify(body).includes('must-not-leak'),false);
  assert.deepEqual(calls,[['market:kream:displayed-schema',{productCode:'797025'}]]);
});
test('invalid input never dispatches a request',async()=>{
  for(const args of [null,{}, {kreamId:797025},{kreamId:'797025',click:true},{kreamId:'../797025'}]){
    const r=await dispatchBackground(request(args),{request:()=>{throw Error('UNEXPECTED_CALL');}});
    assert.equal(r.result.isError,true);assert.equal(r.result.content[0].text,'NO1_INVALID_PAYLOAD');
  }
});
test('missing table never becomes verified and wrong product cannot be returned',async()=>{
  const missing=await dispatchBackground(request({kreamId:'797025'}),{request:async()=>({available:false,reason:'MATCHING_PRICE_TABLE_NOT_OPEN'})});
  assert.equal(JSON.parse(missing.result.content[0].text).displayedValueVerified,false);
  const wrong=await dispatchBackground(request({kreamId:'797025'}),{request:async()=>({...sample,productCode:'123'})});
  assert.equal(wrong.result.isError,true);
});
test('connector and authentication failures are preserved without fallback',async()=>{
  for(const code of ['NO1_CONNECTOR_UPDATE_REQUIRED','NO1_AUTH_REQUIRED']){
    const r=await dispatchBackground(request({kreamId:'797025'}),{request:async()=>{throw Error(code);}});
    assert.equal(r.result.isError,true);assert.equal(r.result.content[0].text,code);
  }
});
