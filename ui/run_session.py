from __future__ import annotations

import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from functools import cached_property
from pathlib import Path

import codex_rpc
import harnesses
import headless_session
import session_identity

def _snapshot_expiry(value):
    """Unix timestamp for a snapshot ISO date, or None when malformed."""
    if not isinstance(value, str) or len(value) > 64:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.timestamp()


SESSION_OWNER_KEYS = {"claude": "sessionId", "codex": "codexThreadId"}


def session_owner_id(meta):
    """The run's harness session id — the identity everything session-shaped is
    keyed on. Unlike a pane id it is never inherited by a stub run that ran
    inside another run's pane."""
    key = SESSION_OWNER_KEYS.get(meta.get("harness") or "")
    if key is None:
        key = "sessionId" if meta.get("harness") in (None, "claude") else None
    sid = meta.get(key) if key else None
    return sid if isinstance(sid, str) and sid else None


def _process_alive(pid):
    """Whether the recorded process ID still exists."""
    if not isinstance(pid, int) or pid <= 0:
        return None  # not recorded — fall back to expiry alone
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except (OSError, OverflowError):
        return True  # exists but not ours to signal (permissions)
    return True


def process_group_snapshot():
    """Live processes mapped to their parent and process group.

    One bounded table read serves a whole run scan. Claude's persistent MCP
    children stay in the harness group; detached background shells are direct
    children leading a different group. A failed query returns None so callers
    do not turn an unverified Stop heartbeat into an explicit idle state.
    """
    try:
        out = subprocess.run(
            ["ps", "-axo", "pid=,ppid=,pgid=,lstart=,command="],
            capture_output=True, text=True, timeout=1,
            env={**os.environ, "LC_ALL": "C", "TZ": "UTC"})
    except (OSError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0:
        return None
    processes = {}
    for line in out.stdout.splitlines():
        fields = line.split(None, 8)
        if len(fields) < 8 or not all(field.isdigit() for field in fields[:3]):
            continue
        try:
            started = datetime.strptime(" ".join(fields[3:8]),
                                        "%a %b %d %H:%M:%S %Y")
        except ValueError:
            continue
        pid, parent_pid, process_group = map(int, fields[:3])
        processes[pid] = {
            "parentPid": parent_pid,
            "processGroup": process_group,
            "command": fields[8] if len(fields) > 8 else "",
            "startedAt": started.replace(tzinfo=timezone.utc).timestamp(),
        }
    return processes


_LOAD_PROCESS_GROUPS = object()


# Claude's own children lead their own process groups, so they look exactly
# like detached background shells: `claude daemon run` (a background job) and
# `claude bg-pty-host` (its terminals). Neither is a background shell — a
# background job is a separate session with its own heartbeat and its own run
# ownership. Counting them kept the owner "running" for the whole life of the
# job, which held every gate that job opened behind the loading screen forever.
_CLAUDE_OWN_CHILD = re.compile(r"(?:^|/)claude(?:\s|$)")

# A Claude background shell is `zsh -c '<snapshot setup> && eval '<command>'
# < /dev/null && pwd -P >| <cwd file>'`; only the eval'd command means anything
# to a reader. No closing quote is required, so a truncated ps line still reads.
_SHELL_EVAL = re.compile(r"\beval '((?:[^']|'\\'')*)")
_LEADING_CD = re.compile(r"^cd \S+ && ")
BACKGROUND_TASK_LABEL_CHARS = 120


def _background_task_label(command):
    match = _SHELL_EVAL.search(command or "")
    text = match.group(1).replace("'\\''", "'") if match else (command or "")
    text = " ".join(_LEADING_CD.sub("", text.strip()).split())
    return text[:BACKGROUND_TASK_LABEL_CHARS]


def _claude_background_shells(pid, processes):
    """Labels of the detached direct children a live Claude process owns, or
    None when the process table cannot say."""
    if processes is None:
        return None
    harness = processes.get(pid)
    if not isinstance(harness, dict) or not isinstance(
            harness.get("processGroup"), int):
        return None
    harness_group = harness["processGroup"]
    return [
        _background_task_label(process.get("command"))
        for process in processes.values()
        if isinstance(process, dict)
        and process.get("parentPid") == pid
        and process.get("processGroup") != harness_group
        and not _CLAUDE_OWN_CHILD.search(process.get("command") or "")]


def session_heartbeat(run_dir, meta, processes=_LOAD_PROCESS_GROUPS, *, provider=codex_rpc):
    """The run's own hook-pushed activity, or None when it has nothing fresh.

    The agent's own hooks push ``running`` (prompt submitted, tool about to
    run) and ``idle`` (turn ended) into the run dir; this reads them back.
    Ownership is the harness session id, expiry bounds a heartbeat whose
    session died without a stop signal, and a dead pid reports the crash
    immediately rather than waiting the TTL out.

    A Claude Stop heartbeat is refined from one process-group snapshot: direct
    children outside the harness group keep it running until they exit, while
    same-group infrastructure does not. At an open gate they only get named.
    Query failure leaves activity unknown.

    Returns ``{"activity": "running"|"idle"|None, "alive": bool}``, plus
    ``idleAt`` when the live session has handed control back at least once
    and ``backgroundTasks`` when an idle gate still has detached children.
    """
    sid = session_owner_id(meta)
    if sid is None:
        return None
    harness = meta.get("harness") or "claude"

    def owned(beat):
        return (beat is not None and beat.get("sessionId") == sid
                and beat.get("harness") == harness)

    def process_alive(beat):
        nonlocal processes
        pid = beat.get("pid")
        alive = _process_alive(pid)
        if alive is not True:
            return alive
        if processes is _LOAD_PROCESS_GROUPS:
            processes = process_group_snapshot()
        started = (processes or {}).get(pid, {}).get("startedAt")
        updated = _snapshot_expiry(beat.get("updatedAt"))
        # A process born after the push cannot be the harness that sent it.
        if started is not None and updated is not None and started > updated:
            return False
        return alive

    snapshot = _owned_snapshot(run_dir, ".session-activity.json")
    if not owned(snapshot):
        stale = _owned_snapshot(run_dir, ".session-activity.json", expired=True)
        if owned(stale) and process_alive(stale) is False:
            return {"activity": None, "alive": False}
        return None
    alive = process_alive(snapshot)
    if alive is False:
        return {"activity": None, "alive": False}
    status = snapshot.get("status")
    pid = snapshot.get("pid")
    provider_verified = False
    unverified = False
    if (harness == "codex" and re.search(
            r"(?:^|/)codex\s+app-server(?:\s|$)",
            (processes if isinstance(processes, dict) else {}).get(pid, {}).get("command", ""))):
        provider_status = provider.thread_status(
            Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))), sid)
        if provider_status == "notLoaded":
            return {"activity": None, "alive": False}
        if provider_status in ("active", "idle", "systemError"):
            status = "running" if provider_status == "active" else "idle"
            provider_verified = True
    # A pending question outranks the background-shell refinement: a session
    # sitting in the question tool is blocked on the user whatever its
    # children are doing, and calling that "running" is the exact spinner the
    # idle push exists to remove. Snapshot only — never the transcript
    # fallback, which would read a file per run per poll.
    if (status == "idle" and snapshot.get("harness") == "claude"
            and isinstance(pid, int) and pid > 0
            and not claude_question_snapshot(run_dir, meta)):
        background = _claude_background_shells(pid, processes)
        if background is None:
            status = None
            unverified = True
        elif background and meta.get("status") != "awaiting-gate":
            status = "running"
    else:
        background = None
    beat = {"activity": status if status in ("running", "idle") else None,
            "alive": True}
    if provider_verified:
        beat["providerVerified"] = True
    if unverified:
        beat["activityUnverified"] = True
    if isinstance(snapshot.get("idleAt"), str):
        beat["idleAt"] = snapshot["idleAt"]
    # An open gate outranks the refinement the same way: control has handed
    # the run over, so a leftover preview server or a timed-out suite must not
    # hold the gate behind the loader. The page names them instead.
    if status == "idle" and background:
        beat["backgroundTasks"] = background
    return beat


