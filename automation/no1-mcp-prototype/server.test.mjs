import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dispatch,validateArgs,validateEvidence,parseDataAsOf} from './server.mjs';
const args={kreamId:'280933',model:'MM00313KM0307-P199'};
test('initialize',async()=>assert.equal((await dispatch({id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}})).result.protocolVersion,'2024-11-05'));
test('only read tool exposed',async()=>assert.deepEqual((await dispatch({id:1,method:'tools/list'})).result.tools.map(x=>x.name),['no1_read_price_comparison']));
test('live access defaults off',async()=>assert.match((await dispatch({id:1,method:'tools/call',params:{name:'no1_read_price_comparison',arguments:args}})).result.content[0].text,/LIVE_ACCESS_DISABLED/));
test('unknown transaction tool rejected',async()=>assert.equal((await dispatch({id:1,method:'tools/call',params:{name:'purchase'}})).error.code,-32602));
test('other identity rejected',()=>assert.throws(()=>validateArgs({...args,kreamId:'756827'})));
test('arbitrary command rejected',()=>assert.throws(()=>validateArgs({...args,command:'anything'})));
test('unknown values rejected',()=>assert.throws(()=>validateEvidence({kreamId:'280933',model:args.model,volumeLabel:'30일 예상 거래량',sizes:[{size:'L',estimatedTrades30d:null,instantBidKrw:112000}]})));
test('fixture replay is explicit and remains hold',()=>{const input=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'no1_read_price_comparison',arguments:args}})+'\n';const r=spawnSync(process.execPath,[new URL('./server.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),'--fixture'],{input,encoding:'utf8'});assert.equal(r.status,0);const result=JSON.parse(r.stdout);assert.equal(result.result.isError,false);const e=JSON.parse(result.result.content[0].text);assert.equal(e.mode,'fixture');assert.equal(e.freshEvidence,false);assert.equal(e.decision,'hold');assert.equal(e.promotionAllowed,false);assert.equal(e.sizes.find(x=>x.size==='L').instantBidKrw,112000);});

test('data time parsed separately from capture',()=>assert.equal(parseDataAsOf('오늘 16:47기준 최신','2026-11-09T08:00:47Z'),'2026-11-09T07:47:00.000Z'));
test('missing or future data time fails closed',()=>{assert.equal(parseDataAsOf(null,'2026-11-09T08:00:47Z'),null);assert.equal(parseDataAsOf('오늘 18:47기준 최신','2026-11-09T08:00:47Z'),null)});