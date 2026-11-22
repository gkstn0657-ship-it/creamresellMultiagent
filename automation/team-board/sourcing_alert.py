"""Publish a sourcing status transition to the dashboard chat without starting a CLI task."""
import argparse
import re

from board import Board
from sourcing_incidents import incident_channel, route, watchdog_signal
from naver_work import context as naver_context
from external_activity import BATCH, ORDER, read_object, roots_for_board


def linked_sourcing_context(board, card):
    """Return same-order evidence for a consultation, audit or recovery turn."""
    naver = naver_context(board, card)
    if naver is not None:
        return naver
    tables = {row[0] for row in board.db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sourcing_%'")}
    if "sourcing_alert_channels" not in tables:
        return None
    channels = [incident_channel(board,card) or card]
    if "sourcing_audit_delivery" in tables:
        channels.extend(r[0] for r in board.db.execute(
            "SELECT DISTINCT channel FROM sourcing_audit_delivery WHERE job=?", (card,)))
    if "sourcing_alert_actions" in tables:
        channels.extend(r[0] for r in board.db.execute(
            "SELECT DISTINCT e.card FROM sourcing_alert_actions a JOIN entries e ON e.seq=a.seq WHERE a.job=?", (card,)))
    for channel in channels:
        row = board.db.execute("SELECT work_id FROM sourcing_alert_channels WHERE card=?", (channel,)).fetchone()
        if row:
            break
    else:
        return None
    work_id = row[0]
    if not ORDER.fullmatch(work_id):
        return None
    records = board.db.execute("""SELECT seq,role,kind,body FROM entries WHERE card=?
        ORDER BY seq DESC LIMIT 14""", (channel,)).fetchall()
    context = {"workId": work_id, "channel": channel, "recent": [
        {**dict(entry), "body":entry["body"][:1600]} for entry in reversed(records)]}
    for base in roots_for_board(board.directory):
        for root in (base, base / "musinsa-inspection"):
            order = read_object(root / "work-orders" / (work_id + ".json"))
            if order.get("id") != work_id:
                continue
            folder = root / "explorations" / work_id
            state = read_object(folder / "state.json")
            watch = read_object(folder / "exploration-watchdog.json")
            context["host"] = {
                "target":order.get("targetSources") or order.get("targetProducts"),
                "orderStatus":order.get("status"), "stopRequested":(folder / "STOP").exists(),
                "stage":state.get("status"), "error":state.get("error"), "checkedSources":state.get("checkedSources"),
                "watchStatus":watch.get("status"), "watchReason":watch.get("reason"), "checkedAt":watch.get("at")}
            batch_id = state.get("currentRunId")
            if isinstance(batch_id, str) and BATCH.fullmatch(batch_id):
                batch = read_object(root / batch_id / "batch-state.json")
                context["host"]["currentBatch"] = {k:batch.get(k) for k in ("status","collected","judged")}
            return context
    return context


def publish(board, work_id, label, status):
    if not re.fullmatch(r"work-[0-9a-f-]{36}", work_id) or not label.strip() or not status.strip():
        raise ValueError("탐색 알림의 작업 번호와 내용을 확인하세요.")
    title = f"{label} · 탐색 알림"
    body = f"{label} · {status}"
    with board.write():
        board.db.execute("""CREATE TABLE IF NOT EXISTS sourcing_alert_channels (
            work_id TEXT PRIMARY KEY, card INTEGER NOT NULL REFERENCES cards(id), last_body TEXT NOT NULL
        )""")
        row = board.db.execute("SELECT card,last_body FROM sourcing_alert_channels WHERE work_id=?", (work_id,)).fetchone()
        if row and row["last_body"] == body:
            return
        if row:
            card = row["card"]
            board.db.execute("UPDATE sourcing_alert_channels SET last_body=? WHERE work_id=?", (body, work_id))
        else:
            card = board.db.execute("INSERT INTO cards(request,stage,state) VALUES(?,'auditor','알림 수신')", (title,)).lastrowid
            board.db.execute("INSERT INTO sourcing_alert_channels VALUES(?,?,?)", (work_id, card, body))
        seq = board._post(card, "auditor", "탐색 알림", body)
        critical, recovered = watchdog_signal(status)
        route(board, card, seq, work_id, body, critical=critical, recovered=recovered)


def dispatch(board, work_id):
    """Finish forwarding previously assigned jobs and report pending interventions."""
    with board.write():
        schema = {r[0] for r in board.db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sourcing_%'")}
        if "sourcing_alert_channels" not in schema:
            return False
        channel = board.db.execute("SELECT card FROM sourcing_alert_channels WHERE work_id=?", (work_id,)).fetchone()
        if not channel:
            return False
        card = channel["card"]
        # A watcher already running when the policy changes may only call --dispatch.
        alert = board.db.execute("SELECT seq,body FROM entries WHERE card=? AND kind='탐색 알림' ORDER BY seq DESC LIMIT 1",
                                 (card,)).fetchone()
        if alert:
            critical, recovered = watchdog_signal(alert["body"].partition(" · ")[2])
            route(board, card, alert["seq"], work_id, alert["body"], critical=critical, recovered=recovered)
        pending = False
        if "sourcing_alert_actions" in schema:
            jobs = board.db.execute("""SELECT DISTINCT a.job FROM sourcing_alert_actions a JOIN entries e ON e.seq=a.seq
                WHERE e.card=? AND a.reported=0""", (card,)).fetchall()
            for row in jobs:
                job = row["job"]
                state = board._get(job)["state"]
                if state not in ("done","blocked"):
                    pending = True
                    continue
                result = board.db.execute("""SELECT body FROM entries WHERE card=? AND kind IN
                    ('submit','approve','close','blocked','error','interrupt') ORDER BY seq DESC LIMIT 1""", (job,)).fetchone()
                board._post(card, "worker", "조치 결과", f"#{job} · " + (result["body"] if result else state))
                board.db.execute("UPDATE sourcing_alert_actions SET reported=1 WHERE job=?", (job,))
        if alert and critical:
            return pending or bool(board.db.execute("""SELECT 1 FROM sourcing_incidents i JOIN cards c ON c.id=i.job
                WHERE i.channel=? AND i.resolved IS NULL AND c.state IN ('ready','running')""", (card,)).fetchone())
        return pending


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dispatch", action="store_true")
    for name in ("work", "label", "status"):
        parser.add_argument("--" + name, required=name=="work")
    args = parser.parse_args()
    board = Board(initialize=False)
    try:
        if args.dispatch:
            print("pending" if dispatch(board, args.work) else "idle")
        else:
            publish(board, args.work, args.label, args.status)
    finally:
        board.db.close()
