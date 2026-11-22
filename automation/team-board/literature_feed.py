"""Public-domain Korean verse from the Academy of Korean Studies' KPoEM corpus."""

import csv
import io
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from http.client import HTTPException
from itertools import zip_longest
from pathlib import Path
from tempfile import NamedTemporaryFile
import re
import threading
import time
from urllib.request import Request, urlopen


SOURCE = "https://huggingface.co/datasets/AKS-DHLAB/KPoEM"
DATA_URL = SOURCE + "/resolve/main/KPoEM_line_dataset_v4.tsv"
MAX_BYTES = 4 * 1024 * 1024
REFRESH = 86400
RETRY = 900
KST = timezone(timedelta(hours=9))

# The chosen line counts end at a phrase or sentence boundary in these poems.
WORKS = {
    ("김소월", "왕십리"): (3, ("비", "그리움")),
    ("한용운", "나룻배와 행인"): (2, ("사랑", "기다림")),
    ("김소월", "나의 집"): (3, ("자연", "꿈")),
    ("한용운", "꽃이 먼저 알아"): (2, ("봄", "그리움")),
    ("김소월", "초혼"): (3, ("이별", "그리움")),
    ("한용운", "사랑하는 까닭"): (2, ("사랑", "시간")),
    ("김소월", "바람과 봄"): (3, ("봄", "자연")),
    ("김소월", "고향"): (2, ("고향", "그리움")),
}


def validated_item(author, title, lines):
    if not isinstance(author, str) or not isinstance(title, str):
        return None
    spec = WORKS.get((author, title))
    if not spec or not isinstance(lines, list) or len(lines) != spec[0]:
        return None
    for line in lines:
        if (not isinstance(line, str) or not 1 <= len(line.strip()) <= 100
                or not re.search("[가-힣]", line) or re.search(r"[<>\[\]{}\x00-\x1f]", line)):
            return None
    return {"kind": "quote", "genre": "시", "title": title, "author": author,
            "text": "\n".join(line.strip() for line in lines), "tags": list(spec[1]),
            "sourceUrl": SOURCE}


def parse_poems(tsv):
    rows = csv.DictReader(io.StringIO(tsv), delimiter="\t")
    if not {"poem_id", "line_id", "title", "poet", "text"}.issubset(rows.fieldnames or []):
        raise ValueError("KPoEM columns missing")
    poems = {}
    for row in rows:
        key = (row["poet"], row["title"])
        if key not in WORKS or not row["poem_id"] or not (row["line_id"] or "").isdigit():
            continue
        poem = poems.setdefault((*key, row["poem_id"]), {})
        poem[int(row["line_id"])] = row["text"]
    items = {}
    for (author, title, _), lines in poems.items():
        count = WORKS[(author, title)][0]
        item = validated_item(author, title, [lines[index] for index in sorted(lines)[:count]])
        if item:
            items.setdefault((author, title), item)
    return items


def fetch_poems():
    request = Request(DATA_URL, headers={"User-Agent": "AgentMissionControl/1.0 (Korean poetry reader)"})
    with urlopen(request, timeout=7) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("KPoEM data too large")
    return parse_poems(data.decode("utf-8-sig"))


def merged_readings(bundled, poems):
    def normalized(text):
        return "".join(text.split())

    def identity(item):
        return (normalized(item.get("author", "")), normalized(item.get("title", "")))

    seen_works = {identity(item) for item in bundled}
    seen_texts = {normalized(item["text"]) for item in bundled}
    extras = []
    for key in WORKS:
        item = poems.get(key)
        if item and identity(item) not in seen_works and normalized(item["text"]) not in seen_texts:
            extras.append(item)
            seen_texts.add(normalized(item["text"]))
    if not extras:
        return list(bundled)
    offset = datetime.now(KST).date().toordinal() % len(extras)
    extras = extras[offset:] + extras[:offset]
    return [item for pair in zip_longest(bundled, extras) for item in pair if item is not None]


class LiteratureFeed:
    def __init__(self, directory):
        self.path = Path(directory) / "literature-briefing.json"
        self.lock = threading.Lock()
        self.refreshing = False
        self.next_check = 0
        self.poems = {}
        try:
            cache = json.loads(self.path.read_text(encoding="utf-8"))
            for entry in cache["poems"]:
                if isinstance(entry, dict) and isinstance(entry.get("text"), str):
                    item = validated_item(entry.get("author"), entry.get("title"), entry["text"].split("\n"))
                    if item:
                        self.poems[(item["author"], item["title"])] = item
            updated = cache["updatedAt"]
            if self.poems and type(updated) in (int, float) and 0 < updated <= time.time():
                self.next_check = updated + REFRESH
        except (OSError, ValueError, TypeError, KeyError):
            pass

    def readings(self, bundled):
        """Immediately return local candidates and start one background refresh when due."""
        with self.lock:
            snapshot = self.poems
            if not self.refreshing and time.time() >= self.next_check:
                self.refreshing = True
                threading.Thread(target=self._refresh, name="literature-refresh", daemon=True).start()
        return merged_readings(bundled, snapshot)

    def _refresh(self):
        delay = RETRY
        temporary = None
        try:
            fresh = fetch_poems()
            if not fresh:
                return
            with self.lock:
                poems = {**self.poems, **fresh}
                self.poems = poems
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent, delete=False) as handle:
                temporary = Path(handle.name)
                json.dump({"updatedAt": time.time(), "poems": list(poems.values())}, handle, ensure_ascii=False)
            os.replace(temporary, self.path)
            temporary = None
            delay = REFRESH
        except (OSError, HTTPException, ValueError, csv.Error) as exc:
            logging.getLogger(__name__).info("KPoEM refresh unavailable: %s", exc)
        finally:
            with self.lock:
                self.next_check = time.time() + delay
                self.refreshing = False
            if temporary is not None:
                temporary.unlink(missing_ok=True)
