"""Private workspace migration archive; standard library only, Python 3.7+."""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import sqlite3
import tempfile
import zipfile

SKIP_DIRS = {"node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", "portable-check", "pc-relay", ".git", ".wrangler"}
SECRET_NAMES = {"auth.json", "credentials.json", "cookies.json", "storage-state.json", "connection.json", ".npmrc", ".pypirc"}
PROCESS_NAMES = {"process.json", "batch.lock", "worker.lock", "runtime.lock", "work-control.lock", "worker.pid"}
MACHINE_STATE = {"kream-runs/automation/loop-state.json", "kream-runs/automation/loop-process.json",
                 "kream-runs/automation/loop.log",
                 "kream-runs/automation/loop-error.log"}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def reparse(path):
    return bool(getattr(os.lstat(str(path)), "st_file_attributes", 0) & 0x400)

def sqlite_snapshot(candidate):
    # SQLite backup includes committed WAL data without changing the source DB.
    with tempfile.TemporaryDirectory(prefix="cream-db-transfer-") as folder:
        target = pathlib.Path(folder) / "snapshot.sqlite"
        source = sqlite3.connect(candidate.resolve().as_uri() + "?mode=ro", uri=True)
        dest = sqlite3.connect(str(target))
        try:
            source.backup(dest)
            if dest.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Invalid SQLite snapshot: " + str(candidate))
        finally:
            dest.close()
            source.close()
        return target.read_bytes()

def verify(archive):
    with zipfile.ZipFile(str(archive)) as source:
        corrupt = source.testzip()
        if corrupt:
            raise ValueError("ZIP CRC mismatch: " + corrupt)
        manifest = json.loads(source.read("Cream/TRANSFER-MANIFEST.json").decode("utf-8"))
        expected = {"Cream/" + row["path"] for row in manifest["files"]}
        actual = set(source.namelist()) - {"Cream/TRANSFER-MANIFEST.json"}
        if expected != actual or len(source.namelist()) != len(set(source.namelist())):
            raise ValueError("Archive file inventory mismatch")
        for row in manifest["files"]:
            data = source.read("Cream/" + row["path"])
            if len(data) != row["bytes"] or digest(data) != row["sha256"]:
                raise ValueError("SHA-256 mismatch: " + row["path"])
    return {"verified": True, "files": len(expected), "archiveBytes": archive.stat().st_size,
            "archiveSha256": digest(archive.read_bytes())}

def pack(root, output):
    root, output = root.resolve(), output.resolve()
    if output.exists():
        raise ValueError("Destination already exists; choose a new filename")
    excluded, files = [], []
    output.parent.mkdir(parents=True, exist_ok=True)
    manifest = {"version": "cream-transfer-v1", "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "workStatus": "2026-11-10-background-deterministic-discovery", "containsPrivateSourceDumps": True,
                "credentialsIncluded": False, "files": files, "excluded": excluded}
    temp = output.with_suffix(output.suffix + ".partial")
    if temp.exists():
        raise ValueError("Partial archive already exists; inspect it before retrying")
    with zipfile.ZipFile(str(temp), "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        parent_agents = root.parent / "AGENTS.md"
        if not (root / "AGENTS.md").exists() and parent_agents.exists():
            data = parent_agents.read_bytes()
            archive.writestr("Cream/AGENTS.md", data)
            files.append({"path": "AGENTS.md", "bytes": len(data), "sha256": digest(data)})
        for folder, dirs, names in os.walk(str(root), followlinks=False):
            dirs.sort()
            for name in list(dirs):
                candidate = pathlib.Path(folder) / name
                if name in SKIP_DIRS or candidate.is_symlink() or reparse(candidate):
                    excluded.append({"path": candidate.relative_to(root).as_posix(), "reason": "reinstallable dependency/cache or external directory link"})
                    dirs.remove(name)
            for name in sorted(names):
                candidate = pathlib.Path(folder) / name
                rel = candidate.relative_to(root).as_posix()
                if rel == "TRANSFER-MANIFEST.json":
                    continue
                if candidate.resolve() in {output, temp}:
                    continue
                if rel in MACHINE_STATE or name in PROCESS_NAMES or name.endswith((".sqlite-wal", ".sqlite-shm")):
                    excluded.append({"path": rel, "reason": "machine-local runtime state; destination PC starts with a fresh loop"})
                    continue
                if name.startswith(("Cream-other-pc-", "kream-portable-")) and name.endswith((".zip", ".sha256", ".json")):
                    excluded.append({"path": rel, "reason": "older migration archive"})
                    continue
                if name.startswith(".env") or name in SECRET_NAMES or name.endswith((".pem", ".key")):
                    excluded.append({"path": rel, "reason": "credentials/config secret; sign in again on destination PC"})
                    continue
                if name == ".cream-run.lock" or name.endswith((".tmp", ".partial")):
                    excluded.append({"path": rel, "reason": "process-local lock or unfinished temporary file"})
                    continue
                if candidate.is_symlink() or reparse(candidate):
                    excluded.append({"path": rel, "reason": "external file link"})
                    continue
                data = sqlite_snapshot(candidate) if name.endswith(".sqlite") else candidate.read_bytes()
                if rel == "sourcing-runtime.json":
                    data = (json.dumps({"relayRunDir": "kream-runs/pc-relay", "source": "portable-default", "requiresSetup": True}, indent=2) + "\n").encode("utf-8")
                archive.writestr("Cream/" + rel, data)
                files.append({"path": rel, "bytes": len(data), "sha256": digest(data)})
        archive.writestr("Cream/TRANSFER-MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    temp.rename(output)
    result = verify(output)
    result.update({"archive": str(output), "excludedEntries": len(excluded), "uncompressedBytes": sum(row["bytes"] for row in files)})
    output.with_suffix(".zip.sha256").write_text(result["archiveSha256"] + "  " + output.name + "\n", encoding="ascii")
    output.with_suffix(".zip.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--verify", type=pathlib.Path)
    args = parser.parse_args()
    if args.verify:
        result = verify(args.verify.resolve())
    elif args.root and args.output:
        result = pack(args.root, args.output)
    else:
        parser.error("Use --root ROOT --output ZIP, or --verify ZIP")
    print(json.dumps(result, ensure_ascii=False))
