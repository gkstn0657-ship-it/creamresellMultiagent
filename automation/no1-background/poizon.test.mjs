import test from 'node:test';import assert from 'node:assert/strict';
import {validateCommand,projectData} from './chrome-extension/protocol.mjs';
import {readPoizonMarginSettings} from './chrome-extension/poizon-data.mjs';
test('Poizon permits bounded read-only commands and rejects actions and extra payload fields',()=>{
 for(const [cmd,p] of [['search',{keyword:'27103207',cursor:'1'}],['prices',{spuId:'123',styleCode:'27103207'}],['chart',{spuId:'123',skuId:'456',range:1,saleRegion:'GLOBAL'}],['margin-settings',{}],['displayed-schema',{spuId:'123'}]])assert.doesNotThrow(()=>validateCommand('market:poizon:'+cmd,p));
 assert.throws(()=>validateCommand('market:poizon:bid',{}),/FORBIDDEN/);
 assert.throws(()=>validateCommand('market:poizon:prices',{spuId:'123',styleCode:'X',accountId:'private'}),/PAYLOAD/);
 assert.throws(()=>validateCommand('market:poizon:chart',{spuId:'1',skuId:'2',range:99,saleRegion:'GLOBAL'}),/PAYLOAD/);
});
test('Poizon projection removes credentials and rejects mismatched price identity',()=>{
 const req={spuId:'1',styleCode:'MODEL'},data={product:{spuId:'1',styleCode:'MODEL',token:'secret'},isApparel:false,sizes:[{skuId:'2',sizeKR:'230',cnBuyBox:130000,salesCount:'12',localSalesCount:'3',cookie:'secret'}]};
 const clean=projectData('market:poizon:prices',data,req);assert.equal(clean.sizes[0].cnBuyBox,130000);assert.doesNotMatch(JSON.stringify(clean),/secret|cookie|token/);assert.deepEqual(projectData('market:poizon:prices',clean,req),clean);
 assert.throws(()=>projectData('market:poizon:prices',data,{...req,spuId:'3'}),/IDENTITY/);
 const search=projectData('market:poizon:search',{products:[{spuId:'1',styleCode:'MODEL',bidStatus:1}],nextCursor:null},{});assert.equal(search.products[0].bidStatus,1);
});
test('Poizon reads category fees and its separate tax setting without KREAM tax contamination',()=>{
 const old={location:globalThis.location,localStorage:globalThis.localStorage};
 globalThis.location={origin:'https://no1.certi.life',pathname:'/sourcing/'};
 globalThis.localStorage={getItem:k=>({'priceCompareFee.v2':JSON.stringify({schemaVersion:4,poizon:{category:'goods',goods:{rate:'14',minFee:'18000',maxFee:'45000'}}}),'market:taxMode':'true','market:poizonTaxMode':'false'})[k]||null};
 try{const d=projectData('market:poizon:margin-settings',readPoizonMarginSettings());assert.equal(d.taxMode,false);assert.equal(d.fees.goods.rate,14);assert.equal(d.fees.apparelShoes.minFee,15000);}finally{for(const [k,v]of Object.entries(old)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
test('Poizon chart retains SKU/region scope and does not treat other platform auth as valid',()=>{
 const p={spuId:'1',skuId:'2',range:1,saleRegion:'GLOBAL'},d=projectData('market:poizon:chart',{chart:[{date:'2026-11-10',price:100000,count:2}],meta:{symbol:'₩',salesCount:'2'}},p);assert.deepEqual(d.request,p);
 assert.throws(()=>projectData('platform:status',{sessions:[{platform:'kream',status:'active'}]},{platform:'poizon'}),/RESPONSE/);
});
