import fs from 'node:fs';import {spawnSync} from 'node:child_process';import path from 'node:path';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
function call(kreamId,model){const request={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'no1_search_price_comparison',arguments:{kreamId,model}}};const r=spawnSync(process.execPath,[path.join(here,'server-general.mjs'),'--enable-live-ui'],{input:JSON.stringify(request)+'\n',encoding:'utf8',windowsHide:true,timeout:30000});if(r.status!==0)throw Error('SERVER_FAILED');const response=JSON.parse(r.stdout.trim());return {request,response};}
const precondition=call('280933','MM00313KM0307-P199');
const alternate=call('756827','RCCMSS713A005086W103');
const mismatch=call('280933','RCCMSS713A005086W103');
const passed=!precondition.response.result.isError&&!alternate.response.result.isError&&mismatch.response.result.isError&&mismatch.response.result.content[0].text==='IDENTITY_MISMATCH_OR_NOT_VISIBLE';
const result={test:'Actual MCP search UI transition 280933 -> 756827 and wrong-ID blocking; not fixture',capturedAt:new Date().toISOString(),precondition,alternate,mismatch,passed,automaticObservationsWritten:false};
fs.writeFileSync(path.join(here,'live-general-search-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!passed)process.exitCode=1;