"""Read the selected team board, Naver runs and No1 work orders without starting a worker."""

import argparse
import hashlib
import json
import sqlite3
from contextlib import ExitStack, closing
from pathlib import Path


METRICS = {
    "inputTokens": "input_tokens",
    "cachedInputTokens": "cached_input_tokens",
    "outputTokens": "output_tokens",
    "reasoningTokens": "reasoning_output_tokens",
}


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def readonly_db(path):
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)


def summarize(records):
    roles = {}
    for role, usage in records:
        row = roles.setdefault(role or "unknown", {"calls": 0, "measuredCalls": 0,
                               "measuredFields": dict.fromkeys(METRICS, 0), **dict.fromkeys(METRICS)})
        row["calls"] += 1
        usage = usage or {}
        measured = {}
        for field, wire_name in METRICS.items():
            value = usage.get(field, usage.get(wire_name))
            if field == "reasoningTokens" and value is None:
                value = usage.get("reasoningOutputTokens")
            if type(value) is int and value >= 0:
                measured[field] = value
                row[field] = (row[field] or 0) + value
                row["measuredFields"][field] += 1
        if "inputTokens" in measured and "outputTokens" in measured:
            row["measuredCalls"] += 1
    return roles


def naver_records(folder):
    """Prefer one durable receipt per attempt, including failures and interrupted attempts."""
    if not folder.is_dir():
        raise ValueError(f"네이버 작업 폴더를 찾을 수 없습니다: {folder}")
    batches = [folder, *sorted(p for p in folder.glob("batch-*") if p.is_dir())]
    found = False
    for batch in batches:
        attempts = {}
        report = batch / "agents-team-ai.json"
        if report.is_file():
            found = True
            data = read_json(report)
            receipts = data.get("usage") or []
            for index in range(max(len(receipts), data.get("calls", 0))):
                row = (receipts[index] if index < len(receipts) else None) or {}
                key = json.dumps([data["runId"], index], ensure_ascii=False, separators=(",", ":"))
                attempt = row.get("attemptId") or "legacy-" + hashlib.sha256(key.encode()).hexdigest()
                attempts[attempt] = (row.get("role"), row)
        for receipt in sorted((batch / "agent-token-usage").glob("*.json")):
            data = read_json(receipt)
            found = True
            attempts[data["attemptId"]] = (data["role"], data.get("usage"))
        yield from attempts.values()
    if not found and not (folder / "naver-live.json").is_file():
        raise ValueError(f"네이버 사용 기록 또는 실행 원장이 없습니다: {folder}")


def archived_usage(db, thread_id):
    row = db.execute("SELECT rollout_path FROM threads WHERE id=?", (thread_id,)).fetchone()
    if not row or not row[0] or not Path(row[0]).is_file():
        return None
    latest = None
    with Path(row[0]).open(encoding="utf-8") as lines:
        for line in lines:
            if '"total_token_usage"' not in line:
                continue
            event = json.loads(line)
            payload = event.get("payload") or {}
            if event.get("type") == "event_msg" and payload.get("type") == "token_count":
                usage = (payload.get("info") or {}).get("total_token_usage")
                if usage:
                    latest = usage
    return latest


def product_records(order_file, history_db):
    root = order_file.parent.parent
    by_thread = {}
    runs = dict.fromkeys(entry["runId"] for entry in read_json(order_file)["entries"])
    for run in runs:
        if Path(run).name != run or not run.startswith("batch-"):
            raise ValueError("작업 원장의 배치 경로가 올바르지 않습니다.")
        for state in (root / run / "judgments").glob("*/team-state.json"):
            for actor in read_json(state)["actors"]:
                thread = actor["threadId"]
                usage = actor.get("tokenUsage")
                if not usage and history_db is not None:
                    usage = archived_usage(history_db, thread)
                by_thread[thread] = (actor["role"], usage)
    yield from by_thread.values()


def main():
    parser = argparse.ArgumentParser(description="지정한 실행의 역할별 토큰 사용량을 읽습니다. 캐시 입력은 입력에, 추론은 출력에 포함됩니다.")
    parser.add_argument("--board-db", type=Path, help="팀보드 board.sqlite3")
    parser.add_argument("--naver-run", type=Path, action="append", default=[], help="네이버 실행 폴더")
    parser.add_argument("--work-order", type=Path, action="append", default=[], help="No1 work-orders/work-*.json")
    parser.add_argument("--codex-history", type=Path, help="기존 No1 스레드 계측을 보완할 Codex 상태 DB")
    args = parser.parse_args()
    if not any((args.board_db, args.naver_run, args.work_order)):
        parser.error("조회할 --board-db, --naver-run 또는 --work-order를 지정하세요.")

    reports = []
    try:
        with ExitStack() as stack:
            db = stack.enter_context(closing(readonly_db(args.codex_history))) if args.codex_history else None
            if args.board_db:
                from cli_usage import summary

                board = stack.enter_context(closing(readonly_db(args.board_db)))
                reports.append({"source": "팀보드", "path": str(args.board_db.resolve()), **summary(board)})
            for folder in dict.fromkeys(p.resolve() for p in args.naver_run):
                reports.append({"source": "네이버", "path": str(folder), "unit": "모델 호출 시도",
                                "roles": summarize(naver_records(folder))})
            for order in dict.fromkeys(p.resolve() for p in args.work_order):
                reports.append({"source": "No1", "path": str(order), "unit": "모델 스레드",
                                "roles": summarize(product_records(order, db))})
    except (OSError, sqlite3.Error, ValueError, KeyError) as error:
        parser.exit(1, f"사용량 원장을 읽을 수 없습니다: {error}\n")
    print(json.dumps(reports, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
