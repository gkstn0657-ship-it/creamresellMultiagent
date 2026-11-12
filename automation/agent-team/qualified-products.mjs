import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {writeJsonAtomic} from './atomic-json.mjs';
import {workOrders} from './work-orders.mjs';

const JSON_FILE='qualified-products.json';
const MARKDOWN_FILE='qualified-products.md';
const read=file=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
const unique=values=>[...new Set(values.filter(Boolean).map(String))];
const safeTime=value=>Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const minTime=values=>values.filter(Boolean).sort()[0]||null;
const maxTime=values=>values.filter(Boolean).sort().at(-1)||null;
const oneLine=value=>String(value||'').replace(/[\r\n|]+/g,' ').replace(/\s+/g,' ').trim();
const musinsaUrl=value=>/^https:\/\/www\.musinsa\.com\/products\/\d{1,12}$/.test(String(value||''))?String(value):null;
const numericId=value=>/^\d{1,18}$/.test(String(value||''))?String(value):null;
const productKey=value=>/^(?:\d{1,12}|poizon-\d{1,18})$/.test(String(value||''))?String(value):null;

function writeTextAtomic(file,text){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const temp=file+'.'+process.pid+'.'+crypto.randomUUID()+'.tmp';
 fs.writeFileSync(temp,text,{flag:'wx'});
 try{for(let attempt=0;;attempt++)try{fs.renameSync(temp,file);return;}catch(error){if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=8)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Math.min(200,10*2**attempt));}}
 finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}

function qualifiedEvidence(work,entry,row,state){
 if(row?.status!=='complete'||row.assessment?.decision!=='adopt'||!row.assessment?.reviewId||row.qualification?.passed!==true)return null;
 const canonicalProductId=productKey(row.qualification.canonicalProductId||row.productId);if(!canonicalProductId)return null;
 const schemas=row.marketSchemas||[],legacyPoizon=String(row.productId).startsWith('poizon-'),defaultPlatform=legacyPoizon?'poizon':'kream';
 const fallbackMarketId=numericId(schemas.find(schema=>(schema.platform||defaultPlatform)===defaultPlatform)?.marketProductId)||numericId(schemas.find(schema=>(schema.platform||defaultPlatform)===defaultPlatform)?.productId)||numericId(String(row.productId).replace(/^poizon-/,''));
 const options=(row.qualification.eligibleOptions||[]).flatMap(option=>{
  const platform=option.platform==='poizon'?'poizon':option.platform==='kream'?'kream':defaultPlatform;
  const marketProductId=numericId(option.marketProductId)||fallbackMarketId;if(!marketProductId)return [];
  return [{platform,marketProductId,size:oneLine(option.size)||null,sourceOption:oneLine(option.sourceOption)||null,stock:Number.isFinite(option.stock)?option.stock:null,expectedSales30d:Number.isFinite(option.expectedSales30d)?option.expectedSales30d:null,
   ...(Array.isArray(option.saleModes)?{saleModes:option.saleModes.map(m=>({mode:oneLine(m.mode)||null,channel:oneLine(m.channel)||null,askPrice:Number.isFinite(m.askPrice)?m.askPrice:null,channelTrades30d:Number.isFinite(m.channelTrades30d)?m.channelTrades30d:null,channelMedian30d:Number.isFinite(m.channelMedian30d)?m.channelMedian30d:null,marginAtChannelMedian:Number.isFinite(m.marginAtChannelMedian)?m.marginAtChannelMedian:null}))}:{})}];
 });
 const sourceUrl=schemas.map(schema=>musinsaUrl(schema.sourceUrl)).find(Boolean)||null;
 const qualifiedAt=safeTime(row.assessment.at)||safeTime(state.finishedAt)||safeTime(entry.at)||safeTime(work.createdAt);
 return {key:canonicalProductId,canonicalProductId,workId:work.id,runId:entry.runId,productId:String(row.productId),qualifiedAt,reviewId:String(row.assessment.reviewId),sourceUrl,assessmentReason:oneLine(row.assessment.reason).slice(0,600)||null,eligibleOptions:options,purchaseAuthorized:false};
}

export function collectQualifiedProducts(root){
 const found=[];
 for(const work of workOrders(root))for(const entry of work.entries||[]){
  const state=read(path.join(root,entry.runId,'batch-state.json'));if(!state)continue;
  for(const row of state.results||[]){const evidence=qualifiedEvidence(work,entry,row,state);if(evidence)found.push(evidence);}
 }
 return found;
}

function mergeProduct(previous,evidence){
 const evidenceMap=new Map((previous?.evidence||[]).map(item=>[`${item.workId}:${item.runId}:${item.productId}`,item]));
 for(const item of evidence)evidenceMap.set(`${item.workId}:${item.runId}:${item.productId}`,item);
 const all=[...evidenceMap.values()].sort((a,b)=>(a.qualifiedAt||'').localeCompare(b.qualifiedAt||''));
 const options=all.flatMap(item=>item.eligibleOptions||[]),latest=all.at(-1)||{};
 return {
  canonicalProductId:evidence[0]?.canonicalProductId||previous.canonicalProductId,
  platforms:unique(options.map(option=>option.platform)).sort(),
  kreamProductIds:unique(options.filter(option=>option.platform==='kream').map(option=>option.marketProductId)).sort(),
  poizonProductIds:unique(options.filter(option=>option.platform==='poizon').map(option=>option.marketProductId)).sort(),
  musinsaUrls:unique(all.map(item=>musinsaUrl(item.sourceUrl))).sort(),
  firstQualifiedAt:minTime(all.map(item=>safeTime(item.qualifiedAt))),
  lastQualifiedAt:maxTime(all.map(item=>safeTime(item.qualifiedAt))),
  lastAssessmentReason:latest.assessmentReason||previous?.lastAssessmentReason||null,
  eligibleOptions:options.filter((option,index,array)=>array.findIndex(other=>JSON.stringify(other)===JSON.stringify(option))===index),
  evidence:all,
  status:'conditional_research_candidate',
  purchaseAuthorized:false
 };
}

