"""Assign one review per uninterrupted operational incident on a sourcing channel."""
import re


def install_observer(board):
    """Observe committed worker events from every writer, even when no UI is open."""
    with board.write():
        board.db.execute("""CREATE TABLE IF NOT EXISTS morgan_observation(
            slot INTEGER PRIMARY KEY CHECK(slot=1), seq INTEGER NOT NULL REFERENCES entries(seq), observed REAL NOT NULL)""")
        board.db.execute("""CREATE TRIGGER IF NOT EXISTS morgan_observe_james AFTER INSERT ON entries
            WHEN NEW.role='worker'
            BEGIN INSERT INTO morgan_observation VALUES(1, NEW.seq, (julianday('now')-2440587.5)*86400)
            ON CONFLICT(slot) DO UPDATE SET seq=excluded.seq,observed=excluded.observed; END""")
        board.db.execute("""INSERT INTO morgan_observation
            SELECT 1,seq,(julianday('now')-2440587.5)*86400 FROM entries WHERE role='worker' ORDER BY seq DESC LIMIT 1
            ON CONFLICT(slot) DO UPDATE SET seq=excluded.seq, observed=excluded.observed WHERE excluded.seq>morgan_observation.seq""")


def observation(board):
    row = board.db.execute("""SELECT e.seq,e.card,e.kind,e.at,o.observed AS observedAt FROM morgan_observation o
                              JOIN entries e ON e.seq=o.seq WHERE o.slot=1""").fetchone()
    return dict(row) if row else None


def severity(code, message):
    if re.search(r"SQLITE_(?:CORRUPT|NOTADB)|\b(?:DB|DATA|LEDGER)[_ -]CORRUPT(?:ION|ED)?\b|"
                 r"무결성\s*(?:오류|실패|훼손)|(?:데이터|원본|장부|DB)\s*(?:파일\s*)?손상", message, re.I):
        return "데이터 무결성 손상"
    if code == "BATCH_OUTSIDE_WORK":
        return "배정 범위 밖의 배치가 연결됨"
    if code in {"BATCH_RETRY_LIMIT","REPEATED_RECOVERY_FAILURE"} or re.search(
            r"복구\s*(?:연속\s*)?(?:[2-9]|\d{2,})\s*회\s*실패|복구가?\s*반복\s*실패", message):
        return "반복 복구 실패"
    if code in {"MULTI_WORK_IMPACT","MULTIPLE_WORKERS_FAILED"}:
        return "여러 업무에 영향을 주는 장애"
    return ""


def deliver_escalations(board):
    """Preserve active CLI claims and hand over the same case after the turn settles."""
    if not board.db.execute("SELECT 1 FROM sqlite_master WHERE name='sourcing_escalations'").fetchone():
        return
    for esc in board.db.execute("""SELECT e.job,e.requested,e.reason,c.stage,c.state FROM sourcing_escalations e
            JOIN cards c ON c.id=e.job WHERE e.delivered IS NULL""").fetchall():
        job = esc["job"]
        if board._consultation(job):
            continue
        if esc["stage"] != "auditor" and (esc["state"] == "running" or (esc["stage"],esc["state"]) == ("worker","ready")):
            continue
        already_assigned = esc["stage"] == "auditor" and esc["state"] in ("ready","running")
        decision = board.db.execute("""SELECT seq FROM entries WHERE card=? AND seq>=? AND role='auditor'
            AND kind IN ('close','revise','blocked') ORDER BY seq DESC LIMIT 1""", (job,esc["requested"])).fetchone()
        if already_assigned or decision:
            event = decision["seq"] if decision else esc["requested"]
        else:
            event = board._post(job, "reviewer", "escalate", f"모건에게 핵심 예외를 전달합니다. {esc['reason']}")
            board._set(job,"auditor","ready")
        board.db.execute("UPDATE sourcing_escalations SET delivered=? WHERE job=?", (event,job))


def check_pending(board):
    # Usually there is no intervention. Avoid reserving a write lock on every monitor tick.
    if not board.db.execute("SELECT 1 FROM sqlite_master WHERE name='sourcing_escalations'").fetchone():
        return
    if board.db.execute("""SELECT 1 FROM sourcing_escalations e JOIN cards c ON c.id=e.job
            WHERE e.delivered IS NULL AND (c.stage='auditor' OR
            (c.state!='running' AND NOT (c.stage='worker' AND c.state='ready'))) LIMIT 1""").fetchone():
        with board.write():
            deliver_escalations(board)


