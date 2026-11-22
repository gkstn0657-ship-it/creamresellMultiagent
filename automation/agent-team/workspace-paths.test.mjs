import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {workspacePaths} from './workspace-paths.mjs';
import {checkServers} from './register-mcp.mjs';

test('standalone, split installations and explicit data roots keep code and records separate', t => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cream-paths-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const repo=path.join(folder,'1109renew','다른 이름');
  const standalone=workspacePaths(repo,{});
  assert.equal(standalone.ledger,path.join(repo,'kream-runs','agent-teams'));
  assert.equal(standalone.reports,path.join(repo,'상품탐색결과'));
  const ledger=path.join(folder,'1109renew','Cream','kream-runs','agent-teams');
  fs.mkdirSync(path.join(ledger,'work-orders'),{recursive:true});
  const split=workspacePaths(repo,{});
  assert.equal(split.ledger,ledger);
  assert.equal(split.reports,path.join(folder,'상품탐색결과'));
  const external=workspacePaths(repo,{CREAM_AGENT_TEAMS_ROOT:folder,CREAM_REPORTS_DIR:folder});
  assert.deepEqual(external,{ledger:folder,reports:folder,writer:path.join(repo,'상품탐색결과','append_result.py')});
});

test('both portable MCP entry points answer over stdio without connecting to marketplaces', () => {
  checkServers();
});
