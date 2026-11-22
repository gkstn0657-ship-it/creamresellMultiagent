"""Local, one-user briefing recommendations and the saved heart collection."""

import hashlib
import json
import math
import re
import sqlite3
import time
import unicodedata
from collections import Counter
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


KINDS = {"quote", "line", "topic"}
KST = timezone(timedelta(hours=9))
GENERIC_WORDS = {
    "ai", "the", "for", "from", "with", "and", "are", "new", "our", "how", "using",
    "openai", "google", "인공지능", "구글", "오픈ai", "오픈에이아이", "통해", "대한", "최근",
    "위한", "위해", "함께", "공개", "출시", "새로운", "소개합니다", "있을까요", "소식", "업데이트",
}
KOREAN_ENDING = re.compile(r"(?<=[가-힣])(?:으로부터|에서는|에서도|으로|에서|에게|에는|에도|보다|까지|부터|와|과|은|는|이|가|을|를|에|의|로|도)$")


def normal(text):
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def item_id(kind, item):
    if kind == "topic":
        url = urlsplit(item["url"])
        query = [(k, v) for k, v in parse_qsl(url.query, keep_blank_values=True)
                 if not k.lower().startswith("utm_") and k.lower() not in {"gclid", "fbclid"}]
        identity = urlunsplit((url.scheme.lower(), url.netloc.lower(), url.path, urlencode(query), ""))
    else:
        identity = normal(item["text"])
        if kind == "quote":
            identity += "\n" + normal(item["author"])
    return kind + "-" + hashlib.sha256(identity.encode()).hexdigest()[:32]


def features(kind, item):
    result = {"tag:" + normal(tag) for tag in item.get("tags", ()) if tag.strip()}
    if kind == "quote" and item.get("author"):
        result.add("author:" + normal(item["author"].split("·")[0]))
    if kind == "topic" or not result:
        for word in re.findall(r"[a-z][a-z0-9]*|[가-힣]+", normal(item.get("title") or item.get("text", ""))):
            stem = KOREAN_ENDING.sub("", word)
            if len(stem) >= 2:
                word = stem
            if len(word) >= 2 and word not in GENERIC_WORDS:
                result.add("word:" + word)
    return result


def decorated(item, kind, key, liked_at):
    return {**item, "kind": kind, "id": key, "liked": liked_at is not None, "likedAt": liked_at}


