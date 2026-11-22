"""Dispatch two independent KREAM public-research cards on the local team board."""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from agents import RunnerLock
from board import DEFAULT_DATA
from board_paths import PROJECT, report_directory


BOARD = "http://127.0.0.1:48731"
KST = timezone(timedelta(hours=9))
RANKING = "https://kream.co.kr/?tab=home_ranking_v2&popular_filter=buy&date_range_filter=weekly"
REPORTS = report_directory()
REPORT_WRITER = PROJECT / "상품탐색결과" / "append_result.py"
SEED_DAY = "2026-11-22"
SEEDS = [12831, 36, 376708, 1128181, 589356, 1036058, 18871, 1072895, 21935,
         211304, 1128170, 206277, 1016600, 748804, 210092, 574093]
ASSIGNED_SEPARATELY = {12831, 36, 376708, 748804}
STATE_DIR = DEFAULT_DATA / "public-sourcing"
OUTPUT = "public-sourcing.json"
SLOTS = 2


def atomic_json(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, mode="w", encoding="utf-8", delete=False) as stream:
        tmp = Path(stream.name)
        try:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            stream.close()
            tmp.unlink(missing_ok=True)
            raise
    try:
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def current_day():
    return datetime.now(KST).date().isoformat()


def new_day(day, seen):
    seeded = day == SEED_DAY
    queue = [[rank, pid] for rank, pid in enumerate(SEEDS, 1)
             if seeded and pid not in ASSIGNED_SEPARATELY and pid not in seen]
    return dict(day=day, queue=queue, nextRank=len(SEEDS) + 1 if seeded else 1,
                seen=seen, listed=SEEDS.copy() if seeded else [], exhausted=False,
                jobs=[], deferred=[], phase="ready", detail="탐색 대기")


def board_request(path, body=None, limit=8_000_000):
    headers = {"X-Team-Board": "1", "Content-Type": "application/json"}
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    with urlopen(Request(BOARD + path, data=data, headers=headers), timeout=12) as response:
        content = response.read(limit + 1)
    if len(content) > limit:
        raise ValueError("업무 응답 크기를 확인하세요.")
    return json.loads(content.decode("utf-8-sig"))


def source_url(pid):
    return f"https://kream.co.kr/products/{pid}"


def next_job(state):
    day = state["day"]
    assigned = {pid for job in state["jobs"] + state["deferred"] for _, pid in job.get("items", [])}
    items = [entry for entry in state["queue"] if entry[1] not in assigned][:1]
    if items:
        return {"kind": "products", "day": day, "items": items,
                "key": f"public-weekly-{day}-" + "-".join(str(pid) for _, pid in items)}
    if (state["exhausted"] or any(job["kind"] == "listing" and job["day"] == day
            for job in state["jobs"] + state["deferred"])):
        return None
    start = state["nextRank"]
    return {"kind": "listing", "day": day, "start": start, "key": f"public-weekly-{day}-r{start}"}


