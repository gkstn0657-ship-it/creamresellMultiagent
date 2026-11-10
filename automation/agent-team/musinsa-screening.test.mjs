import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {EventEmitter} from 'node:events';
import {recentSales,musinsaSignals,saveMusinsaSignals,readSavedMusinsaSignals} from './musinsa-signals.mjs';
import {control,runDirectory} from './control-mcp.mjs';
import {startWork} from './work-orders.mjs';
import {runBatch} from './batch.mjs';
import {runTeam} from './run.mjs';
import {TeamStore} from './store.mjs';import {TeamTools} from './tools.mjs';
import {MUSINSA_PROFILE,MUSINSA_OWNER,MUSINSA_MESSAGE} from './analysis-profiles.mjs';
const now=Date.parse('2026-11-10T09:00:00Z'),day=86400000;
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'cream-musinsa-screening-'));
const seed={kreamId:'123',productUrl:'https://www.musinsa.com/products/456',model:'ABC',color:'BLACK',option:'L'};
const trade=(days,price=100,size='L')=>({date:new Date(now-days*day).toISOString(),price,size});
const trades={windowEnd:new Date(now).toISOString(),coverageComplete:true,issues:[],items:[trade(1,120),trade(2,100),trade(3,90,'M'),trade(8,80)]};
function observation(){return {id:'obs-1',kind:'no1_product',mode:'fixture',observedAt:new Date(now).toISOString(),payload:{request:seed,identity:{sourceProductVerified:true,sourceModelVerified:true,sourceOptionVerified:true},benefits:{productId:'456',styleNo:'ABC',maxBenefitPrice:50000},stock:{selectedStockQuantity:0,selectedOption:{isAvailable:false}},marketResearch:{details:{sizeOptions:[{size:'L',option:'L',lowestNormal:80000,highestBid:60000},{size:'M',option:'M',lowestNormal:90000}]},marginSettings:{source:'no1_web_saved_settings',feePercent:6,inspectionFee:2500,taxMode:false},trades,sales30d:{productCode:'123',stage:'final',mode:'estimated',perSize:{L:{estimated30d:20},M:{estimated30d:100}},cacheInfo:{fetchedAt:new Date(now).toISOString(),state:'fresh'}}}}};}
test('recent trend compares the same size in two disjoint seven-day windows',()=>{
  const r=recentSales(trades,'L');assert.equal(r.last7d.observedCount,2);assert.equal(r.previous7d.observedCount,1);
  assert.equal(r.last7d.medianPrice,110);assert.equal(r.medianPriceChange,30);assert.equal(r.direction,'increasing');
  assert.equal(recentSales({...trades,items:[trade(7),trade(14)]},'L').previous7d.observedCount,1);
});
test('partial, invalid and repeated records cannot imply falling demand or a complete price trend',()=>{
  for(const t of [{...trades,coverageComplete:false},{...trades,issues:['repeated_page']},{...trades,items:[...trades.items,{date:'bad',price:1,size:'L'}]}]){
    const r=recentSales(t,'L');assert.equal(r.status,'observed_only');assert.equal(r.direction,null);assert.equal(r.medianPriceChange,null);
  }
  assert.equal(recentSales({...trades,coverageComplete:false,items:[...trades.items,trade(15)]},'L').status,'complete');
  assert.equal(recentSales(null,'L').status,'unavailable');
});
test('three signals keep stock zero, unknown, estimates and unmatched sizes distinct',()=>{
  const o=observation(),s=musinsaSignals([o])[0];
  assert.equal(s.stock.quantity,0);assert.equal(s.stock.available,false);assert.equal(s.rows[0].margins.normal.amount,22700);
  assert.equal(s.rows[0].sales30d.count,20);assert.equal(s.rows[0].sales30d.estimated,true);assert.equal(s.rows[0].recent.last7d.observedCount,2);
  assert.equal(s.rows[1].referenceOnly,true);assert.equal(s.marketModelVerified,false);
  delete o.payload.stock.selectedStockQuantity;assert.equal(musinsaSignals([o])[0].stock.quantity,null);
  const error={id:'error-1',kind:'collection_error',observedAt:new Date(now+1).toISOString(),payload:{request:seed,code:'NO1_AUTH_REQUIRED'}};
  assert.equal(musinsaSignals([o,error])[0].status,'collection_failed');assert.deepEqual(musinsaSignals([o,error])[0].rows,[]);
});
test('Musinsa entry point requires N scope and persists a profile distinct from general batches',async()=>{
  const root=temp(),options={root,launch:async()=>({launched:true})};
  await assert.rejects(control('cream_musinsa_batch_start',{products:[seed]},options),/USER_WORK_SCOPE_REQUIRED/);
  startWork(root,{targetProducts:1,userInstruction:'test one',requestId:'test'});
  const r=await control('cream_musinsa_batch_start',{products:[seed],requestId:'one'},options);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runDirectory(r.runId,root),'launch.json'),'utf8')).analysisProfile,MUSINSA_PROFILE);
  await assert.rejects(control('cream_batch_start',{products:[seed],requestId:'one'},options),/PROFILE_CONFLICT/);
});
test('batch passes the focused mission and message and cannot reuse a different profile on resume',async()=>{
  const dir=temp();let mission;
  await runBatch({dir,seeds:[seed],analysisProfile:MUSINSA_PROFILE,mode:'fixture',collect:async()=>observation().payload,
    analyze:async args=>{mission=args.mission;assert.equal(args.message,MUSINSA_MESSAGE);return {status:'complete',assessment:{decision:'hold'}};}});
  assert.equal(mission.analysisProfile,MUSINSA_PROFILE);
  await assert.rejects(runBatch({dir,seeds:[seed],resume:true}),/PROFILE_CHANGED/);
});
test('focused tools provide signals and reject repeated collection while general mode remains available',async()=>{
  const store=new TeamStore(temp(),{product:seed,analysisProfile:MUSINSA_PROFILE});store.observe('no1_product',observation().payload,{mode:'fixture'});
  const tools=new TeamTools(store);const signals=await tools.execute({tool:'read_musinsa_signals',threadId:'owner'});assert.equal(signals[0].rows[0].sales30d.count,20);
  const state=await tools.execute({tool:'team_state',threadId:'owner'});assert.ok(state.primarySignals);assert.equal(state.margins,undefined);
  for(const tool of ['collect_no1','investigate'])await assert.rejects(tools.execute({tool,threadId:'owner'}),/MUSINSA_SCREENING_PACKET_ONLY/);
});
test('actual team setup selects focused instructions and disables exploratory agent tools',async()=>{
  let launch;
  class FakeServer extends EventEmitter {
    config={};async start(){} async close(){}
    async startThread(options){launch=options;return {thread:{id:'focused-owner'}};}
    async runTurn(){throw Error('TEST_END_AFTER_THREAD_SETUP');}
  }
  await assert.rejects(runTeam({dir:temp(),mission:{product:seed,analysisProfile:MUSINSA_PROFILE},serverFactory:()=>new FakeServer()}),/TEST_END_AFTER_THREAD_SETUP/);
  assert.equal(launch.instructions,MUSINSA_OWNER);assert.equal(launch.config['agents.enabled'],false);
  assert.ok(launch.tools.some(t=>t.name==='request_review'));assert.ok(launch.tools.some(t=>t.name==='read_musinsa_signals'));
  assert.ok(!launch.tools.some(t=>['collect_no1','investigate'].includes(t.name)));
});
test('reviewer can read saved numeric derivations with immutable source IDs and original timestamps',async()=>{
  const store=new TeamStore(temp(),{product:seed,analysisProfile:MUSINSA_PROFILE});
  const source=store.observe('no1_product',observation().payload,{mode:'replay',observedAt:new Date(now).toISOString()});
  const derived=saveMusinsaSignals(store);assert.deepEqual(derived.payload.sourceIds,[source.id]);assert.equal(derived.observedAt,source.observedAt);assert.equal(derived.mode,'replay');
  assert.equal(derived.payload.signals[0].rows[0].recent.last7d.observedCount,2);assert.equal(saveMusinsaSignals(store).id,derived.id);
  assert.equal(readSavedMusinsaSignals(store)[0].calculationObservationId,derived.id);
  store.data.actors.push({threadId:'reviewer',role:'reviewer'});
  const tools=new TeamTools(store);assert.equal((await tools.execute({tool:'read_observation',threadId:'reviewer',arguments:{id:derived.id}})).id,derived.id);
  store.observe('collection_error',{request:seed,code:'FAILED'},{mode:'replay',observedAt:new Date(now+1).toISOString()});
  const next=saveMusinsaSignals(store);assert.notEqual(next.id,derived.id);assert.equal(derived.active,false);assert.equal(next.payload.signals[0].status,'collection_failed');
});
