"""Dashboard message receipts tie one submitted user message to its stored timeline entry."""
import hashlib
import json
import re


BROWSER_TOKEN = re.compile(r"[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}")


def initialize(board):
    with board.write():
        board.db.execute("""CREATE TABLE IF NOT EXISTS chat_receipts (
            request_id TEXT PRIMARY KEY REFERENCES submissions(request_id), seq INTEGER NOT NULL UNIQUE REFERENCES entries(seq))""")
        # Older dashboard builds generated a UUID for each click. Match the original
        # recorded payload as well, so CLI-generated cards never become personal messages.
        missing = board.db.execute("""SELECT s.* FROM submissions s LEFT JOIN chat_receipts r USING(request_id)
                                      WHERE r.seq IS NULL AND length(s.request_id)=36 ORDER BY s.rowid""").fetchall()
        for row in missing:
            if not BROWSER_TOKEN.fullmatch(row["request_id"]):
                continue
            for entry in board.db.execute("""SELECT seq,kind,body FROM entries WHERE card=? AND role='user'
                    AND kind IN ('request','note') AND seq NOT IN (SELECT seq FROM chat_receipts) ORDER BY seq""",(row["card"],)):
                args = ["add", None, entry["body"]] if entry["kind"]=="request" else ["note", row["card"], entry["body"]]
                signature = hashlib.sha256(json.dumps(args, ensure_ascii=False).encode()).hexdigest()
                if signature == row["fingerprint"]:
                    board.db.execute("INSERT INTO chat_receipts VALUES(?,?)", (row["request_id"], entry["seq"]))
                    break


def submit(board, token, kind, card, text, personal):
    with board.write():
        known = board.db.execute("SELECT 1 FROM submissions WHERE request_id=?", (token,)).fetchone()
        card = board.submit(token, kind, card, text)
        response = {"id":card}
        if not personal or kind not in ("add","note"):
            return response
        if not known:
            event_kind = "request" if kind == "add" else "note"
            seq = board.db.execute("SELECT MAX(seq) FROM entries WHERE card=? AND role='user' AND kind=?",
                                   (card,event_kind)).fetchone()[0]
            board.db.execute("INSERT INTO chat_receipts VALUES(?,?)",(token,seq))
        event = board.db.execute("""SELECT e.* FROM chat_receipts r JOIN entries e USING(seq)
                                    WHERE r.request_id=?""",(token,)).fetchone()
        if event:
            response["entry"] = {**dict(event), "userSubmitted":True, "requestId":token}
        return response


def attach(board, entries, after):
    if not entries:
        return
    ids = dict(board.db.execute("SELECT seq,request_id FROM chat_receipts WHERE seq>? AND seq<=?",
                                (after, entries[-1]["seq"])))
    for event in entries:
        if event["seq"] in ids:
            event.update(userSubmitted=True, requestId=ids[event["seq"]])
