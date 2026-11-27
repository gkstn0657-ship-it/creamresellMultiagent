import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import public_sourcing as sourcing
from agents import Team
from board import Board
from dashboard import BoardServer


def investigation(job):
    return {"items": [
        {"productId": pid, "rank": rank, "title": f"시험 상품 {pid}", "status": "보류",
         "details": "테스트 자료. 옵션 재고 미확인.",
         "sources": [{"label": "상품", "url": sourcing.source_url(pid)}]} for rank, pid in job["items"]
    ]}


class PublicSourcingTests(unittest.TestCase):
    def test_board_to_daily_report_and_retry(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            reports = root / "reports"
            reports.mkdir()
            board = Board(root / "board")
            try:
                with BoardServer(0, board, Team(board), preferences_directory=root / "profile") as server:
                    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .02}, daemon=True)
                    thread.start()
                    try:
                        with patch.object(sourcing, "BOARD", f"http://127.0.0.1:{server.server_port}"), patch.object(sourcing, "REPORTS", reports):
                            day = sourcing.SEED_DAY
                            state = sourcing.new_day(day, [])
                            self.assertEqual(sourcing.tick(state, root, day), "working")
                            active, other = state["jobs"]
                            self.assertEqual(active["items"], [[4,1128181]])
                            self.assertEqual(other["items"], [[5,589356]])
                            # Lost POST acknowledgement must bind to the same card.
                            del active["card"]
                            self.assertEqual(sourcing.tick(state, root, day), "working")
                            self.assertEqual(len(board.cards()), 2)
                            card = active["card"]
                            workspace = board.workspace(card)
                            workspace.mkdir(parents=True)
                            (workspace / sourcing.OUTPUT).write_text(json.dumps(investigation(active)), "utf-8")
                            board.finish(board.claim("worker"), "submit", "검수용 결과")
                            self.assertEqual(sourcing.tick(state, root, day), "working")
                            board.finish(board.claim("reviewer"), "approve", "검토")
                            board.finish(board.claim("auditor"), "close", "감사")
                            (root / "STOP").touch()
                            self.assertEqual(sourcing.tick(state, root, day), "saved")
                            board.finish(board.claim("worker"), "blocked", "확인 필요")
                            self.assertEqual(sourcing.tick(state, root, day), "stopped")
                            self.assertEqual(sourcing.reported_ids(day), {1128181})
                            self.assertEqual(state["deferred"][0]["card"], other["card"])
                            self.assertEqual(len(board.cards()), 2)
                            before = (reports / day[:7] / f"{day}.md").read_bytes()
                            sourcing.append_entries(day, sourcing.check_products(active, investigation(active)))
                            self.assertEqual(before, (reports / day[:7] / f"{day}.md").read_bytes())
                    finally:
                        server.shutdown()
                        thread.join()
            finally:
                board.db.close()

    def test_next_page_keeps_order_and_exhaustion(self):
        state = sourcing.new_day("2026-11-23", [123])
        job = sourcing.next_job(state)
        sourcing.consume_listing(state, job, {"items":[{"rank":1,"productId":123},{"rank":2,"productId":789}],"exhausted":True})
        self.assertEqual(state["queue"], [[2,789]])
        self.assertTrue(state["exhausted"])
        with self.assertRaises(ValueError):
            sourcing.consume_listing(state, {"start":3, "day":state["day"]}, {"items":[{"rank":3,"productId":123}],"exhausted":True})

    def test_never_publish_unsupported_positive_or_wrong_id(self):
        job = sourcing.next_job(sourcing.new_day(sourcing.SEED_DAY, []))
        data = investigation(job)
        data["items"][0]["productId"] = 123
        with self.assertRaises(ValueError):
            sourcing.check_products(job, data)
        data = investigation(job)
        data["items"][0]["status"] = "채택"
        with self.assertRaises((ValueError, KeyError)):
            sourcing.check_products(job, data)

    def test_incomplete_report_reopens_existing_card_only_once(self):
        with tempfile.TemporaryDirectory() as folder:
            state = sourcing.new_day(sourcing.SEED_DAY, [])
            job = dict(sourcing.next_job(state), card=7)
            state["jobs"] = [job]
            state["queue"] = job["items"].copy()
            state["exhausted"] = True
            notes = []
            def request(path, body=None, **kwargs):
                if path.startswith("/api/board"):
                    return {"cards":[{"id":7,"state":"done","stage":"auditor"}]}
                if path.endswith("/notes"):
                    notes.append(body["requestId"])
                    return {"id":7}
                return {"items":[]}
            self.assertEqual(sourcing.tick(state, Path(folder), sourcing.SEED_DAY, request=request), "working")
            sourcing.tick(state, Path(folder), sourcing.SEED_DAY, request=request)
            self.assertEqual(len(notes), 1)
            self.assertEqual(state["deferred"][0]["items"], job["items"])

    def test_migrates_old_two_product_card_while_dispatching_distinct_product(self):
        day = sourcing.SEED_DAY
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            state = sourcing.new_day(day, [])
            del state["jobs"], state["deferred"]
            old = dict(kind="products", day=day, items=state["queue"][:2], card=4,
                       key="legacy-key", text="기존 두 상품 요청 원문")
            state["active"] = old
            submitted = []
            rows = [{"id":4, "state":"running", "stage":"worker","request":old["text"]}]
            def request(path, body=None, **kwargs):
                if body is None:
                    return {"cards":rows}
                submitted.append(body["requestId"])
                card = len(rows) + 4
                rows.append({"id":card, "state":"running", "stage":"worker", "request":body["text"]})
                return {"id":card}
            sourcing.tick(state, root, day, request=request, reported=lambda d:set())
            first, second = state["jobs"]
            self.assertEqual(first["card"], 4)
            self.assertEqual(first["items"], [[4,1128181],[5,589356]])
            self.assertEqual(second["items"], [[6,1036058]])
            # Same saved state after process restart. One failed product frees
            # only its slot, the legacy card retains its original request ID.
            state = json.loads((root / "state.json").read_text("utf-8"))
            rows[1]["state"] = "blocked"
            sourcing.tick(state, root, day, request=request, reported=lambda d:set())
            self.assertEqual([j["items"] for j in state["jobs"]], [first["items"], [[7,18871]]])
            self.assertEqual([j["items"] for j in state["deferred"]], [[[6,1036058]]])
            self.assertEqual(len(submitted), 2)
            # The former blocked card is reactivated by the user and gets its
            # own released slot instead of being replaced by a paid duplicate.
            rows[1]["state"] = "running"
            rows[2]["state"] = "blocked"
            sourcing.tick(state, root, day, request=request, reported=lambda d:set())
            self.assertEqual([j["card"] for j in state["jobs"]], [4,5])
            self.assertEqual(len(submitted), 2)

    def test_one_listing_and_stop_between_independent_submissions(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            state = sourcing.new_day(sourcing.SEED_DAY, [])
            posts = []
            def request(path, body=None, **kwargs):
                if body is None:
                    return {"cards":[{"id":1,"state":"running","stage":"worker"}]}
                posts.append(body)
                (root / "STOP").touch()
                return {"id":len(posts)}
            sourcing.tick(state, root, state["day"], request=request, reported=lambda d:set())
            self.assertEqual(len(posts), 1)
            sourcing.tick(state, root, state["day"], request=request, reported=lambda d:set())
            self.assertEqual(len(posts), 1)
            state = sourcing.new_day("2026-11-23", [])
            job = sourcing.next_job(state)
            state["jobs"].append(job)
            self.assertIsNone(sourcing.next_job(state))
