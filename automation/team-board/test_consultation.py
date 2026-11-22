import tempfile
import unittest

from board import Board, MAX_QUESTIONS_PER_CARD


class Consultations(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.board = Board(self.temp.name)
        self.card = self.board.submit("public-weekly-2026-11-22-101", "add",
                                      text="2026-11-22 KST KREAM 공개 상품 소싱. 상품 탐색")

    def tearDown(self):
        self.board.db.close()
        self.temp.cleanup()

    def test_consult_on_original_card_then_complete_independent_review(self):
        worker = self.board.claim("worker")
        self.assertEqual(worker["ask_targets"], ["reviewer", "auditor"])
        self.assertTrue(self.board.ask(worker, "reviewer", "옵션 코드가 일치하나요?"))
        self.assertFalse(self.board.ask(worker, "reviewer", "중복"))
        self.assertFalse(self.board.finish(worker, "submit", "오래된 결과"))
        self.board.db.close()
        self.board = Board(self.temp.name)
        reviewer = self.board.claim("reviewer")
        self.assertEqual(reviewer["consultation"]["question"], "옵션 코드가 일치하나요?")
        self.assertEqual(reviewer["consultation"]["requester"], "worker")
        self.assertEqual(reviewer["ask_targets"], [])
        with self.assertRaises(ValueError):
            self.board.finish(reviewer, "approve", "승인")
        with self.assertRaises(ValueError):
            self.board.ask(reviewer, "auditor", "다른 질문")
        self.assertTrue(self.board.answer(reviewer, "두 판매처 모두 옵션 번호 42입니다."))
        self.assertFalse(self.board.answer(reviewer, "중복"))
        worker = self.board.claim("worker")
        self.assertIsNone(worker["consultation"])
        self.assertIn("클레어 → 제임스", worker["entries"][-2]["body"])
        self.assertTrue(self.board.finish(worker, "submit", "작업 완료"))
        reviewer = self.board.claim("reviewer")
        self.assertIsNone(reviewer["consultation"])
        self.assertTrue(self.board.finish(reviewer, "approve", "본 검토 완료"))
        auditor = self.board.claim("auditor")
        self.assertTrue(self.board.finish(auditor, "close", "감사 완료"))
        self.assertEqual(len(self.board.cards()), 1)
        self.assertEqual(self.board.cards()[0]["state"], "done")

    def test_cannot_claim_forged_role_self_or_pending_contract(self):
        worker = self.board.claim("worker")
        self.assertFalse(self.board.ask(dict(worker, stage="auditor"), "worker", "대상 확인"))
        with self.assertRaises(ValueError):
            self.board.ask(worker, "worker", "자기 질문")
        self.board.contract_start(worker, "반복 합계", "표 확인")
        with self.assertRaises(ValueError):
            self.board.ask(worker, "reviewer", "계약 결과 확인")

    def test_question_limit_leaves_normal_pipeline_available(self):
        for _ in range(MAX_QUESTIONS_PER_CARD):
            self.board.ask(self.board.claim("worker"), "auditor", "확인 요청")
            self.board.answer(self.board.claim("auditor"), "답변")
        worker = self.board.claim("worker")
        self.assertEqual(worker["ask_targets"], [])
        with self.assertRaises(ValueError):
            self.board.ask(worker, "reviewer", "또 질문")
        self.assertTrue(self.board.finish(worker, "submit", "제출"))

    def test_user_instruction_cancels_unclaimed_or_redirects_claimed_response(self):
        self.board.finish(self.board.claim("worker"), "submit", "제출")
        self.board.ask(self.board.claim("reviewer"), "auditor", "근거 확인")
        self.board.note(self.card, "우선순위 변경")
        worker = self.board.claim("worker")
        self.assertIsNone(worker["consultation"])
        self.board.finish(worker, "submit", "재제출")
        self.board.ask(self.board.claim("reviewer"), "auditor", "다시 확인")
        auditor = self.board.claim("auditor")
        self.board.note(self.card, "추가 조건")
        self.board.answer(auditor, "새 근거")
        self.assertIsNone(self.board.claim("reviewer"))
        self.assertIsNone(self.board.claim("worker")["consultation"])

    def test_claim_error_or_crash_returns_control_to_requester(self):
        self.board.ask(self.board.claim("worker"), "reviewer", "확인")
        reviewer = self.board.claim("reviewer")
        self.assertTrue(self.board.finish(reviewer, "error", "실행 실패"))
        self.board.ask(self.board.claim("worker"), "auditor", "독립 확인")
        self.board.claim("auditor")
        self.board.recover()
        worker = self.board.claim("worker")
        self.assertIsNone(worker["consultation"])
        self.assertTrue(any(e["kind"]=="answer" and "중단" in e["body"] for e in worker["entries"]))

    def test_newer_user_instruction_beats_outgoing_question(self):
        worker = self.board.claim("worker")
        self.board.note(self.card, "업무 변경")
        self.assertFalse(self.board.ask(worker, "auditor", "이전 지시 질문"))
        self.assertIsNone(self.board.claim("auditor"))
        self.assertIn("업무 변경", [e["body"] for e in self.board.claim("worker")["entries"]])
