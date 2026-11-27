"""Connect a registered legacy Naver run to its team's existing CLI and dashboard."""
import argparse
import asyncio
import json
import re
import sqlite3
import time
from functools import lru_cache
from urllib.parse import urlsplit
from pathlib import Path

from board import Board
from board_paths import PROJECT
from external_activity import read_object, timestamp, worker_alive
from sourcing_incidents import SHARED_FAILURES, check_pending, incident_channel, route, severity


def installed(board):
    return board.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='naver_runs'").fetchone()


# Verify saved pages rather than counting relay placeholders, denied pages or jobs.
CAPTURE = re.compile(r"dump-(?:K(?P<kream>\d+)|N(?P<product>\d+)-(?P<kind>s2?|cat|prod)(?:-[a-z0-9-]+)?)\.json")


@lru_cache(maxsize=8192)
def capture_ok(file, size, version, kind):
    data = read_object(file)
    if data.get("failed") or data.get("blocked") or not data.get("text") or not timestamp(data.get("at")):
        return False
    try:
        url = urlsplit(data.get("url", ""))
        hostname = url.hostname
    except ValueError:
        return False
    if url.scheme not in (("http","https") if kind == "offer" else ("https",)) or not hostname or re.search(
            r"/(?:login|signin|captcha)(?:[/._-]|$)", url.path, re.I):
        return False
    if kind == "search":
        return hostname == "search.shopping.naver.com" and url.path.rstrip("/") == "/search/all"
    if kind == "kream":
        product = CAPTURE.fullmatch(file.name)["kream"]
        return hostname in ("kream.co.kr","www.kream.co.kr") and url.path.rstrip("/") == "/products/" + product
    return True


def batch_path(folder, name):
    if name == ".":
        return folder
    if not isinstance(name, str) or not re.fullmatch(r"batch-\d{4,}(?:-public)?", name):
        return None
    candidate = folder / name
    return candidate if candidate == candidate.resolve() else None


def captured(folder, live):
    names = [r.get("folder") for r in live.get("completedBatches", []) if isinstance(r, dict)]
    names.append(live.get("activeBatch", "."))
    groups = {k:set() for k in ("kream", "search", "catalog", "offer")}
    artifacts = []
    for label in dict.fromkeys(x for x in names if isinstance(x, str)):
        path = batch_path(folder, label)
        if not path or not path.is_dir():
            continue
        for file in path.glob("dump-*.json"):
            m = CAPTURE.fullmatch(file.name)
            if not m:
                continue
            key = "kream" if m["kream"] else {"s":"search","s2":"search","cat":"catalog","prod":"offer"}[m["kind"]]
            try:
                stat = file.stat()
                ok = capture_ok(file, stat.st_size, stat.st_mtime_ns, key)
            except OSError:
                continue
            if ok:
                groups[key].add(m["kream"] or m["product"])
        filenames = ["final-all.json", *(p.name for p in path.glob("*.xlsx"))]
        artifacts.extend(str((path / filename).relative_to(folder)) for filename in filenames if (path / filename).is_file())
    return {k:len(v) for k,v in groups.items()}, artifacts


def observe(folder, *, now=None, alive=worker_alive):
    now = time.time() if now is None else now
    live = read_object(folder / "naver-live.json")
    if not live:
        return None
    batch = batch_path(folder, live.get("activeBatch", "."))
    driver = read_object(batch / "stage.json") if batch else {}
    stage = str(live.get("stage") or driver.get("stage") or "준비")[:80]
    status = live.get("status")
    reason = str(live.get("reason") or driver.get("error") or "").splitlines()
    reason = reason[0][:170] if reason else ""
    seen = timestamp(live.get("updatedAt")) or timestamp(driver.get("at"))
    critical, recovered = "", False
    if status == "stopped" or (folder / "STOP").exists():
        state, phase, reason = "blocked", "blocked", "중지 신호 수신"
        recovered = True
    elif status in ("blocked", "failed"):
        state, phase = "blocked", "blocked"
        if re.search(r"사전 점검 실패|파싱 (?:오류|실패)|\.mjs 실패|Assertion failed|TypeError|ENOSPC|"
                     r"SQLITE_(?:IOERR|CORRUPT|FULL)|통합 실행[^·]*실패|복구 실패|프로세스 (?:종료|중단)|"
                     r"수집기 (?:비정상 종료|실행 실패)|실행 중단 · driver\.log", reason, re.I):
            critical = "NAVER_RUN_FAILED"
        if severity("", reason):
            critical = "NAVER_RUN_FAILED"
        else:
            named = next((code for code in sorted(SHARED_FAILURES) if re.search(r"\b"+code+r"\b", reason)), "")
            if named:
                critical = named
    elif status in ("completed", "complete", "done"):
        state, phase = "done", "done"
        recovered = True
    elif status == "running":
        process_up = not live.get("pid") or alive({"pid":live.get("pid"),"at":live.get("startedAt")})
        if seen and now - seen < 45 and process_up:
            state = "running"
            recovered = True
            phase = "waiting" if "대기" in stage else "audit" if "감사" in stage else "verify" if any(s in stage for s in ("검증","판정","엑셀")) else "collect"
        else:
            state, phase, reason = "blocked", "blocked", "수집기 응답 지연 · 프로세스 확인 필요"
            if not process_up or (seen and now - seen >= 120):
                critical = "NAVER_COLLECTOR_UNAVAILABLE"
    elif status == "starting":
        state, phase = "ready", "waiting"
        if seen and now - seen > 120:
            state, phase, reason = "blocked", "blocked", "수집기 시작 상태 확인 필요"
            critical = "NAVER_STARTUP_STALLED"
    else:
        state, phase, reason = "blocked", "blocked", "수집기 상태 확인 필요"
    groups, artifacts = captured(folder, live)
    return {"state":state, "phase":phase, "stage": stage, "reason":reason if state=="blocked" else "",
            "critical":critical, "recovered":recovered,
            "target":live.get("target"), "batch":live.get("activeBatch", "."), "completedBatches":len(live.get("completedBatches", [])),
            **groups, "artifacts":artifacts, "sourceAt":seen}


