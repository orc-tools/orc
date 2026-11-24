"""The Claude Code compatibility probe: what a headless Orc run asks of a real
``claude``, driven against ``harness_compat.ModelServer`` and read back through
Orc's own readers. ``harness_compat.clis`` registers it."""
import contextlib
import json
import queue
import shlex
import subprocess
import time
import uuid
from pathlib import Path

import agent_accounts
import devd_launch
import harness_context
import headless_session
import model_catalog
import provider_usage
import run_chat
import run_subagents
import skill_commands
from harness_compat import (COMMAND_SECONDS, FIXTURE_MODEL, SANDBOX_PREFIX, TOOL_OUTPUT, ModelServer,
                            base_env, flag_failures, item_failures, must_start, read_items, run_turn,
                            sandbox, server_errors, turn_failure)

LABEL = "Claude Code"
PACKAGE = "@anthropic-ai/claude-code"
ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = (ROOT / "skills").resolve()
ORC_SKILL = SKILLS_DIR / "orc" / "SKILL.md"
# A reply's usage as the Messages API streams it, and what Orc should price from it.
USAGE = {"input_tokens": 11, "output_tokens": 1, "cache_read_input_tokens": 13, "cache_creation_input_tokens": 12,
         "cache_creation": {"ephemeral_5m_input_tokens": 5, "ephemeral_1h_input_tokens": 7}}
OUTPUT_TOKENS = 17
EXPECTED_TOKENS = {"input": 11, "output": 17, "cacheRead": 13, "cache5m": 5, "cache1h": 7}
THINKING = "Compat thinking."
STEER = "Compat steer note."
# How long Claude Code may take to stop on Orc's SIGINT before Orc escalates.
INTERRUPT_SECONDS = 3.0


class Claude:
    """One sandboxed Claude Code: its config folder, its environment and the
    scripted model it talks to."""

    def __init__(self, binary, root, server):
        self.binary, self.root, self.server = binary, root, server
        self.config = root / "claude"
        self.work, self.run_dir = root / "work", root / "run"
        for folder in (self.config, root / ".orc", root / "bin"):
            folder.mkdir(exist_ok=True)
        env = base_env(root)
        env["PATH"] = "%s:%s" % (root / "bin", env["PATH"])
        self.env = headless_session.child_env(env, {
            "CLAUDE_CONFIG_DIR": str(self.config), "ANTHROPIC_BASE_URL": server.url,
            "ANTHROPIC_API_KEY": "sk-ant-orc-compat-fixture", "CLAUDE_CODE_TMPDIR": str(root),
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "DISABLE_AUTOUPDATER": "1"})

    def argv(self, session, resume=False, run_dir=None, extra=()):
        return headless_session.turn_argv(
            "claude", session_id=session, resume=resume, cwd=str(self.work), binary=self.binary,
            claude_config_dir=str(self.config), run_dir=run_dir, extra_args=["--model", FIXTURE_MODEL, *extra])

    def sandboxed(self, argv):
        """``argv`` with the --add-dir folders turn_argv finds in the real home
        swapped for the sandbox's, while keeping Orc's skill library."""
        out, index, swapped = [], 0, False
        while index < len(argv):
            if argv[index] == "--add-dir" and index + 1 < len(argv):
                path = argv[index + 1]
                resolved = Path(path).resolve()
                if resolved.is_relative_to(self.root) or resolved == SKILLS_DIR:
                    out += ["--add-dir", path]
                elif not swapped:
                    out += ["--add-dir", str(self.root / ".orc")]
                    swapped = True
                index += 2
                continue
            out.append(argv[index])
            index += 1
        return out

    def turn(self, argv, prompt, *replies, run_dir=None, env=None):
        """Run one turn against ``replies`` and return its state and the
        model requests it made."""
        self.reset()
        for reply in replies:
            self.server.script.put(reply)
        state = run_turn(run_dir or self.run_dir, "claude", self.sandboxed(argv), prompt, self.work, env or self.env)
        return state, self.requests()

    def requests(self):
        bodies = []
        while True:
            try:
                bodies.append(self.server.take(timeout=0.2)[1])
            except queue.Empty:
                return bodies

    def reset(self):
        with self.server.script.mutex:
            self.server.script.queue.clear()
        self.server.failing = False
        self.requests()

    def transcript(self, session):
        found = sorted(self.config.glob("projects/*/%s.jsonl" % session))
        return found[0] if found else None

    def run(self, *args):
        return subprocess.run([self.binary, *args], env=self.env, capture_output=True, text=True,
                              timeout=COMMAND_SECONDS, stdin=subprocess.DEVNULL)


