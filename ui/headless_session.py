"""Headless session backend: every agent turn is one detached process.

Claude turns run ``claude -p`` and Codex turns run ``codex exec``; an enabled
harness package builds its own agent's argv. The first turn starts the
conversation and each later turn resumes it by id, so a run is idle between
turns rather than offline: the next message simply starts the next process.
Claude and Codex keep the conversation in their own transcript or rollout,
which ``run_chat`` already reads. A harness whose agent keeps its threads
elsewhere gathers its turns' output into ``harness_transcript`` instead.

State lives in ``<run-dir>/.headless/``: ``state.json`` names the current turn
and its process, and each turn keeps its prompt, JSONL stdout and stderr.
A turn process leads its own process group (``start_new_session``), so it
outlives an orc-ui restart and Stop can interrupt the whole group at once.
Liveness is the recorded pid plus its start time, never the pid alone, because
macOS reuses pids.
"""
from __future__ import annotations

import contextlib
import fcntl
import gzip
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone

import claude_accounts
import claude_permissions
import codex_rpc
import stat_cache
import harnesses

STATE_DIR = ".headless"
STATE_FILE = "state.json"
TARGET_PREFIX = "headless:"
# The agents a turn can run on now: core's, then enabled harness packages'.
AGENTS = harnesses.Agents()
KEEP_TURNS = 10
ERROR_CHARS = 300
# A recorded start time and the process table's lstart (1s resolution) can
# disagree by a second either way; a process born later than this after the
# spawn is someone else's pid.
START_SLACK_SECONDS = 2.0
START_WINDOW_SECONDS = 30.0
INTERRUPT_GRACE_SECONDS = 5.0
ORC_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STEER_HOOK = os.path.join(ORC_ROOT, "bin", "orc-chat-steer")
HOOK_POLICY = os.path.join(ORC_ROOT, "bin", "orc-hook-policy")
AWS_HOOK = os.path.join(ORC_ROOT, "hooks", "aws-allowlist.py")

_TURN_FILE = re.compile(r"^turn-(\d+)\.(prompt|jsonl|err)$")
# A finished turn's logs once archive_turn_logs has gzipped them.
_PACKED_TURN_FILE = re.compile(r"^turn-(\d+)\.(jsonl|err)\.gz$")



class HeadlessError(RuntimeError):
    """A turn could not be started or stopped. ``code`` names the reason."""

    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


class HeadlessBusy(HeadlessError):
    def __init__(self):
        super().__init__("the agent is still working on its current turn", "agent_blocked")


def is_headless(meta):
    return isinstance(meta, dict) and meta.get("sessionBackend") == "headless"


def target_for(run_id):
    return TARGET_PREFIX + run_id


_RUN_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,200}\Z")


def is_target(value):
    return (isinstance(value, str) and value.startswith(TARGET_PREFIX)
            and _RUN_ID.match(value[len(TARGET_PREFIX):]) is not None)


def run_id_for_target(value):
    return value[len(TARGET_PREFIX):] if is_target(value) else None


def agent_binary(agent):
    """The executable a headless turn runs; tests point these at fakes."""
    override = os.environ.get("ORC_HEADLESS_%s_BIN" % agent.upper())
    module = harnesses.get(agent)
    return override or getattr(module, "BINARY", agent)


def available(agent=None):
    if agent and agent not in AGENTS:
        return False
    agents = (agent,) if agent else AGENTS
    return any(shutil.which(agent_binary(name)) for name in agents)


def codex_exec_args(args):
    """Interactive Codex launch flags rewritten for ``codex exec``.

    ``exec resume`` accepts only ``-c``, ``-m`` and the bypass flag, so the
    sandbox choices become ``sandbox_mode`` overrides that both forms take.
    A run launched in auto mode before Codex dropped ``--full-auto`` still
    records that flag, and gets today's auto mode.
    ``--remote`` points the TUI at the shared app-server, which exec never
    uses, and the working directory is set by the turn itself.
    """
    out = []
    items = list(args or [])
    index = 0
    while index < len(items):
        item = items[index]
        if item in ("--remote", "--cd", "-C"):
            index += 2
            continue
        if item == codex_rpc.LEGACY_AUTO_FLAG:
            out += codex_rpc.AUTO_MODE_ARGS
        elif item in ("--sandbox", "-s") and index + 1 < len(items):
            out += ["-c", 'sandbox_mode="%s"' % items[index + 1]]
            index += 1
        else:
            out.append(item)
        index += 1
    return out


def claude_directory_args(config_dir=None):
    home = os.path.expanduser("~")
    skill_roots = [os.path.join(home, ".claude", "skills")]
    if config_dir:
        skill_roots.append(os.path.join(config_dir, "skills"))
    paths = [os.path.join(home, ".orc"), os.path.join(ORC_ROOT, "skills"), *skill_roots]
    for skills in skill_roots:
        try:
            paths.extend(os.path.join(skills, name) for name in sorted(os.listdir(skills))
                         if os.path.islink(os.path.join(skills, name)))
        except OSError:
            continue
    directories = dict.fromkeys(os.path.realpath(path) for path in paths
                                if os.path.isdir(path))
    return [arg for path in directories for arg in ("--add-dir", path)]


def _include_aws_hook():
    if not os.path.isfile(AWS_HOOK) or os.environ.get("ORC_DISTRIBUTION_SOURCE"):
        return False
    manifest_path = os.path.join(ORC_ROOT, "distribution.json")
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path) as handle:
                if json.load(handle).get("audience") == "public":
                    return False
        except (OSError, ValueError):
            return False
    return True


def merge_settings(extra, addition):
    """``extra`` with ``addition`` folded into its one JSON ``--settings``
    value: nested objects merge and lists extend, so the launch's own keys
    (fastMode, its hooks) stay beside Orc's."""
    def fold(into, more):
        for key, value in more.items():
            if isinstance(value, dict) and isinstance(into.get(key), dict):
                fold(into[key], value)
            elif isinstance(value, list) and isinstance(into.get(key), list):
                into[key].extend(value)
            else:
                into[key] = value
        return into

    extra = list(extra)
    if not addition:
        return extra
    if "--settings" in extra[:-1]:
        index = extra.index("--settings") + 1
        try:
            settings = json.loads(extra[index])
        except ValueError:
            settings = None
        if isinstance(settings, dict):
            extra[index] = json.dumps(fold(settings, json.loads(json.dumps(addition))))
            return extra
    return ["--settings", json.dumps(addition), *extra]


