import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Journal,read} from './state.mjs';
import {coordinate} from './coordinator.mjs';
import {Herdr} from './herdr.mjs';
import {startServer} from './run.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
const dir=path.join(project,'kream-runs','herdr-validation',String(Date.now()));
if(process.argv.includes('--child')) {
  const target=process.argv.find(x=>x.startsWith('--dir=')).slice(6),journal=new Journal(target);
  const h=new Herdr({session:'cream-runtime-validation'});
  const backend={execute:async(name,args)=>{
    if(name==='status')return {mode:'synthetic',target:1,completed:1,batches:[{status:'complete',fixture:true,reviewId:'fixture-review'}],instruction:'This is a synthetic runtime verification. All fixture work is already complete; persist finish complete. Never collect live data.'};
    if(name==='finish'&&args.outcome==='complete'){journal.data.status='complete';journal.save();return {mode:'synthetic',status:'complete',liveSourcingVerified:false};}
    throw Error('LIVE_VERIFICATION_ONLY_STATUS_AND_FINISH');
  },stop:async()=>{}};
  try {await coordinate({journal,backend,report:(s,m)=>h.report(process.env.HERDR_PANE_ID,s,m)});fs.writeFileSync(path.join(target,'verified.json'),JSON.stringify({herdrPane:process.env.HERDR_PANE_ID,realModel:true,structuredFinish:journal.data.status==='complete',liveSourcingVerified:false}));}
  catch(e){fs.writeFileSync(path.join(target,'failed.json'),JSON.stringify({error:e.message}));process.exitCode=1;}
} else {
  const journal=new Journal(dir,{instruction:'Synthetic runtime test: inspect the provided completed fixture status and call finish complete. Do not source products.',targetProducts:1,source:'kream-popularity',maxTurns:3});journal.save();
  const h=await startServer('cream-runtime-validation'),created=await h.create(project,'Cream real-model validation');
  await h.launch(created.root_pane.pane_id,fileURLToPath(import.meta.url),['--child',`--dir=${dir}`]);
  console.log(JSON.stringify({dir,paneId:created.root_pane.pane_id,workspaceId:created.workspace.workspace_id}));
}
