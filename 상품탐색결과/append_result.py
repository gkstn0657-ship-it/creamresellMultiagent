"""Append one verified entry to a Korean-local-date Markdown research report."""
import argparse
import hashlib
import json
import msvcrt
import os
import re
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit


def required_text(value, name, *, single_line=False):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} 항목에 내용을 입력하세요.")
    value = value.strip()
    if "<!--" in value or (single_line and len(value.splitlines()) != 1):
        raise ValueError(f"{name} 형식을 확인하세요.")
    return value


def entry_text(entry):
    key = required_text(entry["id"], "id", single_line=True)
    title = required_text(entry["title"], "title", single_line=True)
    status = required_text(entry["status"], "status", single_line=True)
    details = required_text(entry["details"], "details")
    sources = entry["sources"]
    if not isinstance(sources, list) or not sources:
        raise ValueError("sources에 출처를 하나 이상 입력하세요.")
    links = []
    for item in sources:
        label = required_text(item["label"], "label", single_line=True)
        url = required_text(item["url"], "url", single_line=True)
        parts = urlsplit(url)
        if parts.scheme not in {"https", "http"} or not parts.hostname or any(c in url for c in "<> \t"):
            raise ValueError("출처에 유효한 웹 주소를 입력하세요.")
        label = re.sub(r"([\\\[\]])", r"\\\1", label)
        links.append(f"- [{label}](<{url}>)")
    body = f"## {title}\n\n**{status}**\n\n{details}\n\n" + "\n".join(links)
    prefix = "<!-- research:" + hashlib.sha256(key.encode()).hexdigest() + ":"
    marker = prefix + hashlib.sha256(body.encode()).hexdigest() + " -->"
    return prefix, marker, body


def save(day, entry):
    root = Path(os.environ.get("CREAM_REPORTS_DIR") or Path(__file__).resolve().parent)
    folder = root / day.strftime("%Y-%m")
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{day.isoformat()}.md"
    with (root / ".append.lock").open("a+b") as lock:
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        try:
            previous = target.read_bytes() if target.exists() else b""
            current = previous.decode("utf-8-sig")
            if entry is None and previous:
                return target
            content = b"" if previous else f"# {day.year}년 {day.month}월 {day.day}일 상품 탐색 결과\n".encode()
            if entry is not None:
                prefix, marker, body = entry_text(entry)
                if marker in current:
                    return target
                if prefix in current:
                    raise ValueError("같은 기록 ID로 다른 내용이 이미 저장돼 있습니다.")
                content += f"\n\n{marker}\n{body}\n".encode()
            with tempfile.NamedTemporaryFile(dir=folder, suffix=".tmp", delete=False) as temp:
                temp_path = Path(temp.name)
                try:
                    temp.write(previous + content)
                    temp.flush()
                    os.fsync(temp.fileno())
                except BaseException:
                    temp.close()
                    temp_path.unlink(missing_ok=True)
                    raise
            try:
                os.replace(temp_path, target)
            finally:
                temp_path.unlink(missing_ok=True)
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", type=date.fromisoformat, default=datetime.now(timezone(timedelta(hours=9))).date())
    parser.add_argument("--entry", help="UTF-8 JSON 파일 경로. 표준 입력은 -")
    args = parser.parse_args()
    try:
        entry = None
        if args.entry is not None:
            text = sys.stdin.buffer.read() if args.entry == "-" else Path(args.entry).read_bytes()
            entry = json.loads(text.decode("utf-8-sig"))
            if not isinstance(entry, dict):
                raise ValueError("기록은 JSON 객체여야 합니다.")
        print(save(args.date, entry))
    except (ValueError, OSError, KeyError, TypeError) as exc:
        parser.exit(1, f"{exc}\n")
