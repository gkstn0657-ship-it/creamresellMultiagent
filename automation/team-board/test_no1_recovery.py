import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import no1_recovery as recovery


class No1RecoveryTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.work = "work-00000000-0000-0000-0000-000000000010"
        (self.root / "work-orders").mkdir()
        (self.root / "work-orders" / (self.work + ".json")).write_text(json.dumps({
            "id": self.work, "status": "open", "entries": []}), encoding="utf8")
        folder = self.root / "explorations" / self.work
        folder.mkdir(parents=True)
        (folder / "state.json").write_text(json.dumps({"mode": "live", "workId": self.work,
            "status": "needs_attention", "error": "NO1_AUTH_REQUIRED"}), encoding="utf8")
        p = patch.object(recovery, "roots_for_board", return_value=(self.root,))
        p.start()
        self.addCleanup(p.stop)

    def test_zero_authenticated_does_not_resume_or_write(self):
        with patch.object(recovery, "_node", return_value="NO1_AUTH_REQUIRED") as run:
            self.assertEqual(recovery.check(self.work, self.root), "NO1_AUTH_REQUIRED")
        run.assert_called_once_with(recovery.PROBE)
        self.assertFalse(list(self.root.glob("*-recovery.json")))

    def test_same_work_resumes_once_and_stop_disables_probes(self):
        with patch.object(recovery, "_node", side_effect=["AUTHENTICATED", "RESUMED", "AUTHENTICATED"]) as run:
            self.assertEqual(recovery.check(self.work, self.root), "RESUMED")
            self.assertEqual(run.call_args.args, (recovery.RESUME, self.root, self.work, self.root / "STOP"))
            self.assertEqual(recovery.check(self.work, self.root), "resume_cooldown")
            (self.root / "STOP").touch()
            self.assertEqual(recovery.check(self.work, self.root), "stopped")
            self.assertEqual(run.call_count, 3)
