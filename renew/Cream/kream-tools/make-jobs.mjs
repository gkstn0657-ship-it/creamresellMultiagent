// queue.json -> jobs.json (1단계: 네이버 쇼핑 검색 URL). 이후 단계의 작업(카탈로그/판매처 페이지)은 덤프를 분석해 추가한다.
// 사용: node make-jobs.mjs <run-dir>
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2]; const q = JSON.parse(fs.readFileSync(path.join(dir, 'queue.json'), 'utf-8'));
const limit = Number(process.argv[3]) || q.queue.length;   // 두 번째 인수: 앞에서 N개만 (첫 시험은 1)
const jobs = q.queue.slice(0, limit).map((x) => ({ id: `R${x.rank}-search`, url: 'https://search.shopping.naver.com/search/all?query=' + encodeURIComponent(x.naver_query) }));
fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify({ jobs }, null, 1));
console.log('jobs:', jobs.length, jobs.map((j) => j.id).join(', '));
