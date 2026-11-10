import test from 'node:test';import assert from 'node:assert/strict';
import {parse29cmSearch,parse29cmProduct,search29cm,quote29cm} from './retailer-29cm.mjs';
import {collectCandidate} from './discovery-collector.mjs';
import {candidateFromItem} from './discovery-policy.mjs';
import {validatePacket} from './packets.mjs';
const productUrl='https://www.29cm.co.kr/products/123',model='MODEL-1';
const product={ '@type':'Product',sku:'123',name:'Shoe / MODEL-1',offers:{'@type':'Offer',url:productUrl,price:120000,priceCurrency:'KRW',availability:'https://schema.org/InStock'}};
const html=p=>`<script type="application/ld+json">${JSON.stringify(p)}</script>`;
test('public product identity needs matching ID, model, canonical offer and currency',()=>{
 const quote=parse29cmProduct(html(product),{productUrl,model});assert.equal(quote.listedPrice,120000);assert.equal(quote.stock,null);assert.equal(quote.actualCheckoutPriceConfirmed,false);
 for(const p of [{...product,sku:'456'},{...product,name:'Similar MODEL-1 shoe'},{...product,mpn:'OTHER'}, {...product,offers:{...product.offers,url:'https://evil.test/'}},{...product,offers:{...product.offers,priceCurrency:'USD'}}])assert.throws(()=>parse29cmProduct(html(p),{productUrl,model}),/SOURCE_29CM_/);
 assert.throws(()=>parse29cmProduct(html([product,product]),{productUrl,model}),/IDENTITY_MISMATCH/);
});
test('public search rejects changed formats and never sends credentials or follows redirects',async()=>{
 assert.throws(()=>parse29cmSearch({meta:{result:'SUCCESS'},data:{}}),/FORMAT_CHANGED/);
 const result=await search29cm(model,{fetcher:async(url,options)=>{
  assert.equal(new URL(url).hostname,'display-bff-api.29cm.co.kr');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
  const body=JSON.parse(options.body);assert.equal(body.keyword,model);assert.equal(body.pageRequest.size,10);
  return Response.json({meta:{result:'SUCCESS'},data:{list:[{itemType:'PRODUCT',itemId:123,itemInfo:{productName:'Shoe',sellPrice:100}}],pagination:{hasNext:false}}});
 }});assert.equal(result.items[0].productUrl,productUrl);
 let called=false;await assert.rejects(quote29cm({productUrl:'https://evil.test/products/123',model},{fetcher:async()=>{called=true;}}),/URL_INVALID/);assert.equal(called,false);
 await assert.rejects(search29cm(model,{fetcher:async()=>new Response('bad',{status:503})}),/HTTP_503/);
});
test('additional merchant quote survives Musinsa failure without inventing an option offer',async()=>{
 const c=candidateFromItem({productCode:'1',brandProductCode:model,titleKo:'shoe',totalSales:1,wishCount:1},{cursor:'1',rank:1,observedAt:new Date().toISOString()});
 const packet=await collectCandidate(c,{mode:'fixture',search:async()=>{throw Error('SOURCE_SEARCH_HTTP_503');},
  client:{request:async cmd=>cmd.endsWith('prices')?{prices:[]}:cmd.endsWith('trades')?{items:[],hasNext:false}:{colorway:null,sizeOptions:[]}},
  additionalRetailers:[{name:'29cm',search:async()=>({items:[{productUrl}],hasNext:false}),quote:async()=>({...parse29cmProduct(html(product),{productUrl,model}),observedAt:new Date().toISOString()})}]});
 validatePacket(packet);assert.equal(packet.offers.length,0);assert.equal(packet.sourceQuotes.length,1);
 assert.ok(packet.gaps.includes('sourceOptionBinding'));assert.ok(!packet.gaps.includes('deepMarketCollectionDeferredUntilSourceFound'));
 assert.deepEqual(packet.observations.find(x=>x.kind==='collection_summary').payload.retailersSearched,['musinsa','29cm']);
});