@contextlib.contextmanager
def session(binary):
    with sandbox(SANDBOX_PREFIX % "claude") as root, ModelServer() as server:
        yield Claude(binary, root, server)


def probe(binary):
    """What a headless Orc run asks of a real Claude Code, each step read back
    through the Orc reader that depends on it."""
    with session(binary) as claude:
        must_start(binary, claude.env)
        argv = [*claude.argv("flags"), *claude.argv("flags", resume=True),
                *claude.argv("flags", run_dir=claude.run_dir), *model_catalog.CLAUDE_CATALOG_ARGS]
        failures = flag_failures(binary, (), argv, claude.env)
        failures += flag_failures(binary, ("auth", "status"), ["--json"], claude.env)
        conversation, finished = conversation_failures(claude)
        failures += conversation
        if finished:
            for step in (thinking_failures, steer_failures, subagent_failures, failed_tool_failures,
                         interrupt_failures, run_mcp_failures, launch_failures):
                failures += step(claude)
        for step in (auth_failures, catalog_failures):
            failures += step(claude)
        return failures + server_errors(claude.server)


def conversation_failures(claude):
    """A Read tool call, a resumed turn, the get_usage request and a failed
    model request: (failures, whether the turns after them are worth running)."""
    session_id = str(uuid.uuid4())
    work = claude.work
    state, requests = claude.turn(claude.argv(session_id), "Read compat.txt.",
                                  ("tool", "Read", {"file_path": str(work / "compat.txt")}), ("text", "Compat reply."))
    failed = turn_failure("A Claude turn", state)
    if failed:
        return [failed], False
    failures = []
    if len(requests) < 2 or TOOL_OUTPUT not in json.dumps(requests[1].get("messages")):
        failures.append("Claude Code did not send the Read tool's output back to the model")
    transcript = claude.transcript(session_id)
    if transcript is None:
        return failures + ["Claude Code wrote no transcript at projects/<folder>/<session>.jsonl"], False
    items, _ = read_items("claude", transcript)
    failures += item_failures("Claude", items, "Compat reply.")
    state, requests = claude.turn(claude.argv(session_id, resume=True), "Again.", ("text", "Resumed."))
    failed = turn_failure("A resumed Claude turn", state)
    if failed:
        return failures + [failed], True
    if not requests or "Compat reply." not in json.dumps(requests[0].get("messages")):
        failures.append("A resumed Claude turn did not carry the earlier conversation")
    items, _ = read_items("claude", transcript)
    if not any(item["kind"] == "assistant" and item.get("text") == "Resumed." for item in items):
        failures.append("A resumed Claude turn did not append to the same transcript")
    failures += claude_usage_failures(claude.binary, claude.env, work)
    state, _ = claude.turn(claude.argv(session_id, resume=True), "Fail.", "fail")
    if state.get("outcome") != "failed" or "scripted compatibility failure" not in (state.get("error") or ""):
        failures.append("A failed Claude model request read as %s (%s), not as a failure naming the error"
                        % (state.get("outcome"), state.get("error")))
    return failures, True