def _owned_snapshot(run_dir, filename, expired=False):
    """One fresh, well-formed snapshot file from a run dir, or None.

    Hook heartbeats and question snapshots are local, credential-free files
    whose freshness — not their presence — is what makes them safe to believe. Callers own the identity check.
    ``expired`` also admits past evidence of a session ending or resuming;
    expiry cannot undo either event.
    """
    run_dir = os.path.realpath(run_dir)
    path = os.path.realpath(os.path.join(run_dir, filename))
    if not path.startswith(run_dir + os.sep):
        return None
    try:
        if os.path.getsize(path) > 64 * 1024:
            return None
        with open(path) as handle:
            snapshot = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(snapshot, dict) or snapshot.get("schemaVersion") != 1:
        return None
    updated = _snapshot_expiry(snapshot.get("updatedAt"))
    expires = _snapshot_expiry(snapshot.get("expiresAt"))
    now = time.time()
    if (updated is None or expires is None or updated > expires
            or updated > now + 300 or (now >= expires and not expired)):
        return None
    return snapshot


def claude_question_snapshot(run_dir, meta):
    """The question Claude Code's gate hook recorded for this run, or None.

    Written by bin/orc-hook-policy's PreToolUse pass — Claude Code's transcript
    only gains the AskUserQuestion line once it has been answered, too late to
    show.
    """
    sid = meta.get("sessionId")
    if meta.get("harness") != "claude" or not isinstance(sid, str) or not sid:
        return None
    snapshot = _owned_snapshot(run_dir, ".claude-question.json")
    if (snapshot is None or snapshot.get("harness") != "claude"
            or snapshot.get("sessionId") != sid):
        return None
    activity = _owned_snapshot(run_dir, ".session-activity.json", expired=True)
    if (activity is not None and activity.get("harness") == "claude"
            and activity.get("sessionId") == sid
            and activity.get("status") == "running"
            and _snapshot_expiry(activity.get("updatedAt"))
            > _snapshot_expiry(snapshot.get("updatedAt"))):
        return None
    questions = _snapshot_questions(snapshot, meta)
    return {"source": "claude", "questions": questions} if questions else None


