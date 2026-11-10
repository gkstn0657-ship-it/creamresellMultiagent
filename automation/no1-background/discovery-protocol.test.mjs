import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCommand,projectData} from './chrome-extension/protocol.mjs';
test('catalog access permits read-only popularity and bounded product matching search',()=>{
 validateCommand('mecro:inventory:search',{keyword:' ',cursor:'1'});
 validateCommand('mecro:inventory:search',{keyword:'27103207',cursor:'1'});
 validateCommand('mecro:inventory:search',{keyword:'마뗑킴 토트백',cursor:'1'});
 for(const cmd of ['mecro:inventory:add','mecro:inventory:start','market:proxy'])assert.throws(()=>validateCommand(cmd,{}));
 for(const p of [{keyword:'x\n',cursor:'1'},{keyword:'a'.repeat(101),cursor:'1'},{keyword:' ',cursor:'1&sort=x'},{keyword:' ',cursor:'1',url:'x'}])assert.throws(()=>validateCommand('mecro:inventory:search',p));
});
test('catalog projection removes unrelated and private fields',()=>{
 const p=projectData('mecro:inventory:search',{items:[{productCode:'123',titleKo:'shoe',titleEn:'shoe',brandProductCode:'ABC',totalSales:10,wishCount:20,token:'secret'}],nextCursor:2});
 assert.equal(p.nextCursor,'2');assert.equal(p.items[0].productCode,'123');assert.ok(!JSON.stringify(p).includes('secret'));
 assert.throws(()=>projectData('mecro:inventory:search',{items:[],nextCursor:'bad'}));
});
