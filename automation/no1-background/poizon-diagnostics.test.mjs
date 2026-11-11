import test from 'node:test';import assert from 'node:assert/strict';
import {diagnosePoizonSearch,projectValidationFailure} from './chrome-extension/poizon-diagnostics.mjs';
import {projectData,validateProjectedData} from './chrome-extension/protocol.mjs';
import {projectPoizon} from './chrome-extension/poizon-data.mjs';
test('diagnostics identify rejected fields but never values or arbitrary keys',()=>{
 const secret='PRIVATE_VALUE';const data={products:[{spuId:'123',styleCode:'KS7366',bidStatus:secret,token:secret}]};
 assert.deepEqual(diagnosePoizonSearch(data),{field:'bidStatus',index:0,type:'string',rule:'enum_0_1'});
 assert.ok(!JSON.stringify(diagnosePoizonSearch(data)).includes(secret));
 assert.throws(()=>projectPoizon('market:poizon:search',data,{}),/NO1_INVALID_RESPONSE/);
});
test('malformed search model types, control characters and oversized strings remain fail closed',()=>{
 for(const styleCode of [null,{},'bad\u0000model','x'.repeat(501)]){const d={products:[{spuId:'123',styleCode}]};assert.equal(diagnosePoizonSearch(d).field,'styleCode');assert.throws(()=>projectPoizon('market:poizon:search',d,{}),/NO1_INVALID_RESPONSE/);}
});
test('cursor and container failures identify fixed fields only',()=>{
 assert.equal(diagnosePoizonSearch({products:'PRIVATE_VALUE'}).field,'products');
 assert.equal(diagnosePoizonSearch({products:[],nextCursor:0}).field,'nextCursor');
});
test('session diagnostics survive projections without exposing arbitrary data',()=>{
 const d={command:'market:poizon:search',capturedAt:'2026-11-11T02:00:00.000Z',field:'styleCode',index:0,type:'string',rule:'model_format',value:'PRIVATE_VALUE',token:'PRIVATE_VALUE'};
 const expected=projectValidationFailure(d);
 assert.ok(!JSON.stringify(expected).includes('PRIVATE_VALUE'));
 const clean=projectData('connector:session-status',{distinctSessionCount:1,lastValidationFailure:d});
 assert.deepEqual(clean.lastValidationFailure,expected);
 assert.deepEqual(validateProjectedData('connector:session-status',clean),clean);
 for(const bad of [{field:'PRIVATE_VALUE'},{index:-1},{index:1000},{capturedAt:'PRIVATE_VALUE'},{type:'PRIVATE_VALUE'},{rule:'PRIVATE_VALUE'}])assert.equal(projectValidationFailure({...d,...bad}),null);
});