SHARED_FAILURES = {"WATCHDOG_POLL_FAILED","WATCHDOG_UNRESPONSIVE","RELAY_CRASHED","RELAY_NOT_RUNNING",
                   "SQLITE_FULL","SQLITE_IOERR","ENOSPC"}


def maybe_escalate(board, channel, job, seq, code, message):
    reason = severity(code, message)
    peers = []
    if code in SHARED_FAILURES:
        peers = [r[0] for r in board.db.execute(
            "SELECT job FROM sourcing_incidents WHERE channel!=? AND code=? AND resolved IS NULL", (channel,code))]
        if peers:
            reason = f"동시에 열린 업무 {len(peers)+1}건에서 같은 시스템 오류 {code} 확인"
    if not reason:
        return
    board.db.execute("""CREATE TABLE IF NOT EXISTS sourcing_escalations(
        job INTEGER PRIMARY KEY REFERENCES cards(id), requested INTEGER NOT NULL REFERENCES entries(seq),
        reason TEXT NOT NULL, delivered INTEGER REFERENCES entries(seq))""")
    if peers:
        # Keep a shared incident together while any affected source remains open.
        # Recovering the original lead must not dispatch the same outage again.
        board.db.execute("""CREATE TABLE IF NOT EXISTS sourcing_shared_impacts(
            job INTEGER NOT NULL REFERENCES cards(id), code TEXT NOT NULL, lead INTEGER NOT NULL REFERENCES cards(id),
            PRIMARY KEY(job,code))""")
        group = board.db.execute("""SELECT s.lead FROM sourcing_shared_impacts s
                JOIN sourcing_incidents i ON i.job=s.job AND i.code=s.code
                WHERE i.resolved IS NULL AND i.code=? ORDER BY s.lead LIMIT 1""", (code,)).fetchone()
        lead = group["lead"] if group else job
        board.db.executemany("INSERT OR IGNORE INTO sourcing_shared_impacts(job,code,lead) VALUES(?,?,?)",
                             [(member,code,lead) for member in [*peers,job]])
        if lead != job:
            return
        reason += " · 관련 장애 업무 " + ", ".join(f"#{peer}" for peer in peers)
    added = board.db.execute("INSERT OR IGNORE INTO sourcing_escalations(job,requested,reason) VALUES(?,?,?)",
                             (job,seq,reason)).rowcount
    if added:
        board._post(channel,"auditor","핵심 예외", f"업무 #{job} · {reason}")
    deliver_escalations(board)


def incident_channel(board, job):
    if not board.db.execute("SELECT 1 FROM sqlite_master WHERE name='sourcing_incidents'").fetchone():
        return None
    row = board.db.execute("SELECT channel FROM sourcing_incidents WHERE job=?", (job,)).fetchone()
    return row[0] if row else None


