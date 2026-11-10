import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {BackgroundClient} from '../no1-background/client.mjs';
import {CONNECTOR_VERSION} from '../no1-background/chrome-extension/protocol.mjs';
import {codexExecutable} from '../codex-cli.mjs';
import {workOrders, workSummary} from './work-orders.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const safeError = error => /^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message) ? error.message : 'CHECK_FAILED';
export function inspectContinuity(root) {
  const file = path.join(root, 'discovery', 'discovery.sqlite');
  const works = workOrders(root).map(work => {
    const s = workSummary(root, work);
    return {workId:s.workId,status:s.status,targetProducts:s.targetProducts,reservedProducts:s.reservedProducts,
      remainingProducts:s.remainingProducts,judgedProducts:s.judgedProducts,activeRunIds:s.activeRunIds};
  });
  if (!fs.existsSync(file)) return {database:'absent',works,newCatalog:works.length===0};
  const db = new DatabaseSync(file, {readOnly:true, timeout:3000});
  try {
    if (Object.values(db.prepare('PRAGMA quick_check').get())[0] !== 'ok') throw Error('DISCOVERY_DATABASE_CORRUPT');
    const meta = Object.fromEntries(db.prepare('SELECT key,value FROM meta').all().map(r=>[r.key,JSON.parse(r.value)]));
    return {database:'ok',cursor:meta.cursor,nextCategoryIndex:meta.turn,exhausted:meta.exhausted,
      counts:db.prepare('SELECT COUNT(*) AS observed, COUNT(CASE WHEN batch_id IS NULL THEN 1 END) AS waiting FROM candidates').get(),works};
  } finally { db.close(); }
}
export function checkCodex() {
  const r = spawnSync(codexExecutable(), ['login','status'], {encoding:'utf8',windowsHide:true,timeout:10000});
  // Do not return CLI output, account details, or credential files.
  return {installed:!r.error,authenticated:r.status===0&&/logged in/i.test((r.stdout||'')+(r.stderr||''))};
}
export function inspectDotConfig(localAppData=process.env.LOCALAPPDATA) {
  if (!localAppData) return {configured:false};
  const file = path.join(localAppData,'CreamDotBridge','connection.json');
  if (!fs.existsSync(file)) return {configured:false};
  try {
    const c = JSON.parse(fs.readFileSync(file,'utf8'));
    return {configured:/^https:\/\/[a-z0-9.-]+\.chatgpt\.site$/.test(c.origin)&&
      typeof c.serviceToken==='string'&&Boolean(c.serviceToken)&&typeof c.bridgeKey==='string'&&Boolean(c.bridgeKey),
      remoteRoundTripVerified:false};
  } catch { return {configured:false,code:'DOT_CONFIG_INVALID'}; }
}
export async function preflight({root=path.join(ROOT,'kream-runs','agent-teams'),client=new BackgroundClient(),
  codex=checkCodex,dot=inspectDotConfig}={}) {
  const checks={},blockers=[];
  const fail=(area,code)=>blockers.push({area,code});
  try { checks.continuity=inspectContinuity(root); if(checks.continuity.database==='absent'&&!checks.continuity.newCatalog)fail('continuity','DISCOVERY_DATABASE_MISSING'); }
  catch(error){checks.continuity={ok:false,code:safeError(error)};fail('continuity','CONTINUITY_CHECK_FAILED');}
  checks.codex=await codex(); if(!checks.codex.authenticated)fail('codex','CODEX_LOGIN_REQUIRED');
  checks.dot=await dot();
  try {
    const s=await client.status();checks.no1={browserConnected:s.browserConnected===true,connectorVersion:s.connectorVersion};
    if(!s.browserConnected)fail('no1','NO1_BRIDGE_DISCONNECTED');
    else if(s.connectorVersion!==CONNECTOR_VERSION)fail('no1','NO1_CONNECTOR_UPDATE_REQUIRED');
    else {
      const settings=await client.request('settings:get');checks.no1.backgroundMode=settings.kreamApiBrowser==='electron';
      if(!checks.no1.backgroundMode)fail('no1','NO1_BACKGROUND_MODE_REQUIRED');
      else {
        const musinsa=await client.request('musinsa:ranking:check-login');checks.no1.musinsaAuthenticated=musinsa.isLoggedIn===true;
        if(!musinsa.isLoggedIn)fail('no1','MUSINSA_LOGIN_REQUIRED');
        const kream=await client.request('platform:status',{platform:'kream'});checks.no1.kreamAuthenticated=kream.sessions?.[0]?.status==='active';
        if(!checks.no1.kreamAuthenticated)fail('no1','KREAM_LOGIN_REQUIRED');
      }
    }
  } catch(error){const code=safeError(error);checks.no1={...checks.no1,code};fail('no1',code);}
  const works=checks.continuity?.works||[],resumableWorks=works.filter(w=>!['complete'].includes(w.status));
  return {checkedAt:new Date().toISOString(),node:process.version,localReady:blockers.length===0,
    dotReady:checks.dot.configured?null:false,dotPrerequisitesReady:blockers.length===0&&checks.dot.configured===true,checks,blockers,
    dotBlockers:checks.dot.configured?[]:[{area:'dot',code:'DOT_BRIDGE_NOT_CONFIGURED'}],resumableWorks,
    liveProductWorkflowVerified:false,productCollectionStarted:false,workScopeChanged:false,
    nextAction:blockers.length?'resolve_connection_blockers':resumableWorks.length?'resume_existing_work_with_its_original_scope':'await_new_product_count'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const result=await preflight();console.log(JSON.stringify(result,null,2));if(!result.localReady)process.exitCode=2;
}
