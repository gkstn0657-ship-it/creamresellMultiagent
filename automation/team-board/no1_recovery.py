"""Check the existing user's No1 work order and resume it after authentication returns."""

import shutil
import subprocess
import time
from pathlib import Path

from board import DEFAULT_DATA
from external_activity import ORDER, read_object, roots_for_board, worker_alive
from public_sourcing import atomic_json


HERE = Path(__file__).resolve().parent
CONNECTIVITY = {"NO1_AUTH_REQUIRED", "NO1_BRIDGE_UNAVAILABLE", "NO1_BRIDGE_DISCONNECTED",
                "NO1_CONNECTOR_UPDATE_REQUIRED", "NO1_WEB_TAB_REQUIRED", "EXPLORATION_WORKER_NOT_RUNNING"}
PROBE = """
import {BackgroundClient} from '../no1-background/client.mjs';
import {CONNECTOR_VERSION} from '../no1-background/chrome-extension/protocol.mjs';
const client = new BackgroundClient();
try {
  const connection = await client.status();
  if (!connection.browserConnected) console.log('NO1_BRIDGE_DISCONNECTED');
  else if (connection.connectorVersion !== CONNECTOR_VERSION) console.log('NO1_CONNECTOR_UPDATE_REQUIRED');
  else if (connection.requestPending) console.log('BUSY');
  else {
    const session = await client.request('connector:session-status', {});
    console.log(session.authenticatedTabCount > 0 && session.distinctSessionCount === 1 && !session.error
      ? 'AUTHENTICATED' : (session.error || 'NO1_AUTH_REQUIRED'));
  }
} catch (error) { console.log(error.message); }
"""
RESUME = """
import {existsSync} from 'node:fs';
import {startExploration} from '../agent-team/exploration.mjs';
const [root, workId, stopFile] = process.argv.slice(1);
if (existsSync(stopFile)) console.log('STOPPED');
else {
  const r = await startExploration(root, {workId, resume:true}, {requireOpenWork:true});
  console.log(r.launched || r.reused ? 'RESUMED' : r.status);
}
"""


def _node(source, *args):
    result = subprocess.run([shutil.which("node") or "node", "--input-type=module", "-e", source, *map(str, args)],
                            cwd=HERE, capture_output=True, text=True, timeout=35, encoding="utf-8",
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return result.stdout.strip() if result.returncode == 0 else "CHECK_FAILED"


def check(work_id, state_dir):
    """Return a short status. Never create an order or attempt to log the user in."""
    if not isinstance(work_id, str) or not ORDER.fullmatch(work_id):
        return "invalid_work_id"
    state_dir = Path(state_dir)
    stopped = state_dir / "STOP"
    if stopped.exists():
        return "stopped"
    root = next((p for p in roots_for_board(DEFAULT_DATA)
                 if (p / "work-orders" / (work_id + ".json")).is_file()), None)
    if not root:
        return "work_not_found"
    order = read_object(root / "work-orders" / (work_id + ".json"))
    folder = root / "explorations" / work_id
    state = read_object(folder / "state.json")
    if (order.get("id") != work_id or order.get("status") != "open" or folder.joinpath("STOP").exists()
            or state.get("mode") != "live" or state.get("workId") != work_id
            or order.get("scopeMode") in {"inspected-sources", "profitable-results"}):
        return "inactive"
    if worker_alive(read_object(folder / "process.json")):
        return "running"
    recoverable = state.get("error") in CONNECTIVITY or state.get("status") in {
        "starting", "discovering", "running_batch", "interrupted"}
    if not recoverable:
        return str(state.get("status", "unknown"))
    memo = state_dir / f"{work_id}-recovery.json"
    last = read_object(memo)
    now = time.time()
    try:
        status = _node(PROBE)
        if status == "NO1_BRIDGE_UNAVAILABLE" and now - last.get("bridgeAt", 0) >= 900 and not stopped.exists():
            entry = HERE.parent / "no1-background" / "run-bridge.mjs"
            last["bridgeAt"] = now
            atomic_json(memo, last)
            subprocess.Popen([shutil.which("node") or "node", str(entry)], cwd=entry.parent,
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            return "bridge_restart_requested"
        if status != "AUTHENTICATED" or stopped.exists():
            return status if status in CONNECTIVITY | {"BUSY", "CHECK_FAILED"} else "waiting_for_auth"
        # Back off when a supplier rejects a session that appeared valid to the connector.
        # A newly completed batch resets this cooldown as subsequent progress is genuine.
        batch_count = len(order.get("entries", []))
        attempts = int(last.get("attempts", 0)) if last.get("batchCount") == batch_count else 0
        delay = min(3600, 120 * 2 ** min(attempts, 5))
        if attempts and now - last.get("attemptAt", 0) < delay:
            return "resume_cooldown"
        last.update(attemptAt=now, attempts=attempts + 1, batchCount=batch_count)
        atomic_json(memo, last)
        return _node(RESUME, root, work_id, stopped)
    except (ValueError, OSError, subprocess.SubprocessError):
        return "check_unavailable"
