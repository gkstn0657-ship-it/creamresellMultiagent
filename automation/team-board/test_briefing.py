import io
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from email.utils import formatdate
from unittest.mock import patch

from briefing import BriefingFeed, RECENT, SOURCES, read_source, select_topics
from daily_reading import reading_candidates


class BriefingTests(unittest.TestCase):
    def test_readings_rotate_independently_at_seoul_midnight(self):
        start = datetime(2026, 11, 22, 14, 59, tzinfo=timezone.utc)
        quotes, lines = reading_candidates(start)
        self.assertEqual(quotes[0]["text"], "피는 꽃은\n저만치 혼자서 피어 있네")
        self.assertEqual({item["genre"] for item in quotes}, {"시", "산문"})
        self.assertEqual(len({item["title"] for item in quotes}), len(quotes))
        self.assertTrue(all(item["kind"] == "quote" and item["author"] and item["sourceUrl"] for item in quotes))
        self.assertEqual(lines[0]["text"], "오래된 노트를 펼쳤다가 오늘 풀 문제의 실마리를 만났다.")
        later_quotes, later_lines = reading_candidates(start + timedelta(minutes=1))
        self.assertEqual(later_quotes[0], quotes[1])
        self.assertNotEqual(later_lines[0], lines[0])
        self.assertNotEqual(later_lines[0], lines[1])
        self.assertTrue(all(item["tags"] for item in quotes + lines))

    def test_preference_pool_preserves_default_and_enriches_older_cached_topics(self):
        now = time.time()
        def topic(title, age, source="OpenAI"):
            return {"title": title, "url": SOURCES[source].rsplit("/", 1)[0] + "/" + title,
                    "publishedAt": now - age, "source": source}
        older = topic("의료연구", 5)
        items = [topic("오늘", 1), topic("어제", 2), older, topic("교육", 9, "Google 코리아"),
                 older, topic("보안", RECENT + 1)]
        pool = select_topics(items, now, all_candidates=True)
        self.assertEqual([x["url"] for x in pool[:3]], [x["url"] for x in select_topics(items, now)])
        self.assertEqual(len(pool), 4)
        self.assertEqual(pool[-1]["kind"], "topic")
        self.assertEqual(set(pool[-1]["tags"]), {"연구", "의료"})

    def test_only_dated_ai_articles_from_the_publisher(self):
        now = time.time()
        source = "Google 코리아"
        def item(title, path, stamp, category="", origin="https://blog.google"):
            return (f"<item><title>{title}</title><link>{origin}/{path}</link>"
                    f"<pubDate>{formatdate(stamp, usegmt=True)}</pubDate><category>{category}</category></item>")
        body = "".join([item("New model", "model", now - 400, "Gemini models"),
                        item("Gemini from another site", "spoof", now - 500, origin="https://example.org"),
                        item("AI teaser", "future", now + 3600), item("AI archive", "old", now - RECENT - 3600),
                        item("Company opening", "other", now - 300)])
        response = io.BytesIO(("<rss><channel>" + body + "</channel></rss>").encode())
        response.geturl = lambda: SOURCES[source]
        with patch("briefing.urlopen", return_value=response):
            self.assertEqual([t["title"] for t in read_source(source, now)], ["New model"])

    def test_cache_survives_restart_and_offline_with_recent_dates_only(self):
        now = time.time()
        def article(source, age, slug):
            return {"title": slug, "source": source, "url": SOURCES[source].rsplit("/", 1)[0] + "/" + slug,
                    "publishedAt": now - age}
        first, second = SOURCES
        results = {first: [article(first, 100 + i, str(i)) for i in range(5)],
                   second: [article(second, 200, "paper")]}
        with tempfile.TemporaryDirectory() as tmp:
            feed = BriefingFeed(tmp)
            with patch("briefing.read_source", side_effect=lambda s, _: results[s]):
                feed._refresh()
            current = feed.snapshot()
            self.assertEqual(current["status"], "live")
            self.assertEqual([t["source"] for t in current["topics"]], [first, first, second])
            again = BriefingFeed(tmp)
            with patch("briefing.read_source", side_effect=OSError("offline")):
                again._refresh()
            self.assertEqual(again.snapshot()["status"], "cached")
            self.assertEqual(again.snapshot()["topics"], current["topics"])
            self.assertEqual(select_topics(again.items, now + RECENT + 1), [])

    def test_snapshot_does_not_wait_or_start_duplicate_refresh(self):
        waiting, release = threading.Event(), threading.Event()
        def slow(source, _):
            waiting.set()
            release.wait(2)
            return []
        with tempfile.TemporaryDirectory() as tmp, patch("briefing.read_source", side_effect=slow) as fetch:
            feed = BriefingFeed(tmp)
            self.assertEqual(feed.snapshot()["status"], "loading")
            self.assertTrue(waiting.wait(1))
            self.assertEqual(feed.snapshot()["status"], "loading")
            self.assertEqual(fetch.call_count, 1)
            release.set()
            deadline = time.monotonic() + 2
            while feed.refreshing and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(feed.snapshot()["status"], "empty")
            self.assertEqual(fetch.call_count, len(SOURCES))


if __name__ == "__main__":
    unittest.main()
