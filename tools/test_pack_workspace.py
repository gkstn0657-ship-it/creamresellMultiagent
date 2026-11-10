import pathlib
import sqlite3
import tempfile
import unittest
import zipfile
from pack_workspace import pack, verify


class TransferTests(unittest.TestCase):
    def test_wal_snapshot_policy_and_runtime_exclusions(self):
        with tempfile.TemporaryDirectory() as temp:
            base = pathlib.Path(temp)
            root = base / "source"
            root.mkdir()
            (base / "AGENTS.md").write_text("background only", encoding="utf-8")
            for name in ["connection.json", "auth.json", ".env", "process.json", "worker.lock"]:
                (root / name).write_text("excluded", encoding="utf-8")
            (root / "STOP").write_text("preserve", encoding="utf-8")
            source = sqlite3.connect(str(root / "discovery.sqlite"))
            source.execute("PRAGMA journal_mode=WAL")
            source.execute("CREATE TABLE progress(cursor TEXT)")
            source.execute("INSERT INTO progress VALUES ('next-page')")
            source.commit()
            try:
                output = base / "transfer.zip"
                result = pack(root, output)
                self.assertTrue(result["verified"])
                with zipfile.ZipFile(str(output)) as archive:
                    self.assertEqual(set(archive.namelist()), {
                        "Cream/AGENTS.md", "Cream/STOP", "Cream/discovery.sqlite", "Cream/TRANSFER-MANIFEST.json"})
                    dest = base / "restored.sqlite"
                    dest.write_bytes(archive.read("Cream/discovery.sqlite"))
                    restored = sqlite3.connect(str(dest))
                    try:
                        self.assertEqual(restored.execute("SELECT cursor FROM progress").fetchone()[0], "next-page")
                        self.assertEqual(restored.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                    finally:
                        restored.close()
                with self.assertRaises(ValueError):
                    pack(root, output)
            finally:
                source.close()

    def test_tampered_archive_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            base = pathlib.Path(temp)
            root = base / "source"
            root.mkdir()
            (root / "code.txt").write_text("original", encoding="utf-8")
            output = base / "good.zip"
            pack(root, output)
            bad = base / "bad.zip"
            with zipfile.ZipFile(str(output)) as old, zipfile.ZipFile(str(bad), "w") as new:
                for name in old.namelist():
                    new.writestr(name, b"changed" if name.endswith("code.txt") else old.read(name))
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                verify(bad)


if __name__ == "__main__":
    unittest.main()