def job_text(job):
    scope = f"{job['day']} KST KREAM 공개 상품 소싱. 기준 목록 {RANKING} 의 ‘많이 산 상품’ 주간. "
    scope += ("공개된 웹 화면과 상품·판매처 페이지를 읽는 조사만 한다. 주문·입찰·장바구니·로그인 조작 없이 진행하고 "
              "계정정보를 열거나 기록하지 않는다. 제출 파일은 이 업무 폴더의 " + OUTPUT + " 한 개다. ")
    if job["kind"] == "listing":
        start = job["start"]
        return scope + (f"목록의 {start}위부터 연속 8개 순위까지 원문 순서대로 채록한다. "
            "판단으로 후보를 보태지 않는다. 순위, 실제 KREAM 상품 링크에서 읽은 숫자 상품 ID만 "
            '{"items":[{"rank":17,"productId":12345}],"exhausted":false} 형태로 저장한다. '
            "예시 숫자는 쓰지 않는다. 실제 목록 끝이 보일 때만 exhausted=true. "
            "인증, 렌더링 문제, 보이지 않는 순위는 소진이 아니므로 구체적 사유와 함께 blocked로 보고한다.")
    listing = ", ".join(f"{rank}위 {source_url(pid)}" for rank, pid in job["items"])
    return scope + listing + (". 이 목록에서 이미 확인한 순위의 지정 상품만 조사한다(순위는 당시 관측치). "
        "상품명·품번·색상·사이즈를 상품 페이지와 대조하고, 해당 브랜드의 인기순 목록에서 같은 상품 노출을 "
        "확인할 수 있으면 근거 링크와 정렬 기준을 남긴다. 주간 판매 순위, 누적 거래, 최근 사이즈별 체결을 구별한다. "
        "SSG·G마켓·29CM·솔드아웃·네이버스토어·무신사 등에서 정확한 옵션의 재고와 판매자, 적용 가능한 쿠폰, "
        "배송비, KREAM 수수료·판매비용을 확인한다. 기존 적립금 사용과 신규 적립은 별도로 표시한다. "
        "확인 못한 항목은 보류 사유에 적는다. 옵션 재고·최근 실거래·구매가·비용·인기순 교차 근거가 "
        "모두 있고 현금 기준 이익이 양수일 때만 채택한다. 각 출처는 실제 확인한 공개 페이지 링크로 남긴다. "
        'JSON 형식은 {"items":[{"productId":숫자,"rank":숫자,"title":"실제 상품명 및 옵션",'
        '"status":"채택 또는 보류 또는 제외","details":"실제 확인 시각(KST), 관측값과 판정 근거",'
        '"sources":[{"label":"출처","url":"https://..."}]}]}이다. '
        "채택 항목은 추가로 economics 객체에 option(문자), stockConfirmed(true), recentTrades(양의 정수), "
        "buyKrw(쿠폰 적용 뒤 매입가), buyShippingKrw, saleKrw(근거 있는 옵션 판매가), sellCostsKrw(수수료·관련 세금·발송비 합), "
        "newPointsKrw(신규 적립, 미확인은 null), brandPopularityUrl(해당 브랜드 인기순 근거), "
        "offerUrl(매입처 상품 근거), feeUrl(판매비용 근거)을 담는다. "
        "확인된 상품이 없는 접근 오류라면 실측값을 만들지 말고 blocked로 남긴다. 검토자와 감사총무는 근거와 파일을 대조한다.")


def http_url(value):
    if not isinstance(value, str) or any(char.isspace() for char in value) or any(c in value for c in "<>"):
        return False
    parsed = urlsplit(value)
    hostname = parsed.hostname or ""
    return (parsed.scheme == "https" and "." in hostname and not hostname.endswith((".local", ".localhost"))
            and parsed.username is None and parsed.password is None)


def reported_ids(day):
    """Other agents can finish overlapping products directly in the same day's report."""
    path = REPORTS / day[:7] / (day + ".md")
    if not path.exists():
        return set()
    parts = path.read_text("utf-8-sig").split("<!-- research:")[1:]
    return {int(pid) for part in parts for pid in re.findall(
        r"https://(?:www\.)?kream\.co\.kr/products/([1-9][0-9]*)(?=[/?#>\s)])", part)}


