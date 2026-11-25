"""The Codex compatibility probe: what an Orc run asks of a real ``codex``,
driven against ``harness_compat.ModelServer`` and read back through Orc's own
readers. It covers headless turns (a tool call, a failed command, a resume, a
provider failure and an interrupt), a spawned child thread, reasoning, token
counts and compaction in the rollout, the app-server control socket with the
methods Orc calls on it and the terminal's ``--remote`` resume, ``codex login
status``, ``codex mcp``, model discovery, and Orc's skill catalog and launch
context.

Readers that find Codex through ``CODEX_HOME`` run in a child Python given the
sandbox's environment, so the probe never changes the server's own.
``harness_compat.clis`` registers it."""
import contextlib
import fcntl
import json
import os
import pty
import queue
import select
import shlex
import signal
import sqlite3
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time
from pathlib import Path

import codex_cost
import codex_questions
import codex_rpc
import harness_context
import headless_session
import skill_commands
from harness_compat import (COMMAND_SECONDS, DAEMON_PID, SANDBOX_PREFIX, SHORT_HOME_PREFIX,
                            TOOL_OUTPUT, TURN_SECONDS, ModelServer, base_env, flag_failures,
                            item_failures, must_start, read_items, run_turn, sandbox, server_errors, turn_failure)

LABEL = "Codex"
PACKAGE = "@openai/codex"
ORC_ROOT = Path(__file__).resolve().parents[1]
ORC_SKILL = ORC_ROOT / "skills" / "orc" / "SKILL.md"

# Every Codex app-server method Orc calls; tests/test_harness_compat_codex.py
# scans ui/ and app-plugins/ to keep it complete.
CODEX_APP_SERVER_METHODS = (
    "account/rateLimitResetCredit/consume", "account/rateLimits/read", "initialize", "model/list",
    "skills/list", "thread/loaded/list", "thread/read", "thread/resume", "thread/turns/list",
    "turn/interrupt", "turn/start", "turn/steer",
)
CODEX_APP_SERVER_NOTIFICATIONS = ("initialized",)
# The tables and columns codex_questions and run_subagents query.
CODEX_SQLITE_COLUMNS = {
    "threads": ("id", "rollout_path"),
    "thread_spawn_edges": ("parent_thread_id", "child_thread_id"),
}
CONTROL_SOCKET = "app-server-control/app-server-control.sock"
SPAWN_TOOL = ("multi_agent_v1", "spawn_agent")
# How long the parent's reply waits for the spawned child's first request.
CHILD_SECONDS = 10
FAILED_EXIT = 7
# What ModelServer answers a "fail" with.
PROVIDER_FAILURE = "scripted compatibility failure"
REASONING = "Weighing the compatibility fixture."
CODEX_USAGE = {"input_tokens": 9000, "input_tokens_details": {"cached_tokens": 3000, "cache_write_tokens": 500},
               "output_tokens": 400, "output_tokens_details": {"reasoning_tokens": 150}, "total_tokens": 9400}
# What codex_cost.token_totals should price for CODEX_USAGE.
CODEX_COST_TOKENS = {"input": 5500, "output": 400, "cacheRead": 3000, "cache5m": 500, "cache1h": 0,
                     "reasoning": 150}
COMPACT_LIMIT = 5000
SIGNED_OUT = "signin"
SIGNED_IN = "ready"
API_KEY = "sk-orc-compat-fixture"
FIXTURE_SETTINGS = ('model_provider="fixture"', 'model="fixture"', 'model_providers.fixture.name="fixture"',
                    'model_providers.fixture.base_url="%s/v1"', 'model_providers.fixture.wire_api="responses"',
                    "model_providers.fixture.request_max_retries=0",
                    "model_providers.fixture.stream_max_retries=0",
                    "check_for_update_on_startup=false", "analytics.enabled=false")


def codex_flags(server):
    flags = []
    for setting in FIXTURE_SETTINGS:
        flags += ["-c", setting.replace("%s", server.url)]
    return flags


def probe(binary):
    """Every step below against one sandboxed ``CODEX_HOME``, plus the
    app-server methods Orc calls checked against the schema Codex generates."""
    with session(binary) as s:
        must_start(binary, s.env)
        failures = flag_failures(binary, ("exec",), s.argv(), s.env)
        failures += flag_failures(binary, ("exec", "resume"), s.argv("00000000-0000-0000-0000-000000000000"), s.env)
        failures += app_server_failures(binary, s.root, s.env)
        for step in STEPS:
            failures += step(s)
            s.reset()
        return failures + server_errors(s.server)


