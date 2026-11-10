import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateSourcing } from '../validate-sourcing.mjs';
function fixture(t, title) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-bridge-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const w = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
  w('multi.json', [{ id: '314483', name: '몽클레르 가디건 블랙', keyword: '몽클레어', n: 40, kreamMed: 1699500 }]);
  w('n-multi.json', [{ id: '314483', best: { title, price: 468900, mallName: '머스트잇', link: 'https://mustit.co.kr/product/1', topMalls: [{ mall: '머스트잇' }] } }]);
  w('dump-K314483.json', { at: '2026-11-08T03:00:00Z', text: '모델번호 J2-091-9B50700-A9341-999/U99\n색상 Black' });
  w('jobs.json', { jobs: [] });
  const original = { rows: [{ '크림ID': '314483', '상품명': '몽클레르 가디건 블랙', '판정': '후보', '예상순수익(원)': 1142625, '수익률(%)': 243.7 }], meta: {} };
  w('final-multi.json', original); return { dir, original };
}
test('legacy report passes the common gates and a different Moncler model is excluded', async (t) => {
  const f = fixture(t, '몽클레르 로고 패딩 울 가디건 9B00002M1241');
  const r = await validateSourcing(f.dir); assert.equal(r.counts.candidates, 0); assert.equal(r.rows[0]['판정'], '제외'); assert.equal(r.rows[0]['검증사유코드'], 'MODEL_MISMATCH');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, 'final-multi.json'), 'utf8')), f.original);
});
test('matching words and large estimated margins cannot bypass missing option and cost evidence', async (t) => {
  const f = fixture(t, '몽클레르 가디건 J2-091-9B50700-A9341-999/U99');
  const r = await validateSourcing(f.dir); assert.equal(r.counts.candidates, 0); assert.ok(r.counts.review > 0);
});
