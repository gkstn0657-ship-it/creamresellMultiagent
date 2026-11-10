import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCommand,projectData} from './chrome-extension/protocol.mjs';
test('new market commands are bounded reads and cannot place orders',()=>{
  validateCommand('market:kream:details',{productCode:'1120286',includeFastDelivery:false});
  validateCommand('market:kream:trades',{productCode:'1120286',cursor:'1'});
  validateCommand('market:kream:askPreviewBatch',{productCode:'1120286',items:[{option:'L',price:340000,isInstant:false}]});
  for(const [cmd,payload] of [['market:kream:details',{productCode:'1',includeFastDelivery:true}],['market:kream:trades',{productCode:'1',cursor:'https://evil.test'}],['market:kream:askPreviewBatch',{productCode:'1',items:Array(4).fill({option:'L',price:1,isInstant:false})}],['market:kream:ask',{productCode:'1'}]])assert.throws(()=>validateCommand(cmd,payload));
});
test('market evidence retains unknowns and drops account data',()=>{
  assert.deepEqual(projectData('market:kream:details',{colorway:'Black',totalSales:3,sizeOptions:[{size:'L',option:'L',lowestNormal:340000,highestBid:null,token:'secret'}],token:'secret'}),{colorway:'Black',totalSales:3,sizeOptions:[{size:'L',option:'L',lowestNormal:340000,highestBid:null}]});
  const result=projectData('market:kream:trades',{items:[{date:'2026-11-09T00:00:00Z',size:'L',price:340000,email:'secret'}],cursor:'1',nextCursor:null,total:1,hasNext:false});
  assert.equal(result.items[0].email,undefined);assert.equal(result.items[0].price,340000);
});
test('settlement preview binds product, option, price and sale type',()=>{
  const request={productCode:'1120286',items:[{option:'L',price:340000,isInstant:false}]};
  const row={productCode:'1120286',option:'L',price:340000,isInstant:false,totalPayout:320000,processingFee:{value:-17000},authenticationFee:{value:-3000},token:'secret'};
  assert.equal(projectData('market:kream:askPreviewBatch',{previews:[row],failures:[]},request).previews[0].token,undefined);
  assert.throws(()=>projectData('market:kream:askPreviewBatch',{previews:[{...row,productCode:'999'}],failures:[]},request),/IDENTITY/);
});