def _snapshot_questions(snapshot, meta):
    """The bounded question list of a live pending question snapshot, or None.

    One malformed field drops the whole snapshot: a half-rendered question is
    worse than the spinner it replaces.

    Esc can skip PostToolUse, leaving the file behind. The caller checks for
    resumed session activity; priorStatus also catches lifecycle transitions
    beyond the question, even when no later heartbeat was recorded.
    """
    if snapshot is None or snapshot.get("state") != "pending":
        return None
    prior = snapshot.get("priorStatus")
    if prior and meta.get("status") not in (prior, "escalated"):
        return None
    questions = snapshot.get("questions")
    if not isinstance(questions, list) or not 1 <= len(questions) <= 3:
        return None
    out = []
    for question in questions:
        if not isinstance(question, dict):
            return None
        header = question.get("header") or ""
        text = question.get("question")
        options = question.get("options") or []
        if (not isinstance(header, str) or len(header) > 80
                or not isinstance(text, str) or not text or len(text) > 500
                or not isinstance(options, list) or len(options) > 4):
            return None
        normalized = []
        for option in options:
            if not isinstance(option, dict):
                return None
            label = option.get("label")
            description = option.get("description") or ""
            if (not isinstance(label, str) or not label or len(label) > 100
                    or not isinstance(description, str) or len(description) > 240):
                return None
            normalized.append({"label": label, "description": description})
        out.append({"header": header, "question": text, "options": normalized})
    return out


_FINISHED = {"merged", "merged-to-parent", "complete", "cancelled"}
_SESSION_FIELDS = ("sessionActivity", "sessionAlive", "sessionIdleAt",
                   "backgroundTasks", "herdrStatus",
                   "waitingOnYou", "herdrAttention", "paneAlive", "paneReclaimed")


def is_project_redirect(meta):
    return (meta.get("status") == "cancelled"
            and re.match(r"^redirected to standalone orc-init: /\S", str(meta.get("cancelReason", ""))) is not None)


class SessionUnavailable(ValueError):
    """A requested focus has no safe target."""


class RunSessions:

    def __init__(self, runs_dir, *, codex=codex_rpc,
                 processes=_LOAD_PROCESS_GROUPS):
        self.runs_dir = os.fspath(runs_dir)
        self.codex = codex
        self._processes = processes

    @cached_property
    def processes(self):
        return (process_group_snapshot() if self._processes is _LOAD_PROCESS_GROUPS
                else self._processes)


    def read(self, run_id, meta=None):
        run_dir = os.path.join(self.runs_dir, run_id)
        if meta is None:
            try:
                with open(os.path.join(run_dir, "meta.json")) as handle:
                    meta = json.load(handle)
            except (OSError, ValueError):
                meta = {}
        if not isinstance(meta, dict):
            meta = {}
        meta = session_identity.restore_launch_identity(meta, run_dir)
        return RunSession(self, run_id, run_dir, meta)


