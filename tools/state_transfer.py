"""Move a stopped, private Windows workspace's data separately from the Git checkout."""

import argparse
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import shutil
import sqlite3
import tempfile
import zipfile
from contextlib import closing

from pack_workspace import digest, reparse, sqlite_snapshot, verify

ROOT = Path(__file__).resolve().parents[1]
RUN = re.compile(r"[0-9]{8}-naver-[a-z0-9-]+")
DAY = re.compile(r"20\d\d-\d\d-\d\d\.md")
LIBRARY_FILES = {"briefing-preferences.sqlite3", "개인정보.md"}
BOARD_DIRS = {"sessions", "work", "public-sourcing", "reports"}
BOARD_FILES = {"board.sqlite3", "widget-position.json", "ai-briefing.json", "literature-briefing.json"}
EXCLUDE = {"auth.json", "credentials.json", "cookies.json", "connection.json", "storage-state.json",
           "process.json", "watchdog-process.json", "window-profile", "heartbeats", "__pycache__", ".git",
           "node_modules", "auto-recover.enabled", "autorun.enabled"}
MANIFEST = "Cream/TRANSFER-MANIFEST.json"
reserved_name = getattr(os.path, "isreserved", lambda s: PureWindowsPath(s).is_reserved())


def library_dir():
    return Path(os.environ.get("APPDATA") or Path.home() / "AppData/Roaming") / "Agent Mission Control/Personal Library"


def eligible(parts):
    if any(p.lower() in EXCLUDE or p.startswith(".") for p in parts):
        return False
    name = parts[-1].lower()
    if name == "daily-report.enabled":
        return True
    return not name.endswith((".lock", ".pid", ".log", ".tmp", ".enabled", ".heartbeat", "-wal", "-shm",
                              ".key", ".pem", ".exe", ".cmd", ".bat", ".ps1", ".dll"))


def target(group, root, library):
    if group == "board":
        return root / "runs/team-board"
    if group == "no1":
        return root / "kream-runs/agent-teams"
    if group == "reports":
        return root / "상품탐색결과"
    if group == "library":
        return library
    if RUN.fullmatch(group):
        return root / "kream-runs" / group
    raise ValueError(f"Unknown data group: {group}")


def member(key):
    parts = PurePosixPath(key).parts
    if (len(parts) < 2 or "/".join(parts) != key or any(p in (".", "..", "/") or
        any(c in p for c in '\\:*?"<>|') or p.endswith((".", " ")) or reserved_name(p)
        for p in parts) or not eligible(parts)):
        raise ValueError(f"Invalid private data path: {key}")
    group, *rest = parts
    if group == "policy" and rest == ["sourcing-policy.json"]:
        return parts
    if group == "board" and (rest[0] in BOARD_DIRS or (len(rest) == 1 and rest[0] in BOARD_FILES)):
        return parts
    if group == "library" and len(rest) == 1 and rest[0] in LIBRARY_FILES:
        return parts
    if group == "reports" and len(rest) == 2 and DAY.fullmatch(rest[1]) and rest[0] == rest[1][:7]:
        return parts
    if group == "no1" or RUN.fullmatch(group):
        return parts
    raise ValueError(f"Unsupported private data path: {key}")


def walk(base):
    if base.is_symlink() or reparse(base):
        raise ValueError(f"External data link: {base}")
    for here, folders, names in os.walk(base):
        folder = Path(here)
        folders[:] = sorted(d for d in folders if eligible([d]) and not reparse(folder / d)
                            and not (folder / d).is_symlink())
        for name in sorted(names):
            f = folder / name
            if eligible([name]) and not f.is_symlink() and not reparse(f):
                yield f


def inventory(args):
    if args.board.is_dir():
        for name in sorted(BOARD_FILES | BOARD_DIRS):
            start = args.board / name
            for f in walk(start) if start.is_dir() else ([start] if start.is_file() else []):
                yield "board/" + f.relative_to(args.board).as_posix(), f
    if args.teams.is_dir():
        for f in walk(args.teams):
            yield "no1/" + f.relative_to(args.teams).as_posix(), f
    for d in sorted(args.naver_root.glob("*-naver-*")):
        if RUN.fullmatch(d.name) and d.is_dir() and (d / "naver-live.json").is_file():
            state = json.loads((d / "naver-live.json").read_text(encoding="utf-8-sig"))
            if state.get("status") not in ("stopped", "completed", "complete", "done") and not (d / "STOP").is_file():
                raise ValueError(f"Stop this Naver run before exporting: {d.name}")
            for f in walk(d):
                yield d.name + "/" + f.relative_to(d).as_posix(), f
    for f in sorted(args.reports.glob("20??-??/20??-??-??.md")):
        yield "reports/" + f.relative_to(args.reports).as_posix(), f
    for name in sorted(LIBRARY_FILES):
        f = args.library / name
        if f.is_file():
            yield "library/" + name, f
    if args.policy.is_file():
        yield "policy/sourcing-policy.json", args.policy


