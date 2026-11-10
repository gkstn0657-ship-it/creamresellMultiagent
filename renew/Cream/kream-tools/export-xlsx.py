# final.json -> 엑셀 (수익후보 / 사람 검토 / 전체분석 / 제외사유 / 메타). 틀 고정 없음.
# 2026-11-07: 같은 스타일(모델번호 앞부분)의 색상·사이즈 변형은 행을 늘리지 않고 한 행에 1*n 으로 합친다.
#   '옵션' 열에 "색상코드 / 사이즈"가 줄마다 적히고, 값이 옵션마다 다른 열은 같은 순서로 줄바꿈해 적는다. 모두 같으면 한 번만 적는다.
# 사용: python -I export-xlsx.py <final.json> <out.xlsx>
import json, re, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

src, out = sys.argv[1], sys.argv[2]
data = json.load(open(src, encoding='utf-8'))
rows = data['rows']
# 2026-11-07: 크림 상품 링크(크림ID로 만듦). 셀을 누르면 열리게 하이퍼링크로 넣는다
for r in rows:
    if r.get('크림ID'):
        r['크림 링크'] = 'https://kream.co.kr/products/' + str(r['크림ID'])
COLS = ['상품명', '옵션', '옵션수', '카테고리', '크림ID', '크림 링크', '모델번호', '크림시세(원)', '시세기준', '발매가(원)', '차트 분류', '차트 판단', '차트 근거', '최근30일 체결', '크림차트 1개월', '크림차트 3개월', '크림차트 전체',
        '매입가(원)', '판매처 배송비(원)', '판매처', '판매처 링크', '상호명', '대표자', '사업자구분', '예상순수익(원)', '수익률(%)', '최대 적립 포인트(원)', '포인트 포함 순수익(원)', '포인트 포함 수익률(%)', '최대 순수익(원)', '최대 수익률(%)', '판정', '특별표시', '위험등급', '위험근거', '사유', '리스크', '재고확인', '옵션ID', '제안ID', '판매자ID', '검증상태', '검증사유코드', '관측시각', '만료시각']
GRADE_FILL = {'높음': 'F8CBAD', '중간': 'FFE699', '낮음': 'C6E0B4'}
SKIP_MERGE = {'상품명', '옵션', '옵션수', '최대 순수익(원)', '최대 수익률(%)'}

def size_of(r):
    m = re.search(r' \[([^\]]+)\]$', str(r.get('상품명', ''))); return m.group(1) if m else ''
def base_title(r): return re.sub(r' \[[^\]]+\]$', '', str(r.get('상품명', '')))
def color_of(r):
    m = str(r.get('모델번호') or ''); return m.rsplit('-', 1)[1] if '-' in m else ''
def style_of(r):
    m = str(r.get('모델번호') or ''); return m.rsplit('-', 1)[0] if '-' in m else (m or str(r.get('크림ID')))
def opt_of(r): return ' / '.join(x for x in [color_of(r), size_of(r)] if x) or '-'
def cls_of(r): j = r['판정']; return 0 if j.startswith('후보') else (1 if j == '사람 검토' else 2)

def merge(rs):
    groups, order = {}, []
    for r in rs:
        k = (style_of(r), cls_of(r), r.get('제안ID') or r.get('판매처 링크') or '')
        if k not in groups: groups[k] = []; order.append(k)
        groups[k].append(r)
    merged = []
    for k in order:
        g = groups[k]; m = {}
        for c in COLS:
            if c in SKIP_MERGE: continue
            vals = [r.get(c, '') for r in g]
            m[c] = vals[0] if all(v == vals[0] for v in vals) else '\n'.join('-' if v in ('', None) else str(v) for v in vals)
        nums = [r['예상순수익(원)'] for r in g if isinstance(r.get('예상순수익(원)'), (int, float))]
        pcts = [r['수익률(%)'] for r in g if isinstance(r.get('수익률(%)'), (int, float))]
        m['상품명'] = base_title(g[0]) + (f' (옵션 {len(g)}개)' if len(g) > 1 else '')
        m['옵션'] = '\n'.join(opt_of(r) for r in g); m['옵션수'] = len(g)
        m['최대 순수익(원)'] = max(nums) if nums else ''; m['최대 수익률(%)'] = max(pcts) if pcts else ''
        merged.append(m)
    return merged