def claude_hook_settings(run_dir, extra):
    """``extra`` with per-turn PreToolUse guards (worktree check, settings
    file check and optional AWS allowlist) plus the PostToolUse hook that hands the turn Chat messages
    sent while it works. Merges into any existing JSON ``--settings`` value."""
    steer_command = "[ ! -e %s ] || exec %s %s" % (
        shlex.quote(os.path.join(run_dir, "follow-ups.json")),
        shlex.quote(STEER_HOOK), shlex.quote(run_dir))
    steer_hook = {"hooks": [{"type": "command", "command": steer_command}]}
    pre_hooks = [{
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{"type": "command", "command": "%s worktree --harness claude" % shlex.quote(HOOK_POLICY)}],
    }, {
        "matcher": "Bash|Edit|Write|MultiEdit",
        "hooks": [{"type": "command", "command": "%s settings --harness claude" % shlex.quote(HOOK_POLICY)}],
    }]
    if _include_aws_hook():
        pre_hooks.append({
            "matcher": "Bash",
            "hooks": [{"type": "command", "command": shlex.quote(AWS_HOOK)}],
        })
    return merge_settings(extra, {"hooks": {"PreToolUse": pre_hooks, "PostToolUse": [steer_hook]}})


steer_hook_settings = claude_hook_settings


def turn_argv(agent, *, session_id=None, resume=False, cwd=None, extra_args=(),
              claude_config_dir=None, run_dir=None, binary=None):
    """argv for one turn. The prompt always arrives on stdin. ``binary``
    replaces the agent's usual executable, as the compatibility probes do."""
    extra = list(extra_args or [])
    binary = binary or agent_binary(agent)
    if agent == "claude":
        if not session_id:
            raise HeadlessError("a Claude turn needs a session id", "no_session")
        # Settings read on every turn: one that turned a mode off since launch
        # steps this turn down rather than leaving it to deny every approval.
        extra, _ = claude_permissions.effective_args(extra, cwd, claude_config_dir)
        # Allow Orc's own run helpers before auto mode's classifier sees them.
        extra = merge_settings(extra, claude_permissions.auto_mode_settings(
            extra, ORC_ROOT, os.path.dirname(os.fspath(run_dir)) if run_dir else None))
        if run_dir:
            extra = steer_hook_settings(os.fspath(run_dir), extra)
        # AskUserQuestion has nobody to answer it in print mode: the agent asks
        # in its reply instead and the answer arrives as the next turn.
        return [binary, "-p", "--output-format", "stream-json", "--verbose",
                "--permission-prompts", "none",
                "--disallowedTools", "AskUserQuestion",
                *(["--resume", session_id] if resume else ["--session-id", session_id]),
                *claude_directory_args(claude_config_dir), *extra]
    if agent == "codex":
        exec_args = codex_exec_args(extra)
        if resume:
            if not session_id:
                raise HeadlessError("a resumed Codex turn needs a thread id", "no_session")
            return [binary, "exec", "resume", "--json", "--skip-git-repo-check",
                    *exec_args, session_id, "-"]
        return [binary, "exec", "--json", "--skip-git-repo-check",
                *(["--cd", cwd] if cwd else []), *exec_args, "-"]
    module = harnesses.get(agent)
    if module is None:
        raise HeadlessError(harnesses.refusal(agent) if harnesses.known(agent)
                            else "unsupported agent: %s" % agent, "unsupported_agent")
    return module.turn_argv(binary, session_id=session_id, resume=resume, extra_args=extra)


# What an agent session exports to its own children. orc-ui is often started
# from inside one, and a turn that inherited these would join that session's
# pane, messaging socket and account instead of being its own session.
_SESSION_ENV = re.compile(
    r"HERDR_\w*|CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CONFIG_DIR|AI_AGENT"
    r"|CLAUDE_CODE_(?:ENTRYPOINT|EXECPATH|CHILD_SESSION|MESSAGING_\w+|SESSION_\w+)"
    r"|CODEX_THREAD_ID|CODEX_SANDBOX\w*|ORC_RESCUE_TOKEN|ORC_HIGH_POWER|ORC_LOW_POWER|ORC_POWER_RUN")

# Print mode labels its requests sdk-cli, which Claude's five-hour window
# charges at roughly 1.8x a custom label for the same work
# (pingdotgg/t3code#25597).
CLAUDE_ENTRYPOINT = "orc"
# An agent's shell command stops at 10 minutes, so bin/test refuses a Python
# layer it estimates past 8 and prints the --part commands that fit instead
# of being cut off and polled from the background.
TEST_BUDGET_SECONDS = "480"


def child_env(base, extra=None):
    """The turn's environment: orc-ui's own, without another agent session's
    identity, plus Orc's Claude label, bin/test's per-command budget and the
    run's (ORC_RUN_ID, the Claude account)."""
    env = {key: value for key, value in (base or {}).items()
           if not _SESSION_ENV.fullmatch(key)}
    env["CLAUDE_CODE_ENTRYPOINT"] = CLAUDE_ENTRYPOINT
    env.setdefault("ORC_TEST_BUDGET_SECONDS", TEST_BUDGET_SECONDS)
    env.update(extra or {})
    return env


def standalone_env(base=None, extra=None):
    """The environment of a turn that belongs to no run, such as the
    assistant's or a vault page's build: ``child_env`` without the run orc-ui
    was started from, and without Claude Code's own memory."""
    env = child_env(os.environ if base is None else base, {"CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1", **(extra or {})})
    env.pop("ORC_RUN_ID", None)
    return env


def _dir(run_dir):
    return os.path.join(run_dir, STATE_DIR)


def _path(run_dir, name):
    return os.path.join(_dir(run_dir), name)


def harness_transcript(run_dir, agent):
    """Where a harness package gathers its turns for Chat, which reads the
    file the way it reads a Claude transcript."""
    return _path(run_dir, "%s-transcript.jsonl" % agent)


def _ensure_dir(run_dir):
    """Make the run's headless folder, never a run folder the user deleted."""
    with contextlib.suppress(FileExistsError):
        os.mkdir(_dir(run_dir), mode=0o700)


@contextlib.contextmanager
def control_lock(run_dir):
    _ensure_dir(run_dir)
    with open(_path(run_dir, ".control.lock"), "a+") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


@contextlib.contextmanager
def _locked(run_dir, name=".lock"):
    _ensure_dir(run_dir)
    with open(_path(run_dir, name), "a+") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield


