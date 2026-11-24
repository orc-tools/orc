"""Which runs stopped working since the user last opened them.

The run list marks those rows, so a reply nobody has read stands apart from
one that was read and left for later."""
import json
import os
import tempfile
import threading

WORKING = "working"
UNREAD = "unread"
# A turn that began at a gate the user had already read. Ending it there
# leaves the run read: a gate is unread once, when it first opens.
GATE_WORKING = "gate-working"

_LOCK = threading.Lock()
# Another server on the same run store may write the file, so it is read again
# whenever its mtime moves.
_HELD = {"path": None, "stamp": None, "runs": {}}


def _stamp(path):
    try:
        return os.stat(path).st_mtime_ns
    except OSError:
        return None


def _load(path):
    stamp = _stamp(path)
    if _HELD["path"] == path and _HELD["stamp"] == stamp:
        return _HELD["runs"]
    runs = {}
    try:
        with open(path) as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            runs = {run_id: value for run_id, value in data.items()
                    if isinstance(run_id, str) and value in (WORKING, UNREAD, GATE_WORKING)}
    except (OSError, ValueError):
        pass
    _HELD.update(path=path, stamp=stamp, runs=runs)
    return runs


def _save(path, runs):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    handle, temp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".unread-")
    try:
        with os.fdopen(handle, "w") as out:
            json.dump(runs, out, sort_keys=True)
        os.replace(temp, path)
    except OSError:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise
    _HELD.update(path=path, stamp=_stamp(path), runs=runs)


def observe(path, rows):
    """Set payload-only `meta["unread"]` on each scanned row whose session
    stopped working and has not been opened since. A run first seen already
    stopped is not unread: nothing says the user missed it, and neither is a
    run whose turn started and ended at a gate already read."""
    with _LOCK:
        held = _load(path)
        runs = {}
        for row in rows:
            meta = row.get("meta") or {}
            meta.pop("unread", None)
            if meta.get("status") == "running" and (meta.get("focusQueue") or {}).get("paused"):
                continue
            mark = held.get(row["id"])
            if meta.get("sessionActivity") == "running":
                # Leaving the gate makes this an ordinary turn again.
                at_read_gate = meta.get("status") == "awaiting-gate" and mark in (None, GATE_WORKING)
                runs[row["id"]] = GATE_WORKING if at_read_gate else WORKING
            elif mark in (WORKING, UNREAD):
                runs[row["id"]] = UNREAD
                meta["unread"] = True
        if runs != held:
            try:
                _save(path, runs)
            except OSError:
                # The marks still hold for this server; the next scan retries.
                _HELD.update(path=path, runs=runs)


def apply(path, rows):
    """Apply persisted unread marks to a partial row list without mutating the store."""
    with _LOCK:
        held = _load(path)
        for row in rows:
            meta = row.get("meta") or {}
            meta.pop("unread", None)
            if meta.get("status") == "running" and (meta.get("focusQueue") or {}).get("paused"):
                continue
            if meta.get("sessionActivity") != "running" and held.get(row["id"]) in (WORKING, UNREAD):
                meta["unread"] = True


def mark_read(path, run_id):
    """The user opened the run. Returns whether it was unread."""
    with _LOCK:
        held = _load(path)
        if held.get(run_id) != UNREAD:
            return False
        _save(path, {key: value for key, value in held.items() if key != run_id})
        return True