# ---------- the sandbox ----------

class Session:
    """One sandboxed Codex: a scripted model, a ``CODEX_HOME`` short enough
    for its control socket's path, and the app server once a step starts it."""

    def __init__(self, binary, root, home, server):
        self.binary, self.root, self.home, self.server = binary, root, home, server
        self.work = root / "work"
        self.env = {**base_env(root), "CODEX_HOME": str(home)}
        self.flags = codex_flags(server)
        self.socket = home / CONTROL_SOCKET
        self.daemon = None
        self.runs = []

    def argv(self, thread=None, extra=()):
        return headless_session.turn_argv("codex", session_id=thread, resume=thread is not None, cwd=str(self.work),
                                          extra_args=[*self.flags, *extra], binary=self.binary)

    def run_dir(self):
        folder = self.root / ("run-%d" % len(self.runs))
        folder.mkdir()
        self.runs.append(folder)
        return folder

    def turn(self, run_dir, prompt, thread=None, extra=()):
        return run_turn(run_dir, "codex", self.argv(thread, extra), prompt, self.work, self.env)

    def bodies(self, count, timeout=5):
        """Up to ``count`` model requests, waiting at most ``timeout`` in all."""
        found, deadline = [], time.monotonic() + timeout
        while len(found) < count:
            try:
                found.append(self.server.take(timeout=max(0.01, deadline - time.monotonic()))[1])
            except queue.Empty:
                break
        return found

    def reset(self):
        for waiting in (self.server.script, self.server.requests):
            with contextlib.suppress(queue.Empty):
                while True:
                    waiting.get_nowait()
        self.server.failing = False
        self.server.answer = None

    def app_server(self):
        """None once ``codex app-server`` listens on the control socket Orc
        connects to, else why not."""
        if self.daemon is None:
            self.daemon = subprocess.Popen([self.binary, "app-server", *self.flags, "--listen", "unix://"],
                                           env=self.env, cwd=str(self.work), stdin=subprocess.DEVNULL,
                                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                           start_new_session=True)
            (self.home / DAEMON_PID).write_text(str(self.daemon.pid))
            deadline = time.monotonic() + COMMAND_SECONDS
            while not self.socket.exists() and self.daemon.poll() is None and time.monotonic() < deadline:
                time.sleep(0.02)
        if self.socket.exists():
            return None
        return ("`codex app-server --listen unix://` did not open %s in CODEX_HOME, where Orc's thread status, "
                "steering, question replies and model list connect" % CONTROL_SOCKET)

    def call(self, method, params):
        with codex_rpc.Client(self.socket) as client:
            try:
                return client.call(method, params)
            except codex_rpc.RpcRejected as error:
                raise codex_rpc.RpcRejected("%s: %s" % (method, error)) from error

    def orc(self, home=None, **calls):
        """``{name: result}`` from Orc readers run in a child Python with this
        sandbox's environment; ``calls`` maps a name to ``[reader, *args]``
        from ``_ORC_READERS``. A reader that raises gives ``{"crash": ...}``."""
        env = {**self.env, "PYTHONDONTWRITEBYTECODE": "1",
               "PATH": os.pathsep.join([str(Path(self.binary).parent), self.env["PATH"]])}
        if home is not None:
            env["CODEX_HOME"] = str(home)
        try:
            done = subprocess.run([sys.executable, "-c", _ORC_READERS, str(ORC_ROOT / "ui"),
                                   json.dumps(calls)],
                                  env=env, cwd=str(self.work), capture_output=True, text=True,
                                  timeout=COMMAND_SECONDS, stdin=subprocess.DEVNULL)
            lines = done.stdout.strip().splitlines()
            return json.loads(lines[-1]) if done.returncode == 0 and lines else {
                name: {"crash": done.stderr.strip()[-400:] or "exit %d" % done.returncode} for name in calls}
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            return {name: {"crash": str(error)} for name in calls}

    def close(self):
        for folder in self.runs:
            with contextlib.suppress(Exception):
                headless_session.interrupt(str(folder), wait=0.2)
        if self.daemon is not None:
            _stop(self.daemon)


