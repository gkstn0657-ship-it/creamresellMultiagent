import json
import tempfile
import time
import unittest
from unittest.mock import patch
from datetime import datetime, timezone
from pathlib import Path

from board import Board
from naver_work import activities, context, observe, register, sync


class NaverWorkTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name) / "20261122-naver-legacy"
        self.folder.mkdir()
        self.board = Board(Path(temp.name) / "board")
        self.addCleanup(self.board.db.close)
        self.now = datetime.now(timezone.utc).isoformat()
        self.write("starting", "릴레이 준비")

    def write(self, status, stage, **extra):
        (self.folder / "naver-live.json").write_text(json.dumps({"status":status, "stage":stage,
            "target":8, "updatedAt":self.now, **extra}),encoding="utf8")

    def test_batch_done_wait_and_product_hold_do_not_reopen_or_allocate_jobs(self):
        worker = register(self.board,self.folder)
        self.assertEqual(register(self.board,self.folder),worker)
        self.assertEqual(self.board._get(worker)["stage"],"worker")
        sync(self.board)
        total = len(self.board.timeline())
        sync(self.board)
        self.assertEqual(total,len(self.board.timeline()))
        with self.board.write():
            self.board._set(worker,"worker","done")
        for state,stage,extra in [("blocked","네이버 검색",{"reason":"판매처 조회 대기"}),
                 ("running","다음 의류·잡화 후보 대기",{"completedBatches":[{"folder":"."}]}),
                 ("completed","탐색 완료",{}), ("stopped","사용자 요청으로 중지",{})]:
            self.write(state,stage,**extra)
            sync(self.board)
            self.assertEqual(len(self.board.cards()),1)
            self.assertEqual((self.board._get(worker)["stage"],self.board._get(worker)["state"]),("worker","done"))
        self.assertNotIn("note",[e["kind"] for e in self.board.history(worker)])
        row,=activities(self.board)
        self.assertEqual((row["id"],row["state"],row["phase"]),("naver:20261122-naver-legacy","blocked","blocked"))

    def test_critical_crash_claims_one_review_per_incident(self):
        worker = register(self.board,self.folder)
        self.write("blocked","수집 중지",reason="parse-si.mjs 실패: TypeError")
        sync(self.board)
        reviewer = self.board.db.execute("SELECT job FROM sourcing_incidents").fetchone()[0]
        self.assertEqual(context(self.board,reviewer)["channel"], worker)
        self.assertEqual(self.board._get(reviewer)["stage"],"reviewer")
        self.assertEqual(context(self.board,reviewer)["host"]["critical"], "NAVER_RUN_FAILED")
        self.write("blocked","수집 중지",reason="사전 점검 실패: SQLITE_FULL",target=12)
        sync(self.board)
        sync(self.board)
        self.assertEqual(len(self.board.cards()),2)
        self.write("running","네이버 검색")
        sync(self.board)
        self.assertEqual(self.board._get(reviewer)["state"],"done")
        self.write("failed","수집 중지",reason="parse-si.mjs 실패: TypeError")
        sync(self.board)
        self.assertEqual(len(self.board.cards()),3)

    def test_restored_board_finds_its_matching_ledger_without_restarting(self):
        worker = register(self.board, self.folder)
        self.write("stopped", "중지", runId=self.folder.name)
        clone = self.folder.parent / "new clone"
        restored = clone / "kream-runs" / self.folder.name
        restored.parent.mkdir(parents=True)
        self.folder.rename(restored)
        (restored / "STOP").touch()
        with patch("naver_work.PROJECT", clone):
            self.assertEqual(context(self.board, worker)["sourceDirectory"], str(restored))
            self.assertEqual(register(self.board, restored), worker)
            sync(self.board)
            self.assertEqual(context(self.board, worker)["host"]["reason"], "중지 신호 수신")
            self.assertEqual(len(self.board.cards()), 1)
            self.assertTrue((restored / "STOP").is_file())

    def test_missing_ledger_waits_for_timeout_then_reports_one_worker_outage(self):
        register(self.board,self.folder)
        self.write("running","탐색 진행")
        sync(self.board)
        (self.folder/"naver-live.json").unlink()
        sync(self.board)
        self.assertEqual(len(self.board.cards()),1)
        with patch("naver_work.time.time",return_value=time.time()+150):
            sync(self.board)
            sync(self.board)
        self.assertEqual(len(self.board.cards()),2)
        reviewer = self.board.claim("reviewer")
        self.assertEqual(context(self.board,reviewer["id"])["host"]["critical"], "NAVER_LEDGER_MISSING")

    def test_search_counts_unique_live_dumps_not_queued_jobs(self):
        for name in ["dump-N123-s.json","dump-N123-s2.json","dump-N99-cat.json","dump-K123.json","jobs.json"]:
            (self.folder/name).write_text(json.dumps({"url":"https://search.shopping.naver.com/search/all",
                "text":"상의", "at":self.now}),encoding="utf8")
        (self.folder/"dump-N555-s.json").write_text(json.dumps({"url":"https://search.shopping.naver.com/",
            "text":"보안 확인", "blocked":True, "at":self.now}),encoding="utf8")
        (self.folder/"dump-N888-s.json").write_text(json.dumps({"failed":True,"at":self.now}),encoding="utf8")
        (self.folder/"dump-K123.json").write_text(json.dumps({"url":"https://kream.co.kr/login?returnUrl=/products/123",
            "text":"로그인", "blocked":False, "at":self.now}),encoding="utf8")
        for name,url in [("dump-N703-prod.json","http://example.test/goods/703"),
                         ("dump-N704-prod.json","http://example.test/member/login.php"),
                         ("dump-N705-s.json","http://search.shopping.naver.com/search/all"),
                         ("dump-K706.json","http://kream.co.kr/products/706")]:
            (self.folder/name).write_text(json.dumps({"url":url, "text":"상세", "at":self.now}),encoding="utf8")
        self.write("running","네이버 검색",pid=123,startedAt=self.now)
        s=observe(self.folder,alive=lambda _:True)
        self.assertEqual((s["search"],s["kream"],s["catalog"],s["phase"]),(1,0,1,"collect"))
        self.assertEqual(s["offer"],1)
        self.assertEqual(observe(self.folder,alive=lambda _:False)["state"],"blocked")
        self.assertEqual(observe(self.folder,now=time.time()+60,alive=lambda _:True)["state"],"blocked")
        nested=self.folder/"batch-0002"
        nested.mkdir()
        (nested/"dump-N444-s.json").write_text((self.folder/"dump-N123-s.json").read_text(encoding="utf8"),encoding="utf8")
        self.write("running","네이버 검색",activeBatch="batch-0002",completedBatches=[{"folder":"."}])
        self.assertEqual(observe(self.folder)["search"],2)
        (self.folder/"STOP").touch()
        self.assertEqual(observe(self.folder,alive=lambda _:True)["state"],"blocked")

if __name__ == "__main__":
    unittest.main()