def claude_usage_failures(binary, env, cwd):
    """The usage panel's get_usage control request, which an API-key sign-in
    answers with no limits but with the same fields."""
    try:
        data = provider_usage._read_protocol([binary, *provider_usage.CLAUDE_USAGE_ARGS], "claude", env, str(cwd))
    except Exception as error:  # noqa: BLE001 - any failure is the finding
        return ["Claude Code no longer answers the get_usage request Orc's usage panel sends: %s" % error]
    missing = [key for key in ("rate_limits_available", "rate_limits") if key not in data]
    return ["Claude Code's get_usage reply no longer has %s" % ", ".join(missing)] if missing else []


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _carries(request, text):
    return any(text in part for part in _strings(request.get("messages")))


def _tool_results(request):
    return [block for message in request.get("messages") or [] if isinstance(message.get("content"), list)
            for block in message["content"] if isinstance(block, dict) and block.get("type") == "tool_result"]


def _thinking_events(model):
    message = {"id": "msg_compat_thinking", "type": "message", "role": "assistant", "model": model, "content": [],
               "stop_reason": None, "stop_sequence": None, "usage": USAGE}
    blocks = ((0, {"type": "thinking", "thinking": "", "signature": ""},
               [{"type": "thinking_delta", "thinking": THINKING},
                {"type": "signature_delta", "signature": "Y29tcGF0"}]),
              (1, {"type": "text", "text": ""}, [{"type": "text_delta", "text": "Thought reply."}]))
    events = [("message_start", {"type": "message_start", "message": message})]
    for index, start, deltas in blocks:
        events.append(("content_block_start",
                       {"type": "content_block_start", "index": index, "content_block": start}))
        events += [("content_block_delta", {"type": "content_block_delta", "index": index, "delta": delta})
                   for delta in deltas]
        events.append(("content_block_stop", {"type": "content_block_stop", "index": index}))
    delta = {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None},
             "usage": {"output_tokens": OUTPUT_TOKENS}}
    return events + [("message_delta", delta), ("message_stop", {"type": "message_stop"})]


def thinking_failures(claude):
    """A reply with a thinking block and cache usage, read back by the chat
    and the cost estimate."""
    session_id = str(uuid.uuid4())
    state, _ = claude.turn(claude.argv(session_id), "Think.", ("events", _thinking_events(FIXTURE_MODEL)))
    failed = turn_failure("A Claude turn with a thinking block", state)
    if failed:
        return [failed]
    transcript = claude.transcript(session_id)
    if transcript is None:
        return ["Claude Code wrote no transcript for a turn with a thinking block"]
    items, reader = read_items("claude", transcript)
    failures = []
    if not any(item["kind"] == "thinking" and item.get("text") == THINKING for item in items):
        failures.append("Orc's chat reader found no thinking block in the Claude transcript")
    priced = [entry["tokens"] for _, entry in reader.summary.calls_billed()]
    if priced != [EXPECTED_TOKENS]:
        failures.append("Claude Code no longer records the token usage Orc prices a run from: Orc read %s for %s"
                        % (priced, EXPECTED_TOKENS))
    return failures


def steer_failures(claude):
    """A Chat message queued mid-turn, handed over by the PostToolUse hook
    turn_argv adds for a run (bin/orc-chat-steer)."""
    session_id = str(uuid.uuid4())
    queue = claude.run_dir / "follow-ups.json"
    queue.write_text(json.dumps({"items": [{"id": "compatsteer", "text": STEER, "queuedAt": "2026-01-01T00:00:00Z",
                                            "source": "chat", "steer": True}]}))
    state, requests = claude.turn(claude.argv(session_id, run_dir=claude.run_dir), "Read compat.txt.",
                                  ("tool", "Read", {"file_path": str(claude.work / "compat.txt")}),
                                  ("text", "Steered."))
    left = queue.exists()
    with contextlib.suppress(OSError):
        queue.unlink()
    failed = turn_failure("A Claude turn with Orc's steer hook", state)
    if failed:
        return [failed]
    if left:
        return ["Claude Code did not run the PostToolUse hook Orc passes with --settings, so a Chat message "
                "sent mid-turn waits for the turn to end"]
    failures = []
    if len(requests) < 2 or not any(STEER in part for part in _strings(_tool_results(requests[1]))):
        failures.append("Claude Code no longer hands the model a PostToolUse hook's additional context, "
                        "which is how Orc delivers a Chat message sent mid-turn")
    transcript = claude.transcript(session_id)
    items, _ = read_items("claude", transcript) if transcript else ([], None)
    if not any(item["kind"] == "user" and item.get("steer") and item.get("text") == STEER for item in items):
        failures.append("Orc's chat reader found no steered Chat message in the Claude transcript")
    return failures


