import test from 'node:test';import assert from 'node:assert/strict';
import {searchMusinsa} from './source-search.mjs';
import {collectCandidate,sourceOptionColor,sameColor} from './discovery-collector.mjs';
import {candidateFromItem} from './discovery-policy.mjs';
import {evidenceGaps} from './store.mjs';
const html=q=>'<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{dehydratedState:{queries:[{queryKey:['search','goods',{keyword:q}],state:{data:{pages:[{items:[{goodsNo:123,goodsName:q}],pagination:{hasNext:false}}]}}}]}}}})+'</script>';
test('normal Musinsa gender redirect succeeds without allowing a host/query change',async()=>{
 const visited=[];const result=await searchMusinsa('ABC',{fetcher:async(url)=>{visited.push(url);return visited.length===1?new Response(null,{status:307,headers:{location:'/search/goods?keyword=ABC&gf=A'}}):new Response(html('ABC'));}});
 assert.equal(result.items[0].productUrl,'https://www.musinsa.com/products/123');assert.equal(result.redirects,1);
 for(const location of ['https://evil.test/search/goods?keyword=ABC','/search/goods?keyword=OTHER','http://www.musinsa.com/search/goods?keyword=ABC']){let calls=0;await assert.rejects(searchMusinsa('ABC',{fetcher:async()=>{calls++;return new Response(null,{status:307,headers:{location}});}}),/REDIRECT_FORBIDDEN/);assert.equal(calls,1);}
});
test('network errors retain safe cause codes and redirect loops terminate',async()=>{
 await assert.rejects(searchMusinsa('ABC',{fetcher:async()=>{throw new TypeError('fetch failed',{cause:{code:'ECONNRESET',message:'private'}});}}),/SOURCE_SEARCH_NETWORK_ECONNRESET/);
 await assert.rejects(searchMusinsa('ABC',{fetcher:async()=>new Response(null,{status:307,headers:{location:'?keyword=ABC'}})}),/REDIRECT_LOOP/);
});
const candidate=()=>candidateFromItem({productCode:'1',brandProductCode:'MODEL-1',titleKo:'shoe',titleEn:'',totalSales:1,wishCount:1},{cursor:'1',rank:1,observedAt:new Date().toISOString()});
test('single-axis sizes never become colors; only explicit exact-model color text can bind',()=>{
 const option={firstOption:'270',size:'270'};
 assert.equal(sourceOptionColor({makerNumber:'ABC',name:'shoe'},option),null);
 assert.equal(sourceOptionColor({makerNumber:'ABC',name:'shoe - WHITE / OTHER'},option),null);
 assert.equal(sameColor(sourceOptionColor({makerNumber:'ABC',name:'shoe - 화이트 / ABC'},option).value,'WHITE'),true);
});
test('unbound real quotes are reported as option/freshness gaps, not missing purchase evidence',()=>{
 const now=Date.now(),store={data:{observations:[{kind:'source_quote',mode:'live',observedAt:new Date(now-601000).toISOString(),active:true,payload:{}}],calculations:[]}};
 const gaps=evidenceGaps(store,now);assert.ok(gaps.includes('SOURCE_OPTION_BINDING_UNVERIFIED'));assert.ok(gaps.includes('OBSERVATION_STALE'));assert.ok(!gaps.includes('LIVE_PRODUCT_EVIDENCE_MISSING'));
});
test('valid source quotes survive unverified color/size; errors and empty offers are immutable evidence',async()=>{
 const calls=[];const client={status:async()=>({connectorVersion:'0.5.0'}),request:async(cmd)=>{calls.push(cmd);
 if(cmd==='market:kream:prices')return {prices:[{size:'US 9',option:'US 9',sellPrice:100,buyPrice:110}]};
 if(cmd==='market:kream:details')throw Error('NO1_INVALID_RESPONSE');
 if(cmd==='stock:check')return {makerNumber:'MODEL-1',productNumber:'123',price:80,combinedOptions:[{firstOption:'270',size:'270',limitedQty:2}]};
 if(cmd==='musinsa:product:benefit')return {productId:'123',styleNo:'MODEL-1',salePrice:80,maxBenefitPrice:70};
 if(cmd==='market:kream:trades')return {items:[],hasNext:false};throw Error(cmd);
 }};
 const p=await collectCandidate(candidate(),{client,search:async()=>({items:[{productUrl:'https://www.musinsa.com/products/123'}],hasNext:false}),mode:'fixture'});
 assert.equal(p.offers.length,0);assert.equal(p.sourceQuotes.length,1);assert.equal(p.observations.find(x=>x.kind==='source_quote').payload.benefits.maxBenefitPrice,70);
 assert.equal(p.observations.find(x=>x.kind==='market_overview').payload.prices.length,1);
 assert.equal(calls.filter(x=>x==='market:kream:details').length,1);assert.equal(p.observations.find(x=>x.kind==='collection_summary').payload.offers.length,0);
});
test('no source means no deep trade collection and explicit failure evidence, never fake zero profit',async()=>{
 const calls=[];const p=await collectCandidate(candidate(),{mode:'fixture',client:{request:async cmd=>{calls.push(cmd);return cmd.endsWith('prices')?{prices:[]}:{colorway:null,sizeOptions:[]};}},search:async()=>{throw Error('SOURCE_SEARCH_HTTP_503');}});
 assert.equal(calls.some(x=>x.includes('trades')),false);assert.ok(p.observations.some(x=>x.kind==='source_search_error'));
 assert.ok(p.gaps.includes('deepMarketCollectionDeferredUntilSourceFound'));assert.equal(p.collectionStatus,'partial');
});

test('matched discovery offers name the actual feed provenance rather than an official-page lookup',async()=>{
 const packet=await collectCandidate(candidate(),{mode:'fixture',search:async()=>({items:[{productUrl:'https://www.musinsa.com/products/123'}],hasNext:false}),
 client:{request:async cmd=>{
  if(cmd.endsWith('prices'))return {prices:[{size:'L',option:'L'}]};
  if(cmd.endsWith('details'))return {colorway:'BLACK'};
  if(cmd==='stock:check')return {makerNumber:'MODEL-1',productNumber:'123',combinedOptions:[{firstOption:'BLACK',size:'L',limitedQty:1}]};
  return {productId:'123',styleNo:'MODEL-1'};
 }},collect:async request=>({request,identity:{marketBinding:'old official-page claim'},missingFields:[],observedAt:new Date().toISOString()})});
 const payload=packet.observations.find(x=>x.kind==='no1_product').payload;
 assert.equal(packet.offers.length,1);assert.equal(payload.marketIdentityEvidence.source,'no1-kream-popularity-response');
 assert.match(payload.identity.marketBinding,/not separate official-page verification/);
});
