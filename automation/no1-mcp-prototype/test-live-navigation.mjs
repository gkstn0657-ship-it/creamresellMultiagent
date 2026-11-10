import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url));
function call(name,args){const request={jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}};const r=spawnSync(process.execPath,[path.join(here,'server-stock.mjs'),'--enable-live-ui'],{input:JSON.stringify(request)+'\n',encoding:'utf8',timeout:45000,windowsHide:true});if(r.status!==0)throw Error('SERVER_FAILED');const response=JSON.parse(r.stdout.trim());return {request,response};}
const marketArgs={kreamId:'280933',model:'MM00313KM0307-P199'};
const stockArgs={productUrl:'https://www.musinsa.com/products/7481180',model:'NBNPG41033',color:'(19)BLACK',option:'L(100)'};
const market=call('no1_search_price_comparison',marketArgs);
const stock=call('no1_search_stock_estimate',stockArgs);
const marketBack=call('no1_search_price_comparison',marketArgs);
const results=[market,stock,marketBack];const evidence=results.map(r=>r.response.result.isError?null:JSON.parse(r.response.result.content[0].text));
const passed=evidence.every(e=>e&&e.navigation.verified&&e.manualPurchasePriceUsed===false&&e.no1DisplayedMarginUsed===false)&&evidence[1].navigation.from==='price-comparison'&&evidence[1].navigation.to==='stock-check'&&evidence[1].navigation.changed&&evidence[2].navigation.from==='stock-check'&&evidence[2].navigation.to==='price-comparison'&&evidence[2].navigation.changed;
const result={test:'Actual bidirectional UI menu navigation with market and stock identity checks',recordedAt:new Date().toISOString(),market,stock,marketBack,passed,pipelineWrites:false};fs.writeFileSync(path.join(here,'live-navigation-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!passed)process.exitCode=1;