def subagent_failures(claude):
    """An Agent tool call whose subagent runs against the scripted model, read
    back by the crew view (run_subagents)."""
    session_id = str(uuid.uuid4())
    call = {"description": "Compat helper", "prompt": "Say hi.", "subagent_type": "general-purpose"}
    # The subagent, the parent's next step and its reply to the subagent's
    # notification ask in whichever order they run, so each gets plain text.
    state, _ = claude.turn(claude.argv(session_id), "Use a helper.", ("tool", "Agent", call),
                           *[("text", "Compat helper done.")] * 4)
    failed = turn_failure("A Claude turn that starts a subagent", state)
    if failed:
        return [failed]
    transcript = claude.transcript(session_id)
    if transcript is None:
        return ["Claude Code wrote no transcript for a turn that starts a subagent"]
    if not list((transcript.parent / transcript.stem / "subagents").glob("agent-*.jsonl")):
        return ["Claude Code no longer writes a subagent's transcript at <session>/subagents/agent-<id>.jsonl, "
                "which Orc's crew view reads"]
    _, reader = read_items("claude", transcript)
    rows = run_subagents.snapshot("claude", transcript, reader.summary,
                                  lambda harness, path: run_chat.Reader(harness, path, summary_only=True),
                                  None, False)
    row = next((row for row in rows if row.get("name") == call["description"]), None)
    if row is None or not row.get("updatedAt"):
        return ["Orc's subagent reader (run_subagents) no longer matches a Claude subagent's transcript to "
                "the Agent call that started it"]
    if row.get("status") != "done":
        return ["Orc's subagent reader shows a finished Claude subagent as %s, not done" % row.get("status")]
    return []


def failed_tool_failures(claude):
    """A tool call that fails, which the model must hear about as an error."""
    session_id = str(uuid.uuid4())
    state, requests = claude.turn(claude.argv(session_id), "Read missing.txt.",
                                  ("tool", "Read", {"file_path": str(claude.work / "missing.txt")}),
                                  ("text", "Read failed."))
    failed = turn_failure("A Claude turn with a failing tool call", state)
    if failed:
        return [failed]
    failures = []
    if len(requests) < 2 or not any(block.get("is_error") for block in _tool_results(requests[1])):
        failures.append("Claude Code no longer reports a failed tool call back to the model as an error")
    transcript = claude.transcript(session_id)
    items, _ = read_items("claude", transcript) if transcript else ([], None)
    if not any(item["kind"] == "tool" and item.get("status") == "error" for item in items):
        failures.append("Orc's chat reader no longer shows a failed Claude tool call as failed")
    return failures