def summary(s):
    text = f"네이버 소싱 · {s['stage']} · 배정 {s['target'] or 0}개, KREAM 자료 {s['kream']}개, 네이버 검색 화면 {s['search']}개"
    if s["catalog"] or s["offer"]:
        text += f", 카탈로그 {s['catalog']}개, 판매처 상세 {s['offer']}개"
    if s["state"]=="blocked":
        text += " · " + (s["reason"] or "확인 필요")
    elif s["state"]=="done":
        text += " · 수집기 종료"
    if s.get("completedBatches"):
        text += f" · 수집기 종료 배치 {s['completedBatches']}건"
    return text


def report_change(old, current):
    if not old or any(current.get(k) != old.get(k) for k in ("stage", "state", "reason", "critical", "batch")):
        return True
    for k in ("search", "kream", "catalog", "offer"):
        previous, count = old.get(k, 0), current[k]
        if previous != count and (previous == 0 or count // 5 > previous // 5 or count == current["target"]):
            return True
    return False


RUN_NAME = re.compile(r"[0-9]{8}-naver-[a-z0-9-]+")


def registered_folder(row):
    saved = Path(row["folder"])
    if saved.is_dir():
        return saved
    prefix, _, run_id = row["id"].partition(":")
    if prefix == "naver" and RUN_NAME.fullmatch(run_id):
        restored = PROJECT / "kream-runs" / run_id
        if read_object(restored / "naver-live.json").get("runId") == run_id:
            return restored
    return saved


def register(board, folder):
    folder = folder.resolve(strict=True)
    if not folder.is_dir() or not RUN_NAME.fullmatch(folder.name):
        raise ValueError("날짜가 포함된 네이버 전용 실행 폴더가 필요합니다.")
    scope = f"naver:{folder.name}"
    with board.write():
        board.db.execute("""CREATE TABLE IF NOT EXISTS naver_runs (
            id TEXT PRIMARY KEY, folder TEXT NOT NULL UNIQUE, card INTEGER NOT NULL REFERENCES cards(id),
            signature TEXT NOT NULL DEFAULT '', snapshot TEXT NOT NULL DEFAULT '{}', audited TEXT NOT NULL DEFAULT '',
            audit_card INTEGER REFERENCES cards(id), updated REAL NOT NULL DEFAULT 0)""")
        prior = board.db.execute("SELECT * FROM naver_runs WHERE id=?", (scope,)).fetchone()
        if prior:
            if Path(prior["folder"]) != folder:
                if (Path(prior["folder"]).exists() or
                        read_object(folder / "naver-live.json").get("runId") != folder.name):
                    raise ValueError("같은 작업 번호의 실행 폴더가 다릅니다.")
                board.db.execute("UPDATE naver_runs SET folder=? WHERE id=?", (str(folder), scope))
            return prior["card"]
        task = ("네이버 가격비교 소싱 운영 · 이 회차는 실무자가 담당합니다. 전용 수집기가 배정한 상품의 원본 기록을 "
                "확인하고 검색·실패·재고 확인·수익 후보를 구분해 현재 결과를 칠판에 요약하세요. "
                "낮은 가격순 상위 3자리, 추천 낮은 가격순 해제, 동일 모델·색상·사이즈, 신뢰 판매처, "
                "판매처 배송비 포함 마진과 동일 상품 옵션 한 행 조건을 검수하세요. "
                "이 폴더의 기존 실행을 관리하고, 중복 수집기를 띄우거나 다른 KREAM 작업의 큐를 조작하지 마세요. "
                "차단 또는 증거 부족 시 이유와 확인된 개수만 보고하세요. 원본 기록 폴더 " + str(folder))
        card = board.submit("naver-source-"+folder.name, "add", text=task)
        board.db.execute("INSERT INTO naver_runs(id,folder,card) VALUES(?,?,?)",(scope,str(folder),card))
        board._post(card,"worker","탐색 접수","네이버 소싱을 별도 수집기로 접수했습니다. 판매처·재고·마진은 실무자가 검수합니다.")
        return card


def sync(board):
    if not installed(board):
        return
    for row in board.db.execute("SELECT * FROM naver_runs").fetchall():
        folder = registered_folder(row)
        if row["updated"] and time.time()-row["updated"]>86400 and json.loads(row["snapshot"]).get("state") in {"done","blocked"}:
            try:
                if (folder / "naver-live.json").stat().st_mtime <= row["updated"]:
                    continue
            except OSError:
                continue
        s = observe(folder)
        if s is None:
            previous = json.loads(row["snapshot"])
            last_seen = previous.get("sourceAt") or row["updated"]
            if not last_seen or previous.get("state") == "done" or time.time() - last_seen < 120:
                continue
            # A vanished ledger cannot prove a stopped/blocked run has recovered.
            if previous.get("state") == "blocked" and previous.get("critical") != "NAVER_LEDGER_MISSING":
                continue
            s = {**previous, "state":"blocked", "phase":"blocked", "stage":"수집기 연결 확인",
                 "reason":"실행 상태 파일 응답 없음", "critical":"NAVER_LEDGER_MISSING", "recovered":False}
        # The chat records concrete progress, not every unchanged heartbeat.
        signature = json.dumps({k:v for k,v in s.items() if k!="sourceAt"},ensure_ascii=False)
        if signature == row["signature"]:
            continue
        with board.write():
            cur = board.db.execute("SELECT * FROM naver_runs WHERE id=?", (row["id"],)).fetchone()
            if cur["signature"] == signature:
                continue
            old = json.loads(cur["snapshot"])
            seq = None
            if report_change(old, s) or s["completedBatches"] > old.get("completedBatches", 0):
                reporter = "auditor" if s["state"] in ("blocked","done") else "worker"
                seq = board._post(cur["card"],reporter,"소싱 현황",summary(s))
            if seq is not None:
                route(board, cur["card"], seq, cur["id"], summary(s), critical=s["critical"], recovered=s["recovered"])
            board.db.execute("UPDATE naver_runs SET signature=?,snapshot=?,updated=? WHERE id=?",
                             (signature,json.dumps(s,ensure_ascii=False),time.time(),cur["id"]))


def context(board, card):
    if not installed(board):
        return None
    row = board.db.execute("SELECT * FROM naver_runs WHERE card=? OR audit_card=?", (incident_channel(board,card) or card,card)).fetchone()
    if not row and board.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sourcing_audit_delivery'").fetchone():
        row = board.db.execute("""SELECT n.* FROM naver_runs n JOIN sourcing_audit_delivery d ON n.card=d.channel
                                  WHERE d.job=? ORDER BY d.alert DESC LIMIT 1""", (card,)).fetchone()
    if not row:
        return None
    folder = registered_folder(row)
    s = observe(folder) or json.loads(row["snapshot"])
    history = board.db.execute("""SELECT role,kind,body FROM entries WHERE card=? AND body!='' AND kind!='progress'
                                  ORDER BY seq DESC LIMIT 8""",(row["card"],)).fetchall()
    return {"workId":row["id"],"channel":row["card"],"sourceDirectory":str(folder),"host":s,
            "recent":[{**dict(r),"body":r["body"][:1200]} for r in reversed(history)]}


def activities(board):
    if not installed(board):
        return []
    out=[]
    for row in board.db.execute("SELECT id,snapshot,updated FROM naver_runs WHERE updated>?",(time.time()-86400,)):
        s=json.loads(row["snapshot"])
        out.append({"id":row["id"],"title":"네이버 가격비교 소싱","state":s["state"],"phase":s["phase"],
                    "detail":summary(s),"updatedAt":int(row["updated"])})
    return out


async def monitor(board):
    while True:
        try:
            sync(board)
            check_pending(board)
        except (OSError,sqlite3.OperationalError) as exc:
            print(f"네이버 소싱 현황 확인 지연 · {exc}", flush=True)
        await asyncio.sleep(5)


if __name__ == "__main__":
    cli=argparse.ArgumentParser()
    cli.add_argument("folder",type=Path)
    args=cli.parse_args()
    board=Board()
    try:
        print(register(board,args.folder))
        sync(board)
    finally:
        board.db.close()
