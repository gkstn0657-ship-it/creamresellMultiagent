import json
import os
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.request import ProxyHandler, build_opener

from board import Board
from dashboard import BoardServer
from external_activity import ExternalActivityFeed, roots_for_board


class ExternalActivityTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.now = datetime.now(timezone.utc)
        self.order = "work-00000000-0000-0000-0000-000000000001"
        self.run = "batch-00000000-0000-0000-0000-000000000002"
        self.folder = self.root / "explorations" / self.order
        self.order_file = self.root / "work-orders" / (self.order + ".json")
        self.work = {"id": self.order, "status": "open", "targetProducts": 10, "entries": [],
                     "createdAt": self.now.isoformat()}
        self.put(self.order_file, self.work)

    def put(self, file, data):
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(json.dumps(data), encoding="utf8")

    def state(self, phase, age=0, **fields):
        at = self.now - timedelta(seconds=age)
        self.put(self.folder / "state.json", {"workId": self.order, "status": phase,
                 "mode": "live", "startedAt": at.isoformat(), **fields})

    def feed(self, live=False):
        return ExternalActivityFeed([self.root], alive=lambda record: live and record.get("pid") == 42)

    def test_running_requires_worker_or_heartbeat_then_expires_with_cache(self):
        self.state("running_batch", age=60)
        self.put(self.folder / "process.json", {"pid": 42})
        self.assertEqual(self.feed().snapshot()[0]["state"], "blocked")
        feed = self.feed(live=True)
        self.assertEqual(feed.snapshot()[0]["state"], "running")
        self.state("needs_attention", error="NO1_AUTH_REQUIRED")
        self.assertEqual(feed.snapshot()[0]["state"], "running")
        feed.expires = 0
        row, = feed.snapshot()
        self.assertEqual((row["state"], row["detail"]), ("blocked", "Onebox 백그라운드 연결 인증 필요"))
        self.assertEqual(row["updatedAt"], int(self.now.timestamp()))

    def test_completed_partial_fixture_and_stopped_order(self):
        finish = (self.now - timedelta(minutes=4)).isoformat()
        self.state("complete", age=380, finishedAt=finish)
        self.work["createdAt"] = (self.now - timedelta(days=3)).isoformat()
        self.put(self.order_file, self.work)
        self.assertEqual(self.feed().snapshot()[0]["updatedAt"], int(datetime.fromisoformat(finish).timestamp()))
        self.state("complete", age=3*86400, finishedAt=self.work["createdAt"])
        self.assertEqual(self.feed().snapshot(), [])
        self.state("complete", mode="fixture")
        self.assertEqual(self.feed().snapshot(), [])
        (self.folder / "state.json").write_text("{", encoding="utf8")
        self.assertEqual(self.feed().snapshot(), [])
        self.state("discovering", heartbeatAt=self.now.isoformat())
        self.assertEqual(self.feed().snapshot()[0]["state"], "running")
        self.put(self.order_file, {**self.work, "status":"stopped"})
        self.assertEqual(self.feed().snapshot(), [])

    def test_manual_batches_and_isolated_http_board(self):
        self.put(self.order_file, {**self.work, "entries":[{"runId":self.run, "productCount":5}]})
        self.put(self.root / self.run / "launch.json", {"workId":self.order})
        self.put(self.root / self.run / "batch-state.json",
                 {"status":"complete", "finishedAt":self.now.isoformat(), "mode":"live"})
        self.assertEqual(self.feed().snapshot()[0]["state"], "ready")
        with patch.dict(os.environ, TEAM_BOARD_KREAM_ROOTS=str(self.root)):
            self.assertEqual(roots_for_board(self.root / "test-board"), ())
        board = Board(self.root / "test-board")
        self.addCleanup(board.db.close)
        server = BoardServer(0, board, type("Team", (), {"activity":{}})())
        self.addCleanup(server.server_close)
        server.external_activity = self.feed()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}/api/board?after=0"
        with build_opener(ProxyHandler({})).open(url, timeout=3) as response:
            body = json.load(response)
        self.assertEqual(body["externalActivities"], server.external_activity.snapshot())
        self.assertEqual(body["entries"], [])
