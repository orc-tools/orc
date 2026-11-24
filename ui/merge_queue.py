"""Durable local-main merge protocol shared by the viewer and Git helper.

Mutating operations require the repository lock. The viewer supplies its live
metadata adapter and delivery/session probes; the standalone helper uses files
directly and supplies Git facts. Neither caller orders queue/journal writes or
interprets recovery stamps. Queue schema 1 and existing journals stay readable.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import uuid
from typing import Callable

from project_settings import MERGE_SHIP_ACTIONS, PUSH_SHIP_ACTIONS, SETTLE_SHIP_ACTIONS


def branch_checkout(repo, branch, git):
    result = git(repo, "worktree", "list", "--porcelain", "-z")
    if result.returncode:
        raise ProtocolError("cannot inspect default branch worktrees")
    for record in result.stdout.split("\0\0"):
        fields = dict(field.split(" ", 1) for field in record.split("\0") if " " in field)
        if fields.get("branch") == "refs/heads/" + branch:
            return Path(fields["worktree"]).resolve()
    return None


class ProtocolError(Exception):
    pass


_OPEN_STAGES = {"prepared", "claimed", "resolution-claimed", "git-merged"}
RETRY_SECONDS = 60
# How long a session may hold a resolution it was sent before it must have
# started working on it. Covers the gap between the paste and its turn starting.
RESOLUTION_START_SECONDS = 120


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def repository_path(repository):
    if not isinstance(repository, (str, Path)) or not str(repository).strip():
        raise ProtocolError("run has no repository identity")
    return Path(repository).expanduser().resolve()


def repository_identity(repository):
    path = str(repository_path(repository))
    home = str(Path.home().resolve())
    if path == home or path.startswith(home + os.sep):
        return "~" + path[len(home):]
    if os.path.exists(path):
        return path
    return re.sub(r"^/(?:Users|home)/[^/]+(?=/|$)", "~",
                  os.path.normpath(os.path.expanduser(str(repository))))


def queue_path(runs, repository):
    digest = hashlib.sha256(str(repository_path(repository)).encode()).hexdigest()[:16]
    return Path(runs) / (".merge-queue-%s.json" % digest)


def lock_path(runs, repository=None):
    valid = isinstance(repository, (str, Path)) and str(repository).strip()
    identity = str(repository_path(repository)) if valid else "unknown"
    digest = hashlib.sha256(identity.encode()).hexdigest()[:16]
    return Path(runs) / (".merge-parent-%s.lock" % digest)


def read_json(path):
    try:
        value = json.loads(Path(path).read_text())
    except (OSError, ValueError) as exc:
        raise ProtocolError("could not read %s: %s" % (path, exc)) from exc
    if not isinstance(value, dict):
        raise ProtocolError("%s must contain a JSON object" % path)
    return value


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".%s." % path.name, suffix=".tmp",
                                     dir=path.parent)
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


@dataclass(frozen=True)
class Consent:
    push: bool = False
    close: bool = False
    action: str = "merge"

    @property
    def settle(self):
        """Yeet it: settle the run once its push lands."""
        return self.action in SETTLE_SHIP_ACTIONS

    @classmethod
    def from_record(cls, record):
        for field in ("pushAfterMerge", "closePaneAfterMerge"):
            if field in record and not isinstance(record[field], bool):
                raise ProtocolError("merge queue delivery consent is invalid")
        action = record.get("shipAction")
        if action is not None and action not in MERGE_SHIP_ACTIONS:
            raise ProtocolError("merge queue delivery consent has an invalid action")
        push = (action in PUSH_SHIP_ACTIONS if action is not None
                else record.get("pushAfterMerge") is True)
        if action is not None and "pushAfterMerge" in record \
                and record["pushAfterMerge"] is not push:
            raise ProtocolError("merge queue delivery consent conflicts with its action")
        close = record.get("closePaneAfterMerge") is True
        if close and not push:
            raise ProtocolError("closing the panel requires merge-and-push consent")
        return cls(push, close, action or ("merge-and-push" if push else "merge"))

    @classmethod
    def from_request(cls, payload, project_action=None):
        if "shipAction" in payload and payload["shipAction"] is None:
            raise ProtocolError("invalid merge delivery action; refresh and try again")
        if (payload.get("shipAction") is None
                and payload.get("action") == "enqueue-merge"
                and "pushAfterMerge" not in payload
                and project_action in PUSH_SHIP_ACTIONS):
            raise ProtocolError("merge delivery consent is missing; refresh and confirm the Ship action again")
        try:
            return cls.from_record(payload)
        except ProtocolError as exc:
            raise ProtocolError(str(exc) + "; refresh and try again") from exc

    @classmethod
    def for_enqueue(cls, push=False, close=False, action=None):
        # Preserve the trusted enqueue adapter's historical boolean defaults.
        # Untrusted HTTP requests and durable records use strict parsing above.
        return cls.from_record({"shipAction": action, "pushAfterMerge": push is True,
                                "closePaneAfterMerge": push is True and close is True})

    def record(self):
        return {"shipAction": self.action, "pushAfterMerge": self.push,
                "closePaneAfterMerge": self.close}


@dataclass(frozen=True)
class Dispatch:
    state: str
    token: str | None = None
    first_attempt: bool = True


@dataclass(frozen=True)
class DispatchChecks:
    """Live observations. Durable policy and observation order belong here."""
    local_host: str
    final_phase: Callable[[str], bool]
    checkout_wait: Callable[[dict], str | None]
    source_head: Callable[[dict], str | None]
    binding_error: Callable[[str, dict, str | None], str | None]
    blocker: Callable[[str], object]
    session_working: Callable[[str, dict], bool]


def entry_for(data, run_id):
    for index, entry in enumerate(data["entries"]):
        if entry["runId"] == run_id:
            return index, entry
    return None, None


def _set_error(entry, detail):
    entry["dispatchError"] = detail
    entry["dispatchErrorAt"] = now()


def _clear_error(entry):
    entry.pop("dispatchError", None)
    entry.pop("dispatchErrorAt", None)


def _release(entry):
    entry["claimToken"] = None
    entry["claimedAt"] = None
    entry["recoveryDispatchedAt"] = None


def _claim(entry):
    entry["claimToken"] = uuid.uuid4().hex[:24]
    entry["claimedAt"] = now()
    entry["recoveryDispatchedAt"] = None


def _older_than(stamp, seconds):
    """True once a recorded stamp is that old. Unreadable or future stamps count."""
    if not isinstance(stamp, str):
        return True
    try:
        when = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return True
    if when.tzinfo is None:
        return True
    age = (datetime.now(timezone.utc) - when).total_seconds()
    return age >= seconds or age < 0


def _error_expired(entry):
    return _older_than(entry.get("dispatchErrorAt"), RETRY_SECONDS)


def _main_conflict(meta):
    return (isinstance(meta.get("mergeConflict"), dict)
            and meta["mergeConflict"].get("target") == "main")


def conflict_resolution_pending(meta):
    return (meta.get("status") == "escalated" and _main_conflict(meta)
            and meta["mergeConflict"].get("resolutionPending") is True)


def entry_stalled(entry, meta):
    if entry.get("claimToken") or entry.get("checkoutWait"):
        return False
    if entry.get("dispatchError") and not _error_expired(entry):
        return True
    return meta.get("status") == "escalated" and _main_conflict(meta)


class MergeQueue:
    def __init__(self, runs, repository, *, read_run=None, write_run=None):
        self.runs = Path(runs)
        self.repository = repository_path(repository)
        self.identity = repository_identity(repository)
        self.path = queue_path(runs, repository)
        self.read_run = read_run or self._read_run
        self._write_run_adapter = write_run

    def _read_run(self, run_id):
        try:
            return read_json(self.runs / run_id / "meta.json")
        except ProtocolError:
            return {}

    def _write_run(self, run_id, meta):
        if self._write_run_adapter is not None:
            if not self._write_run_adapter(run_id, meta):
                raise ProtocolError("could not save run status")
        else:
            write_json(self.runs / run_id / "meta.json", meta)

    def read(self):
        if not self.path.exists():
            return {"schemaVersion": 1, "repo": self.identity,
                    "nextSequence": 1, "entries": []}
        try:
            data = read_json(self.path)
        except ProtocolError as exc:
            raise ProtocolError("merge queue is malformed") from exc
        return self._validate(data)

    def _validate(self, data):
        entries = data.get("entries")
        if (data.get("schemaVersion") != 1
                or not isinstance(data.get("repo"), str)
                or repository_identity(data["repo"]) != self.identity
                or not isinstance(data.get("nextSequence"), int)
                or data["nextSequence"] < 1 or not isinstance(entries, list)):
            raise ProtocolError("merge queue is malformed")
        seen, sequence = set(), 0
        for entry in entries:
            if (not isinstance(entry, dict)
                    or not isinstance(entry.get("runId"), str)
                    or not isinstance(entry.get("branch"), str) or not entry["branch"]
                    or not isinstance(entry.get("head"), str)
                    or not re.fullmatch(r"[0-9a-fA-F]{40,64}", entry["head"])
                    or not isinstance(entry.get("sequence"), int)
                    or entry["sequence"] <= sequence or entry["runId"] in seen):
                raise ProtocolError("merge queue entries are malformed")
            for field in ("receiptDigest", "authorityDigest"):
                if entry.get(field) is not None and (
                        not isinstance(entry[field], str)
                        or not re.fullmatch(r"[0-9a-f]{64}", entry[field])):
                    raise ProtocolError("merge queue is malformed")
            for field in ("claimToken", "claimedAt", "recoveryDispatchedAt",
                          "dispatchErrorAt", "checkoutWait"):
                if entry.get(field) is not None and not isinstance(entry[field], str):
                    raise ProtocolError("merge queue is malformed")
            # Validate the same frozen consent before either process mutates.
            Consent.from_record(entry)
            seen.add(entry["runId"])
            sequence = entry["sequence"]
        if data["nextSequence"] <= sequence:
            raise ProtocolError("merge queue is malformed")
        return data

    def _save(self, data):
        self._validate(data)
        try:
            write_json(self.path, data)
        except OSError as exc:
            raise ProtocolError("could not save merge queue") from exc

    def consent(self, run_id):
        _, entry = entry_for(self.read(), run_id)
        return Consent.from_record(entry or {})

    def enqueue(self, run_id, branch, head, consent, *, receipt=None, authority=None):
        consent = Consent.from_record(consent.record())
        if not isinstance(branch, str) or not branch.strip():
            raise ProtocolError("run has no branch")
        data = self.read()
        if entry_for(data, run_id)[1] is not None:
            raise ProtocolError("run is already queued")
        data["entries"].append({
            "runId": run_id, "branch": branch.strip(), "head": head,
            "receiptDigest": receipt, "authorityDigest": authority,
            "sequence": data["nextSequence"], "enqueuedAt": now(),
            "claimToken": None, "claimedAt": None, "recoveryDispatchedAt": None,
            **consent.record(),
        })
        data["nextSequence"] += 1
        self._save(data)
        return data

    def remove(self, run_id):
        data = self.read()
        index, entry = entry_for(data, run_id)
        if entry is None:
            raise ProtocolError("run is not queued")
        if entry.get("claimToken") or self.read_run(run_id).get("status") == "merging":
            raise ProtocolError("merge has already started")
        del data["entries"][index]
        self._save(data)

    def stalled(self, entry):
        # A claim or a busy checkout always holds FIFO. Only an unclaimed
        # error in cooldown or an escalated main conflict can be passed.
        return entry_stalled(entry, self.read_run(entry["runId"]) or {})

    def _require_free_slot(self, data, run_id):
        # Only one entry may hold a claim. A later entry dispatched past a
        # stalled one keeps its claim until it finishes; a new claim waits for
        # it. A merged entry's claim is spent even before dispatch releases it.
        for entry in data["entries"]:
            if (entry["runId"] != run_id and entry.get("claimToken")
                    and self.read_run(entry["runId"]).get("status") != "merged"):
                raise ProtocolError("merge blocked by %s" % entry["runId"])

    def _dispatchable(self, data, index):
        return index is not None and all(self.stalled(e) for e in data["entries"][:index])

    def _journal(self, run_id):
        path = self.runs / run_id / "merge-main-transaction.json"
        return read_json(path) if path.exists() else None

    def has_unfinished_transaction(self, run_id):
        """Call under the repository lock before replacing run ownership.

        A direct helper has no queue entry. Its journal still owns recovery,
        including the windows before metadata is claimed or after Git applies.
        Unreadable or mismatched journals raise so callers cannot discard them.
        """
        tx = self._journal(run_id)
        if tx is None:
            return False
        meta = self.read_run(run_id)
        if (not tx.get("id") or tx.get("runId") != run_id
                or tx.get("targetPath") != str(self.repository)
                or tx.get("sourceBranch") != meta.get("branch")):
            raise ProtocolError("merge journal no longer matches run metadata")
        stage = tx.get("stage")
        if stage == "complete":
            return False
        if stage in _OPEN_STAGES:
            return True
        if stage == "conflicted":
            return not (meta.get("status") == "escalated" and _main_conflict(meta)
                        and not meta.get("mergeMainTransaction"))
        raise ProtocolError("merge journal has an unknown stage")

    def retry(self, run_id):
        data = self.read()
        index, entry = entry_for(data, run_id)
        if not self._dispatchable(data, index) or not entry.get("dispatchError"):
            raise ProtocolError("merge recovery is not retryable")
        if entry.get("claimToken"):
            if self.read_run(run_id).get("status") != "merging":
                raise ProtocolError("merge recovery is not retryable")
            try:
                tx = self._journal(run_id)
            except ProtocolError as exc:
                raise ProtocolError("merge journal is unavailable") from exc
            if tx is None:
                raise ProtocolError("merge journal is unavailable")
            if not self._owns_journal(entry, tx) or tx.get("stage") not in _OPEN_STAGES:
                raise ProtocolError("merge journal is not retryable")
            entry["recoveryDispatchedAt"] = None
            if tx["stage"] == "resolution-claimed":
                entry["resolutionRetryApprovedAt"] = now()
        _clear_error(entry)
        self._save(data)
        return data

    @staticmethod
    def _owns_journal(entry, tx):
        return (isinstance(tx, dict) and tx.get("runId") == entry["runId"]
                and tx.get("claimToken") == entry.get("claimToken"))

    def claim_for_merge(self, run_id, branch, head, token=None, *, reclaim=False):
        data = self.read()
        if not data["entries"]:
            if token is not None:
                raise ProtocolError("claim token supplied for an empty or missing merge queue")
            return None
        index, entry = entry_for(data, run_id)
        if entry is None:
            raise ProtocolError("run is not current merge queue head")
        # The server may have dispatched past stalled entries. Its issued claim
        # remains valid after their cooldown expires; any earlier live claim
        # still prevents a second merge.
        if any(e.get("claimToken") for e in data["entries"][:index]):
            raise ProtocolError("an earlier queued run is already merging")
        if entry["branch"] != branch:
            raise ProtocolError("merge queue branch does not match run metadata")
        if entry["head"] != head:
            raise ProtocolError("merge queue HEAD does not match run checkout")
        if not entry.get("claimToken") and reclaim and token is None:
            self._require_free_slot(data, run_id)
            _claim(entry)
            self._save(data)
        recorded = entry.get("claimToken")
        if not recorded:
            raise ProtocolError("merge queue head has no active claim token")
        if token is not None and token != recorded:
            raise ProtocolError("merge queue claim token does not match")
        return recorded

    def repin_head(self, run_id, old_head, new_head):
        data = self.read()
        _, entry = entry_for(data, run_id)
        if entry is None or entry["head"] == new_head:
            return
        if entry["head"] != old_head:
            raise ProtocolError("merge queue HEAD does not match run checkout")
        entry["head"] = new_head
        self._save(data)

    def _release_owned(self, run_id, token):
        if token is None or not self.path.exists():
            return
        data = self.read()
        _, entry = entry_for(data, run_id)
        if entry is None or entry.get("claimToken") != token:
            raise ProtocolError("merge queue claim changed during conflict release")
        _release(entry)
        self._save(data)

    def request_resolution(self, run_id):
        """Claim the session's resolution turn, before its Git helper runs."""
        meta = self.read_run(run_id)
        if meta.get("status") != "escalated" or not _main_conflict(meta):
            raise ProtocolError("run has no escalated main conflict to resolve")
        data = self.read()
        index, entry = entry_for(data, run_id)
        if data["entries"] and (entry is None or not self._dispatchable(data, index)):
            raise ProtocolError("run is no longer merge queue head")
        claimed = entry is not None and not entry.get("claimToken")
        if claimed:
            self._require_free_slot(data, run_id)
            _claim(entry)
            _clear_error(entry)
            self._save(data)
        meta["mergeConflict"].pop("resolutionPending", None)
        meta["mergeConflict"].pop("resolutionRetryAt", None)
        meta["status"] = "merging"
        try:
            self._write_run(run_id, meta)
        except (OSError, ProtocolError):
            if claimed:
                _release(entry)
                self._save(data)
            raise
        return "merging"

    def restore_resolution(self, run_id):
        tx = self._journal(run_id)
        if tx is not None and tx.get("stage") != "conflicted":
            return False
        data = self.read()
        _, entry = entry_for(data, run_id)
        if entry and entry.get("claimToken"):
            _release(entry)
            self._save(data)
        return True

    def failed(self, run_id, token, detail):
        data = self.read()
        _, entry = entry_for(data, run_id)
        if entry is None or entry.get("claimToken") != token:
            return
        meta = self.read_run(run_id)
        try:
            tx = self._journal(run_id)
        except ProtocolError:
            tx = {}  # unreadable journal cannot prove that no merge started
        unfinished = (tx is not None and (
            not tx or tx.get("stage") in _OPEN_STAGES
            or (tx.get("stage") == "conflicted" and self._owns_journal(entry, tx))))
        if unfinished:
            # Keep ownership of an interrupted merge. A closed journal from an
            # older claim does not establish that this helper started a merge.
            _set_error(entry, detail)
            self._save(data)
            return
        _release(entry)
        _set_error(entry, detail)
        self._save(data)
        if meta.get("status") == "merging":
            meta["status"] = "awaiting-gate"
            self._write_run(run_id, meta)

    def dispatch(self, run_id, checks, *, inflight=False):
        data = self.read()
        index, entry = entry_for(data, run_id)
        if not self._dispatchable(data, index):
            return Dispatch("not-head")
        if inflight:
            return Dispatch("dispatched")
        meta = self.read_run(run_id)
        if meta.get("status") == "merged":
            # The selected entry may follow a stalled predecessor.
            del data["entries"][index]
            self._save(data)
            return Dispatch("released")
        try:
            tx = self._journal(run_id)
        except ProtocolError:
            tx = {}  # present but unreadable, never the pre-journal crash window
        if entry.get("claimToken") and self._owns_journal(entry, tx) \
                and tx.get("stage") == "conflicted":
            self._settle_conflict(run_id, meta, tx)
            return Dispatch("pinned")
        if self._resolution_never_started(entry, tx, meta) \
                and not checks.session_working(run_id, meta):
            # Escalation first, then release, like _settle_conflict: a crash
            # between them lands here again on the next tick. The marker is
            # rebuilt from the journal because a session that reopened its
            # gate instead of resolving has usually deleted it.
            if meta.get("status") != "escalated" or not _main_conflict(meta):
                meta["status"] = "escalated"
                if not _main_conflict(meta):
                    meta["mergeConflict"] = {
                        "target": "main",
                        "detail": tx.get("failure") or "merge conflicted"}
                meta.pop("mergeMainTransaction", None)
                self._write_run(run_id, meta)
            _release(entry)
            self._save(data)
            return Dispatch("resolution-abandoned")
        if meta.get("status") == "escalated" and isinstance(meta.get("mergeConflict"), dict):
            return Dispatch("pinned")
        ready = (meta.get("host") == checks.local_host
                 and meta.get("status") == "awaiting-gate"
                 and checks.final_phase(meta.get("phase")))
        if not entry.get("claimToken") and ready:
            wait = checks.checkout_wait(meta)
            if wait:
                if entry.get("checkoutWait") != wait:
                    entry["checkoutWait"] = wait
                    self._save(data)
                return Dispatch("pinned")
            if entry.pop("checkoutWait", None):
                if "default checkout is dirty:" in entry.get("dispatchError", ""):
                    _clear_error(entry)
                self._save(data)
        if entry.get("dispatchError") and (entry.get("claimToken") or not _error_expired(entry)):
            return Dispatch("pinned")
        token = entry.get("claimToken")
        resolution = False
        if not token:
            if tx is not None and (not tx or tx.get("stage") in _OPEN_STAGES):
                return Dispatch("pinned")
        else:
            if tx is None:
                # The viewer claimed the queue but died before the helper wrote.
                tx = {"stage": "prepared", "runId": run_id, "claimToken": token}
            if (not self._owns_journal(entry, tx) or tx.get("stage") not in _OPEN_STAGES
                    or meta.get("host") != checks.local_host):
                return Dispatch("pinned")
            resolution = tx["stage"] == "resolution-claimed"
            if (resolution and not entry.get("resolutionRetryApprovedAt")
                    and checks.session_working(run_id, meta)):
                return Dispatch("pinned")
            # Its session stopped mid-resolution. Nobody else will finish or
            # clear it, so recovery runs without waiting for a person: the
            # helper finishes a committed resolution or clears a partial one.
            entry.pop("resolutionRetryApprovedAt", None)
            if entry.get("recoveryDispatchedAt"):
                _set_error(entry, "Merge recovery paused after one retry; retry explicitly")
                self._save(data)
                return Dispatch("pinned")
            _clear_error(entry)
            entry["recoveryDispatchedAt"] = now()
            self._save(data)
        if checks.blocker(run_id):
            return Dispatch("pinned")
        digest = entry.get("authorityDigest" if meta.get("lifecycleVersion") == 4
                           else "receiptDigest")
        error = checks.binding_error(run_id, meta, digest)
        if error:
            _set_error(entry, error)
            self._save(data)
            return Dispatch("pinned")
        if not token:
            if not ready:
                return Dispatch("pinned")
            head = checks.source_head(meta)
            if meta.get("branch") != entry["branch"] or head is None or head != entry["head"]:
                _set_error(entry, "Queued branch or HEAD changed; remove and add again")
                self._save(data)
                return Dispatch("pinned")
            try:
                self._require_free_slot(data, run_id)
            except ProtocolError:
                return Dispatch("pinned")
            _claim(entry)
            token = entry["claimToken"]
            _clear_error(entry)
            self._save(data)
            meta["status"] = "merging"
            try:
                self._write_run(run_id, meta)
            except (OSError, ProtocolError):
                _release(entry)
                _set_error(entry, "Could not claim run metadata")
                self._save(data)
                return Dispatch("pinned")
        return Dispatch("dispatched", token, not resolution)

    @staticmethod
    def _resolution_never_started(entry, tx, meta):
        """A session was sent the resolution and holds the merge slot for it,
        but never ran `--claim-resolution`: the journal still shows the
        conflict under the claim that found it.

        The run's own status does not decide this. A session that resolved the
        conflict in its run branch and reopened its gate leaves the run at
        `awaiting-gate` with no conflict marker, and the slot stays claimed.
        Only `merging` without a marker is left alone: that is a fresh merge
        whose helper has not written its journal yet."""
        status = meta.get("status")
        abandoned = (status in ("escalated", "awaiting-gate", "running")
                     or status == "merging" and _main_conflict(meta))
        return (bool(entry.get("claimToken")) and abandoned
                and isinstance(tx, dict) and tx.get("stage") == "conflicted"
                and tx.get("claimToken") != entry.get("claimToken")
                and _older_than(entry.get("claimedAt"), RESOLUTION_START_SECONDS))

    def _settle_conflict(self, run_id, meta, tx):
        """Journal first, then escalation, then release. Safe after every write."""
        attempt = MergeTransaction(self, run_id)
        attempt._require_phase(meta)
        if meta.get("status") == "merging":
            attempt._require_claim(meta)
            meta["status"] = "escalated"
            if not _main_conflict(meta):
                meta["mergeConflict"] = {
                    "target": "main", "detail": tx.get("failure") or "merge conflicted"}
            meta.pop("mergeMainTransaction", None)
            self._write_run(run_id, meta)
        if (meta.get("status") != "escalated" or not _main_conflict(meta)
                or meta.get("mergeMainTransaction")):
            raise ProtocolError("conflict journal does not match run metadata")
        self._release_owned(run_id, tx.get("claimToken"))