def check_products(job, result):
    expected = dict((pid, rank) for rank, pid in job["items"])
    rows = result["items"]
    if not isinstance(rows, list) or len(rows) != len(expected):
        raise ValueError("요청한 상품 수와 제출 수가 다릅니다.")
    entries = []
    for row in rows:
        pid, rank = row["productId"], row["rank"]
        if type(pid) != int or type(rank) != int or expected.pop(pid, None) != rank:
            raise ValueError("상품 ID 또는 순위가 요청과 다릅니다.")
        if row["status"] not in {"채택", "보류", "제외"}:
            raise ValueError("유효하지 않은 상품 판정입니다.")
        for field in ["title", "details"]:
            if not isinstance(row[field], str) or not row[field].strip():
                raise ValueError("상품명 또는 근거가 비어 있습니다.")
        links = row["sources"]
        if not isinstance(links, list) or not 1 <= len(links) <= 32:
            raise ValueError("공개 출처가 필요합니다.")
        if any(not isinstance(link, dict) or not isinstance(link.get("label"), str)
               or not link["label"].strip() or not http_url(link.get("url")) for link in links):
            raise ValueError("유효하지 않은 출처입니다.")
        urls = {s["url"] for s in links}
        if not any(urlsplit(u).hostname in {"kream.co.kr", "www.kream.co.kr"}
                   and urlsplit(u).path.rstrip("/") == f"/products/{pid}" for u in urls):
            raise ValueError("해당 KREAM 상품의 출처가 없습니다.")
        details = f"주간 많이 산 상품 관측 순위 {rank}위 · KREAM 상품 {pid}\n\n{row['details']}"
        if row["status"] == "채택":
            e = row["economics"]
            amounts = [e[k] for k in ("buyKrw", "buyShippingKrw", "saleKrw", "sellCostsKrw")]
            if (any(type(n) != int or n < 0 for n in amounts) or e["buyKrw"] == 0
                    or not isinstance(e["option"], str) or not e["option"].strip() or e["stockConfirmed"] is not True
                    or type(e["recentTrades"]) != int or e["recentTrades"] < 1):
                raise ValueError("채택에 필요한 옵션·수량·비용 근거가 없습니다.")
            if not all(e.get(k) in urls for k in ("offerUrl", "feeUrl", "brandPopularityUrl")):
                raise ValueError("채택에 필요한 매입처·수수료·브랜드 인기순 출처가 없습니다.")
            if urlsplit(e["brandPopularityUrl"]).hostname not in {"kream.co.kr", "www.kream.co.kr"}:
                raise ValueError("KREAM 브랜드 인기순 출처를 확인하세요.")
            if urlsplit(e["offerUrl"]).hostname in {"kream.co.kr", "www.kream.co.kr"}:
                raise ValueError("실제 매입처의 상품 페이지를 확인하세요.")
            cost = e["buyKrw"] + e["buyShippingKrw"]
            profit = e["saleKrw"] - e["sellCostsKrw"] - cost
            if profit <= 0:
                raise ValueError("현금 기준 이익이 양수가 아닙니다.")
            points = e["newPointsKrw"]
            if points is not None and (type(points) != int or points < 0):
                raise ValueError("신규 적립금을 확인하세요.")
            details += (f"\n\n{e['option']} · 매입 총액 {cost:,}원 · 판매가 {e['saleKrw']:,}원 · "
                        f"판매비용 {e['sellCostsKrw']:,}원 · 예상 현금이익 {profit:,}원 "
                        f"(매입 총액 대비 {profit/cost:.1%}) · 예상 신규 적립 "
                        + ("미확인" if points is None else f"{points:,}원"))
        entries.append({"id": f"public-weekly-{job['day']}-{pid}", "title": row["title"], "status": row["status"],
                        "details": details, "sources": links})
    return entries


def consume_listing(state, job, data):
    items, exhausted = data["items"], data["exhausted"]
    if not isinstance(items, list) or type(exhausted) != bool or len(items) > 8 or (len(items) != 8 and not exhausted):
        raise ValueError("목록을 모두 채록했거나 실제 소진을 확인해야 합니다.")
    queue = []
    page_ids = set()
    seen = set(state["seen"])
    if job["day"] == SEED_DAY:
        seen.update(ASSIGNED_SEPARATELY)
    for rank, row in enumerate(items, job["start"]):
        pid = row["productId"]
        if type(row["rank"]) != int or rank != row["rank"] or type(pid) != int or pid <= 0 or pid in page_ids:
            raise ValueError("연속 순위와 실제 상품 ID를 확인하세요.")
        page_ids.add(pid)
        if pid not in seen and pid not in state["listed"]:
            queue.append([rank, pid])
            seen.add(pid)
    if page_ids and page_ids.issubset(state["listed"]):
        raise ValueError("같은 순위 페이지가 반복되었습니다. 다음 순위가 실제로 공개되는지 확인하세요.")
    state["listed"] = sorted(set(state["listed"]) | page_ids)
    state["queue"] += queue
    state["nextRank"] += len(items)
    state["exhausted"] = exhausted


def append_entries(day, entries):
    for entry in entries:
        subprocess.run([sys.executable, "-X", "utf8", str(REPORT_WRITER),
                        "--date", day, "--entry", "-"], input=json.dumps(entry, ensure_ascii=False).encode(),
                       stdout=subprocess.DEVNULL, check=True,
                       env={**os.environ, "CREAM_REPORTS_DIR": str(REPORTS)})


def migrate(state):
    # Carry forward the old request text/key even when its POST reply was lost.
    if "jobs" not in state:
        legacy = state.pop("active", None)
        state["jobs"] = [legacy] if legacy else []
    state.setdefault("deferred", [])