def interrupt_failures(claude):
    """Stop pressed while a model request is in flight, then the turn
    resumed, then the conversation compacted."""
    session_id = str(uuid.uuid4())
    claude.reset()
    claude.server.script.put("hold")
    headless_session.start_turn(str(claude.run_dir), agent="claude", argv=claude.sandboxed(claude.argv(session_id)),
                                prompt="Hold on.", cwd=str(claude.work), env=claude.env)
    try:
        claude.server.take(timeout=COMMAND_SECONDS)
    except queue.Empty:
        headless_session.interrupt(str(claude.run_dir), wait=0.2)
        return ["A Claude turn never sent its model request, so the interrupt could not be checked"]
    started = time.monotonic()
    stopped = headless_session.interrupt(str(claude.run_dir), wait=INTERRUPT_SECONDS)
    elapsed = time.monotonic() - started
    claude.server.release.set()
    state = headless_session.turn_state(str(claude.run_dir)) or {}
    claude.server.release.clear()
    failures = []
    if stopped != "stopped" or elapsed >= INTERRUPT_SECONDS:
        failures.append("Claude Code did not stop on the SIGINT Orc's Stop button sends (%s after %.1f seconds)"
                        % (stopped, elapsed))
    if state.get("outcome") != "interrupted":
        failures.append("An interrupted Claude turn read as %s, not interrupted" % state.get("outcome"))
    transcript = claude.transcript(session_id)
    if transcript is None:
        return failures + ["Claude Code wrote no transcript for an interrupted turn"]
    items, _ = read_items("claude", transcript)
    if not any(item["kind"] == "interrupt" for item in items):
        failures.append("Claude Code no longer records an interrupted request in its transcript the way Orc's "
                        "chat shows it as Interrupted")
    state, requests = claude.turn(claude.argv(session_id, resume=True), "Again.", ("text", "After interrupt."))
    failed = turn_failure("A Claude turn resumed after an interrupt", state)
    if failed:
        return failures + [failed]
    if not requests or not _carries(requests[0], "Hold on."):
        failures.append("A Claude turn resumed after an interrupt no longer carries the interrupted prompt")
    state, _ = claude.turn(claude.argv(session_id, resume=True), "/compact",
                           ("text", "<analysis>Compat.</analysis>\n<summary>Compat summary.</summary>"))
    failed = turn_failure("A Claude /compact turn", state)
    if failed:
        return failures + [failed]
    items, _ = read_items("claude", transcript)
    if not any(item["kind"] == "compaction" for item in items):
        failures.append("Claude Code no longer marks a compaction in its transcript the way Orc's chat reader "
                        "shows it (a compact_boundary record)")
    return failures


def run_mcp_failures(claude):
    """The HTTP --mcp-config entry a run's Claude sessions get for its run MCP
    server (devd_launch.with_run_mcp, ui/run_mcp.py), which needs no answer
    from the server to be accepted."""
    session_id = str(uuid.uuid4())
    config = json.dumps({"mcpServers": {"compat-run": devd_launch.server("compat-run", claude.server.server_port)}})
    state, _ = claude.turn(claude.argv(session_id, extra=["--mcp-config", config]), "Hello.", ("text", "Hi."))
    failed = turn_failure("A Claude turn with Orc's run MCP entry", state)
    if failed:
        return [failed]
    log = claude.run_dir / headless_session.STATE_DIR / headless_session._turn_name(state["turn"], "jsonl")
    init = next((event for event in _events(log)
                 if event.get("type") == "system" and event.get("subtype") == "init"), {})
    if not any(isinstance(server, dict) and server.get("name") == "compat-run"
               for server in init.get("mcp_servers") or []):
        return ["Claude Code no longer loads the run MCP server Orc passes a run's sessions with --mcp-config"]
    return []


def _events(path):
    try:
        lines = Path(path).read_text().splitlines()
    except OSError:
        return []
    events = []
    for line in lines:
        with contextlib.suppress(ValueError):
            events.append(json.loads(line))
    return [event for event in events if isinstance(event, dict)]


