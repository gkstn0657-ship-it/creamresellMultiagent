import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertNo1UiAllowed} from './ui-policy.mjs';

test('background-only preference blocks UI even when legacy live flag is supplied',()=>{
  assert.throws(()=>assertNo1UiAllowed(['node','--enable-live-ui'],{backgroundOnly:true}),/NO1_BACKGROUND_ONLY_UI_DISABLED/);
  assert.throws(()=>assertNo1UiAllowed(['node','--background-only'],{backgroundOnly:false}),/NO1_BACKGROUND_ONLY_UI_DISABLED/);
  assert.throws(()=>assertNo1UiAllowed(['node'],{}),/NO1_BACKGROUND_ONLY_UI_DISABLED/);
});

test('actual MCP process rejects all UI tools before any window operation',()=>{
  const requests=[
    ['no1_read_price_comparison',{kreamId:'280933',model:'MM00313KM0307-P199'}],
    ['no1_search_price_comparison',{kreamId:'1120286',model:'NBNPG41033-19'}],
    ['no1_search_stock_estimate',{productUrl:'https://www.musinsa.com/products/7481180',model:'NBNPG41033',color:'(19)BLACK',option:'L(100)'}]
  ].map(([name,args],i)=>({jsonrpc:'2.0',id:i+1,method:'tools/call',params:{name,arguments:args}}));
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./server-stock.mjs',import.meta.url)),'--enable-live-ui','--background-only'],
    {input:requests.map(r=>JSON.stringify(r)).join('\n')+'\n',encoding:'utf8',windowsHide:true,timeout:5000});
  assert.equal(result.status,0);
  const responses=result.stdout.trim().split('\n').map(s=>JSON.parse(s));
  assert.equal(responses.length,3);
  for(const r of responses){assert.equal(r.result.isError,true);assert.equal(r.result.content[0].text,'NO1_BACKGROUND_ONLY_UI_DISABLED');}
});
