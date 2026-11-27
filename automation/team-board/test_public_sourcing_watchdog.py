import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import public_sourcing_watchdog as wd
from agents import RunnerLock
from board import Board


class WatchdogTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.directory = Path(tmp.name) / "public-sourcing"
        (self.directory / "worker").mkdir(parents=True)
        self.supervisor = wd.Supervisor(self.directory, {})
        self.health = self.mock("board_health", return_value="online")
        self.start = self.mock("launch", side_effect=lambda d, r: Mock(pid=10 if r == "dispatcher" else 11,
                                                                      **{"poll.return_value": None}))
        self.restore = self.mock("restore_board")
        self.mock("owner_pid", return_value=901)

    def mock(self, name, **kwargs):
        p = patch.object(wd, name, **kwargs)
        self.addCleanup(p.stop)
        return p.start()

    def test_adopt_existing_locks_without_launch(self):
        with RunnerLock(self.directory), RunnerLock(self.directory / "worker"):
            self.assertTrue(self.supervisor.tick(100))
            self.assertEqual(self.supervisor.state["dispatcherPid"], 901)
            self.assertTrue(self.supervisor.state["workerLockHeld"])
            self.start.assert_not_called()

    def test_single_child_start_then_recover_dead_child_without_touching_live_worker(self):
        self.supervisor.tick(100)
        self.supervisor.tick(110)
        self.assertEqual(self.start.call_count, 2)
        child = self.supervisor.children["dispatcher"]
        child.poll.return_value = child.returncode = 1
        self.supervisor.tick(120)
        self.assertEqual(self.supervisor.state["dispatcherStatus"], "cooldown")
        self.supervisor.tick(131)
        self.assertEqual([c.args[1] for c in self.start.call_args_list], ["dispatcher", "worker", "dispatcher"])
        self.assertEqual(self.supervisor.state["dispatcherAttempts"], 2)

    def test_persistent_stop_and_cooldown_survive_supervisor_restart(self):
        previous = {"dispatcherAttempts": 3, "dispatcherRetryAt": 800, "workerRetryAt": 800}
        supervisor = wd.Supervisor(self.directory, previous)
        supervisor.tick(500)
        self.start.assert_not_called()
        (self.directory / "STOP").touch()
        self.assertFalse(supervisor.tick(900))
        self.start.assert_not_called()
        self.restore.assert_not_called()
        self.assertTrue((self.directory / "STOP").exists())

    def test_only_restore_matching_absent_endpoint_without_live_board_lock(self):
        self.health.return_value = "foreign"
        self.supervisor.tick(100)
        self.health.return_value = "unresponsive"
        self.supervisor.tick(130)
        self.health.return_value = "absent"
        with RunnerLock(self.directory.parent):
            self.supervisor.tick(160)
        self.restore.assert_not_called()
        self.supervisor.tick(170)
        self.supervisor.tick(184)
        self.restore.assert_called_once()
        self.start.assert_not_called()

    def test_stall_never_kills_process_or_retries_board_card_and_progress_resets(self):
        board = Board(self.directory.parent)
        self.addCleanup(board.db.close)
        board.add("unrelated")
        card = board.submit("public-weekly-2026-11-22-36", "add", None, "investigate")
        with RunnerLock(self.directory), RunnerLock(self.directory / "worker"):
            self.supervisor.tick(100)
            self.supervisor.tick(2000)
            self.assertEqual(self.supervisor.state["progress"]["cards"][0]["id"], card)
            self.assertTrue(self.supervisor.state["stalled"])
            self.supervisor.state["dispatcherAttempts"] = 3
            before = self.supervisor.state["progress"]["event"]
            board.note(card, "new evidence")
            self.supervisor.tick(2010)
            self.assertFalse(self.supervisor.state["stalled"])
            self.assertEqual(self.supervisor.state["lastProgress"], 2010)
            self.assertEqual(self.supervisor.state["dispatcherAttempts"], 0)
            self.assertGreater(self.supervisor.state["progress"]["event"], before)
            self.start.assert_not_called()
            self.restore.assert_not_called()

    def test_backoff_caps_at_thirty_minutes(self):
        for i in range(20):
            self.supervisor.delay("worker", 100)
        self.assertEqual(self.supervisor.state["workerRetryAt"], 1900)


if __name__ == "__main__":
    unittest.main()
