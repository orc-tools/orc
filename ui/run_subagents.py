"""Read-only subagent names, lifecycle and usage from local transcripts."""

import threading
from datetime import datetime
import math
from pathlib import Path
import re
import sqlite3

import codex_questions
import model_prices
import token_usage


# As much of a subagent's instructions as the Factory's job ticket shows.
BRIEF_LIMIT = 240
EFFORT_SET = re.compile(r"<local-command-stdout>\s*Set effort level to ([a-z]+)\s*</local-command-stdout>")
GEMINI_CONVERSATION_IN_RESULT = re.compile(
    r'"conversationId"\s*:\s*"([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})"')


def _gemini_transcript():
    import harnesses
    module = harnesses.builtin("gemini")
    return None if module is None else getattr(module, "transcript", None)


def effort_level(value):
    return value if isinstance(value, str) and value in (
        "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra") else None


def number(value):
    return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 else None


def size(text):
    """How many bytes ``text`` is on the wire, or None when it is not text."""
    return len(text.encode("utf-8", "replace")) if isinstance(text, str) else None


def content_text(content):
    """A tool result's text, whether it came as one string or as blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(block["text"] for block in content
                         if isinstance(block, dict) and isinstance(block.get("text"), str))
    return None


def milliseconds(start, end):
    try:
        return max(0, int((datetime.fromisoformat(end.replace("Z", "+00:00"))
                           - datetime.fromisoformat(start.replace("Z", "+00:00"))).total_seconds() * 1000))
    except (ValueError, TypeError, AttributeError):
        return None


class Summary:
    def __init__(self):
        self.id = None
        self.name = None
        self.role = None
        self.model = None
        self.effort = None
        self.started = None
        self.updated = None
        self.ended = None
        self.status = "unknown"
        self.tokens = None
        self.messages = {}
        # What each model call cost, in the order the transcript records
        # them: {"at", "model", "tokens"}, and for Codex the thread it
        # belongs to, because a rollout can replay another thread's history.
        self.ledger = {}
        self._meters = {}
        self.agents = {}
        self.calls = {}
        self.sends = {}
        self.kills = {}
        self.plan_handoffs = {}
        self.swarm_pending = {}
        self.swarm_calls = []
        self.workflows = {}
        self.turn_active = None
        self.last_result_at = None

    def calls_billed(self):
        """[(key, ledger entry)] for this transcript's own model calls."""
        return [(key, entry) for key, entry in self.ledger.items()
                if entry.get("thread") in (None, self.id)]

    def feed(self, harness, record):
        at = record.get("timestamp")
        if at:
            self.updated = at
        if harness == "codex":
            self._codex(record, at)
        elif harness == "gemini":
            self._gemini(record, at)
        else:
            self._claude(record, at)

    def _codex(self, record, at):
        payload = record.get("payload")
        if not isinstance(payload, dict):
            return
        kind = record.get("type")
        if kind == "session_meta":
            self.id = payload.get("id")
            self.name = payload.get("agent_path") or payload.get("agent_nickname")
            self.role = payload.get("agent_role")
            self.started = payload.get("timestamp") or at
        elif kind == "turn_context":
            self.model = payload.get("model") or self.model
            self.effort = effort_level(payload.get("effort")) or self.effort
        elif kind == "event_msg":
            event = payload.get("type")
            if event == "task_started":
                self.started = self.started or at
                self.status, self.ended = "running", None
            elif event in ("task_complete", "turn_aborted"):
                self.status = "done" if event == "task_complete" else "interrupted"
                self.ended = at
            elif event == "token_count":
                info = payload.get("info") or {}
                usage = info.get("total_token_usage") if isinstance(info, dict) else None
                if isinstance(usage, dict) and number(usage.get("total_tokens")) is not None:
                    self.tokens = usage["total_tokens"]
                if payload.get("thread_id", self.id) == self.id:
                    step = self._meters.setdefault(self.id, token_usage.CodexMeter()).step(usage)
                    if step is not None:
                        tokens, _, long_context = step
                        if long_context:
                            tokens["longContext"] = dict(tokens)
                        self.ledger["%s:%d" % (self.id, len(self.ledger))] = {
                            "at": at, "model": self.model or "unknown", "tokens": tokens, "thread": self.id}
            elif event == "sub_agent_activity":
                ident = payload.get("agent_thread_id")
                if isinstance(ident, str):
                    agent = self.agents.setdefault(ident, {"id": ident, "startedAt": at})
                    agent["name"] = payload.get("agent_path") or ident
                    state = {"started": "running", "spawned": "running", "completed": "done",
                             "stopped": "interrupted", "failed": "error"}.get(payload.get("kind"))
                    if state:
                        agent.update(status=state, endedAt=None if state == "running" else at)

    def _record_usage(self, message, record, at, fallback_model=None):
        usage = message.get("usage")
        fields = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
        if isinstance(usage, dict) and (
            any(number(usage.get(key)) is not None for key in fields)
            or number(usage.get("cache_read_tokens")) is not None
        ):
            cached = number(usage.get("cache_read_input_tokens"))
            if cached is None:
                cached = number(usage.get("cache_read_tokens")) or 0
            total = (
                (number(usage.get("input_tokens")) or 0)
                + (number(usage.get("output_tokens")) or 0)
                + cached
                + (number(usage.get("cache_creation_input_tokens")) or 0)
            )
            # Streaming records repeat a message id with updated usage.
            key = message.get("id") or record.get("uuid")
            if key not in self.ledger or total > self.messages.get(key, 0):
                model = str(message.get("model") or fallback_model or "unknown")
                self.ledger[key] = {"at": self.ledger.get(key, {}).get("at") or at, "model": model,
                                    "tokens": model_prices.claude_tokens(model, usage)}
            self.messages[key] = max(total, self.messages.get(key, 0))
            self.tokens = sum(self.messages.values())

    def _gemini(self, record, at):
        gt = _gemini_transcript()
        kind = record.get("type")
        if kind == "system" and record.get("subtype") == "init":
            self.id = record.get("session_id") or self.id
            raw_model = record.get("model")
            if isinstance(raw_model, str) and raw_model.strip():
                if gt is not None:
                    parsed_model, parsed_effort = gt.split_model(raw_model)
                    self.model = parsed_model or self.model
                    self.effort = effort_level(parsed_effort) or self.effort
                else:
                    self.model = raw_model.strip()
            return
        if kind == "result":
            self.turn_active = False
            self.last_result_at = at
            return
        message = record.get("message") or {}
        if not isinstance(message, dict):
            return
        blocks = message.get("content") or []
        if not isinstance(blocks, (list, str)):
            blocks = []
        if kind == "assistant":
            self.started = self.started or at
            self._record_usage(message, record, at, fallback_model=self.model)
            if isinstance(blocks, list):
                for block in blocks:
                    if not isinstance(block, dict) or block.get("type") != "tool_use":
                        continue
                    data = block.get("input") or {}
                    ident = block.get("id")
                    name = block.get("name")
                    if not isinstance(data, dict) or not isinstance(ident, str):
                        continue
                    if name == "send_message":
                        msg = data.get("Message", data.get("message", data.get("content")))
                        to = data.get("Recipient", data.get("to", data.get("recipient")))
                        if isinstance(msg, str) and isinstance(to, str):
                            self.sends[ident] = (to, size(msg))
                    elif name == "manage_subagents":
                        if data.get("Action") in ("kill", "kill_all"):
                            self.kills[ident] = data
                    elif name in ("exit_plan_mode", "enter_plan_mode"):
                        existing = self.plan_handoffs.get(ident)
                        text = data.get("plan") if name == "exit_plan_mode" else data.get("reason")
                        self.plan_handoffs[ident] = {
                            "id": ident,
                            "kind": name,
                            "at": existing.get("at") if existing else at,
                            "text": text if isinstance(text, str) else "",
                        }
                    elif name in ("swarm", "post_message"):
                        self.swarm_pending[ident] = (at, {"_tool": name, **data})
                    elif name == "run_workflow":
                        existing = self.workflows.get(ident)
                        entry = existing if existing is not None else {
                            "id": ident, "startedAt": at, "status": "running",
                        }
                        desc = data.get("Description")
                        script = data.get("Script") or data.get("ScriptPath")
                        if isinstance(desc, str) and desc.strip():
                            entry["description"] = " ".join(desc.split())[:BRIEF_LIMIT]
                        if isinstance(script, str) and script.strip():
                            entry["brief"] = " ".join(script.split())[:BRIEF_LIMIT]
                            entry["briefBytes"] = size(script)
                        elif isinstance(desc, str) and desc.strip() and not entry.get("briefBytes"):
                            entry["brief"] = entry["description"]
                            entry["briefBytes"] = size(desc)
                        self.workflows[ident] = entry
                    elif name == "invoke_subagent":
                        existing = self.calls.get(ident)
                        cid = data.get("conversationId")
                        call = existing if existing is not None else {
                            "id": ident, "startedAt": at, "status": "running",
                        }
                        call["name"] = data.get("Role") or data.get("TypeName") or call.get("name") or "Subagent"
                        call["role"] = data.get("TypeName") or call.get("role")
                        model = data.get("Model")
                        if isinstance(model, str) and model and model != "inherit":
                            call["model"] = model
                        prompt = data.get("Prompt")
                        if isinstance(prompt, str) and prompt.strip():
                            call["brief"] = " ".join(prompt.split())[:BRIEF_LIMIT]
                            call["briefBytes"] = size(prompt)
                        if isinstance(cid, str) and cid:
                            self.agents[cid] = call
                            call["id"] = cid
                        self.calls[ident] = call
        elif kind == "user":
            if str(record.get("uuid") or "").startswith("gemini-user-"):
                self.turn_active = True
            if isinstance(blocks, list):
                result = record.get("toolUseResult") or {}
                for block in blocks:
                    if not isinstance(block, dict):
                        continue
                    sent = self.sends.pop(block.get("tool_use_id"), None)
                    if sent is not None:
                        if not block.get("is_error"):
                            self._message(*sent, at)
                        continue
                    kill = self.kills.pop(block.get("tool_use_id"), None)
                    if kill is not None:
                        if not block.get("is_error"):
                            targets = kill.get("ConversationIds") if kill.get("Action") == "kill" else list(self.agents)
                            for cid in (targets or ()):
                                agent = self.agents.get(cid)
                                if agent is not None:
                                    agent.update(status="interrupted", endedAt=at)
                        continue
                    swarm_call = self.swarm_pending.pop(block.get("tool_use_id"), None)
                    if swarm_call is not None:
                        if not block.get("is_error"):
                            self.swarm_calls.append((swarm_call[0], swarm_call[1], at))
                        continue
                    workflow = self.workflows.get(block.get("tool_use_id"))
                    if workflow is not None:
                        text = content_text(block.get("content")) or ""
                        workflow["output"] = text
                        workflow["updatedAt"] = at
                        if block.get("is_error"):
                            workflow.update(status="error", endedAt=at)
                            if text:
                                workflow["resultBytes"] = size(text)
                        elif "running as a background task with task id:" not in text:
                            workflow.update(status="done", endedAt=at)
                            if text:
                                workflow["resultBytes"] = size(text)
                        continue
                    call = self.calls.get(block.get("tool_use_id"))
                    if call is None:
                        continue
                    cid = result.get("agentId") if isinstance(result, dict) else None
                    if not isinstance(cid, str) or not cid:
                        text = content_text(block.get("content")) or ""
                        match = GEMINI_CONVERSATION_IN_RESULT.search(text)
                        if match:
                            cid = match.group(1)
                    if isinstance(cid, str) and cid:
                        self.agents[cid] = call
                        call["id"] = cid
                    if block.get("is_error"):
                        call.update(status="error", endedAt=at)

    def _claude(self, record, at):
        self.id = record.get("agentId") or self.id
        # Some harness init records omit message.model and write agent_mode ("external-agent:<engine>") instead.
        if record.get("type") == "system" and record.get("subtype") == "init":
            mode = record.get("agent_mode") or record.get("model")
            if isinstance(mode, str) and mode.strip():
                self.model = mode.removeprefix("external-agent:").strip()
            self.effort = effort_level(record.get("effort")) or self.effort
        message = record.get("message") or {}
        if not isinstance(message, dict):
            return
        blocks = message.get("content") or []
        if not isinstance(blocks, (list, str)):
            blocks = []
        if record.get("type") == "assistant":
            self.started = self.started or at
            self.model = message.get("model") or self.model
            if message.get("model") != "<synthetic>":
                self.effort = effort_level(record.get("effort")) or self.effort
            self._record_usage(message, record, at)
            if isinstance(blocks, list):
                for block in blocks:
                    if not isinstance(block, dict) or block.get("type") != "tool_use":
                        continue
                    data = block.get("input") or {}
                    ident = block.get("id")
                    if not isinstance(data, dict) or not isinstance(ident, str):
                        continue
                    if block.get("name") == "SendMessage":
                        # Counted when its result says the message was taken.
                        message = data.get("message", data.get("content"))
                        to = data.get("to", data.get("recipient"))
                        if isinstance(message, str) and isinstance(to, str):
                            self.sends[ident] = (to, size(message))
                        continue
                    if block.get("name") not in ("Agent", "Task"):
                        continue
                    self.calls[ident] = {"id": ident, "name": data.get("name") or data.get("description") or "Subagent",
                        "role": data.get("subagent_type"), "model": data.get("model"),
                        "effort": effort_level(data.get("effort")), "startedAt": at, "status": "running"}
                    prompt = data.get("prompt")
                    if isinstance(prompt, str) and prompt.strip():
                        self.calls[ident]["brief"] = " ".join(prompt.split())[:BRIEF_LIMIT]
                        self.calls[ident]["briefBytes"] = size(prompt)
        elif record.get("type") == "user" and isinstance(blocks, list):
            result = record.get("toolUseResult") or {}
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                sent = self.sends.pop(block.get("tool_use_id"), None)
                if sent is not None:
                    refused = isinstance(result, dict) and result.get("success") is False
                    if not block.get("is_error") and not refused:
                        self._message(*sent, at)
                    continue
                call = self.calls.get(block.get("tool_use_id"))
                if call is None:
                    continue
                if isinstance(result, dict):
                    ident = result.get("agentId")
                    if isinstance(ident, str):
                        self.agents[ident] = call
                        call["id"] = ident
                    call["model"] = result.get("resolvedModel") or call.get("model")
                    if result.get("isAsync") or result.get("status") == "async_launched":
                        continue
                    for source, dest in (("totalTokens", "tokens"), ("totalDurationMs", "durationMs")):
                        if number(result.get(source)) is not None:
                            call[dest] = result[source]
                call.update(status="error" if block.get("is_error") else "done", endedAt=at)
                returned = size(content_text(block.get("content")))
                if returned:
                    call["resultBytes"] = returned
        elif record.get("type") == "progress":
            data = record.get("data") or {}
            if isinstance(data, dict) and data.get("type") == "agent_progress":
                call = self.calls.get(record.get("parentToolUseID"))
                ident = data.get("agentId")
                if call is not None and isinstance(ident, str):
                    self.agents[ident] = call
                    call["id"] = ident
        if record.get("type") == "user":
            text = blocks if isinstance(blocks, str) else "\n".join(
                block["text"] for block in blocks if isinstance(block, dict) and isinstance(block.get("text"), str))
            for note in re.findall(r"<task-notification>(.*?)</task-notification>", text, re.DOTALL):
                self._notified(note, at)
            changed = None if record.get("isMeta") else EFFORT_SET.match(text.strip())
            if changed:
                self.effort = effort_level(changed.group(1))

    def _message(self, to, sent, at):
        """The parent's SendMessage to one of its subagents, by id or by the
        name it was started under. A finished one is resumed to read it and
        notifies again when it is done."""
        agent = self.agents.get(to) or next(
            (call for call in reversed(list(self.calls.values())) if to in (call["id"], call["name"])), None)
        if agent is None:
            return
        agent.update(messages=agent.get("messages", 0) + 1,
                     messageBytes=agent.get("messageBytes", 0) + sent, messagedAt=at)
        if agent["status"] != "running":
            agent.update(status="running", endedAt=None)

    def _notified(self, note, at):
        task = re.search(r"<task-id>([^<]+)</task-id>", note)
        state = re.search(r"<status>([^<]+)</status>", note)
        agent = self.agents.get(task[1]) if task else None
        status = {"completed": "done", "failed": "error", "stopped": "interrupted"}.get(state[1]) if state else None
        remark = re.search(r"<note>(.*?)</note>", note, re.DOTALL)
        if status == "done" and remark and "background work of its own still running" in remark[1]:
            status = "running"
        if agent is None or not status:
            return
        agent.update(status=status, endedAt=None if status == "running" else at)
        result = re.search(r"<result>(.*)</result>", note, re.DOTALL)
        if result and status != "running":
            agent["resultBytes"] = size(result[1])


