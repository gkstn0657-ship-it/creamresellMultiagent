import asyncio
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from agents import Team, changed_evidence, instructions, invoke
from board import Board
import cli_usage


class BudgetTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.board = Board(temp.name)
        self.addCleanup(self.board.db.close)
        self.card = self.board.add("원래 사용자 지시")
        self.job = self.board.claim("worker")

    def test_log_view_preserves_originals_and_exceptions(self):
        b = self.board
        b.note(self.card, "중지 요청 원문")
        b.progress(self.job, "오래된 CLI 신호")
        b._post(self.card, "reviewer", "revise", "옵션 근거 보완")
        b._post(self.card, "worker", "소싱 현황", "예전 진행")
        b._post(self.card, "worker", "소싱 현황", "최신 진행")
        entries = b.history(self.card)
        prompt = instructions(dict(self.job, entries=entries, history_file="private/history.jsonl"))
        for text in ("원래 사용자 지시", "중지 요청 원문", "옵션 근거 보완", "최신 진행", "private/history.jsonl"):
            self.assertIn(text, prompt)
        for text in ("오래된 CLI 신호", "예전 진행"):
            self.assertNotIn(text, prompt)
            self.assertTrue(any(row["body"] == text for row in b.history(self.card)))

    def test_real_entry_point_with_mock_cli_usage_and_snapshot(self):
        self.board.progress(self.job, "상세 원본 전용")
        self.job["entries"] = self.board.history(self.card)
        job = {**self.job, "_usage_db": self.board.db}
        workspace = self.board.workspace(self.card)
        cli_input = Mock()
        cli_input.drain = AsyncMock()
        captured = {}

        async def fake_process(*args, **kwargs):
            Path(args[args.index("--output-last-message")+1]).write_text(
                json.dumps({"action": "submit", "message": "완료"}), encoding="utf-8")
            events = [{"type": "turn.started"}, {"type": "turn.completed", "usage":
                      {"input_tokens": 60, "output_tokens": 7, "cached_input_tokens": 42}}]
            stdout = asyncio.StreamReader()
            stdout.feed_data("\n".join(map(json.dumps, events)).encode())
            stdout.feed_eof()
            def capture(data):
                shared = json.loads(data.decode().rsplit("\n", 1)[1])
                file = workspace / next(v for k, v in shared.items() if k.startswith("전체 원문"))
                captured.update(path=file, content=file.read_text(encoding="utf-8"))
            cli_input.write.side_effect = capture
            return Mock(stdin=cli_input, stdout=stdout, returncode=0, wait=AsyncMock())

        with patch("agents.shutil.which", return_value="unused"), patch("agents.asyncio.create_subprocess_exec", fake_process):
            self.assertEqual(asyncio.run(invoke(job, workspace, lambda _: None)), ("submit", "완료"))
        self.assertIn("상세 원본 전용", captured["content"])
        self.assertFalse(captured["path"].exists())
        data = cli_usage.summary(self.board.db)["roles"]["worker"]
        self.assertEqual((data["calls"], data["measuredCalls"], data["inputTokens"], data["cachedInputTokens"],
                          data["outputTokens"], data["reasoningTokens"]), (1, 1, 60, 42, 7, None))

    def test_duplicate_events_partial_retry_and_unknown_legacy_usage(self):
        db = self.board.db
        invocation = cli_usage.start(db, self.job)
        for _ in range(2):
            cli_usage.record(db, invocation, "1", {"input_tokens": 50, "output_tokens": 8})
        cli_usage.record(db, invocation, "1", {"input_tokens_details": {"cached_tokens": 0}})
        cli_usage.record(db, invocation, "2", {})
        cli_usage.finish(db, invocation, "failed")
        retry = cli_usage.start(db, self.job)
        self.board.recover()
        self.assertEqual(db.execute("SELECT status FROM cli_invocations WHERE id=?", (retry,)).fetchone()[0], "interrupted")
        d = cli_usage.summary(db)["roles"]["worker"]
        self.assertEqual((d["calls"], d["measuredCalls"], d["turns"], d["measuredTurns"], d["inputTokens"]), (2, 1, 2, 1, 50))
        self.assertEqual(d["measuredFields"], {"inputTokens": 1, "cachedInputTokens": 1, "outputTokens": 1, "reasoningTokens": 0})
        with closing(sqlite3.connect(":memory:")) as legacy:
            self.assertIsNone(cli_usage.summary(legacy)["roles"]["auditor"]["outputTokens"])

    def test_only_same_role_unchanged_complete_utf8_previews_are_elided(self):
        f = {"sha256": "digest", "path": "proof.txt", "whole_file": True, "utf8_text": "근거"}
        db = self.board.db
        evidence, saved = changed_evidence(db, self.card, "reviewer", {"files": [f]})
        db.executemany("INSERT INTO cli_evidence_sent VALUES(?,?,?,?)", saved)
        self.assertEqual(changed_evidence(db, self.card, "auditor", evidence)[0], evidence)
        self.assertNotIn("utf8_text", changed_evidence(db, self.card, "reviewer", evidence)[0]["files"][0])
        for changed in (dict(f, sha256="other"), dict(f, whole_file=False)):
            self.assertIn("utf8_text", changed_evidence(db, self.card, "reviewer", {"files": [changed]})[0]["files"][0])

    def test_contract_review_and_submit_together_uses_original_routing(self):
        calls = []
        async def execute(job, folder, progress):
            calls.append(job["stage"])
            if job["stage"] == "contractor":
                return "deliver", "합계 5"
            if not job["contracts"]:
                return "contract", {"brief": "합산", "checks": "원본 대조", "inputs": []}
            return "contract_accept_submit", {"review": "원본 2+3 대조", "report": "합계 5"}
        self.board.workspace(self.card).mkdir(parents=True)
        result = asyncio.run(Team(self.board, execute).run_turn(self.job, lambda _: None))
        self.assertEqual(self.board.contracts(self.card)[0]["state"], "pending")
        self.board.note(self.card, "새 지시")
        self.assertTrue(self.board.finish(self.job, *result))
        self.assertEqual(calls, ["worker", "contractor", "worker"])
        self.assertEqual(self.board.contracts(self.card)[0]["review"], "원본 2+3 대조")
        self.assertEqual(self.board.cards()[0]["state"], "ready")
        self.assertIn("draft", [r["kind"] for r in self.board.history(self.card)])
