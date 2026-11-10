// One-page live check using the user's existing extension and relay.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {RelayTransport} from './relay-transport.mjs';
import {readJson,writeJson} from '../renew/Cream/kream-tools/agents-core.mjs';
const dir=process.argv[2]&&path.resolve(process.argv[2]);
if(!dir || (fs.existsSync(dir)&&fs.readdirSync(dir).length)) throw Error('사용: node check-collector.mjs <새 빈 검증 폴더>');
fs.mkdirSync(dir,{recursive:true});const runtime=readJson(path.resolve('.'),'sourcing-runtime.json',{});
if(!runtime.relayRunDir)throw Error('sourcing-runtime.json의 relayRunDir 필요');
const transport=new RelayTransport(dir,runtime.relayRunDir),started=new Date().toISOString();
let report={started,status:'waiting',source:'existing-extension',actualOrders:false};
try {
  await transport.verify();
  writeJson(dir,'jobs.json',{jobs:[{id:'S1',url:'https://kream.co.kr/categories/50/24?sort=popular_score',expectedSort:'popular_score',actions:[{wait:1500},{kreamSort:'인기순'}]}]});
  const until=Date.now()+90000;
  while(!fs.existsSync(path.join(dir,'dump-S1.json'))) {
    await transport.sync();if(transport.stopped())throw Error('STOP 유지: 수집 중단');
    if(Date.now()>until)throw Error('90초 동안 새 덤프 없음: 기존 수집 확장의 실행 상태 확인 필요');
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  const dump=readJson(dir,'dump-S1.json');
  if(Date.parse(dump.at)<Date.parse(started)-60000)throw Error('새 관측시각 확인 실패');
  const r=spawnSync(process.execPath,[path.resolve('kream-tools/collect-ids.mjs'),dir,'extract','5','--include-explored'],{encoding:'utf8',windowsHide:true});
  if(r.status!==0)throw Error(String(r.stderr||r.stdout).slice(-800));
  report={...report,status:'passed',capturedAt:dump.at,selectedLabel:dump.kreamSort?.selectedLabel,ids:readJson(dir,'k50-ids.json')};
}catch(error){report={...report,status:'blocked',error:error.message};process.exitCode=1;}
finally{transport.cancelPending();writeJson(dir,'collector-check.json',{...report,completedAt:new Date().toISOString()});console.log(JSON.stringify(report));}