def launch_failures(claude):
    """A run launched the way orc-ui launches one: server-built ``<orc-context>``
    pointing to ``skills/orc/SKILL.md`` via ``--add-dir``, and per-turn
    ``--settings`` PreToolUse ``orc-hook-policy worktree`` guarding edits to the
    shared checkout."""
    orc = claude.root / ".orc"
    (orc / "config.json").write_text(json.dumps({"repos": {str(claude.work): {"worktree": True}}}))
    run_id, brief = "compat-launch", "Add a compatibility note."
    session_id = str(uuid.uuid4())
    reserved = orc / "runs" / run_id
    (reserved / "inputs").mkdir(parents=True, exist_ok=True)
    (reserved / "inputs" / "start-prompt.txt").write_text(brief + "\n")
    meta = {
        "runId": run_id, "source": "prompt", "title": brief, "mainRepoPath": str(claude.work),
        "repoPath": str(claude.work), "mode": "gated", "phase": "grilling", "status": "running",
        "harness": "claude", "sessionId": session_id, "sessionBackend": "headless",
        "titlePending": True, "launchedBy": "orc-ui"}
    (reserved / "meta.json").write_text(json.dumps(meta))
    note = claude.work / "compat-note.txt"
    entry = skill_commands.invocation("claude", "orc")
    arguments = "--launch-run %s --quoted-prompt %s" % (run_id, shlex.quote(brief))
    prompt = harness_context.launch_prompt(meta, str(reserved), entry, arguments, config_dir=str(orc))
    env = {**claude.env, "ORC_RUN_ID": run_id, "ORC_RUNS_DIR": str(orc / "runs"), "ORC_CONFIG_DIR": str(orc)}
    state, requests = claude.turn(
        claude.argv(session_id, run_dir=reserved), prompt,
        ("tool", "Read", {"file_path": str(ORC_SKILL)}),
        ("tool", "Write", {"file_path": str(note), "content": "compat\n"}),
        ("text", "Launch reply."),
        run_dir=reserved, env=env)
    failed = turn_failure("A Claude /orc:run launch turn", state)
    if failed:
        return [failed]
    failures = []
    if not requests or not _carries(requests[0], "[orc hook]") or not _carries(requests[0], str(ORC_SKILL)):
        failures.append("Claude Code did not deliver Orc's <orc-context> launch block naming %s to the model"
                        % ORC_SKILL.name)
    heading = next(line for line in ORC_SKILL.read_text().split("\n---", 1)[-1].splitlines() if line.startswith("# "))
    read_blocks = _tool_results(requests[1]) if len(requests) > 1 else []
    if not read_blocks or any(block.get("is_error") for block in read_blocks) or not any(
            heading in part for part in _strings(read_blocks)):
        failures.append("Claude Code could not read %s via Orc's --add-dir skill library in headless mode"
                        % ORC_SKILL)
    guarded = len(requests) > 2 and any("orc worktree guard" in part for part in _strings(_tool_results(requests[2])))
    if not guarded or note.exists():
        failures.append("Claude Code no longer blocks an edit when Orc's PreToolUse worktree guard exits 2 on the "
                        "session and file it reads, so edits can land in the shared checkout")
    return failures


def auth_failures(claude):
    """``claude auth status --json`` as Orc's account list runs and reads it
    (agent_accounts.probe_claude), signed in with an API key and signed out."""
    failures = []
    for label, key, expected in (("signed in", True, "ready"), ("signed out", False, "signin")):
        env = dict(claude.env)
        if not key:
            env.pop("ANTHROPIC_API_KEY", None)

        def run(command, env=None, sandboxed=env, **options):
            """Orc's account env carries the real home; keep only the
            config folder it picked."""
            return subprocess.run(command, env={**sandboxed, "CLAUDE_CONFIG_DIR": env["CLAUDE_CONFIG_DIR"]},
                                  **options)

        row = agent_accounts.probe_claude(claude.config.name, home=claude.root, run=run,
                                          which=lambda _: claude.binary)
        if row["state"] != expected:
            failures.append("Orc's account list reads a %s Claude Code as %s, not %s: %s"
                            % (label, row["state"], expected, row.get("detail") or "no detail"))
    return failures


def catalog_failures(claude):
    """Model discovery as Orc's model picker runs it (model_catalog._claude)."""
    try:
        models = model_catalog._claude(claude.binary, claude.env, str(claude.root))
    except Exception as error:  # noqa: BLE001 - any failure is the finding
        return ["Claude Code's model discovery did not run: %s" % (error or type(error).__name__)]
    if not any(isinstance(row["id"], str) and model_catalog.MODEL_ID.fullmatch(row["id"]) for row in models):
        return ["Claude Code no longer lists its models in the initialize control response Orc's model picker reads"]
    return []
