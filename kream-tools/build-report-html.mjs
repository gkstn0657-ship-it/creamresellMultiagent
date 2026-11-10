import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelFromDump, compareModel } from './model-evidence.mjs';
import { validateSourcing } from './validate-sourcing.mjs';

const dir = path.resolve(process.argv[2] || 'kream-runs/20261108');
const report = JSON.parse(fs.readFileSync(path.join(dir, 'report-data.json'), 'utf8'));
const validated = await validateSourcing(dir);
if (!report.funnel || !Array.isArray(report.candidates) || !Array.isArray(report.reference) || !Array.isArray(report.brandList)) throw new Error('보고서 데이터 형식 오류');
let template = fs.readFileSync(new URL('./report-template.html', import.meta.url), 'utf8');
const change = (before, after) => { if (!template.includes(before)) throw new Error('HTML 템플릿 변경 위치 없음: ' + before.slice(0, 60)); template = template.replaceAll(before, after); };
change('<button class="tab" role="tab" aria-selected="false" data-tab="all"', '<button class="tab" role="tab" aria-selected="false" data-tab="excluded" id="tab-excluded" aria-controls="results-panel" tabindex="-1">제외 <span class="count" id="excluded-count"></span></button><button class="tab" role="tab" aria-selected="false" data-tab="all"');
change("$('#all-count').textContent=d.rows.length;", "$('#all-count').textContent=d.rows.length;$('#excluded-count').textContent=d.rows.filter(r=>r.group==='excluded').length;");
change("r.group==='priority'?'대형몰 매칭 · 확인 필요':'참고 매칭 · 확인 필요'", "r.group==='excluded'?'품번 불일치 · 제외':r.group==='priority'?'대형몰 매칭 · 확인 필요':'참고 매칭 · 확인 필요'");
change("state.tab==='reference'?'참고 매칭':'전체 결과'", "state.tab==='reference'?'참고 매칭':state.tab==='excluded'?'품번 불일치 제외':'전체 결과'");
change("$('#detail-checks').replaceChildren();", "$('#detail-checks').replaceChildren();if(r.verification)$('#detail-checks').append(text('strong',r.verification.reason));");
change("r.group==='priority'?'우선 검토':'참고 매칭'", "r.group==='excluded'?'제외':r.group==='priority'?'우선 검토':'참고 매칭'");
change("['우선 검토 대상',d.candidates?.length??d.rows.filter(r=>r.group==='priority').length,'건','대형몰 매칭 · 개별 검증 필요']", "['검증된 매입 후보',d.verifiedCandidates,'건','공통 에이전트 검증 통과 기준']");
change('>우선 검토 <span class="count"', '>대형몰 관찰 <span class="count"');
change('우선 검토는 기존 보고서의 대형몰 매칭 분류입니다.', '대형몰 관찰은 기존 보고서의 매칭 분류입니다.');
const fields = ['keyword','name','kreamMed','price','mall','net','netPct','bestTitle','link'];
const products = JSON.parse(fs.readFileSync(path.join(dir, 'multi.json'), 'utf8'));
const clean = (row, group, i) => {
  const matches = products.filter((p) => p.name === row.name && p.keyword === row.keyword), p = matches.length === 1 ? matches[0] : null;
  let dump = null; if (p && /^\d+$/.test(String(p.id))) { try { dump = JSON.parse(fs.readFileSync(path.join(dir, `dump-K${p.id}.json`), 'utf8')); } catch {} }
  const kreamModel = modelFromDump(dump), verification = compareModel(kreamModel, row.bestTitle, row.keyword);
  return Object.fromEntries([...fields.map((key) => [key, verification.status === 'mismatch' && ['net','netPct'].includes(key) ? null : row[key] ?? null]), ['id', `${group}-${i}`], ['group', verification.status === 'mismatch' ? 'excluded' : group],
    ['kreamId', p?.id || null], ['kreamModel', kreamModel], ['verification', verification], ['historicalNet', row.net ?? null], ['historicalNetPct', row.netPct ?? null]]);
};
const data = { date: path.basename(dir), funnel: report.funnel, brandList: report.brandList, verifiedCandidates: validated.counts.candidates,
  rows: [...report.candidates.map((r, i) => clean(r, 'priority', i)), ...report.reference.map((r, i) => clean(r, 'reference', i))] };
const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const html = template.replace('<!--REPORT_DATA-->', json);
const target = path.join(dir, 'dash-index.html');
if (fs.existsSync(target) && !fs.existsSync(path.join(dir, 'dash-index.claude-original.html.bak'))) fs.copyFileSync(target, path.join(dir, 'dash-index.claude-original.html.bak'));
fs.writeFileSync(target, html, 'utf8'); fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
console.log(JSON.stringify({ html: target, rows: data.rows.length, priority: data.rows.filter((r) => r.group === 'priority').length, reference: data.rows.filter((r) => r.group === 'reference').length, excluded: data.rows.filter((r) => r.group === 'excluded').length, selfContained: true }));
