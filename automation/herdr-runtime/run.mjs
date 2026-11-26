import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {Herdr,executable} from './herdr.mjs';
import {Journal,read,lock,validateMission,alive} from './state.mjs';
import {withWorkLock,reopenWork} from '../agent-team/work-orders.mjs';
import {Backend} from './backend.mjs';
import {coordinate} from './coordinator.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
export async function startServer(session) {
  const h=new Herdr({session});try{await h.call('workspace','list');return h;}catch{}
  const child=spawn(executable(),['--session',session,'server'],{windowsHide:true,detached:true,stdio:'ignore'});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  for(let i=0;i<20;i++){try{await h.call('workspace','list');return h;}catch{await new Promise(r=>setTimeout(r,250));}}
  throw Error('HERDR_SERVER_UNAVAILABLE');
}
export async function main(argv=process.argv.slice(2)) {
  const arg=n=>argv.find(x=>x.startsWith(`--${n}=`))?.slice(n.length+3);
  const command=argv[0],session=arg('session')||'cream-autonomous';
  if(!arg('dir'))throw Error('RUN_DIRECTORY_REQUIRED');
  const dir=path.resolve(arg('dir'));
  if(command==='status'){console.log(JSON.stringify(read(path.join(dir,'state.json')),null,2));return;}
  if(command==='stop'){if(!read(path.join(dir,'state.json')))throw Error('RUN_NOT_FOUND');fs.writeFileSync(path.join(dir,'STOP'),'user stop');const journal=new Journal(dir);const backend=new Backend({journal,root:journal.data.root});await backend.stop();console.log('Stop requested');return;}
  if(command==='start') {
    if(read(path.join(dir,'state.json')))throw Error('RUN_EXISTS_USE_RESUME');
    const mission=validateMission({instruction:arg('instruction'),targetProducts:Number(arg('target')),source:arg('source')||'musinsa-ranking',maxTurns:Number(arg('max-turns')||100)});
    const journal=new Journal(dir,mission);journal.data.root=path.resolve(arg('root')||path.join(project,'kream-runs','agent-teams'));journal.save();
    const h=await startServer(session),created=await h.create(project,'Cream autonomous');
    const pane=created.root_pane?.pane_id,workspace=created.workspace?.workspace_id;
    if(!pane||!workspace)throw Error('HERDR_WORKSPACE_RESPONSE_INVALID');
    Object.assign(journal.data,{paneId:pane,workspaceId:workspace,session});journal.save();
    await h.launch(pane,fileURLToPath(import.meta.url),['controller',`--dir=${dir}`,`--session=${session}`]);
    console.log(JSON.stringify({status:'launch_requested',dir,workspace,pane,attach:`herdr --session ${session}`}));return;
  }
  if(command==='resume') {
    const journal=new Journal(dir);if(alive(read(path.join(dir,'controller.lock'))?.pid))throw Error('CONTROLLER_ALREADY_RUNNING');
    if(journal.data.status==='complete'){console.log('Already complete');return;}
    if(journal.data.workId)await withWorkLock(journal.data.root,()=>reopenWork(journal.data.root,journal.data.workId));
    const stopFiles=[path.join(dir,'STOP'),...journal.data.batches.flatMap(b=>{const base=path.join(journal.data.root,b.runId),judgments=path.join(base,'judgments');return [path.join(base,'STOP'),...(fs.existsSync(judgments)?fs.readdirSync(judgments).filter(id=>/^(?:\d{1,12}|poizon-\d{1,18})$/.test(id)).map(id=>path.join(judgments,id,'STOP')):[])];})];
    for(const file of stopFiles)if(fs.existsSync(file))fs.unlinkSync(file);
    if(arg('max-turns')){const limit=Number(arg('max-turns'));validateMission({...journal.data.mission,maxTurns:limit});if(limit<=journal.data.turns)throw Error('TURN_BUDGET_ALREADY_USED');journal.data.mission.maxTurns=limit;}
    journal.data.status='ready';delete journal.data.error;
    const h=await startServer(journal.data.session||session),created=await h.create(project,'Cream resumed');
    journal.data.workspaceId=created.workspace.workspace_id;journal.data.paneId=created.root_pane.pane_id;journal.save();
    await h.launch(journal.data.paneId,fileURLToPath(import.meta.url),['controller',`--dir=${dir}`]);console.log('Resume requested');return;
  }
  if(command!=='controller')throw Error('USE_START_RESUME_STATUS_STOP_OR_CONTROLLER');
  const journal=new Journal(dir),release=lock(dir),h=new Herdr({session:journal.data.session||session});
  if(journal.stopped()){release();throw Error('STOP_REQUIRES_EXPLICIT_RESUME');}
  if(journal.data.status==='complete'){release();return;}
  const backend=new Backend({journal,root:journal.data.root,herdr:h,workspaceId:journal.data.workspaceId});
  try {await backend.initialize();await coordinate({journal,backend,report:(state,message)=>h.report(journal.data.paneId,state,message)});}
  catch(e){journal.data.status=journal.stopped()?'stopped':'needs_attention';journal.data.error=e.message;journal.save();throw e;}
  finally {backend.close();release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
