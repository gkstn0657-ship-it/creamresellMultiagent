import fs from 'node:fs/promises';
import {Workbook, SpreadsheetFile} from '@oai/artifact-tool';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const {obs, log, market} = JSON.parse(Buffer.concat(chunks));
const now = Date.now();
const book = Workbook.create();
const sh = book.worksheets.add('옵션별 검토');
const settings = book.worksheets.add('계산 기준');
const records = book.worksheets.add('실행 기록');
function write(sheet, row, values) {
  sheet.getRangeByIndexes(row - 1, 0, 1, values.length).values = [values];
}
function header(sheet, row, cols) {
  const f = sheet.getRangeByIndexes(row-1,0,1,cols).format;
  f.fill = '#164A54'; f.font.color = '#FFFFFF'; f.font.bold = true; f.rowHeight = 25;
}
const assumptions = [
 ['국내 일반 신발 · 모의 기준','값','적용 범위'],
 ['기본 수수료(원)',2500,'일반 Level 1 가정. VAT 별도'],
 ['판매가 대비 수수료',0.06,'계정별 실측 전 가정'],
 ['부가세율',0.1,'수수료에 적용'],
 ['배송·포장 합계(원)',4000,'손익분기 추정 전용. 확인된 실비와 구분'],
 ['가격 하락률',0.05,'보수적 기준가 스트레스 시험'],
 ['최소 이익(원)',10000,'파일럿 기준'],['최소 수익률',0.05,'매입원가 대비'],
 ['근거','https://kream.co.kr/faq','분기점은 수수료 상한 전 단순 모델, 천 원 단위 올림'],
 ['관측 범위','국내 신발','재고 없는 원문 응답은 미확인. B 순위 미확보'],
 ['판정 기준','실행 시점 스냅샷','양수 호가, 최근 7일 3건·30일 10건 및 스트레스 이익 기준'],
];
assumptions.forEach((r,i)=>write(settings,i+1,r)); header(settings,1,3);
for (const r of [3,4,6,8]) settings.getRange('B'+r).setNumberFormat('0.0%');
const cols = ['판정','품번','원문 사이즈','GTIN','표시가(원)','추정 손익분기 판매가','판정 근거','즉시 구매가','즉시 판매가','매입원가','발송·포장비','호가 수수료','즉판 수수료','7일 중앙가','30일 하위25%','7일 거래수','30일 거래수','스트레스 수수료','호가 이익','즉판 이익','스트레스 이익','거래처 URL','거래처 조회(KST)','검증 근거 URL','시세 조회 시각'];
write(sh,1,['KREAM 리셀 검토']);write(sh,2,['F열은 매입처 표시가와 가정 비용으로 추정한 손익분기점입니다. 실제 매입 판단은 A열을 확인하세요.']);
sh.getRange('A2:J2').merge();
write(sh,3,cols);header(sh,3,cols.length);
for(const [idx,[sku,size,gtin,price,availability,url,time]] of obs.entries()){
  const n=idx+4;
  const q=gtin ? market[gtin] : null;
  const keys=['ask','bid','landedCost','outbound','askFee','bidFee','median7','q25_30','count7','count30','stressFee'];
  const age=now-Date.parse(q?.observedAt);
  const ok=q && q.sku===sku && q.sourceUrl===url && q.sourcePrice===price && q.optionVerified===true &&
    (availability==='https://schema.org/InStock'||q.stockVerified===true) && q.domesticVerified===true &&
    q.sellerVerified===true && /^https:\/\//.test(q.evidenceUrl) && age>=0 && age<=600000 &&
    keys.every(k=>Number.isFinite(q[k]) && q[k]>=0) &&
    ['ask','bid','median7','q25_30','landedCost'].every(k=>q[k]>0) &&
    q.count7<=q.count30 && Number.isInteger(q.count7) && Number.isInteger(q.count30);
  const reason=ok?'동일 옵션·재고·비용 확인':q?'시각·옵션·금액 또는 증빙 검증 실패':!size?'사이즈·재고·동일 옵션 시세 미확인':'동일 옵션 시세 미확인'+(availability?'':' / 재고 미확인');
  write(sh,n,[null,sku,size,gtin,price,null,reason,...keys.map(k=>ok?q[k]:null),null,null,null,url,time,ok?q.evidenceUrl:null,ok?q.observedAt:null]);
  const f=(c,formula)=>{sh.getRange(c+n).formulas=[[formula]]};
  f('F',`=ROUNDUP((E${n}+'계산 기준'!$B$5+'계산 기준'!$B$2*(1+'계산 기준'!$B$4))/(1-'계산 기준'!$B$3*(1+'계산 기준'!$B$4)),-3)`);
  f('S',`=IF(COUNT(H${n}:R${n})=11,H${n}-J${n}-K${n}-L${n},"")`);
  f('T',`=IF(COUNT(H${n}:R${n})=11,I${n}-J${n}-K${n}-M${n},"")`);
  f('U',`=IF(COUNT(H${n}:R${n})=11,ROUNDDOWN(MIN(I${n},N${n},O${n})*(1-'계산 기준'!$B$6),0)-J${n}-K${n}-R${n},"")`);
  f('A',`=IF(COUNT(H${n}:R${n})<>11,"보류",IF(S${n}<=0,"제외",IF(AND(P${n}>=3,Q${n}>=10,U${n}>='계산 기준'!$B$7,U${n}>=J${n}*'계산 기준'!$B$8),"매입 검토","관찰")))`);
}
const end=3+obs.length;
if(obs.length){
 sh.tables.add('A3:Y'+end,true,'OptionReview');
 sh.getRange('E4:F'+end).setNumberFormat('#,##0');
 sh.getRange('H4:U'+end).setNumberFormat('#,##0;[Red](#,##0);0');
}
sh.freezePanes.freezeRows(3);
write(records,1,['경로','조회 대상','수집 행','결과']);log.forEach((r,i)=>write(records,i+2,r));header(records,1,4);
for(const [sheet,widths] of [[sh,[110,135,100,155,110,165,335,...Array(14).fill(120),400,240,320,240]],[settings,[245,220,440]],[records,[85,490,95,550]]]){
 widths.forEach((w,i)=>sheet.getRangeByIndexes(0,i,1,1).format.columnWidthPx=w);
}
book.recalculate();
if(obs.length && !(sh.getRange('F4').values[0][0]>=obs[0][3])) throw Error('분기점 검산 실패');
const output=await SpreadsheetFile.exportXlsx(book);await output.save(process.argv[2]);