wb = Workbook()
def sheet(title, data_rows, first=False):
    ws = wb.active if first else wb.create_sheet()
    ws.title = title
    ws.append(COLS)
    for c in ws[1]:
        c.font = Font(bold=True); c.fill = PatternFill('solid', fgColor='DDEBF7'); c.alignment = Alignment(wrap_text=True, vertical='center')
    for r in merge(data_rows):
        ws.append([r.get(c, '') for c in COLS])
    for i, c in enumerate(COLS, 1):
        w = 14
        if c in ('상품명', '사유', '리스크'): w = 38
        if c == '위험근거': w = 70
        if c == '차트 근거': w = 60
        if c in ('차트 분류', '차트 판단', '최근30일 체결'): w = 16
        if c == '위험등급': w = 10
        if c == '특별표시': w = 30
        if c == '옵션': w = 18
        if c == '옵션수': w = 8
        if c in ('판매처 링크',): w = 46
        if c == '크림 링크': w = 34
        if c in ('모델번호', '시세기준', '재고확인', '크림차트 1개월', '크림차트 3개월', '크림차트 전체'): w = 22
        ws.column_dimensions[get_column_letter(i)].width = w
    gi = COLS.index('위험등급') + 1
    for ci in (COLS.index('크림 링크') + 1, COLS.index('판매처 링크') + 1):
        for row in ws.iter_rows(min_row=2, min_col=ci, max_col=ci):
            v = row[0].value
            if isinstance(v, str) and v.startswith('http') and '\n' not in v:
                row[0].hyperlink = v; row[0].font = Font(color='0563C1', underline='single')
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical='top')
        g = row[gi - 1].value
        if g in GRADE_FILL:
            row[gi - 1].fill = PatternFill('solid', fgColor=GRADE_FILL[g]); row[gi - 1].font = Font(bold=True)
            row[gi - 1].alignment = Alignment(horizontal='center', vertical='top')
            lines = str(row[COLS.index('위험근거')].value or '').count('\n') + 1
            ws.row_dimensions[row[0].row].height = max(15 * lines, 60)
    return ws

sheet('수익후보', [r for r in rows if r['판정'].startswith('후보')], first=True)
sheet('사람 검토', [r for r in rows if r['판정'] == '사람 검토'])
sheet('전체분석', rows)
sheet('제외사유', [r for r in rows if r['판정'] == '제외'])
ws = wb.create_sheet('메타')
for k, v in data['meta'].items():
    ws.append([k, v if not isinstance(v, (list, dict)) else json.dumps(v, ensure_ascii=False)])
ws.append(['행 구성', '같은 스타일·같은 매입 제안의 색상·사이즈를 합침. 판매처 제안이 다르면 별도 행. 옵션 열의 줄 순서와 같은 순서로 다른 열의 값이 줄바꿈되어 있음. 최대 순수익·최대 수익률은 옵션 중 최댓값(숫자)'])
ws.column_dimensions['A'].width = 26; ws.column_dimensions['B'].width = 120
wb.save(out)
# 2026-11-07: 엑셀은 링크를 열기 전에 직접 접속해 보는데 크림이 그 접속을 막아 "열 수 없습니다" 오류가 난다.
# 브라우저에서 바로 누를 수 있도록 같은 후보 목록을 HTML 로도 만든다(엑셀 옆에 <이름>-links.html).
# 수익성·안정성 표시(기준은 페이지 위 설명과 같음):
#   수익성: 최대 수익률 20% 이상 높음 / 10% 이상 보통 / 미만 낮음 / 100% 초과는 데이터 오류 의심
#   안정성: 최근 30일 체결 5건 이상, 신뢰 판매처(소형몰 추정 아님), 재고 확인됨 → 3개 모두면 높음, 2개 보통, 이하 낮음.
#           하락추세·고점권 표시가 있으면 높음에서 보통으로 내림
import html as _h, os as _os
def _a(u):
    u = str(u or '')
    return ''.join(f'<a href="{_h.escape(x)}" target="_blank">열기</a><br>' for x in u.split('\n') if x.startswith('http'))
