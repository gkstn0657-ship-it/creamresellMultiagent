import test from 'node:test';import assert from 'node:assert/strict';
import {lookupReference} from './reference-lookup.mjs';
const args={kreamId:'797025',model:'27103207',sourceSize:'230'};
const url='https://www.musinsa.com/products/7325399';
function fixture({stockQuantity=0,duplicate=false}={}){
 const calls=[],stock={makerNumber:args.model,productNumber:'7325399',name:'reference fixture',combinedOptions:[{size:'230',firstOption:'230',limitedQty:stockQuantity,isAvailable:stockQuantity>0}]};
 if(duplicate)stock.combinedOptions.push({...stock.combinedOptions[0],firstOption:'other'});
 return {calls,client:{status:async()=>({connectorVersion:'0.6.0'}),request:async(cmd)=>{calls.push(cmd);return cmd==='market:margin-settings'?{source:'no1_web_saved_settings',feePercent:6,inspectionFee:2500,taxMode:false}:structuredClone(stock);}},
 search:async()=>({items:[{productUrl:url,soldOut:true}],hasNext:false}),
 probe:async(client,request)=>{await client.request('stock:check',{url});return {request,observedAt:new Date().toISOString(),queryStatus:'partial',errors:{market:'NO1_PLATFORM_LOGIN_REQUIRED'},benefits:{productId:'7325399',styleNo:args.model,maxBenefitPrice:164680},identity:{sourceProductVerified:true,sourceOptionVerified:true},stock:{selectedStockQuantity:stockQuantity}};}};
}
test('sold-out exact source survives and repeated stock read is cached; auth failure remains partial',async()=>{
 const f=fixture(),r=await lookupReference(args,f);assert.equal(r.status,'partial');assert.equal(r.source.stockQuantity,0);assert.equal(r.benefitPrice,164680);assert.equal(r.errors.market,'NO1_PLATFORM_LOGIN_REQUIRED');assert.equal(r.schema.displayedValueVerified,false);assert.equal(r.schema.inputs.feePercent,6);assert.equal(r.purchaseAuthorized,false);assert.deepEqual(f.calls,['stock:check','market:margin-settings']);
});
test('ambiguous merchant options are not selected',async()=>{const r=await lookupReference(args,fixture({duplicate:true}));assert.equal(r.error,'REFERENCE_SOURCE_AMBIGUOUS');assert.equal(r.observation,undefined);});
test('model mismatch and absent source do not become zero price or profitability verdict',async()=>{
 const f=fixture();f.client.request=async()=>({makerNumber:'WRONG',productNumber:'7325399',combinedOptions:[]});const r=await lookupReference(args,f);assert.equal(r.error,'REFERENCE_SOURCE_NOT_FOUND');assert.equal(r.benefitPrice,undefined);
});
test('invalid requests and off-domain source URLs are rejected',async()=>{
 await assert.rejects(lookupReference({...args,click:true},fixture()),/NO1_INVALID_PAYLOAD/);const f=fixture();f.search=async()=>({items:[{productUrl:'https://example.com/7325399'}]});await assert.rejects(lookupReference(args,f),/SOURCE_URL_INVALID/);
});
