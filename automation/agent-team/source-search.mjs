// Public product discovery only. Never forward credentials or follow arbitrary hosts.
export function parseMusinsaSearch(html,query){
 const raw=html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
 if(!raw)throw Error('SOURCE_SEARCH_FORMAT_CHANGED');
 let data;try{data=JSON.parse(raw);}catch{throw Error('SOURCE_SEARCH_FORMAT_CHANGED');}
 const q=data.props?.pageProps?.dehydratedState?.queries?.find(q=>q.queryKey?.[0]==='search'&&q.queryKey?.[1]==='goods'&&q.queryKey?.[2]?.keyword===query&&q.state?.data?.pages);
 if(!q)throw Error('SOURCE_SEARCH_QUERY_MISMATCH');
 const page=q.state.data.pages[0];if(!Array.isArray(page?.items))throw Error('SOURCE_SEARCH_FORMAT_CHANGED');
 return {items:page.items.filter(x=>Number.isSafeInteger(x.goodsNo)&&x.goodsNo>0).map(x=>({productUrl:`https://www.musinsa.com/products/${x.goodsNo}`,title:String(x.goodsName||''),soldOut:x.isSoldOut===true})),hasNext:page.pagination?.hasNext===true};
}
export async function searchMusinsa(query,{fetcher=fetch}={}){
 if(typeof query!=='string'||!query.trim()||query.length>100)throw Error('SOURCE_SEARCH_QUERY_INVALID');
 let url=new URL('https://www.musinsa.com/search/goods');url.searchParams.set('keyword',query);
 const started=Date.now(),signal=AbortSignal.timeout(15000),visited=new Set();
 try{
  for(let hop=0;hop<=3;hop++){
   if(url.origin!=='https://www.musinsa.com'||url.pathname!=='/search/goods'||url.username||url.password||url.searchParams.get('keyword')!==query)throw Error('SOURCE_SEARCH_REDIRECT_FORBIDDEN');
   if(visited.has(url.href))throw Error('SOURCE_SEARCH_REDIRECT_LOOP');visited.add(url.href);
   const response=await fetcher(url.href,{signal,redirect:'manual'});
   if([301,302,303,307,308].includes(response.status)){
    const location=response.headers.get('location');await response.body?.cancel();
    if(!location)throw Error('SOURCE_SEARCH_REDIRECT_INVALID');
    url=new URL(location,url);continue;
   }
   if(!response.ok)throw Error('SOURCE_SEARCH_HTTP_'+response.status);
   const reader=response.body?.getReader();let html='';
   if(reader){const decoder=new TextDecoder();let bytes=0;while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>5000000){await reader.cancel();throw Error('SOURCE_RESPONSE_TOO_LARGE');}html+=decoder.decode(value,{stream:true});}html+=decoder.decode();}
   else html=await response.text();
   if(html.length>5000000)throw Error('SOURCE_RESPONSE_TOO_LARGE');
   return {...parseMusinsaSearch(html,query),query,url:url.href,redirects:hop,durationMs:Date.now()-started,observedAt:new Date().toISOString()};
  }
  throw Error('SOURCE_SEARCH_REDIRECT_LIMIT');
 }catch(e){
  if(/^SOURCE_/.test(e.message))throw e;
  const cause=String(e.cause?.code||e.name||'NETWORK').replace(/[^A-Za-z0-9_]/g,'').slice(0,60);
  throw Error('SOURCE_SEARCH_NETWORK_'+cause);
 }
}
