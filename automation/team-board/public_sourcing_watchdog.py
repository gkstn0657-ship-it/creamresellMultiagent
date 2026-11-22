"""Supervise the existing public sourcing dispatcher without submitting board work."""
import argparse
import http.client
import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
from contextlib import closing
from pathlib import Path
from uuid import UUID

from agents import RunnerLock
from board import DEFAULT_DATA
from dashboard import PORT, board_key
from public_sourcing import STATE_DIR, atomic_json


DISPATCHER = Path(__file__).resolve().with_name("public_sourcing.py")
INTERVAL = 15
BACKOFF = (30, 90, 300, 1800)
STALL_SECONDS = 1800


def read_json(path):
    try:
        return json.loads(path.read_text("utf-8-sig"))
    except FileNotFoundError:
        return {}


def lock_held(directory):
    if not (directory / "runner.lock").exists():
        return False
    try:
        with RunnerLock(directory):
            return False
    except RuntimeError:
        return True


def owner_pid(script, actions):
    # Advisory display only. The process's OS lock authorizes adoption/start.
    try:
        import psutil
    except ImportError:
        return None
    for process in psutil.process_iter(["name"]):
        if not (process.info.get("name") or "").lower().startswith("python"):
            continue
        try:
            args = process.cmdline()
            if (len(args) >= 3 and args[-1] in actions and any(
                    a.endswith(script.name) and Path(a).is_absolute() and Path(a).resolve() == script
                    for a in args[1:-1])):
                if args[-1] == "public-worker" and "--data-dir" in args:
                    if Path(args[args.index("--data-dir")+1]).resolve() != DEFAULT_DATA.resolve():
                        continue
                return process.pid
        except (psutil.Error, OSError):
            continue
    return None


def board_health():
    try:
        with closing(http.client.HTTPConnection("127.0.0.1", PORT, timeout=2)) as client:
            client.request("GET", "/api/health")
            with client.getresponse() as response:
                if response.status != 200:
                    return "foreign"
                value = json.loads(response.read(16_384))
        return ("online" if isinstance(value, dict) and value.get("app") == "team-board"
                and value.get("board") == board_key(DEFAULT_DATA.resolve()) else "foreign")
    except ConnectionRefusedError:
        return "absent"
    except (ValueError, OSError, http.client.HTTPException):
        return "unresponsive"


def restore_board():
    from window import ensure_server
    ensure_server(DEFAULT_DATA.resolve(), PORT)


def launch(directory, role):
    if role == "dispatcher":
        args = [str(DISPATCHER), "run"]
    else:
        args = [str(DISPATCHER.with_name("dashboard.py")), "--data-dir", str(directory.parent), "public-worker"]
    with (directory / f"{role}.log").open("ab") as log:
        return subprocess.Popen(
            [sys.executable, "-X", "utf8", *args],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            stdin=subprocess.DEVNULL, stdout=log, stderr=log)


def public_progress(directory):
    queue = read_json(directory / "state.json")
    db = directory.parent / "board.sqlite3"
    latest = 0
    active = []
    if db.is_file():
        with closing(sqlite3.connect(db.resolve().as_uri() + "?mode=ro", uri=True, timeout=2)) as con:
            latest = con.execute("""
                SELECT COALESCE(MAX(e.seq), 0) FROM entries e WHERE e.card IN
                  (SELECT card FROM submissions WHERE request_id GLOB 'public-weekly-*')
                """).fetchone()[0]
            active = [dict(id=i, state=s, stage=t) for i,s,t in con.execute("""
                SELECT c.id,c.state,c.stage FROM cards c WHERE c.state != 'done' AND c.id IN
                  (SELECT card FROM submissions WHERE request_id GLOB 'public-weekly-*')
                ORDER BY c.id""")]
    return dict(day=queue.get("day"), nextRank=queue.get("nextRank"), completed=len(queue.get("seen", [])),
                phase=queue.get("phase"), exhausted=bool(queue.get("exhausted")), event=latest, cards=active)


class No1Monitor:
    def __init__(self, work_id, directory):
        self.work_id, self.directory = work_id, directory
        self.thread = None
        self.last = 0
        self.result = None

    def poll(self, now):
        if not self.work_id or (self.directory / "STOP").exists():
            return
        if (self.thread and self.thread.is_alive()) or now - self.last < 120:
            return
        def check():
            try:
                from no1_recovery import check as check_work
                if not (self.directory / "STOP").exists():
                    self.result = str(check_work(self.work_id, self.directory))[:500]
            except Exception as exc:
                self.result = type(exc).__name__
            finally:
                self.last = time.time()
        self.last = now
        self.thread = threading.Thread(target=check, daemon=True)
        self.thread.start()


