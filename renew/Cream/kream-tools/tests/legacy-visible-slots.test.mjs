import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const tools=fileURLToPath(new URL('..',import.meta.url));
const write=(dir,name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
const read=(dir,name)=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
function folder(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cream-public-source-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function run(script,dir,...args){
  const result=spawnSync(process.execPath,[path.join(tools,script),dir,...args],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
test('an overseas or mismatched displayed slot cannot be replaced by the fourth visible offer',t=>{
  const dir=folder(t),model='123456789-A0029',chunks=[];
  write(dir,'k50.json',[{id:1,title:'테스트',model,kreamMed:100000}]);
  ['해외직구 '+model,'다른 모델','다른 상품',model].forEach((title,index)=>{
    chunks.push('찜하기'+(index+1),title+'\n10,000원\n배송비\n무료','판매자 정보');
  });
  write(dir,'dump-N1-s.json',{text:chunks.join('\n\t\n'),links:[]});
  run('parse-si.mjs',dir,'N','k50.json','n-cards.json','--public-product');
  const result=read(dir,'n-cards.json')['1'];
  assert.equal(result.inspectedSlots,3);
  assert.deepEqual(result.matched,[]);
});
test('public trade rows require a matching product URL and stop at the end of the displayed table',t=>{
  const dir=folder(t),text='모델번호\nFV8911-010\n옵션\n거래가\n거래일\nL\n240,000원\n2시간 전\nM\n230,000원\n1일 전\n로그인\n배송비\n3,000원';
  write(dir,'k50-ids.json',[1,2]);
  write(dir,'dump-K1.json',{url:'https://kream.co.kr/products/1',title:'테스트',text});
  write(dir,'dump-K2.json',{url:'https://kream.co.kr/login',title:'로그인',text});
  run('parse-kream.mjs',dir);
  const [valid,redirected]=read(dir,'k50.json');
  assert.deepEqual([valid.n,valid.kreamMed],[2,235000]);
  assert.equal(redirected.n,0);
});

test('a missing KREAM trade price keeps search findings without valuing the candidate at zero',t=>{
  const dir=folder(t);
  const model='123456789-A0029';
  write(dir,'k50.json',[{id:1,title:'테스트',model,kreamMed:null}]);
  write(dir,'dump-N1-s.json',{text:['찜하기1',model+'\n10,000원\n배송비\n무료','판매자 정보'].join('\n\t\n'),links:[]});
  run('parse-si.mjs',dir,'N','k50.json','n-cards.json','--public-product');
  const row=read(dir,'n-cards.json')['1'];
  assert.equal(row.kream,null);
  assert.equal(row.inspectedSlots,1);
  assert.equal(row.matched.length,1);
});

test('public sourcing reads matching seller pages before deciding margin, including loss or unknown quotes',t=>{
  const dir=folder(t),model='FV8911-010';
  const ids=[1,2,3,4,5,6,7],title='나이키 '+model;
  const row=(link,extra={})=>({link,title,price:163800,shipFee:3300,keyMatch:true,colorMatch:true,overseas:false,isCatalog:false,topMalls:[],...extra});
  const product=(id)=>({id,title,model,n:0,kreamMed:id===2?null:169000});
  const cards=Object.fromEntries(ids.map(id=>[id,{name:title,model,kream:product(id).kreamMed,matched:[row('https://shop.example/'+id)]}]));
  cards[2].matched=[row('https://catalog.example/2',{isCatalog:true})];
  cards[6].matched=[row('https://unrelated.example/item',{colorMatch:false}),row('https://overseas.example/item',{overseas:true}),row('https://used.example/item',{title:'중고 '+title})];
  cards[7].matched=[row('https://untrusted.example/7',{price:140000}),row('https://trusted.example/7',{price:200000,topMalls:[{mall:'롯데ON'}]})];
  write(dir,'k50.json',ids.map(product)); write(dir,'k50-ids.json',ids);
  write(dir,'jobs.json',{jobs:[]}); write(dir,'n-cards.json',cards);
  const sellerUrl='https://shop.example/adcr/catalog-seller';
  write(dir,'dump-N2-cat.json',{text:[title+'로 이동하기','SSG닷컴','배송비','무료'].join('\n'),
    links:[{t:title+'로 이동하기',h:sellerUrl}]});
  run('run-all.mjs',dir,'--replay','--skip-kream','--naver-api','--public-product','--rules-only');
  const jobs=new Map(read(dir,'jobs.json').jobs.map(job=>[job.id,job.url]));
  assert.equal(jobs.get('N2-cat'),'https://catalog.example/2');
  assert.equal(jobs.get('N2-prod'),sellerUrl);
  assert.equal(jobs.get('N7-prod'),'https://trusted.example/7');
  assert.equal(jobs.has('N6-prod'),false);
  for(const id of [1,3,4,5])assert.equal(jobs.get('N'+id+'-prod'),'https://shop.example/'+id);
  assert.ok(read(dir,'margin-1st.json').find(item=>item.pid==='1').best.net<0);
  assert.equal(read(dir,'margin-1st.json').find(item=>item.pid==='2').best.net,null);
  assert.ok(read(dir,'final-all.json').rows.every(r=>r['판정']!=='후보'));
});