def check_board(db):
    with closing(sqlite3.connect(db.as_uri() + "?mode=ro", uri=True)) as c:
        for table in ("cards", "contracts"):
            if c.execute(f"SELECT count(*) FROM {table} WHERE state IN ('ready','running')").fetchone()[0]:
                raise ValueError("Stop active board work before transferring.")


def export(args):
    out = args.archive.resolve()
    if out.exists():
        raise FileExistsError(out)
    if (args.board / "board.sqlite3").is_file():
        check_board((args.board / "board.sqlite3").resolve())
    out.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    with tempfile.TemporaryDirectory(dir=out.parent) as staging:
        temp = Path(staging) / "data.zip"
        with zipfile.ZipFile(temp, "x", zipfile.ZIP_DEFLATED, compresslevel=1) as z:
            for key, f in inventory(args):
                member(key)
                if f.resolve() != f.absolute() or reparse(f):
                    raise ValueError(f"External data path: {f}")
                data = sqlite_snapshot(f) if f.suffix in (".sqlite", ".sqlite3") else f.read_bytes()
                z.writestr("Cream/" + key, data)
                rows.append({"path": key, "bytes": len(data), "sha256": digest(data)})
            if not rows:
                raise ValueError("No state files were found.")
            z.writestr(MANIFEST, json.dumps({"version": "cream-private-state-v1", "files": rows}, ensure_ascii=False))
        info = verify(temp)
        temp.rename(out)
    return info


def restore(args):
    root, library = args.dest.resolve(), args.library.resolve()
    if not (root / "automation/team-board/board.py").is_file():
        raise ValueError("Restore into a Cream checkout.")
    result = verify(args.archive)
    with zipfile.ZipFile(args.archive) as z, tempfile.TemporaryDirectory() as staging:
        manifest = json.loads(z.read(MANIFEST))
        if manifest.get("version") != "cream-private-state-v1":
            raise ValueError("Not a private state transfer archive.")
        files = []
        seen = set()
        for row in manifest["files"]:
            group, *rest = member(row["path"])
            base = root if group == "policy" else target(group, root, library)
            f = base.joinpath(*rest)
            if f.resolve() != f or f in seen or f.exists():
                raise ValueError(f"Restore before first launch into empty data locations. Conflict: {f}")
            seen.add(f)
            files.append((row["path"], f))
        # Rebind operational absolute paths in a private copy. Archived chat and evidence stay verbatim.
        board_copy = None
        if any(key == "board/board.sqlite3" for key, _ in files):
            board_copy = Path(staging) / "board.sqlite3"
            board_copy.write_bytes(z.read("Cream/board/board.sqlite3"))
            check_board(board_copy)
            with closing(sqlite3.connect(board_copy)) as db:
                if db.execute("SELECT 1 FROM sqlite_master WHERE name='naver_runs'").fetchone():
                    for run_id, in list(db.execute("SELECT id FROM naver_runs")):
                        label = run_id.removeprefix("naver:")
                        if not RUN.fullmatch(label) or target(label, root, library) / "naver-live.json" not in seen:
                            raise ValueError(f"Missing registered Naver run: {label}")
                        db.execute("UPDATE naver_runs SET folder=? WHERE id=?", (str(target(label, root, library)), run_id))
                db.commit()
                db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        created = []
        try:
            for key, f in files:
                f.parent.mkdir(parents=True, exist_ok=True)
                with f.open("xb") as dest:
                    created.append(f)
                    if key == "board/board.sqlite3":
                        with board_copy.open("rb") as src:
                            shutil.copyfileobj(src, dest)
                    else:
                        with z.open("Cream/" + key) as src:
                            shutil.copyfileobj(src, dest)
        except BaseException:
            for f in reversed(created):
                f.unlink(missing_ok=True)
            raise
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    exp = sub.add_parser("export")
    for name, default in (("board", ROOT / "runs/team-board"), ("teams", ROOT / "kream-runs/agent-teams"),
                          ("naver-root", ROOT / "kream-runs"), ("reports", ROOT / "상품탐색결과"),
                          ("policy", ROOT / "sourcing-policy.json")):
        exp.add_argument("--" + name, type=Path, default=default)
    imp = sub.add_parser("restore")
    imp.add_argument("--dest", type=Path, default=ROOT)
    for p in (exp, imp):
        p.add_argument("--library", type=Path, default=library_dir())
    for p in (exp, imp, sub.add_parser("verify")):
        p.add_argument("archive", type=Path)
    args = parser.parse_args()
    for key, value in vars(args).items():
        if isinstance(value, Path):
            setattr(args, key, value.resolve())
    result = export(args) if args.command == "export" else restore(args) if args.command == "restore" else verify(args.archive)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
