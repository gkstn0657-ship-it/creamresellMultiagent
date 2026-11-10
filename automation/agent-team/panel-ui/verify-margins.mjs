import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {handleMcp} from '../control-mcp.mjs';
import {TeamStore} from '../store.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-margin-ui-'));
const out=fileURLToPath(new URL('../../../kream-runs/margin-verification/',import.meta.url));
fs.mkdirSync(out,{recursive:true});
const runId='batch-11111111-1111-1111-1111-111111111111',dir=path.join(root,runId);
const request={kreamId:'1138541',productUrl:'https://www.musinsa.com/products/7395794',model:'IR2243-010',color:'BLACK',option:'XS'};
fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'products.json'),JSON.stringify([request]));
fs.writeFileSync(path.join(dir,'batch-state.json'),JSON.stringify({status:'complete',productCount:1,collected:1,judged:1}));
const store=new TeamStore(path.join(dir,'judgments',request.kreamId),{product:request});
store.observe('no1_product',{request,identity:{sourceProductVerified:true,sourceOptionVerified:true},stock:{selectedStockQuantity:35},
  benefits:{productId:'7395794',styleNo:'IR2243-010',maxBenefitPrice:258200},sizeBinding:{sourceSize:'XS',marketSize:'XS'},
  market:{prices:[{size:'XS',option:'xs-id',buyPrice:265000,sellPrice:200000}]}},{mode:'fixture'});
const html=fs.readFileSync(new URL('./dist/panel.html',import.meta.url),'utf8');
const host=await build({stdin:{contents:`import {AppBridge,PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';
const frame=document.querySelector('iframe');
const bridge=new AppBridge(null,{name:'Margin isolated QA',version:'1.0.0'},{serverTools:{},updateModelContext:{}},{hostContext:{theme:'light',displayMode:'inline'}});
bridge.oncalltool=params=>window.invokeCream(params);
bridge.onupdatemodelcontext=async()=>({});
bridge.oninitialized=()=>{window.initialized=true;};
await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));window.hostReady=true;`,resolveDir:fileURLToPath(new URL('./',import.meta.url))},bundle:true,write:false,format:'esm'});
const browser=await chromium.launch({headless:true,channel:'msedge'}),errors=[],calls=[];
try{
  const page=await browser.newPage({viewport:{width:1200,height:1100}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('invokeCream',async params=>{
    assert.ok(['cream_panel_data','cream_panel_ready'].includes(params.name));calls.push(params.name);
    return handleMcp({method:'tools/call',params},{root});
  });
  await page.setContent('<html><body style="margin:0"><iframe title="Margin QA" style="width:100%;height:1080px;border:0"></iframe></body></html>');
  await page.addScriptTag({type:'module',content:host.outputFiles[0].text});
  await page.waitForFunction(()=>window.hostReady);
  await page.evaluate(h=>document.querySelector('iframe').srcdoc=h,html);
  await page.waitForFunction(()=>window.initialized);
  const ui=page.frameLocator('iframe');await ui.locator('.product').first().click();
  await ui.locator('.margin-table').waitFor();
  const table=await ui.locator('.margin-table').innerText();
  for(const text of ['보판','일판','즉판','희망 판매가','-11,600원','-4.4%','계산 불가','손해'])assert.ok(table.includes(text),text);
  assert.equal(await ui.locator('.margin-table tbody tr').count(),4);
  await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:1100});
  assert.equal(await page.frames()[1].evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  await ui.locator('.margin-table').screenshot({path:path.join(out,'margin-mobile.png')});
  assert.deepEqual(errors,[]);
  const result={at:new Date().toISOString(),passed:true,browser:'headless Edge',realMcpAppsBridge:true,realControlHandler:true,evidence:'fixture',desktopAndMobile:true,rows:4,noLiveCollectionOrAi:true,calls,browserErrors:errors};
  fs.writeFileSync(path.join(out,'ui-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();assert.ok(root.startsWith(path.join(os.tmpdir(),'cream-margin-ui-')));fs.rmSync(root,{recursive:true,force:true});}
