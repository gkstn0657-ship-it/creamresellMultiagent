import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {context,readJson,writeJson,normalizeSize,profit} from '../renew/Cream/kream-tools/agents-core.mjs';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const canonical = value => String(value ?? '').trim().toUpperCase().replace(/\s+/g,'');
const validMoney = value => Number.isSafeInteger(value) && value >= 0;
const baseStatus = (row,item) => Object.values(row || {}).find(value => ['verified','hold','excluded'].includes(value)) || item.status || 'hold';

export function assessNo1(item, observation, policy, now = new Date().toISOString()) {
  const reasons = [];
  if (!observation) return {status:'hold',reasons:['NO1_OBSERVATION_MISSING'],instantProfit:null};
  if (String(observation.kreamId) !== String(item.pid) || normalizeSize(observation.size) !== normalizeSize(item.size)) reasons.push('NO1_OPTION_MISMATCH');
  const captureAge = Date.parse(now) - Date.parse(observation.capturedAt);
  const dataAge = Date.parse(now) - Date.parse(observation.dataAsOf);
  if (!Number.isFinite(captureAge) || captureAge < -60000 || captureAge > 10*60000 ||
      !Number.isFinite(dataAge) || dataAge < -60000 || dataAge > 10*60000 ||
      Date.parse(observation.dataAsOf) > Date.parse(observation.capturedAt) + 60000) reasons.push('NO1_STALE');
  if (!observation.sourceUrl || !/^https:\/\//.test(observation.sourceUrl)) reasons.push('NO1_SOURCE_UNLINKED');
  if (!canonical(observation.kreamModel) || canonical(observation.kreamModel) !== canonical(observation.sourceModel)) reasons.push('NO1_MODEL_MISMATCH');
  if (!canonical(observation.kreamColor) || canonical(observation.kreamColor) !== canonical(observation.sourceColor)) reasons.push('NO1_COLOR_MISMATCH');
  if (!Number.isSafeInteger(observation.sameSizeTrades30d) || observation.sameSizeTrades30d < 3) reasons.push('NO1_LOW_VOLUME');
  if (!Number.isSafeInteger(observation.sourceStock) || observation.sourceStock < 1) reasons.push('NO1_NO_STOCK');
  if (!validMoney(observation.checkoutCost) || observation.conditionalDiscount !== false) reasons.push('NO1_COST_UNCONFIRMED');
  if (!validMoney(observation.instantBid)) reasons.push('NO1_BID_UNCONFIRMED');
  const instantProfit = validMoney(observation.instantBid) && validMoney(observation.checkoutCost)
    ? profit(observation.instantBid,observation.checkoutCost,policy) : null;
  if (instantProfit !== null && instantProfit <= (policy.minCashProfit ?? 0)) reasons.push('NO1_INSTANT_EXIT_UNPROFITABLE');
  return {status:reasons.length ? 'hold' : 'verified',reasons,instantProfit};
}

export function writeAutomationOutput(dir, output, options = {}) {
  const {rows,summary} = output;
  writeJson(dir,'automation-final.json',output);
  const table = rows.map(row => `<tr><td>${escapeHtml(row.kreamId)}</td><td>${escapeHtml(row.model)}</td><td>${escapeHtml(row.size)}</td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.sameSizeTrades30d)}</td><td>${escapeHtml(row.sourceStock)}</td><td>${escapeHtml(Object.hasOwn(row,'existingPointsUsed') ? row.cashProfit : row.instantProfit)}</td><td>${escapeHtml(row.existingPointsUsed)}</td><td>${escapeHtml(Object.hasOwn(row,'existingPointsUsed') ? row.instantProfit : null)}</td><td>${escapeHtml(row.reasons.join(', '))}</td></tr>`).join('');
  const screen=output.screeningSummary;
  const screening=screen ? `<p>1차 탐색: 수익 가능 상품 ${escapeHtml(screen.potential)} · 추가 확인 ${escapeHtml(screen.needs_verification)} · 가능성 낮음 ${escapeHtml(screen.low_potential)}. 최종 후보 0개는 수익 상품이 없다는 뜻이 아닙니다.</p>` : '';
  fs.writeFileSync(path.join(dir,'automation-report.html'),`<!doctype html><html lang="ko"><meta charset="utf-8"><title>Cream 자동 검증</title><style>body{font:15px system-ui;margin:2rem;color:#17212b}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd3da;padding:.5rem;text-align:left}th{background:#eef3f6}tr:nth-child(even){background:#f8fafb}.hold{color:#a33}</style><h1>Cream 자동 검증</h1><p>생성 ${escapeHtml(output.at)} · 후보 ${summary.candidate} · 보류 ${summary.hold} · 제외 ${summary.excluded} · No1 관측 ${summary.no1Observations}</p>${screening}<p>경제적 순익은 기존 적립금 사용액을 비용으로 포함합니다. 미확인 신규 적립은 더하지 않습니다. 후보는 주문·입찰 실행 허가가 아닙니다.</p><table><thead><tr><th>KREAM ID</th><th>모델</th><th>사이즈</th><th>상태</th><th>30일 체결</th><th>재고</th><th>현금 순익</th><th>사용 적립금</th><th>경제적 순익</th><th>사유</th></tr></thead><tbody>${table}</tbody></table></html>`, 'utf8');
  if (options.xlsx !== false) {
    const script = fileURLToPath(new URL('./export-xlsx.py',import.meta.url));
    const result = spawnSync('python',['-I',script,path.join(dir,'automation-final.json'),path.join(dir,'automation-final.xlsx')],{encoding:'utf8',windowsHide:true});
    if (result.status !== 0) throw new Error(`Automation XLSX failed: ${result.stderr || result.error}`);
  }
  return output;
}

export function buildAutomationReport(dir, options = {}) {
  const final = readJson(dir,'final-all.json');
  const audit = readJson(dir,'audit.json');
  if (!Array.isArray(final?.rows) || !Array.isArray(audit?.items)) throw new Error('final-all.json and audit.json are required');
  const observations = readJson(dir,'no1-observations.json',{version:'no1-observations-v1',items:[]});
  if (observations.version !== 'no1-observations-v1' || !Array.isArray(observations.items)) throw new Error('Invalid No1 observation file');
  const policy = context(dir,{now:options.now || new Date().toISOString()}).policy;
  const verified = readJson(dir,'verified-offers.json',{items:[]}).items || [];
  const rows = audit.items.map(item => {
    const original = final.rows.find(row => Object.values(row).includes(item.id));
    const base = baseStatus(original,item);
    const matching = observations.items.filter(o => String(o.kreamId) === String(item.pid) && normalizeSize(o.size) === normalizeSize(item.size));
    const observation = matching.sort((a,b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
    const checked = assessNo1(item,observation,policy,options.now);
    const reasons = [...(base === 'verified' ? [] : [`PIPELINE_${base.toUpperCase()}`]),...checked.reasons];
    const selectedCost = verified.find(offer => offer.id === item.id)?.cost;
    if (observation && validMoney(selectedCost) && observation.checkoutCost !== selectedCost) reasons.push('NO1_COST_DIFFERENT');
    if (observation && original) {
      const sourceLinks = Object.values(original).filter(value => typeof value === 'string' && /^https:\/\//.test(value) && !value.includes('kream.co.kr'));
      if (!sourceLinks.includes(observation.sourceUrl)) reasons.push('NO1_SOURCE_DIFFERENT');
    }
    return {optionId:item.id,kreamId:String(item.pid),size:item.size,model:observation?.kreamModel || '',
      sourceUrl:observation?.sourceUrl || '',capturedAt:observation?.capturedAt || '',dataAsOf:observation?.dataAsOf || '',sameSizeTrades30d:observation?.sameSizeTrades30d ?? null,
      sourceStock:observation?.sourceStock ?? null,checkoutCost:observation?.checkoutCost ?? null,instantBid:observation?.instantBid ?? null,
      instantProfit:checked.instantProfit,baseStatus:base,status:reasons.length ? 'hold' : 'candidate',reasons};
  });
  const unbound = final.rows.filter(row => !audit.items.some(item => Object.values(row).includes(item.id))).map(row => {
    const decision = row['판정'] || '';
    const status = decision === '제외' ? 'excluded' : 'hold';
    return {optionId:row['옵션ID'] || '',kreamId:String(row['크림ID'] || ''),size:String(row['상품명'] || '').match(/ \[([^\]]+)\]$/)?.[1] || '',
      model:row['모델번호'] || '',sourceUrl:row['판매처 링크'] || '',capturedAt:'',sameSizeTrades30d:null,
      sourceStock:null,checkoutCost:null,instantBid:null,instantProfit:null,baseStatus:status,status,
      reasons:[status === 'excluded' ? 'PIPELINE_EXCLUDED' : 'OFFER_NOT_BOUND',String(row['사유'] || row['검증사유코드'] || '')].filter(Boolean)};
  });
  rows.push(...unbound);
  const summary = {total:rows.length,candidate:rows.filter(r=>r.status==='candidate').length,hold:rows.filter(r=>r.status==='hold').length,
    excluded:rows.filter(r=>r.status==='excluded').length,
    no1Observations:observations.items.length,aiUsage:readJson(dir,'agents-team-ai.json',{}).usage || []};
  const output = {version:'cream-automation-v1',at:options.now || new Date().toISOString(),summary,rows};
  return writeAutomationOutput(dir,output,options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage: node automation/report.mjs <run-dir>');
  console.log(JSON.stringify(buildAutomationReport(dir).summary));
}
