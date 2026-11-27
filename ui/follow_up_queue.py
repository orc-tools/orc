"""Guard changes to follow-ups.json under the caller's .follow-ups.lock."""

import contextlib
import fcntl
import json
import os
import tempfile
from pathlib import Path

from state_transitions import advance, refuse

WARNING = "Delivery was not confirmed. Check the conversation before retrying."

# The sender records the previous hold before dispatch. A definite failure
# restores that hold. A successful Send now releases only a scheduler hold.
TRANSITIONS = {
    "ready": {"schedule": "scheduled", "pause": "paused", "auto-send": "sending-ready",
              "send-now": "sending-ready", "steer": "ready"},
    "scheduled": {"schedule": "scheduled", "pause": "paused", "release": "ready",
                  "send-now": "sending-scheduled"},
    "paused": {"pause": "paused", "release": "ready", "release-to-scheduler": "scheduled"},
    "stopped": {"send-now": "sending-stopped", "schedule": "scheduled"},
    "uncertain": {"send-now": "sending-uncertain"},
}
for hold, edges in list(TRANSITIONS.items()):
    edges.update({"edit": hold, "stop": hold if hold == "uncertain" else "stopped", "resume": "ready"})
    if hold != "paused":
        TRANSITIONS["sending-" + hold] = {
            "accepted": "ready" if hold == "scheduled" else hold,
            "definitely_unsent": hold,
            "uncertain": "uncertain",
        }


@contextlib.contextmanager
def lock(run_dir):
    """Take the queue lock before control_lock when a delivery or rescue needs both."""
    with open(os.path.join(run_dir, ".follow-ups.lock"), "a+") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def hold(data):
    if not data.get("held"):
        return "ready"
    if data.get("uncertain") or str(data.get("lastError", "")).startswith(WARNING):
        return "uncertain"
    if data.get("runPause"):
        return "paused"
    if data.get("focusPaused"):
        return "scheduled"
    return "stopped"


def projection(data, *, in_flight=False):
    previous = data.get("delivering")
    if isinstance(previous, dict):
        # A different lock owner can only encounter an abandoned attempt.
        return "sending-" + hold(previous) if in_flight else "uncertain"
    return hold(data)


def write(path, state, event, *, caller):
    """Check the event against the durable state before replacing or deleting it."""
    path = Path(path)
    try:
        raw = json.loads(path.read_bytes())
    except (ValueError, FileNotFoundError):
        raw = {}
    if not isinstance(raw, dict):
        raw = {}
    finishing = event in ("accepted", "definitely_unsent", "uncertain")
    before = projection(raw, in_flight=finishing)
    after = projection(state, in_flight=True)
    target = advance(TRANSITIONS, before, event, machine="follow-up queue",
                     owner=path.parent.name, caller=caller)
    if before == "stopped" and event == "schedule" and (raw.get("items") or raw.get("lastError")):
        refuse("follow-up queue", path.parent.name, caller, before, "schedule held work")
    if after != target:
        refuse("follow-up queue", path.parent.name, caller, before, (event, after))
    if not state.get("items") and not state.get("held"):
        path.unlink(missing_ok=True)
        return
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=".follow-ups.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(state, handle, indent=2)
            handle.write("\n")
        os.replace(temp, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temp)
