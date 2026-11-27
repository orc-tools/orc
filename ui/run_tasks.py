"""External, durable authority for opt-in run tasks and result delivery.

``tasks.json`` holds the tasks still in play. Each reconcile moves a parent's
settled tasks, finished and delivered, with its acknowledged send receipts,
into ``tasks-archive/<parent run id>.json``, so the whole-file rewrite on every
update stays small. A lookup that misses ``tasks.json`` reads the archive."""
from __future__ import annotations

import contextlib
import copy
import fcntl
import hashlib
import json
import os
import secrets
import stat
import tempfile
import threading
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

from run_relationships import valid_run_id
from stat_cache import keep_recent
from state_transitions import advance, refuse


TASK_TRANSITIONS = {
    "queued": {"prepare": "launching", "bind": "queued", "observe_running": "running",
               "observe_waiting": "waiting", "observe_failure": "failed",
               "legacy_complete": "completed", "legacy_interrupt": "interrupted",
               "cancel": "cancelled"},
    "launching": {"claim_launch": "launching", "bind": "launching",
                  "save_workspace": "launching",
                  "launch_unknown": "launching", "launch_accepted": "running",
                  "launch_rejected": "failed", "observe_running": "running",
                  "observe_waiting": "waiting", "observe_failure": "failed",
                  "publish_success": "completed", "publish_failure": "failed",
                  "legacy_complete": "completed", "legacy_interrupt": "interrupted",
                  "cancel": "cancelled"},
    "running": {"bind": "running", "observe_running": "running", "observe_waiting": "waiting",
                "observe_failure": "failed", "publish_success": "completed",
                "publish_failure": "failed", "legacy_complete": "completed",
                "legacy_interrupt": "interrupted", "cancel": "cancelled"},
    "waiting": {"bind": "waiting", "observe_running": "running", "observe_waiting": "waiting",
                "observe_failure": "failed", "publish_success": "completed",
                "publish_failure": "failed", "legacy_complete": "completed",
                "legacy_interrupt": "interrupted", "cancel": "cancelled"},
    "completed": {"cancel": "completed"},
    "failed": {"cancel": "failed"},
    "cancelled": {"cancel": "cancelled", "bind_for_cleanup": "cancelled", "cancel_cleanup": "cancelled"},
    "interrupted": {"cancel": "interrupted"},
}
TERMINAL = frozenset({"completed", "failed", "cancelled", "interrupted"})
DELIVERY_TRANSITIONS = {
    "unread": {"schedule": "pending", "read": "acknowledged", "cancel": "cancelled"},
    "pending": {"claim": "sending", "defer": "unread", "read": "acknowledged", "cancel": "cancelled"},
    "sending": {"accepted": "acknowledged", "uncertain": "ambiguous",
                "sender_lost": "ambiguous", "cancel": "cancelled"},
    "acknowledged": {"cancel": "cancelled"},
    "ambiguous": {"cancel": "cancelled"},
    "cancelled": {"cancel": "cancelled"},
}
LEGACY_EVENTS = {
    "launching": "prepare", "running": "observe_running", "waiting": "observe_waiting",
    "failed": "observe_failure", "completed": "legacy_complete",
    "interrupted": "legacy_interrupt", "cancelled": "cancel",
}
LAUNCH_EVENTS = {"launching": "launch_unknown", "running": "launch_accepted", "failed": "launch_rejected"}
ARCHIVE_DIR = "tasks-archive"
# Which parent's archive holds each child, request and send, so a lookup that
# misses tasks.json reads at most one archive. Not a valid run id, so it never
# names a parent's archive.
ARCHIVE_INDEX = ".index.json"


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _read(config_dir):
    try:
        with open(Path(config_dir) / "tasks.json", encoding="utf-8") as handle:
            store = json.load(handle)
    except FileNotFoundError:
        return {"schemaVersion": 1, "policies": {}, "tasks": []}
    except (OSError, ValueError) as exc:
        raise ValueError("task store is unreadable") from exc
    if (not isinstance(store, dict) or store.get("schemaVersion") != 1
            or not isinstance(store.get("policies"), dict)
            or not isinstance(store.get("tasks"), list)
            or any(not isinstance(row, dict) for row in store["tasks"])):
        raise ValueError("unsupported task store")
    return store


# Polling repeatedly reads the live store and index. Keep recently visited
# archives with them, so finished parents can fall out of memory.
_CACHE_LIMIT = 32
_CACHE = OrderedDict()
_CACHE_LOCK = threading.Lock()


def _signature(st):
    return (st.st_ino, st.st_size, st.st_mtime_ns)


def _remember(path, signature, value):
    with _CACHE_LOCK:
        keep_recent(_CACHE, path, (signature, value), _CACHE_LIMIT)


