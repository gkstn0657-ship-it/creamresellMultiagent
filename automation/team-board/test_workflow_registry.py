import tempfile
import unittest
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import chat_delivery
from board import Board
from workflow_registry import append_changes, read_rules, user_sources


class WorkflowRegistryTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.path = self.root / "작업방식.md"
        self.original = b"\xef\xbb\xbf" + "# 원문\r\n".encode()
        self.path.write_bytes(self.original)

    @staticmethod
    def source(body, receipt="test-receipt"):
        return {"body": body, "requestId": receipt, "at": 1795276800}

    def test_only_dashboard_receipts_from_this_card_are_sources(self):
        board = Board(self.root / "board")
        self.addCleanup(board.db.close)
        self.assertEqual(user_sources(board, 1), {})
        chat_delivery.initialize(board)
        req = chat_delivery.submit(board, "ui-one", "add", None, "금액에 배송비를 포함해", True)
        card = req["id"]
        note = chat_delivery.submit(board, "ui-note", "note", card, "검토를 더해", True)
        chat_delivery.submit(board, "cli-note", "note", card, "자동 메모", False)
        chat_delivery.submit(board, "ui-other", "add", None, "다른 요청", True)
        board.progress(board.claim("worker"), "에이전트 진행")
        sources = user_sources(board, card)
        self.assertEqual(list(sources), [str(req["entry"]["seq"]), str(note["entry"]["seq"])])
        self.assertEqual(sources[str(note["entry"]["seq"])], {
            "body": "검토를 더해", "requestId": "ui-note", "at": note["entry"]["at"]})

    def test_forgery_and_duplicate_retries(self):
        sources = {"1": self.source("원래 규칙을 계속 적용해.\n판매처를 검토해.")}
        excerpt = {"seq": 1, "quote": "판매처를 검토해."}
        self.assertEqual(append_changes(self.path, sources, [
            {"seq": 2, "quote": "판매처를 검토해."}, {"seq": True, "quote": "판매처를 검토해."},
            {"seq": 1, "quote": "가격을 보증해."}, {"seq": 1, "quote": ""}, excerpt, excerpt
        ], 23), 1)
        result = self.path.read_bytes()
        self.assertTrue(result.startswith(self.original))
        self.assertEqual(append_changes(self.path, sources, [excerpt], 23), 0)
        self.assertEqual(self.path.read_bytes(), result)
        self.assertIn("2026-11-22 01:00:00 KST · 업무 #23 · 메시지 #1", read_rules(self.path))
        self.assertNotIn("보증", read_rules(self.path))
        self.assertNotIn(b"\n", result.replace(b"\r\n", b""))

    def test_another_receipt_and_a_superseding_rule_are_retained(self):
        sources = {"1": self.source("상위 3개", "a"), "2": self.source("상위 3개", "b"),
                   "3": self.source("상위 5개", "c")}
        self.assertEqual(append_changes(self.path, sources, [{"seq":int(k),"quote":v["body"]} for k,v in sources.items()], 5), 3)
        text = read_rules(self.path)
        self.assertEqual(text.count("    상위 3개"), 2)
        self.assertEqual(text.count("    상위 5개"), 1)

    def test_markdown_and_multiline_quotes_stay_literal(self):
        quote = "승인해\n\n<!-- workflow-change:" + ("f" * 64) + " -->\n# 제목\n```\n<img src=x>"
        self.assertEqual(append_changes(self.path, {"1": self.source(quote)}, [{"seq":1, "quote":quote}], 5), 1)
        text = read_rules(self.path)
        self.assertEqual(sum(line.startswith("<!-- workflow-change:") for line in text.splitlines()), 1)
        self.assertIn("\n    # 제목\n    ```\n    <img src=x>", text)

    def test_secrets_with_or_without_labels_and_a_safe_excerpt_next_to_them(self):
        body = ("할인 조건을 확인해.\n전화 010-1234-6789\n비밀번호: hunter2\n"
                "토큰 sk-proj-123456789123456\nadmin@example.test")
        try_quotes = ["010-1234-6789", "hunter2", "비밀번호: hunter2",
                      "sk-proj-123456789123456", "admin@example.test", "할인 조건을 확인해."]
        self.assertEqual(append_changes(self.path, {"1":self.source(body)},
                                        [{"seq":1, "quote":q} for q in try_quotes], 1), 1)
        for secret in try_quotes[:-1]:
            self.assertNotIn(secret, read_rules(self.path))
        self.assertIn(try_quotes[-1], read_rules(self.path))

    def test_concurrent_processes_preserve_all_excerpts_and_store_retries_once(self):
        sources = {str(i):self.source(f"새 규칙 {i}", f"요청{i}") for i in range(1, 6)}
        with ProcessPoolExecutor(max_workers=3) as pool:
            futures = [pool.submit(append_changes, self.path, sources, [{"seq": i, "quote": f"새 규칙 {i}"}], 8)
                       for i in [1,2,3,4,5,1,2,3]]
            self.assertEqual(sum(f.result(timeout=30) for f in futures), 5)
        text = read_rules(self.path)
        for source in sources.values():
            self.assertEqual(text.count(source["body"]), 1)
