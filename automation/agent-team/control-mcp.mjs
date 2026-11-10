import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {analysisProfile,MUSINSA_PROFILE} from './analysis-profiles.mjs';
import {groupProducts} from './packets.mjs';
import {panelData} from './panel-data.mjs';
import {workPolicy,workOrders,scopeStatus,startWork,reserveWork,stopWork,reopenWork,continueWorkUntilStopped,withWorkLock,explorationState} from './work-orders.mjs';
import {startExploration,discoveryStatus} from './exploration.mjs';
export const PANEL_URI='ui://cream/management-v2.html';
const PANEL_FILE=fileURLToPath(new URL('./panel-ui/dist/panel.html',import.meta.url));
const ROOT=fileURLToPath(new URL('../../kream-runs/agent-teams/',import.meta.url));
const BATCH=fileURLToPath(new URL('./batch.mjs',import.meta.url));
const CONTINUOUS=fileURLToPath(new URL('./musinsa-continuous.mjs',import.meta.url));
const WATCHDOG=fileURLToPath(new URL('./live-watchdog.mjs',import.meta.url));
const REMOTE_WATCHDOG=fileURLToPath(new URL('./remote-watchdog.mjs',import.meta.url));
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const runId={type:'string',pattern:'^batch-[a-f0-9-]{36}$'},str={type:'string'};
const workId={type:'string',pattern:'^work-[a-f0-9-]{36}$'},eventId={type:'string',pattern:'^evt-[a-f0-9]{64}$'};
const product=object({kreamId:str,productUrl:str,model:str,color:str,option:str});
export const controlTools=[
  {name:'cream_open_panel',title:'Cream 상품 관리',description:'Request the Cream management UI in this conversation. A successful tool call does NOT mean the host displayed it. Never say the panel opened without a client-ready signal or user confirmation.',inputSchema:object({runId,productId:str},[]),outputSchema:{type:'object',properties:{version:{type:'string'},run:{type:['object','null'],additionalProperties:true},productCount:{type:'integer'},selectedProduct:{type:['string','null']},uiStatus:{type:'string'},displayVerified:{type:'boolean'}},required:['version','run','productCount','selectedProduct','uiStatus','displayVerified'],additionalProperties:false},_meta:{ui:{resourceUri:PANEL_URI,visibility:['model','app']},'ui/resourceUri':PANEL_URI,'openai/outputTemplate':PANEL_URI,'openai/widgetAccessible':true,'openai/toolInvocation/invoking':'관리 화면 요청 중','openai/toolInvocation/invoked':'화면 표시 확인 필요','openai/ui':{entrypoints:[{type:'global'},{type:'thread'}]}}},
  {name:'cream_panel_ready',description:'UI-only acknowledgement after the panel renders. Acknowledge a mounted component; never call this from the model to simulate a display.',inputSchema:object({uiVersion:str}),_meta:{ui:{visibility:['app']},'openai/visibility':'private','openai/widgetAccessible':true}},
  {name:'cream_panel_data',description:'Refresh Cream management data or read one product detail. Does not collect products, run models, or open desktop windows.',inputSchema:object({runId,productId:str},[]),_meta:{ui:{visibility:['app','model']}}},
  {name:'cream_work_start',description:'Open a new work order ONLY after the user specifies the number of products or answers the scope question. Ask how many at the start of each new user work request; never silently choose 100. Record their actual instruction. Does not launch collection. Reuse requestId on retries.',inputSchema:object({targetProducts:{type:'integer',minimum:1},userInstruction:str,requestId:{type:'string',minLength:1,maxLength:160}})},
  {name:'cream_musinsa_profit_work_start',description:'Open a Musinsa ranking work order only when the user explicitly requests finding N profitable candidates, not merely inspecting N products. Counts distinct independently reviewed adopted candidates with positive margin, available matched stock and recent sales evidence. No purchases.',inputSchema:object({targetProfitableProducts:{type:'integer',minimum:1},userInstruction:str,requestId:{type:'string',minLength:1,maxLength:160}})},
  {name:'cream_musinsa_work_continue',description:'When the user explicitly requests continuous Musinsa ranking exploration until stopped, extend an existing profit work order and launch its background PC supervisor. Saved ranking position and cross-request deduplication remain. No purchases.',inputSchema:object({workId})},
  {name:'cream_work_stop',description:'Stop the specified work order and request interruption of its batches. Retains results and prevents further automatic starts in that scope.',inputSchema:object({workId})},
  {name:'cream_explore_start',description:'Start deterministic full-catalog exploration for an existing user-confirmed work order. Continues the saved popularity-feed cursor and category rotation across separate user requests; no discovery AI. The PC automatically runs all remaining batches within N (5 per batch, 2 product AI agents). Do not supply handpicked seeds or launch another batch from completion events while this runner manages the work. Retry with the same workId. Set resume=true only for an explicit continuation of interrupted work.',inputSchema:object({workId,resume:{type:'boolean'}},['workId'])},
  {name:'cream_discovery_status',description:'Read persistent discovery cursor, category queues, coverage limitations and work progress. No collection or AI calls.',inputSchema:object({},[])},
  {name:'cream_batch_start',description:'Collect up to 5 product packets, then separate Codex agents judge them, within a user-confirmed work order. No daily 100 cap. Read cream_batch_status first. For an event-triggered follow-up pass triggerEventId; the server enforces one follow-up per event and the work product limit. No purchases or desktop UI.',inputSchema:object({products:{type:'array',items:product,minItems:1,maxItems:5},concurrency:{type:'integer',minimum:1,maximum:2},workId,triggerEventId:eventId,requestId:{type:'string',minLength:1,maxLength:160}},['products'])},
  {name:'cream_musinsa_batch_start',description:'Analyze matched Musinsa ranking candidates using margin rate, option stock and recent sales trends. Deterministic ranking selection, focused product AI and independent review; no broad research. Requires an existing user-confirmed N work order and exact source options. Read batch status first. Does not perform KREAM matching or start general discovery.',inputSchema:object({products:{type:'array',items:product,minItems:1,maxItems:5},concurrency:{type:'integer',minimum:1,maximum:2},workId,requestId:{type:'string',minLength:1,maxLength:160}},['products'])},
  {name:'cream_batch_status',description:'Read collection/AI progress and per-product decisions. Without runId returns recent runs, user-confirmed work limit, reserved/remaining counts and active batches. Pass eventId to check whether its follow-up already started. No active work means wait for the next user request and ask its product count.',inputSchema:object({runId,eventId},[])},
  {name:'cream_batch_steer',description:'Send a follow-up instruction to active product agents. Use a productId to target one product. Queued delivery is not proof of execution.',inputSchema:object({runId,productId:str,message:str},['runId','message'])},
  {name:'cream_batch_stop',description:'Stop new collection and request interruption of active product judgments; state is retained.',inputSchema:object({runId})},
  {name:'cream_batch_resume',description:'Resume a saved batch after an explicit continuation request. Reuses valid packets and completed judgments; expired collection is refreshed.',inputSchema:object({runId})},
].map(x=>({...x,_meta:{ui:{visibility:['model','app']},'openai/widgetAccessible':true,...x._meta},annotations:{readOnlyHint:['cream_discovery_status','cream_batch_status','cream_open_panel','cream_panel_data'].includes(x.name),destructiveHint:false,openWorldHint:!['cream_discovery_status','cream_batch_status','cream_open_panel','cream_panel_data','cream_panel_ready'].includes(x.name)}}));
export function runDirectory(id,root=ROOT) {
  if(typeof id!=='string'||!/^batch-[a-f0-9-]{36}$/.test(id))throw Error('INVALID_RUN_ID');
  const dir=path.resolve(root,id);if(path.dirname(dir)!==path.resolve(root))throw Error('RUN_OUTSIDE_ROOT');return dir;
}
async function launch(dir,resume=false) {
  const stateFile=path.join(dir,'process.json');
  if(fs.existsSync(stateFile)){const old=JSON.parse(fs.readFileSync(stateFile,'utf8'));try{process.kill(old.pid,0);throw Error('BATCH_ALREADY_RUNNING');}catch(e){if(e.message==='BATCH_ALREADY_RUNNING')throw e;}}
  const output=fs.openSync(path.join(dir,'runtime.log'),'a');
  const launchInfo=JSON.parse(fs.readFileSync(path.join(dir,'launch.json'),'utf8'));
  const args=[BATCH,`--analysis-profile=${analysisProfile(launchInfo.analysisProfile)}`,`--seeds=${path.join(dir,'products.json')}`,`--out=${dir}`,`--concurrency=${JSON.parse(fs.readFileSync(path.join(dir,'launch.json'),'utf8')).concurrency}`];
  if(resume)args.push('--resume');
  const child=spawn(process.execPath,args,{cwd:fileURLToPath(new URL('../../',import.meta.url)),windowsHide:true,detached:true,stdio:['ignore',output,output]});
  try{await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}finally{fs.closeSync(output);}
  child.unref();fs.writeFileSync(stateFile,JSON.stringify({pid:child.pid,launchedAt:new Date().toISOString()}));
  return {launched:true,pid:child.pid};
}
export async function control(name,args={},options={}) {
  const root=options.root||ROOT;fs.mkdirSync(root,{recursive:true});
  if(!controlTools.some(t=>t.name===name))throw Error('UNKNOWN_CONTROL_TOOL');
  if(name==='cream_panel_ready')return {acknowledged:true,scope:'local-ui-test'};
  if(name==='cream_open_panel'||name==='cream_panel_data')return panelData(args,options);
  if(['cream_work_start','cream_musinsa_profit_work_start'].includes(name))return withWorkLock(root,()=>startWork(root,args));
  if(name==='cream_musinsa_work_continue')return withWorkLock(root,async()=>{
    const summary=continueWorkUntilStopped(root,args.workId),dir=path.join(root,'explorations',args.workId),lock=path.join(dir,'continuous.lock');
    const ensureWatchdog=async()=>{
      if(!options.launchWatchdog){
        const remoteLock=path.join(dir,'remote-watchdog.lock');let remoteAlive=false;
        if(fs.existsSync(remoteLock))try{process.kill(Number(fs.readFileSync(remoteLock,'utf8')),0);remoteAlive=true;}catch{}
        if(!remoteAlive){fs.mkdirSync(dir,{recursive:true});const output=fs.openSync(path.join(dir,'remote-watchdog.log'),'a');
          const child=spawn(process.execPath,[REMOTE_WATCHDOG,`--root=${root}`,`--work=${args.workId}`],{cwd:fileURLToPath(new URL('../../',import.meta.url)),windowsHide:true,detached:true,stdio:['ignore',output,output]});
          try{await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}finally{fs.closeSync(output);}child.unref();}
      }
      const watchdogLock=path.join(dir,'watchdog.lock');if(fs.existsSync(watchdogLock))try{process.kill(Number(fs.readFileSync(watchdogLock,'utf8')),0);return;}catch{}
      if(options.launchWatchdog){await options.launchWatchdog({root,workId:args.workId});return;}
      fs.mkdirSync(dir,{recursive:true});const output=fs.openSync(path.join(dir,'watchdog.log'),'a');
      const child=spawn(process.execPath,[WATCHDOG,`--root=${root}`,`--work=${args.workId}`],{cwd:fileURLToPath(new URL('../../',import.meta.url)),windowsHide:true,detached:true,stdio:['ignore',output,output]});
      try{await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}finally{fs.closeSync(output);}child.unref();
    };
    if(fs.existsSync(lock)){let running=false;try{process.kill(Number(fs.readFileSync(lock,'utf8')),0);running=true;}catch{}if(running){await ensureWatchdog();return {...summary,launched:false,reused:true};}}
    if(options.launchContinuous){const launched=await options.launchContinuous({root,workId:args.workId});await ensureWatchdog();return {...summary,...launched};}
    fs.mkdirSync(dir,{recursive:true});const output=fs.openSync(path.join(dir,'continuous.log'),'a');
    const child=spawn(process.execPath,[CONTINUOUS,`--root=${root}`,`--work=${args.workId}`],{cwd:fileURLToPath(new URL('../../',import.meta.url)),windowsHide:true,detached:true,stdio:['ignore',output,output]});
    try{await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}finally{fs.closeSync(output);}
    child.unref();await ensureWatchdog();return {...summary,launched:true,pid:child.pid};
  });
  if(name==='cream_work_stop')return withWorkLock(root,()=>stopWork(root,args.workId));
  if(name==='cream_explore_start')return startExploration(root,args,options);
  if(name==='cream_discovery_status')return {discovery:discoveryStatus(root),work:scopeStatus(root)};
  const profile=name==='cream_musinsa_batch_start'?MUSINSA_PROFILE:'general';
  if(name==='cream_musinsa_batch_start')name='cream_batch_start';
  if(name==='cream_batch_start'){
    if(profile!=='musinsa-ranking'&&workOrders(root).some(w=>w.id===args.workId&&w.scopeMode==='profitable-results'))throw Error('MUSINSA_PROFILE_REQUIRED');
    return withWorkLock(root,async()=>{
    if(workOrders(root).some(w=>{const e=explorationState(root,w.id);return w.status!=='stopped'&&e&&(e.workerAlive||e.status!=='complete');}))throw Error('EXPLORATION_MANAGES_BATCHES: read status; resume the same exploration instead of launching a separate batch');
    const groups=groupProducts(args.products),concurrency=args.concurrency??2;
    if(groups.length>workPolicy.maxBatchProducts)throw Error('BATCH_PRODUCT_LIMIT: 5');
    if(!Number.isInteger(concurrency)||concurrency<1||concurrency>workPolicy.maxConcurrentProducts)throw Error('INVALID_CONCURRENCY');
    if(args.requestId!==undefined&&(typeof args.requestId!=='string'||!args.requestId.trim()||args.requestId.length>160))throw Error('INVALID_REQUEST_ID');
    if(args.triggerEventId!==undefined&&!/^evt-[a-f0-9]{64}$/.test(args.triggerEventId))throw Error('INVALID_EVENT_ID');
    const key=args.triggerEventId?'event:'+args.triggerEventId:args.requestId;
    const hash=key?crypto.createHash('sha256').update(key).digest('hex').slice(0,32):null;
    const id=`batch-${hash?hash.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5'):crypto.randomUUID()}`,dir=runDirectory(id,root);
    if(fs.existsSync(dir)){
      if(!key)throw Error('BATCH_ID_CONFLICT');
      const savedLaunch=JSON.parse(fs.readFileSync(path.join(dir,'launch.json'),'utf8'));
      if(analysisProfile(savedLaunch.analysisProfile)!==profile)throw Error('REQUEST_ID_PROFILE_CONFLICT');
      const file=path.join(dir,'products.json');
      if(!fs.existsSync(file))return {runId:id,launched:false,reused:true,status:'start_not_confirmed'};
      if(JSON.stringify(groupProducts(JSON.parse(fs.readFileSync(file,'utf8'))))!==JSON.stringify(groups))throw Error('REQUEST_ID_SCOPE_CONFLICT');
      return {runId:id,productCount:groups.length,launched:false,reused:true};
    }
    const assignedWork=reserveWork(root,{workId:args.workId,runId:id,productCount:groups.length,triggerEventId:args.triggerEventId,requestId:key,scopeHash:crypto.createHash('sha256').update(JSON.stringify(groups)).digest('hex')});
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir,'products.json'),JSON.stringify(args.products,null,2));fs.writeFileSync(path.join(dir,'launch.json'),JSON.stringify({concurrency,analysisProfile:profile,workId:assignedWork,requestId:key||null,triggerEventId:args.triggerEventId||null,createdAt:new Date().toISOString()}));
    return {runId:id,workId:assignedWork,productCount:groups.length,...await (options.launch||launch)(dir)};
    });
  }
  if(name==='cream_batch_status'&&!args.runId)return {runs:fs.readdirSync(root).filter(n=>/^batch-[a-f0-9-]{36}$/.test(n)).sort((a,b)=>fs.statSync(path.join(root,b)).birthtimeMs-fs.statSync(path.join(root,a)).birthtimeMs).slice(0,30),work:scopeStatus(root,args)};
  const dir=runDirectory(args.runId,root);if(!fs.existsSync(path.join(dir,'products.json')))throw Error('BATCH_NOT_FOUND');
  if(name==='cream_batch_status'){
    const file=path.join(dir,'batch-state.json'),state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{status:'starting',runId:args.runId};
    const marginProducts=panelData({runId:args.runId},options).products;
    state.margins=marginProducts.map(p=>({productId:p.productId,...p.margins}));
    state.marketSchemas=marginProducts.flatMap(p=>p.marketSchemas);
    let workerAlive=false;try{const p=JSON.parse(fs.readFileSync(path.join(dir,'process.json'),'utf8'));process.kill(p.pid,0);workerAlive=true;}catch{}
    if(['collecting','judging','starting'].includes(state.status)&&!workerAlive)return {...state,storedStatus:state.status,status:'needs_attention',error:'WORKER_NOT_RUNNING',workerAlive};
    return {...state,workerAlive};
  }
  const judgments=path.join(dir,'judgments'),ids=fs.existsSync(judgments)?fs.readdirSync(judgments).filter(n=>/^(?:\d{1,12}|poizon-\d{1,18})$/.test(n)):[];
  if(name==='cream_batch_stop'){
    const launchInfo=JSON.parse(fs.readFileSync(path.join(dir,'launch.json'),'utf8'));if(launchInfo.workId)await withWorkLock(root,()=>stopWork(root,launchInfo.workId));
    fs.writeFileSync(path.join(dir,'STOP'),'requested');for(const id of ids)fs.writeFileSync(path.join(judgments,id,'STOP'),'requested');return {stopRequested:true,runId:args.runId};
  }
  if(name==='cream_batch_resume'){
    return withWorkLock(root,async()=>{
    const saved=fs.existsSync(path.join(dir,'batch-state.json'))?JSON.parse(fs.readFileSync(path.join(dir,'batch-state.json'),'utf8')):null;
    if(saved?.status==='complete')return {runId:args.runId,launched:false,reused:true,status:'complete'};
    const launchInfo=JSON.parse(fs.readFileSync(path.join(dir,'launch.json'),'utf8'));
    if(launchInfo.managedBy==='deterministic-exploration')throw Error('USE_CREAM_EXPLORE_START_RESUME: resume the work-level loop with the same workId');
    const work=workOrders(root).find(w=>w.id===launchInfo.workId);
    if(!work)throw Error('USER_WORK_SCOPE_REQUIRED: ask for the scope before resuming legacy work');
    const processInfo=fs.existsSync(path.join(dir,'process.json'))?JSON.parse(fs.readFileSync(path.join(dir,'process.json'),'utf8')):null;
    if(processInfo?.pid){let alive=false;try{process.kill(processInfo.pid,0);alive=true;}catch{}if(alive)throw Error('BATCH_ALREADY_RUNNING');}
    reopenWork(root,work.id);
    for(const file of [path.join(dir,'STOP'),...ids.map(id=>path.join(judgments,id,'STOP'))])if(fs.existsSync(file))fs.unlinkSync(file);
    return {runId:args.runId,...await (options.launch||launch)(dir,true)};
    });
  }
  if(typeof args.message!=='string'||!args.message.trim()||args.message.length>12000)throw Error('INVALID_INSTRUCTION');
  const selected=args.productId?ids.filter(id=>id===args.productId):ids;const queued=[];
  for(const id of selected){
    const stateFile=path.join(judgments,id,'team-state.json');if(!fs.existsSync(stateFile))continue;
    const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(state.status!=='running')continue;
    const inbox=path.join(judgments,id,'control');fs.mkdirSync(inbox,{recursive:true});const filename=path.join(inbox,`message-${crypto.randomUUID()}.json`);
    fs.writeFileSync(filename,JSON.stringify({message:args.message}));queued.push(id);
  }
  return {runId:args.runId,queuedProductIds:queued,delivered:false,...(!queued.length?{reason:'NO_ACTIVE_PRODUCT_AGENT'}:{})};
}
export async function handleMcp(request,options={}) {
  if(request.method==='initialize')return {protocolVersion:'2025-06-18',capabilities:{tools:{},resources:{}},serverInfo:{name:'cream-agent-team',version:'0.2.0'},instructions:'Use cream_open_panel for the in-conversation product manager. Product decisions belong to the per-product Codex AI. All No1 operations remain background-only. A local installation does not establish cloud Dot access.'};
  if(request.method==='tools/list')return {tools:controlTools};
  if(request.method==='resources/list')return {resources:[{uri:PANEL_URI,name:'Cream 상품 관리',mimeType:'text/html;profile=mcp-app'}]};
  if(request.method==='resources/templates/list')return {resourceTemplates:[]};
  if(request.method==='resources/read'){
    if(request.params?.uri!==PANEL_URI)throw Error('RESOURCE_NOT_FOUND');
    return {contents:[{uri:PANEL_URI,mimeType:'text/html;profile=mcp-app',text:fs.readFileSync(PANEL_FILE,'utf8'),_meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}},'openai/ui':{availableDisplayModes:['inline','fullscreen']},'openai/widgetDescription':'Cream 상품별 AI 판단과 작업 제어 화면.','openai/widgetPrefersBorder':true}}]};
  }
  if(request.method==='ping')return {};
  if(request.method!=='tools/call')throw Error('METHOD_NOT_SUPPORTED');
  try {
    const data=await control(request.params.name,request.params.arguments,options);
    if(['cream_open_panel','cream_panel_data'].includes(request.params.name))return {structuredContent:{version:data.version,run:data.selectedRun,productCount:data.products.length,selectedProduct:data.detail?.productId||null,uiStatus:'render_requested',displayVerified:false},_meta:{panel:data},content:[{type:'text',text:JSON.stringify({uiStatus:'render_requested',displayVerified:false,note:'The data request succeeded. This is not proof that the host displayed a panel. Do not claim it opened without a UI-ready signal or user confirmation.',run:data.selectedRun,products:data.products.map(p=>({productId:p.productId,status:p.status,decision:p.decision,reason:p.reason,margins:p.margins,marketSchemas:p.marketSchemas}))})}],isError:false};
    return {structuredContent:data,content:[{type:'text',text:JSON.stringify(data)}],isError:false};
  } catch(e){return {content:[{type:'text',text:e.message}],isError:true};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const lines=readline.createInterface({input:process.stdin});
  lines.on('line',async line=>{
    let request;try{request=JSON.parse(line);}catch{return;}if(request.id===undefined)return;
    const send=result=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
    try{
      send(await handleMcp(request));
    }catch(e){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32602,message:e.message}})+'\n');}
  });
}
