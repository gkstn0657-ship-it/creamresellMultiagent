"""Read the local KREAM work ledger without starting or changing a work order."""

import json
import os
import re
import threading
import time
from datetime import datetime
from pathlib import Path

from board import DEFAULT_DATA
from board_paths import ledger_directories


ORDER = re.compile(r"work-[0-9a-f-]{36}")
BATCH = re.compile(r"batch-[0-9a-f-]{36}")
ACTIVE = {"starting", "discovering", "running_batch", "recovering", "collecting", "judging", "prefetching"}
WAITING = {"ready", "prefetched"}
RECENT = 24 * 3600


def roots_for_board(directory):
    if Path(directory).resolve() != DEFAULT_DATA.resolve():
        return ()
    return ledger_directories()


def read_object(path):
    try:
        with path.open(encoding="utf-8-sig") as stream:
            data = json.load(stream)
        return data if isinstance(data, dict) else {}
    except (OSError, UnicodeError, ValueError, RecursionError):
        return {}


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.timestamp() if parsed.tzinfo else 0
    except (AttributeError, ValueError, OSError, OverflowError):
        return 0


def worker_alive(record):
    pid = record.get("pid")
    launched = timestamp(record.get("at") or record.get("launchedAt"))
    if type(pid) is not int or not 0 < pid < 2**32 or not launched:
        return False
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            identity = Path(f"/proc/{pid}/comm")
            if identity.exists() and identity.read_text().strip() not in {"node", "nodejs"}:
                return False
            return True
        except (OSError, OverflowError):
            return False
    # A zero-signal os.kill can terminate a Windows process. Use read-only handles
    # and reject a recycled PID whose process started after the saved launch.
    import ctypes
    from ctypes import wintypes
    api = ctypes.WinDLL("kernel32", use_last_error=True)
    api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    api.OpenProcess.restype = wintypes.HANDLE
    api.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    api.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    api.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    api.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = api.OpenProcess(0x00100000 | 0x1000, False, pid)
    if not handle:
        return False
    try:
        times = [wintypes.FILETIME() for _ in range(4)]
        if api.WaitForSingleObject(handle, 0) != 258 or not api.GetProcessTimes(handle, *(ctypes.byref(t) for t in times)):
            return False
        size = wintypes.DWORD(1024)
        image = ctypes.create_unicode_buffer(size.value)
        if not api.QueryFullProcessImageNameW(handle, 0, image, ctypes.byref(size)) or Path(image.value).name.lower() != "node.exe":
            return False
        birth = ((times[0].dwHighDateTime << 32) + times[0].dwLowDateTime) / 10000000 - 11644473600
        return birth <= launched + 2
    finally:
        api.CloseHandle(handle)


