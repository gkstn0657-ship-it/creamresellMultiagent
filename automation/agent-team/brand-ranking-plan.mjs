export const POPULAR_BRANDS=[{id:'musinsastandard',name:'무신사 스탠다드'},{id:'musinsastandardwoman',name:'무신사 스탠다드 우먼'},{id:'adidas',name:'아디다스'},{id:'thenorthface',name:'노스페이스'},{id:'nike',name:'나이키'}];
export function buildBrandPlan(feeds,{seenSourceIds=[],perBrand=50,observedAt=new Date().toISOString()}={}){
 if(!Number.isInteger(perBrand)||perBrand<1||perBrand>50)throw Error('INVALID_BRAND_LIMIT');
 const seen=new Set(seenSourceIds),selected=new Set(),products=[],previouslyChecked=[],brands=[];
 for(const {brand,data,url} of feeds){
  if(!POPULAR_BRANDS.some(b=>b.id===brand.id&&b.name===brand.name)||url!==`https://api.musinsa.com/api2/dp/v1/brand/flagship/${brand.id}/ranking-goods?sortCode=REALTIME&size=${perBrand}`)throw Error('INVALID_BRAND_SOURCE');
  if(brands.some(b=>b.id===brand.id)||!Array.isArray(data?.data?.goodsList))throw Error('INVALID_BRAND_FEED');
  const rows=data.data.goodsList.slice(0,perBrand),local=new Set();let reused=0,added=0;
  for(const [index,row] of rows.entries()){
   const id=String(row.goodsNo);
   if(!/^\d{1,12}$/.test(id)||typeof row.goodsName!=='string'||!row.goodsName.trim()||row.linkUrl!==`https://www.musinsa.com/products/${id}`||local.has(id))throw Error('INVALID_BRAND_PRODUCT');
   local.add(id);if(selected.has(id))throw Error('CROSS_BRAND_DUPLICATE');selected.add(id);
   const product={productId:id,productName:row.goodsName,brandName:brand.name,brandId:brand.id,brandRank:index+1,productUrl:row.linkUrl,source:'musinsa-brand-ranking',rankingUrl:url,rankingObservedAt:observedAt};
   if(seen.has(id)){previouslyChecked.push(product);reused++;}else{products.push({...product,rank:products.length+1});added++;}
  }
  brands.push({...brand,requested:perBrand,returned:rows.length,newProducts:added,previouslyChecked:reused,shortfall:Math.max(0,perBrand-rows.length)});
 }
 return {version:1,source:'musinsa-brand-ranking',period:'REALTIME',observedAt,brandSelectionSource:'https://www.musinsa.com/content/1566622125264402112',brands,products,previouslyChecked};
}
export function validateBrandPlan(p){
 if(p?.version!==1||p.source!=='musinsa-brand-ranking'||p.period!=='REALTIME'||!Array.isArray(p.products)||!p.products.length||p.products.length>250||!Array.isArray(p.brands)||!Array.isArray(p.previouslyChecked))throw Error('INVALID_BRAND_PLAN');
 const ids=new Set();
 for(const [i,r] of p.products.entries()){
  if(r.rank!==i+1||!/^\d{1,12}$/.test(r.productId)||ids.has(r.productId)||r.productUrl!==`https://www.musinsa.com/products/${r.productId}`||!Number.isInteger(r.brandRank)||r.brandRank<1||r.brandRank>50||!POPULAR_BRANDS.some(b=>b.id===r.brandId&&b.name===r.brandName)||r.source!==p.source)throw Error('INVALID_BRAND_PLAN');
  ids.add(r.productId);
 }
 return p;
}
