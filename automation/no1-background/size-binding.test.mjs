import test from 'node:test';import assert from 'node:assert/strict';
import {matchMarketSize,sizeKey} from './size-binding.mjs';
const args={stock:{makerNumber:'1174671-CHE',name:'[MEN] 타스만 II - 체스넛 / 1174671-CHE'},productUrl:'https://www.musinsa.com/products/5331557',kreamId:'574093',sourceSize:'250',prices:[{size:'US 7',option:'US 7'}],now:Date.parse('2026-11-10T06:00:00Z')};
test('scoped official chart binds an inspected model and preserves provenance',()=>{
 const r=matchMarketSize(args);assert.equal(r.price.option,'US 7');assert.equal(r.evidence.kind,'scoped-manufacturer-chart');assert.match(r.evidence.chartUrl,/www.ugg.com/);
});
test('a chart never transfers to a different model, merchant, gender, product or width',()=>{
 for(const change of [{kreamId:'1'},{productUrl:'https://www.musinsa.com/products/1'},{stock:{...args.stock,makerNumber:'1174671-OTHER'}},{stock:{...args.stock,name:'[WOMEN] Tasman'}},{prices:[{size:'US 7EEE'}]},{now:args.now+91*86400000}])assert.equal(matchMarketSize({...args,...change}),null);
});
test('ambiguous equal labels fail and size qualifiers remain meaningful',()=>{
 assert.equal(sizeKey('L (100)'),'L');assert.notEqual(sizeKey('US 9 (W)'),sizeKey('US 9 (M)'));
 assert.equal(matchMarketSize({...args,sourceSize:'270',prices:[{size:'270',option:'a'},{size:'270',option:'b'}]}),null);
 assert.equal(matchMarketSize({...args,stock:{makerNumber:'unknown'},sourceSize:'270'}),null);
 assert.equal(matchMarketSize({...args,sourceSize:'L(100)',prices:[{size:'L',option:'L'}]}).evidence.kind,'same-size-label');
});
