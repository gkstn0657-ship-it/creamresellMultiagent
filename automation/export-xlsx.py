import json
import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

data = json.load(open(sys.argv[1], encoding='utf-8'))
columns = ['kreamId', 'model', 'size', 'status', 'baseStatus', 'sameSizeTrades30d',
           'sourceStock', 'checkoutCost', 'instantBid', 'cashProfit', 'existingPointsUsed', 'instantProfit',
           'economicStressProfit', 'newPointsEarned', 'capturedAt', 'dataAsOf', 'no1CapturedAt', 'sourceUrl', 'reasons', 'optionId']
book = Workbook()
sheet = book.active
sheet.title = '자동 검증'
sheet.append(columns)
for cell in sheet[1]:
    cell.font = Font(bold=True)
    cell.fill = PatternFill('solid', fgColor='DDEBF7')
for row in data['rows']:
    values = []
    for key in columns:
        value = row.get(key, '')
        if isinstance(value, list):
            value = ', '.join(value)
        if isinstance(value, str) and value.startswith(('=', '+', '-', '@')):
            value = "'" + value
        values.append(value)
    sheet.append(values)
sheet.freeze_panes = 'A2'
sheet.auto_filter.ref = sheet.dimensions
for name, width in {'A': 16, 'B': 26, 'C': 14, 'D': 14, 'M': 55}.items():
    sheet.column_dimensions[name].width = width
book.save(sys.argv[2])
