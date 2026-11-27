import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from token_report import naver_records, product_records, summarize


def save(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value), encoding="utf-8")


class UsageReportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def test_attempt_and_legacy_mirror_are_not_added_twice(self):
        import hashlib

        key = "legacy-" + hashlib.sha256(b'["r",0]').hexdigest()
        usage = {"input_tokens": 50, "cached_input_tokens": 30, "output_tokens": 0}
        save(self.root / "agents-team-ai.json", {"runId": "r", "calls": 2,
             "usage": [{"role": "audit", **usage}]})
        for attempt, measured in [(key, usage), ("interrupted", None)]:
            save(self.root / "agent-token-usage" / (attempt + ".json"),
                 {"role": "audit", "attemptId": attempt, "usage": measured})
        roles = summarize(naver_records(self.root))
        self.assertEqual(roles["unknown"]["calls"], 1)
        self.assertIsNone(roles["unknown"]["inputTokens"])
        audit = roles["audit"]
        self.assertEqual((audit["calls"], audit["measuredCalls"]), (2, 1))
        self.assertEqual((audit["inputTokens"], audit["cachedInputTokens"], audit["outputTokens"]), (50, 30, 0))
        self.assertIsNone(audit["reasoningTokens"])

    def test_old_thread_uses_last_actual_usage_and_native_record_has_priority(self):
        order = self.root / "work-orders" / "work.json"
        state = self.root / "batch-x/judgments/55/team-state.json"
        save(order, {"entries": [{"runId": "batch-x"}, {"runId": "batch-x"}]})
        rollout = self.root / "rollout.jsonl"
        rollout.write_text("\n".join(json.dumps({"type": "event_msg", "payload": {
            "type": "token_count", "info": {"total_token_usage": {"input_tokens": n, "output_tokens": 4}}}})
            for n in [500, 950]), encoding="utf-8")
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE threads(id,rollout_path)")
        db.execute("INSERT INTO threads VALUES(?,?)", ("id", str(rollout)))
        actors = [{"role": "owner", "threadId": "id"}, {"role": "reviewer", "threadId": "no-data"}]
        save(state, {"actors": actors})
        result = summarize(product_records(order, db))
        self.assertEqual((result["owner"]["inputTokens"], result["owner"]["calls"]), (950, 1))
        self.assertIsNone(result["reviewer"]["inputTokens"])
        actors[0]["tokenUsage"] = {"inputTokens": 1000, "outputTokens": 5, "reasoningOutputTokens": 2}
        save(state, {"actors": actors})
        owner = summarize(product_records(order, db))["owner"]
        self.assertEqual((owner["inputTokens"], owner["outputTokens"], owner["reasoningTokens"]), (1000, 5, 2))