def _cached(path, read):
    """``read(path)``, shared between readers: copy anything handed out."""
    path = str(path)
    try:
        signature = _signature(os.stat(path))
    except FileNotFoundError:
        with _CACHE_LOCK:
            _CACHE.pop(path, None)
        return read(path)
    except OSError as exc:
        raise ValueError("task store is unreadable") from exc
    with _CACHE_LOCK:
        cached = _CACHE.get(path)
        if cached is not None and cached[0] == signature:
            _CACHE.move_to_end(path)
            return cached[1]
    # A replace between the stat and this read leaves an old signature on
    # newer content, which only costs the next call a parse.
    value = read(path)
    _remember(path, signature, value)
    return value


def _shared(config_dir):
    """The parsed store, shared between readers: copy anything handed out."""
    return _cached(Path(config_dir) / "tasks.json", lambda path: _read(config_dir))


def _read_archive(path):
    try:
        with open(path, encoding="utf-8") as handle:
            archive = json.load(handle)
    except FileNotFoundError:
        return {"schemaVersion": 1, "tasks": [], "sendReceipts": []}
    except (OSError, ValueError) as exc:
        raise ValueError("task archive is unreadable") from exc
    if (not isinstance(archive, dict) or archive.get("schemaVersion") != 1
            or any(not isinstance(archive.get(key), list)
                   or any(not isinstance(row, dict) for row in archive[key])
                   for key in ("tasks", "sendReceipts"))):
        raise ValueError("unsupported task archive")
    return archive


def _archive_path(config_dir, parent_id):
    return Path(config_dir) / ARCHIVE_DIR / (parent_id + ".json")


def _archived(config_dir, parent_id):
    """One parent's archive, shared between readers: copy anything handed out."""
    return _cached(_archive_path(config_dir, parent_id), _read_archive)


def _read_index(path):
    try:
        with open(path, encoding="utf-8") as handle:
            index = json.load(handle)
    except FileNotFoundError:
        return {"schemaVersion": 1, "children": {}, "requests": {}, "sends": {}, "signatures": {}}
    except (OSError, ValueError) as exc:
        raise ValueError("task archive index is unreadable") from exc
    if (not isinstance(index, dict) or index.get("schemaVersion") != 1
            or any(not isinstance(index.get(key), dict)
                   for key in ("children", "requests", "sends"))
            or not isinstance(index.setdefault("signatures", {}), dict)):
        raise ValueError("unsupported task archive index")
    return index


def _index_path(config_dir):
    return Path(config_dir) / ARCHIVE_DIR / ARCHIVE_INDEX


def _index(config_dir):
    """The archive index, shared between readers: copy anything handed out."""
    return _cached(_index_path(config_dir), _read_index)


def _archived_parents(config_dir):
    try:
        names = os.listdir(Path(config_dir) / ARCHIVE_DIR)
    except FileNotFoundError:
        return set()
    return {name[:-5] for name in names if name.endswith(".json") and valid_run_id(name[:-5])}


def _archive_signature(config_dir, parent_id):
    try:
        return list(_signature(os.stat(_archive_path(config_dir, parent_id))))
    except FileNotFoundError:
        return None


def _indexed(config_dir, locked, parents=None):
    """The archive index, rebuilt from the archives first when it is out of
    date for any of ``parents``, or for any archive when None: deleted,
    restored from an older copy, or left behind by a prune cut off between
    writing an archive and the index. Each archive's signature in the index
    is checked with one stat. ``locked`` says the caller already holds
    .tasks.lock. A malformed index or archive raises ValueError rather than
    being rebuilt over."""
    index = _index(config_dir)
    signatures = index["signatures"]
    if parents is None:
        parents = _archived_parents(config_dir) | set(signatures)
    if all(signatures.get(parent_id) == _archive_signature(config_dir, parent_id)
           for parent_id in parents):
        return index
    if not locked:
        with _flocked(config_dir):
            return _indexed(config_dir, True, parents)
    return _rebuild_index(config_dir)


def _rebuild_index(config_dir):
    index = {"schemaVersion": 1, "children": {}, "requests": {}, "sends": {}, "signatures": {}}
    for parent_id in sorted(_archived_parents(config_dir)):
        archive = _read_archive(_archive_path(config_dir, parent_id))
        for row in archive["tasks"]:
            if valid_run_id(row.get("childRunId")):
                index["children"][row["childRunId"]] = parent_id
        index["requests"][parent_id] = sorted({row.get("requestId") for row in archive["tasks"]}
                                              - {None})
        index["sends"][parent_id] = sorted({row.get("requestId") for row in archive["sendReceipts"]}
                                           - {None})
        index["signatures"][parent_id] = _archive_signature(config_dir, parent_id)
    _replace(_index_path(config_dir), index)
    return _index(config_dir)


