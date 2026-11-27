import {chromium} from '../panel-ui/node_modules/playwright/index.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {createDashboardServer} from './server.mjs';
const out=path.resolve('kream-runs/herdr-dashboard');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
page.setDefaultTimeout(15000);
let fixtureApp;
try{
 await page.goto('http://127.0.0.1:8875/herdr?run=herdr-trial-20261126-01');await page.waitForFunction(()=>document.getElementById('connection').textContent.includes('연결됨'));
 assert.equal(await page.locator('#completed').textContent(),'2 / 2');assert.equal(await page.locator('#reviewed').textContent(),'0');assert.equal(await page.locator('#resume').isDisabled(),true);
 await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-herdr-ui-')),id='herdr-ui-fixture',dir=path.join(root,id);fs.mkdirSync(dir);
 const state={mission:{instruction:'화면 제어 검증용 합성 작업',source:'musinsa-ranking',targetProducts:2,maxTurns:5},root:path.join(root,'agent-teams'),session:'fixture',status:'stopped',turns:2,batches:[],history:[]};const save=()=>fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(state));save();let resumes=0,stops=0;
 const batchId='batch-11111111-1111-1111-1111-111111111111',teamDir=path.join(state.root,batchId,'judgments','123');fs.mkdirSync(teamDir,{recursive:true});
 state.batches=[{runId:batchId,productIds:['123'],paneId:'fixture:p2'}];save();
 const team={status:'running',actors:[{threadId:'owner',role:'owner',model:'gpt-6-luna',effort:'medium'},{threadId:'reviewer',role:'reviewer',model:'gpt-6.1-sol',effort:'high'}],events:[{at:new Date().toISOString(),threadId:'owner',type:'tool_started',tool:'request_review'},{at:new Date().toISOString(),threadId:'reviewer',type:'tool_started',tool:'read_observations'},{at:new Date().toISOString(),threadId:'reviewer',type:'agent_message',text:'원자료의 옵션과 거래 채널을 확인하고 있습니다.'}]};
 const saveTeam=()=>fs.writeFileSync(path.join(teamDir,'team-state.json'),JSON.stringify(team));saveTeam();fs.writeFileSync(path.join(teamDir,'runtime.lock'),String(process.pid));
 fixtureApp=createDashboardServer({runsRoot:root,root:state.root,port:0,manageHerdr:async(r,run,action)=>{assert.equal(run,id);if(action==='resume'){resumes++;state.status='running';fs.writeFileSync(path.join(dir,'controller.lock'),JSON.stringify({pid:process.pid}));}else{stops++;state.status='stopped';fs.unlinkSync(path.join(dir,'controller.lock'));}save();return {ok:true,message:'합성 제어 처리 완료'};}});
 const addr=await fixtureApp.listen();await page.goto(`http://127.0.0.1:${addr.port}/herdr`);await page.locator('#resume:not([disabled])').waitFor();await page.locator('#resume').click();await page.locator('#stop:not([disabled])').waitFor();assert.equal(resumes,1);
 assert.equal(await page.locator('.monitor-lane').count(),4);assert.match(await page.locator('#agents').textContent(),/검수 응답 대기/);assert.match(await page.locator('#agents').textContent(),/원자료 읽기/);assert.equal(await page.locator('.agent-node[data-activity="tool"]').count(),2);
 await page.getByRole('button',{name:'독립 검수 실행 중',exact:true}).click();assert.match(await page.locator('#node-inspector').textContent(),/원자료의 옵션/);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(out,'monitor-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:path.join(out,'agents-active-fixture.png'),fullPage:true});
 team.events.push({at:new Date().toISOString(),threadId:'reviewer',type:'turn_completed'});team.reviews=[{threadId:'reviewer'}];saveTeam();await page.waitForFunction(()=>!!document.querySelector('.agent-node[aria-label="독립 검수 종료"]'));
 await page.locator('#stop').click();await page.locator('#resume:not([disabled])').waitFor();assert.equal(stops,1);
 state.status='blocked';save();await page.waitForFunction(()=>document.getElementById('state').textContent==='진행 차단');
 await page.route('**/api/herdr*',route=>route.abort());await page.waitForFunction(()=>document.getElementById('connection').textContent.includes('연결 끊김'));assert.equal(await page.locator('#resume').isDisabled(),true);
 assert.deepEqual(errors,[]);const result={realSavedRunRendered:true,mobileNoOverflow:true,syntheticResume:resumes,syntheticStop:stops,pollUpdates:true,disconnectDisablesControl:true,browserErrors:errors,liveWorkResumed:false};fs.writeFileSync(path.join(out,'ui-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();if(fixtureApp)await new Promise(r=>fixtureApp.server.close(r));}
