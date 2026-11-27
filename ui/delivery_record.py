"""Record a completed delivery under the repository mutation lock."""

import contextlib
import datetime
import fcntl
import hashlib
import json
import os
import time

from run_lifecycle import Snapshot

LOCK_WAIT_SECONDS = 30.0
# cancelled and merged-to-parent are terminal; merging belongs to the merge queue.
REFUSED_STATUSES = {"cancelled", "merged-to-parent", "merging", "merging-to-parent"}
DELIVERABLE_PHASES = {"ship", "done"}


class DeliveryError(Exception):
    pass


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(
        timespec="seconds").replace("+00:00", "Z")


@contextlib.contextmanager
def meta_lock(runs_dir, meta):
    # The flock orc-ui's run_mutation_lock and orc-merge-main take, so this
    # write never races a gate answer or a queued merge on the same repo.
    path = meta.get("mainRepoPath")
    identity = (os.path.realpath(os.path.expanduser(path))
                if isinstance(path, str) and path.strip() else "unknown")
    digest = hashlib.sha256(identity.encode()).hexdigest()[:16]
    lock_path = runs_dir / (".merge-parent-%s.lock" % digest)
    with lock_path.open("a+") as handle:
        deadline = time.monotonic() + LOCK_WAIT_SECONDS
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError as exc:
                if time.monotonic() >= deadline:
                    raise DeliveryError(
                        "another run mutation is holding the lock") from exc
                time.sleep(0.1)
        yield


def read_meta(meta_path):
    try:
        meta = json.loads(meta_path.read_text())
    except (OSError, ValueError) as exc:
        raise DeliveryError("cannot read %s: %s" % (meta_path, exc)) from exc
    if not isinstance(meta, dict):
        raise DeliveryError("%s must contain a JSON object" % meta_path)
    return Snapshot(meta)


def settle(meta, pr_urls, merged):
    if meta.get("outcome") == "question":
        raise DeliveryError("answered question runs have nothing to deliver")
    if meta.get("noDiffCompletion"):
        raise DeliveryError("run completed with --no-diff and has no branch to deliver")
    if meta.get("lifecycleVersion") not in (3, 4):
        raise DeliveryError("retired runs are read-only; start a fresh run")
    status = meta.get("status")
    if status in REFUSED_STATUSES:
        raise DeliveryError("run is %s; delivery cannot be recorded" % status)
    if meta.get("phase") not in DELIVERABLE_PHASES:
        raise DeliveryError(
            "run is at phase=%s; only a run at Ship can be delivered"
            % meta.get("phase"))
    if status == "merged" and not merged:
        raise DeliveryError("run is already merged; pass --merged to update it")

    meta["phase"] = "done"
    if merged:
        meta["status"] = "merged"
        meta.setdefault("mergedAt", now())
    else:
        meta["status"] = "complete"
    if len(pr_urls) == 1:
        meta["prUrl"] = pr_urls[0]
        meta.pop("prUrls", None)
    elif pr_urls:
        meta["prUrls"] = pr_urls
        meta.pop("prUrl", None)
    return meta
