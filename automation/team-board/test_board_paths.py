import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from board_paths import ledger_directories, report_directory


class PortablePathsTests(unittest.TestCase):
    def test_standalone_clone_uses_its_own_data(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, clear=True):
            project = Path(temp) / "새 폴더" / "checkout"
            unrelated = project.parent / "Cream" / "kream-runs" / "agent-teams" / "work-orders"
            unrelated.mkdir(parents=True)
            self.assertEqual(ledger_directories(project), (project / "kream-runs" / "agent-teams",))
            self.assertEqual(report_directory(project), project / "상품탐색결과")

    def test_previous_installation_preserves_its_ledgers_and_explicit_paths_take_precedence(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, clear=True):
            project = Path(temp) / "1109renew" / "checkout"
            old = project.parent / "Cream" / "kream-runs" / "agent-teams"
            (old / "work-orders").mkdir(parents=True)
            local = project / "kream-runs" / "agent-teams"
            self.assertEqual(ledger_directories(project), (old, local))
            self.assertEqual(report_directory(project), Path(temp) / "상품탐색결과")
            with patch.dict(os.environ, CREAM_AGENT_TEAMS_ROOT="ledger", CREAM_REPORTS_DIR="results"):
                self.assertEqual(ledger_directories(project), (project / "ledger",))
                self.assertEqual(report_directory(project), project / "results")
                with patch.dict(os.environ, TEAM_BOARD_KREAM_ROOTS=str(old) + os.pathsep + str(local)):
                    self.assertEqual(ledger_directories(project), (old, local))
