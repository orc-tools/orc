"""Resolve now: a conflict fix prepared while a run waits in the merge queue.

A queued run that will conflict with the default branch is resolved when it
reaches the front, inside the merge slot. Resolve now lets the run's session
prepare that fix sooner, without touching anything Ship approved: the run
branch, the queue entry's HEAD and delivery-authority.json all stay as they
are. The fix is a merge commit whose first parent is the queued HEAD and whose
other parent is a default-branch commit. It lives under a private ref so Git
keeps it, and orc-merge-main lands it instead of the bare branch when it still
applies. When the default branch has moved past it in a way it cannot follow,
the merge falls back to today's path and Orc resolves again at the front.

The state file is the record the queue dialog reads:

    {"state": "preparing" | "ready" | "failed", "sourceHead": <queued HEAD>,
     "commit": <prepared merge>, "targetHead": <default-branch parent>,
     "requestedAt": ..., "updatedAt": ..., "detail": <why it stopped>}

It is keyed to the queued HEAD: a record for any other HEAD is ignored.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import re
import subprocess

from merge_queue import ProtocolError, now, read_json, write_json

STATE_FILE = "merge-early-resolution.json"
STATES = ("preparing", "ready", "failed")
# A session that has not saved or released its fix by then has stopped; the
# row offers Resolve now again rather than claiming a fix is still coming.
PREPARING_STALE_SECONDS = 45 * 60
_SHA = re.compile(r"[0-9a-f]{40,64}")


def ref_name(run_id):
    return "refs/orc/early-resolution/%s" % run_id


def state_path(run_dir):
    return Path(run_dir) / STATE_FILE


def read_state(run_dir):
    path = state_path(run_dir)
    if not path.is_file():
        return None
    try:
        state = read_json(path)
    except ProtocolError:
        return None
    if state.get("state") not in STATES or not _SHA.fullmatch(str(state.get("sourceHead") or "")):
        return None
    return state


def write_state(run_dir, state, source_head, **fields):
    if state not in STATES:
        raise ProtocolError("unknown early resolution state")
    previous = read_state(run_dir) or {}
    record = {"state": state, "sourceHead": source_head,
              "requestedAt": (previous.get("requestedAt")
                              if previous.get("sourceHead") == source_head else None) or now(),
              "updatedAt": now()}
    record.update({key: value for key, value in fields.items() if value is not None})
    write_json(state_path(run_dir), record)
    return record


def clear_state(run_dir):
    try:
        state_path(run_dir).unlink()
    except FileNotFoundError:
        pass


def _age_seconds(stamp):
    try:
        then = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return None
    if then.tzinfo is None:   # Orc writes UTC with Z; anything else is not ours
        return None
    return (datetime.now(timezone.utc) - then).total_seconds()


def current(run_dir, source_head):
    """The record for this queued HEAD, with a long-silent preparation shown
    as stopped. None when there is no record for this HEAD."""
    state = read_state(run_dir)
    if not state or state.get("sourceHead") != source_head:
        return None
    if state["state"] == "preparing":
        age = _age_seconds(state.get("updatedAt"))
        if age is None or age > PREPARING_STALE_SECONDS:
            return {**state, "state": "failed",
                    "detail": "the session stopped before the fix was ready"}
    return state


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True,
                          text=True, check=False)


def _is_ancestor(repo, older, newer):
    return _git(repo, "merge-base", "--is-ancestor", older, newer).returncode == 0


def prepared_parents_error(repo, commit, source_head, target_head):
    """Why `commit` is not a fix for `source_head` against `target_head`.

    A fix is a two-parent merge: the queued HEAD first, then a commit the
    default branch already holds. Anything else would land work Ship never
    saw, so it is refused."""
    result = _git(repo, "rev-list", "--parents", "-n", "1", commit)
    parents = result.stdout.split()[1:] if result.returncode == 0 else []
    if len(parents) != 2:
        return "the fix must be one merge commit of the run and the default branch"
    if parents[0] != source_head:
        return "the fix's first parent must be the queued HEAD %s" % source_head[:7]
    if not _is_ancestor(repo, parents[1], target_head):
        return "the fix's second parent is not on the default branch"
    return None


def prepared_fix(repo, run_dir, source_head, target_head):
    """The ready fix for this queued HEAD that still fits the default branch
    at `target_head`, else None. Whether it still merges cleanly is the
    merge's question, not this one's."""
    state = current(run_dir, source_head)
    if not state or state["state"] != "ready":
        return None
    commit = state.get("commit")
    if not _SHA.fullmatch(str(commit or "")):
        return None
    stored = _git(repo, "rev-parse", "--verify", "--quiet", ref_name(Path(run_dir).name))
    if stored.returncode or stored.stdout.strip() != commit:
        return None
    if prepared_parents_error(repo, commit, source_head, target_head):
        return None
    return commit


def discard(repo, run_dir):
    """Forget a prepared fix: the ref, its scratch checkout and the record."""
    run_id = Path(run_dir).name
    if repo:
        _git(repo, "update-ref", "-d", ref_name(run_id))
        try:
            checkout = scratch_checkout(repo, run_id)
        except ProtocolError:
            checkout = None
        if checkout and checkout.exists():
            _git(repo, "worktree", "remove", "--force", str(checkout))
    clear_state(run_dir)


def scratch_checkout(repo, run_id):
    result = _git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if result.returncode or not result.stdout.strip():
        raise ProtocolError("cannot find the repository's Git directory")
    return Path(result.stdout.strip()) / "orc-early-resolution" / run_id