_ORC_READERS = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
results = {}
for name, (reader, *args) in json.loads(sys.argv[2]).items():
    try:
        if reader == "children":
            import run_subagents
            results[name] = run_subagents.codex_children(*args)
        elif reader == "transcripts":
            import codex_cost
            results[name] = codex_cost.transcripts(*args)
        elif reader == "account":
            import agent_accounts
            results[name] = agent_accounts.probe_codex(which=lambda _: args[0])
        elif reader == "models":
            import model_catalog
            results[name] = model_catalog._codex()
        elif reader == "skills":
            import chat_skills
            results[name] = chat_skills.catalog({"harness": "codex", "repoPath": args[0]})
        elif reader == "launch_args":
            import codex_rpc
            results[name] = codex_rpc.launch_args()
    except Exception as error:
        results[name] = {"crash": "%s: %s" % (type(error).__name__, error)}
sys.stdout.write("\n" + json.dumps(results) + "\n")
"""


@contextlib.contextmanager
def session(binary):
    with contextlib.ExitStack() as stack:
        root = stack.enter_context(sandbox(SANDBOX_PREFIX % "codex"))
        # macOS caps a Unix socket path at 104 bytes, which a TMPDIR home passes.
        short = "/tmp" if os.path.isdir("/tmp") else None
        home = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix=SHORT_HOME_PREFIX, dir=short))).resolve()
        server = stack.enter_context(ModelServer())
        s = Session(binary, root, home, server)
        stack.callback(s.close)
        yield s


def _stop(process):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        with contextlib.suppress(OSError):
            os.killpg(process.pid, sig)
        try:
            process.wait(timeout=2)
            return
        except subprocess.TimeoutExpired:
            continue


class _Terminal:
    """A command on a pseudo-terminal, for Codex's interactive TUI."""

    def __init__(self, argv, env, cwd):
        self.master, follower = pty.openpty()
        fcntl.ioctl(follower, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        try:
            self.process = subprocess.Popen(argv, env=env, cwd=cwd, stdin=follower, stdout=follower,
                                            stderr=follower, start_new_session=True)
        finally:
            os.close(follower)
        self.done = threading.Event()
        self.reader = threading.Thread(target=self._drain, daemon=True)
        self.reader.start()

    def _drain(self):
        while not self.done.is_set():
            if not select.select([self.master], [], [], 0.05)[0]:
                continue
            try:
                chunk = os.read(self.master, 65536)
            except OSError:
                return
            if not chunk:
                return

    def close(self):
        self.done.set()
        _stop(self.process)
        self.reader.join(timeout=1)
        os.close(self.master)


def _response(items, usage=None, name="compat"):
    """A scripted Responses stream that returns ``items``."""
    usage = usage or {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}
    return ("events", [*((None, {"type": "response.output_item.done", "output_index": index, "item": item})
                         for index, item in enumerate(items)),
                       (None, {"type": "response.completed", "response": {
                           "id": "resp_" + name, "status": "completed", "output": items, "usage": usage}})])


def _message(text, name="compat"):
    return {"id": "msg_" + name, "type": "message", "role": "assistant", "status": "completed",
            "content": [{"type": "output_text", "text": text, "annotations": []}]}


def _texts(body):
    return "\n".join(part["text"] for item in body.get("input") or [] if isinstance(item, dict)
                     for part in item.get("content") or [] if isinstance(part, dict)
                     and isinstance(part.get("text"), str))


def _crash(value):
    return value.get("crash") if isinstance(value, dict) else None


def _rollout(s, run_dir, first_turn=1):
    thread = headless_session.codex_thread_id(str(run_dir), first_turn=first_turn)
    return thread, codex_questions._rollout(s.home, thread) if thread else None


def _finished(run_dir):
    deadline = time.monotonic() + TURN_SECONDS
    while time.monotonic() < deadline:
        state = headless_session.turn_state(str(run_dir))
        if state and state["state"] == "idle" and state["exitCode"] is not None:
            return state
        time.sleep(0.05)
    headless_session.interrupt(str(run_dir), wait=0.5)
    return {"outcome": "timeout", "error": "the turn did not finish in %d seconds" % TURN_SECONDS}


# ---------- headless turns ----------

def tool_and_resume_failures(s):
    """A shell tool call and a resumed turn through ``codex exec``, read back
    from the rollout and the SQLite index."""
    run_dir = s.run_dir()
    s.server.script.put(("tool", "exec_command", {"cmd": "printf " + TOOL_OUTPUT}))
    s.server.script.put(("text", "Tool finished."))
    failed = turn_failure("A Codex turn", s.turn(run_dir, "Run it."))
    if failed:
        return [failed]
    s.server.take()
    _, second = s.server.take()
    failures = []
    if TOOL_OUTPUT not in json.dumps(second.get("input")):
        failures.append("Codex did not send the command's output back to the model")
    thread = headless_session.codex_thread_id(str(run_dir))
    if thread is None:
        return failures + ["Codex's --json output no longer starts with a thread.started event"]
    failures += sqlite_failures(s.home)
    rollout = codex_questions._rollout(s.home, thread)
    if rollout is None:
        return failures + ["Codex's SQLite index has no rollout_path for the new thread"]
    items, _ = read_items("codex", rollout)
    failures += item_failures("Codex", items, "Tool finished.")
    s.server.script.put(("text", "Resumed."))
    failed = turn_failure("A resumed Codex turn", s.turn(run_dir, "Again.", thread))
    if failed:
        return failures + [failed]
    _, resumed = s.server.take()
    if "Tool finished." not in json.dumps(resumed.get("input")) or "Again." not in _texts(resumed):
        failures.append("A resumed Codex turn did not carry the earlier conversation and the new prompt")
    if headless_session.codex_thread_id(str(run_dir), first_turn=2) != thread:
        failures.append("A resumed Codex turn reported a different thread")
    items, _ = read_items("codex", rollout)
    if not any(item["kind"] == "assistant" and item.get("text") == "Resumed." for item in items):
        failures.append("Orc's chat reader found no reply from the resumed turn in the Codex rollout")
    return failures


def failed_tool_failures(s):
    run_dir = s.run_dir()
    s.server.script.put(("tool", "exec_command", {"cmd": "exit %d" % FAILED_EXIT}))
    s.server.script.put(("text", "Command failed."))
    failed = turn_failure("A Codex turn with a failing command", s.turn(run_dir, "Fail it."))
    if failed:
        return [failed]
    s.server.take()
    _, second = s.server.take()
    outputs = [item for item in second.get("input") or [] if item.get("type") == "function_call_output"]
    failures = []
    if "code %d" % FAILED_EXIT not in json.dumps(outputs):
        failures.append("Codex did not tell the model that a command exited with code %d, so an agent in an "
                        "Orc run cannot see its command failed" % FAILED_EXIT)
    _, rollout = _rollout(s, run_dir)
    items, _ = read_items("codex", rollout) if rollout else ([], None)
    if not any(item["kind"] == "tool" and item.get("status") == "error" and item.get("exitCode") == FAILED_EXIT
               for item in items):
        failures.append("Orc's chat reader did not show a Codex command that exited with code %d as failed"
                        % FAILED_EXIT)
    return failures


def provider_failure_failures(s):
    run_dir = s.run_dir()
    s.server.script.put("fail")
    state = s.turn(run_dir, "Fail.")
    if state.get("outcome") != "failed" or not state.get("exitCode"):
        return ["A Codex turn whose model request failed ended %s with exit code %s rather than failing, so Orc "
                "would show a failed run as finished" % (state.get("outcome"), state.get("exitCode"))]
    if PROVIDER_FAILURE not in (state.get("error") or ""):
        return ["Orc found no model error in a failed Codex turn's output, so the run would show no reason: %s"
                % (state.get("error") or "no error")]
    return []


def interrupt_failures(s):
    run_dir = s.run_dir()
    s.server.script.put("hold")
    headless_session.start_turn(str(run_dir), agent="codex", argv=s.argv(), prompt="Wait.", cwd=str(s.work),
                                env=s.env)
    if not s.bodies(1, timeout=TURN_SECONDS / 2):
        _finished(run_dir)
        return ["A Codex turn never asked the model for a reply, so interrupting it went untested"]
    stopped = headless_session.interrupt(str(run_dir), wait=0.5)
    state = _finished(run_dir)
    if stopped != "stopped" or state.get("outcome") != "interrupted":
        return ["Interrupting a Codex turn mid-request gave %s and ended it %s rather than interrupted, so "
                "Orc's Stop would not stop a run cleanly" % (stopped, state.get("outcome"))]
    _, rollout = _rollout(s, run_dir)
    items, _ = read_items("codex", rollout) if rollout else ([], None)
    if not any(item["kind"] == "interrupt" for item in items):
        return ["Codex no longer records an interrupted turn in its rollout, so Orc's chat shows a stopped Codex "
                "turn as still running"]
    return []


# ---------- subagents ----------

def _spawned(body):
    """The id of the child thread Codex says the spawn call started, in the
    request that carries the call's output back to the model."""
    for item in body.get("input") or []:
        if item.get("type") == "function_call_output" and item.get("call_id") == "call_spawn":
            with contextlib.suppress(ValueError, TypeError, AttributeError):
                child = json.loads(item.get("output")).get("agent_id")
                return child if isinstance(child, str) else None
    return None


def subagent_failures(s):
    """A child thread the model spawns, found the way Orc's subagent and cost
    readers find it: a thread_spawn_edges row and the child's own rollout."""
    run_dir = s.run_dir()
    namespace, name = SPAWN_TOOL
    call = {"id": "fc_spawn", "type": "function_call", "call_id": "call_spawn", "namespace": namespace,
            "name": name, "arguments": json.dumps({"message": "Reply done."})}
    child_asked = threading.Event()

    def answer(body):
        if "Spawn a helper." not in _texts(body):
            child_asked.set()
            return ("text", "Child finished.")
        if not any(item.get("call_id") == "call_spawn" for item in body.get("input") or []):
            return _response([call], name="spawn")
        if _spawned(body):
            # Codex exits when the parent's turn ends, and a child that has
            # not asked the model by then never does.
            child_asked.wait(CHILD_SECONDS)
        return ("text", "Spawned.")

    s.server.answer = answer
    failed = turn_failure("A Codex turn that spawns a subagent", s.turn(run_dir, "Spawn a helper."))
    if failed:
        return [failed]
    bodies = s.bodies(3, timeout=1)
    child = next(filter(None, map(_spawned, bodies)), None)
    if not child:
        return ["Codex no longer spawns a child thread from the model's %s.%s call, so a Codex run's "
                "subagents never start" % SPAWN_TOOL]
    failures = []
    if len(bodies) < 3:
        failures.append("Codex's spawned child thread never asked the model for a reply")
    parent, rollout = _rollout(s, run_dir)
    items, _ = read_items("codex", rollout) if rollout else ([], None)
    if not any(item["kind"] == "tool" and item.get("name") == "agent" for item in items):
        failures.append("Orc's chat reader shows no subagent step in the Codex rollout that spawned one")
    reads = s.orc(children=["children", parent], sources=["transcripts", parent])
    for value in reads.values():
        if _crash(value):
            return failures + ["Orc's subagent reader stopped: " + _crash(value)]
    if child not in dict(reads["children"]):
        failures.append("Orc's subagent reader found no thread_spawn_edges row and rollout for the child thread "
                        "Codex spawned, so the run's Factory view leaves it out")
    elif child not in reads["sources"]:
        failures.append("Orc's cost reader could not read the spawned child thread's rollout, so the run's cost "
                        "leaves the subagent out")
    return failures


# ---------- transcript shapes ----------

def transcript_failures(s):
    """A reasoning summary and cached, cache-write and reasoning tokens in one
    reply, then an automatic compaction on the next turn."""
    run_dir = s.run_dir()
    reasoning = {"id": "rs_compat", "type": "reasoning", "encrypted_content": None,
                 "summary": [{"type": "summary_text", "text": REASONING}]}
    s.server.script.put(_response([reasoning, _message("Reasoned.")], CODEX_USAGE))
    failed = turn_failure("A Codex turn with reasoning", s.turn(run_dir, "Think."))
    if failed:
        return [failed]
    thread, rollout = _rollout(s, run_dir)
    if rollout is None:
        return ["Codex's SQLite index has no rollout_path for a thread with reasoning"]
    failures = []
    items, _ = read_items("codex", rollout)
    if not any(item["kind"] == "thinking" and item.get("text") == REASONING for item in items):
        failures.append("Orc's chat reader shows no thinking step for a Codex reasoning summary")
    counted = codex_cost.token_totals({thread: str(rollout)}).get("fixture")
    if counted != CODEX_COST_TOKENS:
        failures.append("Orc's cost reader counted %s from Codex's token_count records where %s was expected, so "
                        "Codex run costs would be wrong" % (counted, CODEX_COST_TOKENS))
    s.server.script.put(("text", "Summary of the work so far."))
    s.server.script.put(("text", "Compacted."))
    failed = turn_failure("A Codex turn that compacts the conversation", s.turn(
        run_dir, "Continue.", thread, ["-c", "model_auto_compact_token_limit=%d" % COMPACT_LIMIT]))
    if failed:
        return failures + [failed]
    if not s.server.script.empty():
        return failures + ["Codex no longer compacts a conversation past model_auto_compact_token_limit, so "
                           "Orc's compaction notice went untested"]
    items, _ = read_items("codex", rollout)
    if not any(item["kind"] == "compaction" for item in items):
        written = {record.get("payload", {}).get("item", {}).get("type") for record in _records(rollout)
                   if record.get("payload", {}).get("type") == "item_completed"}
        shape = " (it wrote a ContextCompaction item instead)" if "ContextCompaction" in written else ""
        failures.append("Codex no longer records a context_compacted event when it compacts a conversation%s, "
                        "so Orc's chat shows no \"Conversation compacted\" notice" % shape)
    return failures


def _records(path):
    records = []
    with contextlib.suppress(OSError):
        for line in Path(path).read_text().splitlines():
            with contextlib.suppress(ValueError):
                record = json.loads(line)
                if isinstance(record, dict) and isinstance(record.get("payload"), dict):
                    records.append(record)
    return records


# ---------- side commands ----------

def side_command_failures(s):
    """``codex login status`` signed out and with an API key, model discovery
    over stdio, and any extra plugin steps, each read the way Orc reads it."""
    login = s.root / "login"
    login.mkdir()
    (login / "config.toml").write_text(_fixture_toml(s.server))
    failures = []
    reads = s.orc(home=login, account=["account", s.binary], models=["models"])
    row = reads["account"]
    if _crash(row):
        failures.append("Orc's Codex sign-in check stopped: " + _crash(row))
    elif row.get("state") != SIGNED_OUT:
        failures.append("`codex login status` with no sign-in no longer says it is not logged in, so Orc's Accounts "
                        "settings show %s (%s) instead of a sign-in button" % (row.get("state"), row.get("detail")))
    failures += _model_failures(reads["models"], "over stdio")
    try:
        subprocess.run([s.binary, "login", "--with-api-key"], input=API_KEY, env={**s.env, "CODEX_HOME": str(login)},
                       capture_output=True, text=True, timeout=COMMAND_SECONDS, check=True)
    except (OSError, subprocess.SubprocessError) as error:
        failures.append("`codex login --with-api-key` failed, so the signed-in check went untested: %s" % error)
    else:
        row = s.orc(home=login, account=["account", s.binary])["account"]
        if _crash(row):
            failures.append("Orc's Codex sign-in check stopped: " + _crash(row))
        elif row.get("state") != SIGNED_IN:
            failures.append("`codex login status` with an API key saved printed %r, which Orc's Accounts settings "
                            "read as %s rather than signed in" % (_login_status(s, login), row.get("state")))
    return failures


def _login_status(s, home):
    with contextlib.suppress(OSError, subprocess.SubprocessError):
        done = subprocess.run([s.binary, "login", "status"], env={**s.env, "CODEX_HOME": str(home)},
                              capture_output=True, text=True, timeout=COMMAND_SECONDS, stdin=subprocess.DEVNULL)
        return next((line.strip() for line in (done.stdout + "\n" + done.stderr).splitlines()
                     if line.strip() and not line.startswith("WARNING:")), "")
    return None


def _fixture_toml(server):
    """codex_flags as config.toml, for the app server Orc starts over stdio
    with no flags."""
    top, provider = [], []
    for setting in FIXTURE_SETTINGS:
        key, value = setting.replace("%s", server.url).split("=", 1)
        if key.startswith("model_providers.fixture."):
            provider.append("%s = %s" % (key.split(".", 2)[2], value))
        else:
            top.append("%s = %s" % (key, value))
    return "\n".join([*top, "[model_providers.fixture]", *provider]) + "\n"


def _model_failures(models, how):
    if _crash(models):
        return ["Orc's Codex model discovery stopped: " + _crash(models)]
    if not models or any(not isinstance(row.get("id"), str) or not isinstance(row.get("effortLevels"), list)
                         or not row["effortLevels"] for row in models):
        return ["Codex's model/list %s gave Orc's model picker no models with reasoning efforts: %s"
                % (how, json.dumps(models)[:300])]
    return []


# ---------- Orc's skill catalog and launch context ----------

def skill_launch_failures(s):
    """Orc's built-in skill catalog merged with ``skills/list`` (without an
    installed plugin), and one ``$orc:run`` launch turn wrapped by
    ``harness_context.launch_prompt`` and unwrapped by ``run_chat``."""
    failures = []
    failed = s.app_server()
    if failed:
        return [failed]
    skills = s.orc(skills=["skills", str(s.work)])["skills"]
    if _crash(skills) or "orc:run" not in {skill.get("name") for skill in skills.get("skills") or []}:
        failures.append("Orc's Codex skill catalog no longer lists orc:run alongside skills/list, so the Chat "
                        "composer's skill menu leaves it out: %s" % (_crash(skills) or skills.get("error") or "not listed"))
    run_dir = s.run_dir()
    brief = "compat"
    (run_dir / "inputs").mkdir(parents=True, exist_ok=True)
    (run_dir / "inputs" / "start-prompt.txt").write_text(brief + "\n")
    meta = {
        "runId": run_dir.name, "source": "prompt", "title": brief, "mainRepoPath": str(s.work),
        "repoPath": str(s.work), "mode": "quick", "phase": "build", "status": "running",
        "harness": "codex", "sessionBackend": "headless", "titlePending": True, "launchedBy": "orc-ui"}
    (run_dir / "meta.json").write_text(json.dumps(meta))
    entry = skill_commands.invocation("codex", "orc")
    arguments = "--launch-run %s --quoted-prompt %s" % (run_dir.name, shlex.quote(brief))
    prompt = harness_context.launch_prompt(meta, str(run_dir), entry, arguments, config_dir=str(s.root / ".orc"))
    s.server.script.put(("text", "Skill read."))
    failed = turn_failure("A $orc:run Codex launch turn", s.turn(run_dir, prompt))
    if failed:
        return failures + [failed]
    text = _texts(s.server.take()[1])
    if "[orc hook]" not in text or str(ORC_SKILL) not in text:
        failures.append("Codex did not send Orc's <orc-context> launch block naming %s to the model"
                        % ORC_SKILL.name)
    _, rollout = _rollout(s, run_dir)
    items, _ = read_items("codex", rollout) if rollout else ([], None)
    if not any(item["kind"] == "user" and item.get("command") == "$orc:run" and item.get("text") == brief
               for item in items):
        failures.append("Orc's chat reader did not strip <orc-context> and unwrap $orc:run in the Codex rollout")
    return failures


# ---------- the app server ----------

def app_server_session_failures(s):
    """A thread opened in the app server by ``codex --remote ... resume``,
    as a Codex terminal Orc launches opens it, then the calls Orc makes on the
    control socket with the params it sends, steering and interrupting a held
    turn, and model discovery through the socket."""
    run_dir = s.run_dir()
    s.server.script.put(("text", "Ready."))
    failed = turn_failure("A Codex turn", s.turn(run_dir, "Get ready."))
    thread = headless_session.codex_thread_id(str(run_dir))
    if failed or thread is None:
        return [failed or "Codex's --json output no longer starts with a thread.started event"]
    s.reset()
    failed = s.app_server()
    if failed:
        return [failed]
    if codex_rpc.thread_status(s.home, thread, for_completion=True) != "notLoaded":
        return ["Orc's thread status could not read a closed Codex thread through thread/read, so Orc cannot tell "
                "whether a Codex terminal is still running"]
    launch = s.orc(args=["launch_args"])["args"]
    if _crash(launch):
        return ["Orc's Codex launch arguments stopped: " + _crash(launch)]
    terminal = _Terminal([s.binary, *launch, "-c", "analytics.enabled=false", "resume", thread],
                         {**s.env, "TERM": "xterm-256color"}, str(s.work))
    try:
        return _remote_failures(s, thread) + _model_failures(s.orc(models=["models"])["models"], "on the control socket")
    finally:
        terminal.close()


def _remote_failures(s, thread):
    deadline = time.monotonic() + COMMAND_SECONDS / 2
    try:
        while thread not in (s.call("thread/loaded/list", {"limit": 256, "cursor": None}).get("data") or []):
            if time.monotonic() > deadline:
                return ["`codex --remote unix://... resume` did not open the thread in the running app server, so Orc "
                        "cannot steer, answer or stop a Codex terminal it launched"]
            time.sleep(0.05)
        if thread not in codex_rpc.loaded_threads(s.home):
            return ["Orc's loaded-thread reader did not parse Codex's thread/loaded/list reply"]
        read = s.call("thread/read", {"threadId": thread, "includeTurns": False}).get("thread", {})
        if read.get("id") != thread or read.get("canAcceptDirectInput") is not True:
            return ["Codex's thread/read no longer says an open thread canAcceptDirectInput, so Orc refuses to send "
                    "chat messages to a Codex terminal"]
        config = codex_rpc.scoped_thread_params(["-c", "check_for_update_on_startup=false"], str(s.work))["config"]
        resumed = s.call("thread/resume", {"threadId": thread, "excludeTurns": True, "config": config})
        if resumed.get("thread", {}).get("id") != thread:
            return ["Codex's thread/resume reply no longer names the thread, which Orc's scoped resume relies on"]
        return _turn_failures(s, thread)
    except codex_rpc.RpcTimeout as error:
        return ["A call Orc makes on Codex's control socket timed out: %s" % error]
    except codex_rpc.RpcRejected as error:
        return ["Codex's app server refused a call Orc makes on its control socket: %s" % error]
    except (OSError, codex_rpc.RpcError, ValueError, TypeError, AttributeError) as error:
        return ["A call Orc makes on Codex's control socket failed: %s" % error]


def _turn_failures(s, thread):
    s.server.script.put("hold")
    started = s.call("turn/start", {"threadId": thread, "input": [{"type": "text", "text": "Hold on."}]})
    turn = (started.get("turn") or {}).get("id")
    if not turn:
        return ["Codex's turn/start reply has no turn.id, so Orc reports a sent chat message as unacknowledged"]
    if not s.bodies(1):
        return ["A turn started over Codex's control socket never asked the model for a reply"]

    def active():
        turns = s.call("thread/turns/list", {"threadId": thread, "limit": 1, "itemsView": "summary"}).get("data")
        return next((item for item in turns or [] if item.get("status") == "inProgress"), None)

    if (active() or {}).get("id") != turn:
        return ["Codex's thread/turns/list no longer shows a running turn as inProgress, so Orc sends steering "
                "as a new turn and cannot interrupt it"]
    if codex_rpc.thread_status(s.home, thread, for_completion=True) != "active":
        return ["Orc's thread status did not read a Codex thread with a running turn as active"]
    steered = s.call("turn/steer", {"threadId": thread, "input": [{"type": "text", "text": "Steer."}],
                                    "expectedTurnId": turn})
    if steered.get("turnId") != turn:
        return ["Codex's turn/steer reply no longer names the steered turn, so Orc reports steering as "
                "unacknowledged"]
    s.call("turn/interrupt", {"threadId": thread, "turnId": turn})
    deadline = time.monotonic() + COMMAND_SECONDS / 3
    while active():
        if time.monotonic() > deadline:
            return ["Codex's turn/interrupt did not stop a running turn, so Orc's Stop leaves a Codex terminal working"]
        time.sleep(0.05)
    return []


# ---------- Codex's index and schema ----------

def sqlite_failures(home):
    databases = sorted(Path(home).glob("state_*.sqlite"), reverse=True)
    if not databases:
        return ["Codex wrote no state_*.sqlite index in CODEX_HOME"]
    try:
        with contextlib.closing(sqlite3.connect(databases[0].as_uri() + "?mode=ro", uri=True)) as db:
            failures = []
            for table, columns in CODEX_SQLITE_COLUMNS.items():
                found = {row[1] for row in db.execute("PRAGMA table_info(%s)" % table)}
                failures += ["Codex's %s has no %s.%s column" % (databases[0].name, table, column)
                             for column in columns if column not in found]
            return failures
    except sqlite3.Error as error:
        return ["Codex's %s could not be read: %s" % (databases[0].name, error)]


def schema_methods(schema):
    found = set()
    stack = [schema]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            method = (value.get("properties") or {}).get("method")
            if isinstance(method, dict):
                found.update(method.get("enum") or [])
                if isinstance(method.get("const"), str):
                    found.add(method["const"])
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    return found


def app_server_failures(binary, root, env):
    out = Path(root) / "app-server-schema"
    try:
        subprocess.run([binary, "app-server", "generate-json-schema", "--out", str(out)], env=env,
                       capture_output=True, timeout=COMMAND_SECONDS, check=True, stdin=subprocess.DEVNULL)
        requests = schema_methods(json.loads((out / "ClientRequest.json").read_text()))
        notifications = schema_methods(json.loads((out / "ClientNotification.json").read_text()))
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        return ["`codex app-server generate-json-schema` failed, so Orc's app-server calls are unchecked: %s"
                % error]
    return (["Codex's app server no longer has the %s method Orc calls" % method
             for method in CODEX_APP_SERVER_METHODS if method not in requests]
            + ["Codex's app server no longer accepts the %s notification Orc sends" % method
               for method in CODEX_APP_SERVER_NOTIFICATIONS if method not in notifications])


STEPS = (tool_and_resume_failures, failed_tool_failures, provider_failure_failures, interrupt_failures,
         subagent_failures, transcript_failures, side_command_failures, skill_launch_failures,
         app_server_session_failures)
