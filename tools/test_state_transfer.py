import sqlite3
import tempfile
import unittest
import zipfile
from argparse import Namespace
from contextlib import closing
from pathlib import Path

from state_transfer import export, member, restore


class PrivateTransferTests(unittest.TestCase):
    def test_relocates_registered_work_and_preserves_stop_and_committed_wal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            source = root / "old"
            dest = root / "new clone"
            (dest / "automation/team-board").mkdir(parents=True)
            (dest / "automation/team-board/board.py").touch()
            board = source / "board"
            board.mkdir(parents=True)
            run = source / "20261122-naver-old"
            run.mkdir()
            (run / "naver-live.json").write_text('{"status":"stopped"}')
            (run / "STOP").touch()
            (run / "process.json").write_text("{}")
            (board / "window-profile").mkdir()
            (board / "window-profile/Cookies").touch()
            archive = root / "private.zip"
            args = Namespace(board=board, teams=source/"no1", naver_root=source, reports=source/"reports",
                             policy=source/"policy", library=source/"lib", archive=archive)
            with closing(sqlite3.connect(board / "board.sqlite3")) as db:
                db.execute("PRAGMA journal_mode=WAL")
                db.executescript("CREATE TABLE cards(state); CREATE TABLE contracts(state);"
                                 "CREATE TABLE naver_runs(id, folder); INSERT INTO cards VALUES('stopped');")
                db.execute("INSERT INTO naver_runs VALUES(?,?)", ("naver:"+run.name, str(run)))
                db.commit()
                export(args)
            with zipfile.ZipFile(archive) as z:
                self.assertFalse(any("Cookies" in n or "process.json" in n for n in z.namelist()))
            imp = Namespace(dest=dest, library=dest/"library", archive=archive)
            restore(imp)
            with closing(sqlite3.connect(dest/"runs/team-board/board.sqlite3")) as db:
                self.assertEqual(db.execute("SELECT folder FROM naver_runs").fetchone()[0], str(dest/"kream-runs"/run.name))
                self.assertEqual(db.execute("SELECT state FROM cards").fetchone(), ("stopped",))
            self.assertTrue((dest/"kream-runs"/run.name/"STOP").is_file())
            with self.assertRaisesRegex(ValueError, "Conflict"):
                restore(imp)

    def test_rejects_non_data_paths(self):
        for name in ("no1/../README.md", "policy/other.json", "board/window-profile/Cookies",
                     "reports/2026-11/other.md", "no1/C:/Temp", "no1/log.json:stream"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                member(name)