def route(board, channel, seq, work_id, message, *, critical="", recovered=False):
    """The producer holds board.write(); a new fault after recovery is a new episode."""
    if not critical and not recovered:
        return
    if not critical and not board.db.execute("SELECT 1 FROM sqlite_master WHERE name='sourcing_incidents'").fetchone():
        return
    board.db.execute("""CREATE TABLE IF NOT EXISTS sourcing_incidents (
        first_seq INTEGER PRIMARY KEY REFERENCES entries(seq), channel INTEGER NOT NULL REFERENCES cards(id),
        job INTEGER NOT NULL UNIQUE REFERENCES cards(id), code TEXT NOT NULL, resolved INTEGER REFERENCES entries(seq))""")
    board.db.execute("""CREATE UNIQUE INDEX IF NOT EXISTS sourcing_incident_open
                        ON sourcing_incidents(channel) WHERE resolved IS NULL""")
    board.db.execute("""CREATE TRIGGER IF NOT EXISTS morgan_incident_resolution AFTER INSERT ON entries
        WHEN NEW.role='auditor' AND NEW.kind IN ('close','revise','blocked')
        BEGIN INSERT INTO entries(card,at,role,kind,body)
        SELECT channel,NEW.at,NEW.role,'감사 응답','#' || NEW.card || ' · ' || NEW.body
        FROM sourcing_incidents WHERE job=NEW.card; END""")
    active = board.db.execute("SELECT * FROM sourcing_incidents WHERE channel=? AND resolved IS NULL", (channel,)).fetchone()
    if recovered:
        if active:
            job = active["job"]
            board.db.execute("UPDATE sourcing_incidents SET resolved=? WHERE job=?", (seq, job))
            board._post(job, "auditor", "감시 결과", message)
            # A recovered unclaimed incident has nothing left for the reviewer to do.
            card = board._get(job)
            if card["stage"]=="reviewer" and card["state"]=="ready" and not board._consultation(job) and not board.db.execute(
                    "SELECT 1 FROM entries WHERE card=? AND (kind='start' OR (role='user' AND kind='note'))", (job,)).fetchone():
                board._set(job, "reviewer", "done")
            deliver_escalations(board)
        return
    if active:
        if active["code"] != critical:
            board.db.execute("UPDATE sourcing_incidents SET code=? WHERE job=?", (critical,active["job"]))
            board._post(active["job"], "auditor", "장애 상태", message)
        maybe_escalate(board,channel,active["job"],seq,critical,message)
        return
    if board.db.execute("SELECT 1 FROM sourcing_incidents WHERE first_seq=?", (seq,)).fetchone():
        return
    instruction = (f"중요 시스템 장애 · {work_id} · 원 업무 #{channel}. {message}\n"
                   "감시 원본과 기존 복구 시도를 확인하세요. 복구됐으면 조치 결과를 마감하고, "
                   "수정이 필요하면 같은 카드에서 제임스에게 맡기세요. 사용자 중지와 기존 작업 범위를 지키세요.")
    job = board.db.execute("INSERT INTO cards(request,stage,state) VALUES(?,'reviewer','ready')", (instruction,)).lastrowid
    board.db.execute("INSERT INTO sourcing_incidents(first_seq,channel,job,code) VALUES(?,?,?,?)", (seq,channel,job,critical))
    board._post(job, "auditor", "장애 수신", message)
    if not severity(critical, message):
        board._post(channel, "reviewer", "장애 배정", f"클레어에게 시스템 장애를 전달했습니다. 업무 #{job}.")
    maybe_escalate(board,channel,job,seq,critical,message)
    board.db.execute("""CREATE TRIGGER IF NOT EXISTS sourcing_incident_report AFTER INSERT ON entries
        WHEN NEW.kind IN ('submit','approve','revise') AND NEW.role IN ('worker','reviewer')
        BEGIN INSERT INTO entries(card,at,role,kind,body)
        SELECT channel,NEW.at,NEW.role,'조치 경과','#' || NEW.card || ' · ' || NEW.body
        FROM sourcing_incidents WHERE job=NEW.card; END""")


def watchdog_signal(status):
    """Only host-level failures need CLI review; the watchdog owns routine retries."""
    if status in {"실행 중","목표 달성","랭킹 소진","사용자 요청으로 중지"}:
        return "", True
    if status == "감시 응답 지연":
        return "WATCHDOG_UNRESPONSIVE", False
    match = re.fullmatch(r"점검 필요\s*\(([^)]+)\)", status)
    if not match:
        return "", False
    reason = match[1].strip()
    if reason in {"BATCH_RETRY_LIMIT","RESUME_FAILED","UNCLASSIFIED_WORKER_EXIT","GENERAL_WORK_REQUIRED",
                  "BATCH_OUTSIDE_WORK","WORKER_CRASHED","WATCHDOG_POLL_FAILED","ERROR_REQUIRES_INSPECTION"}:
        return reason, False
    if severity(reason,reason) or reason in SHARED_FAILURES:
        return reason, False
    if re.search(r"CORRUPT|FATAL|ENOSPC|SQLITE_(?:IOERR|CORRUPT|FULL)|DATABASE.*(?:FAILED|LOCKED)|"
                 r"(?:RUNNER|WORKER|WATCHDOG|RELAY|PROCESS).*(?:CRASH|NOT_RUNNING|UNEXPECTED_EXIT)", reason, re.I):
        return "HOST_FAILURE", False
    return "", False
