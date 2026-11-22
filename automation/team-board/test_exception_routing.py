import asyncio
import tempfile
import unittest

from agents import Team, _schema, instructions
from board import Board, ROLES, ROLE_TITLES


class ExceptionRoutingTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.board = Board(temp.name)
        self.addCleanup(self.board.db.close)

    def state(self, card):
        row = self.board._get(card)
        return row["stage"], row["state"]

    def test_routine_partial_results_close_without_peer_or_hire(self):
        for message in ("한 번 조회", "중간 집계", "자료 부족으로 보류 기록"):
            card = self.board.add(message)
            job = self.board.claim("worker")
            self.assertEqual(job["ask_targets"], [])
            self.assertFalse(job["public_review"])
            with self.assertRaises(ValueError):
                self.board.ask(job, "reviewer", "통상 결과를 검토해 주세요.")
            self.board.finish(job, "submit", "원본과 대조해 현재 결과를 기록")
            self.assertEqual(self.state(card), ("worker", "done"))
            self.assertEqual(self.board.contracts(card), [])
        self.assertIsNone(self.board.claim("reviewer"))
        self.assertIsNone(self.board.claim("auditor"))

    def test_serious_issue_returns_after_remediation_and_owner_can_close_next_note(self):
        card = self.board.add("수집 파일 확인")
        self.board.finish(self.board.claim("worker"), "escalate", "서로 다른 옵션 증거가 같은 ID로 저장됨")
        self.board.finish(self.board.claim("reviewer"), "revise", "원본 ID로 다시 연결")
        self.board.finish(self.board.claim("worker"), "submit", "원본 대조 완료")
        self.board.finish(self.board.claim("reviewer"), "approve", "중복 해소 확인")
        self.assertEqual(self.state(card), ("reviewer", "done"))
        self.assertIsNone(self.board.claim("auditor"))
        self.board.note(card, "수정된 파일 수만 알려줘")
        self.board.finish(self.board.claim("worker"), "submit", "재확인 결과 2개")
        self.assertEqual(self.state(card), ("worker", "done"))

    def test_cli_failure_and_repeated_crash_route_to_reviewer_but_first_interrupt_is_retriable(self):
        card = self.board.add("대기열 처리")
        job = self.board.claim("worker")
        self.board.recover()
        self.assertEqual(self.state(card), ("worker", "blocked"))
        self.assertFalse(self.board.finish(job, "submit", "이전 실행"))
        self.board.retry(card)
        self.board.claim("worker")
        self.board.recover()
        self.assertEqual(self.state(card), ("reviewer", "ready"))
        self.assertEqual([e["kind"] for e in self.board.history(card)].count("escalate"), 1)
        self.board.finish(self.board.claim("reviewer"), "approve", "복구 확인")
        other = self.board.add("CLI 확인")
        self.board.finish(self.board.claim("worker"), "error", "CLI 구성 오류로 실행 실패")
        self.assertEqual(self.state(other), ("reviewer", "ready"))
        self.board.finish(self.board.claim("reviewer"), "error", "검토 CLI도 실행 불가")
        self.assertEqual(self.state(other), ("reviewer", "ready"))
        second = self.board.claim("reviewer")
        self.board.finish(second, "error", "재시도 후에도 검토 CLI 실행 불가")
        self.assertFalse(self.board.finish(second, "error", "중복 응답"))
        self.assertEqual(self.state(other), ("auditor", "ready"))
        self.board.finish(self.board.claim("auditor"), "error", "감사 CLI 실행 불가")
        self.assertEqual(self.state(other), ("auditor", "blocked"))
        self.assertEqual([(e["role"], e["kind"]) for e in self.board.history(other) if e["kind"] == "escalate"],
                         [("worker", "escalate"), ("reviewer", "escalate")])

    def test_prior_stock_hold_does_not_become_an_incident(self):
        card = self.board.add("재고 확인")
        self.board.finish(self.board.claim("worker"), "blocked", "판매자 접근 승인 필요")
        self.board.retry(card)
        self.board.finish(self.board.claim("worker"), "blocked", "접근 승인 대기")
        self.assertEqual(self.state(card), ("worker", "blocked"))
        self.assertIsNone(self.board.claim("reviewer"))

    def test_note_during_exception_review_preserves_review_until_disposition(self):
        card = self.board.add("신뢰할 수 없는 원본 식별자 충돌 조사")
        self.board.finish(self.board.claim("worker"), "escalate", "두 원본 충돌 발견")
        reviewer = self.board.claim("reviewer")
        self.board.note(card, "어느 시점부터인지도 확인")
        self.board.finish(reviewer, "approve", "새 조건 접수 전 의견")
        self.board.finish(self.board.claim("worker"), "submit", "시점과 영향 범위 추가")
        self.assertEqual(self.state(card), ("reviewer", "ready"))
        self.board.finish(self.board.claim("reviewer"), "approve", "추가 근거까지 대조")
        self.assertEqual(self.state(card), ("reviewer", "done"))

    def test_claire_escalates_once_and_morgan_reviews_repaired_ledger(self):
        card = self.board.add("공유 원장 확인")
        self.board.finish(self.board.claim("worker"), "escalate", "여러 업무에서 상품 원장 ID 중복")
        claire = self.board.claim("reviewer")
        self.assertNotIn("auditor", claire["ask_targets"])
        self.assertIn("검토자 클레어(Claire)", instructions(claire))
        self.board.finish(claire, "escalate", "업무 세 건에서 같은 키가 서로 다른 원본을 가리킴")
        self.assertFalse(self.board.finish(claire, "escalate", "같은 보고"))
        morgan = self.board.claim("auditor")
        self.assertEqual(morgan["id"], card)
        self.assertIn("감사총무 모건(Morgan)", instructions(morgan))
        self.board.finish(morgan, "revise", "세 업무 원본과 원장 대조")
        self.board.finish(self.board.claim("worker"), "submit", "고유 키 복구")
        self.assertIsNone(self.board.claim("reviewer"))
        self.board.finish(self.board.claim("auditor"), "close", "세 업무 원본과 각 키 일치")
        self.assertEqual(self.state(card), ("auditor", "done"))
        self.assertEqual(len(self.board.cards()), 1)

    def test_morgan_context_observes_real_worker_history_without_starting_routine_audit(self):
        first = self.board.add("진행 건수 직접 집계")
        self.board.finish(self.board.claim("worker"), "submit", "원본 대조 후 12개")
        self.assertIsNone(self.board.claim("auditor"))
        second = self.board.add("중대한 복구 오류")
        self.board.finish(self.board.claim("worker"), "escalate", "반복 오류")
        self.board.finish(self.board.claim("reviewer"), "escalate", "독립된 두 업무에 영향 확인")
        async def inspect(job, folder, progress):
            event = next(r for r in job["worker_decisions"] if r["card"] == first)
            self.assertEqual(event["summary"], "원본 대조 후 12개")
            self.assertEqual(event["seq"], self.board.history(first)[-1]["seq"])
            self.assertIn("원본 대조 후 12개", instructions(job))
            return "close", "원본 대조"
        morgan = self.board.claim("auditor")
        self.assertEqual(morgan["id"], second)
        self.board.finish(morgan, *asyncio.run(Team(self.board, inspect).run_turn(morgan, lambda s: None)))
        self.assertEqual((ROLES["worker"], ROLE_TITLES["worker"]), ("제임스", "실무자"))

    def test_resolving_incident_keeps_independent_public_product_approval(self):
        card = self.board.submit("public-weekly-2026-11-22-106", "add", text="2026-11-22 KST KREAM 공개 상품 소싱. 상품")
        self.board.finish(self.board.claim("worker"), "error", "CLI 실행 불능")
        self.board.finish(self.board.claim("reviewer"), "escalate", "다수 상품의 검증 데이터 손상")
        self.board.finish(self.board.claim("auditor"), "close", "공유 원장 복구.")
        self.assertEqual(self.state(card), ("worker", "ready"))
        self.board.finish(self.board.claim("worker"), "submit", "상품 결과")
        self.board.finish(self.board.claim("reviewer"), "escalate", "여러 카드에 같은 원본 사용")
        self.board.finish(self.board.claim("auditor"), "close", "관련 증거 확보, 독립 검토 재개")
        self.assertEqual(self.state(card), ("reviewer", "ready"))
        self.board.finish(self.board.claim("reviewer"), "approve", "상품 원본 확인")
        self.board.finish(self.board.claim("auditor"), "close", "감사 마감")
        self.assertEqual(self.state(card), ("auditor", "done"))

    def test_contract_must_be_reviewed_before_submit_or_escalate(self):
        card = self.board.add("100개 항목 분류")
        job = self.board.claim("worker")
        contract = self.board.contract_start(job, "분류", "누락 비교", "100개에 같은 규칙 적용")
        self.board.contract_result(job, contract, "결과")
        for action in ("submit", "escalate"):
            with self.assertRaises(ValueError):
                self.board.finish(job, action, "처리")
        self.board.contract_review(job, contract, True, "원본 100행 대조")
        self.board.finish(job, "submit", "100개 반영")
        self.assertEqual(self.state(card), ("worker", "done"))
        self.assertTrue(any(e["kind"] == "contract_start" and "100개에 같은 규칙" in e["body"]
                            for e in self.board.history(card)))
        self.assertIn("검수 비용", instructions(job))
        self.assertNotIn("escalate", _schema("worker", pending=True)["properties"]["action"]["enum"])

    def test_public_listing_keeps_two_independent_stages_but_note_cannot_opt_in(self):
        text = "2026-11-22 KST KREAM 공개 상품 소싱. 목록 확인"
        strict = self.board.submit("public-weekly-2026-11-22-r17", "add", text=text)
        ordinary = self.board.add(text)
        self.board.submit("public-weekly-2026-11-22-r19", "note", ordinary, "원본 확인")
        self.board.finish(self.board.claim("worker"), "submit", "목록 결과")
        self.board.finish(self.board.claim("reviewer"), "approve", "목록 일치")
        self.board.finish(self.board.claim("auditor"), "close", "감사")
        self.assertEqual(self.state(strict), ("auditor", "done"))
        self.board.finish(self.board.claim("worker"), "submit", "요청 확인")
        self.assertEqual(self.state(ordinary), ("worker", "done"))
