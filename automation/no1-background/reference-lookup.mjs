import {searchMusinsa} from '../agent-team/source-search.mjs';
import {buildMarketSchema} from '../agent-team/market-schema.mjs';
import {probeProduct} from './product-probe.mjs';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.trim().toUpperCase()===b.trim().toUpperCase();
export const referenceLookupTool={
  name:'no1_background_reference_lookup',
  description:'Background lookup of one user-specified KREAM/model/source-size reference. Searches Musinsa, verifies exact model and source option, retains sold-out evidence, and collects benefit/market schema without opening a table. sourceSize must use the merchant label with externally verified size mapping. Partial authentication failures remain explicit. Does not start discovery or AI batches. Stock internals may use an isolated guest cart.',
  inputSchema:{type:'object',properties:{kreamId:{type:'string',pattern:'^\\d{1,12}$'},model:{type:'string',minLength:1,maxLength:100},sourceSize:{type:'string',minLength:1,maxLength:100}},required:['kreamId','model','sourceSize'],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}
};
export async function lookupReference(args,{client,search=searchMusinsa,probe=probeProduct}={}){
  if(!args||Object.keys(args).sort().join(',')!=='kreamId,model,sourceSize'||typeof args.kreamId!=='string'||!/^\d{1,12}$/.test(args.kreamId)||!['model','sourceSize'].every(k=>typeof args[k]==='string'&&args[k].trim()===args[k]&&args[k].length>0&&args[k].length<=100&&!/[\x00-\x1f]/.test(args[k])))throw Error('NO1_INVALID_PAYLOAD');
  // Only this explicit reference is searched. No discovery DB, reservations, or
  // runtime selection AI is involved. Successful reads are reused within a call.
  const cache=new Map(),cached={status:()=>client.status(),request:async(cmd,payload)=>{
    const key=JSON.stringify([cmd,payload]);if(!cache.has(key))cache.set(key,await client.request(cmd,payload));return structuredClone(cache.get(key));
  }};
  const result=await search(args.model),matches=[],sourceErrors=[];
  for(const row of result.items.slice(0,3)){
    if(!/^https:\/\/www\.musinsa\.com\/products\/\d{1,12}$/.test(row.productUrl))throw Error('SOURCE_URL_INVALID');
    try{
      const stock=await cached.request('stock:check',{url:row.productUrl});
      if(!same(stock.makerNumber,args.model)||stock.productNumber!==row.productUrl.split('/').at(-1))continue;
      const options=(stock.combinedOptions||[]).filter(o=>same(o.size,args.sourceSize));
      for(const option of options)matches.push({productUrl:row.productUrl,stock,option});
    }catch(e){sourceErrors.push({productUrl:row.productUrl,code:/^[A-Z0-9_]+$/.test(e.message)?e.message:'REFERENCE_SOURCE_FAILED'});}
  }
  const summary={kind:'user-specified-reference',request:args,search:{...result,items:result.items.slice(0,3),coverage:'first-page; at most 3 products'},sourceErrors,observedAt:new Date().toISOString(),purchaseAuthorized:false};
  if(matches.length!==1)return {...summary,status:'needs_attention',error:matches.length?'REFERENCE_SOURCE_AMBIGUOUS':'REFERENCE_SOURCE_NOT_FOUND',matchingSourceOptions:matches.length};
  const match=matches[0],request={kreamId:args.kreamId,model:args.model,productUrl:match.productUrl,color:match.option.firstOption,option:match.option.size};
  const payload=await probe(cached,request);
  // Saved fee/tax settings are page metadata and remain useful even when the
  // separate KREAM account session blocks live prices. Never substitute defaults.
  if(!payload.marketResearch?.marginSettings){
    try{const marginSettings=await cached.request('market:margin-settings',{});payload.marketResearch={...payload.marketResearch,marginSettings};}
    catch(e){payload.errors={...payload.errors,marginSettings:/^[A-Z0-9_]+$/.test(e.message)?e.message:'REFERENCE_SETTINGS_FAILED'};payload.queryStatus='partial';}
  }
  const observation={kind:'no1_product',mode:'live',observedAt:payload.observedAt,payload};
  return {...summary,status:payload.queryStatus==='complete'?'collected':'partial',source:{productUrl:match.productUrl,model:match.stock.makerNumber,name:match.stock.name,size:match.option.size,stockQuantity:match.option.limitedQty??null,optionAvailable:match.option.isAvailable??null},
    benefitPrice:payload.benefits?.maxBenefitPrice??null,errors:payload.errors,observation,schema:buildMarketSchema(observation),
    limitations:['Source-size mapping and KREAM product identity require independent evidence.','Sold-out stock is retained for reference only.','Calculated margins are not the original displayed values unless explicitly marked no1_displayed_value.','Partial results do not verify profitability or current checkout availability.']};
}
