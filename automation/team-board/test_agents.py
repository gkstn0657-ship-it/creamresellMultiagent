import hashlib
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from agents import EVIDENCE_BYTES, EVIDENCE_FILES, PREVIEW_BYTES, artifact_evidence, instructions


class SupervisorEvidenceTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name) / "work" / "1"
        self.root.mkdir(parents=True)

    def test_host_reads_new_bytes_for_each_supervisor(self):
        file = self.root / "handoff.txt"
        expected = "칠판 연결 확인\r\n".encode()
        file.write_bytes(expected)
        result = artifact_evidence(self.root)
        item, = result["files"]
        self.assertTrue(item["whole_file"])
        self.assertEqual(item["utf8_text"], expected.decode())
        self.assertEqual(item["sha256"], hashlib.sha256(expected).hexdigest())
        file.write_bytes(b"different\n")
        again, = artifact_evidence(self.root)["files"]
        self.assertNotEqual(again["sha256"], item["sha256"])
        job = {"stage": "auditor", "id": 1, "request": "check file", "board": [], "entries": []}
        self.assertIn(again["sha256"], instructions(job, {"files": [again]}))

    def test_partial_utf8_and_binary_are_labeled(self):
        (self.root / "partial").write_bytes(b"a" * (PREVIEW_BYTES - 1) + "끝".encode())
        (self.root / "binary").write_bytes(b"\x89PNG\x00")
        items = {i["path"]: i for i in artifact_evidence(self.root)["files"]}
        self.assertFalse(items["partial"]["whole_file"])
        self.assertEqual(len(items["partial"]["utf8_text"]), PREVIEW_BYTES - 1)
        self.assertNotIn("sha256", items["partial"])
        self.assertEqual(items["binary"]["first_bytes_hex"], "89504e4700")
        self.assertNotIn("utf8_text", items["binary"])

    def test_preview_and_file_count_are_bounded(self):
        for i in range(EVIDENCE_FILES + 2):
            (self.root / str(i)).write_bytes(b"z" * PREVIEW_BYTES)
        evidence = artifact_evidence(self.root)
        self.assertEqual(len(evidence["files"]), EVIDENCE_FILES)
        self.assertLessEqual(sum(f["read_bytes"] for f in evidence["files"]), EVIDENCE_BYTES)
        self.assertFalse(evidence["listing_complete"])

    def test_linked_files_and_directories_are_excluded(self):
        outside = self.root.parent / "outside"
        outside.mkdir()
        secret = outside / "outside.txt"
        secret.write_text("outside data")
        os.link(secret, self.root / "hardlink.txt")
        link = self.root / "directory-link"
        if os.name == "nt":
            subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(outside)], check=True,
                           capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            link.symlink_to(outside, target_is_directory=True)
        result = artifact_evidence(self.root)
        self.assertEqual(result["files"], [])
        self.assertEqual(result["skipped"], 2)
        with self.assertRaises(ValueError):
            artifact_evidence(link)


if __name__ == "__main__":
    unittest.main()
