import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {POPULAR_BRANDS,buildBrandPlan,validateBrandPlan} from './brand-ranking-plan.mjs';
import {startWork,workOrders} from './work-orders.mjs';
import {runMusinsaProfitSearch} from './musinsa-profit-runner.mjs';
const feeds=()=>POPULAR_BRANDS.slice(0,2).map((brand,b)=>({brand,url:`https://api.musinsa.com/api2/dp/v1/brand/flagship/${brand.id}/ranking-goods?sortCode=REALTIME&size=50`,data:{data:{goodsList:Array.from({length:51},(_,i)=>({goodsNo:100*b+i+1,goodsName:'product',linkUrl:`https://www.musinsa.com/products/${100*b+i+1}`}))}}}));
test('brand top 50 preserves order and provenance, excludes history without filling with rank 51',()=>{
 const p=validateBrandPlan(buildBrandPlan(feeds(),{seenSourceIds:['1','102']}));
 assert.equal(p.products.length,98);assert.equal(p.previouslyChecked.length,2);assert.equal(p.products[0].brandRank,2);assert.equal(p.products[49].productId,'101');
 assert.ok(!p.products.some(p=>p.productId==='51'||p.productId==='151'));
 const bad=feeds();bad[0].data.data.goodsList[1]=bad[0].data.data.goodsList[0];assert.throws(()=>buildBrandPlan(bad),/INVALID_BRAND_PRODUCT/);
 const short=feeds();short[0].data.data.goodsList.length=2;assert.equal(buildBrandPlan(short).brands[0].shortfall,48);
});
test('brand work executes only frozen sources without querying general ranking or overwriting its cursor',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-brand-')),f=feeds().slice(0,1);f[0].data.data.goodsList.length=2;
 const plan=buildBrandPlan(f),args={targetSources:2,sourcePlan:plan,userInstruction:'brand top 50',requestId:'brand'};
 const w=startWork(root,args);assert.equal(workOrders(root)[0].source,'musinsa-brand-ranking');
 assert.throws(()=>startWork(root,{...args,sourcePlan:{...plan,observedAt:'changed'}}),/SCOPE_CONFLICT/);
 const dir=path.join(root,'musinsa-discovery');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({seenSourceIds:[],seenKreamIds:[],contexts:{general:{categoryIndex:3}}}));
 const calls=[];const result=await runMusinsaProfitSearch({root,workId:w.workId,client:{request:()=>assert.fail('must not query general ranking')},collect:async s=>{calls.push(s);return {status:'skipped',reason:'NO_AVAILABLE_STOCK'};}});
 assert.equal(result.status,'complete');assert.equal(result.checkedSources,2);assert.equal(calls[0].brandRank,1);assert.equal(calls[0].source,'musinsa-brand-ranking');
 const saved=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));assert.equal(saved.contexts.general.categoryIndex,3);assert.deepEqual(saved.seenSourceIds,['1','2']);
});
