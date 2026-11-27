import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {exclusionFacts} from './exclusion-facts.mjs';
import {diagnoseCases,savedExclusionCases} from './exclusion-agent.mjs';

const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-exclusion-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const dir=path.join(root,'batch-11111111-1111-1111-1111-111111111111'),source={productId:'1',productName:'sample',rank:3,productUrl:'https://www.musinsa.com/products/1'},row={sourceId:'1',status:'skipped',reason:'NO_MARKET_QUALIFYING_OPTION'};write(path.join(dir,'sources.json'),[source]);write(path.join(dir,'source-state.json'),{results:[row]});const evidence=path.join(dir,'source-evidence','1');write(path.join(evidence,'1.json'),{cmd:'stock:check',payload:{url:source.productUrl},data:{makerNumber:'M1',combinedOptions:[{firstOption:'BLACK',size:'L',limitedQty:2}]}});write(path.join(evidence,'2.json'),{cmd:'mecro:inventory:search',payload:{keyword:'M1',cursor:'1'},data:{items:[],nextCursor:null}});write(path.join(evidence,'3.json'),{cmd:'market:poizon:search',payload:{keyword:'M1',cursor:'1'},data:{products:[],nextCursor:null}});return {root,dir,source,row};}
test('saved evidence reconstructs both market causes without calling a source',t=>{
 const f=fixture(t),facts=exclusionFacts(f.dir,f.source,f.row);assert.equal(facts.kream.code,'EXACT_MARKET_MODEL_NOT_FOUND');assert.equal(facts.poizon.code,'POIZON_EXACT_MODEL_NOT_FOUND');assert.equal(facts.confidence,'reconstructed-from-saved-evidence');assert.equal(facts.evidenceIds.length,3);
 const recorded=exclusionFacts(f.dir,f.source,{...f.row,marketChecks:{kream:{reason:'AVAILABLE_OPTION_NOT_BOUND'},poizon:{reason:'POIZON_AVAILABLE_OPTION_NOT_BOUND'}}});assert.equal(recorded.kream.code,'AVAILABLE_OPTION_NOT_BOUND');assert.equal(recorded.confidence,'recorded');assert.notEqual(recorded.basisHash,facts.basisHash);
});
test('diagnostic agent must read the current case before saving a basis-bound explanation',async t=>{
 const f=fixture(t),outDir=path.join(f.root,'diagnostics'),cases=savedExclusionCases([f.dir]);let calls=0;
 const serverFactory=options=>({start:async()=>{},close:async()=>{},startThread:async()=>({thread:{id:'reviewer'},model:'gpt-6.1-sol'}),runTurn:async()=>{
  calls++;const args={sourceId:'1',basisHash:cases[0].facts.basisHash,summary:'KREAM과 POIZON 모두 저장된 검색 범위에서 동일 제조사 모델을 확인하지 못했습니다.',nextCheck:'새로운 동일 모델 등록이 관측되면 다시 확인합니다.'};
  await assert.rejects(options.onTool({threadId:'reviewer',tool:'record_diagnosis',arguments:args}),/NOT_READ/);
  const facts=await options.onTool({threadId:'reviewer',tool:'read_case',arguments:{sourceId:'1'}});assert.equal(facts.basisHash,args.basisHash);
  await options.onTool({threadId:'reviewer',tool:'record_diagnosis',arguments:args});
 }});
 const result=await diagnoseCases({cases,outDir,serverFactory});assert.equal(result.status,'complete');assert.equal(result.analyzed,1);assert.equal(calls,1);
 await diagnoseCases({cases,outDir,serverFactory});assert.equal(calls,1);
 const saved=JSON.parse(fs.readFileSync(path.join(outDir,'cases','1.json')));assert.equal(saved.agent.model,'gpt-6.1-sol');assert.equal(saved.facts.kream.code,'EXACT_MARKET_MODEL_NOT_FOUND');
});
