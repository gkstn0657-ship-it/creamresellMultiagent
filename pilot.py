"""One bounded, read-only domestic footwear discovery pass."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit
import json

import requests
from bs4 import BeautifulSoup
import shutil
import subprocess
import argparse
import os

ROOT = Path(__file__).resolve().parent
NIKE = "https://www.nike.com/kr/w/shoes-y7ok"
NB = "https://www.nbkorea.com/product/productDetail.action?colCode=10&styleCode=NBPDGF718W"
ADIDAS = "https://www.adidas.co.kr/삼바-og/B75806.html"
KST = timezone(timedelta(hours=9))


def page(url):
    response = requests.get(url, timeout=(5, 10))
    response.raise_for_status()
    return BeautifulSoup(response.content, "lxml")


def product_rows(url):
    doc = page(url)
    if url == NB:
        name = doc.select_one('meta[property="eg:itemName"]')
        price = doc.select_one('meta[property="eg:salePrice"]')
        if name and name.get("content") == "MR530SG" and price:
            return [["MR530SG", None, None, int(price["content"]), None]]
        return []
    sku = urlsplit(url).path.split("/")[-1].split(".")[0]
    rows = []
    for script in doc.select('script[type="application/ld+json"]'):
        data = json.loads(script.get_text())
        for item in data if isinstance(data, list) else [data]:
            for v in item.get("hasVariant", [item]):
                offer = v.get("offers", {})
                if (v.get("mpn") or v.get("sku")) != sku or not isinstance(offer, dict):
                    continue
                if offer.get("priceCurrency") == "KRW" and offer.get("price"):
                    rows.append([sku, v.get("size"), v.get("gtin"), int(float(offer["price"])), offer.get("availability")])
    return rows


def inspect(target):
    try:
        return target, product_rows(target), ""
    except (requests.RequestException, ValueError, TypeError, AttributeError) as exc:
        return target, [], str(exc)[:400]


def main():
    start = datetime.now(KST)
    parser = argparse.ArgumentParser()
    parser.add_argument("--market", type=Path, help="Authorized option quotes keyed by GTIN (JSON)")
    args = parser.parse_args()
    obs, log = [], []
    hosts = {urlsplit(a["href"]).hostname for f in ROOT.glob("bookmark*.html")
             for a in BeautifulSoup(f.read_bytes(), "html.parser").select("a[href]")}
    targets = [NB, ADIDAS]
    if urlsplit(NIKE).hostname in hosts:
        try:
            targets.extend(dict.fromkeys(a["href"].split("?")[0] for a in page(NIKE).select('a[href*="/kr/t/"]')))
        except requests.RequestException as exc:
            log.append(["A", NIKE, 0, str(exc)])
    targets = [url for url in targets if urlsplit(url).hostname in hosts][:50]
    with ThreadPoolExecutor(max_workers=2) as pool:
        for url, rows, error in pool.map(inspect, targets):
            for row in rows:
                obs.append(row + [url, datetime.now(KST).isoformat(timespec="seconds")])
            log.append(["A", url, len(rows), error or ("수집 완료" if rows else "가격·품번 검증 실패")])
    log.append(["B", "KREAM 신발 판매 인기순", 0, "브라우저 도메인 접근 제한. 목표 20개 순위 확보 전. 네이버 조회 미실행"])
    out = ROOT / "outputs" / "resale-pilot" / f"리셀검토-{start:%Y%m%d-%H%M%S}.xlsx"
    out.parent.mkdir(parents=True, exist_ok=True)
    node = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe"
    market = json.loads(args.market.read_text(encoding="utf-8-sig")) if args.market else {}
    payload = json.dumps(dict(obs=obs, log=log, market=market)).encode()
    if os.environ.get("CREAM_DOCKER") == "1":
        subprocess.run([shutil.which("python3") or shutil.which("python"),
                        str(ROOT / "review_openpyxl.py"), str(out)],
                       input=payload, check=True)
    else:
        subprocess.run([str(node) if node.exists() else shutil.which("node"), str(ROOT / "review.mjs"), str(out)],
                       input=payload, check=True)
    print(out, len(targets), len(obs))


if __name__ == "__main__":
    main()
