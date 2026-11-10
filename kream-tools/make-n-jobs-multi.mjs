// multi.json(여러 브랜드 통합) -> 체결 데이터 있는 상품에 대해 네이버 검색 작업(N<id>-s) 생성
// 모델번호 포맷이 제각각이라(스톤아일랜드식 코드가 없는 브랜드가 대부분) 상품명 기반으로 검색어를 만든다.
// 사용: node make-n-jobs-multi.mjs <run-dir>
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2];
const multi = JSON.parse(fs.readFileSync(path.join(dir, 'multi.json'), 'utf-8'));
const j = JSON.parse(fs.readFileSync(path.join(dir, 'jobs.json'), 'utf-8'));
const collab = /슈프림|뉴발란스|포터|Supreme|New Balance|Porter/i;
const policyFile = path.join(dir, 'agent-policy.json');
const policy = fs.existsSync(policyFile) ? JSON.parse(fs.readFileSync(policyFile, 'utf8')) : {};
const minMarketPrice = policy.minMarketPrice ?? 0;
if (!Number.isFinite(minMarketPrice) || minMarketPrice < 0) throw new Error('minMarketPrice 값 오류');

const cleanQuery = (name) => name
  .replace(/\s*-\s*\d{2}(FW|SS|F\/W|S\/S)\s*$/i, '')
  .replace(/\s*-\s*한국\s*한정\s*$/i, '')
  .replace(/\(W\)\s*/g, '')
  .trim();

const elig = multi.filter((o) => o.status === 'ok' && o.n >= 10 && Number.isFinite(o.kreamMed) && o.kreamMed > 0 && o.kreamMed >= minMarketPrice && !collab.test(o.name));
const have = new Set(j.jobs.map((x) => x.id));
let add = 0;
for (const o of elig) {
  const q = o.model ? `${o.keyword} ${o.model}` : cleanQuery(o.name);
  const id = `N${o.id}-s`;
  if (have.has(id)) continue;
  j.jobs.push({
    id,
    url: 'https://search.shopping.naver.com/search/all?sort=price_asc&query=' + encodeURIComponent(q),
    actions: [{ wait: 1500 }, { toggleOff: '추천 낮은 가격순' }],
  });
  add++;
}
fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(j, null, 1));
fs.writeFileSync(path.join(dir, 'n-eligible.json'), JSON.stringify(elig.map((o) => ({ id: o.id, keyword: o.keyword, name: o.name, model: o.model || '', kreamMed: o.kreamMed, buy: o.price })), null, 1));
console.log(`대상 ${elig.length}개 | 네이버 작업 추가 ${add}개`);
for (const o of elig) console.log(`  N${o.id}-s  [${o.keyword}] ${o.name}  시세=${o.kreamMed}`);