def _num(v):
    try: return float(str(v).split('\n')[0])
    except Exception: return None
def _profit(r):
    p = r.get('최대 수익률(%)')
    if not isinstance(p, (int, float)): return ('-', 'x', -1)
    if p > 100: return ('오류 의심', 'bad', -1)
    if p >= 20: return ('높음', 'hi', 2)
    if p >= 10: return ('보통', 'mid', 1)
    return ('낮음', 'lo', 0)
def _stable(r):
    flags = str(r.get('특별표시', ''))
    trades = max([x for x in (_num(t) for t in str(r.get('최근30일 체결', '')).split('\n')) if x is not None] or [0])
    why = []
    if trades >= 5: why.append(f'30일 체결 {int(trades)}건')
    if '소형몰' not in flags: why.append('신뢰 판매처')
    if '미확인' not in flags: why.append('재고 확인')
    sc = len(why); warn = ('하락추세' in flags) or ('고점권' in flags)
    if sc == 3 and not warn: return ('높음', 'hi', 2, why)
    if sc >= 2: return ('보통', 'mid', 1, why)
    return ('낮음', 'lo', 0, why)
# 거래량 수준: 최근 30일 체결 10건 이상 많음 / 5건 이상 보통 / 1건 이상 적음 / 0건 없음. 차트 근거의 "마지막 체결 N일 전"도 같이 보여줌
import re as _re
def _volume(r):
    t30 = max([x for x in (_num(t) for t in str(r.get('최근30일 체결', '')).split('\n')) if x is not None] or [0])
    m = _re.findall(r'90일 (\d+)건', str(r.get('차트 근거', ''))); t90 = max(int(x) for x in m) if m else None
    m = _re.findall(r'마지막 체결 (\d+)일 전', str(r.get('차트 근거', ''))); last = min(int(x) for x in m) if m else None
    sub = f"30일 {int(t30)}건" + (f" · 90일 {t90}건" if t90 is not None else '') + (f" · 마지막 {last}일 전" if last is not None else '')
    if t30 >= 10: return ('많음', 'hi', sub)
    if t30 >= 5: return ('보통', 'mid', sub)
    if t30 >= 1: return ('적음', 'lo', sub)
    return ('없음', 'bad', sub)
_cand = merge([r for r in rows if r['판정'].startswith('후보')])
_info = []
for r in _cand:
    pf = _profit(r); st = _stable(r); _info.append((r, pf, st))
_info.sort(key=lambda t: (-(t[1][2] + t[2][2]), -(t[0].get('최대 수익률(%)') if isinstance(t[0].get('최대 수익률(%)'), (int, float)) and t[0].get('최대 수익률(%)') <= 100 else -999)))
_both = sum(1 for _, pf, st in _info if pf[0] == '높음' and st[0] == '높음')
def _tr(r, pf, st):
    star = '⭐ ' if pf[0] == '높음' and st[0] == '높음' else ''
    cls = ' class=best' if star else ''
    return (f"<tr{cls}><td>{star}{_h.escape(str(r.get('상품명','')))}</td><td>{_h.escape(str(r.get('옵션',''))).replace(chr(10),'<br>')}</td>"
            f"<td><span class='b {pf[1]}'>{pf[0]}</span></td><td><span class='b {st[1]}'>{st[0]}</span><div class=w>{_h.escape(', '.join(st[3]) or '근거 없음')}</div></td>"
            f"<td><span class='b {_volume(r)[1]}'>{_volume(r)[0]}</span><div class=w>{_h.escape(_volume(r)[2])}</div></td>"
            f"<td class=n>{r.get('최대 수익률(%)','')}</td><td class=n>{r.get('최대 순수익(원)','')}</td><td class=n>{_h.escape(str(r.get('최근30일 체결',''))).replace(chr(10),'<br>')}</td>"
            f"<td>{_h.escape(str(r.get('판매처',''))).replace(chr(10),'<br>')}</td><td>{_a(r.get('크림 링크'))}</td><td>{_a(r.get('판매처 링크'))}</td><td class=w>{_h.escape(str(r.get('특별표시','')))}</td></tr>")
