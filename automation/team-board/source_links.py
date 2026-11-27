"""Attach an external sourcing identity to board cards that represent the same work."""


def attach_source_work_ids(board, cards):
    tables = {r[0] for r in board.db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'sourcing_%' OR name='naver_runs')")}
    source = {}
    if "sourcing_alert_channels" in tables:
        source.update(board.db.execute("SELECT card,work_id FROM sourcing_alert_channels"))
    if "naver_runs" in tables:
        for card, work, audit in board.db.execute("SELECT card,id,audit_card FROM naver_runs"):
            source[card] = work
            if audit is not None:
                source[audit] = work
    if not source:
        return
    for name, query in (
        ("sourcing_audit_delivery", "SELECT DISTINCT job,channel FROM sourcing_audit_delivery"),
        ("sourcing_alert_actions", "SELECT DISTINCT a.job,e.card FROM sourcing_alert_actions a JOIN entries e ON e.seq=a.seq"),
        ("sourcing_incidents", "SELECT job,channel FROM sourcing_incidents"),
    ):
        if name in tables:
            for job, channel in board.db.execute(query):
                if channel in source:
                    source[job] = source[channel]
    for card in cards:
        if card["id"] in source:
            card["sourceWorkId"] = source[card["id"]]
