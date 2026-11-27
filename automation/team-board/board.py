"""The shared, transactional task board used by the web UI and all three CLI agents."""

import hashlib
import json
import os
import re
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

import cli_usage
from board_paths import PROJECT, configured_path

DEFAULT_DATA = configured_path("TEAM_BOARD_DATA_DIR", PROJECT / "runs" / "team-board")
MAX_QUESTIONS_PER_CARD = 6
CONTRACT_MODEL = "gpt-6-luna"
CONTRACT_EFFORT = "low"
ROLES = {"worker": "제임스", "reviewer": "클레어", "auditor": "모건"}
ROLE_TITLES = {"worker": "실무자", "reviewer": "검토자", "auditor": "감사총무"}
ROLE_ENGLISH = {"worker": "James", "reviewer": "Claire", "auditor": "Morgan"}
STATES = {"알림 수신": "알림 수신", "ready": "대기", "running": "진행 중", "blocked": "확인 필요", "done": "완료"}
LABELS = {
    "ask": "동료에게 질문", "answer": "동료 답변",
    "request": "업무 등록", "start": "작업 시작", "submit": "결과 제출", "approve": "검토 통과",
    "revise": "보완 요청", "close": "감사 마감", "blocked": "확인 필요", "error": "실행 오류",
    "note": "추가 지시", "draft": "중간 결과", "retry": "다시 실행", "interrupt": "실행 중단",
    "progress": "진행 상황", "files": "산출물 등록", "escalate": "예외 검토 요청", "resume_review": "장애 조치 후 업무 재개",
    "contract_start": "계약직 배정", "contract_result": "계약직 결과 제출", "contract_accept": "실무자 검수 통과",
    "contract_reject": "실무자 반려", "contract_interrupt": "계약 중단",
}
TRANSITIONS = {
    "worker": {"submit": ("worker", "done"), "escalate": ("reviewer", "ready"), "blocked": ("worker", "blocked")},
    "reviewer": {"approve": ("reviewer", "done"), "revise": ("worker", "ready"), "escalate": ("auditor", "ready"),
                 "blocked": ("reviewer", "blocked")},
    "auditor": {"close": ("auditor", "done"), "revise": ("worker", "ready"),
                "blocked": ("auditor", "blocked")},
}


def _public_submission(row):
    """Identify the original dispatcher submission even after notes, retries or a restart."""
    key = re.fullmatch(r"public-weekly-(\d{4}-\d{2}-\d{2})-(r\d+|\d+(?:-\d+)*)", row["request_id"])
    if not key or not row["request"].startswith(f"{key[1]} KST KREAM 공개 상품 소싱."):
        return None
    original = json.dumps(["add", None, row["request"]], ensure_ascii=False).encode()
    if hashlib.sha256(original).hexdigest() == row["fingerprint"]:
        return "listing" if key[2].startswith("r") else "products"
    return None


