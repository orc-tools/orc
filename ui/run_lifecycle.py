"""Guard phase/status at the metadata replace, across server and CLI processes."""

import contextlib
import copy
import fcntl
import json
import os
import tempfile
from pathlib import Path

from state_transitions import RefusedTransition as RefusedTransition
from state_transitions import advance, refuse


# Each event names the destination requested by the caller. The two projections
# keep the diagram legible. validate() checks the phase/status pair together.
def moves(destinations):
    return {state: {target: target for target in targets.split()}
            for state, targets in destinations.items()}


PHASE = moves({
    "unset": "grilling clarification planning plan build local-review qa-hub ship done",
    "grilling": "clarification planning plan build local-review qa-hub ship done",
    "clarification": "plan build ship done",
    "planning": "plan build done",
    "plan": "clarification build verify ship present recap done",
    "build": "plan review verify mvp qa ship present recap done",
    "review": "build verify mvp qa ship present recap done",
    "verify": "build ship done",
    "qa": "build review present recap ship done",
    "mvp": "build qa review present recap ship done",
    "recap": "build present ship done",
    "present": "build recap ship done",
    "ship": "build done",
    "qa-hub": "done",
    "local-review": "done",
    "done": "grilling plan ship qa-hub",
})
STATUS = moves({
    "unset": "running awaiting-gate escalated complete cancelled merged failed merging",
    "running": "awaiting-gate escalated paused merging merging-to-parent bringing-to-main complete merged cancelled failed",
    "awaiting-gate": "running escalated paused merging merging-to-parent bringing-to-main complete merged cancelled failed",
    "escalated": "running awaiting-gate paused merging complete merged cancelled failed",
    "paused": "running awaiting-gate escalated complete cancelled",
    "merging": "running awaiting-gate escalated merged",
    "merging-to-parent": "awaiting-gate escalated merged-to-parent",
    "bringing-to-main": "awaiting-gate escalated complete cancelled",
    "complete": "running awaiting-gate escalated merging merged cancelled",
    "failed": "running awaiting-gate complete cancelled",
    "cancelled": "",
    "merged": "",
    "merged-to-parent": "",
})


def state(meta):
    return (meta.get("phase") or "unset", meta.get("status") or "unset")


SETTLED = {"complete", "failed", "cancelled", "merged", "merged-to-parent"}
REOPEN = {
    "grilling": {"running"}, "plan": {"running", "escalated"},
    "ship": {"running", "escalated"}, "qa-hub": {"awaiting-gate"},
}


def validate(before, after, *, owner, caller):
    if before == after:
        return
    phase, status = before
    next_phase, next_status = after
    context = dict(machine="run", owner=owner, caller=caller)
    # Historical delivery helpers could leave a merged run at its final gate.
    if status == next_status == "merged" and next_phase == "done" and phase in ("ship", "recap", "present"):
        return
    if status in ("cancelled", "merged", "merged-to-parent"):
        refuse("run", owner, caller, before, after)
    if phase != next_phase:
        advance(PHASE, phase, next_phase, **context)
        if next_phase == "done" and next_status not in SETTLED:
            refuse("run", owner, caller, before, after)
        if phase == "done" and next_status not in REOPEN.get(next_phase, ()):
            refuse("run", owner, caller, before, after)
        if next_phase != "done" and next_status in SETTLED:
            refuse("run", owner, caller, before, after)
    if status != next_status:
        advance(STATUS, status, next_status, **context)
    if next_status in ("merged", "merged-to-parent", "failed") and next_phase != "done":
        refuse("run", owner, caller, before, after)


class Snapshot(dict):
    """Remember the observed document so unrelated concurrent edits survive."""
    def __init__(self, value):
        super().__init__(value)
        self.original = copy.deepcopy(dict(value))


def write_meta(path, meta, *, caller, expected=None, receipt_field=None):
    """Commit changes under the per-run lock. expected is the original document
    when a helper replaces the entire metadata shape (e.g. question publication).
    """
    path = Path(path)
    with locked_run(path.parent):
        write_locked(path, meta, caller=caller, expected=expected, receipt_field=receipt_field)


@contextlib.contextmanager
def locked_run(directory):
    """Lock the stable directory inode, since meta.json is replaced on every write."""
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


def write_locked(path, meta, *, caller, expected=None, original_bytes=None, receipt_field=None):
    owner = path.parent.name
    try:
        current = json.loads(path.read_bytes())
    except FileNotFoundError:
        current = {}
    if not isinstance(current, dict):
        refuse("run", owner, caller, "invalid metadata", state(meta))
    original = expected if expected is not None else getattr(meta, "original", None)
    value = dict(meta)
    if receipt_field is not None and original is None:
        refuse("run", owner, caller, state(current), "receipt without an observed ledger")
    if original is not None:
        changed = {key for key in original.keys() | meta.keys()
                   if (key in original) != (key in meta) or original.get(key) != meta.get(key)}
        if receipt_field is not None:
            # A remote action already succeeded. Record its receipt even when the
            # lifecycle moved, but only against the same ledger that authorized it.
            if (receipt_field in ("phase", "status") or changed - {receipt_field}
                    or original.get(receipt_field) != current.get(receipt_field)):
                refuse("run", owner, caller, state(current), f"stale {receipt_field} receipt")
        elif state(current) != state(original):
            refuse("run", owner, caller, state(current), f"stale write based on {state(original)}")
        value = current.copy()
        for key in changed:
            if key in meta:
                value[key] = meta[key]
            else:
                value.pop(key, None)
    before, after = state(current), state(value)
    validate(before, after, owner=owner, caller=caller)
    if before[0] != after[0] and after[0] == "verify" and value.get("lifecycleVersion") == 4:
        refuse("run", owner, caller, before, "enter Verify in lifecycle v4")
    if original_bytes is None:
        payload = (json.dumps(value, indent=2) + "\n").encode()
    elif json.loads(original_bytes) == value:
        payload = original_bytes
    else:
        refuse("run", owner, caller, state(current), "rollback document changed")
    fd, temporary = tempfile.mkstemp(prefix=".meta.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)
    if isinstance(meta, Snapshot):
        # Callers can keep a reference to a nested reply ledger across writes.
        for key in meta.keys() - value.keys():
            del meta[key]
        for key, item in value.items():
            if key not in meta or meta[key] != item:
                meta[key] = item
        meta.original = copy.deepcopy(value)
