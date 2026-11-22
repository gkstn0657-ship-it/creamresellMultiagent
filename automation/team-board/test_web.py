import json
import os
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from agents import Team
from board import Board
from dashboard import BoardServer


class SharedBoardTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.board = Board(temp.name)
        self.addCleanup(self.board.db.close)
        self.profile = Path(temp.name) / "test-user"
        server = BoardServer(0, self.board, Team(self.board), preferences_directory=self.profile)
        self.server = server
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join)
        self.addCleanup(server.shutdown)
        self.url = f"http://127.0.0.1:{server.server_port}"

    def post(self, path, token, text="", **headers):
        payload = json.dumps({"requestId": token, "text": text}).encode()
        headers.update({"Content-Type": "application/json", "X-Team-Board": "1"})
        with urlopen(Request(self.url + path, data=payload, headers=headers), timeout=5) as response:
            return json.load(response)

    def test_incremental_chat_marks_only_verifiable_channel_copies(self):
        work = self.board.add("무신사 검토")
        channel = self.board.add("무신사 알림")
        question = "재고가 확인된 옵션이 있나요?"
        source = self.board._post(work, "auditor", "ask", question)
        at = self.board.history(work)[-1]["at"]
        body = f"#{work} · {question}"
        self.board.db.execute("INSERT INTO entries(card,at,role,kind,body) VALUES(?,?,?,?,?)",
                              (channel, at, "auditor", "협의 요청", body))
        self.board._post(channel, "auditor", "협의 요청", "재고 수량을 다시 확인해 주세요.")
        with urlopen(self.url + f"/api/board?after={source}") as response:
            mirrored, different = json.load(response)["entries"]
        self.assertTrue(mirrored["channelCopy"])
        self.assertEqual(mirrored["body"], body)
        self.assertNotIn("channelCopy", different)

    def test_user_message_receipt_survives_retry_and_app_reload(self):
        one = "71965d7d-ff99-4a12-9ac2-71b1b5788001"
        two = "71965d7d-ff99-4a12-9ac2-71b1b5788002"
        first = self.post("/api/tasks", one, "같은 문장")
        self.assertEqual(self.post("/api/tasks", one, "같은 문장"), first)
        note = self.post(f"/api/tasks/{first['id']}/notes", two, "같은 문장")
        self.assertNotEqual(first["entry"]["seq"], note["entry"]["seq"])
        self.post("/api/tasks", "auto-probe", "같은 문장")
        with urlopen(self.url + "/api/board") as response:
            entries = json.load(response)["entries"]
        mine = [entry for entry in entries if entry.get("userSubmitted")]
        self.assertEqual(mine,[first["entry"],note["entry"]])
        self.assertEqual([entry["requestId"] for entry in mine],[one,two])

    def test_old_dashboard_submission_is_recognized_from_its_saved_fingerprint(self):
        import chat_delivery
        token = "11ce1e2b-a734-4378-8114-413ae7bd9fb1"
        self.board.submit(token,"add",text="기존 대화")
        self.board.add("자동 업무")
        chat_delivery.initialize(self.board)
        chat_delivery.initialize(self.board)
        with urlopen(self.url + "/api/board") as response:
            entries = json.load(response)["entries"]
        self.assertEqual([e["body"] for e in entries if e.get("userSubmitted")], ["기존 대화"])

    def test_desktop_assets_load_locally(self):
        with urlopen(self.url + "/api/health") as response:
            self.assertEqual(json.load(response)["assets"], 6)
        for path, mime in {
            "/orb.js": "text/javascript",
            "/agent-board.ico": "image/x-icon",
            "/vendor/three.min.js": "text/javascript",
            "/vendor/space-grotesk.woff2": "font/woff2",
            "/vendor/jetbrains-mono.woff2": "font/woff2",
        }.items():
            with self.subTest(path=path), urlopen(self.url + path) as response:
                self.assertEqual(response.headers.get_content_type(), mime)
                first_bytes = response.read(4)
                if mime == "font/woff2":
                    self.assertEqual(first_bytes, b"wOF2")
                elif mime == "image/x-icon":
                    self.assertEqual(first_bytes, bytes((0, 0, 1, 0)))
                else:
                    self.assertEqual(len(first_bytes), 4)
        with self.assertRaises(HTTPError) as missing:
            urlopen(self.url + "/vendor/unknown.js")
        self.assertEqual(missing.exception.code, 404)

    def test_hearts_survive_source_rotation_and_another_board(self):
        self.server.literature.readings = lambda items: items
        topic = {"kind": "topic", "title": "로봇을 위한 새 모델", "source": "OpenAI",
                 "url": "https://openai.com/index/test-robot/", "publishedAt": time.time(),
                 "tags": ["로봇", "모델"]}
        stories = [{**topic, "title": f"기사 {n}", "url": topic["url"] + str(n)} for n in range(6)]
        self.server.briefing.snapshot = Mock(return_value={"status": "live", "topics": stories})
        def read(path):
            with urlopen(self.url + path) as response:
                return json.load(response)

        def vote(item, liked, **headers):
            req = Request(self.url + "/api/briefing/hearts",
                          data=json.dumps({"id": item, "liked": liked}).encode(),
                          headers={"X-Team-Board": "1", "Content-Type": "application/json", **headers})
            with urlopen(req) as response:
                return json.load(response)

        initial = read("/api/briefing")
        self.assertGreater(len(initial["quotes"]), 3)
        self.assertEqual(initial["quote"], initial["quotes"][0])
        self.assertEqual(len(initial["topics"]), len(stories))
        for items in (initial["quotes"], initial["topics"]):
            self.assertEqual(len(items), len({item["id"] for item in items}))
        entries = [initial["quotes"][3], initial["lineItem"], initial["topics"][4]]
        for i, item in enumerate(entries, 1):
            self.assertFalse(item["liked"])
            self.assertEqual(vote(item["id"], True)["savedCount"], i)
            self.assertTrue(vote(item["id"], True)["item"]["liked"])
        self.server.briefing.snapshot.return_value = {"status": "empty", "topics": []}
        self.assertEqual(read("/api/briefing")["topics"], [])
        archive = read("/api/briefing/hearts")
        self.assertEqual({s["kind"] for s in archive["items"]}, {"quote", "line", "topic"})
        self.assertTrue(archive["interests"])
        story = next(s for s in archive["items"] if s["kind"] == "topic")
        for field in ("title", "source", "url", "publishedAt"):
            self.assertEqual(story[field], entries[2][field])
        other = Board(self.board.directory / "other-board")
        self.addCleanup(other.db.close)
        with BoardServer(0, other, Team(other), preferences_directory=self.profile) as reopened:
            self.assertEqual(reopened.preferences.saved_count(), 3)
            self.assertEqual(reopened.preferences.saved(), archive["items"])
        with self.assertRaises(HTTPError) as refused:
            vote(story["id"], False, Origin="https://example.com")
        self.assertEqual(refused.exception.code, 403)
        self.assertEqual(vote(story["id"], False)["savedCount"], 2)
        self.assertEqual(self.board.cards(), [])

    def test_literary_shelf_replaces_previous_daily_quote_and_preserves_saved_copy(self):
        prefs = self.server.preferences
        previous, = prefs.select("quote", [{"text": "이전 명언", "author": "예전 출처", "tags": []}])
        prefs.set_liked(previous["id"], True)
        passage = {"text": "종이 위에 내린 비\n마른 잉크 곁에 머문다", "author": "테스트", "tags": ["비"]}
        self.server.literature.readings = lambda items: [*items, passage]
        self.server.briefing.snapshot = Mock(return_value={"status": "empty", "topics": []})
        with urlopen(self.url + "/api/briefing") as response:
            visible = json.load(response)["quotes"]
        self.assertIn(passage["text"], {item["text"] for item in visible})
        self.assertNotIn(previous["id"], {item["id"] for item in visible})
        self.assertEqual(prefs.saved()[0]["id"], previous["id"])

    def test_concurrent_submission_and_incremental_feed(self):
        with ThreadPoolExecutor(max_workers=3) as pool:
            replies = list(pool.map(lambda _: self.post("/api/tasks", "same", "같은 요청"), range(3)))
        self.assertEqual(replies, [{"id": 1}] * 3)
        self.post("/api/tasks/1/notes", "note", "첫 요청에 추가")
        with urlopen(self.url + "/api/board?after=1") as response:
            snapshot = json.load(response)
        self.assertEqual([e["kind"] for e in snapshot["entries"]], ["note"])
        self.assertEqual(len(snapshot["cards"]), 1)
        with self.assertRaises(HTTPError) as refused:
            self.post("/api/tasks", "other", "잘못된 출처", Origin="https://example.com")
        self.assertEqual(refused.exception.code, 403)

    def test_rework_and_new_instructions_during_audit(self):
        b = self.board
        request = "2026-11-22 KST KREAM 공개 상품 소싱. 독립 검토와 감사"
        card = b.submit("public-weekly-2026-11-22-101", "add", text=request)
        b.finish(b.claim("worker"), "submit", "초안")
        b.finish(b.claim("reviewer"), "revise", "고칠 부분")
        b.finish(b.claim("worker"), "submit", "수정본")
        b.finish(b.claim("reviewer"), "approve", "검토 통과")
        stale = b.claim("auditor")
        self.post(f"/api/tasks/{card}/notes", "new-direction", "새 조건")
        b.finish(stale, "close", "새 조건이 도착하기 전의 감사")
        self.assertEqual(b.cards()[0]["stage"], "worker")
        self.assertEqual(b.history(card)[-1]["kind"], "draft")
        self.assertFalse(b.finish(stale, "close", "오래된 응답"))
        self.assertEqual(b.claim("worker")["request"], request)

    def test_download_matches_published_file_only(self):
        b = self.board
        card = b.add("파일 확인")
        job = b.claim("worker")
        folder = b.workspace(card)
        folder.mkdir(parents=True)
        file = folder / "out.txt"
        file.write_bytes(b"data")
        b.finish(job, "submit", "out.txt")
        endpoint = self.url + f"/api/tasks/{card}/file?path="
        with urlopen(endpoint + "out.txt") as response:
            self.assertEqual(response.read(), b"data")
            self.assertIn("attachment", response.headers["Content-Disposition"])
        (folder / "unpublished.txt").write_bytes(b"new")
        with self.assertRaises(HTTPError):
            urlopen(endpoint + "unpublished.txt")
        os.link(file, folder / "extra-link")
        with self.assertRaises(HTTPError):
            urlopen(endpoint + "out.txt")

    def test_contract_must_be_checked_before_handoff(self):
        b = self.board
        card = b.add("중복된 행을 정리하세요")
        worker = b.claim("worker")
        contract = b.contract_start(worker, "중복 제거", "원본의 고유값 세 개 보존")
        with self.assertRaises(ValueError):
            b.finish(worker, "submit", "아직 작업 중")
        b.contract_result(worker, contract, "A, B, C")
        with self.assertRaises(ValueError):
            b.finish(worker, "submit", "검수 전")
        b.contract_review(worker, contract, True, "원본의 고유값 세 개와 대조했다")
        scratch = b.workspace(card) / ".contract-work" / str(contract)
        scratch.mkdir(parents=True)
        (scratch / "internal.txt").write_text("scratch")
        (b.workspace(card) / "final.txt").write_text("A, B, C")
        b.finish(worker, "submit", "검수 완료")
        self.assertEqual((b.cards()[0]["stage"], b.cards()[0]["state"]), ("worker", "done"))
        entries = b.history(card)
        self.assertEqual([e["kind"] for e in entries if e["kind"].startswith("contract_")],
                         ["contract_start", "contract_result", "contract_accept"])
        self.assertEqual(next(e for e in entries if e["kind"] == "files")["body"].splitlines()[1:], ["final.txt"])

    def test_contract_recovery_and_rejection(self):
        b = self.board
        card = b.add("수량 확인")
        first = b.claim("worker")
        stale = b.contract_start(first, "수량 집계", "합계 3")
        b.recover()
        self.assertEqual(b.contracts(card)[0]["state"], "failed")
        b.retry(card)
        next_job = b.claim("worker")
        with self.assertRaises(ValueError):
            b.contract_result(first, stale, "오래된 결과")
        cid = b.contract_start(next_job, "다시 집계", "합계 3")
        b.contract_result(next_job, cid, "4")
        b.contract_review(next_job, cid, False, "합계 불일치")
        self.assertEqual(b.contracts(card)[-1]["state"], "rejected")
        b.finish(next_job, "submit", "직접 다시 계산한 결과는 3")


if __name__ == "__main__":
    unittest.main()
