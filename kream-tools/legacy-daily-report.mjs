import {reportPython} from './project-python.mjs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const meaningful = value => value != null && String(value).trim() !== '';
const confirmedAmount = value => /^\d+(?:,\d{3})*$/.test(String(value ?? '').trim());

function cell(value) {
  if (!meaningful(value)) return '미확인';
  return String(value).split(/\r\n|[\r\n]/).map(line => line.trim()
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;')
    || '미확인').join('<br>');
}

function table(headers, rows) {
  const line = values => '| ' + values.map(cell).join(' | ') + ' |';
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

function totalWithConfirmedPoints(row, column) {
  const points = String(row['확인 적립금(원)'] ?? '').split(/\r\n|[\r\n]/);
  const totals = String(row[column] ?? '').split(/\r\n|[\r\n]/);
  return totals.map((amount, i) => confirmedAmount(points[i]) ? amount : '').join('\n');
}

export function naverBatchDetails(rows) {
  if (!rows.length) return '감사 결과에 등록된 상품 행이 없습니다.';
  const overview = [], benefits = [];
  for (const row of rows) {
    const name = String(row['상품명'] || '');
    const option = row['구매가능 사이즈'] || name.match(/ \[([^\]]+)\]$/)?.[1];
    const identity = [row['모델번호'] || row['크림ID'], option, row['판매처']];
    // Older exports used the advertised maximum when computing points-inclusive totals.
    const terms = [row['판매처 혜택·조건']];
    if (meaningful(row['최대 적립 포인트(원)'])) {
      terms.push('최대 적립 안내(참고) ' + row['최대 적립 포인트(원)']);
    }
    overview.push([name, ...identity, row['재고확인'] || row['재고'], row['크림시세(원)'], row['시세기준'],
      row['예상순수익(원)'], row['수익률(%)'], row['판정'], row['사유']]);
    benefits.push([...identity, row['할인 전 옵션가(원)'], row['확인 쿠폰·즉시할인(원)'], row['매입가(원)'],
      row['판매처 배송비(원)'], row['확인 적립금(원)'], totalWithConfirmedPoints(row, '포인트 포함 순수익(원)'),
      totalWithConfirmedPoints(row, '포인트 포함 수익률(%)'), terms.filter(meaningful).join('\n'), row['혜택 근거']]);
  }
  return ['상품별 판정과 현금 손익', '',
    table(['상품명','모델번호','옵션','구매처','재고','KREAM 예상 판매가(원)','거래 근거','현금 순이익(원)','현금 마진율(%)','판정','사유'], overview),
    '', '옵션별 판매처 혜택과 매입가', '',
    table(['모델번호','옵션','구매처','할인 전 기준가(원)','확인 쿠폰·즉시할인(원)','결제 매입가(배송비 별도·원)','매입 배송비(원)','확인 적립금(원)','확인 적립 포함 순이익(원)','확인 적립 포함 마진율(%)','혜택 적용 조건·조건부 안내','혜택 근거'], benefits)
  ].join('\n');
}

export async function appendNaverDaily(project, dir, reason) {
  const idsFile = path.join(dir, 'k50-ids.json');
  const firstId = fs.existsSync(idsFile) && JSON.parse(fs.readFileSync(idsFile, 'utf8'))[0];
  const final = reason ? {} : JSON.parse(fs.readFileSync(path.join(dir, 'final-all.json'), 'utf8'));
  if (!reason && !Array.isArray(final.rows)) throw Error('감사 결과에 상품 목록이 없습니다.');
  const judged = Date.parse(final.meta?.판정시각);
  const day = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul'}).format(Number.isFinite(judged) ? judged : Date.now());
  const suffix = reason ? 'pending-v2-' + createHash('sha256').update(reason).digest('hex').slice(0,12) : 'final-benefits-v2';
  const entry = {
    id: 'naver-legacy/' + path.relative(project, dir) + '/' + suffix,
    title: '네이버 가격비교 소싱 · ' + path.basename(dir), status: reason ? '중단·확인 필요' : '감사 완료',
    details: reason || naverBatchDetails(final.rows || []),
    sources: [/^[1-9]\d*$/.test(String(firstId)) ? {label:'KREAM 상품',url:'https://kream.co.kr/products/'+firstId}
      : {label:'KREAM',url:'https://kream.co.kr/'}]
  };
  const [python, ...flags] = reportPython;
  const child = spawn(python, [...flags,'-X','utf8',path.join(project,'상품탐색결과','append_result.py'),'--date',day,'--entry','-'],
    {stdio:['pipe','ignore','pipe'], windowsHide:true});
  let errorText = '';
  child.stderr.on('data', data => { errorText += data; });
  const finished = new Promise((resolve,reject) => { child.once('error',reject); child.once('close',resolve); });
  child.stdin.end(JSON.stringify(entry));
  if (await finished) throw Error('결과 기록 실패 ' + errorText.slice(-220));
}
