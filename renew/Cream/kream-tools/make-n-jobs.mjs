// k50.json -> 소싱 가능한 상품만 네이버 검색 작업(N<id>-s) 생성. 협업(슈프림·뉴발란스·포터)·모델번호 없음·체결 10건 미만·시세 15만원 미만 제외.
// 사용: node make-n-jobs.mjs <run-dir> [q2]   (q2: 두 번째 검색어 변형으로 재검색)
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2]; const useQ2 = process.argv[3] === 'q2';
const k = JSON.parse(fs.readFileSync(path.join(dir, 'k50.json'), 'utf-8')); const j = JSON.parse(fs.readFileSync(path.join(dir, 'jobs.json'), 'utf-8'));
const collab = /슈프림|뉴발란스|포터|Supreme|New Balance|Porter/i; const acts = [{ wait: 1500 }, { toggleOff: '추천 낮은 가격순' }, { noScroll: true }];   // 2026-11-07: 상위 3개 카드만 보므로 스크롤 생략(요청 수·시간 감소)
const elig = k.filter((o) => o.model && !collab.test(o.title) && o.n >= 10);   // 2026-11-07: 시세 15만원 하한 삭제(마진 양수면 모두 포함)
const have = new Set(j.jobs.map((x) => x.id)); let add = 0;
for (const o of elig) {
  const q = useQ2 ? o.q2 : o.q1; if (!q) continue; const id = `N${o.id}-${useQ2 ? 's2' : 's'}`; if (have.has(id)) continue;
  j.jobs.push({ id, url: 'https://search.shopping.naver.com/search/all?sort=price_asc&query=' + encodeURIComponent(q), actions: acts }); add++;
}
fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(j, null, 1)); fs.writeFileSync(path.join(dir, 'n-eligible.json'), JSON.stringify(elig.map((o) => o.id)));
console.log(`대상 ${elig.length}개 | 네이버 작업 추가 ${add}개 | 표준형식 ${elig.filter((o) => o.fmtOk).length}개`);
console.log(elig.filter((o) => !o.fmtOk).map((o) => `  비표준 ${o.id} → ${o.q1}`).join('\n'));
