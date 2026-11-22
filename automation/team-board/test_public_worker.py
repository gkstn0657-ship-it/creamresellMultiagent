import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

from agents import Team
from board import Board
from dashboard import public_worker_lock, recover_primary


class PublicWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.board = Board(self.temp.name)
        self.other = Board(self.temp.name, initialize=False)
        self.addCleanup(self.board.db.close)
        self.addCleanup(self.other.db.close)

    def enqueue(self, items):
        day = "2026-11-22"
        return self.board.submit("public-weekly-" + day + "-" + items, "add",
                                 text=day + " KST KREAM 공개 상품 소싱. 테스트 " + items)

    def test_secondary_ignores_listing_general_tasks_and_later_public_notes(self):
        general = self.board.add("2026-11-22 KST KREAM 공개 상품 소싱. 직접 지정한 업무")
        self.other.submit("public-weekly-2026-11-22-12", "note", general, "확인")
        self.enqueue("r17")
        self.board.submit("public-weekly-2026-11-22-99", "add", text="일반 작업")
        p1, p2 = self.enqueue("111-222"), self.enqueue("333-444")
        first = self.other.claim("worker", public_only=True)
        self.assertEqual(first["id"], p1)
        self.assertIsNone(self.board.claim("worker", public_only=True))
        self.assertEqual(self.board.claim("worker")["id"], general)
        self.other.finish(first, "submit", "완료")
        self.assertEqual(self.other.claim("worker", public_only=True)["id"], p2)

    def test_recovery_does_not_interrupt_the_other_slots_live_claim(self):
        p1, p2 = self.enqueue("111"), self.enqueue("222")
        primary = self.board.claim("worker")
        with public_worker_lock(self.other):
            secondary = self.other.claim("worker", public_only=True)
            recover_primary(self.board)
            self.assertEqual(self.board._get(p1)["state"], "blocked")
            self.assertEqual(self.board._get(p2)["claim"], secondary["token"])
            self.assertFalse(self.board.finish(primary, "submit", "이전 실행"))
        self.board.retry(p1)
        new_primary = self.board.claim("worker")
        self.other.recover(public_only=True)
        self.assertEqual(self.board._get(p1)["claim"], new_primary["token"])
        self.assertEqual(self.board._get(p2)["state"], "blocked")
        self.assertFalse(self.other.finish(secondary, "submit", "이전 실행"))

    def test_two_real_child_processes_overlap_and_submit_to_normal_reviews(self):
        p1, p2 = self.enqueue("111"), self.enqueue("222")
        async def exercise():
            active = set()
            children = []
            together = asyncio.Event()
            finished = set()
            async def execute(job, folder, progress):
                folder.mkdir(parents=True, exist_ok=True)
                proc = await asyncio.create_subprocess_exec(
                    sys.executable, "-c", "import sys; sys.stdin.buffer.read()", cwd=folder,
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL)
                children.append(proc)
                active.add(job["id"])
                try:
                    if len(active) == 2:
                        self.assertTrue(all(child.returncode is None for child in children))
                        together.set()
                    await asyncio.wait_for(together.wait(), timeout=5)
                    progress("상품별 자료 확인")
                    (folder / "evidence.txt").write_text(str(proc.pid), encoding="ascii")
                finally:
                    proc.stdin.close()
                    await proc.wait()
                    finished.add(job["id"])
                return "submit", "증거 기록 완료"

            # Independent DB connections and CLI processes, as in primary + sidecar.
            await asyncio.wait_for(asyncio.gather(
                Team(self.board, execute).serve("worker", stop_requested=lambda: p1 in finished),
                Team(self.other, execute).serve("worker", public_only=True, stop_requested=lambda: p2 in finished)
            ), timeout=8)
            self.assertEqual(len({child.pid for child in children}), 2)
        asyncio.run(exercise())
        self.assertEqual({row["stage"] for row in self.board.cards()}, {"reviewer"})
        for card in (p1, p2):
            events = [row["kind"] for row in self.board.history(card)]
            self.assertEqual(events.count("start"), 1)
            self.assertEqual(events.count("submit"), 1)
            self.assertIn("progress", events)
            self.assertTrue((Path(self.temp.name) / "work" / str(card) / "evidence.txt").exists())
