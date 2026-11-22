"""Native desktop board. Network and Explorer-window ownership live in the launcher."""

from datetime import datetime, timedelta, timezone
import tkinter as tk
from tkinter import font, ttk

from board import LABELS, ROLES, ROLE_TITLES, STATES


INK, MOSS, MINT = "#17392f", "#124a3b", "#a6ecd0"
PAPER, PANEL, LINE, MUTED = "#ffffff", "#f2f6f3", "#d5e1da", "#506a60"
PEOPLE = {**ROLES, "contractor": "계약직", "user": "나"}
COLORS = {"worker": "#17694d", "reviewer": "#654992", "auditor": "#865a27",
          "contractor": "#246f85", "user": "#385f9a"}
KST = timezone(timedelta(hours=9))


class BoardWidget:
    def __init__(self, root, on_post, on_close, on_drag_start, on_drag_move, on_drag_end):
        self.root = root
        self.on_post = on_post
        self.scope = None
        self.cards = {}
        self.entries = []
        self.last_seq = 0
        self.day = None
        self.online = False
        self.pending = None
        self.drafts = {}
        self.role_labels = {}
        self.metric_labels = {}
        self.empty_chat = True
        self.card_signature = None
        families = set(font.families(root))
        self.family = next((name for name in ("Pretendard", "Noto Sans KR", "Malgun Gothic") if name in families),
                           "TkDefaultFont")
        root.configure(bg=LINE)
        self.frame = tk.Frame(root, bg=PAPER, bd=0)
        self.frame.pack(expand=True, fill="both", padx=1, pady=1)

        bar = tk.Frame(self.frame, bg=INK, height=49)
        bar.pack(fill="x")
        bar.pack_propagate(False)
        mark = tk.Canvas(bar, width=28, height=28, bg=INK, highlightthickness=0)
        mark.pack(side="left", padx=(15, 8))
        for x, y in [(4, 8), (14, 4)]:
            mark.create_polygon(x, y + 15, x+5, y, x+12, y, x+7, y+15, fill=MINT, outline="")
        title = self._label(bar, "통합 칠판", 18, "#ffffff", INK, True)
        title.pack(side="left")
        self.date_label = self._label(bar, "", 11, "#b4d2c2", INK)
        self.date_label.pack(side="left", padx=12)
        close = self._button(bar, "닫기", on_close, INK, "#e0eee8")
        close.pack(side="right", padx=(5, 10))
        self.connection = self._label(bar, "●  연결 확인 중", 12, "#d3de99", INK)
        self.connection.pack(side="right", padx=8)
        for surface in (bar, mark, title, self.date_label):
            surface.configure(cursor="fleur")
            for sequence, callback in [("<ButtonPress-1>", on_drag_start),
                                       ("<B1-Motion>", on_drag_move), ("<ButtonRelease-1>", on_drag_end)]:
                surface.bind(sequence, callback)

        body = tk.Frame(self.frame, bg=LINE)
        body.pack(fill="both", expand=True)
        body.columnconfigure(0, weight=36, uniform="body")
        body.columnconfigure(1, weight=64, uniform="body")
        body.rowconfigure(0, weight=1)
        left = tk.Frame(body, bg=PANEL)
        left.grid(row=0, column=0, sticky="nsew")
        right = tk.Frame(body, bg=PAPER)
        right.grid(row=0, column=1, sticky="nsew", padx=(1, 0))
        self._build_board(left)
        self._build_chat(right)
        self._render_chat()
        self._controls()

    def _font(self, px=13, bold=False):
        return (self.family, -px, "bold" if bold else "normal")

    def _label(self, parent, text, size=13, fg=INK, bg=PAPER, bold=False, **extra):
        return tk.Label(parent, text=text, fg=fg, bg=bg, font=self._font(size, bold),
                        anchor="w", bd=0, **extra)

    def _button(self, parent, text, cmd, bg=PANEL, fg=MOSS):
        return tk.Button(parent, text=text, command=cmd, font=self._font(12, True), bg=bg, fg=fg,
                         activebackground="#c8dfd2", activeforeground=INK, disabledforeground="#8a9b92",
                         relief="flat", bd=0, highlightthickness=0, padx=8, pady=3, cursor="hand2")

    def _build_board(self, panel):
        panel.columnconfigure(0, weight=1)
        panel.rowconfigure(3, weight=1)
        metrics = tk.Frame(panel, bg="#e1eee5")
        metrics.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 8))
        for col, (key, title) in enumerate([("running", "진행 중"), ("ready", "대기"),
                                             ("blocked", "확인 필요"), ("done", "완료")]):
            metrics.columnconfigure(col, weight=1, uniform="stats")
            cell = tk.Frame(metrics, bg="#e1eee5")
            cell.grid(row=0, column=col, sticky="ew", pady=7)
            self._label(cell, title, 11, MUTED, "#e1eee5").pack()
            number = self._label(cell, "–", 21, MOSS, "#e1eee5", True)
            number.pack()
            self.metric_labels[key] = number

        agents = tk.Frame(panel, bg=PANEL)
        agents.grid(row=1, column=0, sticky="ew", padx=14)
        agents.columnconfigure(1, weight=1)
        for row, (role, label) in enumerate(ROLES.items()):
            self._label(agents, "●", 11, COLORS[role], PANEL).grid(row=row, column=0, padx=(1, 7))
            self._label(agents, f"{label} · {ROLE_TITLES[role]}", 13, INK, PANEL, True).grid(row=row, column=1, sticky="w", pady=3)
            value = self._label(agents, "대기", 12, MUTED, PANEL)
            value.grid(row=row, column=2, sticky="e")
            self.role_labels[role] = value

        heading = tk.Frame(panel, bg=PANEL)
        heading.grid(row=2, column=0, sticky="ew", padx=13, pady=(12, 5))
        self.task_title = self._label(heading, "업무 목록", 15, INK, PANEL, True)
        self.task_title.pack(side="left")
        self.retry = self._button(heading, "다시 실행", self._retry, "#e2eae4")
        self.retry.pack(side="right")

        style = ttk.Style(panel)
        style.configure("Board.Treeview", rowheight=29, borderwidth=0, relief="flat",
                        font=self._font(13), background=PAPER, fieldbackground=PAPER, foreground=INK)
        style.map("Board.Treeview", background=[("selected", "#d6ecdf")], foreground=[("selected", INK)])
        rows = tk.Frame(panel, bg=LINE, bd=0)
        rows.grid(row=3, column=0, sticky="nsew", padx=12, pady=(0, 12))
        self.tasks = ttk.Treeview(rows, style="Board.Treeview", columns=("name", "state"),
                                  show="tree", selectmode="browse", height=2)
        self.tasks.column("#0", width=0, minwidth=0, stretch=False)
        self.tasks.column("name", minwidth=68, width=132, stretch=True)
        self.tasks.column("state", minwidth=60, width=60, stretch=False, anchor="center")
        self.tasks.tag_configure("blocked", foreground="#95552c")
        self.tasks.tag_configure("done", foreground="#4a6b5a")
        scroll = ttk.Scrollbar(rows, orient="vertical", command=self.tasks.yview)
        self.tasks.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y", pady=1)
        self.tasks.pack(side="left", expand=True, fill="both", padx=(1, 0), pady=1)
        self.tasks.bind("<<TreeviewSelect>>", self._tree_select)

    def _build_chat(self, panel):
        panel.columnconfigure(0, weight=1)
        panel.rowconfigure(1, weight=1)
        heading = tk.Frame(panel, bg=PAPER)
        heading.grid(row=0, column=0, sticky="ew", padx=14, pady=(10, 6))
        self.chat_title = self._label(heading, "업무 채팅", 16, INK, PAPER, True)
        self.chat_title.pack(side="left")
        self.scope_button = self._button(heading, "전체 업무", lambda: self._select(None), "#eef4ef")
        self.scope_button.pack(side="right")

        area = tk.Frame(panel, bg=PAPER)
        area.grid(row=1, column=0, sticky="nsew", padx=(10, 4))
        self.log = tk.Text(area, wrap="char", font=self._font(14), fg=INK, bg=PAPER, relief="flat", bd=0,
                           highlightthickness=0, width=5, height=3, padx=4, pady=2, cursor="arrow",
                           state="disabled", takefocus=1, exportselection=False, selectbackground="#cce7da")
        scroll = ttk.Scrollbar(area, orient="vertical", command=self.log.yview)
        self.log.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.log.pack(side="left", fill="both", expand=True)
        for role in PEOPLE:
            self.log.tag_configure(role, foreground=COLORS[role], font=self._font(13, True), spacing1=6)
        self.log.tag_configure("meta", foreground=MUTED, font=self._font(11), spacing1=3)
        self.log.tag_configure("day", foreground=MOSS, background="#edf4ef", justify="center",
                               font=self._font(11, True), spacing1=6, spacing3=5)
        self.log.tag_configure("body", lmargin1=4, lmargin2=4, spacing1=2, spacing2=3, spacing3=5)
        self.log.tag_configure("progress", foreground=MUTED, font=self._font(12), spacing1=1, spacing3=3)
        self.log.tag_configure("attention", foreground="#90451e")
        self.log.tag_configure("ok", foreground="#196546")

        divider = tk.Frame(panel, bg=LINE, height=1)
        divider.grid(row=2, column=0, sticky="ew", pady=(4, 0))
        compose = tk.Frame(panel, bg="#f7faf7")
        compose.grid(row=3, column=0, sticky="ew")
        compose.columnconfigure(0, weight=1)
        compose_head = tk.Frame(compose, bg="#f7faf7")
        compose_head.grid(row=0, column=0, columnspan=2, sticky="ew", padx=11, pady=(5, 2))
        self.mode_label = self._label(compose_head, "새 요청", 12, MOSS, "#f7faf7", True)
        self.mode_label.pack(side="left")
        self.notice = self._label(compose_head, "Ctrl+Enter 전송", 11, MUTED, "#f7faf7")
        self.notice.pack(side="right")
        self.input = tk.Text(compose, height=2, width=3, relief="flat", wrap="char", font=self._font(14),
                             foreground=INK, background=PAPER, highlightthickness=1, highlightbackground=LINE,
                             highlightcolor="#3c906d", padx=6, pady=4, undo=True, insertbackground=INK)
        self.input.grid(row=1, column=0, sticky="ew", padx=(10, 5), pady=(0, 9))
        self.send = self._button(compose, "보내기", self._send, MOSS, "#ffffff")
        self.send.grid(row=1, column=1, sticky="ns", padx=(0, 10), pady=(0, 9))
        self.input.bind("<Control-Return>", self._send)

    def set_connected(self, online):
        self.online = bool(online)
        self.connection.configure(text="●  실시간 연결" if self.online else "●  재연결 중",
                                  fg=MINT if self.online else "#e9c883")
        if not self.online:
            for badge in self.role_labels.values():
                badge.configure(text="연결 확인 중",fg=MUTED)
        self._controls()

    def _controls(self):
        available = self.online and self.pending is None
        can_retry = available and self.cards.get(self.scope, {}).get("state") == "blocked"
        self.retry.configure(state="normal" if can_retry else "disabled")
        self.send.configure(state="normal" if available else "disabled")

    def _retry(self):
        if self.scope is not None:
            self._post("retry", self.scope, "")

    def _send(self, _event=None):
        text = self.input.get("1.0", "end-1c").strip()
        if text:
            self._post("add" if self.scope is None else "note", self.scope, text)
        else:
            self.notice.configure(text="요청 내용을 입력하세요.", fg=MUTED)
            self.input.focus_set()
        return "break"

    def _post(self, kind, card, text):
        if self.pending is not None or not self.online:
            return
        self.pending = (kind, card, text)
        self._controls()
        self.notice.configure(text="전송 중…", fg=MUTED)
        try:
            self.on_post(kind, card, text)
        except Exception as exc:
            self.post_finished(False, str(exc))

    def post_finished(self, ok, message):
        pending, self.pending = self.pending, None
        if ok and pending and pending[0] != "retry":
            _, card, sent = pending
            if card == self.scope and self.input.get("1.0", "end-1c").strip() == sent:
                self.input.delete("1.0", "end")
            if self.drafts.get(card, "").strip() == sent:
                self.drafts.pop(card, None)
        self.notice.configure(text=message or ("접수했습니다." if ok else "전송하지 못했습니다."),
                              fg=MOSS if ok else "#954a2c")
        self._controls()

    def _tree_select(self, _event):
        selection = self.tasks.selection()
        if selection:
            self._select(int(selection[0]))

    def _select(self, card):
        if card == self.scope:
            return
        self.drafts[self.scope] = self.input.get("1.0", "end-1c")
        self.scope = card
        if card is None:
            self.tasks.selection_remove(*self.tasks.selection())
        self.input.delete("1.0", "end")
        self.input.insert("1.0", self.drafts.get(card, ""))
        self.chat_title.configure(text="업무 채팅" if card is None else f"업무 채팅   #{card}")
        self.mode_label.configure(text="새 요청" if card is None else f"#{card} 추가 지시")
        self.scope_button.configure(text="전체 업무" if card is None else "전체 보기")
        self.notice.configure(text="Ctrl+Enter 전송", fg=MUTED)
        self._render_chat()
        self._controls()

    def _render_chat(self):
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.day = None
        self.empty_chat = True
        for entry in self.entries:
            if self.scope is None or entry["card"] == self.scope:
                self._append(entry)
        if self.empty_chat:
            self.log.insert("end", "새 요청을 입력하면 진행 상황이 여기에 표시됩니다.", "meta")
        self.log.configure(state="disabled")
        self.log.see("end")

    def _append(self, entry):
        if self.empty_chat:
            self.log.delete("1.0", "end")
            self.empty_chat = False
        stamp = datetime.fromtimestamp(entry["at"], KST)
        if self.day != stamp.date():
            self.day = stamp.date()
            self.log.insert("end", f"{stamp.year}.{stamp.month:02d}.{stamp.day:02d}\n", "day")
        role, kind, body = entry["role"], entry["kind"], entry["body"]
        name = PEOPLE.get(role, role)
        meta = f"{stamp:%H:%M}  ·  #{entry['card']}"
        if kind == "progress":
            self.log.insert("end", f"{meta}   {name} · {body}\n", "progress")
            return
        self.log.insert("end", name + "  ", role)
        self.log.insert("end", f"{LABELS.get(kind, kind)}   {meta}\n", "meta")
        if body:
            tags = ["body"]
            if kind in {"blocked", "error", "interrupt", "revise", "escalate", "장애 수신", "contract_reject", "contract_interrupt"}:
                tags.append("attention")
            elif kind in {"close", "contract_accept"}:
                tags.append("ok")
            self.log.insert("end", body + "\n", tuple(tags))

    def apply_snapshot(self, snapshot):
        roles = snapshot.get("roles", {})
        cards = [{**c,"state":"실행 확인 중"} if c["state"]=="running" and c["stage"] in ("reviewer","auditor")
                 and not roles.get(c["stage"],{}).get("activity") else c for c in snapshot.get("cards", [])]
        self.cards = {card["id"]: card for card in cards}
        signature = [(card["id"], card["state"], card["stage"], card["request"]) for card in cards]
        if signature != self.card_signature:
            self.card_signature = signature
            self.task_title.configure(text=f"업무 목록   {len(cards)}")
            for item in self.tasks.get_children():
                if int(item) not in self.cards:
                    self.tasks.delete(item)
            for pos, card in enumerate(cards):
                item = str(card["id"])
                request = " ".join(card["request"].split())
                status = "제임스 직접 마감" if (card["stage"], card["state"]) == ("worker", "done") else STATES.get(card["state"], card["state"])
                values = (f"#{item}   {request}", status)
                options = dict(values=values, tags=(card["state"],))
                if self.tasks.exists(item):
                    self.tasks.item(item, **options)
                    self.tasks.move(item, "", pos)
                else:
                    self.tasks.insert("", pos, iid=item, **options)
            for key, label in self.metric_labels.items():
                label.configure(text=str(sum(c["state"] == key for c in cards)))
            if self.scope is not None and self.scope not in self.cards:
                self._select(None)
        for role, badge in self.role_labels.items():
            owned = [c for c in cards if c["stage"] == role and c["state"] != "done"]
            work = next((c for state in ("running", "ready", "blocked","실행 확인 중") for c in owned if c["state"] == state), None)
            if work:
                status = roles.get(role, {}).get("activity") if work["state"] == "running" else None
                status = (status or STATES.get(work["state"], work["state"])).splitlines()[0]
                status = status[:14] + ("…" if len(status) > 14 else "")
                badge.configure(text=f"#{work['id']} · {status}", fg=COLORS[role])
            else:
                observation = role == "auditor" and roles.get(role,{}).get("observation")
                badge.configure(text=f"감시 중 · #{observation['card']}" if observation else "대기", fg=MUTED)
        stamp = datetime.fromtimestamp(snapshot["now"], KST) if snapshot.get("now") else datetime.now(KST)
        self.date_label.configure(text=f"{stamp.month}월 {stamp.day}일")
        incoming = [e for e in snapshot.get("entries", []) if e["seq"] > self.last_seq]
        if incoming:
            self.entries.extend(incoming)
            self.last_seq = incoming[-1]["seq"]
            follow = self.empty_chat or self.log.yview()[1] >= .985
            self.log.configure(state="normal")
            for entry in incoming:
                if self.scope is None or entry["card"] == self.scope:
                    self._append(entry)
            self.log.configure(state="disabled")
            if follow:
                self.log.see("end")
        self.set_connected(True)
