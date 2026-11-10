# final.json -> 엑셀 (수익후보 / 전체분석 / 제외사유 / 메타). 틀 고정 없음.
# 사용: python -I export-xlsx.py <final.json> <out.xlsx>
import json, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

src, out = sys.argv[1], sys.argv[2]
data = json.load(open(src, encoding='utf-8'))
rows = data['rows']
COLS = ['상품명', '카테고리', '크림ID', '모델번호', '크림시세(원)', '시세기준', '발매가(원)', '크림차트 1개월', '크림차트 3개월', '크림차트 전체',
        '매입가(원)', '판매처', '판매처 링크', '상호명', '대표자', '사업자구분', '예상순수익(원)', '수익률(%)', '판정', '사유', '리스크', '재고확인']

wb = Workbook()
def sheet(title, data_rows, first=False):
    ws = wb.active if first else wb.create_sheet()
    ws.title = title
    ws.append(COLS)
    for c in ws[1]:
        c.font = Font(bold=True); c.fill = PatternFill('solid', fgColor='DDEBF7'); c.alignment = Alignment(wrap_text=True, vertical='center')
    for r in data_rows:
        ws.append([r.get(c, '') for c in COLS])
    for i, c in enumerate(COLS, 1):
        w = 14
        if c in ('상품명', '사유', '리스크'): w = 38
        if c in ('판매처 링크',): w = 46
        if c in ('모델번호', '시세기준', '재고확인', '크림차트 1개월', '크림차트 3개월', '크림차트 전체'): w = 22
        ws.column_dimensions[get_column_letter(i)].width = w
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical='top')
    return ws

sheet('수익후보', [r for r in rows if r['판정'].startswith('후보')], first=True)
sheet('전체분석', rows)
sheet('제외사유', [r for r in rows if not r['판정'].startswith('후보')])
ws = wb.create_sheet('메타')
for k, v in data['meta'].items():
    ws.append([k, v if not isinstance(v, (list, dict)) else json.dumps(v, ensure_ascii=False)])
ws.column_dimensions['A'].width = 26; ws.column_dimensions['B'].width = 120
wb.save(out)
print('saved', out, '| rows', len(rows), '| candidates', sum(1 for r in rows if r['판정'].startswith('후보')))
