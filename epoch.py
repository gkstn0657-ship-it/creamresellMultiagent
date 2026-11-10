"""Run one pilot pass over the bookmarked Nike source."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

import requests
from bs4 import BeautifulSoup
from openpyxl import Workbook

ROOT = Path(__file__).resolve().parent
SKU = "CW2288-111"
URL = f"https://www.nike.com/kr/t/에어-포스-1-07-남성-신발-qdjlTENZ/{SKU}"


def nike_offers():
    hosts = set()
    for path in ROOT.glob("bookmark*.html"):
        doc = BeautifulSoup(path.read_bytes(), "html.parser")
        hosts.update(urlsplit(a["href"]).hostname for a in doc.select("a[href]"))
    if urlsplit(URL).hostname not in hosts:
        raise ValueError("Nike source missing from bookmarks")
    response = requests.get(URL, timeout=20)
    response.raise_for_status()
    offers = []
    page = BeautifulSoup(response.content, "html.parser")
    for tag in page.select('script[type="application/ld+json"]'):
        data = json.loads(tag.get_text())
        for group in data if isinstance(data, list) else [data]:
            for variant in group.get("hasVariant", []):
                offer = variant.get("offers", {})
                if variant.get("mpn") == SKU and offer.get("priceCurrency") == "KRW":
                    offers.append([SKU, variant.get("size"), variant.get("gtin"),
                                   offer.get("price"), offer.get("availability"), URL])
    return offers


def main():
    now = datetime.now(timezone(timedelta(hours=9)))
    book = Workbook()
    candidates = book.active
    candidates.title = "매입 후보"
    candidates.append(["품번", "KR 사이즈", "예상 이익(원)", "근거"])
    src = book.create_sheet("거래처 관측")
    src.append(["품번", "원문 사이즈", "GTIN", "표시가(원)", "원문 재고", "출처"])
    try:
        offers = nike_offers()
        for row in offers:
            src.append(row)
        note = f"나이키 원문 옵션 {len(offers)}건. KR 사이즈와 현재 KREAM 호가 대조 전"
    except (requests.RequestException, ValueError) as exc:
        note = f"거래처 조회 실패: {exc}"
    log = book.create_sheet("실행 기록")
    log.append(["실행 시각(KST)", "경로", "상태", "사유"])
    log.append([now.isoformat(), "A", "보류", note])
    log.append([now.isoformat(), "B", "미실행", "KREAM 접근 제한으로 판매 순위 미확보"])
    for sheet in book:
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        for column in sheet.columns:
            width = max(len(str(c.value or "")) for c in column)
            sheet.column_dimensions[column[0].column_letter].width = min(90, width * 1.5 + 3)
    path = ROOT / "runs" / f"epoch-{now:%Y%m%d-%H%M%S-%f}.xlsx"
    path.parent.mkdir(exist_ok=True)
    book.save(path)
    print(note, path, sep="\n")


if __name__ == "__main__":
    main()