class BriefingPreferences:
    def __init__(self, directory, clock=time.time):
        self.path = Path(directory) / "briefing-preferences.sqlite3"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        with self._open() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS items (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
                    last_seen INTEGER NOT NULL, liked_at REAL
                );
                CREATE INDEX IF NOT EXISTS saved_by_kind ON items(kind, liked_at)
                    WHERE liked_at IS NOT NULL;
                CREATE TABLE IF NOT EXISTS daily (
                    kind TEXT NOT NULL, day INTEGER NOT NULL, item_id TEXT NOT NULL,
                    PRIMARY KEY(kind, day)
                );
                CREATE TABLE IF NOT EXISTS shelves (
                    kind TEXT PRIMARY KEY, day INTEGER NOT NULL, item_ids TEXT NOT NULL
                );
            """)

    @contextmanager
    def _open(self):
        with closing(sqlite3.connect(self.path, timeout=10)) as db, db:
            db.row_factory = sqlite3.Row
            yield db

    def _day(self):
        return datetime.fromtimestamp(self.clock(), KST).date().toordinal()

    def select(self, kind, candidates, limit=None):
        """Return a ranked selection, or a stable, fully scrollable shelf if no limit is given."""
        if kind not in KINDS or (limit is not None and (type(limit) is not int or limit < 0)):
            raise ValueError("Invalid briefing selection")
        options = {}
        for item in candidates:
            options.setdefault(item_id(kind, item), item)
        if not options or limit == 0:
            return []
        day = self._day()
        with self._open() as db:
            db.execute("BEGIN IMMEDIATE")
            history = {}
            daily = kind in ("line", "quote") and limit in (None, 1)
            if daily:
                history = dict(db.execute("SELECT day, item_id FROM daily WHERE kind=? AND day>=?",
                                          (kind, day - 2)))
            selected = []
            if limit is None:
                shelf = db.execute("SELECT item_ids FROM shelves WHERE kind=? AND day=?", (kind, day)).fetchone()
                if shelf:
                    old_order = json.loads(shelf["item_ids"])
                    if set(old_order) == options.keys():
                        selected = old_order
            pinned = history.get(day)
            if not selected:
                if limit == 1 and pinned in options:
                    selected = [pinned]
                else:
                    saved = {r["id"]: r for r in db.execute(
                        "SELECT id,payload FROM items WHERE kind=? AND liked_at IS NOT NULL", (kind,))}
                    selected = self._rank(kind, options, saved, set(history.values()), limit)
                    if pinned in selected:
                        selected.remove(pinned)
                        selected.insert(0, pinned)
                if daily and selected[0] != pinned:
                    db.execute("INSERT OR REPLACE INTO daily(kind,day,item_id) VALUES(?,?,?)",
                               (kind, day, selected[0]))
                if limit is None:
                    db.execute("INSERT OR REPLACE INTO shelves(kind,day,item_ids) VALUES(?,?,?)",
                               (kind, day, json.dumps(selected)))
            # A normal poll only reads the current items' heart states. Preserve the
            # archived snapshot of a liked item even if its upstream title changes.
            markers = ",".join("?" for _ in selected)
            stored = {r["id"]: r for r in db.execute(
                f"SELECT id,liked_at,payload,last_seen FROM items WHERE id IN ({markers})", selected)}
            changes = []
            for key in selected:
                row = stored.get(key)
                payload = json.dumps(options[key], separators=(",", ":"), ensure_ascii=False)
                if row is None or row["last_seen"] != day or (row["liked_at"] is None and row["payload"] != payload):
                    changes.append((key, kind, payload, day))
            if changes:
                db.executemany("""
                    INSERT INTO items(id,kind,payload,last_seen) VALUES(?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,
                        payload=CASE WHEN items.liked_at IS NULL THEN excluded.payload ELSE items.payload END
                """, changes)
                db.execute("DELETE FROM daily WHERE day<?", (day - 30,))
                db.execute("DELETE FROM items WHERE liked_at IS NULL AND last_seen<?", (day - 45,))
            return [decorated(options[key], kind, key, stored[key]["liked_at"] if key in stored else None)
                    for key in selected]

    @staticmethod
    def _rank(kind, options, saved, recent, limit):
        profile = Counter()
        for row in saved.values():
            profile.update(features(kind, json.loads(row["payload"])))
        if not profile and not recent:
            return list(options)[:limit]

        def priority(key):
            signals = features(kind, options[key])
            score = 0.0
            for feature in signals:
                weight = {"tag": 4, "author": 0.5, "word": 1}[feature.partition(":")[0]]
                score += weight * math.log1p(profile[feature])
            # Stable sort leaves equally relevant candidates in source/date rotation order.
            return (key not in saved, key not in recent, score)

        return sorted(options, key=priority, reverse=True)[:limit]

    def set_liked(self, key, liked):
        if not isinstance(key, str) or not re.fullmatch(r"(?:quote|line|topic)-[0-9a-f]{32}", key):
            raise ValueError("올바르지 않은 브리핑 항목입니다.")
        if type(liked) is not bool:
            raise ValueError("하트 상태를 확인해 주세요.")
        with self._open() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT kind,payload,liked_at FROM items WHERE id=?", (key,)).fetchone()
            if row is None:
                raise KeyError(key)
            stamp = row["liked_at"]
            if liked != (stamp is not None):
                stamp = self.clock() if liked else None
                db.execute("UPDATE items SET liked_at=?, last_seen=? WHERE id=?", (stamp, self._day(), key))
            return decorated(json.loads(row["payload"]), row["kind"], key, stamp)

    def saved_count(self):
        with self._open() as db:
            return db.execute("SELECT count(*) FROM items WHERE liked_at IS NOT NULL").fetchone()[0]

    def interests(self, limit=5):
        counts = Counter()
        with self._open() as db:
            for row in db.execute("SELECT payload FROM items WHERE liked_at IS NOT NULL"):
                tags = json.loads(row["payload"]).get("tags", ())
                counts.update({tag.strip() for tag in tags if tag.strip()})
        labels = sorted(counts, key=lambda tag: (-counts[tag], tag))
        return [{"label": tag, "count": counts[tag]} for tag in labels[:limit]]

    def saved(self):
        with self._open() as db:
            return [decorated(json.loads(r["payload"]), r["kind"], r["id"], r["liked_at"])
                    for r in db.execute("SELECT * FROM items WHERE liked_at IS NOT NULL ORDER BY liked_at DESC, id")]
