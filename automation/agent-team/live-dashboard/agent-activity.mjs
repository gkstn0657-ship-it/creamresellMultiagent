// Activity is observed execution metadata, never a reconstruction of private reasoning.
export function agentActivity({id,role,model,events=[],live=false,terminal=false,retired=false,now=Date.now()}){
 const relevant=events.filter(e=>!e.threadId||e.threadId===id);let turn=false,pending=null,last=null;
 for(const e of relevant){
  if(e.type==='turn_started'){turn=true;pending=null;}
  if(e.type==='tool_started'){pending=e;turn=true;}
  if(['tool_completed','tool','tool_error'].includes(e.type)&&(!pending||pending.tool===e.tool))pending=null;
  if(e.type==='turn_completed'){turn=false;pending=null;}
  if(['turn_started','turn_completed','tool_started','tool_call','tool_completed','tool','tool_error','agent_message','owner_model_upgraded','model_upgraded'].includes(e.type))last=e;
 }
 const age=last?.at?Math.max(0,Math.floor((now-Date.parse(last.at))/1000)):null;
 const status=retired?'retired':terminal?'finished':!live?'offline':age!==null&&age>60?'quiet':pending?'tool':turn?'thinking':'idle';
 return {id,role,model,status,live,age,lastAt:last?.at||null,currentTool:status==='tool'?pending?.tool||null:null,lastTool:[...relevant].reverse().find(e=>e.tool)?.tool||null,message:[...relevant].reverse().find(e=>e.type==='agent_message')?.text||null,events:relevant.filter(e=>['turn_started','turn_completed','tool_started','tool_call','tool_completed','tool','tool_error','agent_message','review_model_selected','owner_model_upgraded'].includes(e.type)).slice(-8).reverse().map(e=>({at:e.at,type:e.type,tool:e.tool,text:e.text?.slice(0,1500),error:e.error||e.code}))};
}
