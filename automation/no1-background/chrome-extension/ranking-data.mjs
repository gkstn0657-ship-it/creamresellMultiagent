export const CATEGORIES = Object.freeze(['000','001000','002000','003000','100000','103000','004000','101000','026000','104000','017000','102000','106000']);
export const PERIODS = Object.freeze(['REALTIME','DAILY','WEEKLY','MONTHLY']);
export const AGES = Object.freeze(['AGE_BAND_ALL','AGE_BAND_MINOR','AGE_BAND_20','AGE_BAND_25','AGE_BAND_30','AGE_BAND_35','AGE_BAND_40']);
export function validRankingRequest(p) {
  return p.section==='all' && (p.category===undefined || CATEGORIES.includes(p.category)) && PERIODS.includes(p.period) && ['A','M','F'].includes(p.gender) && AGES.includes(p.ageBand) && Object.keys(p).every(k=>['section','category','period','gender','ageBand'].includes(k));
}
export function projectRankingSettings(data) {
  if(!data || !CATEGORIES.includes(data.category) || !validRankingRequest({...Object.fromEntries(['category','period','gender','ageBand'].map(k=>[k,data[k]])),section:'all'}))throw Error('NO1_RANKING_SETTINGS_UNAVAILABLE');
  return {category:data.category,period:data.period,gender:data.gender,ageBand:data.ageBand};
}
export function projectRankingProducts(data) {
  if(!Array.isArray(data?.products)||data.products.length>1000)throw Error('NO1_INVALID_RESPONSE');
  const products=data.products.map(p=>{
    if(!p || !/^\d{1,12}$/.test(String(p.productId)) || !Number.isSafeInteger(p.rank) || p.rank<1 || typeof p.productName!=='string' || p.productName.length>500 || typeof p.brandName!=='string' || p.brandName.length>200)throw Error('NO1_INVALID_RESPONSE');
    return {rank:p.rank,productId:String(p.productId),productName:p.productName,brandName:p.brandName,productUrl:`https://www.musinsa.com/products/${p.productId}`};
  });
  products.sort((a,b)=>a.rank-b.rank || a.productId.localeCompare(b.productId,'en',{numeric:true}));
  const seen=new Set();
  return {products:products.filter(p=>!seen.has(p.productId)&&seen.add(p.productId))};
}

// Runs in the existing official page, reads only the four ranking selectors.
// Does not change the screen, invoke store actions or expose account state.
export function readRankingSettings() {
  if(location.origin!=='https://no1.certi.life'||!location.pathname.startsWith('/sourcing/'))return null;
  const values=[];
  for(const el of document.querySelectorAll('[data-v-app]')) {
    const pinia=el.__vue_app__?.config?.globalProperties?.$pinia;
    const state=pinia?.state?.value?.musinsaRanking;
    if(state)values.push(Object.fromEntries(['category','period','gender','ageBand'].map(k=>[k,state[k]])));
  }
  return values;
}