def activity(root, file, now, alive):
    work = read_object(file)
    work_id = file.stem
    if work.get("id") != work_id or work.get("status") not in {"open", "complete"}:
        return None
    folder = root / "explorations" / work_id
    path = folder / "state.json"
    state = read_object(path)
    if path.exists() and (not state or state.get("workId") != work_id):
        return None
    entries = work.get("entries")
    if not isinstance(entries, list):
        return None
    last = entries[-1] if entries and isinstance(entries[-1], dict) else {}
    batch_id = state.get("currentRunId") or last.get("runId")
    batch = {}
    batch_dir = None
    if isinstance(batch_id, str) and BATCH.fullmatch(batch_id):
        batch_dir = root / batch_id
        if read_object(batch_dir / "launch.json").get("workId") == work_id:
            batch_file = batch_dir / "batch-state.json"
            batch = read_object(batch_file)
            if batch_file.exists() and not batch and not state:
                return None
    if (state.get("mode") or batch.get("mode") or "live") != "live":
        return None
    phase = state.get("status") or batch.get("status") or ("complete" if work["status"] == "complete" else "ready")
    updated = max(timestamp(work.get("createdAt")), timestamp(last.get("at")),
                  *(timestamp(obj.get(key)) for obj in (state, batch)
                    for key in ("startedAt", "updatedAt", "finishedAt", "heartbeatAt", "collectionFinishedAt")))
    if not updated or updated > now + 60:
        return None
    target = work.get("targetSources") or work.get("targetProfitableProducts") or work.get("targetProducts")
    name = "무신사 랭킹 탐색" if work.get("scopeMode") in ("profitable-results", "inspected-sources") else "KREAM 상품 탐색"
    title = name + (" · 연속" if work.get("continuous") else (f" · {target}개" if type(target) is int else ""))
    if phase == "stopped":
        return None
    if phase in ACTIVE:
        process_file = (folder if state else batch_dir) / "process.json"
        record = read_object(process_file)
        # Before the parent has finished publishing its PID, a recent start is
        # queued. Only a verified live worker or explicit heartbeat is running.
        beat = timestamp(state.get("heartbeatAt") or batch.get("heartbeatAt"))
        if alive(record) or (not record and 0 <= now - beat < 20):
            status = "running"
            times = [path] if state else []
            if batch and batch_dir:
                times.append(batch_dir / "batch-state.json")
            for item in times:
                try:
                    updated = max(updated, min(now, item.stat().st_mtime))
                except OSError:
                    pass
            detail = "상품별 수익성 검토 중" if batch.get("status") == "judging" else "후보와 판매처 자료를 확인 중"
        elif not record and 0 <= now - updated < 20:
            status, detail = "ready", "백그라운드 실행 준비 중"
        else:
            status, detail = "blocked", "탐색 실행이 중단되어 확인이 필요합니다."
    elif phase == "complete":
        reserved = sum(e["productCount"] for e in entries
                       if isinstance(e, dict) and type(e.get("productCount")) is int)
        if not state and type(target) is int and reserved < target:
            status, detail = "ready", f"다음 배치 대기 · {reserved}/{target}개 배정"
        else:
            status, detail = "done", "상품 탐색과 판정 완료"
    elif phase in {"needs_attention", "source_exhausted", "blocked", "interrupted"}:
        error = str(state.get("error") or batch.get("error") or "")
        if "NO1_AUTH_REQUIRED" in error:
            detail = "Onebox 백그라운드 연결 인증 필요"
        elif "NO1_BRIDGE" in error:
            detail = "Onebox 백그라운드 연결 확인 필요"
        elif phase == "source_exhausted":
            detail = "조회 가능한 후보를 모두 확인했습니다."
        else:
            detail = "백그라운드 탐색 확인 필요"
        status = "blocked"
    elif phase in WAITING:
        status, detail = "ready", "탐색 대기 중"
    else:
        return None
    if status != "running" and now - updated > RECENT:
        return None
    motion = {"ready":"waiting", "blocked":"blocked", "done":"done"}.get(status)
    if motion is None:
        motion = "verify" if batch.get("status") == "judging" or phase == "judging" else "collect"
    return {"id":work_id, "title":title, "state":status, "phase":motion, "detail":detail, "updatedAt":int(updated)}


class ExternalActivityFeed:
    def __init__(self, roots, *, alive=worker_alive):
        self.roots = roots
        self.alive = alive
        self.lock = threading.Lock()
        self.expires = 0
        self.rows = []

    def snapshot(self):
        if not self.roots:
            return []
        with self.lock:
            if time.monotonic() < self.expires:
                return self.rows
            now = time.time()
            by_id = {}
            for root in self.roots:
                for file in (root / "work-orders").glob("work-*.json"):
                    if not ORDER.fullmatch(file.stem):
                        continue
                    state_path = root / "explorations" / file.stem / "state.json"
                    try:
                        if max(file.stat().st_mtime, state_path.stat().st_mtime if state_path.exists() else 0) < now - RECENT:
                            continue
                        row = activity(root, file, now, self.alive)
                    except (OSError, TypeError, ValueError):
                        continue
                    if row and row["updatedAt"] > by_id.get(row["id"], {}).get("updatedAt", 0):
                        by_id[row["id"]] = row
            self.rows = sorted(by_id.values(), key=lambda row: row["updatedAt"], reverse=True)
            self.expires = time.monotonic() + 10
            return self.rows
