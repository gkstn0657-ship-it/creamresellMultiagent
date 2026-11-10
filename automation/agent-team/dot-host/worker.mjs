import {panelHtml,tools,PANEL_URI,workPolicy,discoveryPolicy} from './assets.mjs';
import {eventMethod,acceptEvent,deliverEvents,eventsStatus,subscriptionDiagnostic,recordSubscriptionAttempt,webhookRuntimeCheck} from './events.mjs';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const fail=message=>({content:[{type:'text',text:message}],isError:true});
const uuid=s=>typeof s==='string'&&/^[a-f0-9-]{36}$/.test(s);
export const instructions='This private MCP forwards Cream actions to the connected PC. No1 stays background-only. For each NEW user exploration request ask N unless already specified, then cream_work_start with the actual instruction and count, then cream_explore_start(workId). Exploration is fixed code with NO AI: persistent popularity cursor, category rotation and deduplication across user requests. The PC automatically completes the remaining batches within N; only per-product profitability judgment and independent review use Codex AI. Do not choose seeds, change category weights, or start follow-up batches while exploration manages the work. On cream.batch.finished read cream_batch_status and cream_discovery_status and report progress; the PC loop owns continuation. There is no fixed daily limit; at most 5 products per batch, 2 concurrent product judgments and 1 active batch. A stopped/failed run requires explicit continuation using cream_explore_start with the SAME workId and resume=true. On source/auth failures report the blocker without UI or repeat attempts. Missing source offers or unsupported retailers are unknown, not proven losses. An exhausted feed is not proof the entire market was scanned. Never invent a count, create a new scope yourself, or claim UI display from tool success.';
async function body(request,max=150000){const t=await request.text();if(t.length>max)throw Error('REQUEST_TOO_LARGE');return JSON.parse(t);}
const secretOK=(request,env)=>Boolean(env.CREAM_BRIDGE_KEY&&request.headers.get('x-cream-bridge-key')===env.CREAM_BRIDGE_KEY);
async function bridgeState(env){return await env.DB.prepare('SELECT seen_at FROM cream_bridge WHERE id = 1').first();}
async function markUi(env,field){const allowed=['last_open_at','resource_served_at','client_ready_at'];if(!allowed.includes(field))throw Error('INVALID_UI_EVENT');await env.DB.prepare(`INSERT INTO cream_ui_status (id, ${field}) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET ${field}=excluded.${field}`).bind(Date.now()).run();}
export default {async fetch(request,env){
  const url=new URL(request.url);
  try{
    if(url.pathname==='/')return new Response('Cream MCP is ready. Open Cream 상품 관리 in your Dot conversation.',{headers:{'content-type':'text/plain; charset=utf-8'}});
    if(url.pathname.startsWith('/bridge/')){
      if(!secretOK(request,env))return json({error:'UNAUTHORIZED'},401);
      if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
      if(url.pathname==='/bridge/event-runtime-check')return json(await webhookRuntimeCheck());
      if(url.pathname==='/bridge/events'){const event=await body(request);const result=await acceptEvent(event,env);await deliverEvents(env);return json(result);}
      if(url.pathname==='/bridge/event-tick'){await deliverEvents(env);return json({ok:true});}
      if(url.pathname==='/bridge/claim'){
        const now=Date.now();
        await env.DB.prepare('INSERT INTO cream_bridge (id, seen_at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at').bind(now).run();
        await env.DB.prepare("DELETE FROM cream_jobs WHERE created_at < ?").bind(now-3600000).run();
        const job=await env.DB.prepare("UPDATE cream_jobs SET state='claimed' WHERE id = (SELECT id FROM cream_jobs WHERE state='pending' AND expires_at > ? ORDER BY created_at LIMIT 1) AND state='pending' RETURNING id, name, args").bind(now).first();
        return json({job:job?{id:job.id,name:job.name,arguments:JSON.parse(job.args)}:null});
      }
      if(url.pathname==='/bridge/result'){
        const b=await body(request,4000000);if(!uuid(b.id)||!b.result||typeof b.result!=='object')return json({error:'INVALID_RESULT'},400);
        await env.DB.prepare("UPDATE cream_jobs SET state='done', result=? WHERE id=? AND state='claimed'").bind(JSON.stringify(b.result),b.id).run();return json({ok:true});
      }
      if(url.pathname!=='/bridge/check')return json({error:'NOT_FOUND'},404);
    }
    if(!['/mcp','/bridge/check'].includes(url.pathname))return json({error:'NOT_FOUND'},404);
    if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
    const q=await body(request),ok=result=>json({jsonrpc:'2.0',id:q.id,result});
    if(url.pathname==='/mcp')console.log(JSON.stringify({event:'mcp_request',method:q.method,tool:q.method==='tools/call'?q.params?.name:undefined,uri:q.method==='resources/read'?q.params?.uri:undefined}));
    if(url.pathname==='/bridge/check'&&q.method==='tools/call'&&!['cream_connection_status','cream_discovery_status','cream_panel_data','cream_open_panel','cream_batch_status'].includes(q.params?.name))return ok(fail('DIAGNOSTIC_READ_ONLY'));
    if(q.method==='server/discover')return ok({resultType:'complete',supportedVersions:['2026-07-28','2025-06-18'],capabilities:{tools:{},resources:{},events:{}},serverInfo:{name:'Cream 상품 관리',version:'0.5.0'}});
    if(q.method==='initialize')return ok({protocolVersion:q.params?.protocolVersion==='2026-07-28'?'2026-07-28':'2025-06-18',capabilities:{tools:{},resources:{},events:{}},serverInfo:{name:'cream-dot-control',version:'0.5.0'},instructions});
    if(q.method?.startsWith('events/')){
      if(url.pathname==='/bridge/check'&&q.method!=='events/list')return json({jsonrpc:'2.0',id:q.id,error:{code:-32601,message:'DIAGNOSTIC_READ_ONLY'}});
      const owner=request.headers.get('oai-authenticated-user-id');
      try{
        const result=await eventMethod(q,env,owner);
        if(q.method==='events/subscribe')await recordSubscriptionAttempt(env,subscriptionDiagnostic(q,owner));
        return ok(result);
      }catch(e){
        const diagnostic=subscriptionDiagnostic(q,owner,e);
        console.error(JSON.stringify({event:'mcp_event_error',method:q.method,...diagnostic}));
        if(q.method==='events/subscribe'&&owner)await recordSubscriptionAttempt(env,diagnostic);
        return json({jsonrpc:'2.0',id:q.id,error:{code:diagnostic.code==='CALLBACK_VERIFICATION_FAILED'?-32015:-32602,message:diagnostic.code,data:{reason:diagnostic.reason||'invalid_request'}}});
      }
    }
    if(q.id===undefined)return new Response(null,{status:202});
    if(q.method==='ping')return ok({});
    if(q.method==='tools/list')return ok({tools:[...tools,{name:'cream_connection_status',description:'Check PC connectivity and the most recent UI load signals. Tool success does not prove a panel displayed. Client-ready is a reported event across clients, not proof for this conversation.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}]});
    if(q.method==='resources/list')return ok({resources:[{uri:PANEL_URI,name:'Cream 상품 관리',mimeType:'text/html;profile=mcp-app'}]});
    if(q.method==='resources/templates/list')return ok({resourceTemplates:[]});
    if(q.method==='resources/read'){
      if(q.params?.uri!==PANEL_URI)return json({jsonrpc:'2.0',id:q.id,error:{code:-32602,message:'RESOURCE_NOT_FOUND'}});
      if(url.pathname==='/mcp')await markUi(env,'resource_served_at');
      return ok({contents:[{uri:PANEL_URI,mimeType:'text/html;profile=mcp-app',text:panelHtml,_meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}},'openai/ui':{availableDisplayModes:['inline','fullscreen']},'openai/widgetPrefersBorder':true}}]});
    }
    if(q.method!=='tools/call')return json({jsonrpc:'2.0',id:q.id,error:{code:-32601,message:'METHOD_NOT_FOUND'}});
    // Sites enforces owner-private access before forwarding. Tool actions also require a user identity;
    // the owner's service credential + separate bridge key is used only for integration checks.
    if(!request.headers.get('oai-authenticated-user-id')&&!secretOK(request,env))return ok(fail('AUTHENTICATED_OWNER_REQUIRED'));
    const state=await bridgeState(env),online=Boolean(state&&Date.now()-state.seen_at<20000),name=q.params?.name;
    if(name==='cream_connection_status'){
      const ui=await env.DB.prepare('SELECT * FROM cream_ui_status WHERE id=1').first();
      const display=ui?.client_ready_at&&ui.client_ready_at>=ui.last_open_at?'client_reported_ready':'not_observed';
      return ok({structuredContent:{online,lastSeenAt:state?new Date(state.seen_at).toISOString():null,backgroundOnly:true,workPolicy,discoveryPolicy,events:await eventsStatus(env),ui:{...ui,display,scope:'latest signal across clients, not proof for this conversation'}},content:[{type:'text',text:(online?'PC 연결 정상':'PC 연결 대기')+' · 사용자가 N개를 정하면 cream_work_start → cream_explore_start로 고정 순환 탐색을 시작합니다. 탐색 AI는 없고 상품 판단 AI는 유지됩니다. 관리 화면 표시: '+display+'.'}]});
    }
    if(name==='cream_panel_ready'){
      if(typeof q.params.arguments?.uiVersion!=='string'||q.params.arguments.uiVersion.length>64)return ok(fail('INVALID_UI_ACK'));
      await markUi(env,'client_ready_at');return ok({content:[{type:'text',text:'UI client ready acknowledged.'}],structuredContent:{acknowledged:true}});
    }
    if(!tools.some(t=>t.name===name))return ok(fail('UNKNOWN_CONTROL_TOOL'));
    if(!online)return ok(fail('PC_OFFLINE: 연결된 PC의 Cream 백그라운드 연결이 필요합니다. 작업은 시작하지 않았습니다.'));
    if(name==='cream_open_panel'&&url.pathname==='/mcp')await markUi(env,'last_open_at');
    const pending=await env.DB.prepare("SELECT COUNT(*) AS count FROM cream_jobs WHERE state IN ('pending','claimed') AND expires_at>?").bind(Date.now()).first();
    if(pending.count>=12)return ok(fail('REQUEST_QUEUE_BUSY'));
    const id=crypto.randomUUID(),now=Date.now();await env.DB.prepare('INSERT INTO cream_jobs(id,name,args,state,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(id,name,JSON.stringify(q.params.arguments||{}),'pending',now,now+24000).run();
    for(let i=0;i<90;i++){
      const row=await env.DB.prepare('SELECT state,result FROM cream_jobs WHERE id=?').bind(id).first();
      if(row?.state==='done')return ok(JSON.parse(row.result));
      await delay(250);
    }
    await env.DB.prepare("UPDATE cream_jobs SET state='cancelled' WHERE id=? AND state='pending'").bind(id).run();
    return ok(fail('RESULT_NOT_CONFIRMED: 결과를 확인하지 못했습니다. 작업 목록을 먼저 조회하고 중복 시작하지 마세요. 요청 ID '+id));
  }catch(e){return json({error:e.message==='REQUEST_TOO_LARGE'?e.message:'REQUEST_FAILED'},400);}
}};
