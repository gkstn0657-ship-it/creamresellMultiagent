import sqlite3
import unittest
from types import SimpleNamespace

from source_links import attach_source_work_ids


class SourceLinkTests(unittest.TestCase):
    def test_new_board_and_multiple_cards_share_their_own_external_work_id(self):
        board = SimpleNamespace(db=sqlite3.connect(":memory:"))
        self.addCleanup(board.db.close)
        cards = [{"id":i} for i in range(1,8)]
        attach_source_work_ids(board,cards)
        self.assertTrue(all("sourceWorkId" not in card for card in cards))
        board.db.executescript("""
            CREATE TABLE naver_runs(card,id,audit_card);
            INSERT INTO naver_runs VALUES(1,'naver:run',2);
            CREATE TABLE sourcing_alert_channels(card,work_id);
            INSERT INTO sourcing_alert_channels VALUES(3,'work-kream');
            CREATE TABLE sourcing_incidents(job,channel);
            INSERT INTO sourcing_incidents VALUES(4,1);
            CREATE TABLE entries(seq,card);
            INSERT INTO entries VALUES(9,3);
            CREATE TABLE sourcing_alert_actions(seq,job);
            INSERT INTO sourcing_alert_actions VALUES(9,5);
            CREATE TABLE sourcing_audit_delivery(job,channel);
            INSERT INTO sourcing_audit_delivery VALUES(6,3);""")
        attach_source_work_ids(board,cards)
        self.assertEqual([c.get("sourceWorkId") for c in cards], [
            "naver:run","naver:run","work-kream","naver:run","work-kream","work-kream",None])
