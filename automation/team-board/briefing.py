"""Read-only, cached Korean AI headlines for the desktop dashboard."""

import json
import logging
import math
import os
import re
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from html import unescape
from http.client import HTTPException
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


SOURCES = {
    "OpenAI": "https://openai.com/ko-KR/news/rss.xml",
    "Google 코리아": "https://blog.google/intl/ko-kr/rss/",
}
RECENT = 30 * 86400
REFRESH = 3600
RETRY = 300
MAX_BYTES = 3 * 1024 * 1024
GOOGLE_AI = re.compile(r"(?<![a-z])ai(?![a-z])|인공지능|제미나이|젬마|딥마인드|gemini|gemma|deepmind|notebooklm|머신러닝", re.I)

# Match both Korean titles and the English terms/slugs publishers use for the same subject.
TOPIC_PATTERNS = {
    "개발": r"코딩|개발자|소프트웨어|codex|coding|developers?|software|\bapi\b",
    "에이전트": r"에이전트|자동화|agents?|agentic|automation",
    "안전": r"안전|보안|적대|보호|취약|프라이버시|개인정보|safety|securit|adversarial|privacy|cyber",
    "연구": r"연구|과학|수학|논문|과학자|research|scientific|science|mathematics",
    "의료": r"의료|의학|신약|환자|보건|바이오|clinical|health|medicine|drug-discovery|biolog",
    "교육": r"교육|학습자|학생|교사|수업|education|students?|teaching|classroom",
    "창작": r"창작|생성형 영상|음악|이미지|디자인|크리에이터|creative|creators?|music|image|video|design|sora",
    "모델": r"모델|제미나이|젬마|model|gemini|gemma|gpt[-\s]?\d|reasoning|추론",
    "인프라": r"인프라|데이터센터|데이터 센터|반도체|컴퓨팅|infrastructure|data-center|compute|chips?|gpu|tpu",
    "업무": r"업무|기업|생산성|워크스페이스|워크플로|business|enterprise|workflow|workspace|productivity",
    "정책": r"정책|규제|정부|법안|policy|policies|regulat|government|legislat",
    "로봇": r"로봇|로보틱스|robot|robotics",
    "검색": r"검색|서치|search",
}
TOPIC_PATTERNS = {tag: re.compile(pattern, re.I) for tag, pattern in TOPIC_PATTERNS.items()}


def topic_tags(title, url, categories=""):
    description = f"{title} {urlsplit(url).path} {categories}"
    return [tag for tag, pattern in TOPIC_PATTERNS.items() if pattern.search(description)]


def article_url(value, source):
    try:
        parsed = urlsplit(value)
        return (parsed.scheme == "https" and parsed.netloc == urlsplit(SOURCES[source]).netloc
                and parsed.path.startswith("/") and not any(c.isspace() for c in value))
    except (ValueError, TypeError):
        return False


def recent(stamp, now):
    return type(stamp) in (int, float) and math.isfinite(stamp) and now - RECENT <= stamp <= now


def read_source(source, now):
    url = SOURCES[source]
    request = Request(url, headers={"User-Agent": "AgentMissionControl/1.0", "Accept": "application/rss+xml, application/xml"})
    with urlopen(request, timeout=5) as response:
        if not article_url(response.geturl(), source):
            raise ValueError("Unexpected feed origin")
        raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("Oversized feed")
    channel = ET.fromstring(raw).find("channel")
    if channel is None:
        raise ValueError("Invalid RSS feed")
    items = []
    for node in channel.findall("item"):
        title = " ".join(unescape(node.findtext("title") or "").split())
        link = (node.findtext("link") or "").strip()
        try:
            published = parsedate_to_datetime(node.findtext("pubDate") or "")
            if published.tzinfo is None:
                continue
            stamp = published.timestamp()
        except (OverflowError, OSError, ValueError, TypeError):
            continue
        if not title or not article_url(link, source) or not recent(stamp, now):
            continue
        categories = " ".join(cat.text or "" for cat in node.findall("category"))
        if source == "Google 코리아" and not GOOGLE_AI.search(title + " " + categories):
            continue
        items.append({"title": title, "url": link, "source": source, "publishedAt": stamp,
                      "tags": topic_tags(title, link, categories)})
    return sorted(items, key=lambda item: item["publishedAt"], reverse=True)[:36]


