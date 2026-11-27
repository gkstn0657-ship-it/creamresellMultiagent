"""Serve the shared board on loopback while Codex CLI processes execute in the background."""

import argparse
import asyncio
import hashlib
import json
import os
import re
import shutil
import socket
import sqlite3
import stat
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit
from urllib.request import urlopen

import chat_delivery
from agents import RunnerBusy, RunnerLock, Team
from board import Board, DEFAULT_DATA, LABELS, ROLES, STATES
from briefing import BriefingFeed
from daily_reading import reading_candidates
from external_activity import ExternalActivityFeed, roots_for_board
from literature_feed import LiteratureFeed
from preferences import BriefingPreferences
from naver_work import activities as naver_activities, monitor as monitor_naver
from sourcing_incidents import install_observer, observation
import cli_usage
from source_links import attach_source_work_ids


WEB = Path(__file__).with_name("web")
PORT = 48731
MAX_POST = 128 * 1024
STATIC_FILES = {
    "/": "text/html; charset=utf-8",
    "/index.html": "text/html; charset=utf-8",
    "/style.css": "text/css; charset=utf-8",
    "/app.js": "text/javascript; charset=utf-8",
    "/orb.js": "text/javascript; charset=utf-8",
    "/agent-board.ico": "image/x-icon",
    "/vendor/three.min.js": "text/javascript; charset=utf-8",
    "/vendor/space-grotesk.woff2": "font/woff2",
    "/vendor/jetbrains-mono.woff2": "font/woff2",
}


# Source cards and their notification channels both keep a complete transcript.
# Only the all-cards view suppresses a verified relay of the same event.
MIRRORED_KINDS = {
    "협의 요청": {"ask"}, "협의 답변": {"answer"}, "조치 경과": {"submit", "approve", "revise"},
    "감사 응답": {"start", "close", "blocked", "error", "revise", "interrupt"},
}


def chat_entries(board, after):
    entries = board.timeline(after)
    chat_delivery.attach(board, entries, after)
    for entry in entries:
        kinds = MIRRORED_KINDS.get(entry["kind"])
        if not kinds:
            continue
        prefix, separator, text = entry["body"].partition(" · ")
        if not separator or not re.fullmatch(r"#[1-9][0-9]{0,17}", prefix):
            continue
        originals = board.db.execute(
            "SELECT kind,body FROM entries WHERE card=? AND at=? AND role=? AND seq<?",
            (int(prefix[1:]), entry["at"], entry["role"], entry["seq"]))
        for kind, body in originals:
            if kind in kinds and (text == body or (kind == "start" and text == "감사총무가 확인을 시작했습니다.")):
                entry["channelCopy"] = True
                break
    return entries


class BoardServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port, board, team, *, preferences_directory=None):
        chat_delivery.initialize(board)
        install_observer(board)
        self.directory = board.directory
        self.team = team
        self.external_activity = ExternalActivityFeed(roots_for_board(self.directory))
        self.briefing = BriefingFeed(self.directory)
        self.literature = LiteratureFeed(self.directory)
        self.preferences = BriefingPreferences(preferences_directory or self.directory)
        super().__init__(("127.0.0.1", port), Handler)

    def briefing_payload(self):
        passages, lines = reading_candidates()
        feed = self.briefing.snapshot(all_candidates=True)
        prefs = self.preferences
        shelf = prefs.select("quote", self.literature.readings(passages))
        line, = prefs.select("line", lines, 1)
        topics = prefs.select("topic", feed["topics"])
        return {**feed, "topics": topics, "quotes": shelf, "quote": shelf[0], "line": line["text"],
                "lineItem": line, "savedCount": prefs.saved_count()}

    def server_bind(self):
        if os.name == "nt":
            self.allow_reuse_address = False
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def board_key(directory):
    return hashlib.sha256(str(directory).casefold().encode()).hexdigest()[:20]


def personal_profile_directory():
    if os.name == "nt":
        root = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    else:
        root = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return root / "Agent Mission Control" / "Personal Library"


