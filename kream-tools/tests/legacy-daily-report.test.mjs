import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {appendNaverDaily, naverBatchDetails} from '../legacy-daily-report.mjs';

test('옵션별 줄을 보존하고 이전 최대 적립을 확정 수익에 포함하지 않는다', () => {
  const details = naverBatchDetails([
    {'상품명':'자켓','모델번호':'A','구매가능 사이즈':'S\nM','매입가(원)':'80\n90',
      '확인 쿠폰·즉시할인(원)':'20\n0','확인 적립금(원)':'0\n','포인트 포함 순수익(원)':'-2\n7777',
      '포인트 포함 수익률(%)':'-2.5\n9999','판매처 혜택·조건':'카드 | 등급\n한도 <5%'},
    {'상품명':'구형 [L]','모델번호':'B','최대 적립 포인트(원)':12,'포인트 포함 순수익(원)':12345}
  ]);
  assert.match(details,/S<br>M/);
  assert.match(details,/20<br>0/);
  assert.match(details,/0<br>미확인/);
  assert.match(details,/-2<br>미확인/);
  assert.match(details,/카드 &#124; 등급<br>한도 &lt;5%/);
  assert.match(details,/B \| L \|/);
  assert.match(details,/최대 적립 안내\(참고\) 12/);
  assert.doesNotMatch(details,/12345|7777|9999/);
});

test('한국 판정일을 사용하고 기존 기록과 재실행 멱등성을 보존한다', {skip:process.platform !== 'win32'}, async t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(),'cream-daily-report-'));
  t.after(() => fs.rmSync(project,{recursive:true,force:true}));
  const reports = path.join(project,'상품탐색결과'), dir = path.join(project,'batch-0001-public');
  fs.mkdirSync(path.join(reports,'2026-11'),{recursive:true});
  fs.mkdirSync(dir);
  fs.copyFileSync(new URL('../../상품탐색결과/append_result.py',import.meta.url),path.join(reports,'append_result.py'));
  const report = path.join(reports,'2026-11','2026-11-22.md');
  fs.writeFileSync(report,'# 이전 날짜별 보고\n기존 수집 기록\n');
  fs.writeFileSync(path.join(dir,'k50-ids.json'),'[123]');
  fs.writeFileSync(path.join(dir,'final-all.json'),JSON.stringify({
    meta:{판정시각:'2026-11-21T16:00:00Z'},rows:[{'상품명':'자켓 [S]','확인 적립금(원)':50,'포인트 포함 순수익(원)':1050}]
  }));
  await appendNaverDaily(project,dir);
  const first = fs.readFileSync(report,'utf8');
  assert.ok(first.startsWith('# 이전 날짜별 보고\n기존 수집 기록\n'));
  assert.match(first,/확인 적립 포함 순이익/);
  assert.match(first,/1050/);
  await appendNaverDaily(project,dir);
  assert.equal(fs.readFileSync(report,'utf8'),first);
});