def archive(job, card, state, root, today, request, append, save):
    if card["stage"] != "auditor":
        raise ValueError("감사 마감 상태를 확인하세요.")
    try:
        data = request(f"/api/tasks/{card['id']}/file?path={OUTPUT}", limit=256_000)
        if job["kind"] == "listing":
            consume_listing(state, job, data)
        else:
            entries = check_products(job, data)
    except (ValueError, KeyError, TypeError, HTTPError) as exc:
        if isinstance(exc, HTTPError) and exc.code != 404:
            raise
        if job.get("repairSent") or (root / "STOP").exists():
            raise
        note = job.get("repairNote") or (
            f"제출한 {OUTPUT} 원본을 읽고 다음 문제를 보완해 같은 업무에 다시 제출하세요. "
            f"검증 결과: {exc}. 근거 없는 값은 보류하고 기존 검증 자료를 재사용하세요.")
        job["repairNote"] = note
        save()
        request(f"/api/tasks/{card['id']}/notes", {"requestId": job["key"] + "-repair", "text": note})
        job["repairSent"] = True
        save()
        return "working"
    if job["kind"] == "products":
        day = job.get("reportDay")
        if not day:
            job["reportDay"] = day = today
            save()
        append(day, entries)
        finished = {pid for _, pid in job["items"]}
        state["seen"] = sorted(set(state["seen"]) | finished)
        state["queue"] = [[r, pid] for r, pid in state["queue"] if pid not in finished]
    state["jobs"].remove(job)
    state["failureStreak"] = 0
    state.pop("retryAfter", None)
    save()
    return "saved"


def tick(state, root, today, request=board_request, append=append_entries, reported=reported_ids):
    def save():
        state["updatedAt"] = time.time()
        atomic_json(root / "state.json", state)

    def defer(job, why, *, watch=False):
        state["jobs"].remove(job)
        job.update(reason=str(why)[:500], watch=watch, phase="blocked")
        state["deferred"].append(job)
        ids = {pid for _, pid in job.get("items", [])}
        state["queue"] = [pair for pair in state["queue"] if pair[1] not in ids]
        streak = state.get("failureStreak", 0) + 1
        state["failureStreak"] = streak
        if streak >= 4:
            # Repeated account/provider failures must not buy a new card on every poll.
            state["retryAfter"] = time.time() + min(3600, 900 * (streak - 3))
        save()

    migrate(state)
    stop = root / "STOP"
    if not state["jobs"] and state["day"] != today and not stop.exists():
        deferred = state["deferred"]
        state.update(new_day(today, state["seen"]))
        state["deferred"] = deferred
        save()
    watched = [job for job in state["deferred"] if job.get("watch")]
    cards = {}
    if state["jobs"] or watched:
        cards = {card["id"]:card for card in request("/api/board?after=9223372036854775807")["cards"]}
    saved = False
    for job in list(state["jobs"]):
        if not job.get("card"):
            # Bind a committed POST whose reply didn't reach the previous process;
            # a stop marker restricts new posts but allows an old card to finish.
            match = next((c["id"] for c in cards.values() if c.get("request") == job.get("text")), None)
            if match:
                job["card"] = match
                save()
            else:
                continue
        card = cards.get(job["card"])
        if not card:
            defer(job, "기존 업무 카드가 현재 칠판에 없습니다.")
            continue
        if (job.get("phase"), job.get("stage")) != (card["state"],card["stage"]):
            job.update(phase=card["state"], stage=card["stage"])
            save()
        if card["state"] == "blocked":
            defer(job, f"업무 #{card['id']} · {card['stage']} 단계에서 확인 필요", watch=True)
        elif card["state"] == "done":
            try:
                saved |= archive(job, card, state, root, today, request, append, save) == "saved"
            except (ValueError, TypeError, KeyError, HTTPError, subprocess.CalledProcessError) as exc:
                if isinstance(exc, HTTPError) and exc.code >= 500:
                    raise
                defer(job, exc)
    # A user may have unblocked an original card using its chat. Before allocating
    # any freed slot, resume tracking that same card rather than repeating its work.
    for job in watched:
        card = cards.get(job["card"])
        if (len(state["jobs"]) >= SLOTS or not card or card["state"] == "blocked"
                or job["kind"] == "listing" and job["day"] != state["day"]):
            continue
        state["deferred"].remove(job)
        job.pop("watch", None)
        state["jobs"].append(job)
        save()
    if not stop.exists() and state["day"] == today and time.time() >= state.get("retryAfter", 0):
        known = reported(today)
        state["queue"] = [pair for pair in state["queue"] if pair[1] not in known]
        while len(state["jobs"]) < SLOTS:
            job = next_job(state)
            if not job:
                break
            job["text"] = job_text(job)
            state["jobs"].append(job)
            save()
    for job in list(state["jobs"]):
        if not job.get("card") and not stop.exists():
            try:
                job["card"] = request("/api/tasks", {"requestId":job["key"], "text":job["text"]})["id"]
            except HTTPError as exc:
                if exc.code >= 500:
                    raise
                defer(job, f"업무 접수 실패 (HTTP {exc.code})")
                continue
            job.update(phase="ready", stage="worker")
            save()
    active = [job for job in state["jobs"] if job.get("card")]
    if active:
        phase = "running"
        detail = " · ".join(f"#{j['card']} {j.get('stage','worker')}/{j.get('phase','ready')}" for j in active)
        outcome = "saved" if saved else "working"
    elif stop.exists():
        phase, detail, outcome = "stopped", "새 업무 배정 중단", "stopped"
    elif state["day"] != today:
        phase, detail, outcome = "ready", "다음 날짜의 순위 확인", "saved"
    elif time.time() < state.get("retryAfter", 0):
        phase, detail, outcome = "blocked", "연속 오류 후 새 배정 대기", "blocked"
    elif any(j["kind"] == "listing" and j["day"] == today for j in state["deferred"]):
        phase, detail, outcome = "blocked", "다음 순위 페이지 확인 필요", "blocked"
    elif not state["exhausted"]:
        phase, detail, outcome = "ready", "다음 후보 배정", "saved"
    else:
        phase, detail, outcome = "ready", "오늘 공개된 순위 소진", "exhausted"
    if (state.get("phase"), state.get("detail")) != (phase, detail):
        state.update(phase=phase, detail=detail)
        save()
    return outcome


