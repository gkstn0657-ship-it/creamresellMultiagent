// n-multi.json(여러 브랜드 통합 네이버 매칭 결과) -> final-multi.json (export-xlsx.py 입력 포맷)
// 사용: node build-final-multi.mjs <run-dir>
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2];
const n = JSON.parse(fs.readFileSync(path.join(dir, 'n-multi.json'), 'utf-8'));

const rows = [];
for (const o of n) {
  const base = {
    상품명: o.name, 카테고리: o.keyword, 크림ID: o.id, 모델번호: '', '크림시세(원)': o.kreamMed, 시세기준: `체결 ${''}건(크림)`,
    '발매가(원)': '', '크림차트 1개월': '', '크림차트 3개월': '', '크림차트 전체': '',
  };
  if (o.status !== 'ok') {
    rows.push({ ...base, 판정: '제외-매칭대기', 사유: '네이버 덤프 미완료', 리스크: '', 재고확인: '' });
    continue;
  }
  if (!o.best) {
    rows.push({ ...base, 판정: '제외-매칭없음', 사유: '네이버에서 동일 상품 미발견(모델명 토큰 매칭 실패)', 리스크: '', 재고확인: '' });
    continue;
  }
  const isCandidate = o.net >= 10000 && o.netPct >= 8 && o.best.trusted;
  rows.push({
    ...base,
    '매입가(원)': o.best.price,
    판매처: o.best.mallName || '(미상)',
    '판매처 링크': o.best.link || '',
    상호명: '', 대표자: '', 사업자구분: '',
    '예상순수익(원)': o.net,
    '수익률(%)': o.netPct,
    판정: isCandidate ? '후보' : (o.best.trusted ? '제외-마진부족' : '제외-비신뢰판매처(참고용)'),
    사유: isCandidate ? '' : (o.best.trusted ? `순이익 ${o.net.toLocaleString()}원(${o.netPct}%) 기준 미달` : '신뢰 판매처 목록(롯데ON·SSG·신세계·현대·머스트잇·W컨셉·트렌비·LFmall) 외 매물 — 구매 전 직접 확인 필요'),
    리스크: '제목 토큰 매칭 기반(모델번호 없는 브랜드) — 색상/사이즈 재확인 필요',
    재고확인: '미확인',
  });
}
const out = {
  meta: {
    생성일: new Date().toISOString(),
    설명: '여러 브랜드 통합 소싱 실행 — 모델번호가 없는 브랜드가 대부분이라 상품명 토큰 매칭 사용. 신뢰 판매처 매칭만 실제 후보로 분류.',
    브랜드목록: [...new Set(n.map(o => o.keyword))],
  },
  rows,
};
fs.writeFileSync(path.join(dir, 'final-multi.json'), JSON.stringify(out, null, 1));
console.log(`rows=${rows.length} 후보=${rows.filter(r=>r.판정==='후보').length}`);