class Board:
    def __init__(self, directory=DEFAULT_DATA, *, initialize=True):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.directory / "board.sqlite3", timeout=10, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        if not initialize:
            return
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS cards (
                id INTEGER PRIMARY KEY, request TEXT NOT NULL, stage TEXT NOT NULL,
                state TEXT NOT NULL, started REAL, claim INTEGER
            );
            CREATE TABLE IF NOT EXISTS entries (
                seq INTEGER PRIMARY KEY, card INTEGER NOT NULL REFERENCES cards(id),
                at REAL NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS entries_by_card ON entries(card, seq);
            CREATE INDEX IF NOT EXISTS cards_by_stage ON cards(stage, state, id);
            CREATE TABLE IF NOT EXISTS submissions (
                request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, card INTEGER NOT NULL REFERENCES cards(id)
            );
            CREATE TABLE IF NOT EXISTS contracts (
                id INTEGER PRIMARY KEY, card INTEGER NOT NULL REFERENCES cards(id), brief TEXT NOT NULL,
                checks TEXT NOT NULL, model TEXT NOT NULL, effort TEXT NOT NULL, state TEXT NOT NULL,
                result TEXT NOT NULL DEFAULT '', review TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS contracts_by_card ON contracts(card,id);
            CREATE UNIQUE INDEX IF NOT EXISTS current_contract ON contracts(card) WHERE state IN ('running','pending');
            CREATE TABLE IF NOT EXISTS consultations (
                card INTEGER PRIMARY KEY REFERENCES cards(id), seq INTEGER NOT NULL UNIQUE REFERENCES entries(seq),
                requester TEXT NOT NULL, target TEXT NOT NULL, question TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS public_worker_lease (
                slot INTEGER PRIMARY KEY CHECK(slot=1), card INTEGER NOT NULL REFERENCES cards(id),
                claim INTEGER NOT NULL REFERENCES entries(seq)
            );
        """)
        cli_usage.install(self.db)

    @contextmanager
    def write(self):
        if self.db.in_transaction:
            yield
            return
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
        except BaseException:
            self.db.rollback()
            raise
        else:
            self.db.commit()

    def _post(self, card, role, kind, body=""):
        return self.db.execute("INSERT INTO entries(card, at, role, kind, body) VALUES(?,?,?,?,?)",
                               (card, time.time(), role, kind, body)).lastrowid

    def _set(self, card, stage, state):
        self.db.execute("DELETE FROM public_worker_lease WHERE card=?", (card,))
        self.db.execute("UPDATE cards SET stage=?, state=?, started=NULL, claim=NULL WHERE id=?",
                        (stage, state, card))

    def add(self, request):
        request = request.strip()
        if not request:
            raise ValueError("업무 내용을 입력하세요.")
        with self.write():
            card = self.db.execute("INSERT INTO cards(request,stage,state) VALUES(?,'worker','ready')",
                                   (request,)).lastrowid
            self._post(card, "user", "request", request)
        return card

    def cards(self):
        return [dict(row) for row in self.db.execute("SELECT * FROM cards ORDER BY id DESC")]

    def history(self, card):
        return [dict(row) for row in self.db.execute("SELECT * FROM entries WHERE card=? ORDER BY seq", (card,))]

    def timeline(self, after=0):
        return [dict(row) for row in self.db.execute("SELECT * FROM entries WHERE seq>? ORDER BY seq", (after,))]

    def submit(self, request_id, kind, card=None, text=""):
        """A retried browser submission must not start a second CLI job."""
        fingerprint = hashlib.sha256(json.dumps([kind, card, text], ensure_ascii=False).encode()).hexdigest()
        with self.write():
            seen = self.db.execute("SELECT * FROM submissions WHERE request_id=?", (request_id,)).fetchone()
            if seen:
                if fingerprint != seen["fingerprint"]:
                    raise ValueError("다른 요청에 이미 사용한 접수 번호입니다.")
                return seen["card"]
            if kind == "add":
                card = self.add(text)
            elif kind == "note":
                self.note(card, text)
            elif kind == "retry":
                self.retry(card)
            else:
                raise ValueError("처리할 수 없는 요청입니다.")
            self.db.execute("INSERT INTO submissions VALUES(?,?,?)", (request_id, fingerprint, card))
            return card

    def workspace(self, card):
        return self.directory / "work" / str(card)

    def contracts(self, card):
        return [dict(r) for r in self.db.execute("SELECT * FROM contracts WHERE card=? ORDER BY id", (card,))]

    def _ensure_worker(self, job):
        row = self._get(job["id"])
        if self._consultation(job["id"]) or job["stage"] != "worker" or row["stage"] != "worker" or row["state"] != "running" or row["claim"] != job["token"]:
            raise ValueError("현재 업무의 담당 실무자만 계약을 처리할 수 있습니다.")

    def contract_start(self, job, brief, checks, reason=""):
        if not all(isinstance(s, str) and s.strip() for s in (brief, checks)):
            raise ValueError("계약 업무와 검수 기준이 필요합니다.")
        with self.write():
            self._ensure_worker(job)
            card = job["id"]
            if self.db.execute("SELECT 1 FROM contracts WHERE card=? AND state IN ('pending','running')", (card,)).fetchone():
                raise ValueError("진행 중인 계약의 결과를 먼저 검수하세요.")
            contract = self.db.execute(
                "INSERT INTO contracts(card,brief,checks,model,effort,state) VALUES(?,?,?,?,?,'running')",
                (card, brief, checks, CONTRACT_MODEL, CONTRACT_EFFORT)).lastrowid
            delegation = f"\n배정 근거 · {reason}" if reason else ""
            self._post(card, "worker", "contract_start",
                       f"계약 {contract} · {CONTRACT_MODEL} / {CONTRACT_EFFORT}\n{brief}\n검수 기준 · {checks}{delegation}")
            return contract

    def _contract_transition(self, job, contract_id, old, new, body, kind):
        if not isinstance(body, str) or not body.strip():
            raise ValueError("계약 결과 또는 검수 근거를 남기세요.")
        with self.write():
            self._ensure_worker(job)
            field = "result" if old == "running" else "review"
            changed = self.db.execute(f"UPDATE contracts SET state=?, {field}=? WHERE id=? AND card=? AND state=?",
                                      (new, body, contract_id, job["id"], old))
            if not changed.rowcount:
                raise ValueError("해당 업무의 계약 상태를 다시 확인하세요.")
            actor = "contractor" if old == "running" else "worker"
            self._post(job["id"], actor, kind, f"계약 {contract_id}\n{body}")

    def contract_result(self, job, contract_id, body):
        self._contract_transition(job, contract_id, "running", "pending", body, "contract_result")

    def contract_failed(self, job, contract_id, body):
        self._contract_transition(job, contract_id, "running", "failed", body, "contract_interrupt")

    def contract_review(self, job, contract_id, accepted, body):
        if not isinstance(accepted, bool):
            raise ValueError("계약 결과에 대해 승인 또는 반려를 선택하세요.")
        self._contract_transition(job, contract_id, "pending", "accepted" if accepted else "rejected", body,
                                  "contract_accept" if accepted else "contract_reject")

    def _get(self, card):
        row = self.db.execute("SELECT * FROM cards WHERE id=?", (card,)).fetchone()
        if row is None:
            raise ValueError("업무를 먼저 선택하세요.")
        return row

    def note(self, card, body):
        if not body.strip():
            raise ValueError("추가 지시를 입력하세요.")
        with self.write():
            row = self._get(card)
            self._post(card, "user", "note", body.strip())
            if row["state"] != "running":
                pending = self._consultation(card)
                if pending:
                    self._return_answer(card, pending, "사용자 추가 지시가 접수되어 질문을 종료했습니다.", stage="worker", kind="interrupt")
                else:
                    self._set(card, "worker", "ready")

    def retry(self, card):
        with self.write():
            row = self._get(card)
            if row["state"] != "blocked":
                raise ValueError("‘확인 필요’ 상태의 업무에서 다시 실행할 수 있습니다.")
            self._post(card, "user", "retry", f"{ROLES[row['stage']]} 단계에서 이어서 진행합니다.")
            self._set(card, row["stage"], "ready")

    def _next_card(self, stage, public_only):
        if not public_only:
            return self.db.execute("SELECT id FROM cards WHERE stage=? AND state='ready' ORDER BY id LIMIT 1",
                                   (stage,)).fetchone()
        if stage != "worker" or self.db.execute("SELECT 1 FROM public_worker_lease").fetchone():
            return None
        # Older boards already store the original idempotent submission. A later
        # note or retry with a similar ID must not opt a general task into this lane.
        rows = self.db.execute("""SELECT c.id,c.request,s.request_id,s.fingerprint FROM cards c
            JOIN submissions s ON s.card=c.id WHERE c.stage='worker' AND c.state='ready'
            AND s.request_id GLOB 'public-weekly-????-??-??-[0-9]*' ORDER BY c.id""")
        return next((row for row in rows if _public_submission(row) == "products"), None)

    def _public_review(self, card):
        rows = self.db.execute("""SELECT c.request,s.request_id,s.fingerprint FROM cards c
            JOIN submissions s ON s.card=c.id WHERE c.id=? AND s.request_id GLOB 'public-weekly-*'""", (card,))
        return any(_public_submission(row) for row in rows)

    def _pending_review_owner(self, card):
        # A new user note can reach James while a reviewer is reading the
        # exception. Only the supervisor's disposition ends that obligation.
        row = self.db.execute("""SELECT role,kind FROM entries WHERE card=?
            AND kind IN ('escalate','revise','approve','close','resume_review') ORDER BY seq DESC LIMIT 1""", (card,)).fetchone()
        if row and row["kind"] == "escalate":
            return "auditor" if row["role"] == "reviewer" else "reviewer"
        return row["role"] if row and row["kind"] == "revise" and row["role"] in {"reviewer","auditor"} else None

    def recent_worker_decisions(self):
        """Give an invoked auditor a bounded cross-card view with links back to the original entries."""
        return [dict(row) for row in self.db.execute("""SELECT seq,card,at,kind,substr(body,1,240) AS summary
            FROM entries WHERE role='worker' AND kind IN ('submit','escalate','error','interrupt','blocked',
            'contract_start','contract_accept','contract_reject') ORDER BY seq DESC LIMIT 20""")]

    def _public_result_pending(self, card, stage):
        """Closing a service incident cannot certify a public product result that has not been submitted and reviewed."""
        row = self.db.execute("""SELECT kind FROM entries WHERE card=? AND
            ((role='worker' AND kind='submit') OR (role='reviewer' AND kind='approve') OR kind='revise')
            ORDER BY seq DESC LIMIT 1""", (card,)).fetchone()
        if not row or row["kind"] == "revise":
            return "worker"
        if stage == "auditor" and row["kind"] == "submit":
            return "reviewer"
        return None

    def claim(self, stage, *, public_only=False):
        if not self._next_card(stage, public_only):
            return None
        with self.write():
            row = self._next_card(stage, public_only)
            if not row:
                return None
            card = row["id"]
            token = self._post(card, stage, "start")
            self.db.execute("UPDATE cards SET state='running', started=?, claim=? WHERE id=?",
                            (time.time(), token, card))
            if public_only:
                self.db.execute("INSERT INTO public_worker_lease(slot,card,claim) VALUES(1,?,?)", (card, token))
            overview = [{"id": c["id"], "업무": c["request"][:120], "담당": ROLES[c["stage"]],
                         "상태": STATES[c["state"]]} for c in self.cards()]
            return {"id": card, "stage": stage, "token": token, "request": self._get(card)["request"],
                    "board": overview, "entries": self.history(card), "consultation": self._consultation(card),
                    "public_review": self._public_review(card), "ask_targets": self._ask_targets(card, stage)}

    def _consultation(self, card):
        row = self.db.execute("SELECT seq,requester,target,question FROM consultations WHERE card=?", (card,)).fetchone()
        return dict(row) if row else None

    def _ask_targets(self, card, stage):
        if self._consultation(card) or self.db.execute(
                "SELECT 1 FROM contracts WHERE card=? AND state IN ('pending','running')", (card,)).fetchone():
            return []
        questions = self.db.execute("SELECT COUNT(*) FROM entries WHERE card=? AND kind='ask'", (card,)).fetchone()[0]
        if questions >= MAX_QUESTIONS_PER_CARD:
            return []
        if stage != "auditor" and not self._public_review(card):
            owner = self._pending_review_owner(card)
            if stage == "worker":
                return [owner] if owner else []
            if owner != "auditor":
                return ["worker"]
        return [role for role in ROLES if role != stage]

    def _current_claim(self, job):
        row = self._get(job["id"])
        return row["state"] == "running" and row["claim"] == job["token"] and row["stage"] == job["stage"]

    def _newer_note(self, card, token):
        return self.db.execute("SELECT 1 FROM entries WHERE card=? AND kind='note' AND seq>?", (card, token)).fetchone()

    def ask(self, job, target, question):
        card, stage = job["id"], job["stage"]
        with self.write():
            if not self._current_claim(job):
                return False
            if target not in self._ask_targets(card, stage) or not isinstance(question, str) or not question.strip():
                raise ValueError("지금 질문할 수 있는 동료와 구체적인 질문을 선택하세요.")
            if self._newer_note(card, job["token"]):
                self._post(card, stage, "draft", question.strip())
                self._set(card, "worker", "ready")
                return False
            question = question.strip()
            seq = self._post(card, stage, "ask", f"{ROLES[stage]} → {ROLES[target]}\n{question}")
            self.db.execute("INSERT INTO consultations(card,seq,requester,target,question) VALUES(?,?,?,?,?)",
                            (card, seq, stage, target, question))
            self._set(card, target, "ready")
            return True

    def _return_answer(self, card, pending, body, *, stage=None, kind="answer"):
        sender, recipient = pending["target"], pending["requester"]
        self._post(card, sender, kind, f"{ROLES[sender]} → {ROLES[recipient]}\n{body}")
        self.db.execute("DELETE FROM consultations WHERE card=?", (card,))
        self._set(card, stage or recipient, "ready")

    def answer(self, job, body):
        card = job["id"]
        with self.write():
            if not self._current_claim(job):
                return False
            pending = self._consultation(card)
            if not pending or pending["target"] != job["stage"] or not isinstance(body, str) or not body.strip():
                raise ValueError("배정된 질문에 답변을 남기세요.")
            next_stage = "worker" if self._newer_note(card, job["token"]) else pending["requester"]
            self._return_answer(card, pending, body.strip(), stage=next_stage)
            return True

    def progress(self, job, body):
        with self.write():
            if self._get(job["id"])["claim"] == job["token"]:
                self._post(job["id"], job["stage"], "progress", body)

    def _failure_destination(self, card, stage, action):
        if stage in {"worker", "reviewer"} and action in {"error", "interrupt"}:
            repeated = self.db.execute("""SELECT COUNT(*) FROM entries WHERE card=? AND role=?
                AND kind IN ('interrupt','error') AND seq > COALESCE((SELECT MAX(seq) FROM entries
                WHERE card=? AND kind IN ('submit','approve','close','revise','escalate','resume_review')),0)""",
                (card, stage, card)).fetchone()[0] > 1
            if stage == "reviewer":
                if repeated:
                    self._post(card, stage, "escalate", "검토 실행이 연속 두 번 중단돼 장애 원인과 복구 범위를 모건에게 인계합니다.")
                    return "auditor", "ready"
                if action == "error":
                    return "reviewer", "ready"
            elif action == "error" or repeated:
                reason = "CLI 실행 오류가 업무를 중단했습니다." if action == "error" else "같은 업무의 실행이 반복해서 중단됐습니다."
                if self._pending_review_owner(card) == "auditor":
                    return "auditor", "ready"
                self._post(card, stage, "escalate", reason + " 원인과 영향 범위를 확인하세요.")
                return "reviewer", "ready"
        return stage, "blocked"

    def finish(self, job, action, body):
        stage, card = job["stage"], job["id"]
        if action not in TRANSITIONS[stage] and action not in {"error", "interrupt"}:
            raise ValueError(f"{ROLES[stage]}의 처리 결과를 인식할 수 없습니다.")
        if not isinstance(body, str) or not body.strip():
            raise ValueError("에이전트의 칠판 기록이 비어 있습니다.")
        files = []
        workspace = self.workspace(card)
        if stage == "worker" and action in {"submit", "escalate"} and workspace.is_dir():
            for base, folders, names in os.walk(workspace):
                parent = Path(base)
                folders[:] = [n for n in folders if n != ".contract-work" and not n.startswith(".board-history-")
                              and (parent / n).resolve() == parent / n]
                for name in names:
                    path = parent / name
                    if path.resolve() == path and path.is_file() and path.stat().st_nlink == 1:
                        files.append(str(path.relative_to(workspace)))
            files.sort()
        with self.write():
            if not self._current_claim(job):
                return False
            pending = self._consultation(card)
            if pending:
                if action not in {"error", "interrupt", "blocked"}:
                    raise ValueError("질문에 답변한 뒤 원래 담당자에게 업무를 돌려주세요.")
                next_stage = "worker" if self._newer_note(card, job["token"]) else pending["requester"]
                self._return_answer(card, pending, "답변을 완료하지 못했습니다. " + body, stage=next_stage)
                return True
            if stage == "worker" and action == "submit" and job.get("accepted_contract"):
                contract, review = job["accepted_contract"]
                self.contract_review(job, contract, True, review)
            if stage == "worker" and action in {"submit", "escalate"} and self.db.execute(
                    "SELECT 1 FROM contracts WHERE card=? AND state IN ('running','pending')", (card,)).fetchone():
                raise ValueError("계약직 결과를 실무자가 먼저 검수해야 합니다.")
            if stage == "worker" and action in {"blocked", "error", "interrupt"}:
                self._interrupt_contracts(card)
            if files:
                self._post(card, stage, "files", f"{workspace}\n" + "\n".join(files))
            newer_note = self._newer_note(card, job["token"])
            if newer_note:
                self._post(card, stage, "draft" if action not in {"error", "interrupt"} else action, body)
                self._set(card, "worker", "ready")
            else:
                review_owner = self._pending_review_owner(card) if stage == "worker" and action in {"submit","escalate"} else None
                if action == "escalate" and review_owner == "auditor":
                    # Report directly into the open audit after Morgan requested remediation.
                    # Keep the last escalation/revision intact for any concurrent follow-up.
                    action = "submit"
                strict = self._public_review(card) if action in {"submit","approve","close"} else False
                pending = self._public_result_pending(card, stage) if strict and action in {"approve","close"} else None
                self._post(card, stage, "resume_review" if pending else action, body)
                if pending:
                    destination = (pending, "ready")
                elif action in {"error", "interrupt"}:
                    destination = self._failure_destination(card, stage, action)
                elif action in {"submit", "approve"} and strict:
                    destination = ("reviewer" if stage == "worker" else "auditor", "ready")
                elif review_owner:
                    destination = (review_owner, "ready")
                else:
                    destination = TRANSITIONS[stage][action]
                self._set(card, *destination)
        return True

    def _interrupt_contracts(self, card):
        rows = self.db.execute("SELECT id FROM contracts WHERE card=? AND state='running'", (card,)).fetchall()
        for row in rows:
            reason = "실무자 실행이 종료되어 계약 결과 제출 전에 중단됐습니다."
            self.db.execute("UPDATE contracts SET state='failed', result=? WHERE id=?", (reason, row["id"]))
            self._post(card, "contractor", "contract_interrupt", f"계약 {row['id']}\n{reason}")

    def recover(self, *, public_only=False, preserve_public=False):
        # The primary holds runner.lock. During recovery the secondary's separate
        # OS lock determines whether its precise card/claim remains live.
        leased = "EXISTS (SELECT 1 FROM public_worker_lease l WHERE l.card=cards.id AND l.claim=cards.claim)"
        where = (" AND " + leased) if public_only else (" AND NOT " + leased) if preserve_public else ""
        with self.write():
            for row in self.db.execute("SELECT * FROM cards WHERE state='running'" + where).fetchall():
                self.db.execute("UPDATE cli_invocations SET ended=?,status='interrupted' WHERE claim=? AND ended IS NULL",
                                (time.time(), row["claim"]))
                pending = self._consultation(row["id"])
                if pending:
                    next_stage = "worker" if self._newer_note(row["id"], row["claim"]) else pending["requester"]
                    self._return_answer(row["id"], pending, "답변 실행이 중단되었습니다. 기존 기록에서 이어가세요.", stage=next_stage)
                    continue
                self._interrupt_contracts(row["id"])
                self._post(row["id"], row["stage"], "interrupt", "이전 실행이 종료되었습니다. 기록과 산출물을 확인한 뒤 다시 실행할 수 있습니다.")
                self._set(row["id"], *self._failure_destination(row["id"], row["stage"], "interrupt"))
            self.db.execute("""DELETE FROM public_worker_lease WHERE NOT EXISTS
                (SELECT 1 FROM cards c WHERE c.id=public_worker_lease.card
                AND c.state='running' AND c.claim=public_worker_lease.claim)""")