def run(resume=False):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    path = STATE_DIR / "state.json"
    stop = STATE_DIR / "STOP"
    expected = hashlib.sha256(str(DEFAULT_DATA.resolve()).casefold().encode()).hexdigest()[:20]
    with RunnerLock(STATE_DIR):
        if resume:
            stop.unlink(missing_ok=True)
        state = json.loads(path.read_text("utf-8")) if path.exists() else new_day(current_day(), [])
        if not REPORT_WRITER.is_file():
            raise FileNotFoundError("날짜별 기록기를 찾을 수 없습니다.")
        errors = 0
        while True:
            try:
                health = board_request("/api/health")
                if health.get("board") != expected:
                    raise ValueError("연결된 대시보드의 작업 폴더가 다릅니다.")
                outcome = tick(state, STATE_DIR, current_day())
                errors = 0
            except (HTTPError, URLError, OSError, TimeoutError, ValueError, KeyError, TypeError,
                    subprocess.CalledProcessError) as exc:
                errors += 1
                retryable = isinstance(exc, OSError) and (not isinstance(exc, HTTPError) or exc.code >= 500)
                if not retryable or errors >= 5 or stop.exists():
                    state.update(phase="blocked", detail=str(exc)[:500], updatedAt=time.time())
                    atomic_json(path, state)
                    raise
                time.sleep(min(60, errors*8))
                continue
            if outcome == "stopped" or (stop.exists() and outcome == "blocked"):
                return
            wait = {"saved":1, "working":12, "blocked":45, "exhausted":1800}[outcome]
            for _ in range(wait):
                if stop.exists() and not any(job.get("card") for job in state["jobs"]):
                    return
                if outcome == "exhausted" and current_day() != state["day"]:
                    break
                time.sleep(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("run", "resume", "status", "stop"))
    action = parser.parse_args().action
    if action in ("run", "resume"):
        run(action == "resume")
    elif action == "stop":
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        (STATE_DIR / "STOP").touch()
        print("새 업무 배정을 중단했습니다. 접수된 업무는 검수와 기록을 마칩니다.")
    else:
        path = STATE_DIR / "state.json"
        state = json.loads(path.read_text("utf-8")) if path.exists() else {}
        migrate(state)
        print(json.dumps({"day": state.get("day"), "phase": state.get("phase", "idle"),
                          "detail": state.get("detail"), "nextRank": state.get("nextRank"),
                          "completed": len(state.get("seen", [])), "cards": [j.get("card") for j in state["jobs"] if j.get("card")],
                          "deferred":len(state["deferred"]), "slots":SLOTS,
                          "exhausted": state.get("exhausted"), "stopRequested": (STATE_DIR / "STOP").exists()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
