import tempfile
import json
import threading
import unittest
from types import SimpleNamespace
from urllib.request import urlopen

from board import Board
from dashboard import BoardServer
from sourcing_alert import dispatch, linked_sourcing_context, publish
from sourcing_incidents import check_pending, install_observer, observation


class SourcingCollaborationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.board = Board(temp.name)
        self.addCleanup(self.board.db.close)
        self.work = "work-12345678-1234-1234-1234-123456789012"

    def signal(self, status):
        publish(self.board, self.work, "KREAM", status)
        return dispatch(self.board, self.work)

    def test_routine_wait_stock_failure_and_completion_are_monitor_notices(self):
        for status in ("실행 중","연결 대기 (CONNECTOR_NOT_READY)", "점검 필요 (NO1_BRIDGE_BUSY)",
                       "점검 필요 (STOCK_CHECK_FAILED)", "실행 중", "랭킹 소진"):
            self.assertFalse(self.signal(status))
        self.assertEqual(len(self.board.cards()),1)
        notices = self.board.history(self.board.cards()[0]["id"])
        self.assertEqual(len(notices),6)
        self.assertTrue(all(e["kind"]=="탐색 알림" and e["role"]=="auditor" for e in notices))

    def test_critical_alert_is_routed_once_with_its_evidence_and_recovery(self):
        self.assertTrue(self.signal("점검 필요 (RESUME_FAILED)"))
        channel = self.board.db.execute("SELECT card FROM sourcing_alert_channels").fetchone()[0]
        job = self.board.claim("reviewer")
        self.assertEqual(linked_sourcing_context(self.board, job["id"])["channel"], channel)
        self.assertIsNone(self.board.claim("auditor"))
        self.assertIsNone(self.board.claim("worker"))
        for status in ("점검 필요 (RESUME_FAILED)","감시 응답 지연"):
            self.assertTrue(self.signal(status))
        self.assertEqual(len(self.board.cards()),2)
        self.signal("실행 중")
        self.assertEqual(self.board._get(job["id"])["state"],"running")
        self.assertTrue(self.board.finish(job,"approve","호스트가 기존 작업을 재개했습니다."))
        result = [e for e in self.board.history(channel) if e["kind"]=="조치 경과"]
        self.assertEqual(len(result),1)
        self.assertIn("재개",result[0]["body"])
        self.assertTrue(self.signal("점검 필요 (BATCH_RETRY_LIMIT)"))
        self.assertEqual(len(self.board.cards()),3)

    def test_unclaimed_incident_is_settled_by_recovery_without_an_agent(self):
        self.signal("감시 응답 지연")
        self.assertFalse(self.signal("실행 중"))
        self.assertIsNone(self.board.claim("reviewer"))
        self.assertEqual(self.board.cards()[0]["state"],"done")
        self.assertEqual(len(self.board.cards()),2)

    def test_observer_tracks_actual_worker_events_across_connections_without_starting_a_case(self):
        install_observer(self.board)
        self.assertIsNone(observation(self.board))
        card = self.board.add("조사")
        writer = Board(self.board.directory, initialize=False)
        self.addCleanup(writer.db.close)
        job = writer.claim("worker")
        self.assertEqual(observation(self.board)["seq"],job["token"])
        with self.assertRaises(ValueError), writer.write():
            writer._post(card,"worker","progress","취소될 기록")
            raise ValueError()
        self.assertEqual(observation(self.board)["kind"],"start")
        writer.finish(job,"submit","완료")
        obs = observation(self.board)
        self.assertEqual((obs["card"],obs["kind"]),(card,"submit"))
        self.assertGreater(obs["observedAt"],0)
        install_observer(self.board)
        self.assertEqual(observation(self.board),obs)
        self.assertIsNone(self.board.claim("auditor"))
        self.assertEqual(len(self.board.cards()),1)

    def test_board_api_exposes_source_and_observation_even_on_incremental_reads(self):
        with BoardServer(0,self.board,SimpleNamespace(activity={})) as server:
            thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval":0.02}, daemon=True)
            thread.start()
            try:
                url = f"http://127.0.0.1:{server.server_port}/api/board?after=99999"
                with urlopen(url,timeout=5) as response:
                    self.assertIsNone(json.load(response)["roles"]["auditor"]["observation"])
                self.signal("점검 필요 (RESUME_FAILED)")
                card = self.board.add("관찰 확인")
                self.board.claim("worker")
                with urlopen(url,timeout=5) as response:
                    payload = json.load(response)
                self.assertEqual(payload["entries"],[])
                self.assertEqual(payload["roles"]["auditor"]["observation"]["card"],card)
                self.assertIsNone(payload["roles"]["auditor"]["activity"])
                self.assertEqual([r["sourceWorkId"] for r in payload["cards"] if r["id"]!=card],[self.work]*2)
            finally:
                server.shutdown()
                thread.join()

    def test_critical_integrity_and_exhausted_recovery_reach_morgan_on_same_incident(self):
        for code in ("SQLITE_CORRUPT","BATCH_RETRY_LIMIT"):
            self.signal(f"점검 필요 ({code})")
            self.signal(f"점검 필요 ({code})")
            job=self.board.claim("auditor")
            self.assertIsNotNone(job)
            self.assertIsNone(self.board.claim("reviewer"))
            channel=linked_sourcing_context(self.board,job["id"])["channel"]
            self.signal("실행 중")
            self.board.finish(job,"close","자료 또는 재실행 확인 완료")
            self.assertIn("#"+str(job["id"]),self.board.history(channel)[-1]["body"])
            self.assertIsNone(self.board.claim("auditor"))
        self.assertEqual(len(self.board.cards()),3)

    def test_active_claire_finishes_turn_before_escalated_case_is_handed_to_morgan(self):
        self.signal("점검 필요 (RESUME_FAILED)")
        job=self.board.claim("reviewer")
        self.signal("점검 필요 (BATCH_RETRY_LIMIT)")
        self.signal("실행 중")
        self.assertIsNone(self.board.claim("auditor"))
        self.assertTrue(self.board.finish(job,"approve","복구 시도 기록 확인"))
        check_pending(self.board)
        self.assertEqual(self.board.claim("auditor")["id"],job["id"])
        self.assertEqual(len(self.board.cards()),2)

    def test_shared_system_fault_needs_two_distinct_open_sources_and_only_one_supervisor(self):
        self.signal("감시 응답 지연")
        self.assertIsNone(self.board.claim("auditor"))
        other = self.work[:-1]+"3"
        publish(self.board,other,"무신사","감시 응답 지연")
        job=self.board.claim("auditor")
        self.assertIsNotNone(job)
        self.assertTrue(any(e["kind"]=="escalate" and "2건" in e["body"] for e in self.board.history(job["id"])))
        for work in (self.work,other):
            dispatch(self.board,work)
        self.board.finish(job,"close","두 작업 연결 회복 확인")
        publish(self.board,other,"무신사","실행 중")
        publish(self.board,self.work[:-1]+"4","기타","감시 응답 지연")
        self.assertIsNone(self.board.claim("auditor"))


if __name__ == "__main__":
    unittest.main()
