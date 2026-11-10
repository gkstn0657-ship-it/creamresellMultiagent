import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
export async function startEvidenceServer(store) {
  const key=crypto.randomBytes(32).toString('hex');
  const server=http.createServer(async(req,res)=>{
    const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    const supplied=req.headers['x-cream-evidence-key'];
    if(req.method!=='POST'||req.url!=='/'||req.headers.host!==`127.0.0.1:${server.address().port}`||req.headers.origin||typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied)||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(key)))return send(403,{error:'FORBIDDEN'});
    try {
      let raw='';req.setEncoding('utf8');for await(const b of req){raw+=b;if(raw.length>16000)throw Error('REQUEST_TOO_LARGE');}
      const body=JSON.parse(raw);
      if(body.name==='team_state'&&Object.keys(body.arguments||{}).length===0)return send(200,store.summary());
      if(body.name==='read_observation'&&Object.keys(body.arguments||{}).join(',')==='id')return send(200,store.read(body.arguments.id));
      throw Error('READ_ONLY_EVIDENCE_TOOL');
    }catch(e){send(400,{error:e.message});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const file=path.join(store.dir,'.evidence-connection.json');fs.writeFileSync(file,JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,key}),{mode:0o600});
  return {file,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));if(fs.existsSync(file))fs.unlinkSync(file);}};
}
