import tempfile
import threading
import unittest
from unittest.mock import patch

import literature_feed as feed


TSV = """line_id\tpoem_id\ttext\ttitle\tpoet\tannotator_01
2\t1\t당신은 행인(行人)\t나룻배와 행인\t한용운\t주석
1\t1\t나는 나룻배\t나룻배와 행인\t한용운\t주석
3\t1\t당신은 흙발로 나를 짓밟습니다\t나룻배와 행인\t한용운\t주석
4\t2\t다른 글\t알 수 없는 제목\t한용운\t주석
5\t3\t비가 온다\t왕십리\t김소월\t주석
6\t4\t오누나\t왕십리\t김소월\t주석
7\t4\t올지라도 한 닷새 왔으면 좋지.\t왕십리\t김소월\t주석
"""


class LiteratureFeedTests(unittest.TestCase):
    def test_only_verified_words_from_one_work_in_line_order(self):
        poems = feed.parse_poems(TSV)
        self.assertEqual(list(poems), [("한용운", "나룻배와 행인")])
        item = next(iter(poems.values()))
        self.assertEqual(item["text"], "나는 나룻배\n당신은 행인(行人)")
        self.assertIsNone(feed.validated_item("한용운", "나룻배와 행인", ["나는 나룻배", "[주석]"]))
        with self.assertRaises(ValueError):
            feed.parse_poems("bad header\n")

    def test_same_work_or_equivalent_text_does_not_repeat(self):
        poems = feed.parse_poems(TSV)
        for existing in ({"title": "나룻배와행인", "author": "한용운", "text": "다른 연"},
                         {"title": "다른 제목", "author": "다른 작가", "text": "나는 나룻배 당신은 행인(行人)"}):
            self.assertEqual(feed.merged_readings([existing], poems), [existing])

    def test_background_refresh_single_flight_and_last_good_cache(self):
        entered, release = threading.Event(), threading.Event()
        threads = []
        def fetch():
            threads.append(threading.current_thread())
            entered.set()
            release.wait(3)
            return feed.parse_poems(TSV)

        with tempfile.TemporaryDirectory() as directory, patch.object(feed, "fetch_poems", side_effect=fetch) as network:
            reader = feed.LiteratureFeed(directory)
            bundled = [{"title": "기존", "author": "기존 작가", "text": "기존 본문"}]
            self.assertEqual(reader.readings(bundled), bundled)
            self.assertTrue(entered.wait(2))
            self.assertEqual(reader.readings(bundled), bundled)
            release.set()
            threads[0].join(3)
            self.assertFalse(threads[0].is_alive())
            self.assertEqual(network.call_count, 1)
            restored = feed.LiteratureFeed(directory)
            cached = restored.readings(bundled)
            self.assertEqual(len(cached), 2)
            with patch.object(feed, "fetch_poems", side_effect=OSError("offline")):
                restored._refresh()
            self.assertEqual(restored.readings(bundled), cached)
            self.assertEqual(feed.LiteratureFeed(directory).readings(bundled), cached)
            self.assertEqual(network.call_count, 1)


if __name__ == "__main__":
    unittest.main()
