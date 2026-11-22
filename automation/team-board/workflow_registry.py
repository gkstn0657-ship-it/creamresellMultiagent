"""Persist exact user-approved workflow excerpts beside the shared operating rules."""
import hashlib
import os
import re
import stat
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path


DEFAULT_FILE = Path(__file__).resolve().parents[2] / "docs" / "작업방식.md"
KST = timezone(timedelta(hours=9))
MARKER = re.compile(r"^<!-- workflow-change:([a-f0-9]{64}) -->\r?$", re.MULTILINE)
# Match the value in the original message, including when a suggested excerpt
# omits the label that identifies it as a credential.
PRIVATE = re.compile(
    r"-----BEGIN [^\n-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^\n-]*PRIVATE KEY-----|\Z)"
    r"|\b(?:sk-(?:proj-)?[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_]{12,}|github_pat_[a-z0-9_]{12,}"
    r"|xox[baprs]-[a-z0-9-]{10,}|AKIA[A-Z0-9]{16}|eyJ[\w-]+\.[\w-]+\.[\w-]+)"
    r"|https?://[^\s/@:]+:[^\s/@]+@[^\s/]+"
    r"|[a-z0-9_.+-]+@[a-z0-9.-]+\.[a-z]{2,}"
    r"|(?<!\d)(?:\d{6}[ -]?[1-8]\d{6}|01[016789][ -]?\d{3,4}[ -]?\d{4}"
    r"|\d{4}(?:[ -]?\d{4}){2}[ -]?\d{3,4})(?!\d)"
    r"|(?:비밀번호|비번|인증\s*(?:번호|코드)|계좌\s*번호|주민등록번호|카드\s*번호|보안\s*코드|"
    r"(?:내\s*)?신용\s*카드\s*한도|계좌\s*잔액|유동\s*현금|자본금|연락처|"
    r"시드\s*구문|복구\s*(?:키|코드|구문)|자택\s*주소|집\s*주소|상세\s*주소|"
    r"api[ _-]?(?:key|키)|secret(?:[ _-]?key)?|pass(?:word|wd)|access[ _-]?token|refresh[ _-]?token|"
    r"bearer|token|토큰|암호|otp|pin|cvc|cvv)\s*(?:[:=：]|(?:은|는|이|가)\s+|\s+(?=[\w./+-]{4}))"
    r"\s*[^\n]+",
    re.IGNORECASE,
)


def read_rules(path=DEFAULT_FILE):
    return Path(path).read_text(encoding="utf-8-sig")


def user_sources(board, card):
    if not board.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_receipts'").fetchone():
        return {}
    rows = board.db.execute("""
        SELECT e.seq, e.body, r.request_id, e.at
        FROM chat_receipts r JOIN entries e ON e.seq=r.seq
        WHERE e.card=? AND e.role='user' AND e.kind IN ('request','note')
        ORDER BY e.seq""", (card,))
    return {str(seq): {"body": body, "requestId": receipt, "at": at} for seq, body, receipt, at in rows}


@contextmanager
def _writer_lock(path):
    # The sidecar remains at the same path when the Markdown itself is replaced.
    with path.with_suffix(path.suffix + ".lock").open("a+b") as lock:
        if os.name == "nt":
            import msvcrt
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        yield


def _record(change, sources, card):
    if not isinstance(change, dict) or type(change.get("seq")) is not int:
        return None
    seq, quote = change["seq"], change.get("quote")
    source = sources.get(str(seq))
    if not isinstance(source, dict) or not isinstance(quote, str) or not quote.strip():
        return None
    body, receipt = source.get("body"), source.get("requestId")
    if not isinstance(body, str) or not isinstance(receipt, str) or not receipt:
        return None
    if quote not in body or any(body.find(quote, max(0, match.start() - len(quote) + 1),
                                          match.end() + len(quote) - 1) >= 0 for match in PRIVATE.finditer(body)):
        return None
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]", quote):
        return None
    try:
        observed = datetime.fromtimestamp(source["at"], KST)
    except (ValueError, OSError, KeyError, TypeError, OverflowError):
        return None
    digest = hashlib.sha256((receipt + "\0" + quote).encode("utf-8")).hexdigest()
    literal = "\n".join("    " + line for line in quote.splitlines())
    section = (f"<!-- workflow-change:{digest} -->\n"
               f"**{observed:%Y-%m-%d %H:%M:%S} KST · 업무 #{card} · 메시지 #{seq}**\n\n{literal}\n")
    return digest, section


def append_changes(path, sources, changes, card):
    """Return the count of new, authenticated user excerpts saved for this card."""
    if not isinstance(sources, dict) or not isinstance(changes, list) or type(card) is not int or card < 1:
        return 0
    records = dict(record for change in changes if (record := _record(change, sources, card)))
    if not records:
        return 0
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with _writer_lock(path):
        original = path.read_bytes() if path.exists() else b""
        existing = original.decode("utf-8-sig")
        for digest in MARKER.findall(existing):
            records.pop(digest, None)
        if not records:
            return 0
        addition = "\n\n" + "\n".join(records.values())
        if "\r\n" in existing:
            addition = addition.replace("\n", "\r\n")
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".workflow-", suffix=".tmp", delete=False) as tmp:
            temp_path = Path(tmp.name)
            try:
                tmp.write(original + addition.encode("utf-8"))
                tmp.flush()
                os.fsync(tmp.fileno())
            except BaseException:
                tmp.close()
                temp_path.unlink(missing_ok=True)
                raise
        try:
            if path.exists():
                temp_path.chmod(stat.S_IMODE(path.stat().st_mode))
            os.replace(temp_path, path)
        finally:
            temp_path.unlink(missing_ok=True)
    return len(records)
