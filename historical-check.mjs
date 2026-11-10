import {FileBlob, SpreadsheetFile} from '@oai/artifact-tool';
const [input,output]=process.argv.slice(2);
const book=await SpreadsheetFile.importXlsx(await FileBlob.load(input));
const s=book.worksheets.add('과거 체결 대조');
s.getRange('A1:I1').values=[['품번','옵션(mm)','나이키 표시가','KREAM 과거 체결가','비용 전 차이','가정 수수료','모의 손익','근거','거래처']];
const nike='https://www.nike.com/kr/t/에어-포스-1-07-남성-신발-qdjlTENZ/CW2288-111';
const source='https://kream.co.kr/products/12831%3Fsize%3D230';
// Option labels belong to individual trade rows, not the page-level size selector.
for(const [i,[size,trade]] of [[270,105000],[285,96000],[255,112000],[245,137000],[245,136000]].entries()){
 const n=i+2;
 s.getRange('A'+n+':I'+n).values=[['CW2288-111',size,149000,trade,null,null,null,source,nike]];
 s.getRange('E'+n+':G'+n).formulas=[[`=D${n}-C${n}`,`=ROUND(('계산 기준'!$B$2+D${n}*'계산 기준'!$B$3)*(1+'계산 기준'!$B$4),0)`,`=E${n}-F${n}-'계산 기준'!$B$5`]];
}
s.getRange('A8:I8').merge();s.getRange('A8').values=[['이전 조회 스냅샷의 체결 5건. 현재 호가·재고·체결일 미확인. 일반 판매 수수료와 발송·포장비 가정.']];
s.getRange('A9:I9').merge();s.getRange('A9').values=[['KREAM은 CW2288-111과 315122-111을 한 페이지에서 거래하므로 개별 체결품의 라벨 품번은 미확인.']];
s.getRange('A1:I1').format.fill='#174956';s.getRange('A1:I1').format.font.color='#FFFFFF';
s.getRange('A1:I9').format.columnWidth=20;s.getRange('C2:G6').setNumberFormat('#,##0;[Red](#,##0);0');
book.recalculate();
await (await SpreadsheetFile.exportXlsx(book)).save(output);