export function renderQualifiedProductsMarkdown(registry){
 const lines=['# 검토 통과 상품 영구 목록','',`누적 ${registry.products.length}개 · 마지막 변경 ${registry.updatedAt}`,'','> 재고·마진·최근 판매 근거와 독립 검토를 통과한 조건부 조사 후보입니다. 구매 승인이나 수익 보장은 아닙니다.',''];
 for(const [index,product] of registry.products.entries()){
  const names=[...product.kreamProductIds.map(id=>`KREAM ${id}`),...product.poizonProductIds.map(id=>`POIZON ${id}`)];
  lines.push(`## ${index+1}. ${names.join(' / ')||product.canonicalProductId}`,'');
  const links=[...product.kreamProductIds.map(id=>`[KREAM ${id}](https://kream.co.kr/products/${id})`),...product.musinsaUrls.map((url,i)=>`[무신사${product.musinsaUrls.length>1?` ${i+1}`:''}](${url})`)];
  lines.push(`- 링크: ${links.join(' · ')||'공개 링크 없음'}`);
  const modeLabel={fast:'⚡보관',normal:'일반',instant:'즉시'};
  const modeText=option=>(option.saleModes||[]).map(m=>m.channel?`${modeLabel[m.mode]||m.mode} 체결 ${m.channelTrades30d??'-'}건·중앙 ${m.channelMedian30d??'-'}원→마진 ${m.marginAtChannelMedian??'-'}원`:`${modeLabel[m.mode]||m.mode} 호가 ${m.askPrice??'-'}원`).join(', ');
  const options=product.eligibleOptions.map(option=>`${option.platform.toUpperCase()} ${option.size||option.sourceOption||'-'} · 재고 ${option.stock??'-'} · 30일 판매 ${option.expectedSales30d??'-'}${option.saleModes?.length?` · ${modeText(option)}`:''}`);
  lines.push(`- 통과 옵션: ${options.join(' / ')||'상세 근거 파일 참조'}`);
  lines.push(`- 최초 통과: ${product.firstQualifiedAt||'-'} · 최근 통과: ${product.lastQualifiedAt||'-'}`);
  if(product.lastAssessmentReason)lines.push(`- 최근 판단: ${oneLine(product.lastAssessmentReason).slice(0,300)}`);
  lines.push('');
 }
 return lines.join('\n')+'\n';
}

export function syncQualifiedProducts(root,{now=()=>new Date()}={}){
 fs.mkdirSync(root,{recursive:true});
 const file=path.join(root,JSON_FILE),markdown=path.join(root,MARKDOWN_FILE),previous=read(file)||{version:1,updatedAt:null,total:0,products:[]};
 if(previous.version!==1||!Array.isArray(previous.products))throw Error('QUALIFIED_PRODUCTS_REGISTRY_INVALID');
 const byKey=new Map(previous.products.map(product=>[productKey(product.canonicalProductId),product]).filter(([key])=>key));
 const grouped=new Map();for(const item of collectQualifiedProducts(root)){const group=grouped.get(item.key)||[];group.push(item);grouped.set(item.key,group);}
 for(const [key,evidence] of grouped)byKey.set(key,mergeProduct(byKey.get(key),evidence));
 const products=[...byKey.values()].sort((a,b)=>(a.firstQualifiedAt||'').localeCompare(b.firstQualifiedAt||'')||a.canonicalProductId.localeCompare(b.canonicalProductId));
 const content={version:1,total:products.length,products};
 const previousContent={version:previous.version,total:previous.products.length,products:previous.products};
 if(JSON.stringify(content)===JSON.stringify(previousContent)&&fs.existsSync(markdown))return previous;
 const registry={version:1,updatedAt:now().toISOString(),total:products.length,products};
 writeJsonAtomic(file,registry);writeTextAtomic(markdown,renderQualifiedProductsMarkdown(registry));return registry;
}

export async function watchQualifiedProducts(root,{workId=null,intervalMs=5000,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 for(;;){
  const registry=syncQualifiedProducts(root);process.stdout.write(JSON.stringify({type:'qualified_products_synced',total:registry.total,updatedAt:registry.updatedAt})+'\n');
  if(workId){const work=workOrders(root).find(item=>item.id===workId);if(!work||work.status==='stopped')return registry;}
  await sleep(intervalMs);
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const arg=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3),root=arg('root');if(!root)throw Error('ROOT_REQUIRED');
 const watch=process.argv.includes('--watch');const registry=watch?await watchQualifiedProducts(path.resolve(root),{workId:arg('work')}):syncQualifiedProducts(path.resolve(root));
 console.log(JSON.stringify({file:path.join(path.resolve(root),JSON_FILE),markdown:path.join(path.resolve(root),MARKDOWN_FILE),total:registry.total}));
}