class RunSession:
    """Recovered identity plus lazy evidence for a single run operation.

    ``display_fields`` supplies payload-only facts, leaving presentation and
    lifecycle status to callers. ``activity`` serves gates; worktree cleanup
    additionally requires a fresh heartbeat.
    """

    def __init__(self, reads, run_id, run_dir, meta):
        self._reads = reads
        self.run_id = run_id
        self.run_dir = run_dir
        self.meta = {key: value for key, value in meta.items()
                     if key not in _SESSION_FIELDS}

    @cached_property
    def heartbeat(self):
        if session_owner_id(self.meta) is None:
            return None
        return session_heartbeat(self.run_dir, self.meta, self._reads.processes,
                                 provider=self._reads.codex)

    @cached_property
    def headless(self):
        return headless_session.is_headless(self.meta)

    @cached_property
    def _turn(self):
        return headless_session.turn_state(self.run_dir) if self.headless else None

    @property
    def _headless_activity(self):
        """A headless run's turn state, or None when nothing can be running:
        before its first turn, or a finished run between follow-ups."""
        turn = self._turn
        if turn is None or (turn["state"] != "running"
                            and self.meta.get("status") in _FINISHED):
            return None
        # A turn that has replied and only waits on its background tasks has
        # handed the run back, though its process still holds the next turn.
        return "idle" if turn.get("replied") else turn["state"]

    @cached_property
    def pane(self):
        return headless_session.target_for(self.run_id) if self.headless else None

    @property
    def _ended(self):
        return self.heartbeat is not None and not self.heartbeat["alive"]


    def activity(self, *, require_heartbeat=False):
        # A headless heartbeat names the turn's own process, which exits after
        # every turn, so only the turn state says running or idle.
        if self.headless:
            activity = self._headless_activity
            if activity is None and require_heartbeat:
                return "offline"
            return activity
        beat = self.heartbeat
        if self._ended or (require_heartbeat and beat is None):
            return "offline" if require_heartbeat else None
        activity = beat["activity"] if beat else None
        return activity

    def display_fields(self):
        if self.headless:
            activity = self._headless_activity
            # A finished run between follow-ups is Offline, not Idle forever.
            fields = {"sessionBackend": "headless",
                      "sessionAlive": activity is not None
                      or self.meta.get("status") not in _FINISHED}
            if activity is not None:
                fields["sessionActivity"] = activity
            if self._turn is not None:
                fields["headlessTurn"] = self._turn
                if isinstance(self._turn.get("idleAt"), str) and self._turn["idleAt"]:
                    fields["sessionIdleAt"] = self._turn["idleAt"]
            # A harness may keep working after its turn ends, in a background
            # worker that queues the next turn.
            harness = harnesses.get(self.meta.get("harness"))
            if activity == "idle" and harness is not None and hasattr(harness, "idle_fields"):
                fields.update(harness.idle_fields(self.run_dir))
            return fields
        fields = {}
        beat = self.heartbeat
        if beat is not None:
            fields["sessionAlive"] = beat["alive"]
            if (beat["alive"] and beat["activity"] == "idle"
                    and self.meta.get("harness") == "codex"
                    and (not beat.get("providerVerified")
                         or self.meta.get("status") in _FINISHED)):
                snapshot = _owned_snapshot(self.run_dir, ".session-activity.json")
                process = (self._reads.processes or {}).get((snapshot or {}).get("pid"), {})
                # The app-server and a loaded idle thread can outlive a closed
                # terminal. Neither proves terminal liveness after delivery.
                if re.search(r"(?:^|/)codex\s+app-server(?:\s|$)", process.get("command", "")):
                    fields.pop("sessionAlive", None)
            if beat["activity"] is not None:
                fields["sessionActivity"] = beat["activity"]
            if beat.get("idleAt"):
                fields["sessionIdleAt"] = beat["idleAt"]
            if beat.get("backgroundTasks"):
                fields["backgroundTasks"] = beat["backgroundTasks"]
        return fields
