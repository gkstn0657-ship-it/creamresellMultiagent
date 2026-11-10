import {analysisProfile as validateProfile,MUSINSA_PROFILE,MUSINSA_MESSAGE} from './analysis-profiles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {collectPackets,validatePacket,groupProducts} from './packets.mjs';
import {runTeam} from './run.mjs';
import {digest} from './store.mjs';
import {writeJsonAtomic as write} from './atomic-json.mjs';
import {marginReport} from './margin-report.mjs';
import {marketSchemas} from './market-schema.mjs';
import {offerProductId,safeProductId} from './market-offer.mjs';
const packetSnapshot=(dir,id)=>path.join(dir,'packets',`snapshot-${id}.json`);
function saveCollection(dir,groups,packets){
 // Immutable snapshots let an interrupted refresh keep the previous manifest usable.
 for(const packet of packets){const file=packetSnapshot(dir,packet.id);if(!fs.existsSync(file))write(file,packet);}
 write(path.join(dir,'collection-complete.json'),{at:new Date().toISOString(),seedHash:digest(groups),productIds:packets.map(p=>p.productId),packetIds:packets.map(p=>p.id)});
}
function savedJudgment(dir,packet){
 const file=path.join(dir,'judgments',packet.productId,'team-state.json');
 return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
}
const completed=(saved,packet)=>saved?.status==='complete'&&saved.packetId===packet.id&&Boolean(saved.assessment);
export async function prepareBatch({seeds,dir,collect,collectDiscovered,mode='live',stopped=()=>false,onEvent=()=>{}}){
 const groups=groupProducts(seeds);fs.mkdirSync(dir,{recursive:true});
 const state={version:'cream-product-batch-v1',mode,status:'prefetching',productCount:groups.length,collected:0,judged:0,results:[],startedAt:new Date().toISOString()};
 const save=()=>write(path.join(dir,'batch-state.json'),state);save();
 try{
  const packets=await collectPackets(seeds,path.join(dir,'packets'),{collect,collectDiscovered,mode,stopped:()=>stopped()||fs.existsSync(path.join(dir,'STOP')),onEvent:e=>{state.collected=e.collected;save();onEvent(e);}});
  saveCollection(dir,groups,packets);
  state.status='prefetched';state.collectionFinishedAt=new Date().toISOString();save();return state;
 }catch(e){state.status=stopped()||fs.existsSync(path.join(dir,'STOP'))?'stopped':'needs_attention';state.error=e.message;state.finishedAt=new Date().toISOString();save();throw e;}
}
export async function runBatch({seeds,dir,concurrency=2,collect,collectDiscovered,analyze=runTeam,mode='live',analysisProfile='general',onEvent=()=>{},onCollected=()=>{},resume=false}={}) {
  analysisProfile=validateProfile(analysisProfile);
  dir=path.resolve(dir);fs.mkdirSync(dir,{recursive:true});
  if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>3)throw Error('BATCH_CONCURRENCY_INVALID');
  const groups=groupProducts(seeds),stateFile=path.join(dir,'batch-state.json'),stop=()=>fs.existsSync(path.join(dir,'STOP'));
  if(fs.existsSync(stateFile)&&validateProfile(JSON.parse(fs.readFileSync(stateFile,'utf8')).analysisProfile)!==analysisProfile)throw Error('BATCH_ANALYSIS_PROFILE_CHANGED');
  const lock=path.join(dir,'batch.lock');
  if(fs.existsSync(lock)){const pid=Number(fs.readFileSync(lock,'utf8'));let alive=false;try{process.kill(pid,0);alive=true;}catch{}if(alive)throw Error('BATCH_ALREADY_RUNNING');fs.unlinkSync(lock);}
  fs.writeFileSync(lock,String(process.pid),{flag:'wx'});
  const stopTimer=setInterval(()=>{if(!stop())return;const base=path.join(dir,'judgments');if(fs.existsSync(base))for(const id of fs.readdirSync(base).filter(safeProductId))fs.writeFileSync(path.join(base,id,'STOP'),'batch stop');},1000);
  const state={version:'cream-product-batch-v1',mode,analysisProfile,status:'collecting',productCount:groups.length,collected:0,judged:0,results:[],startedAt:new Date().toISOString()};
  const emit=e=>{onEvent(e);};
  try {
    write(stateFile,state);
    let packets;
    if(resume&&fs.existsSync(path.join(dir,'collection-complete.json'))){
      const manifest=JSON.parse(fs.readFileSync(path.join(dir,'collection-complete.json'),'utf8'));
      if(JSON.stringify(manifest.productIds)!==JSON.stringify(groups.map(g=>g.productId))||manifest.seedHash!==digest(groups))throw Error('BATCH_SCOPE_CHANGED');
      if(!Array.isArray(manifest.packetIds)||manifest.packetIds.length!==groups.length||manifest.packetIds.some(id=>!/^[a-f0-9]{64}$/.test(id)))throw Error('BATCH_PACKET_CHANGED');
      packets=manifest.productIds.map((id,i)=>{const snapshot=packetSnapshot(dir,manifest.packetIds[i]);return validatePacket(JSON.parse(fs.readFileSync(fs.existsSync(snapshot)?snapshot:path.join(dir,'packets',`product-${id}.json`),'utf8')));});
      if(packets.some((p,i)=>p.id!==manifest.packetIds[i]))throw Error('BATCH_PACKET_CHANGED');
      saveCollection(dir,groups,packets);
      const refreshIds=new Set(mode==='live'?packets.filter(p=>!completed(savedJudgment(dir,p),p)&&p.observations.some(o=>o.kind!=='catalog_candidate'&&Date.now()-Date.parse(o.observedAt)>600000)).map(p=>p.productId):[]);
      if(refreshIds.size){
        const refreshed=await collectPackets(seeds.filter(seed=>refreshIds.has(offerProductId(seed))),path.join(dir,'packets'),{collect,collectDiscovered,mode,stopped:stop,onEvent:emit});
        packets=packets.map(p=>refreshed.find(fresh=>fresh.productId===p.productId)||p);
      }
    }else packets=await collectPackets(seeds,path.join(dir,'packets'),{collect,collectDiscovered,mode,stopped:stop,onEvent:e=>{state.collected=e.collected;write(stateFile,state);emit(e);}});
    // Explicit barrier: no product AI runs until all N information packets exist.
    saveCollection(dir,groups,packets);
    state.collected=packets.length;state.status='judging';write(stateFile,state);emit({type:'all_products_collected',count:packets.length});
    onCollected();
    let next=0;
    await Promise.all(Array.from({length:Math.min(concurrency,packets.length)},async()=>{
      while(next<packets.length&&!stop()){
        const packet=packets[next++],productDir=path.join(dir,'judgments',packet.productId);
        const saved=savedJudgment(dir,packet);
        let row;
        try {
          if(completed(saved,packet))row={productId:packet.productId,status:'complete',assessment:saved.assessment,reused:true};
          else {
            emit({type:'product_judgment_started',productId:packet.productId,packetId:packet.id});
            const result=await analyze({dir:productDir,packet,resume:Boolean(saved?.ownerThreadId),
              mission:{analysisProfile,objective:'이미 취합한 이 상품의 정보 묶음을 읽고 수익성·쿠폰·마일리지·수요·리스크를 종합하여 채택/보류/제외를 직접 판단한다. 구매처 미지원이나 매칭 미확인은 수익 없음이 아니라 자료 부족으로 보류한다.',product:packet.offers[0]||{kreamId:packet.productId},candidate:packet.candidate||null,offers:packet.offers,packetId:packet.id},
              message:analysisProfile===MUSINSA_PROFILE?MUSINSA_MESSAGE:'먼저 team_state와 read_observation으로 수집된 상품 정보를 읽어라. 현재 근거로 계산 가능한 값과 미확인을 구분한다. 추가 정보가 결론을 바꿀 가능성이 있을 때만 보완 조사하라. 숫자 계산은 도구에 맡기고 판단은 직접 하라. 독립 검증 후 publish_assessment로 결과를 기록한다.',
              onEvent:e=>emit({...e,productId:packet.productId})});
            row={productId:packet.productId,status:result.status,assessment:result.assessment};
          }
        }catch(e){row={productId:packet.productId,status:'needs_attention',error:e.message};}
        row.margins=marginReport(packet.observations);
        row.marketSchemas=marketSchemas(packet.observations);
        state.results.push(row);state.judged++;write(stateFile,state);emit({type:'product_judged',productId:packet.productId,status:row.status,decision:row.assessment?.decision});
      }
    }));
    state.status=stop()?'stopped':state.results.length===packets.length&&state.results.every(r=>r.status==='complete')?'complete':'needs_attention';
    state.results.sort((a,b)=>groups.findIndex(g=>g.productId===a.productId)-groups.findIndex(g=>g.productId===b.productId));
    state.finishedAt=new Date().toISOString();write(stateFile,state);write(path.join(dir,'batch-result.json'),state);return state;
  }catch(e){state.status=stop()?'stopped':'needs_attention';state.error=e.message;state.finishedAt=new Date().toISOString();write(stateFile,state);throw e;}
  finally{clearInterval(stopTimer);if(fs.existsSync(lock)&&fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const arg=k=>process.argv.find(x=>x.startsWith(`--${k}=`))?.slice(k.length+3);
  if(!arg('seeds')||!arg('out'))throw Error('Use --seeds=<products.json> --out=<run-dir> [--resume]');
  const input=JSON.parse(fs.readFileSync(arg('seeds'),'utf8'));
  try{const result=await runBatch({seeds:Array.isArray(input)?input:input.products,dir:arg('out'),concurrency:Number(arg('concurrency')||2),resume:process.argv.includes('--resume'),analysisProfile:arg('analysis-profile')||'general',onEvent:e=>console.log(JSON.stringify(e))});console.log(JSON.stringify({status:result.status,productCount:result.productCount,judged:result.judged}));if(result.status!=='complete')process.exitCode=2;}
  catch(e){console.error(e.message);process.exitCode=1;}
}
