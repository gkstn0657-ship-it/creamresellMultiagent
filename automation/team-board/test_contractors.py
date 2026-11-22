import asyncio
import tempfile
import unittest
from pathlib import Path

from agents import Team, _role_options, _schema, artifact_evidence, instructions, prepare_contract
from board import Board


class ContractorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.board = Board(self.temp.name)
        self.addCleanup(self.board.db.close)
        self.card = self.board.add("입력 파일의 줄 수와 합계 확인")
        self.workspace = self.board.workspace(self.card)
        self.workspace.mkdir(parents=True)
        (self.workspace / "data.txt").write_text("2\n3\n", encoding="utf-8")
        self.job = self.board.claim("worker")
        self.brief = {"brief": "두 줄 합산", "checks": "행수와 합계 대조", "inputs": ["data.txt"]}

    def test_roles_model_and_contract_visibility(self):
        options = _role_options("contractor")
        self.assertEqual(options[options.index("--model") + 1], "gpt-6-luna")
        self.assertIn('model_reasoning_effort="low"', options)
        self.assertIn('model_reasoning_effort="ultra"', _role_options("worker"))
        for role in ("worker", "contractor", "reviewer", "auditor"):
            self.assertIn("agents.enabled=false", _role_options(role))
        contractor = {"stage": "contractor", **self.brief, "entries": ["private history"], "board": ["other card"]}
        prompt = instructions(contractor)
        self.assertNotIn("private history", prompt)
        self.assertNotIn("other card", prompt)
        self.assertNotIn("contract", _schema("contractor")["properties"]["action"]["enum"])
        self.assertNotIn("submit", _schema("worker", pending=True)["properties"]["action"]["enum"])

    def test_hire_deliver_inspect_and_publish(self):
        calls = []

        async def execute(job, folder, progress):
            calls.append(job["stage"])
            if job["stage"] == "contractor":
                self.assertNotEqual(folder, self.workspace)
                self.assertEqual((folder / "inputs" / "data.txt").read_text(), "2\n3\n")
                (folder / "inputs" / "data.txt").write_text("changed copy")
                (folder / "counts.txt").write_text("rows=2, total=5")
                return "deliver", "counts.txt"
            if not job["contracts"]:
                return "contract", self.brief
            if job["pending_contract"]:
                contract = job["pending_contract"]
                self.assertEqual(contract["state"], "pending")
                files = artifact_evidence(folder / ".contract-work" / str(contract["id"]), skip_inputs=True)["files"]
                self.assertEqual([(i["path"], i["utf8_text"]) for i in files], [("counts.txt", "rows=2, total=5")])
                self.assertEqual((folder / "data.txt").read_text(), "2\n3\n")
                return "contract_accept", "원본 2행과 합계 5를 결과와 직접 대조"
            self.assertEqual(job["contracts"][0]["state"], "accepted")
            return "submit", "2행, 합계 5"

        action, body = asyncio.run(Team(self.board, execute).run_turn(self.job, lambda s: None))
        self.board.finish(self.job, action, body)
        self.assertEqual(calls, ["worker", "contractor", "worker", "worker"])
        self.assertEqual((self.board.cards()[0]["stage"], self.board.cards()[0]["state"]), ("worker", "done"))
        self.assertEqual([i["path"] for i in artifact_evidence(self.workspace)["files"]], ["data.txt"])
        records = [e["kind"] for e in self.board.history(self.card)]
        self.assertLess(records.index("contract_accept"), records.index("submit"))

    def test_failure_returns_to_accountable_worker(self):
        async def execute(job, folder, progress):
            if job["stage"] == "contractor":
                raise RuntimeError("model unavailable")
            if not job["contracts"]:
                return "contract", self.brief
            self.assertEqual(job["contracts"][0]["state"], "failed")
            return "submit", "직접 합산한 결과 5"

        decision = asyncio.run(Team(self.board, execute).run_turn(self.job, lambda s: None))
        self.board.finish(self.job, *decision)
        self.assertEqual((self.board.cards()[0]["stage"], self.board.cards()[0]["state"]), ("worker", "done"))

    def test_cancelled_hire_does_not_stay_running(self):
        async def execute(job, folder, progress):
            if job["stage"] == "worker":
                return "contract", self.brief
            raise asyncio.CancelledError()

        with self.assertRaises(asyncio.CancelledError):
            asyncio.run(Team(self.board, execute).run_turn(self.job, lambda s: None))
        self.assertEqual(self.board.contracts(self.card)[0]["state"], "failed")

    def test_input_paths_cannot_escape_or_reuse_another_hire(self):
        with self.assertRaises(ValueError):
            prepare_contract(self.workspace, 1, ["../outside"])
        with self.assertRaises(ValueError):
            prepare_contract(self.workspace, 2, [".contract-work/1/out"])
        with self.assertRaises(FileExistsError):
            prepare_contract(self.workspace, 1, [])


if __name__ == "__main__":
    unittest.main()