def _checkpoint(name):
    # Real-process fault injection used by the existing merge-helper tests.
    if os.environ.get("ORC_TEST_MERGE_MAIN_CRASH_AFTER_" + name) == "true":
        raise ProtocolError("injected crash after " + name.lower().replace("_", " "))


class MergeTransaction:
    """The helper's durable attempt. Git facts enter; transitions stay inside."""
    def __init__(self, queue, run_id):
        self.queue = queue
        self.run_id = run_id
        self.path = queue.runs / run_id / "merge-main-transaction.json"
        self._record = queue._journal(run_id)

    @property
    def source_head(self):
        return self._record["sourceHead"]

    @property
    def target_head(self):
        return self._record["targetHead"]

    @property
    def open(self):
        return self._record is not None and self._record.get("stage") in _OPEN_STAGES

    @property
    def resolving(self):
        return self._record is not None and self._record.get("stage") == "resolution-claimed"

    def terminal(self, meta):
        return (meta.get("phase") == "done" and meta.get("status") == "merged"
                and (self._record is None or self._record.get("stage") == "complete"))

    def _save(self, stage):
        self._record["stage"] = stage
        write_json(self.path, self._record)

    def _marker(self, stage):
        tx = self._record
        return {key: tx.get(key) for key in (
            "id", "runId", "sourceBranch", "sourceHead", "targetBranch", "targetHead",
            "targetPath", "claimToken", "startedAt")} | {"stage": stage}

    def _marker_matches(self, meta, stage):
        marker = meta.get("mergeMainTransaction")
        return (isinstance(marker, dict) and bool(self._record.get("id"))
                and marker.get("id") == self._record.get("id")
                and marker.get("stage") == stage)

    def _completed_metadata(self, meta):
        return (self._record.get("stage") == "git-merged"
                and meta.get("phase") == "done" and meta.get("status") == "merged"
                and self._marker_matches(meta, "complete"))

    def _require_phase(self, meta):
        tx = self._record
        if (tx.get("runId") != self.run_id or meta.get("runId") not in (None, self.run_id)
                or tx.get("sourceBranch") != meta.get("branch")
                or tx.get("targetPath") != str(self.queue.repository)
                or repository_path(meta.get("mainRepoPath")) != self.queue.repository):
            raise ProtocolError("unfinished merge transaction no longer matches run metadata")
        phase = self._record.get("originalMeta", {}).get("phase")
        if (phase not in ("present", "recap", "ship") or meta.get("phase") != phase) \
                and not self._completed_metadata(meta):
            raise ProtocolError("run phase does not match unfinished merge transaction")

    def _require_claim(self, meta):
        self._require_phase(meta)
        if not (meta.get("status") == "merging" and (
                self._marker_matches(meta, "claimed")
                or self._marker_matches(meta, "resolution-claimed"))) \
                and not self._completed_metadata(meta):
            raise ProtocolError("run metadata does not match active merge transaction")

    def _validate_identity(self, source_branch, source_head, target_branch, *, conflict=False):
        tx = self._record
        label = "conflicted merge journal" if conflict else "unfinished merge transaction"
        if (tx.get("runId") != self.run_id or tx.get("sourceBranch") != source_branch
                or tx.get("targetBranch") != target_branch
                or tx.get("targetPath") != str(self.queue.repository)):
            raise ProtocolError(label + " no longer matches run metadata")
        if tx.get("sourceHead") != source_head:
            raise ProtocolError("source HEAD changed " + (
                "since merge conflict" if conflict else "during unfinished transaction"))

    def begin(self, meta, source_branch, source_head, target_branch, target_head,
              contained, token=None):
        if self.open:
            self._require_phase(meta)
        elif self._record is not None and self._record.get("stage") == "conflicted":
            self._require_claim(meta)
        direct_resolution = self.resolving and self._record.get("claimToken") is None
        recorded = None if direct_resolution else self.queue.claim_for_merge(
            self.run_id, source_branch, source_head, token,
            reclaim=meta.get("status") == "merging" and _main_conflict(meta))
        if self.open:
            self._validate_identity(source_branch, source_head, target_branch)
            tx = self._record
            if tx.get("claimToken") != recorded:
                raise ProtocolError("unfinished transaction claim token no longer matches queue")
            stage = tx["stage"]
            if stage == "prepared":
                original = tx.get("originalMeta", {})
                original_matches = (meta.get("status") == original.get("status")
                                    and meta.get("phase") == original.get("phase")
                                    and not meta.get("mergeMainTransaction"))
                # A crash can follow the metadata claim but precede its journal
                # stamp, including direct merges whose original status was idle.
                already_claimed = (meta.get("status") == "merging"
                                   and self._marker_matches(meta, "claimed"))
                if not (original_matches or already_claimed):
                    raise ProtocolError("run metadata does not match prepared transaction")
                self._claim_metadata(meta)
            elif stage == "claimed" and (
                    meta.get("status") != "merging" or not self._marker_matches(meta, "claimed")):
                raise ProtocolError("run metadata does not match claimed transaction")
            elif stage == "resolution-claimed" and (
                    meta.get("status") != "merging" or not self._marker_matches(meta, stage)):
                raise ProtocolError("run metadata does not match resolution claim")
            elif stage == "git-merged":
                claimed = (meta.get("status") == "merging" and (
                    self._marker_matches(meta, "claimed")
                    or self._marker_matches(meta, "resolution-claimed")))
                complete = (meta.get("status") == "merged" and meta.get("phase") == "done"
                            and self._marker_matches(meta, "complete"))
                if not (claimed or complete):
                    raise ProtocolError("run metadata does not match git-merged transaction")
            if not contained and target_head != tx.get("targetHead"):
                raise ProtocolError("default HEAD changed during unfinished transaction")
        else:
            if (meta.get("phase") not in ("present", "recap", "ship")
                    or meta.get("status") not in ("awaiting-gate", "merging")):
                raise ProtocolError("run must be idle at its final gate or claimed for merging")
            self._record = {
                "id": str(uuid.uuid4()), "runId": self.run_id,
                "sourceBranch": source_branch, "sourceHead": source_head,
                "targetBranch": target_branch, "targetHead": target_head,
                "targetPath": str(self.queue.repository), "claimToken": recorded,
                "startedAt": now(),
                "originalMeta": {"status": meta.get("status"), "phase": meta.get("phase")},
            }
            self._save("prepared")
            _checkpoint("PREPARE")
            self._claim_metadata(meta)
        _checkpoint("CLAIM")

    def _claim_metadata(self, meta):
        meta["status"] = "merging"
        meta["mergeMainTransaction"] = self._marker("claimed")
        self.queue._write_run(self.run_id, meta)
        _checkpoint("METADATA_CLAIM")
        self._save("claimed")

    def conflicted(self, detail):
        self._require_claim(self.queue.read_run(self.run_id))
        self._record.update(failure=detail, finishedAt=now())
        self._save("conflicted")
        _checkpoint("CONFLICT_JOURNAL")
        self.queue._settle_conflict(self.run_id, self.queue.read_run(self.run_id), self._record)

    def git_merged(self, warning=None):
        if warning:
            self._record["gitHookStderr"] = warning[-8192:]
        self._save("git-merged")
        _checkpoint("GIT")

    def finish(self, merge_head, *, post_merge=False, desktop_update=None):
        meta = self.queue.read_run(self.run_id)
        self._require_claim(meta)
        merged_at = (self._record.get("mergedAt")
                     or (meta.get("mergedAt") if self._completed_metadata(meta) else None)
                     or now())
        self._record["mergedAt"] = merged_at
        meta.update(phase="done", status="merged", mergeCommit=merge_head,
                    mergedAt=merged_at, mergeMainTransaction=self._marker("complete"))
        meta.pop("mergeConflict", None)
        if post_merge:
            meta["postMergePending"] = True
        if desktop_update is not None:
            meta["desktopUpdate"] = desktop_update
        if self._record.get("gitHookStderr"):
            meta["mergeHookWarning"] = self._record["gitHookStderr"]
        self.queue._write_run(self.run_id, meta)
        _checkpoint("COMPLETE_METADATA")
        self._save("complete")

    def require_resolution(self, meta):
        if not _main_conflict(meta):
            raise ProtocolError("run has no escalated main conflict to resolve")
        if self._record is None or self._record.get("stage") not in ("conflicted", "resolution-claimed"):
            raise ProtocolError("run has no conflicted merge journal to resolve")
        self._require_phase(meta)
        if meta.get("status") not in ("escalated", "merging"):
            raise ProtocolError("run must hold an escalated main conflict to resolve")
        if self.resolving and meta.get("status") == "merging" \
                and not self._marker_matches(meta, "resolution-claimed"):
            raise ProtocolError("resolution claim does not match run metadata")
        if meta.get("status") == "escalated" and meta.get("mergeMainTransaction"):
            raise ProtocolError("conflict journal does not match run metadata")
        if (not self.resolving and meta.get("mergeMainTransaction")
                and not (self._marker_matches(meta, "claimed")
                         or self._marker_matches(meta, "resolution-claimed"))):
            raise ProtocolError("conflict journal does not match run metadata")

    def adopt_source(self, meta, source_head):
        """Follow a branch that only merged the default branch in to resolve.

        The caller proves that from Git. Queue first, journal second: a crash
        between them leaves a queue entry this method accepts on the rerun."""
        self.require_resolution(meta)
        tx = self._record
        old = tx["sourceHead"]
        if old == source_head:
            return
        self.queue.repin_head(self.run_id, old, source_head)
        tx.setdefault("adoptedSourceHeads", []).append(old)
        tx["sourceHead"] = source_head
        self._save(tx["stage"])

    def resolution(self, meta, source_branch, source_head, target_branch, target_head,
                   *, release=False, target_advanced=False):
        self.require_resolution(meta)
        tx = self._record
        self._validate_identity(source_branch, source_head, target_branch, conflict=True)
        if release:
            if (not self.resolving or meta.get("status") != "merging"
                    or not self._marker_matches(meta, "resolution-claimed")):
                raise ProtocolError("run has no active conflict-resolution claim")
        elif meta.get("status") not in ("escalated", "merging"):
            raise ProtocolError("run must hold an escalated main conflict to resolve")
        elif (self.resolving and meta.get("status") == "merging"
              and not self._marker_matches(meta, "resolution-claimed")):
            raise ProtocolError("resolution claim does not match run metadata")
        repinned_from = None
        if target_head != tx.get("targetHead"):
            # Later queued runs merge while a conflict waits for its session.
            # The resolution redoes the merge on today's default branch, so a
            # claim follows it forward; a release must restore it exactly.
            if release or not target_advanced:
                raise ProtocolError("default HEAD changed " + (
                    "during conflict resolution" if release else "since merge conflict"))
            repinned_from = tx.get("targetHead")
        recorded = None
        if tx.get("claimToken") is not None:
            recorded = self.queue.claim_for_merge(
                self.run_id, source_branch, source_head,
                tx["claimToken"] if release else None, reclaim=not release)
            if recorded is None:
                raise ProtocolError("queued merge conflict is no longer current queue head")
        if self.resolving and tx.get("claimToken") != recorded:
            raise ProtocolError("resolution claim token no longer matches queue")
        if release:
            tx["resolutionReleasedAt"] = now()
            self._save("conflicted")
            self.queue._settle_conflict(self.run_id, meta, tx)
        else:
            if repinned_from is not None:
                tx.setdefault("repinnedTargetHeads", []).append(repinned_from)
                tx["targetHead"] = target_head
            tx["claimToken"] = recorded
            tx["resolutionClaimedAt"] = tx.get("resolutionClaimedAt") or now()
            self._save("resolution-claimed")
            meta["status"] = "merging"
            meta["mergeMainTransaction"] = self._marker("resolution-claimed")
            self.queue._write_run(self.run_id, meta)
        return self
