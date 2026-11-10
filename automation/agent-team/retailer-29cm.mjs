// Public search and product data only. No account, cart, checkout or browser session.
const searchEndpoint='https://display-bff-api.29cm.co.kr/api/v1/listing/items?colorchipVariant=CONTROL';
const validModel=model=>typeof model==='string'&&/^[A-Za-z0-9][A-Za-z0-9._ /-]{1,99}$/.test(model);
const normal=value=>String(value||'').trim().toUpperCase();
const money=value=>Number.isSafeInteger(value)&&value>=0?value:null;
async function publicText(url,{fetcher=fetch,...options}={}){
  try{
    const response=await fetcher(url,{...options,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('SOURCE_29CM_HTTP_'+response.status);
    const reader=response.body?.getReader();let text='',bytes=0;
    if(reader){const decoder=new TextDecoder();while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
      if(bytes>5000000){await reader.cancel();throw Error('SOURCE_29CM_RESPONSE_TOO_LARGE');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
    else text=await response.text();
    if(text.length>5000000)throw Error('SOURCE_29CM_RESPONSE_TOO_LARGE');return text;
  }catch(e){if(/^SOURCE_29CM_/.test(e.message))throw e;throw Error('SOURCE_29CM_NETWORK_'+String(e.cause?.code||e.name||'ERROR').replace(/[^A-Za-z0-9_]/g,'').slice(0,60));}
}
export function parse29cmSearch(data){
  if(data?.meta?.result!=='SUCCESS'||!Array.isArray(data.data?.list)||typeof data.data.pagination?.hasNext!=='boolean')throw Error('SOURCE_29CM_FORMAT_CHANGED');
  return {items:data.data.list.filter(x=>x.itemType==='PRODUCT'&&Number.isSafeInteger(x.itemId)&&x.itemId>0&&typeof x.itemInfo?.productName==='string')
    .map(x=>({productUrl:`https://www.29cm.co.kr/products/${x.itemId}`,title:x.itemInfo.productName,listedPrice:money(x.itemInfo.sellPrice),soldOut:x.itemInfo.isSoldOut===true})),
    hasNext:data.data.pagination.hasNext};
}
export async function search29cm(model,{fetcher=fetch}={}){
  if(!validModel(model))throw Error('SOURCE_29CM_QUERY_INVALID');
  const text=await publicText(searchEndpoint,{fetcher,method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({keyword:model,pageRequest:{page:1,size:10},pageType:'SRP',sortType:'RECOMMENDED',facets:{}})});
  let data;try{data=JSON.parse(text);}catch{throw Error('SOURCE_29CM_FORMAT_CHANGED');}
  return {...parse29cmSearch(data),retailer:'29cm',query:model,url:`https://www.29cm.co.kr/store/search?keyword=${encodeURIComponent(model)}`,
    observedAt:new Date().toISOString(),coverage:'first page, 10 public search results; search prices are not checkout prices'};
}
export function parse29cmProduct(html,{productUrl,model}){
  if(!validModel(model)||!/^https:\/\/www\.29cm\.co\.kr\/products\/\d{1,12}$/.test(productUrl))throw Error('SOURCE_29CM_URL_INVALID');
  const productNo=productUrl.split('/').at(-1),products=[];
  for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    let value;try{value=JSON.parse(match[1]);}catch{continue;}
    const entries=Array.isArray(value)?value:Array.isArray(value?.['@graph'])?value['@graph']:[value];
    for(const entry of entries)if(entry?.['@type']==='Product')products.push(entry);
  }
  const matches=products.filter(p=>String(p.sku)===productNo);
  if(matches.length!==1)throw Error('SOURCE_29CM_PRODUCT_IDENTITY_MISMATCH');
  const p=matches[0],explicitModel=p.mpn||p.model;
  const suffix=typeof p.name==='string'?p.name.split(' / ').at(-1):'';
  if(normal(explicitModel||suffix)!==normal(model))throw Error('SOURCE_29CM_MODEL_MISMATCH');
  const offer=p.offers;
  if(!offer||Array.isArray(offer)||offer['@type']!=='Offer'||offer.url!==productUrl||offer.priceCurrency!=='KRW'||money(offer.price)===null)throw Error('SOURCE_29CM_OFFER_UNVERIFIED');
  return {retailer:'29cm',productUrl,model,modelVerified:true,modelEvidence:explicitModel?'merchant-structured-model':'merchant-title-exact-model-suffix',
    name:p.name,listedPrice:offer.price,currency:'KRW',availability:offer.availability||null,
    source:'public-product-jsonld',sourceProductId:productNo,optionBinding:'unverified-until-matched',stock:null,benefits:null,
    actualCheckoutPriceConfirmed:false,upstreamFreshnessConfirmed:false,sourceDataAsOf:null,
    missingFields:['sourceOptionBinding','optionStockQuantity','benefitQuote','actualCheckoutPrice','shippingAndSellerFees','upstreamDataAsOf']};
}
export async function quote29cm({productUrl,model},{fetcher=fetch}={}){
  if(!validModel(model)||!/^https:\/\/www\.29cm\.co\.kr\/products\/\d{1,12}$/.test(productUrl))throw Error('SOURCE_29CM_URL_INVALID');
  return {...parse29cmProduct(await publicText(productUrl,{fetcher}),{productUrl,model}),observedAt:new Date().toISOString()};
}
export const retailer29cm={name:'29cm',search:search29cm,quote:quote29cm};
