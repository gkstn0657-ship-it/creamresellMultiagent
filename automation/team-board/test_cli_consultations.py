import asyncio
import json
import tempfile
import unittest

from agents import CHAT_REPORT, Team, _schema, instructions
from board import Board


class CliConsultationTests(unittest.TestCase):
    def test_brief_chat_guidance_preserves_evidence_and_contract_inputs(self):
        history = "모델번호와 옵션을 대조했습니다.\n\n상세 근거: " + "원본 자료 " * 180
        job = {"id": 1, "request": "가격 비교", "board": [],
               "entries": [{"role": "worker", "kind": "submit", "body": history}]}
        evidence = {"files": [{"path": "prices.txt", "utf8_text": history}]}
        for role in ("worker", "reviewer", "auditor"):
            with self.subTest(role=role):
                prompt = instructions({**job, "stage": role}, evidence)
                rules, data = prompt.rsplit("\n", 1)
                self.assertIn(CHAT_REPORT, rules)
                shared = json.loads(data)
                self.assertEqual(shared["이 업무의 기록 (오래된 순)"][0]["내용"], history)
                self.assertEqual(shared["호스트가 이번 검증 직전에 파일에서 직접 읽은 원본 증거"], evidence)
        task = {"brief": history, "checks": "옵션 일치", "inputs": ["prices.txt"]}
        rules, data = instructions({**task, "stage": "contractor"}).rsplit("\n", 1)
        self.assertIn(CHAT_REPORT, rules)
        self.assertEqual(json.loads(data), task)

    def test_action_enums_preserve_contract_and_consultation_boundaries(self):
        targets = ["reviewer", "auditor"]
        props = _schema("worker", ask_targets=targets)["properties"]
        self.assertIn("ask_reviewer", props["action"]["enum"])
        self.assertIn("contract", props["action"]["enum"])
        self.assertNotIn("ask_worker", props["action"]["enum"])
        question = {"requester": "reviewer", "target": "worker", "question": "근거를 알려주세요.", "seq": 1}
        answer = _schema("worker", ask_targets=targets, consultation=question)["properties"]
        self.assertEqual(answer["action"]["enum"], ["answer"])
        self.assertEqual(set(answer), {"action", "message"})
        for role, pending in (("contractor", False), ("worker", True)):
            actions = _schema(role, pending, ask_targets=targets)["properties"]["action"]["enum"]
            self.assertFalse(any(action.startswith("ask_") for action in actions))

    def test_team_routes_question_and_answer_then_finishes_original_work(self):
        with tempfile.TemporaryDirectory() as directory:
            board = Board(directory)
            try:
                card = board.submit("public-weekly-2026-11-22-101", "add",
                                    text="2026-11-22 KST KREAM 공개 상품 소싱. 체결 근거를 확인하세요.")
                turns = []
                decisions = [("ask_reviewer", "가격은 어느 자료로 확인하나요?"),
                             ("answer", "어제 체결된 주문의 날짜·옵션과 단가를 대조하세요."),
                             ("submit", "날짜·옵션·단가를 대조했습니다.")]

                async def execute(job, folder, progress):
                    prompt = instructions(job)
                    if job.get("consultation"):
                        self.assertEqual(job["consultation"]["requester"], "worker")
                        self.assertIn(decisions[0][1], prompt)
                    elif turns:
                        self.assertIn(decisions[1][1], prompt)
                    turns.append(job["stage"])
                    return decisions[len(turns) - 1]

                team = Team(board, execute)
                for expected, role in enumerate(("worker", "reviewer", "worker"), 1):
                    asyncio.run(team.serve(role, stop_requested=lambda: len(turns) >= expected))
                self.assertEqual([e["kind"] for e in board.history(card) if e["kind"] in {"ask", "answer", "submit"}],
                                 ["ask", "answer", "submit"])
                self.assertEqual(board.cards()[0]["stage"], "reviewer")
            finally:
                board.db.close()

    def test_unknown_dashboard_entry_labels_remain_readable(self):
        job = {"id": 1, "stage": "auditor", "request": "탐색", "board": [],
               "entries": [{"role": "auditor", "kind": "수신 알림", "body": "실무자 처리 중"}],
               "sourcing_context": {"work": "source-1"}}
        prompt = instructions(job)
        self.assertIn("수신 알림", prompt)
        self.assertIn("source-1", prompt)