def _read_state(run_dir):
    try:
        with open(_path(run_dir, STATE_FILE)) as handle:
            state = json.load(handle)
    except (OSError, ValueError):
        return None
    if (not isinstance(state, dict) or state.get("schemaVersion") != 1
            or not isinstance(state.get("turn"), int)):
        return None
    return state


def _write_state(run_dir, state):
    fd, temporary = tempfile.mkstemp(dir=_dir(run_dir), prefix=".state-")
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(state, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, _path(run_dir, STATE_FILE))
        with _RUNNING_TURN_LOCK:
            _RUNNING_TURN_CACHE.pop(os.fspath(run_dir), None)
    except OSError:
        with contextlib.suppress(OSError):
            os.unlink(temporary)
        raise


def _now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


_UNKNOWN = object()


def _process_started(pid):
    """(started epoch, zombie) from the process table, None when the pid is
    gone, or _UNKNOWN when ps could not say."""
    try:
        out = subprocess.run(
            ["ps", "-o", "stat=,lstart=", "-p", str(pid)],
            capture_output=True, text=True, timeout=2,
            env={**os.environ, "LC_ALL": "C", "TZ": "UTC"})
    except (OSError, subprocess.TimeoutExpired):
        return _UNKNOWN
    fields = out.stdout.split()
    if out.returncode != 0 and not fields:
        return None
    if len(fields) < 6:
        return _UNKNOWN
    try:
        started = datetime.strptime(" ".join(fields[1:6]), "%a %b %d %H:%M:%S %Y")
    except ValueError:
        return _UNKNOWN
    return started.replace(tzinfo=timezone.utc).timestamp(), fields[0].startswith("Z")


# (pid, spawnedAt) -> when ps last matched that pid to the turn. Another
# process can hold the pid only after the pid space wraps, which takes
# tens of minutes even on a busy Mac, so a match is reused for this long.
_MATCHED_TURNS = {}
_MATCHED_TURNS_LOCK = threading.Lock()
MATCHED_TURN_SECONDS = 30.0


def _turn_process_alive(state, reuse_match=False):
    """Whether the turn's own process still runs. `reuse_match` lets a
    read that only reports state skip the process table while a recent
    match stands; a decision to signal, start or archive leaves it off,
    because a recent match does not see a leader that exited and awaits
    its reaper."""
    pid = state.get("pid")
    spawned = state.get("spawnedAt")
    if not isinstance(pid, int) or pid <= 0 or not isinstance(spawned, (int, float)):
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:
        pass
    key, now = (pid, spawned), time.monotonic()
    if reuse_match:
        with _MATCHED_TURNS_LOCK:
            matched = _MATCHED_TURNS.get(key)
        if matched is not None and now - matched < MATCHED_TURN_SECONDS:
            return True
    seen = _process_started(pid)
    if seen is None:
        return False
    if seen is _UNKNOWN:
        # The pid answers signals; calling it dead would start a second
        # process on the same conversation.
        return True
    started, zombie = seen
    alive = (not zombie and spawned - START_SLACK_SECONDS <= started
             <= spawned + START_WINDOW_SECONDS)
    with _MATCHED_TURNS_LOCK:
        if alive:
            if len(_MATCHED_TURNS) >= 256:
                for stale in [k for k, at in _MATCHED_TURNS.items()
                              if now - at >= MATCHED_TURN_SECONDS]:
                    del _MATCHED_TURNS[stale]
            _MATCHED_TURNS[key] = now
        else:
            _MATCHED_TURNS.pop(key, None)
    return alive


def _process_table():
    """Every process as ``{pid: (ppid, pgid, started epoch or None, zombie)}``,
    or _UNKNOWN when ps could not say."""
    try:
        out = subprocess.run(
            ["ps", "-A", "-o", "pid=,ppid=,pgid=,stat=,lstart="],
            capture_output=True, text=True, timeout=2,
            env={**os.environ, "LC_ALL": "C", "TZ": "UTC"})
    except (OSError, subprocess.TimeoutExpired):
        return _UNKNOWN
    if out.returncode != 0:
        return _UNKNOWN
    table = {}
    for line in out.stdout.splitlines():
        fields = line.split()
        try:
            pid, ppid, pgid = int(fields[0]), int(fields[1]), int(fields[2])
        except (ValueError, IndexError):
            return _UNKNOWN
        try:
            started = datetime.strptime(" ".join(fields[4:9]), "%a %b %d %H:%M:%S %Y")
            started = started.replace(tzinfo=timezone.utc).timestamp()
        except ValueError:
            started = None
        table[pid] = (ppid, pgid, started, len(fields) > 3 and fields[3].startswith("Z"))
    return table


def _group_members(table, pgid):
    """``{pid: (started, zombie)}`` for the members of process group ``pgid``,
    or _UNKNOWN when one of them could not be identified."""
    members = {pid: (row[2], row[3]) for pid, row in table.items() if row[1] == pgid}
    return _UNKNOWN if any(started is None for started, _ in members.values()) else members


def _process_group_members(pgid):
    table = _process_table()
    return table if table is _UNKNOWN else _group_members(table, pgid)


def _group_commands(table, pgid):
    """The live processes descended from group ``pgid`` that run in a group of
    their own, as ``{pid: started}``. Claude Code starts each shell command
    that way, so signaling the turn's group never reaches them."""
    children = {}
    for pid, row in table.items():
        children.setdefault(row[0], []).append(pid)
    queue = [pid for pid, row in table.items() if row[1] == pgid]
    seen, commands = set(queue), {}
    while queue:
        for child in children.get(queue.pop(), ()):
            if child in seen or child <= 1:
                continue
            seen.add(child)
            queue.append(child)
            _, _, started, zombie = table[child]
            if started is not None and not zombie:
                commands[child] = started
    return commands


def _live_commands(commands, table):
    """The ``commands`` still running as the same processes."""
    return {pid: started for pid, started in commands.items()
            if pid in table and table[pid][2] == started and not table[pid][3]}


