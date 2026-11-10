import fs from 'node:fs';
import readline from 'node:readline';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const url=new URL(config.url);
if(url.hostname!=='127.0.0.1'||url.protocol!=='http:'||!Number(url.port)||!/^[a-f0-9]{64}$/.test(config.key))throw Error('INVALID_LOCAL_EVIDENCE_CONNECTION');
const descriptors=[
  {name:'team_state',description:'Read the collected product packet, its evidence IDs, calculations, and gaps.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'read_observation',description:'Read the immutable original evidence or calculation for a known ID.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}},
].map(x=>({...x,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}));
const lines=readline.createInterface({input:process.stdin});
lines.on('line',async line=>{
  let request;try{request=JSON.parse(line);}catch{return;}
  if(request.id===undefined)return;
  const send=result=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
  try {
    if(request.method==='initialize')return send({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'cream-evidence',version:'0.1.0'}});
    if(request.method==='tools/list')return send({tools:descriptors});
    if(request.method==='ping')return send({});
    if(request.method==='resources/list')return send({resources:[]});
    if(request.method==='resources/templates/list')return send({resourceTemplates:[]});
    if(request.method!=='tools/call'||!descriptors.some(x=>x.name===request.params?.name))throw Error('EVIDENCE_TOOL_FORBIDDEN');
    const response=await fetch(config.url,{method:'POST',headers:{'Content-Type':'application/json','X-Cream-Evidence-Key':config.key},body:JSON.stringify(request.params),signal:AbortSignal.timeout(5000),redirect:'error'});
    if(!response.ok)throw Error('EVIDENCE_REQUEST_REJECTED');
    send({content:[{type:'text',text:JSON.stringify(await response.json())}],isError:false});
  }catch(e){send({content:[{type:'text',text:e.message}],isError:true});}
});
