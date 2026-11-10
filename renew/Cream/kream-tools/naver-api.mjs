// 종료된 네이버 쇼핑 API의 저장 응답 변환기. 라이브 호출은 2026-07-31 서비스 종료로 지원하지 않는다.
// 사용: node kream-tools/naver-api.mjs <run-dir> [--top=3] [--fixture=<api응답.json>]
//   인증키를 읽거나 API를 호출하지 않는다. run-all의 --naver-api는 일반 페이지 수집 경로로 연결된다.
//   --fixture: 네트워크 없이 저장된 API 응답({items:[...]})으로 변환만 시험(preflight 용). 이때 모든 상품이 같은 응답을 쓴다.
// 변환 규칙(parse-si 와 같은 결과 모양):
//   · 가격 낮은 순(sort=asc) 100개 → 해외직구·중고 제외 → 모델·색상 코드 정확 일치(띄어쓰기 차이는 표시) → 위에서 --top(기본 3)개
//   · 가격은 API 의 lprice, 배송비는 API 에 없어 null(엑셀에 '⚠배송비 미확인' 표시, 판매처 페이지 확인 필요)
//   · mallName 이 '네이버'면 가격비교 카탈로그 카드로 보고 기존 카탈로그 단계가 판매처 행을 읽는다
import fs from 'node:fs'; import path from 'node:path';
import { codeMatch, splitModel, otherColor } from './code-match.mjs';
import { NAVER_SHOPPING_RETIREMENT } from './naver-search-mode.mjs';
const args = process.argv.slice(2); const dir = args.find((a) => !a.startsWith('--'));
if (!dir) { console.error('사용: node kream-tools/naver-api.mjs <run-dir> [--top=3] [--fixture=파일]'); process.exit(1); }
const TOP = Number((args.find((a) => a.startsWith('--top=')) || '=3').split('=')[1]) || 3;
const fixtureArg = (args.find((a) => a.startsWith('--fixture=')) || '').split('=').slice(1).join('=');
if (!fixtureArg) {
  console.error(NAVER_SHOPPING_RETIREMENT.message + ' ' + NAVER_SHOPPING_RETIREMENT.notice);
  process.exit(4);
}
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); } catch { return d; } };
const decode = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();


const USED = /중고|리퍼|전시|스크래치|B급/;
const OVERSEAS = /해외직구|구매대행|배송대행|^해외/;
function toCards(p, items) {
  const cards = [];
  for (const it of items) {
    const title = decode(it.title); const price = Number(it.lprice); if (!price) continue;
    const mall = decode(it.mallName); const isCatalog = mall === '네이버';
    const overseas = OVERSEAS.test(title) || /해외|직구/.test(mall); const used = USED.test(title) || [4, 5, 6].includes(Number(it.productType));
    const cm = codeMatch(p.model, title);
    const colorMatch = cm.code !== false ? true : (isCatalog && !otherColor(p.model, title) ? null : false);
    cards.push({ title, price, mallsN: 1, overseas, used, isCatalog, shipRaw: '', shipFee: null, keyMatch: cm.key, colorMatch, codeType: cm.code, codeNote: cm.note, link: it.link || null, topMalls: isCatalog ? [] : [{ mall, price }], productId: it.productId, brand: it.brand || '' });
  }
  return cards;
}

const k = rd('k50.json', []); const collab = /슈프림|뉴발란스|포터|Supreme|New Balance|Porter/i;
const elig = k.filter((o) => o.model && !collab.test(o.title) && o.n >= 10);
const fixture = JSON.parse(fs.readFileSync(path.resolve(fixtureArg), 'utf-8'));
const out = {}; let calls = 0, empty = 0, matchedCnt = 0;
for (const p of elig) {
  const q = p.q1; if (!q) continue;
  const data = fixture;
  calls++; const all = toCards(p, data.items || []);
  const pool = all.filter((c) => !c.overseas && !c.used && c.keyMatch && c.colorMatch !== false);   // 정확 일치 + 신품 + 국내
  const cards = pool.slice(0, TOP);   // 낮은 가격순이므로 위에서 TOP 개
  if (!all.length) empty++; matchedCnt += cards.length ? 1 : 0;
  const { style: key2, color } = splitModel(p.model);
  out[p.id] = { name: p.title, model: p.model, key: key2, color, kream: p.kreamMed, cards: all.length, matched: cards };
}
fs.writeFileSync(path.join(dir, 'n-cards.json'), JSON.stringify(out, null, 1));
console.log(`저장된 API 응답 변환 ${calls}건 → n-cards.json (결과 0건 ${empty}건, 코드 일치 카드가 있는 상품 ${matchedCnt}개, 상품당 상위 ${TOP}개; 라이브 연결 아님)`);