def _tail(path, limit):
    """The last ``limit`` bytes of a turn log, or of its gzipped copy once
    archive_turn_logs has packed it, or None when neither can be read."""
    try:
        with open(path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            handle.seek(max(0, handle.tell() - limit))
            return handle.read()
    except FileNotFoundError:
        pass
    except OSError:
        return None
    try:
        with gzip.open(path + ".gz", "rb") as handle:
            data = b""
            while chunk := handle.read(1024 * 1024):
                data = (data + chunk)[-limit:]
            return data
    except (OSError, EOFError):
        return None


def _last_line(path):
    data = _tail(path, 64 * 1024)
    if data is None:
        return None
    lines = data.decode("utf-8", "replace").splitlines()
    for line in reversed(lines):
        if line.strip():
            return line.strip()[:ERROR_CHARS]
    return None


def _provider_error(raw):
    """`type: message` from a result event's `error`, which some harnesses write as a
    JSON string wrapping the provider's {"type": "error", "error": {...}}."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return raw.strip() or None
    if not isinstance(raw, dict):
        return None
    inner = raw.get("error") if isinstance(raw.get("error"), dict) else raw
    kind, message = inner.get("type"), inner.get("message")
    if isinstance(message, str) and message:
        return "%s: %s" % (kind, message) if isinstance(kind, str) and kind != "error" else message
    return kind if isinstance(kind, str) else None


def _log_outcome(path, agent=None):
    """(failed, message) from a turn's own JSONL, or (None, None) when it
    never reported an ending. Used when no reaper saw the exit code."""
    data = _tail(path, 256 * 1024)
    if data is None:
        return None, None
    lines = data.decode("utf-8", "replace").splitlines()
    provider_outcome = getattr(harnesses.get(agent), "turn_event_outcome", None) if agent else None
    for line in reversed(lines):
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        if provider_outcome is not None:
            outcome = provider_outcome(event)
            if outcome is not None:
                return outcome
        kind = event.get("type")
        if kind == "result":
            if event.get("is_error") or event.get("subtype") != "success":
                return True, (_provider_error(event.get("error")) or str(
                    event.get("result") or event.get("subtype") or "turn failed"))
            return False, None
        if kind == "turn.completed":
            return False, None
        if kind in ("turn.failed", "error"):
            detail = event.get("error") if isinstance(event.get("error"), dict) else event
            return True, str(detail.get("message") or "turn failed")
    return None, None


def save_launch(run_dir, *, agent, cwd, extra_args, claude_account=None, first_turn=1):
    """Record what every later turn repeats: the agent, its launch
    directory, and the launch flags (permission mode, model, effort, MCP
    config), since each turn is a fresh process."""
    with _locked(run_dir):
        record = {"schemaVersion": 1, "agent": agent, "cwd": cwd,
                  "extraArgs": list(extra_args or [])}
        if claude_account:
            record["claudeAccount"] = claude_account
        if isinstance(first_turn, int) and first_turn > 1:
            record["firstTurn"] = first_turn
        fd, temporary = tempfile.mkstemp(dir=_dir(run_dir), prefix=".launch-")
        with os.fdopen(fd, "w") as handle:
            json.dump(record, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, _path(run_dir, "launch.json"))


def read_launch(run_dir):
    try:
        record = json.loads(stat_cache.RUN_FILES.read(_path(run_dir, "launch.json")))
    except (OSError, ValueError):
        return None
    if (not isinstance(record, dict) or record.get("schemaVersion") != 1
            or not harnesses.known(record.get("agent"))
            or not isinstance(record.get("extraArgs"), list)
            or not all(isinstance(item, str) for item in record["extraArgs"])):
        return None
    return record


def _turn_name(turn, suffix):
    return "turn-%03d.%s" % (turn, suffix)


def _prune(run_dir, current):
    try:
        names = os.listdir(_dir(run_dir))
    except OSError:
        return
    for name in names:
        match = _TURN_FILE.match(name) or _PACKED_TURN_FILE.match(name)
        if match and int(match.group(1)) <= current - KEEP_TURNS:
            with contextlib.suppress(OSError):
                os.unlink(_path(run_dir, name))


def exit_recorded(run_dir):
    """A late enqueue may wake a finished turn once its reaper has saved the diff."""
    try:
        with _locked(run_dir, ".exit.lock"):
            state = _read_state(run_dir) or {}
            return state.get("status") == "exited" and state.get("exitCode") == 0
    except FileNotFoundError:
        return False


def _record_exit(run_dir, turn, pid, code):
    with _locked(run_dir):
        state = _read_state(run_dir)
        if not state or state.get("turn") != turn or state.get("pid") != pid:
            return
        now = _now_iso()
        state.update(status="exited", exitCode=code, endedAt=now, idleAt=now)
        _write_state(run_dir, state)
    if state.get("harness") == "claude":
        with contextlib.suppress(Exception):
            claude_accounts.record_fast_turn((read_launch(run_dir) or {}).get("claudeAccount"),
                                             _path(run_dir, _turn_name(turn, "jsonl")), now)
    with contextlib.suppress(Exception):
        import run_diff
        run_diff.record_turn_diff(run_dir)
    return True


@contextlib.contextmanager
def _prompt_input(path, module):
    encoder = getattr(module, "encode_prompt", None)
    with open(path) as original:
        if encoder is None:
            yield original
        else:
            with tempfile.TemporaryFile(mode="w+") as encoded:
                encoded.write(encoder(original.read()))
                encoded.seek(0)
                yield encoded


# Windows kept for Orc's own turns since the user's last one, newest last;
# past this the oldest are joined into one window.
ORC_TURNS_KEPT = 16


def _turn_origin(previous, turn, spawned, user_turn):
    """Who started each turn, carried across turns: the user's latest turn
    (``userTurn``, ``userTurnAt``) and the ``[start, end]`` epoch windows of
    the turns Orc started on its own since then (``orcTurns``). A state saved
    before these fields counts its turn as the user's."""
    previous = previous or {}
    if user_turn:
        return {"userTurn": turn, "userTurnAt": spawned, "orcTurns": []}
    last_user = previous.get("userTurn")
    last_user_at = previous.get("userTurnAt")
    if not isinstance(last_user, int):
        last_user = previous.get("turn", 0)
        last_user_at = previous.get("spawnedAt")
    windows = [list(window) for window in previous.get("orcTurns") or []
               if isinstance(window, list) and len(window) == 2]
    if windows and windows[-1][1] is None:
        windows[-1][1] = _ended_epoch(previous, spawned)
    windows.append([spawned, None])
    while len(windows) > ORC_TURNS_KEPT:
        # One window spanning the two oldest keeps every Orc turn covered.
        windows[:2] = [[windows[0][0], windows[1][1]]]
    return {"userTurn": last_user, "userTurnAt": last_user_at, "orcTurns": windows}


def _ended_epoch(state, fallback):
    ended = state.get("endedAt")
    if isinstance(ended, str):
        with contextlib.suppress(ValueError):
            return datetime.fromisoformat(ended.replace("Z", "+00:00")).timestamp()
    return fallback


# How long a Claude turn that has replied may keep its process for the
# background shells and Monitors it started. Print mode stays alive until they
# all end, and in a headless run nobody can read them finish. Until then the
# run would read Working and hold queued messages.
REPLIED_SETTLE_SECONDS = 120
# turn log -> ((size, mtime_ns), tasks). Every run-list scan asks each running
# turn, and the answer only changes when its log grows.
_REPLIED = {}
_REPLIED_LOCK = threading.Lock()
_REPLIED_MAX = 256


def replied_background_tasks(path):
    """The background tasks still running after a Claude turn's reply, or
    None when the turn has not replied or nothing is left running.

    The reply is a ``result`` event with no assistant or tool activity after
    it. A resumed session can replay the last turn's result before this
    turn's first message, so a result counts only after an assistant message
    or with turns behind it."""
    key = _stat_key(path)
    if key is None:
        return None
    with _REPLIED_LOCK:
        cached = _REPLIED.get(path)
    if cached is not None and cached[0] == key:
        return list(cached[1]) if cached[1] else None
    data = _tail(path, 256 * 1024)
    replied, assisted, tasks = False, False, []
    for line in (data or b"").decode("utf-8", "replace").splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        kind = event.get("type")
        if kind in ("assistant", "user"):
            replied = False
            assisted = assisted or kind == "assistant"
        elif kind == "result":
            replied = assisted or bool(event.get("num_turns"))
        elif kind == "system" and event.get("subtype") == "background_tasks_changed":
            tasks = [str(task.get("description") or task.get("task_id") or "background task")
                     for task in event.get("tasks") or [] if isinstance(task, dict)]
    found = tasks if replied and tasks else None
    with _REPLIED_LOCK:
        if len(_REPLIED) >= _REPLIED_MAX:
            _REPLIED.clear()
        _REPLIED[path] = (key, found)
    return list(found) if found else None


def settle_replied_turn(run_dir, state, now):
    """Stop a Claude turn that replied at least REPLIED_SETTLE_SECONDS ago
    and is kept alive only by its background tasks. The turn reads as
    completed. Returns True when it stopped the turn."""
    if state.get("harness") != "claude":
        return False
    path = _path(run_dir, _turn_name(state["turn"], "jsonl"))
    key = _stat_key(path)
    tasks = replied_background_tasks(path)
    if not tasks or key is None or now - key[1] / 1e9 < REPLIED_SETTLE_SECONDS:
        return False
    closing = {"type": "system", "subtype": "orc_settled", "backgroundTasks": tasks,
               "reason": "The agent had replied; Orc stopped the background tasks it left running."}
    return interrupt(run_dir, expect=(state["turn"], state["pid"]), settled=closing) == "stopped"


def start_turn(run_dir, *, agent, argv, prompt, cwd, env, popen=subprocess.Popen, turn_base=None,
               user_turn=True, on_exit=None):
    """Start the run's next turn and return its state. Raises HeadlessBusy
    while the current turn is still running. The reaper calls ``on_exit(run_dir)``
    after saving the current turn's exit and diff, outside its state locks.

    A turn Orc starts on its own (``user_turn=False``: a Ship gate reminder, a
    main-moved notice, a rescue) carries on the user's last turn, so it keeps
    that turn's "Last code change" baseline and is recorded in ``orcTurns``."""
    if not os.path.isdir(cwd):
        raise HeadlessError("launch directory does not exist: " + cwd, "no_cwd")
    with _locked(run_dir, ".turn.lock"), _locked(run_dir):
        with _IDLE_TURNS_LOCK:
            _IDLE_TURNS.pop(run_dir, None)
        previous = _read_state(run_dir)
        if previous and ("cleanupMembers" in previous or (
                previous.get("status") == "running" and _turn_process_alive(previous))):
            raise HeadlessBusy()
        turn = (previous or {}).get("turn", 0) + 1
        if not user_turn:
            turn_base = None
        elif turn_base is None:
            with contextlib.suppress(Exception):
                import run_diff
                turn_base = run_diff.capture_turn_base(run_dir)
        module = harnesses.get(agent)
        if module is not None and hasattr(module, "before_turn"):
            module.before_turn(run_dir)
        _prune(run_dir, turn)
        prompt_path = _path(run_dir, _turn_name(turn, "prompt"))
        log_path = _path(run_dir, _turn_name(turn, "jsonl"))
        err_path = _path(run_dir, _turn_name(turn, "err"))
        with open(prompt_path, "w") as handle:
            handle.write(prompt)
        spawned = time.time()
        try:
            with _prompt_input(prompt_path, module) as stdin, open(log_path, "wb") as stdout, \
                    open(err_path, "wb") as stderr:
                process = popen(argv, stdin=stdin, stdout=stdout, stderr=stderr,
                                cwd=cwd, env=env, start_new_session=True,
                                close_fds=True)
        except OSError as error:
            # Left behind, they would read as a newer turn than state.json names.
            for path in (prompt_path, log_path, err_path):
                with contextlib.suppress(OSError):
                    os.unlink(path)
            raise HeadlessError("could not start %s: %s" % (argv[0], error), "spawn_failed")
        state = {"schemaVersion": 1, "runId": os.path.basename(os.path.normpath(run_dir)),
                 "harness": agent, "turn": turn, "pid": process.pid,
                 "spawnedAt": spawned, "startedAt": _now_iso(),
                 "status": "running", "exitCode": None}
        idle_at = (previous or {}).get("endedAt") or (previous or {}).get("idleAt")
        if isinstance(idle_at, str) and idle_at:
            state["idleAt"] = idle_at
        state.update(_turn_origin(previous, turn, spawned, user_turn))
        try:
            _write_state(run_dir, state)
        except OSError as error:
            # An untracked turn would let the next message start a second one.
            with contextlib.suppress(OSError):
                os.killpg(process.pid, signal.SIGKILL)
            with contextlib.suppress(subprocess.TimeoutExpired):
                process.wait(timeout=2)
            raise HeadlessError("could not record the turn: %s" % error, "state_failed")
        if turn_base is not None:
            with contextlib.suppress(Exception):
                import run_diff
                run_diff.commit_turn_base(run_dir, turn_base)

    def reap():
        code = process.wait()
        with contextlib.suppress(FileNotFoundError):  # the run was deleted
            with _locked(run_dir, ".exit.lock"):
                recorded = _record_exit(run_dir, turn, process.pid, code)
            if recorded and on_exit is not None:
                on_exit(run_dir)

    threading.Thread(target=reap, name="headless-reap-%d" % process.pid, daemon=True).start()
    return state


# run dir -> (signature, idle result). Every run-list scan asks every headless
# run for its turn state, and an idle turn's answer only changes when its
# state file or latest turn log does.
_IDLE_TURNS = {}
_IDLE_TURNS_LOCK = threading.Lock()
# Deleted runs are swept out once the cache doubles since the last sweep, so
# filling it on a first scan of thousands of runs stays linear.
_IDLE_TURNS_SWEEP_AT = 64


def _stat_key(path, inode=False):
    try:
        st = os.stat(path)
    except OSError:
        return None
    return (st.st_ino, st.st_size, st.st_mtime_ns) if inode else (st.st_size, st.st_mtime_ns)


def _idle_signature(run_dir, turn, state_key=None):
    """State is replaced through os.replace, so its inode changes on every
    write; the turn logs are appended to, so size and mtime are enough. Each
    part is taken before what it describes is read, so a write in between
    only costs the next call a miss."""
    if state_key is None:
        state_key = _stat_key(_path(run_dir, STATE_FILE), inode=True)
    return (state_key, turn,
            _stat_key(_path(run_dir, _turn_name(turn, "jsonl"))),
            _stat_key(_path(run_dir, _turn_name(turn, "err"))))


def _cached_idle_turn(run_dir):
    with _IDLE_TURNS_LOCK:
        cached = _IDLE_TURNS.get(run_dir)
    if cached is None:
        return None
    signature, result = cached
    # start_turn holds .turn.lock from before it writes the new prompt until
    # state.json says running, and in that window the old files still match.
    try:
        handle = open(_path(run_dir, ".turn.lock"), "a+")
    except OSError:
        return None
    with handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
        except OSError:
            return None
        if _idle_signature(run_dir, signature[1]) != signature:
            return None
        return dict(result)


def _cache_idle_turn(run_dir, signature, result):
    global _IDLE_TURNS_SWEEP_AT
    with _IDLE_TURNS_LOCK:
        _IDLE_TURNS[run_dir] = (signature, dict(result))
        if len(_IDLE_TURNS) > _IDLE_TURNS_SWEEP_AT:
            for gone in [key for key in _IDLE_TURNS if not os.path.isdir(key)]:
                del _IDLE_TURNS[gone]
            _IDLE_TURNS_SWEEP_AT = max(64, 2 * len(_IDLE_TURNS))


def turn_state(run_dir):
    """Process activity and independent provider outcome for the latest turn."""
    cached = _cached_idle_turn(run_dir)
    if cached is not None:
        return cached
    with _locked(run_dir, ".turn.lock"), _locked(run_dir):
        signature = None
        state_key = _stat_key(_path(run_dir, STATE_FILE), inode=True)
        state = _read_state(run_dir)
        if state is None:
            return None
        turn = state["turn"]
        if "cleanupMembers" in state or (
                state.get("status") == "running"
                and _turn_process_alive(state, reuse_match=True)):
            running = {"state": "running", "outcome": "running", "turn": turn,
                       "exitCode": None, "providerOutcome": None, "error": None,
                       "cause": None, "continuation": None}
            if isinstance(state.get("idleAt"), str) and state.get("idleAt"):
                running["idleAt"] = state["idleAt"]
            tasks = (replied_background_tasks(_path(run_dir, _turn_name(turn, "jsonl")))
                     if state.get("harness") == "claude" and "cleanupMembers" not in state else None)
            if tasks:
                running.update(replied=True, backgroundTasks=tasks)
                replied = _stat_key(_path(run_dir, _turn_name(turn, "jsonl")))
                if replied is not None:
                    running["settleAt"] = datetime.fromtimestamp(
                        replied[1] / 1e9 + REPLIED_SETTLE_SECONDS, timezone.utc).isoformat()
            return running
        if state.get("status") == "running":
            now = _now_iso()
            state.update(status="exited", endedAt=now, idleAt=now)
            _write_state(run_dir, state)
        else:
            signature = _idle_signature(run_dir, turn, state_key)
        code = state.get("exitCode")
        failed, message = _log_outcome(_path(run_dir, _turn_name(turn, "jsonl")), state.get("harness"))
        provider = None if failed is None else ("failed" if failed else "completed")
        error = None
        if state.get("settledAt"):
            outcome, cause = "completed", None
        elif state.get("interruptedAt"):
            outcome, cause = "interrupted", "Stopped by request."
        elif failed or (isinstance(code, int) and code != 0):
            outcome = "failed"
            error = (message or _last_line(_path(run_dir, _turn_name(turn, "err")))
                     or "exited with status %s" % code)[:ERROR_CHARS]
            cause = error
        elif failed is False:
            outcome, cause = "completed", None
        else:
            outcome = "unknown"
            cause = "The process ended without a provider terminal event."
        result = {"state": "idle", "outcome": outcome, "turn": turn,
                  "exitCode": code, "providerOutcome": provider, "error": error,
                  "cause": cause,
                  "continuation": "Send a message in Chat to continue the conversation."}
        idle_at = state.get("endedAt") or state.get("idleAt")
        if isinstance(idle_at, str) and idle_at:
            result["idleAt"] = idle_at
        if state.get("interruptedAt"):
            result["interrupted"] = True
        if signature is not None:
            _cache_idle_turn(run_dir, signature, result)
        return result


def turn_prompt(run_dir, turn):
    """The prompt a kept turn was started with, or None once pruned."""
    if not isinstance(turn, int) or isinstance(turn, bool) or turn < 1:
        return None
    try:
        with open(_path(run_dir, _turn_name(turn, "prompt"))) as handle:
            return handle.read()
    except OSError:
        return None


_RUNNING_TURN_CACHE = {}
_RUNNING_TURN_LOCK = threading.Lock()
_RUNNING_TURN_MAX = 8192


def running_turn(run_dir):
    """The state of the turn recorded as running, or None when none is.

    Reads only the state file, so a sweep can check thousands of runs cheaply;
    ``interrupt`` re-checks the process before it signals anything.
    """
    cache_key = os.fspath(run_dir)
    key = stat_cache.optional_file_key(_path(run_dir, STATE_FILE))
    if key is None:
        with _RUNNING_TURN_LOCK:
            _RUNNING_TURN_CACHE.pop(cache_key, None)
        return None
    with _RUNNING_TURN_LOCK:
        hit = _RUNNING_TURN_CACHE.get(cache_key)
    if hit is not None and hit[0] == key:
        return dict(hit[1]) if hit[1] is not None else None
    state = _read_state(run_dir)
    if not state or state.get("status") != "running" or not isinstance(state.get("spawnedAt"), (int, float)):
        result = None
    else:
        result = state
    with _RUNNING_TURN_LOCK:
        if len(_RUNNING_TURN_CACHE) >= _RUNNING_TURN_MAX:
            _RUNNING_TURN_CACHE.clear()
        _RUNNING_TURN_CACHE[cache_key] = (key, dict(result) if result is not None else None)
    return dict(result) if result is not None else None


def _append_closing_line(run_dir, turn, line):
    """Add ``line`` to a turn's log once its process group is gone. The
    process wrote the log from offset 0, and an archived log stays as it is."""
    try:
        fd = os.open(_path(run_dir, _turn_name(turn, "jsonl")), os.O_RDWR | os.O_APPEND)
    except OSError:
        return
    with os.fdopen(fd, "rb+") as handle:
        size = handle.seek(0, os.SEEK_END)
        handle.seek(max(0, size - 1))
        lead = b"\n" if size and handle.read(1) != b"\n" else b""
        handle.write(lead + json.dumps(line).encode() + b"\n")
    with _IDLE_TURNS_LOCK:
        _IDLE_TURNS.pop(run_dir, None)


_CLEANUP_KEYS = ("cleanupMembers", "cleanupCommands", "cleanupForced")


def _checkpoint_cleanup(run_dir, state, members, mark="interruptedAt", commands=None, forced=False):
    """Record what Stop still has to end: the turn's group ``members``, the
    shell ``commands`` it started in groups of their own, and whether Stop
    has had to force the turn, which is when those commands are ended too.
    ``members=None`` records that nothing is left."""
    with _locked(run_dir):
        current = _read_state(run_dir)
        if not current or any(current.get(key) != state.get(key) for key in ("turn", "pid")):
            return False
        if members is None:
            for key in _CLEANUP_KEYS:
                current.pop(key, None)
        else:
            cleanup = {"cleanupMembers": {str(pid): identity[0] for pid, identity in members.items()}}
            if commands:
                cleanup["cleanupCommands"] = {str(pid): started for pid, started in commands.items()}
            if forced:
                cleanup["cleanupForced"] = True
            if all(current.get(key) == cleanup.get(key) for key in _CLEANUP_KEYS):
                return True
            for key in _CLEANUP_KEYS:
                current.pop(key, None)
            current.update(cleanup)
            if "interruptedAt" not in current and "settledAt" not in current:
                current[mark] = _now_iso()
        try:
            _write_state(run_dir, current)
        except OSError:
            return False
    return True


def _saved_commands(state):
    saved = state.get("cleanupCommands")
    if not isinstance(saved, dict):
        return {}
    commands = {}
    for pid, started in saved.items():
        with contextlib.suppress(ValueError, TypeError):
            if isinstance(started, (int, float)):
                commands[int(pid)] = started
    return commands


def interrupt(run_dir, *, wait=INTERRUPT_GRACE_SECONDS, sig=signal.SIGINT, expect=None, settled=None,
              report=None):
    """Interrupt the running turn's process group, as Esc does in a terminal,
    escalating to SIGTERM and then SIGKILL when it will not stop. Returns
    ``stopped``, ``idle`` when nothing is running, or ``failed``.

    A turn that has to be forced (an escalation, or ``sig`` SIGKILL for
    Kill) also has the shell commands it had started in groups of their own
    ended with the same signals; a turn that stops on ``sig`` ends them
    itself. ``report``, a dict, gets the name of the last signal sent under
    ``"signal"``.

    A sweep passes the ``(turn, pid)`` it judged as ``expect``, so a turn
    the user started since is left alone. ``settled`` ends a turn whose agent
    had already finished: it is the line that closes the turn's log, written
    before the next turn can start, and the turn reads as completed."""
    state = _read_state(run_dir)
    if not state:
        return "idle"
    # Completion reads and new turns wait for group cleanup, while the reaper
    # retains access to the state lock to record the leader's exit.
    with _locked(run_dir, ".turn.lock"):
        state = _read_state(run_dir)
        if not state:
            return "idle"
        if expect is not None and (state.get("turn"), state.get("pid")) != tuple(expect):
            return "idle"
        result = _stop_group(run_dir, state, wait, sig, "interruptedAt" if settled is None else "settledAt",
                             {} if report is None else report)
        if result == "stopped" and settled is not None:
            _append_closing_line(run_dir, state["turn"], settled)
    return result


def _group_done(members):
    return not members or all(zombie for _, zombie in members.values())


def _stop_group(run_dir, state, wait, sig, mark, report):
    pending = "cleanupMembers" in state
    if not pending and (state.get("status") != "running" or not _turn_process_alive(state)):
        return "idle"
    pid = state["pid"]
    table = _process_table()
    if table is _UNKNOWN:
        return "failed"
    members = _group_members(table, pid)
    if members is _UNKNOWN:
        return "failed"
    if pending:
        forced = state.get("cleanupForced") is True
        commands = _live_commands(_saved_commands(state), table)
        if _group_done(members) and not (forced and commands):
            return "stopped" if _checkpoint_cleanup(run_dir, state, None) else "failed"
        owned = state["cleanupMembers"]
        if not isinstance(owned, dict) or not _group_done(members) and not any(
                owned.get(str(member)) == identity[0] for member, identity in members.items()):
            return "failed"
    else:
        if not members:
            return "idle"
        leader = members.get(pid)
        if (leader is None or leader[1]
                or not state["spawnedAt"] - START_SLACK_SECONDS <= leader[0]
                <= state["spawnedAt"] + START_WINDOW_SECONDS):
            return "failed"
        # Taken before any signal: once the turn is gone, its commands are
        # adopted by launchd and nothing ties them to it.
        forced, commands = False, _group_commands(table, pid)
    # Stop may outlive its caller and its leader. Persist ownership before
    # signaling so a fresh process can finish cleanup after either exits.
    if not _checkpoint_cleanup(run_dir, state, members, mark, commands, forced):
        return "failed"
    sent = False
    # Once the group is seen gone, only its commands are left to signal: the
    # group number is no longer the turn's.
    group_gone = _group_done(members)
    for stop_signal, grace in ((sig, wait), (signal.SIGTERM, 2.0), (signal.SIGKILL, 2.0)):
        forced = forced or stop_signal != signal.SIGINT
        if forced and commands and not _checkpoint_cleanup(run_dir, state, members, mark, commands, forced):
            return "failed"
        if not group_gone:
            try:
                os.killpg(pid, stop_signal)
            except ProcessLookupError:
                group_gone = True
            except OSError:
                return "failed"
        if forced:
            for command in commands:
                with contextlib.suppress(ProcessLookupError, PermissionError):
                    os.kill(command, stop_signal)
        if group_gone and not (forced and commands):
            if not _checkpoint_cleanup(run_dir, state, None):
                return "failed"
            return "stopped" if sent else "idle"
        sent = True
        report["signal"] = signal.Signals(stop_signal).name
        deadline = time.monotonic() + grace
        while True:
            table = _process_table()
            if table is _UNKNOWN:
                return "failed"
            current = _group_members(table, pid)
            if current is _UNKNOWN:
                return "failed"
            commands = _live_commands(commands, table)
            done = _group_done(current)
            group_gone = group_gone or done
            if done and not (forced and commands):
                return "stopped" if _checkpoint_cleanup(run_dir, state, None) else "failed"
            # A surviving identity anchors the group after its leader is
            # reaped; a recycled group number alone authorizes no signal.
            if not done and not any(member in current and current[member][0] == identity[0]
                                    for member, identity in members.items()):
                return "failed"
            if not done:
                members = current
            if not _checkpoint_cleanup(run_dir, state, current, mark, commands, forced):
                return "failed"
            if time.monotonic() >= deadline:
                break
            time.sleep(0.1)
        if sig == signal.SIGKILL:
            break
    return "failed"


def turn_output_started(run_dir):
    """Whether the current turn has written any output yet: a CLI that got
    as far as its first event accepted its flags and login."""
    state = _read_state(run_dir)
    if not state:
        return False
    try:
        return os.path.getsize(_path(run_dir, _turn_name(state["turn"], "jsonl"))) > 0
    except OSError:
        return False


def codex_thread_id(run_dir, *, first_turn=1):
    """The thread a headless Codex conversation started, from its first
    ``thread.started`` event, or None before Codex reported one."""
    try:
        names = sorted(name for name in os.listdir(_dir(run_dir))
                       for match in [_TURN_FILE.match(name) or _PACKED_TURN_FILE.match(name)]
                       if match and match.group(2) == "jsonl" and int(match.group(1)) >= first_turn)
    except OSError:
        return None
    for name in names:
        try:
            with (gzip.open if name.endswith(".gz") else open)(_path(run_dir, name), "rt") as handle:
                for _, line in zip(range(64), handle):
                    try:
                        event = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(event, dict) and event.get("type") == "thread.started":
                        thread = event.get("thread_id")
                        if isinstance(thread, str) and re.fullmatch(r"[0-9A-Za-z-]{8,64}", thread):
                            return thread
        except (OSError, EOFError):
            continue
    return None


def _turn_logs(run_dir):
    """(turn, name) for every turn file, raw or gzipped."""
    try:
        names = os.listdir(_dir(run_dir))
    except FileNotFoundError:
        return []
    return sorted((int(match.group(1)), name) for name in names
                  for match in [_TURN_FILE.match(name) or _PACKED_TURN_FILE.match(name)] if match)


def _latest_turn(state, logs):
    """The turn state.json names, else the highest on disk. Files numbered
    above the named turn belong to a turn that was never recorded."""
    if state:
        return state["turn"]
    return max((turn for turn, _name in logs), default=None)


def older_turn_logs(run_dir):
    """The turn files of every turn before the latest."""
    logs = _turn_logs(run_dir)
    latest = _latest_turn(_read_state(run_dir), logs)
    return [name for turn, name in logs if latest is not None and turn < latest]


def archive_turn_logs(run_dir, move=None, history_saved=False):
    """Settle a run's turn logs for archiving and return the bytes gzip saved.

    Once the conversation is safe elsewhere, every turn before the latest,
    the one state.json names, is redundant and goes to ``move(name)``. A harness's is safe once its transcript
    has synced, and a Claude or Codex run's when ``history_saved``. The
    latest turn, or every finished turn when the history is not safe, is
    gzipped in place, its prompt kept. A running turn, and files of a turn
    numbered past the latest, are never touched.
    Raises OSError when a log cannot be synced, moved or gzipped."""
    if not os.path.isdir(_dir(run_dir)):
        return 0
    with _locked(run_dir, ".turn.lock"), _locked(run_dir):
        state = _read_state(run_dir)
        live = state["turn"] if state and ("cleanupMembers" in state or (
            state.get("status") == "running" and _turn_process_alive(state))) else None
        launch = read_launch(run_dir)
        if launch and launch["agent"] not in harnesses.CORE_AGENTS:
            # A harness whose turn logs are its only local history gathers
            # them first, and the gathering never reads a .gz. With its
            # package off they cannot be gathered, so they stay, gzipped.
            module = harnesses.get(launch["agent"])
            history_saved = module is not None and hasattr(module, "sync_transcript")
            if history_saved:
                module.sync_transcript(run_dir, final=live is None, strict=True)
        logs = _turn_logs(run_dir)
        latest = _latest_turn(state, logs)
        saved = 0
        for turn, name in logs:
            if turn == live or turn > latest:
                continue
            if move is not None and history_saved and turn < latest:
                move(name)
            elif _TURN_FILE.match(name) and not name.endswith(".prompt"):
                saved += _gzip_in_place(_path(run_dir, name))
        with _IDLE_TURNS_LOCK:
            _IDLE_TURNS.pop(run_dir, None)
    return saved


def _gzip_in_place(path):
    """Replace ``path`` with ``path.gz``, removing the original only once the
    copy is synced to disk, and return the bytes saved."""
    directory, name = os.path.split(path)
    try:
        reader = open(path, "rb")
    except FileNotFoundError:
        return 0
    fd, temporary = tempfile.mkstemp(dir=directory, prefix="." + name + ".gz-")
    try:
        with reader, os.fdopen(fd, "wb") as raw:
            original = os.fstat(reader.fileno())
            with gzip.GzipFile(filename=name, mode="wb", fileobj=raw) as writer:
                shutil.copyfileobj(reader, writer)
            raw.flush()
            os.fsync(raw.fileno())
            packed = os.fstat(raw.fileno()).st_size
        os.utime(temporary, ns=(original.st_atime_ns, original.st_mtime_ns))
        os.replace(temporary, path + ".gz")
        directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        os.unlink(path)
    except OSError:
        with contextlib.suppress(OSError):
            os.unlink(temporary)
        raise
    return original.st_size - packed