def select_topics(items, now, *, all_candidates=False):
    latest = sorted((t for t in items if recent(t["publishedAt"], now)),
                    key=lambda t: t["publishedAt"], reverse=True)
    # Each available publisher gets a slot even on a busy launch day elsewhere.
    by_source = {}
    for topic in latest:
        by_source.setdefault(topic["source"], topic)
    selection = {item["url"]: item for item in by_source.values()}
    for topic in latest:
        if len(selection) >= 3:
            break
        selection.setdefault(topic["url"], topic)
    featured = sorted(selection.values(), key=lambda t: t["publishedAt"], reverse=True)
    if not all_candidates:
        return featured
    # Keep the same first three for a user without preferences. Give the ranker the
    # rest of the dated pool (across publishers) so a heart can change the selection.
    seen = set(selection)
    for topic in latest:
        if topic["url"] not in seen:
            seen.add(topic["url"])
            featured.append(topic)
    return [{**topic, "kind": "topic",
             "tags": topic["tags"] if "tags" in topic else topic_tags(topic["title"], topic["url"])}
            for topic in featured]


class BriefingFeed:
    def __init__(self, directory):
        self.path = Path(directory) / "ai-briefing.json"
        self.lock = threading.Lock()
        self.refreshing = False
        self.updated = None
        self.items = []
        self.status = "loading"
        self.next_check = 0
        try:
            cached = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(cached, dict):
                return
            now = time.time()
            if not recent(cached.get("updatedAt"), now):
                return
            for topic in cached["topics"]:
                if (isinstance(topic, dict) and topic.get("source") in SOURCES
                        and isinstance(topic.get("title"), str) and topic["title"].strip()
                        and isinstance(topic.get("url"), str) and article_url(topic["url"], topic["source"])
                        and recent(topic.get("publishedAt"), now)):
                    tags = topic.get("tags")
                    if "tags" in topic and (not isinstance(tags, list) or
                                            not all(isinstance(t, str) and t in TOPIC_PATTERNS for t in tags)):
                        del topic["tags"]
                    self.items.append(topic)
            self.updated = cached["updatedAt"]
            self.next_check = self.updated + REFRESH
            self.status = "cached" if self.items else "empty"
        except (OSError, ValueError, TypeError, KeyError):
            pass

    def snapshot(self, *, all_candidates=False):
        now = time.time()
        with self.lock:
            if now >= self.next_check and not self.refreshing:
                self.refreshing = True
                threading.Thread(target=self._refresh, name="ai-briefing", daemon=True).start()
            topics = select_topics(self.items, now, all_candidates=all_candidates)
            status = self.status
            if not topics and status in ("live", "cached"):
                status = "loading" if self.refreshing else "empty"
            return {"status": status, "updatedAt": self.updated, "topics": topics}

    def _refresh(self):
        now = time.time()
        received = {}
        try:
            for source in SOURCES:
                try:
                    received[source] = read_source(source, now)
                except (OSError, ValueError, HTTPException, ET.ParseError) as exc:
                    logging.debug("Briefing source %s unavailable: %s", source, exc)
            with self.lock:
                complete = len(received) == len(SOURCES)
                self.next_check = now + (REFRESH if complete else RETRY)
                if received:
                    self.items = [t for t in self.items if t["source"] not in received and recent(t["publishedAt"], now)]
                    for topics in received.values():
                        self.items.extend(topics)
                    self.updated = now
                available = bool(select_topics(self.items, now))
                if available:
                    self.status = "live" if complete else "cached"
                else:
                    self.status = "empty" if complete else "unavailable"
                payload = {"updatedAt": self.updated, "topics": self.items}
            if received:
                self._save(payload)
        finally:
            with self.lock:
                self.refreshing = False
                self.next_check = max(self.next_check, now + RETRY)

    def _save(self, payload):
        temp = self.path.with_name(f".ai-briefing-{uuid.uuid4().hex}.tmp")
        try:
            with temp.open("x", encoding="utf-8") as file:
                json.dump(payload, file, ensure_ascii=False)
            os.replace(temp, self.path)
        except OSError as exc:
            logging.debug("Could not save AI briefing cache: %s", exc)
        finally:
            try:
                temp.unlink(missing_ok=True)
            except OSError:
                pass