_rows = ''.join(_tr(*t) for t in _info)
_page = f"""<!doctype html><meta charset=utf-8><title>크림 후보 링크</title>
<style>body{{font:13px sans-serif;margin:16px}}table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #ccc;padding:4px 6px;vertical-align:top}}th{{background:#ddebf7;position:sticky;top:0}}.n{{text-align:right}}
.b{{display:inline-block;padding:1px 8px;border-radius:9px;font-weight:bold}}.hi{{background:#c6efce;color:#006100}}.mid{{background:#ffeb9c;color:#7a5c00}}.lo{{background:#eee;color:#666}}.bad{{background:#ffc7ce;color:#9c0006}}.x{{color:#999}}
.w{{color:#666;font-size:11px}}tr.best td{{background:#f3fbf4}}.legend{{background:#f7f7f7;border:1px solid #ddd;padding:8px 12px;margin:8px 0}}</style>
<h3>크림 후보 {len(_cand)}개 · 수익성과 안정성 모두 높음 ⭐ {_both}개</h3><p class=w>{_h.escape(out)}</p>
<div class=legend><b>수익성</b>: 최대 수익률 20% 이상 <span class='b hi'>높음</span>, 10% 이상 <span class='b mid'>보통</span>, 미만 <span class='b lo'>낮음</span>, 100% 초과 <span class='b bad'>오류 의심</span>(다른 상품·사이즈 가격이 섞였을 가능성)<br>
<b>안정성</b>: ① 최근 30일 체결 5건 이상 ② 신뢰 판매처(소형몰 추정 아님) ③ 재고 확인됨. 3개 모두 <span class='b hi'>높음</span>, 2개 <span class='b mid'>보통</span>, 1개 이하 <span class='b lo'>낮음</span>. 하락추세·고점권 표시가 있으면 높음 → 보통<br>
<b>거래량</b>: 크림 최근 30일 체결 10건 이상 <span class='b hi'>많음</span>, 5건 이상 <span class='b mid'>보통</span>, 1건 이상 <span class='b lo'>적음</span>, 0건 <span class='b bad'>없음</span>. 아래 작은 글씨에 90일 체결·마지막 체결일<br>
정렬: 두 점수 합이 높은 순, 같으면 수익률 높은 순. 엑셀의 '판정' 기준과는 별개인 참고 표시입니다.</div>
<table><tr><th>상품명</th><th>옵션</th><th>수익성</th><th>안정성</th><th>거래량</th><th>최대 수익률(%)</th><th>최대 순수익(원)</th><th>최근30일 체결</th><th>판매처</th><th>크림</th><th>판매처 링크</th><th>특별표시</th></tr>{_rows}</table>"""
_hp = _os.path.splitext(out)[0] + '-links.html'
open(_hp, 'w', encoding='utf-8').write(_page)
print('links', _hp, '| 수익성·안정성 모두 높음', _both)
cand = [r for r in rows if r['판정'].startswith('후보')]
print('saved', out, '| 원본 행', len(rows), '| 후보 행', len(cand), '→ 엑셀 후보', len(merge(cand)), '| 사람 검토', sum(1 for r in rows if r['판정'] == '사람 검토'))
