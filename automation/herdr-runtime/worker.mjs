import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {runBatch} from '../agent-team/batch.mjs';
import {Herdr,reportStatus} from './herdr.mjs';
import {writeJsonAtomic} from '../agent-team/atomic-json.mjs';
import {read,lock} from './state.mjs';
import {rankingWorker} from './ranking-worker.mjs';
export async function worker({root,runId,herdr,paneId,execute=runBatch}) {
  if(!/^batch-[a-f0-9-]{36}$/.test(runId))throw Error('INVALID_RUN_ID');
  const dir=path.join(root,runId),release=lock(dir);
  try {
    const prior=read(path.join(dir,'batch-state.json'));if(prior?.status==='complete')return prior;
    if(fs.existsSync(path.join(dir,'STOP')))throw Error('STOP_REQUESTED');
    fs.writeFileSync(path.join(dir,'process.json'),JSON.stringify({pid:process.pid,launchedAt:new Date().toISOString()}));
    await reportStatus(dir,()=>herdr.report(paneId,'working','Collecting and independently reviewing products'));
    const result=read(path.join(dir,'launch.json'))?.analysisProfile==='musinsa-ranking'?await rankingWorker({root,dir,execute}):await execute({seeds:read(path.join(dir,'products.json')),dir,concurrency:2,resume:Boolean(prior),analysisProfile:'general',onEvent:e=>console.log(JSON.stringify(e))});
    await reportStatus(dir,()=>herdr.report(paneId,result.status==='complete'?'idle':'blocked',result.status));return result;
  } catch(e){const old=read(path.join(dir,'batch-state.json'))||{};writeJsonAtomic(path.join(dir,'batch-state.json'),{...old,status:fs.existsSync(path.join(dir,'STOP'))?'stopped':'needs_attention',error:e.message});await reportStatus(dir,()=>herdr.report(paneId,'blocked',e.message));throw e;}
  finally {release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const arg=n=>process.argv.find(x=>x.startsWith(`--${n}=`))?.slice(n.length+3);
  worker({root:arg('root'),runId:arg('run'),herdr:new Herdr({session:arg('session')}),paneId:process.env.HERDR_PANE_ID}).catch(e=>{console.error(e.message);process.exitCode=1;});
}