def _archived_holding(config_dir, kind, parent_id, request_id, locked):
    """The rows of ``kind`` in ``parent_id``'s archive, read only when the
    index says it holds ``request_id``."""
    index = _indexed(config_dir, locked, [parent_id])
    if request_id not in index["requests" if kind == "tasks" else "sends"].get(parent_id, ()):
        return []
    return _archived(config_dir, parent_id)[kind]


def _replace(path, value):
    """Write ``value`` as JSON to ``path`` atomically and durably."""
    directory = Path(path).parent
    fd, temporary = tempfile.mkstemp(dir=directory, prefix="." + Path(path).stem + ".", suffix=".tmp")
    try:
        text = json.dumps(value, indent=2, sort_keys=True) + "\n"
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
            signature = _signature(os.fstat(handle.fileno()))
        os.replace(temporary, path)
        # Parsed from the written text, never the value the caller holds.
        _remember(str(path), signature, json.loads(text))
        descriptor = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


@contextlib.contextmanager
def _flocked(config_dir):
    directory = Path(config_dir)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(directory / ".tasks.lock", "a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        yield


@contextlib.contextmanager
def _locked(config_dir):
    with _flocked(config_dir):
        store = _read(config_dir)
        original = copy.deepcopy(store)
        yield store
        if store != original:
            _replace(Path(config_dir) / "tasks.json", store)


def _parent(parent_id):
    if not valid_run_id(parent_id):
        raise ValueError("invalid parent run id")


def _find(rows, parent_id, task_id):
    return next((row for row in rows
                 if row.get("parentRunId") == parent_id and row.get("taskId") == task_id), None)


@contextlib.contextmanager
def _locked_task(config_dir, parent_id, task_id):
    _parent(parent_id)
    with _locked(config_dir) as store:
        live = _find(store["tasks"], parent_id, task_id)
        if live is not None:
            yield store, live
            return
        archived = _find(_archived(config_dir, parent_id)["tasks"], parent_id, task_id)
        if archived is None:
            raise ValueError("task not found")
        row = copy.deepcopy(archived)
        yield store, row
        if row != archived:
            store["tasks"].append(row)


def _child_task(rows, config_dir, child_id, locked):
    row = next((row for row in rows if row.get('childRunId') == child_id), None)
    if row is None:
        parent_id = _index(config_dir)['children'].get(child_id)
        # A child the index maps names the one archive to check; one it does
        # not could be in any of them.
        parent_id = _indexed(config_dir, locked, [parent_id] if parent_id else None)[
            'children'].get(child_id)
        if valid_run_id(parent_id):
            row = next((row for row in _archived(config_dir, parent_id)['tasks']
                        if row.get('childRunId') == child_id), None)
    return row


def configure(config_dir, parent_id, enabled):
    _parent(parent_id)
    if type(enabled) is not bool:
        raise ValueError("enabled must be boolean")
    with _locked(config_dir) as store:
        row = {"enabled": enabled, "updatedAt": _now()}
        store["policies"][parent_id] = row
        return copy.deepcopy(row)


def policy(config_dir, parent_id):
    _parent(parent_id)
    return copy.deepcopy(_shared(config_dir)["policies"].get(parent_id, {"enabled": False}))


def list_tasks(config_dir, parent_id):
    _parent(parent_id)
    live = [row for row in _shared(config_dir)["tasks"] if row.get("parentRunId") == parent_id]
    ids = {row.get("taskId") for row in live}
    archived = [row for row in _archived(config_dir, parent_id)["tasks"] if row.get("taskId") not in ids]
    return copy.deepcopy(sorted(archived + live, key=lambda row: row.get("createdAt") or ""))


def list_sends(config_dir, parent_id):
    """The messages ``parent_id`` sent to its workers' threads, oldest first."""
    _parent(parent_id)
    live = [row for row in _shared(config_dir).get("sendReceipts", []) if row.get("parentRunId") == parent_id]
    ids = {row.get("requestId") for row in live}
    archived = [row for row in _archived(config_dir, parent_id)["sendReceipts"] if row.get("requestId") not in ids]
    return copy.deepcopy(sorted(archived + live, key=lambda row: row.get("createdAt") or ""))


def get_task(config_dir, parent_id, task_id):
    _parent(parent_id)
    row = (_find(_shared(config_dir)["tasks"], parent_id, task_id)
           or _find(_archived(config_dir, parent_id)["tasks"], parent_id, task_id))
    if row is None:
        raise ValueError("task not found")
    return copy.deepcopy(row)


def reserve(config_dir, parent_id, request_id, request, selection):
    _parent(parent_id)
    if not isinstance(request_id, str) or not request_id.strip() or len(request_id) > 256:
        raise ValueError("invalid request id")
    if (not isinstance(request, dict) or any(not isinstance(request.get(key), str)
            or not request[key].strip() for key in ("text", "kind", "project", "agent"))):
        raise ValueError("invalid task request")
    if not isinstance(selection, dict) or not isinstance(selection.get("agent"), str) or not selection["agent"]:
        raise ValueError("invalid task selection")
    try:
        request, selection = json.loads(json.dumps([request, selection], allow_nan=False))
    except (TypeError, ValueError) as exc:
        raise ValueError("task request must be JSON") from exc
    with _locked(config_dir) as store:
        if store["policies"].get(parent_id, {}).get("enabled") is not True:
            raise ValueError("task orchestration is disabled for this run")
        for row in store["tasks"] + _archived_holding(config_dir, "tasks", parent_id, request_id, True):
            if row.get("parentRunId") == parent_id and row.get("requestId") == request_id:
                if row.get("request") != request or row.get("selection") != selection:
                    raise ValueError("request id already has different task authority")
                return copy.deepcopy(row), False
        parent_task = _child_task(store['tasks'], config_dir, parent_id, True)
        if parent_task and parent_task['state'] in TERMINAL:
            raise ValueError('delegated worker task is terminal')
        now = _now()
        row = {"taskId": secrets.token_hex(12), "launchToken": secrets.token_hex(12),
               "parentRunId": parent_id, "requestId": request_id,
               "request": request, "selection": selection, "state": "queued",
               "childRunId": None, "result": None, "delivery": {"state": "unread"},
               "createdAt": now, "updatedAt": now}
        store["tasks"].append(row)
        return copy.deepcopy(row), True


def _task_event(row, event, caller):
    return advance(TASK_TRANSITIONS, row["state"], event, machine="task",
                   owner=row["taskId"], caller=caller)


def _delivery_state(row):
    return (row.get("delivery") or {}).get("state", "unread")


def _delivery_event(row, event, caller, **details):
    state = advance(DELIVERY_TRANSITIONS, _delivery_state(row), event, machine="task delivery",
                    owner=row["taskId"], caller=caller)
    row["delivery"] = {"state": state, **details}


def _bind_child(row, child_id, caller):
    if not valid_run_id(child_id):
        raise ValueError("invalid child run id")
    if row.get("childRunId") == child_id:
        return
    if row.get("childRunId"):
        refuse("task", row["taskId"], caller, row["state"], "replace accepted child identity")
    event = "bind"
    if row["state"] == "cancelled" and row.get("cancellationPending"):
        event = "bind_for_cleanup"
    _task_event(row, event, caller)
    row["childRunId"] = child_id


def _settle_observation(store, row, event, caller):
    state = _task_event(row, event, caller)
    if state in {"completed", "failed", "interrupted"} and row.get("childRunId") \
            and _has_live_descendants(store, row["childRunId"]):
        refuse("task", row["taskId"], caller, row["state"], f"{event} with live delegated children")
    row["state"] = state


def prepare_launch(config_dir, parent_id, task_id):
    with _locked_task(config_dir, parent_id, task_id) as (_, row):
        if row["state"] not in TERMINAL:
            row.update(state=_task_event(row, "prepare", "prepare_launch"), updatedAt=_now())
        return copy.deepcopy(row)


def update_task(config_dir, parent_id, task_id, *, if_active=False, **changes):
    """Compatibility entry point for legacy question launches and their watch tick."""
    allowed = {"state", "childRunId", "result", "delivery", "error", "workspace", "cancellationPending"}
    if set(changes) - allowed:
        raise ValueError("task identity cannot be changed")
    with _locked_task(config_dir, parent_id, task_id) as (store, row):
        original = row.copy()
        before = row["state"]
        if if_active and before in TERMINAL:
            return copy.deepcopy(row)
        state = changes.pop("state", before)
        if not isinstance(state, str) or state not in TASK_TRANSITIONS:
            refuse("task", task_id, "update_task", before, "set invalid task state")
        has_child_change = "childRunId" in changes
        child_id = changes.pop("childRunId", None)
        has_delivery_change = "delivery" in changes
        delivery = changes.pop("delivery", None)
        if "result" in changes and (before in TERMINAL or state != "completed" or row.get("result")):
            if changes.pop("result") != row.get("result"):
                refuse("task", task_id, "update_task", before, "replace immutable result")
        if child_id is not None:
            _bind_child(row, child_id, "update_task")
        elif has_child_change and row.get("childRunId"):
            refuse("task", task_id, "update_task", before, "clear accepted child identity")
        launch = row.get("launch") or {}
        settling_legacy = launch.get("legacy") and launch.get("state") == "starting" and (
            state in {"running", "failed"} or "error" in changes)
        if settling_legacy:
            row["launch"] = {**launch, "state": "settled"}
            if before in TERMINAL:
                row["updatedAt"] = _now()
                return copy.deepcopy(row)
            event = LAUNCH_EVENTS.get(state, "launch_unknown")
            _settle_observation(store, row, event, "update_task")
        elif state != before:
            if before in TERMINAL:
                refuse("task", task_id, "update_task", before, "replace terminal state")
            if state == "cancelled":
                _cancel_tree(store, row, "update_task")
            else:
                _settle_observation(store, row, LEGACY_EVENTS.get(state), "update_task")
                if state == "launching":
                    row["launch"] = {"state": "starting", "pid": os.getpid(), "legacy": True}
        if "workspace" in changes and changes["workspace"] != row.get("workspace"):
            if row.get("workspace"):
                refuse("task", task_id, "update_task", before, "replace workspace authority")
            _task_event(row, "save_workspace", "update_task")
        if "cancellationPending" in changes or (before in TERMINAL and "error" in changes):
            _task_event(row, "cancel_cleanup", "update_task")
        row.update(copy.deepcopy(changes))
        if has_delivery_change:
            _legacy_delivery(row, delivery, "update_task", newly_terminal=before not in TERMINAL)
        if row != original:
            row["updatedAt"] = _now()
        return copy.deepcopy(row)


def _legacy_delivery(row, delivery, caller, *, newly_terminal):
    if not isinstance(delivery, dict):
        raise ValueError("invalid delivery")
    target = delivery.get("state")
    before = _delivery_state(row)
    if target == "unread":
        if before != "pending":
            return
        _delivery_event(row, "defer", caller, **{k: v for k, v in delivery.items() if k != "state"})
    elif target == "pending" and newly_terminal and _can_deliver(row):
        _delivery_event(row, "schedule", caller)
    elif delivery != row.get("delivery"):
        refuse("task delivery", row["taskId"], caller, before, f"set {target}")


def begin_launch(config_dir, parent_id, task_id):
    with _locked_task(config_dir, parent_id, task_id) as (_, row):
        if row["state"] in TERMINAL or row.get("launch"):
            return copy.deepcopy(row), False
        _task_event(row, "claim_launch", "begin_launch")
        row.update(launch={"state": "starting", "pid": os.getpid()}, updatedAt=_now())
        return copy.deepcopy(row), True


def finish_launch(config_dir, parent_id, task_id, state, error=None):
    event = LAUNCH_EVENTS.get(state)
    if event is None:
        raise ValueError("invalid launch outcome")
    with _locked_task(config_dir, parent_id, task_id) as (store, row):
        launch = row.get("launch")
        if launch:
            if launch.get("state") != "starting":
                return copy.deepcopy(row)
            launch["state"] = "settled"
        elif event != "launch_rejected" or row["state"] != "launching":
            return copy.deepcopy(row)
        if row["state"] == "launching":
            if event == "launch_accepted" and not row.get("childRunId"):
                refuse("task", task_id, "finish_launch", row["state"], "accept unbound child")
            child_id = row.get("childRunId")
            if event != "launch_rejected" or not child_id or not _has_live_descendants(store, child_id):
                _settle_observation(store, row, event, "finish_launch")
            row["error"] = error
        row["updatedAt"] = _now()
        return copy.deepcopy(row)


def _cancel_tree(store, root, caller):
    pending, cancelled, seen = [root], [], set()
    by_parent = _by_parent(store)
    while pending:
        row = pending.pop()
        if row["taskId"] in seen:
            continue
        seen.add(row["taskId"])
        before = row["state"]
        row["state"] = _task_event(row, "cancel", caller)
        if _delivery_state(row) != "cancelled":
            _delivery_event(row, "cancel", caller)
            row["updatedAt"] = _now()
        if row["state"] == "cancelled":
            if before != "cancelled":
                launching = (row.get("launch") or {}).get("state") == "starting"
                row.update(cancellationPending=bool(row.get("childRunId") or launching),
                           updatedAt=_now())
            if row.get("cancellationPending") or row.get("error"):
                cancelled.append(row)
        if row.get("childRunId"):
            pending.extend(by_parent.get(row["childRunId"], ()))
    return cancelled


def cancel_task(config_dir, parent_id, task_id):
    with _locked_task(config_dir, parent_id, task_id) as (store, root):
        cancelled = _cancel_tree(store, root, "cancel_task")
        return copy.deepcopy(root), copy.deepcopy(cancelled)


def record_cancel_cleanup(config_dir, parent_id, task_id, *, error=None):
    with _locked_task(config_dir, parent_id, task_id) as (_, row):
        _task_event(row, "cancel_cleanup", "record_cancel_cleanup")
        if not launch_pending(row) and (row.get("cancellationPending") or row.get("error")):
            row.update(cancellationPending=error is not None, error=error, updatedAt=_now())
        return copy.deepcopy(row)


def _alive(pid):
    if type(pid) is not int or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def launch_pending(row):
    launch = row.get('launch') or {}
    return launch.get('state') == 'starting' and _alive(launch.get('pid'))


def has_live_work(row):
    return (row["state"] not in TERMINAL or launch_pending(row) or bool(row.get("cancellationPending"))
            or (row["state"] == "cancelled" and bool(row.get("error"))))


def _by_parent(store):
    by_parent = {}
    for row in store['tasks']:
        by_parent.setdefault(row['parentRunId'], []).append(row)
    return by_parent


def _has_live_descendants(store, parent_id, by_parent=None):
    by_parent = _by_parent(store) if by_parent is None else by_parent
    pending, seen = [parent_id], set()
    while pending:
        parent = pending.pop()
        if parent in seen:
            continue
        seen.add(parent)
        for row in by_parent.get(parent, []):
            if has_live_work(row):
                return True
            if row.get('childRunId'):
                pending.append(row['childRunId'])
    return False


def has_live_descendants(config_dir, parent_id):
    return _has_live_descendants(_shared(config_dir), parent_id)


def pending_count(config_dir, parent_id):
    """Tasks whose notification the parent is still owed: working, or finished
    with the result not yet sent."""
    return sum(1 for row in _shared(config_dir)["tasks"]
               if row.get("parentRunId") == parent_id
               and (has_live_work(row)
                    or (row.get("delivery") or {}).get("state") in ("pending", "sending")))


def answer_result(run_dir):
    fd = os.open(run_dir / "answer.md", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError("answer is not a regular file")
        with os.fdopen(fd, "rb", closefd=False) as handle:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
        return {"path": "answer.md", "sha256": digest}
    finally:
        os.close(fd)


def reconcile(config_dir, runs_dir, valid_question, child_lookup, turn_lookup=None):
    """`turn_lookup(run_dir)` reads a headless child's latest turn: a turn
    that failed, such as on a provider rate limit, can exit 0 and leave the
    child's meta running, so only the turn says the worker stopped."""
    with _locked(config_dir) as store:
        for row in store["tasks"]:
            delivery = row.get("delivery") or {}
            if _delivery_state(row) == "sending" and not _alive(delivery.get("pid")):
                details = {key: value for key, value in delivery.items() if key != "state"}
                details["error"] = "delivery acceptance is unknown after interruption"
                _delivery_event(row, "sender_lost", "reconcile", **details)
                row["updatedAt"] = _now()
            cleanup = row["state"] == "cancelled" and row.get("cancellationPending")
            if launch_pending(row) or (row["state"] in TERMINAL and not cleanup):
                continue
            try:
                child_id = row.get("childRunId")
                if not child_id:
                    child = child_lookup(row["launchToken"])
                    child_id = child.get("childRunId") if isinstance(child, dict) else None
                    if not valid_run_id(child_id):
                        continue
                    _bind_child(row, child_id, "reconcile")
                    row["updatedAt"] = _now()
                if cleanup:
                    continue
                run_dir = Path(runs_dir) / child_id
                if run_dir.is_symlink():
                    continue
                meta = json.loads((run_dir / "meta.json").read_text())
                if not isinstance(meta, dict):
                    continue
                _observe_child(store, row, meta, run_dir, valid_question, turn_lookup)
            except (OSError, ValueError, TypeError):
                continue
        _prune(config_dir, store)
        return copy.deepcopy(store["tasks"])


def _observe_child(store, row, meta, run_dir, valid_question, turn_lookup):
    if meta.get("status") == "cancelled":
        _cancel_tree(store, row, "reconcile")
        return
    result, error, notification = None, None, False
    if valid_question(meta, run_dir=str(run_dir)):
        event, result, notification = "legacy_complete", answer_result(run_dir), True
    elif meta.get("status") in {"failed", "escalated"}:
        event, error = "observe_failure", "child run failed"
    elif (turn_lookup and meta.get("sessionBackend") == "headless"
          and meta.get("status") != "complete"
          and (turn := turn_lookup(str(run_dir)) or {}).get("state") == "idle"
          and turn.get("outcome") == "failed"):
        event, error, notification = "observe_failure", turn.get("error") or "turn failed", True
    elif meta.get("status") == "awaiting-gate" or meta.get("phase") == "ship":
        event = "observe_waiting"
    else:
        event = "observe_running"
    observed = row.copy()
    _settle_observation(store, observed, event, "reconcile")
    if notification:
        _delivery_event(observed, "schedule", "reconcile")
    if observed["state"] in TERMINAL:
        if row.get("result") is not None or row.get("manifest") is not None:
            refuse("task", row["taskId"], "reconcile", row["state"], "replace immutable published result")
        observed.update(result=result, error=error)
    if observed != row:
        row.update(observed, updatedAt=_now())


def _settled(row, store, by_parent):
    """Finished, delivered, and with nothing of its own still working."""
    return (row.get('state') in {'completed', 'failed', 'cancelled'}
            and (row.get('delivery') or {}).get('state') in {'acknowledged', 'cancelled'}
            # The watch tick retries a cancel that is pending or failed.
            and not row.get('cancellationPending')
            and not (row['state'] == 'cancelled' and row.get('error'))
            and not launch_pending(row)
            and not (row.get('childRunId')
                     and _has_live_descendants(store, row['childRunId'], by_parent)))


def _prune(config_dir, store):
    """Move settled tasks and acknowledged send receipts into their parents'
    archives. The archives and then the index are written before anything
    leaves the store, so a failed write leaves a row in both, and the
    store's copy wins."""
    by_parent = _by_parent(store)
    moving = {}
    for row in store['tasks']:
        if _settled(row, store, by_parent):
            moving.setdefault(row['parentRunId'], ([], []))[0].append(row)
    for row in store.get('sendReceipts', []):
        if row.get('state') == 'acknowledged':
            moving.setdefault(row['parentRunId'], ([], []))[1].append(row)
    moved, filed = set(), []
    for parent_id, (tasks, receipts) in moving.items():
        if not valid_run_id(parent_id):
            continue
        path = _archive_path(config_dir, parent_id)
        try:
            # An unreadable archive raises here and is never overwritten.
            archive = _read_archive(path)
            tasks_ids = {row['taskId'] for row in tasks}
            receipt_ids = {row['requestId'] for row in receipts}
            archive['tasks'] = [row for row in archive['tasks']
                                if row.get('taskId') not in tasks_ids] + tasks
            archive['sendReceipts'] = [row for row in archive['sendReceipts']
                                       if row.get('requestId') not in receipt_ids] + receipts
            path.parent.mkdir(mode=0o700, exist_ok=True)
            _replace(path, archive)
            signature = _archive_signature(config_dir, parent_id)
        except (OSError, ValueError):
            continue
        filed.append((parent_id, tasks, receipts, signature))
        moved.update(id(row) for row in tasks + receipts)
    if not moved:
        return
    try:
        index = copy.deepcopy(_indexed(config_dir, True))
        for parent_id, tasks, receipts, signature in filed:
            index['signatures'][parent_id] = signature
            for row in tasks:
                if valid_run_id(row.get('childRunId')):
                    index['children'][row['childRunId']] = parent_id
            for key, rows in (('requests', tasks), ('sends', receipts)):
                held = set(index[key].get(parent_id, ())) | {row['requestId'] for row in rows}
                index[key][parent_id] = sorted(held)
        _replace(_index_path(config_dir), index)
    except (OSError, ValueError):
        return
    store['tasks'] = [row for row in store['tasks'] if id(row) not in moved]
    if 'sendReceipts' in store:
        store['sendReceipts'] = [row for row in store['sendReceipts'] if id(row) not in moved]


def _can_deliver(row):
    return row["state"] == "failed" or (row["state"] in {"completed", "interrupted"} and bool(row.get("result")))


def begin_delivery(config_dir, parent_id, task_id):
    with _locked_task(config_dir, parent_id, task_id) as (_, row):
        if not _can_deliver(row):
            refuse("task delivery", task_id, "begin_delivery", _delivery_state(row),
                   "claim without a terminal result")
        _delivery_event(row, "claim", "begin_delivery", attemptId=secrets.token_hex(12),
                        pid=os.getpid(), startedAt=_now())
        row["updatedAt"] = _now()
        return copy.deepcopy(row)


def finish_delivery(config_dir, parent_id, task_id, attempt_id, error=None):
    with _locked_task(config_dir, parent_id, task_id) as (_, row):
        delivery = row.get("delivery") or {}
        if not attempt_id or delivery.get("attemptId") != attempt_id:
            refuse("task delivery", task_id, "finish_delivery", _delivery_state(row),
                   "finish stale delivery attempt")
        details = {key: value for key, value in delivery.items() if key != "state"}
        details["finishedAt"] = _now()
        if error is not None:
            details["error"] = str(error)
        _delivery_event(row, "uncertain" if error is not None else "accepted",
                        "finish_delivery", **details)
        row["updatedAt"] = _now()
        return copy.deepcopy(row)


def all_tasks(config_dir):
    return copy.deepcopy(_shared(config_dir)['tasks'])


def task_by_child(config_dir, child_id):
    return copy.deepcopy(_child_task(_shared(config_dir)['tasks'], config_dir, child_id, False))


def complete_task(config_dir, parent_id, task_id, child_id, result, manifest, status="completed",
                  *, write_result=None):
    if status not in {'completed', 'failed'}:
        raise ValueError('invalid completion status')
    if not isinstance(result, dict) or result.get('path') != 'task-result.md' \
            or not isinstance(result.get('sha256'), str) or len(result['sha256']) != 64:
        raise ValueError('invalid task result')
    if not isinstance(manifest, dict) or not manifest:
        raise ValueError('missing task completion manifest')
    with _locked_task(config_dir, parent_id, task_id) as (store, row):
        if not valid_run_id(child_id) or row.get("childRunId") != child_id:
            refuse("task", task_id, "complete_task", row["state"], "publish without accepted child")
        if row['state'] in {'completed', 'failed'}:
            if row['state'] == status and row.get('result') == result and row.get('manifest') == manifest:
                return copy.deepcopy(row)
            refuse("task", task_id, "complete_task", row["state"], "replace immutable published result")
        if row['state'] in {'cancelled', 'interrupted'}:
            refuse("task", task_id, "complete_task", row["state"], "publish after task stopped")
        if row.get("result") is not None or row.get("manifest") is not None:
            refuse("task", task_id, "complete_task", row["state"], "replace immutable published result")
        event = "publish_success" if status == "completed" else "publish_failure"
        _settle_observation(store, row, event, "complete_task")
        _delivery_event(row, "schedule", "complete_task")
        if write_result is not None:
            write_result()
        row.update(result=copy.deepcopy(result), manifest=copy.deepcopy(manifest),
                   error=None, updatedAt=_now())
        return copy.deepcopy(row)


def acknowledge_result(config_dir, parent_id, task_id):
    with _locked(config_dir) as store:
        _parent(parent_id)
        row = _find(store["tasks"], parent_id, task_id)
        if row is None:
            # Only a settled task is archived, so it has nothing to acknowledge.
            return get_task(config_dir, parent_id, task_id)
        if row["state"] in TERMINAL and row.get("result") and _delivery_state(row) in {"pending", "unread"}:
            _delivery_event(row, "read", "acknowledge_result", source="task_status", finishedAt=_now())
            row['updatedAt'] = _now()
        return copy.deepcopy(row)


def reserve_send(config_dir, parent_id, request_id, request):
    _parent(parent_id)
    if not isinstance(request_id, str) or not request_id.strip() or len(request_id) > 256:
        raise ValueError('invalid send request id')
    with _locked(config_dir) as store:
        receipts = store.setdefault('sendReceipts', [])
        for row in receipts + _archived_holding(config_dir, 'sendReceipts', parent_id, request_id, True):
            if row['parentRunId'] == parent_id and row['requestId'] == request_id:
                if row['request'] != request:
                    raise ValueError('send request id already has different authority')
                return copy.deepcopy(row), False
        row = {'parentRunId': parent_id, 'requestId': request_id,
               'request': copy.deepcopy(request), 'state': 'sending', 'createdAt': _now()}
        receipts.append(row)
        return copy.deepcopy(row), True


def finish_send(config_dir, parent_id, request_id, error=None):
    with _locked(config_dir) as store:
        row = next((row for row in store.get('sendReceipts', [])
                    if row['parentRunId'] == parent_id and row['requestId'] == request_id), None)
        if row is None or row['state'] != 'sending':
            raise ValueError('send receipt is not current')
        row.update(state='ambiguous' if error else 'acknowledged', error=error, finishedAt=_now())
        return copy.deepcopy(row)


def accepted_result(row, runs_dir):
    result = row.get('result')
    if not isinstance(result, dict) or result.get('path') not in {'answer.md', 'task-result.md'}:
        raise ValueError('task result is unavailable')
    directory = Path(runs_dir) / row['childRunId']
    if directory.is_symlink():
        raise ValueError('task result directory is a symlink')
    filename = result['path']
    fd = os.open(directory / filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError('task result is not a regular file')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            body = stream.read(1024 * 1024 + 1)
        if len(body) > 1024 * 1024 or hashlib.sha256(body).hexdigest() != result['sha256']:
            raise ValueError('task result authority changed')
    finally:
        os.close(fd)
    if filename == 'task-result.md':
        manifest_file = directory / 'task-result.json'
        manifest_bytes = manifest_file.read_bytes()
        if result.get('manifestSha256') and hashlib.sha256(manifest_bytes).hexdigest() != result['manifestSha256']:
            raise ValueError('task completion manifest digest changed')
        if manifest_file.is_symlink() or json.loads(manifest_bytes) != row.get('manifest'):
            raise ValueError('task completion manifest authority changed')
        meta = json.loads((directory / 'meta.json').read_text())
        worker = meta.get('orchestrationWorker') or {}
        if (meta.get('route') != 'orchestration-worker' or worker.get('taskId') != row['taskId']
                or worker.get('parentRunId') != row['parentRunId']):
            raise ValueError('task completion identity changed')
    return body.decode('utf-8')
