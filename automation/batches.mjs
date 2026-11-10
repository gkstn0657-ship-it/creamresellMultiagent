import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {writeAutomationOutput} from './report.mjs';

export function splitIds(ids, size) {
  if (!Array.isArray(ids) || !Number.isSafeInteger(size) || size < 1 || size > 20) throw new Error('Invalid batch input');
  const unique = new Set();
  for (const id of ids) {
    if (!/^\d+$/.test(String(id)) || unique.has(String(id))) throw new Error('Product IDs must be unique numbers');
    unique.add(String(id));
  }
  const batches=[];
  for (let i=0;i<ids.length;i+=size) batches.push(ids.slice(i,i+size).map(String));
  return batches;
}

export function remainingHourlyPages(serviceDir, now = Date.now()) {
  if (!fs.existsSync(serviceDir)) throw new Error(`Relay directory missing: ${serviceDir}`);
  const recent = fs.readdirSync(serviceDir).filter(name=>/^dump-.*\.json$/.test(name))
    .map(name=>fs.statSync(path.join(serviceDir,name)).mtimeMs).filter(time=>now-time>=-60000 && now-time<3600000);
  return {remaining:Math.max(0,150-recent.length),used:recent.length,
    nextFreeAt:recent.length ? new Date(Math.min(...recent)+3600000).toISOString() : null};
}

export function aggregateBatchReports(cycleDir, manifest, options = {}) {
  const rows=[],usage=[];
  const at=options.now || new Date().toISOString();
  let processed=0,no1Observations=0;
  for (const batch of manifest.batches.filter(item=>item.status==='done')) {
    const file=path.join(batch.dir,'automation-final.json');
    if (!fs.existsSync(file)) throw new Error(`Completed batch report missing: ${file}`);
    const result=JSON.parse(fs.readFileSync(file,'utf8'));
    if (!Array.isArray(result.rows)) throw new Error(`Invalid batch report: ${file}`);
    const dotFile=path.join(cycleDir,`dot-screening-batch-${String(batch.index).padStart(3,'0')}.json`);
    const dot=fs.existsSync(dotFile) ? JSON.parse(fs.readFileSync(dotFile,'utf8')) : null;
    const agenticFile=path.join(batch.dir,'agentic-final.json');
    const agentic=fs.existsSync(agenticFile) ? JSON.parse(fs.readFileSync(agenticFile,'utf8')) : null;
    const agentStateFile=path.join(batch.dir,'agentic-state.json');
    const agentState=fs.existsSync(agentStateFile) ? JSON.parse(fs.readFileSync(agentStateFile,'utf8')) : null;
    rows.push(...result.rows.map(row=>{
      const next={...row,batch:batch.index,reasons:[...(row.reasons || [])]};
      if (next.status==='candidate') {
        const review=dot?.items?.find(item=>String(item.kreamId)===String(row.kreamId) && item.sourceUrl && item.sourceUrl===row.sourceUrl &&
          (!row.optionId || item.optionId===row.optionId) && String(item.size || '').trim().toUpperCase()===String(row.size || '').trim().toUpperCase());
        if (result.version==='cream-agentic-result-v1') {
          const audited=agentic?.rows?.find(item=>item.optionId===row.optionId && item.kreamId===row.kreamId && item.sourceUrl===row.sourceUrl);
          if (agentState?.status!=='complete' || agentic?.independentReview?.provider!=='Codex CLI' || agentic.independentReview.completed!==true ||
              agentic.mode!=='live' || audited?.status!=='candidate' || audited.audit?.decision!=='clear' || !audited.evidence?.source || !audited.evidence?.no1)
            next.reasons.push('CODEX_INDEPENDENT_AUDIT_MISSING');
          const no1File=audited?.evidence?.no1;
          const no1=no1File && path.basename(no1File)===no1File && fs.existsSync(path.join(batch.dir,no1File)) ? JSON.parse(fs.readFileSync(path.join(batch.dir,no1File),'utf8')) : null;
          for (const time of [no1?.dataAsOf,no1?.capturedAt]) {
            const age=Date.parse(at)-Date.parse(time);
            if (!Number.isFinite(age) || age< -60000 || age>600000) next.reasons.push('AGGREGATE_NO1_STALE');
          }
        } else if (review?.independentDecision!=='clear' || review.promotionAllowed!==true || !Array.isArray(review.evidence) || !review.evidence.length)
          next.reasons.push(review ? 'DOT_REVIEW_HOLD' : 'DOT_REVIEW_MISSING');
        const age=Date.parse(at)-Date.parse(row.capturedAt);
        if (!Number.isFinite(age) || age< -60000 || age>600000) next.reasons.push('AGGREGATE_STALE');
        const marketAge=Date.parse(at)-Date.parse(row.dataAsOf);
        if (!Number.isFinite(marketAge) || marketAge< -60000 || marketAge>600000) next.reasons.push('AGGREGATE_MARKET_STALE');
        if (next.reasons.length) next.status='hold';
      }
      return next;
    }));
    usage.push(...(result.summary?.aiUsage || []));
    processed+=batch.ids.length;
    no1Observations+=result.summary?.no1Observations || 0;
  }
  const summary={total:rows.length,candidate:rows.filter(row=>row.status==='candidate').length,
    hold:rows.filter(row=>row.status==='hold').length,excluded:rows.filter(row=>row.status==='excluded').length,
    productsProcessed:processed,productsTarget:manifest.ids.length,no1Observations,aiUsage:usage};
  const output={version:'cream-automation-v1',at,summary,rows};
  const reviewRows=[...rows.filter(row=>row.status!=='excluded'),...rows.filter(row=>row.status==='excluded').slice(-5)];
  const review={version:'dot-screening-queue-v1',at:output.at,productsProcessed:processed,
    items:reviewRows.map(row=>({kreamId:row.kreamId,optionId:row.optionId,size:row.size,model:row.model,status:row.status,reasons:row.reasons,
      sourceUrl:row.sourceUrl,batch:row.batch,batchDir:manifest.batches.find(batch=>batch.index===row.batch)?.dir || null}))};
  fs.writeFileSync(path.join(cycleDir,'dot-screening-queue.json'),JSON.stringify(review,null,2)+'\n','utf8');
  return writeAutomationOutput(cycleDir,output,options);
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const dir=process.argv[2];
  if (!dir) throw new Error('Usage: node automation/batches.mjs <cycle-dir>');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'batches.json'),'utf8'));
  console.log(JSON.stringify(aggregateBatchReports(dir,manifest).summary));
}
