import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {syncQualifiedProducts} from './qualified-products.mjs';

const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'cream-qualified-'));
function fixture(root,{workId='work-11111111-1111-1111-1111-111111111111',runId='batch-one',productId='123',canonicalProductId=productId,platform='kream',marketProductId=productId,sourceId='777',at='2026-11-11T01:00:00.000Z'}={}){
 const order={id:workId,createdAt:at,entries:[{runId,productCount:1,at}]};const dir=path.join(root,'work-orders');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,workId+'.json'),JSON.stringify(order));
 const batch=path.join(root,runId);fs.mkdirSync(batch,{recursive:true});fs.writeFileSync(path.join(batch,'batch-state.json'),JSON.stringify({status:'complete',finishedAt:at,results:[{productId,status:'complete',assessment:{decision:'adopt',reviewId:'review-1',at,reason:'통과\n근거 | 안전'},qualification:{passed:true,canonicalProductId,eligibleOptions:[{platform,marketProductId,size:'L',stock:4,expectedSales30d:7}]},marketSchemas:[{sourceUrl:`https://www.musinsa.com/products/${sourceId}`}]}]}));
 return {workId,runId};
}

test('qualified registry backfills passed reviews, writes links and deduplicates a canonical product',()=>{
 const root=temp();fixture(root);const second=fixture(root,{workId:'work-22222222-2222-2222-2222-222222222222',runId:'batch-two',productId:'poizon-99',canonicalProductId:'123',platform:'poizon',marketProductId:'99',sourceId:'778',at:'2026-11-12T01:00:00.000Z'});
 const registry=syncQualifiedProducts(root,{now:()=>new Date('2026-11-12T02:00:00Z')});assert.equal(registry.total,1);assert.deepEqual(registry.products[0].platforms,['kream','poizon']);assert.equal(registry.products[0].evidence.length,2);assert.equal(registry.products[0].purchaseAuthorized,false);
 const markdown=fs.readFileSync(path.join(root,'qualified-products.md'),'utf8');assert.match(markdown,/KREAM 123/);assert.match(markdown,/POIZON 99/);assert.match(markdown,/musinsa\.com\/products\/777/);assert.doesNotMatch(markdown,/\n근거 \|/);
 fs.rmSync(path.join(root,'work-orders',second.workId+'.json'));fs.rmSync(path.join(root,second.runId),{recursive:true});const preserved=syncQualifiedProducts(root,{now:()=>new Date('2026-11-13T02:00:00Z')});assert.deepEqual(preserved.products[0].poizonProductIds,['99']);
});

test('registry excludes held, unreviewed and failed-qualification rows',()=>{
 const root=temp(),{runId}=fixture(root),file=path.join(root,runId,'batch-state.json'),state=JSON.parse(fs.readFileSync(file));
 state.results.push({...state.results[0],productId:'124',qualification:{...state.results[0].qualification,canonicalProductId:'124',passed:false}});state.results.push({...state.results[0],productId:'125',assessment:{decision:'hold',reviewId:'review-2'},qualification:{...state.results[0].qualification,canonicalProductId:'125'}});state.results.push({...state.results[0],productId:'126',assessment:{decision:'adopt'},qualification:{...state.results[0].qualification,canonicalProductId:'126'}});fs.writeFileSync(file,JSON.stringify(state));
 assert.equal(syncQualifiedProducts(root).total,1);
});

test('legacy passed rows without platform fields remain linked as KREAM products',()=>{
 const root=temp(),{runId}=fixture(root),file=path.join(root,runId,'batch-state.json'),state=JSON.parse(fs.readFileSync(file));delete state.results[0].qualification.canonicalProductId;delete state.results[0].qualification.eligibleOptions[0].platform;delete state.results[0].qualification.eligibleOptions[0].marketProductId;fs.writeFileSync(file,JSON.stringify(state));
 const product=syncQualifiedProducts(root).products[0];assert.deepEqual(product.kreamProductIds,['123']);assert.equal(product.eligibleOptions[0].size,'L');
});