CODEX_CHILDREN_SQL = """
    WITH RECURSIVE children(id) AS (
        SELECT child_thread_id FROM thread_spawn_edges WHERE parent_thread_id = ?
        UNION
        SELECT e.child_thread_id FROM thread_spawn_edges e JOIN children c ON e.parent_thread_id = c.id
        LIMIT 128
    )
    SELECT t.id, t.rollout_path FROM threads t JOIN children c ON t.id = c.id
    WHERE t.id != ?
                """


class CodexChildIndex:
    def __init__(self):
        self.lock = threading.Lock()
        self.connection = None
        self.identity = None
        self.version = None
        self.owners = {}

    def children(self, db, owner):
        with self.lock:
            stat = db.stat()
            identity = (db, stat.st_dev, stat.st_ino)
            if identity != self.identity:
                connection = sqlite3.connect(db.as_uri() + "?mode=ro", uri=True, timeout=0.1,
                                             check_same_thread=False)
                if self.connection is not None:
                    self.connection.close()
                self.connection = connection
                self.identity = identity
                self.owners.clear()
            # data_version on the same connection observes commits in WAL mode
            # too, even when the parent's own transcript hasn't changed.
            version = self.connection.execute("PRAGMA data_version").fetchone()[0]
            if version != self.version:
                self.owners.clear()
                self.version = version
            if owner not in self.owners:
                if len(self.owners) >= 512:
                    self.owners.clear()
                self.owners[owner] = tuple(self.connection.execute(CODEX_CHILDREN_SQL, (owner, owner)))
            return self.owners[owner]