class Handler(BaseHTTPRequestHandler):
    server_version = "TeamBoard"

    def log_message(self, *_):
        pass

    def headers_for(self, status, mime, size, extra=()):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        for name, value in extra:
            self.send_header(name, value)
        self.end_headers()

    def reply(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode()
        self.headers_for(status, "application/json; charset=utf-8", len(data))
        self.wfile.write(data)

    def permitted(self, *, write=False):
        host = self.headers.get("Host", "")
        names = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        origin = self.headers.get("Origin")
        if host not in names or (origin and origin != "http://" + host):
            self.reply(403, {"error": "이 칠판 주소에서 접속하세요."})
            return False
        if write and (self.headers.get("X-Team-Board") != "1" or self.headers.get_content_type() != "application/json"):
            self.reply(403, {"error": "칠판 화면에서 요청을 전송하세요."})
            return False
        return True

    def do_GET(self):
        if not self.permitted():
            return
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        try:
            if url.path == "/api/health":
                self.reply(200, {"app": "team-board", "board": board_key(self.server.directory), "assets": 6})
            elif url.path == "/api/briefing":
                self.reply(200, self.server.briefing_payload())
            elif url.path == "/api/briefing/hearts":
                items = self.server.preferences.saved()
                self.reply(200, {"items": items, "savedCount": len(items),
                                 "interests": self.server.preferences.interests()})
            elif url.path == "/api/board":
                after = int(query.get("after", ["0"])[0])
                if not 0 <= after <= 2**63 - 1:
                    raise ValueError
                board = Board(self.server.directory, initialize=False)
                try:
                    board.db.execute("BEGIN")
                    cards, entries = board.cards(), chat_entries(board, after)
                    attach_source_work_ids(board, cards)
                    naver = naver_activities(board)
                    observed = observation(board)
                    usage = cli_usage.summary(board.db)
                finally:
                    board.db.close()
                roles = {k: {"name": name, "activity": self.server.team.activity.get(k)} for k, name in ROLES.items()}
                roles["auditor"]["observation"] = observed
                self.reply(200, {"cards": cards, "entries": entries, "roles": roles, "modelUsage": usage,
                                 "externalActivities": self.server.external_activity.snapshot() + naver, "now": time.time()})
            elif match := re.fullmatch(r"/api/tasks/([1-9][0-9]*)/file", url.path):
                self.download(int(match[1]), query.get("path", [""])[0])
            elif url.path in STATIC_FILES:
                path = WEB / (url.path.lstrip("/") or "index.html")
                data = path.read_bytes()
                self.headers_for(200, STATIC_FILES[url.path], len(data))
                self.wfile.write(data)
            else:
                self.reply(404, {"error": "주소를 찾을 수 없습니다."})
        except (ValueError, OverflowError):
            self.reply(400, {"error": "요청 값을 확인하세요."})
        except sqlite3.OperationalError:
            self.reply(503, {"error": "저장소에 연결하지 못했습니다. 잠시 후 다시 시도하세요."})
        except (FileNotFoundError, PermissionError):
            self.reply(404, {"error": "파일을 찾을 수 없습니다."})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def download(self, card, name):
        # Serve only files the worker actually published on this card.
        board = Board(self.server.directory, initialize=False)
        try:
            published = {s.replace("\\", "/") for e in board.history(card) if e["kind"] == "files"
                         for s in e["body"].splitlines()[1:]}
        finally:
            board.db.close()
        name = name.replace("\\", "/")
        if name not in published or any(s in {"", ".", ".."} or ":" in s for s in name.split("/")):
            raise FileNotFoundError
        root = self.server.directory / "work" / str(card)
        path = root / name
        if root.resolve() != root or path.resolve() != path:
            raise FileNotFoundError
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise FileNotFoundError
        with path.open("rb") as stream:
            actual = os.fstat(stream.fileno())
            if not os.path.samestat(info, actual) or actual.st_nlink != 1:
                raise FileNotFoundError
            self.headers_for(200, "application/octet-stream", actual.st_size,
                             [("Content-Disposition", "attachment; filename*=UTF-8''" + quote(path.name))])
            shutil.copyfileobj(stream, self.wfile)

    def do_POST(self):
        if not self.permitted(write=True):
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_POST:
                self.reply(413, {"error": "요청 크기를 확인하세요."})
                return
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError("요청 형식이 올바르지 않습니다.")
            if self.path == "/api/briefing/hearts":
                item_id, liked = body.get("id"), body.get("liked")
                if not isinstance(item_id, str) or not 0 < len(item_id) <= 128 or type(liked) is not bool:
                    raise ValueError("항목과 하트 상태를 확인해 주세요.")
                try:
                    item = self.server.preferences.set_liked(item_id, liked)
                except KeyError:
                    self.reply(404, {"error": "브리핑에서 표시한 항목을 찾지 못했습니다."})
                    return
                self.reply(200, {"item": item, "savedCount": self.server.preferences.saved_count()})
                return
            token = body.get("requestId")
            if not isinstance(token, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", token):
                raise ValueError("접수 번호가 올바르지 않습니다.")
            card, kind = None, "add"
            if self.path != "/api/tasks":
                match = re.fullmatch(r"/api/tasks/([1-9][0-9]*)/(notes|retry)", self.path)
                if not match:
                    self.reply(404, {"error": "주소를 찾을 수 없습니다."})
                    return
                card, kind = int(match[1]), "note" if match[2] == "notes" else "retry"
            text = body.get("text", "")
            if not isinstance(text, str):
                raise ValueError("요청 내용을 입력하세요.")
            board = Board(self.server.directory, initialize=False)
            try:
                personal = body.get("client") == "dashboard" or bool(chat_delivery.BROWSER_TOKEN.fullmatch(token))
                receipt = chat_delivery.submit(board,token,kind,card,text,personal)
            finally:
                board.db.close()
            self.reply(200, receipt)
        except sqlite3.OperationalError:
            self.reply(503, {"error": "저장하지 못했습니다. 잠시 후 다시 시도하세요."})
        except (ValueError, OverflowError, UnicodeError) as exc:
            self.reply(400, {"error": str(exc)})


def public_worker_lock(board):
    directory = board.directory / "public-sourcing" / "worker"
    directory.mkdir(parents=True, exist_ok=True)
    return RunnerLock(directory)


def recover_primary(board):
    try:
        with public_worker_lock(board):
            board.recover()
    except RunnerBusy:
        board.recover(preserve_public=True)


async def serve_public_worker(board):
    stop = board.directory / "public-sourcing" / "STOP"
    try:
        with public_worker_lock(board):
            board.recover(public_only=True)
            await Team(board).serve("worker", public_only=True, stop_requested=stop.exists)
    except RunnerBusy:
        return


async def serve(board, port, open_browser):
    team = Team(board)
    url = f"http://127.0.0.1:{port}/"
    try:
        server = BoardServer(port, board, team, preferences_directory=personal_profile_directory())
    except OSError:
        try:
            with urlopen(url + "api/health", timeout=2) as reply:
                existing = json.load(reply)
        except (OSError, ValueError):
            existing = {}
        if existing.get("app") != "team-board" or existing.get("board") != board_key(board.directory):
            raise RuntimeError(f"포트 {port}를 사용할 수 없습니다.")
        if open_browser:
            webbrowser.open(url)
        return

    with server, RunnerLock(board.directory):
        recover_primary(board)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        tasks = [asyncio.create_task(team.serve(stage)) for stage in ROLES]
        tasks.append(asyncio.create_task(monitor_naver(board)))
        try:
            if sys.stdout:
                print(url, flush=True)
            if open_browser:
                await asyncio.to_thread(webbrowser.open, url)
            await asyncio.gather(*tasks)
        finally:
            server.shutdown()
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            thread.join()


def main():
    cli = argparse.ArgumentParser(description="통합 칠판과 백그라운드 Codex CLI 팀")
    cli.add_argument("--data-dir", default=DEFAULT_DATA)
    commands = cli.add_subparsers(dest="command")
    server = commands.add_parser("serve")
    server.add_argument("--port", type=int, default=PORT)
    server.add_argument("--open", action="store_true", help="기본 브라우저에서 칠판 열기")
    commands.add_parser("add").add_argument("request")
    commands.add_parser("retry").add_argument("card", type=int)
    commands.add_parser("public-worker", help="공개 KREAM 상품 조사용 두 번째 실무자 실행")
    show = commands.add_parser("show")
    show.add_argument("card", type=int, nargs="?")
    show.add_argument("--json", action="store_true")
    args = cli.parse_args()
    board = Board(args.data_dir)
    try:
        if args.command == "add":
            print(f"#{board.add(args.request)} 업무 등록")
        elif args.command == "retry":
            board.retry(args.card)
        elif args.command == "public-worker":
            asyncio.run(serve_public_worker(board))
        elif args.command == "show":
            cards = board.cards()
            if args.card is not None:
                cards = [c for c in cards if c["id"] == args.card]
                if not cards:
                    cli.exit(1, "업무를 찾을 수 없습니다.\n")
                cards[0].update(entries=board.history(args.card), workspace=str(board.workspace(args.card)))
            if args.json:
                print(json.dumps(cards, ensure_ascii=False))
            else:
                for card in cards:
                    print(f"#{card['id']} {ROLES[card['stage']]} · {STATES[card['state']]}  {card['request']}")
                    for entry in card.get("entries", []):
                        author = "계약직" if entry["role"] == "contractor" else ROLES.get(entry["role"], "사용자")
                        print(f"  {author} · {LABELS.get(entry['kind'], entry['kind'])}  {entry['body']}")
        else:
            asyncio.run(serve(board, getattr(args, "port", PORT), getattr(args, "open", False)))
    finally:
        board.db.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        if sys.stderr is None and os.name == "nt":
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, str(error), "통합 칠판 실행 오류", 16)
        else:
            raise
