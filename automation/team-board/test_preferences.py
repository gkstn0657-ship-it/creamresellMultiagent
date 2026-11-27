import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from preferences import BriefingPreferences, KST, item_id


def topic(slug, title, *tags):
    return {"title": title, "source": "테스트", "url": "https://example.com/" + slug,
            "publishedAt": 1_788_000_000, "tags": list(tags)}


class PreferenceTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.now = datetime(2026, 11, 22, 23, 59, tzinfo=KST).timestamp()
        self.prefs = BriefingPreferences(self.folder.name, lambda: self.now)

    def heart(self, selected):
        return self.prefs.set_liked(selected["id"], True)

    def test_saved_snapshot_survives_rotation_restart_and_retention(self):
        article = topic("research", "연구 소식", "연구", "연구")
        displayed, = self.prefs.select("topic", [article], 1)
        first = self.heart(displayed)
        self.now += 86400 * 800
        revised = {**article, "title": "뒤늦게 바뀐 제목",
                   "url": article["url"] + "?utm_source=mail#news"}
        self.prefs.select("topic", [revised], 1)
        self.prefs = BriefingPreferences(self.folder.name, lambda: self.now)
        self.assertEqual(self.prefs.saved(), [first])
        self.assertEqual(self.prefs.saved_count(), 1)
        self.assertEqual(self.prefs.interests(), [{"label": "연구", "count": 1}])
        self.prefs.select("line", [{"text": "새 글귀"}], 1)
        self.assertEqual(self.heart(displayed)["likedAt"], first["likedAt"])
        self.assertEqual(self.prefs.set_liked(first["id"], False)["likedAt"], None)
        self.assertFalse(self.prefs.set_liked(first["id"], False)["liked"])
        self.assertEqual(self.prefs.saved_count(), 0)
        self.assertEqual(self.prefs.interests(), [])

    def test_ranks_new_topic_using_saved_content_and_removes_signal_on_unlike(self):
        liked = topic("a", "Robotics in factories", "로봇")
        unrelated = topic("b", "시장 동향", "시장")
        matching = topic("c", "A closer look at robotics", "로봇")
        card, = self.prefs.select("topic", [liked, unrelated, matching], 1)
        with self.assertRaises(KeyError):
            self.prefs.set_liked(item_id("topic", matching), True)
        self.heart(card)
        selected, = self.prefs.select("topic", [unrelated, matching, liked], 1)
        self.assertEqual(selected["title"], matching["title"])
        self.prefs.set_liked(card["id"], False)
        selected, = self.prefs.select("topic", [unrelated, matching, liked], 1)
        self.assertEqual(selected["title"], unrelated["title"])

    def test_keeps_todays_reading_and_personalizes_next_seoul_day(self):
        a = {"text": "A", "author": "가", "sourceUrl": "https://example.com/a", "tags": ["배움"]}
        b = {"text": "B", "author": "나", "tags": ["용기"]}
        c = {"text": "C", "author": "다", "tags": ["배움"]}
        today = self.heart(self.prefs.select("quote", [a, b, c], 1)[0])
        self.assertEqual(self.prefs.select("quote", [b, c, a], 1), [today])
        self.now += 120  # Cross midnight in Seoul, while UTC still shows the previous date.
        tomorrow, = self.prefs.select("quote", [b, a, c], 1)
        self.assertEqual(tomorrow["text"], "C")
        line, = self.prefs.select("line", [b, c], 1)
        self.assertEqual(line["text"], "B")
        self.assertEqual(self.prefs.saved()[0]["sourceUrl"], a["sourceUrl"])

    def test_full_quote_shelf_keeps_migrated_daily_lead_and_hearts_below_the_fold(self):
        quotes = [{"text": str(i), "author": "작가", "tags": [tag]} for i, tag in enumerate(
            ["기록", "사고", "시작", "기록", "협력", "협력"])]
        lead = self.prefs.select("quote", quotes, 1)[0]
        # An already-chosen daily quote survives the single-item to shelf transition.
        shelf = self.prefs.select("quote", quotes[1:] + [quotes[0], quotes[-1]])
        self.assertEqual(shelf[0]["id"], lead["id"])
        original = [q["id"] for q in shelf]
        self.assertEqual(len(set(original)), len(quotes))
        saved = self.heart(shelf[-1])
        self.prefs = BriefingPreferences(self.folder.name, lambda: self.now)
        same_day = self.prefs.select("quote", quotes[::-1])
        self.assertEqual([q["id"] for q in same_day], original)
        self.assertTrue(same_day[-1]["liked"])
        self.now += 120
        next_day = self.prefs.select("quote", quotes)
        self.assertEqual(next_day[0]["text"], "4")
        self.assertEqual(self.prefs.saved()[0]["id"], saved["id"])

    def test_full_news_shelf_is_stable_until_membership_changes(self):
        articles = [topic(str(i), f"Story {i}", tag) for i, tag in enumerate(
            ["연구", "업무", "창작", "개발", "의료"])]
        shelf = self.prefs.select("topic", articles + [dict(articles[0], url=articles[0]["url"] + "?utm_source=test")])
        self.assertEqual([t["title"] for t in shelf], [t["title"] for t in articles])
        self.heart(shelf[3])
        same = self.prefs.select("topic", articles[::-1])
        self.assertEqual([t["id"] for t in same], [t["id"] for t in shelf])
        self.assertTrue(same[3]["liked"])
        new_article = topic("new", "New development", "개발")
        updated = self.prefs.select("topic", articles[1:] + [new_article])
        self.assertEqual(updated[0]["url"], new_article["url"])
        self.assertNotIn(shelf[0]["id"], {t["id"] for t in updated})
        self.assertEqual(self.prefs.saved_count(), 1)

    def test_concurrent_duplicate_hearts_and_malformed_requests(self):
        article = self.prefs.select("line", [{"text": "기록", "tags": ["기록"]}], 1)[0]
        def heart_from_other_connection(_):
            return self.heart(article)
        with ThreadPoolExecutor(max_workers=6) as threads:
            result = list(threads.map(heart_from_other_connection, range(12)))
        self.assertEqual({item["likedAt"] for item in result}, {self.now})
        self.assertEqual(self.prefs.saved_count(), 1)
        with self.assertRaises(ValueError):
            self.prefs.set_liked("../other", True)
        with self.assertRaises(ValueError):
            self.prefs.set_liked(article["id"], "false")


if __name__ == "__main__":
    unittest.main()
