import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {herdrData,herdrAction} from './herdr-data.mjs';
test('continuous monitor identifies deterministic supervisor and never invents AI reviewers',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cream-monitor-')),id='work-11111111-1111-1111-1111-111111111111',teams=path.join(root,'agent-teams'),dir=path.join(teams,'explorations',id);fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(teams,'work-orders'));
 fs.writeFileSync(path.join(teams,'work-orders',id+'.json'),JSON.stringify({id,continuous:true,status:'open',createdAt:new Date().toISOString(),entries:[],userInstruction:'fixture'}));fs.writeFileSync(path.join(dir,'continuous.lock'),String(process.pid));fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({status:'discovering',checkedSources:3,currentSource:{productId:'123'},skipped:[]}));
 const d=herdrData(root);assert.equal(d.continuous,true);assert.equal(d.completed,3);assert.equal(d.reviewed,0);assert.equal(d.agents[0].role,'supervisor');assert.equal(d.agents[0].model,null);assert.equal(d.agents[1].productId,'123');assert.equal(d.canResume,false);
 await assert.rejects(herdrAction(root,id,'resume'),/ACTION_NOT_AVAILABLE/);
 fs.unlinkSync(path.join(dir,'continuous.lock'));assert.equal(herdrData(root).agents[1].status,'offline');
});
