import test from 'node:test';import assert from 'node:assert/strict';import {resultDetails} from './result-data.mjs';
test('result options retain unknowns, observed fee basis and estimated sales without mixing unbound sizes',()=>{
 const row={sourceOptionMatched:true,size:'M',stockQuantity:null,expectedSales30d:12,salesIsEstimated:true,margins:{normal:{marginAmount:1500,marginRate:3,feeBasis:'observed',feeSettingsVerified:true},instant:{marginAmount:null,marginRate:null},desired:{marginAmount:999999}}};
 const d=resultDetails({observations:[{payload:{rankingSource:{productName:'fixture',productUrl:'https://www.musinsa.com/products/1'}}}],assessment:{unresolved:['FEES_UNKNOWN'],marketSchemas:[{observedAt:'2026-11-26T01:00:00Z',rows:[row,{...row,sourceOptionMatched:false,size:'L'}]}]}});
 assert.equal(d.name,'fixture');assert.equal(d.options.length,1);assert.equal(d.options[0].stock,null);assert.equal(d.options[0].salesEstimated,true);assert.equal(d.options[0].margins.length,2);assert.equal(d.options[0].margins[1].amount,null);assert.equal(d.options[0].margins[0].feeBasis,'observed');
});
