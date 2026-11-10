// 크림 검색 페이지에서 상품 ID 수집 → k50-ids.json (run-all 의 입력). Chrome 도구 없이 확장만으로 돌아가게 한 것.
//  1) node collect-ids.mjs <run-dir> jobs "스톤아일랜드" "스톤아일랜드 자켓" ...   → jobs.json 에 검색 페이지 작업(S1, S2, ...) 추가. 확장이 페이지를 스크롤하며 덤프.
//  2) node collect-ids.mjs <run-dir> extract [최대개수]                             → dump-S*.json 의 상품 링크에서 ID 추출, kream-runs/explored-all.json 에 있는 것은 제외 → k50-ids.json
//  3) (실행이 끝난 뒤) node collect-ids.mjs <run-dir> mark                          → 이번 k50-ids.json 을 explored-all.json 에 합침 (다음 실행에서 제외되도록)
import fs from 'node:fs'; import path from 'node:path';
import { buildKreamListUrl, isKreamListUrl, POPULAR_SORT } from './kream-list-url.mjs';
const [dir, mode, ...rest] = process.argv.slice(2);
if (!dir || !mode) { console.error('사용: node collect-ids.mjs <run-dir> jobs <검색어 또는 KREAM 카테고리 URL...> | extract [최대개수] | mark'); process.exit(1); }
const P = (f) => path.join(dir, f); const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(P(f), 'utf-8')); } catch { return d; } };
const EXPLORED = path.join(dir, '..', 'explored-all.json'); const explored = new Set((() => { try { return JSON.parse(fs.readFileSync(EXPLORED, 'utf-8')); } catch { return []; } })().map(String));
if (mode === 'jobs') {
  const kws = rest.length ? rest : ['스톤아일랜드'];
  const jobs = rd('jobs.json', { jobs: [] }).jobs || [];
  let n = Math.max(0, ...jobs.map((j) => /^S\d+$/.test(j.id) ? Number(j.id.slice(1)) : 0)), added = 0;
  // User-confirmed page parameter. Popular score is not a claim about sales-volume rank.
  const urls = kws.map(buildKreamListUrl); // Validate every input before changing jobs.json.
  for (const url of urls) {
    if (jobs.some((j) => j.url === url && (j.actions || []).some((a) => a.kreamSort === '인기순'))) continue;
    jobs.push({ id: `S${++n}`, url, expectedSort: POPULAR_SORT, actions: [{ wait: 1500 }, { kreamSort: '인기순' }] }); added++;
  }
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(P('jobs.json'), JSON.stringify({ jobs }, null, 1));
  console.log(`인기순 목록 작업 ${added}개 추가 → jobs.json (sort=${POPULAR_SORT}, 화면 표시 확인 후 추출)`);
} else if (mode === 'extract') {
  // 2026-11-07: --include-explored 면 이미 탐색한 상품도 빼지 않는다(인기 상품 다시 보기)
  const ALL = rest.includes('--include-explored'); const max = Number(rest.find((a) => /^\d+$/.test(a))) || 200; const ids = []; const seen = new Set(), evidence = [], rejected = [];
  for (const f of fs.readdirSync(dir).filter((f) => /^dump-S\d+\.json$/.test(f))) {
    const d = rd(f, {});
    const scoreUrl = isKreamListUrl(d.url) && new URL(d.url).searchParams.get('sort') === POPULAR_SORT;
    if (!scoreUrl || !d.kreamSort?.verified || d.kreamSort.selectedLabel !== '인기순' || d.blocked || d.failed || !Number.isFinite(Date.parse(d.at)) || !Number.isFinite(Date.parse(d.kreamSort.verifiedAt))) { rejected.push({ source: f, reason: 'popular_score URL·인기순 화면 확인 없음 또는 수집 실패' }); continue; }
    let position = 0;
    for (const l of d.links || []) { const m = String(l.h || '').match(/https:\/\/(?:www\.)?kream\.co\.kr\/products\/(\d+)(?:[/?#]|$)/); if (!m) continue; position++; const id = m[1]; if (seen.has(id) || (!ALL && explored.has(id))) continue; seen.add(id); ids.push(id); evidence.push({ id, source: f, url: d.url, sortParameter: POPULAR_SORT, selectedSort: d.kreamSort.selectedLabel, verifiedAt: d.kreamSort.verifiedAt, capturedAt: d.at, positionInCapturedLinks: position }); }
  }
  fs.writeFileSync(P('k50-id-evidence.json'), JSON.stringify({ rejected, items: evidence.slice(0, max), note: 'positionInCapturedLinks는 캡처된 링크 내 순서이며 공식 판매량 순위가 아님' }, null, 2));
  if (!evidence.length) throw new Error('인기순 화면 선택이 검증된 상품 목록 없음. 새 확장을 로드하고 정렬 선택부터 수집 필요');
  const out = ids.slice(0, max); fs.writeFileSync(P('k50-ids.json'), JSON.stringify(out));
  console.log(`상품 ID ${ids.length}개 발견(${ALL ? '탐색 완료 상품 포함' : `탐색 완료 ${explored.size}개 제외`}) → k50-ids.json 에 ${out.length}개 기록`);
} else if (mode === 'mark') {
  const ids = rd('k50-ids.json', []); for (const id of ids) explored.add(String(id));
  fs.writeFileSync(EXPLORED, JSON.stringify([...explored].sort(), null, 0)); console.log(`explored-all.json 갱신: ${explored.size}개`);
} else { console.error('mode 는 jobs | extract | mark'); process.exit(1); }
