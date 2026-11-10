import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildNo1FirstReport} from './no1-first.mjs';
import {RelayTransport} from '../kream-tools/relay-transport.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const MCP=fileURLToPath(new URL('./no1-mcp-prototype/server-stock.mjs',import.meta.url));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');};
const supportedStock=url=>/^https:\/\/www\.musinsa\.com\/products\/\d+$/.test(url);

export function callNo1Mcp(name,args,options={}) {
  const request={jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}};
  const result=spawnSync(process.execPath,[options.server || MCP,'--background-only'],{
    input:JSON.stringify(request)+'\n',encoding:'utf8',windowsHide:true,timeout:options.timeoutMs || 50000,maxBuffer:100000});
  if (result.error || result.status!==0) throw Error('NO1_MCP_PROCESS_FAILED');
  let response;try{response=JSON.parse(result.stdout.trim());}catch{throw Error('NO1_MCP_INVALID_RESPONSE');}
  if (response.result?.isError) throw Error(String(response.result.content?.[0]?.text || 'NO1_MCP_TOOL_ERROR').slice(0,120));
  if (response.error) throw Error('NO1_MCP_PROTOCOL_ERROR');
  try{return JSON.parse(response.result.content[0].text);}catch{throw Error('NO1_MCP_INVALID_EVIDENCE');}
}

export async function collectFallbackJobs(dir,jobs,relayDir,options={}) {
  if (!jobs.length) return {requested:0,collected:0,missing:[]};
  const transport=new RelayTransport(dir,relayDir,options.transportOptions);
  await transport.verify();
  write(path.join(dir,'jobs.json'),{jobs});
  const deadline=Date.now()+(options.timeoutMs || 600000);
  try {
    while (true) {
      await transport.sync();
      const missing=jobs.filter(j=>!fs.existsSync(path.join(dir,`dump-${j.id}.json`))).map(j=>j.id);
      if (!missing.length) return {requested:jobs.length,collected:jobs.length,missing};
      if (Date.now()>deadline) return {requested:jobs.length,collected:jobs.length-missing.length,missing};
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  } finally {transport.cancelPending();}
}

export async function runNo1First(seeds,policy,options={}) {
  if (seeds?.version!=='no1-first-seeds-v1' || !Array.isArray(seeds.items)) throw Error('Invalid No1 seeds');
  const query=options.query || ((name,args)=>callNo1Mcp(name,args,options));
  const items=[],errors=[];
  for (const seed of seeds.items) {
    const kreamModel=seed?.kreamModel || seed?.model;
    const sourceModel=seed?.sourceModel || seed?.model;
    if (!/^\d+$/.test(String(seed?.kreamId ?? '')) || typeof kreamModel!=='string' ||
        !kreamModel.trim() || typeof sourceModel!=='string' || !sourceModel.trim() ||
        !Array.isArray(seed.options) || !seed.options.length ||
        !seed.sourceUrl || !seed.options.every(option=>typeof option.size==='string' && option.size.trim()))
      throw Error('Invalid No1 seed identity or options');
    let market=null;
    try{market=await query('no1_search_price_comparison',{kreamId:String(seed.kreamId),model:kreamModel});}
    catch(error){errors.push({kreamId:String(seed.kreamId),stage:'market',code:String(error.message).slice(0,120)});}
    for (const option of seed.options || []) {
      let stock=null;
      if (supportedStock(seed.sourceUrl)) {
        try{stock=await query('no1_search_stock_estimate',{productUrl:seed.sourceUrl,
          model:sourceModel,color:option.sourceColor || seed.sourceColor || seed.color,
          option:option.sourceOption || option.size});}
        catch(error){errors.push({kreamId:String(seed.kreamId),size:option.size,stage:'stock',code:String(error.message).slice(0,120)});}
      }
      items.push({seed:{...seed,options:[option]},market,stock});
    }
  }
  const evidence={version:'no1-first-input-v1',at:new Date().toISOString(),items,errors};
  const plan=buildNo1FirstReport(evidence,policy,options.now || new Date().toISOString());
  return {evidence,plan};
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=process.argv.slice(2),seedFile=args.find(x=>x.startsWith('--seeds='))?.slice(8),
    policyFile=args.find(x=>x.startsWith('--policy='))?.slice(9),outDir=args.find(x=>x.startsWith('--out='))?.slice(6);
  if (!seedFile || !policyFile || !outDir || !args.includes('--live'))
    throw Error('Usage: node automation/no1-first-runner.mjs --seeds=<file> --policy=<file> --out=<new-dir> --live [--collect-fallback]');
  const dir=path.resolve(outDir);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw Error('Output directory must be new and empty');
  const result=await runNo1First(read(seedFile),read(policyFile));
  write(path.join(dir,'no1-first-input.json'),result.evidence);
  write(path.join(dir,'no1-first-plan.json'),result.plan);
  let fallback=null;
  if (args.includes('--collect-fallback')) {
    const runtime=read(path.join(ROOT,'sourcing-runtime.json'));
    fallback=await collectFallbackJobs(dir,result.plan.fallbackJobs,path.resolve(runtime.relayRunDir));
    write(path.join(dir,'fallback-collection.json'),fallback);
  }
  console.log(JSON.stringify({dir,summary:result.plan.summary,fallback}));
}
