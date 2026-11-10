"""Container-compatible Excel renderer for the Agent Cream pilot."""
from datetime import datetime
from pathlib import Path
import json
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.table import Table, TableStyleInfo


def main():
    target = Path(sys.argv[1])
    payload = json.load(sys.stdin)
    obs, logs, market = payload["obs"], payload["log"], payload["market"]
    now = datetime.now().astimezone()

    book = Workbook()
    review = book.active
    review.title = "옵션별 검토"
    settings = book.create_sheet("계산 기준")
    records = book.create_sheet("실행 기록")

    assumptions = [
        ["국내 일반 신발 · 모의 기준", "값", "적용 범위"],
        ["기본 수수료(원)", 2500, "일반 Level 1 가정. VAT 별도"],
        ["판매가 대비 수수료", 0.06, "계정별 실측 전 가정"],
        ["부가세율", 0.1, "수수료에 적용"],
        ["배송·포장 합계(원)", 4000, "손익분기 추정 전용. 확인된 실비와 구분"],
        ["가격 하락률", 0.05, "보수적 기준가 스트레스 시험"],
        ["최소 이익(원)", 10000, "파일럿 기준"],
        ["최소 수익률", 0.05, "매입원가 대비"],
        ["근거", "https://kream.co.kr/faq", "분기점은 수수료 상한 전 단순 모델, 천 원 단위 올림"],
        ["관측 범위", "국내 신발", "재고 없는 원문 응답은 미확인. B 순위 미확보"],
        ["판정 기준", "실행 시점 스냅샷", "양수 호가, 최근 7일 3건·30일 10건 및 스트레스 이익 기준"],
    ]
    for row in assumptions:
        settings.append(row)

    cols = ["판정", "품번", "원문 사이즈", "GTIN", "표시가(원)", "추정 손익분기 판매가", "판정 근거",
            "즉시 구매가", "즉시 판매가", "매입원가", "발송·포장비", "호가 수수료", "즉판 수수료",
            "7일 중앙가", "30일 하위25%", "7일 거래수", "30일 거래수", "스트레스 수수료", "호가 이익",
            "즉판 이익", "스트레스 이익", "거래처 URL", "거래처 조회(KST)", "검증 근거 URL", "시세 조회 시각"]
    review.append(["KREAM 리셀 검토"])
    review.append(["F열은 매입처 표시가와 가정 비용으로 추정한 손익분기점입니다. 실제 매입 판단은 A열을 확인하세요."])
    review.merge_cells("A2:J2")
    review.append(cols)

    keys = ["ask", "bid", "landedCost", "outbound", "askFee", "bidFee", "median7", "q25_30", "count7", "count30", "stressFee"]
    for idx, (sku, size, gtin, price, availability, url, observed) in enumerate(obs, 4):
        quote = market.get(gtin) if gtin else None
        ok = False
        if quote:
            try:
                age = (now - datetime.fromisoformat(quote["observedAt"].replace("Z", "+00:00"))).total_seconds()
                ok = (quote.get("sku") == sku and quote.get("sourceUrl") == url and
                      quote.get("sourcePrice") == price and quote.get("optionVerified") is True and
                      (availability == "https://schema.org/InStock" or quote.get("stockVerified") is True) and
                      quote.get("domesticVerified") is True and quote.get("sellerVerified") is True and
                      str(quote.get("evidenceUrl", "")).startswith("https://") and 0 <= age <= 600 and
                      all(isinstance(quote.get(k), (int, float)) and quote[k] >= 0 for k in keys) and
                      all(quote[k] > 0 for k in ["ask", "bid", "median7", "q25_30", "landedCost"]) and
                      quote["count7"] <= quote["count30"] and
                      isinstance(quote["count7"], int) and isinstance(quote["count30"], int))
            except (KeyError, TypeError, ValueError):
                ok = False
        reason = ("동일 옵션·재고·비용 확인" if ok else
                  "시각·옵션·금액 또는 증빙 검증 실패" if quote else
                  "사이즈·재고·동일 옵션 시세 미확인" if not size else
                  "동일 옵션 시세 미확인" + ("" if availability else " / 재고 미확인"))
        values = [quote[k] if ok else None for k in keys]
        review.append([None, sku, size, gtin, price, None, reason, *values, None, None, None,
                       url, observed, quote.get("evidenceUrl") if ok else None,
                       quote.get("observedAt") if ok else None])
        review[f"F{idx}"] = f"=ROUNDUP((E{idx}+'계산 기준'!$B$5+'계산 기준'!$B$2*(1+'계산 기준'!$B$4))/(1-'계산 기준'!$B$3*(1+'계산 기준'!$B$4)),-3)"
        review[f"S{idx}"] = f'=IF(COUNT(H{idx}:R{idx})=11,H{idx}-J{idx}-K{idx}-L{idx},"")'
        review[f"T{idx}"] = f'=IF(COUNT(H{idx}:R{idx})=11,I{idx}-J{idx}-K{idx}-M{idx},"")'
        review[f"U{idx}"] = f'=IF(COUNT(H{idx}:R{idx})=11,ROUNDDOWN(MIN(I{idx},N{idx},O{idx})*(1-\'계산 기준\'!$B$6),0)-J{idx}-K{idx}-R{idx},"")'
        review[f"A{idx}"] = f'=IF(COUNT(H{idx}:R{idx})<>11,"보류",IF(S{idx}<=0,"제외",IF(AND(P{idx}>=3,Q{idx}>=10,U{idx}>=\'계산 기준\'!$B$7,U{idx}>=J{idx}*\'계산 기준\'!$B$8),"매입 검토","관찰")))'

    records.append(["경로", "대상", "관측 옵션 수", "상태/사유"])
    for row in logs:
        records.append(row)

    header_fill = PatternFill("solid", fgColor="164A54")
    for sheet, header_row in [(review, 3), (settings, 1), (records, 1)]:
        for cell in sheet[header_row]:
            cell.fill = header_fill
            cell.font = Font(color="FFFFFF", bold=True)
            cell.alignment = Alignment(vertical="center")
        sheet.freeze_panes = f"A{header_row + 1}"
        sheet.auto_filter.ref = sheet.dimensions
        for column in sheet.columns:
            letter = column[0].column_letter
            width = max(len(str(cell.value or "")) for cell in column)
            sheet.column_dimensions[letter].width = min(70, max(10, width * 1.2 + 2))

    if obs:
        table = Table(displayName="OptionReview", ref=f"A3:Y{3 + len(obs)}")
        table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
        review.add_table(table)
    for row in range(4, 4 + len(obs)):
        for col in range(5, 22):
            review.cell(row, col).number_format = "#,##0"
    for row in (3, 4, 6, 8):
        settings[f"B{row}"].number_format = "0.0%"

    book.calculation.fullCalcOnLoad = True
    book.calculation.forceFullCalc = True
    book.calculation.calcMode = "auto"
    target.parent.mkdir(parents=True, exist_ok=True)
    book.save(target)
    print(f"Workbook written: {target}")


if __name__ == "__main__":
    main()
