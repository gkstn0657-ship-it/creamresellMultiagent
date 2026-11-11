// Schema metadata only. Never include values, keys from the response, or credentials.
import {validSearchStyleCode} from './poizon-data.mjs';
export function projectValidationFailure(d){
 if(d==null)return null;
 const fields=['response','products','product','spuId','styleCode','globalSpuId','name','colorName','brandName','level1CategoryName','cannotBidMessage','bidStatus','nextCursor','unclassified'];
 const types=['null','array','undefined','object','string','number','boolean','unknown'];
 const rules=['object','array_max_1000','numeric_id','model_format','search_style_text','text_max_500','enum_0_1','page_1_999','validation_failed'];
 if(d.command!=='market:poizon:search'||!fields.includes(d.field)||!types.includes(d.type)||!rules.includes(d.rule)||!(d.index===null||Number.isSafeInteger(d.index)&&d.index>=0&&d.index<1000)||typeof d.capturedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(d.capturedAt)||!Number.isFinite(Date.parse(d.capturedAt)))return null;
 return {command:d.command,capturedAt:d.capturedAt,field:d.field,index:d.index,type:d.type,rule:d.rule};
}
export function diagnosePoizonSearch(data){
 const type=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
 const issue=(field,value,rule,index=null)=>({field,index,type:type(value),rule});
 const id=v=>typeof v==='string'&&/^\d{1,18}$/.test(v);
 if(!data||typeof data!=='object')return issue('response',data,'object');
 if(!Array.isArray(data.products)||data.products.length>1000)return issue('products',data.products,'array_max_1000');
 for(let i=0;i<data.products.length;i++){
  const p=data.products[i];if(!p||typeof p!=='object')return issue('product',p,'object',i);
  if(!id(String(p.spuId)))return issue('spuId',p.spuId,'numeric_id',i);
  if(!validSearchStyleCode(p.styleCode))return issue('styleCode',p.styleCode,'search_style_text',i);
  if(p.globalSpuId!=null&&!id(String(p.globalSpuId)))return issue('globalSpuId',p.globalSpuId,'numeric_id',i);
  for(const k of ['name','colorName','brandName','level1CategoryName','cannotBidMessage'])if(p[k]!=null&&(typeof p[k]!=='string'||p[k].length>500))return issue(k,p[k],'text_max_500',i);
  if(p.bidStatus!=null&&![0,1].includes(p.bidStatus))return issue('bidStatus',p.bidStatus,'enum_0_1',i);
 }
 if(data.nextCursor!=null&&!/^[1-9]\d{0,2}$/.test(data.nextCursor))return issue('nextCursor',data.nextCursor,'page_1_999');
 return {field:'unclassified',index:null,type:'unknown',rule:'validation_failed'};
}