class Supervisor:
    def __init__(self, directory, previous):
        self.directory = directory
        self.state = dict(previous)
        self.state.update(pid=os.getpid(), dispatcherPid=None, workerPid=None, heartbeat=0)
        self.children = {}

    def delay(self, target, now):
        key = target + "Attempts"
        count = self.state.get(key, 0)
        self.state[key] = count + 1
        self.state[target + "RetryAt"] = now + BACKOFF[min(count, len(BACKOFF) - 1)]

    def supervise(self, role, now, online):
        state = self.state
        child = self.children.get(role)
        if child and child.poll() is not None:
            state[role + "LastExit"] = child.returncode
            self.children.pop(role)
            child = None
        guard = self.directory if role == "dispatcher" else self.directory / "worker"
        held = lock_held(guard)
        state[role + "LockHeld"] = held
        pid = child.pid if child else None
        if held and not pid:
            script = DISPATCHER if role == "dispatcher" else DISPATCHER.with_name("dashboard.py")
            actions = {"run", "resume"} if role == "dispatcher" else {"public-worker"}
            pid = owner_pid(script, actions)
        state[role + "Pid"] = pid
        if held or child:
            return "monitoring"
        if not online or now < state.get(role + "RetryAt", 0):
            return "cooldown"
        if (self.directory / "STOP").exists():
            return "stopped"
        self.delay(role, now)
        self.children[role] = launch(self.directory, role)
        state[role + "Pid"] = self.children[role].pid
        state[role + "TotalStarts"] = state.get(role + "TotalStarts", 0) + 1
        return "starting"

    def tick(self, now):
        state = self.state
        state.update(heartbeat=now, stopRequested=(self.directory / "STOP").exists())
        if state["stopRequested"]:
            state["status"] = "stopped"
            return False
        progress = public_progress(self.directory)
        if state.get("progress") != progress or not state.get("lastProgress"):
            state.update(progress=progress, lastProgress=now)
            for role in ("dispatcher", "worker"):
                if state.get(role + "LockHeld"):
                    state[role + "Attempts"] = state[role + "RetryAt"] = 0
        state["stalled"] = (any(c["state"] in {"ready", "running"} for c in progress["cards"])
                            and now - state["lastProgress"] >= STALL_SECONDS)
        health = board_health()
        state["board"] = health
        for role in ("dispatcher", "worker"):
            state[role + "Status"] = self.supervise(role, now, health == "online")
        if health != "online":
            state["status"] = "board_" + health
            if (health == "absent" and now >= state.get("boardRetryAt", 0)
                    and not lock_held(self.directory.parent) and not (self.directory / "STOP").exists()):
                self.delay("board", now)
                restore_board()
            return True
        state.update(boardAttempts=0, boardRetryAt=0)
        state["status"] = "observing_stall" if state["stalled"] else "monitoring"
        return True


def run(directory, *, resume=False, no1_work=None):
    guard = directory / "watchdog"
    guard.mkdir(parents=True, exist_ok=True)
    path = guard / "status.json"
    with RunnerLock(guard):
        if resume:
            (directory / "STOP").unlink(missing_ok=True)
        monitor = No1Monitor(no1_work, directory)
        try:
            previous = read_json(path)
        except (ValueError, UnicodeError):
            previous = {}
        supervisor = Supervisor(directory, previous if isinstance(previous, dict) else {})
        while True:
            now = time.time()
            try:
                running = supervisor.tick(now)
                supervisor.state.pop("error", None)
            except (OSError, ValueError, RuntimeError, KeyError, sqlite3.Error, subprocess.SubprocessError) as exc:
                running = not (directory / "STOP").exists()
                supervisor.state.update(status="watch_error", error=str(exc)[:400], heartbeat=now)
            if running:
                monitor.poll(now)
            supervisor.state.update(no1Work=no1_work, no1Status=monitor.result)
            try:
                atomic_json(path, supervisor.state)
            except OSError as exc:
                if sys.stderr:
                    print(f"Watchdog status: {exc}", file=sys.stderr, flush=True)
            if not running:
                return
            for _ in range(INTERVAL):
                if (directory / "STOP").exists():
                    break
                time.sleep(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("run", "resume", "status", "stop"))
    parser.add_argument("--no1-work", metavar="work-UUID")
    args = parser.parse_args()
    if args.no1_work:
        try:
            if args.no1_work != "work-" + str(UUID(args.no1_work.removeprefix("work-"))):
                raise ValueError
        except ValueError:
            parser.error("--no1-work requires an existing work-UUID")
    if args.action in {"run", "resume"}:
        run(STATE_DIR, resume=args.action == "resume", no1_work=str(args.no1_work) if args.no1_work else None)
    elif args.action == "stop":
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        (STATE_DIR / "STOP").touch()
    else:
        state = read_json(STATE_DIR / "watchdog" / "status.json")
        state.update(watchdogLockHeld=lock_held(STATE_DIR / "watchdog"), workerLockHeld=lock_held(STATE_DIR / "worker"),
                     dispatcherLockHeld=lock_held(STATE_DIR), stopRequested=(STATE_DIR / "STOP").exists())
        print(json.dumps(state, ensure_ascii=False))


if __name__ == "__main__":
    main()
