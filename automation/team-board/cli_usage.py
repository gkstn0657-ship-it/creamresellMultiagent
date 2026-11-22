"""Account for per-turn CLI usage without retaining prompts, commands, or answers."""

import time


FIELDS = {
    "inputTokens": "input_tokens",
    "cachedInputTokens": "cached_input_tokens",
    "outputTokens": "output_tokens",
    "reasoningTokens": "reasoning_tokens",
}
ROLES = ("worker", "reviewer", "auditor", "contractor")


def install(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS cli_invocations(
            id INTEGER PRIMARY KEY, card INTEGER NOT NULL REFERENCES cards(id),
            claim INTEGER NOT NULL REFERENCES entries(seq), role TEXT NOT NULL,
            contract INTEGER REFERENCES contracts(id), started REAL NOT NULL,
            ended REAL, status TEXT NOT NULL DEFAULT 'running');
        CREATE TABLE IF NOT EXISTS cli_usage_events(
            invocation INTEGER NOT NULL REFERENCES cli_invocations(id), turn TEXT NOT NULL,
            input_tokens INTEGER, cached_input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
            PRIMARY KEY(invocation,turn));
        CREATE TABLE IF NOT EXISTS cli_evidence_sent(
            card INTEGER NOT NULL REFERENCES cards(id), role TEXT NOT NULL,
            path TEXT NOT NULL, sha256 TEXT NOT NULL,
            PRIMARY KEY(card,role,path));
    """)


def start(db, job):
    return db.execute("""INSERT INTO cli_invocations(card,claim,role,contract,started)
                         VALUES(?,?,?,?,?)""", (job["id"], job["token"], job["stage"],
                         job.get("contract_id"), time.time())).lastrowid


def record(db, invocation, turn, usage):
    if not isinstance(usage, dict):
        usage = {}
    def count(*values):
        return next((v for v in values if type(v) is int and 0 <= v < 2**63), None)
    def detail(key, subkey):
        value = usage.get(key)
        return value.get(subkey) if isinstance(value, dict) else None
    values = (count(usage.get("input_tokens")),
              count(usage.get("cached_input_tokens"), detail("input_tokens_details", "cached_tokens")),
              count(usage.get("output_tokens")), count(usage.get("reasoning_tokens"),
              usage.get("reasoning_output_tokens"), detail("output_tokens_details", "reasoning_tokens")))
    db.execute("""INSERT INTO cli_usage_events VALUES(?,?,?,?,?,?)
        ON CONFLICT(invocation,turn) DO UPDATE SET
            input_tokens=coalesce(cli_usage_events.input_tokens,excluded.input_tokens),
            cached_input_tokens=coalesce(cli_usage_events.cached_input_tokens,excluded.cached_input_tokens),
            output_tokens=coalesce(cli_usage_events.output_tokens,excluded.output_tokens),
            reasoning_tokens=coalesce(cli_usage_events.reasoning_tokens,excluded.reasoning_tokens)""",
        (invocation, turn, *values))


def finish(db, invocation, status):
    db.execute("UPDATE cli_invocations SET status=?,ended=? WHERE id=? AND ended IS NULL",
               (status, time.time(), invocation))


def summary(db):
    """Read only. Token counts are observed subtotals. Never synthesize missing values."""
    roles = {role: {"calls": 0, "measuredCalls": 0, "turns": 0, "measuredTurns": 0,
                   "measuredFields": dict.fromkeys(FIELDS, 0), **dict.fromkeys(FIELDS)} for role in ROLES}
    result = {"roles": roles, "since": None}
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='cli_usage_events' AND type='table'").fetchone():
        return result
    result["since"] = db.execute("SELECT min(started) FROM cli_invocations").fetchone()[0]
    for role, calls in db.execute("SELECT role,count(*) FROM cli_invocations GROUP BY role"):
        roles[role]["calls"] = calls
    columns = ",".join(f"count(e.{col}),sum(e.{col})" for col in FIELDS.values())
    # Complete measurement means both basic counters were reported for a turn.
    for role, turns, measured_turns, measured_calls, *totals in db.execute(f"""
        SELECT i.role,count(*),count(CASE WHEN e.input_tokens IS NOT NULL AND e.output_tokens IS NOT NULL THEN 1 END),
        count(DISTINCT CASE WHEN e.input_tokens IS NOT NULL AND e.output_tokens IS NOT NULL THEN i.id END),
        {columns} FROM cli_usage_events e JOIN cli_invocations i ON i.id=e.invocation GROUP BY i.role"""):
        data = roles[role]
        data.update(turns=turns, measuredTurns=measured_turns, measuredCalls=measured_calls)
        for pos, key in enumerate(FIELDS):
            data["measuredFields"][key], data[key] = totals[pos*2:pos*2+2]
    return result