_CODEX_CHILD_INDEX = CodexChildIndex()


def codex_children(owner):
    for db in sorted(codex_questions.home().glob("state_*.sqlite"), reverse=True)[:3]:
        try:
            return _CODEX_CHILD_INDEX.children(db, owner)
        except (OSError, sqlite3.Error):
            continue
    return []


def snapshot(harness, path, summary, reader_for, locate, active, billed=None):
    """The subagents ``summary``'s transcript started, each with what its own
    transcript adds. ``billed`` collects each one's model calls by its id."""
    rows = {}
    if harness == "gemini":
        gt = _gemini_transcript()
        entries = gt.subagents_snapshot(summary, active=active, billed=billed) if gt is not None else [
            dict(value) for value in summary.calls.values()]
        rows = {row["id"]: row for row in entries if isinstance(row.get("id"), str)}
        candidates = []
    elif harness == "codex":
        rows.update({key: dict(value) for key, value in summary.agents.items()})
        paths = dict(codex_children(summary.id)) if summary.id else {}
        for ident in rows:
            if ident not in paths:
                paths[ident] = locate("codex", ident)
        candidates = []
        root = (codex_questions.home() / "sessions").resolve()
        for ident, child_path in paths.items():
            if child_path:
                resolved = Path(child_path).resolve()
                if resolved.is_relative_to(root):
                    candidates.append((ident, resolved))
    else:
        rows.update({value["id"]: dict(value) for value in summary.calls.values()})
        folder = Path(path).parent / Path(path).stem / "subagents"
        candidates = [(p.stem.removeprefix("agent-"), p) for p in sorted(folder.glob("agent-*.jsonl"))
                      if p.resolve().is_relative_to(folder.resolve())]
    parent_path = Path(path).resolve() if candidates else None
    for ident, child_path in candidates:
        if (child_path if harness == "codex" else child_path.resolve()) == parent_path:
            continue
        child = reader_for(harness, child_path)
        with child.lock:
            available = child.poll()
            stats = child.summary
            if stats.id != ident:
                continue
            row = rows.setdefault(ident, {"id": ident})
            row.update(name=row.get("name") or stats.name or "Subagent " + ident[:8],
                       role=row.get("role") or stats.role, model=stats.model or row.get("model"),
                       effort=stats.effort or row.get("effort"),
                       startedAt=row.get("startedAt") or stats.started, updatedAt=stats.updated)
            if stats.tokens is not None:
                row["tokens"] = stats.tokens
            if billed is not None:
                billed[ident] = stats.calls_billed()
            if harness == "codex":
                row.update(status=stats.status if available else "unknown", endedAt=stats.ended)
            elif "status" not in row:
                row["status"] = "unknown"
    result = []
    for row in rows.values():
        row.setdefault("name", "Subagent")
        row.setdefault("status", "unknown")
        if row["status"] == "running" and not active:
            row["status"] = "unknown"
        row.setdefault("durationMs", milliseconds(row.get("startedAt"), row.get("endedAt")))
        result.append(row)
    return sorted(result, key=lambda row: (row["status"] != "running", row.get("startedAt") or "", row["id"]))
