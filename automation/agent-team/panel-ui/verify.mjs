import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {handleMcp,runDirectory} from '../control-mcp.mjs';
import {startWork} from '../work-orders.mjs';
const base=fileURLToPath(new URL('../../../',import.meta.url));
const out=path.join(base,'kream-runs','dot-panel-verification');fs.mkdirSync(out,{recursive:true});
const installedFile=path.join(os.homedir(),'.codex/plugins/cache/cream-personal/cream-control/local/mcp.json');
const installedPlugin=fs.existsSync(installedFile);
const installed=JSON.parse(fs.readFileSync(installedPlugin?installedFile:path.join(base,'plugins/cream-control/mcp.json'),'utf8')).mcpServers.cream_panel;
const client=new Client({name:'cream-panel-verifier',version:'1.0.0'});
await client.connect(new StdioClientTransport({command:installed.command,args:installed.args,cwd:installed.cwd,stderr:'pipe'}));
const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='cream_work_start'));
const uiTool=tools.tools.find(t=>t.name==='cream_open_panel');
const resources=await client.readResource({uri:uiTool._meta.ui.resourceUri});const html=resources.contents[0].text;
const data=await client.callTool({name:'cream_open_panel',arguments:{}});assert.ok(data._meta.panel.runs.length);
const host=await build({stdin:{contents:`import {AppBridge,PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';
const frame=document.querySelector('iframe');
const bridge=new AppBridge(null,{name:'Cream isolated QA host',version:'1.0.0'},{serverTools:{},updateModelContext:{},message:{text:{}}},{hostContext:{theme:'light',displayMode:'inline'}});
bridge.oncalltool=params=>window.invokeCream(params);
bridge.onupdatemodelcontext=async params=>{window.lastContext=params;return {};};
bridge.onmessage=async params=>{window.lastMessage=params;return {};};
bridge.oninitialized=()=>{window.initialized=true;};
await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));window.hostReady=true;`,resolveDir:fileURLToPath(new URL('./',import.meta.url))},bundle:true,write:false,format:'esm',minify:true});
const browser=await chromium.launch({headless:true,channel:'msedge'});
const errors=[],calls=[];let mode='live-read',live=false,launches=0;
const options={root:fs.mkdtempSync(path.join(os.tmpdir(),'cream-panel-browser-')),isAlive:()=>live,launch:async dir=>{
  live=true;launches++;
  const seeds=JSON.parse(fs.readFileSync(path.join(dir,'products.json'),'utf8'));
  fs.writeFileSync(path.join(dir,'batch-state.json'),JSON.stringify({status:'judging',productCount:seeds.length,collected:seeds.length,judged:0,startedAt:new Date().toISOString(),results:[]}));
  for(const s of seeds){const target=path.join(dir,'judgments',s.kreamId);fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'team-state.json'),JSON.stringify({status:'running',actors:[],observations:[],calculations:[],events:[]}));}
  return {launched:true};
}};
async function newPage(width=1200){const p=await browser.newPage({viewport:{width,height:1100}});p.on('pageerror',e=>errors.push(e.message));await p.exposeFunction('invokeCream',async params=>{
  calls.push({mode,name:params.name,args:params.arguments});
  if(mode==='live-read'){assert.ok(['cream_panel_data','cream_open_panel','cream_panel_ready'].includes(params.name));return client.callTool(params);}
  const r=await handleMcp({method:'tools/call',params},options);
  if(params.name==='cream_batch_stop'){live=false;const dir=runDirectory(params.arguments.runId,options.root);const f=path.join(dir,'batch-state.json'),s=JSON.parse(fs.readFileSync(f,'utf8'));s.status='stopped';fs.writeFileSync(f,JSON.stringify(s));}
  return r;
});await p.setContent('<!doctype html><html><body style="margin:0"><iframe style="border:0;width:100%;height:1080px" title="Cream QA"></iframe></body></html>');await p.addScriptTag({type:'module',content:host.outputFiles[0].text});await p.waitForFunction(()=>window.hostReady);await p.evaluate(h=>document.querySelector('iframe').srcdoc=h,html);await p.waitForFunction(()=>window.initialized);return p;}
try{
  const page=await newPage();const f=page.frameLocator('iframe');await f.locator('.product').first().waitFor();await f.locator('.product').first().click();await f.locator('#detail h2').waitFor();
  assert.match(await f.locator('#detail').innerText(),/미확인/);assert.match(await f.locator('#detail').innerText(),/마일리지/);
  await page.screenshot({path:path.join(out,'panel-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:1000});assert.equal(await page.frames()[1].evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  await page.screenshot({path:path.join(out,'panel-mobile.png'),fullPage:true});await page.close();
  mode='fixture-control';startWork(options.root,{targetProducts:5,userInstruction:'Fixture user requested five products.',requestId:'fixture'});const p=await newPage();const ui=p.frameLocator('iframe');await ui.getByText('새 탐색을 시작하세요',{exact:true}).waitFor();await ui.locator('#new-run').click();
  const values={kreamId:'123',productUrl:'https://www.musinsa.com/products/456',model:'<img src=x onerror=alert(1)>',color:'BLACK',option:'L'};
  for(const [key,value]of Object.entries(values))await ui.locator(`input[name="${key}"]`).fill(value);
  await ui.getByRole('button',{name:'탐색 시작',exact:true}).click();await ui.locator('.product').waitFor();assert.equal(launches,1);assert.equal(await ui.locator('#products img').count(),0);
  await ui.locator('.product').click();await ui.locator('#detail h2').waitFor();await ui.locator('#instruction').fill('Check coupon eligibility.');await ui.locator('#steer').click();await ui.getByText(/지시를 등록했습니다/).waitFor();
  const id=fs.readdirSync(options.root)[0],inbox=path.join(options.root,id,'judgments','123','control');assert.equal(fs.readdirSync(inbox).filter(n=>n.endsWith('.json')).length,1);
  await ui.locator('#stop').click();await ui.getByText('중단됨',{exact:true}).waitFor();assert.ok(fs.existsSync(path.join(options.root,id,'STOP')));await ui.locator('#resume').click();await ui.getByText('AI 판단 중',{exact:true}).waitFor();assert.equal(launches,2);assert.ok(!fs.existsSync(path.join(options.root,id,'STOP')));
  await ui.locator('#ask-dot').click();await p.waitForFunction(()=>window.lastMessage);assert.match((await p.evaluate(()=>window.lastMessage)).content[0].text,/123/);
  await ui.locator('#new-run').click();await ui.locator('input[name="productUrl"]').fill('https://example.com/not-supported');await ui.getByRole('button',{name:'탐색 시작',exact:true}).click();await ui.locator('#notice.error').waitFor();assert.equal(launches,2);
  assert.equal(errors.length,0,errors.join('\n'));
  const result={at:new Date().toISOString(),passed:true,installedPluginStdioVerified:installedPlugin,sourceStdioVerified:true,toolCount:tools.tools.length,realSavedBatchRead:true,browser:'isolated headless Edge with actual MCP Apps AppBridge',desktopAndMobile:true,controls:'fixture worker; real control functions; no live AI launched',checks:['resource load','real saved evidence rendering','unknown profit preserved','responsive width','XSS escaped','start','steer queue','stop','resume','message bridge','invalid URL rejected'],browserErrors:errors,liveDotUiVerified:false,liveDotBlocker:'Computer-use browser access host unavailable; native Dot rendering and cloud/local routing not observed.'};
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await client.close();}
