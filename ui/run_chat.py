"""The conversation behind a run, read back from its agent's own transcript.

Claude Code appends ``projects/<slug>/<session>.jsonl`` under the account's
config directory and Codex appends a rollout under ``~/.codex/sessions``. A Reader tails one of those
files from its last offset and keeps the chat items it has already parsed:
messages, tool calls, thinking, notices and turn ends. Every added or changed
item takes the next revision, so a poll naming the last revision it saw gets
only what changed, and a poll from another reader generation (a different
file, a truncated one, a restarted server) gets everything again.

Nothing here writes. The transcript stays the source of truth; an item is a
display projection of it, clipped so a long session stays a small payload.
Claude Code deletes transcripts it has not used for 30 days, so archiving a
settled run keeps the conversation in the run folder (``conversation_copy``):
a hard link to the original, or a gzipped copy where a link cannot be made.
Chat reads it once the original is gone.
"""
from __future__ import annotations

import base64
import binascii
import collections
import gzip
import hashlib
import json
import os
import re
import secrets
import shlex
import stat
import threading
import time
import urllib.parse
from pathlib import Path

import claude_accounts
import codex_questions
import harnesses
import headless_session
import orc_context
import run_notes
import run_subagents
import skill_commands

# A first read of a very long session finishes over the next polls instead of
# holding one request for seconds.
READ_BUDGET = 32 * 1024 * 1024
# Claude writes pasted images inline as base64, so a prompt line can run to
# megabytes. Anything longer than this is skipped rather than buffered.
LINE_LIMIT = 16 * 1024 * 1024
TEXT_LIMIT = 24000
OUTPUT_LIMIT = 4000
DETAIL_LIMIT = 4000
# The MCP tab replays an agent's MCP calls with their exact arguments, which
# the chat items only keep clipped; a call bigger than this is not offered.
MCP_ARGUMENTS_LIMIT = 32 * 1024
DIFF_LIMIT = 12000
PLAN_LIMIT = 24000
READERS_MAX = 48
# A conversation can start dozens of subagents, each with its own transcript.
# Their readers keep only a summary and live in their own cache, so they never
# push the conversation's reader out and force its next poll to start over.
SUMMARY_READERS_MAX = 512
# A session file appears a few seconds after launch; a miss is retried this
# often rather than globbing every project directory on every poll.
LOOKUP_RETRY_SECONDS = 2.0

# Where archiving keeps a run's conversation. Hidden, so the archive sweep
# never sends it to the Bin; named by session or thread id because a rescued
# run moves on to another one.
SAVED_LINK = ".transcript-%s.jsonl"
SAVED_TRANSCRIPT = SAVED_LINK + ".gz"
RUN_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,200}\Z")
SESSION_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{7,127}\Z")
COMMAND_NAME = re.compile(r"<command-name>\s*(/?[^<\s]+)\s*</command-name>")
COMMAND_ARGS = re.compile(r"<command-args>(.*?)</command-args>", re.S)
LOCAL_STDOUT = re.compile(r"<local-command-stdout>(.*?)</local-command-stdout>", re.S)
BASH_INPUT = re.compile(r"<bash-input>(.*?)</bash-input>", re.S)
BASH_STDOUT = re.compile(r"<bash-stdout>(.*?)</bash-stdout>", re.S)
BASH_STDERR = re.compile(r"<bash-stderr>(.*?)</bash-stderr>", re.S)
TASK_SUMMARY = re.compile(r"<summary>(.*?)</summary>", re.S)
TASK_STATUS = re.compile(r"<status>(.*?)</status>", re.S)
AGENT_FROM = re.compile(r"<agent-message\s+from=\"([^\"]+)\"")
# The block bin/orc-chat-steer wraps each Chat message in when it hands a busy
# headless turn the message at its next tool call.
CHAT_STEER = re.compile(r"<orc-chat-message>\n(.*?)\n</orc-chat-message>", re.S)
RESCUE_HANDOFF = re.compile(r"^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,120}\s+)?\[Orc rescue\](?:\s|$).*", re.S)
RESCUE_USER_PROMPT = re.compile(r"<orc-user-prompt>\n(.*?)\n</orc-user-prompt>", re.S)
ATTACHMENT_REFERENCE = re.compile(r"^\[(?:Image|Video) attachment: (/[^\]\r\n]+)\]\s*$", re.M)
LAUNCH = re.compile(
    r"--(?:launch-run|answer-follow-up)\s+[A-Za-z0-9][A-Za-z0-9._-]{0,120}\s+(.+)", re.S)
BARE_LAUNCH = re.compile(r"--launch-run\s+([A-Za-z0-9][A-Za-z0-9._-]{0,120})")
LEADING_COMMAND = re.compile(r"\s*([/$][a-z][a-z0-9:-]*)(?:\s+(.*))?\Z", re.S)
# Maximum size for a historical prompt passed via an orcPrompt: file path.
PROMPT_FILE_LIMIT = 262144
PROMPT_FILE_PATH = re.compile(r"(?:/|~/)[^\n]+\.md\Z")
PROMPT_FILE_MARKER = re.compile(r"^orcPrompt\s*:\s*([^#\r\n]+?)\s*(?:#.*)?$", re.M)
# Claude Code repeats the id on the closing tag; Codex does not.
PASTED_CONTENT = re.compile(
    r'<pasted_content\s+id="([A-Za-z0-9_-]+)"\s*>(.*?)</pasted_content(?:\s+id="\1")?\s*>', re.S)
# The block a gate page's form sends: ui/serve.py's serialize() writes the
# header, one "N. <question>?: <answer>" line per question, then Notes.
GATE_ANSWERS = re.compile(r"([A-Z][A-Za-z]{1,20}) answers \(([A-Za-z0-9][A-Za-z0-9._-]{0,120})\):\n(.*)\Z", re.S)
GATE_ANSWER_LINE = re.compile(r"(\d+)\. (.*?)\?: (.*)\Z", re.S)
# A Clarification answer is sent as a review: its own header and intent line,
# the same numbered lines, then the manifest the server appended.
CLARIFICATION_ANSWERS = re.compile(
    r"Clarification review \(([A-Za-z0-9][A-Za-z0-9._-]{0,120})\):\nIntent: answer clarification\n"
    r"(.*?)(?:\nAnswer manifest: \S+)?\Z", re.S)
CHAT_SUBMISSION = re.compile(r"\nChat submission: ([0-9a-f]{32})"
                            r"(?=\nAnswer manifest: clarification-review/manifests/(clarification-[\w.-]+)\.json\Z)")
EXIT_CODE = re.compile(r"\AExit code (\d+)")
LEGACY_EXEC_CMD = re.compile(r"\"cmd\"\s*:\s*(\"(?:[^\"\\]|\\.)*\")")
LEGACY_EXEC_PREAMBLE = re.compile(r"\AScript completed\nWall time [^\n]*\nOutput:\n")
INTERRUPTED = ("[Request interrupted by user]",
               "[Request interrupted by user for tool use]")
DECLINED = "The user doesn't want to proceed with this tool use"
# Commands Orc itself launches with. Their arguments are the person's prompt,
# so they render as a message with a small command label, never as a notice.
ORC_COMMANDS = skill_commands.ENTRY_COMMANDS

_readers = collections.OrderedDict()
_summary_readers = collections.OrderedDict()
_readers_lock = threading.Lock()
_paths = {}


def clip(text, limit):
    """At most ``limit`` characters, marking a cut with an ellipsis."""
    if not isinstance(text, str):
        return ""
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


IMAGE_DATA = re.compile(r"data:(image/(?:png|jpeg|webp|gif|bmp|avif));base64,([A-Za-z0-9+/=\s]+)\Z")


def image_blocks(value):
    if isinstance(value, list):
        for child in value:
            yield from image_blocks(child)
    elif isinstance(value, dict):
        if value.get("type") in ("input_image", "image"):
            url = value.get("image_url")
            source = value.get("source") or {}
            if isinstance(source, dict) and source.get("type") == "base64":
                url = "data:%s;base64,%s" % (source.get("media_type"), source.get("data"))
            if value.get("data") and value.get("mimeType"):
                url = "data:%s;base64,%s" % (value["mimeType"], value["data"])
            if isinstance(url, str) and IMAGE_DATA.fullmatch(url):
                yield url
        for key in ("output", "content", "result", "payload", "message", "item"):
            if key in value:
                yield from image_blocks(value[key])


def unwrap_pasted_content(text):
    match = PASTED_CONTENT.fullmatch(text.strip())
    return match.group(2).strip() if match else text


def gate_answers(text):
    """The answers a gate page sent, or None for any other message."""
    match = GATE_ANSWERS.fullmatch(text.strip())
    review = None if match else CLARIFICATION_ANSWERS.fullmatch(text.strip())
    if not match and not review:
        return None
    label, run_id, body = ((match.group(1), match.group(2), match.group(3)) if match
                           else ("Clarification", review.group(1), review.group(2)))
    answers, notes = [], None
    for line in re.split(r"\n(?=\d+\. |Notes: )", body):
        entry = GATE_ANSWER_LINE.fullmatch(line.strip())
        if entry and notes is None and int(entry.group(1)) == len(answers) + 1:
            answers.append({"question": clip(entry.group(2).strip() + "?", 2000),
                            "answer": clip(entry.group(3).strip(), 4000)})
        elif line.startswith("Notes: ") and notes is None:
            notes = clip(line[len("Notes: "):].strip(), 4000)
        else:
            return None
    if not answers and notes is None:
        return None
    result = {"label": label, "runId": run_id, "answers": answers}
    if notes:
        result["notes"] = notes
    return result


def unwrap_launch(arg):
    """The prompt an Orc launch carried, without its reservation flags.

    Launches carry ``/orc:run --launch-run <id> --quoted-prompt '<prompt>'``
    (or historical ``/orc --launch-run <id>``), and Chat on an answered
    question sends ``/orc:run --answer-follow-up <id> ...``; ``harness_context``
    and Chat unwrap them the same way."""
    bare = BARE_LAUNCH.fullmatch(arg.strip())
    if bare:
        return reserved_brief(bare.group(1)) or arg
    match = LAUNCH.fullmatch(arg.strip())
    if not match:
        return arg
    rest = match.group(1).strip()
    if rest.startswith("--quoted-prompt"):
        try:
            parts = shlex.split(rest)
        except ValueError:
            return rest
        if len(parts) == 2 and parts[0] == "--quoted-prompt":
            return parts[1]
    return rest


def reserved_brief(run_id):
    """The prompt orc-ui reserved for ``run_id``, or None."""
    runs = os.environ.get("ORC_RUNS_DIR") or os.path.join(os.path.expanduser("~"), ".orc", "runs")
    try:
        with open(os.path.join(runs, run_id, "inputs", "start-prompt.txt")) as handle:
            return handle.read(PROMPT_FILE_LIMIT).strip() or None
    except (OSError, UnicodeDecodeError):
        return None


def unwrap_forwarded(text):
    header, separator, body = text.partition("\n")
    if not separator or not header.startswith("[Orc forwarded message: ") or not header.endswith("]"):
        return text, None
    try:
        source = json.loads(header[len("[Orc forwarded message: "):-1])
    except ValueError:
        return text, None
    if not isinstance(source, dict) or not isinstance(source.get("runId"), str) or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._-]{0,120}", source["runId"]):
        return text, None
    message_id = source.get("messageId")
    if message_id is not None and (not isinstance(message_id, str) or len(message_id) > 512):
        return text, None
    return body, {key: source[key] for key in ("runId", "messageId") if source.get(key)}


def forwarded_prompt(run_id, message, items):
    text, attachments = split_attachments(message)
    original = next((item for item in reversed(items) if item.get("kind") == "user"
                     and item.get("text", "").strip() == text.strip()
                     and item.get("attachments", []) == attachments), None)
    source = {"runId": run_id}
    if original:
        source["messageId"] = original["id"]
    return "[Orc forwarded message: %s]\n%s" % (json.dumps(source), message)


def prompt_file_body(text):
    """The body of the marked Orc prompt file ``text`` names, or None.

    A context child launches with only its brief's path. Chat reads the file
    only when the hook would have accepted it as a prompt."""
    text = (text or "").strip()
    if not PROMPT_FILE_PATH.fullmatch(text):
        return None
    try:
        fd = os.open(os.path.expanduser(text), os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        return None
    with os.fdopen(fd, "rb") as handle:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            return None
        raw = handle.read(PROMPT_FILE_LIMIT + 1)
    if len(raw) > PROMPT_FILE_LIMIT:
        return None
    try:
        lines = raw.decode("utf-8-sig").splitlines(keepends=True)
    except UnicodeDecodeError:
        return None
    if not lines or lines[0].strip() != "---":
        return None
    closing = next((index for index, line in enumerate(lines[1:], 1)
                    if line.strip() in ("---", "...")), None)
    if closing is None or PROMPT_FILE_MARKER.findall("".join(lines[1:closing])) != ["true"]:
        return None
    return "".join(lines[closing + 1:]).strip() or None


def chat_submission(text):
    if text.startswith("Clarification review (") and (match := CHAT_SUBMISSION.search(text)):
        return text[:match.start()] + text[match.end():], {
            "chatSubmission": match[1], "chatManifest": match[2]}
    return text, {}


def queued_view(items):
    """Queued follow-ups as Chat shows them: an answered question's
    ``/orc --answer-follow-up`` wrapper reads as the message it carries.
    Artifact-feedback batches stay tracked in the plan tray rather than as
    cancellable Chat queue items."""
    view = []
    for item in items:
        if not isinstance(item, dict) or item.get("source") == "artifact-feedback":
            continue
        text = item.get("text")
        match = isinstance(text, str) and re.fullmatch(
            r"\s*[/$]orc(?::run)?\s+(--answer-follow-up\s.+)", text, re.S)
        text = unwrap_launch(match.group(1)) if match else text
        text, source = unwrap_forwarded(text or "")
        text, submission = chat_submission(text)
        view.append(dict(item, text=text, **submission, **({"forwardedFrom": source} if source else {})))
    return view


def split_attachments(text):
    """The prompt text and the image and video attachment paths it references."""
    paths = ATTACHMENT_REFERENCE.findall(text or "")
    if not paths:
        return text, []
    return ATTACHMENT_REFERENCE.sub("", text).strip(), paths


def user_message(uid, at, text, *, command=None, steer=False):
    text, submission = (text, {}) if command else chat_submission(text)
    answers = None if command else gate_answers(text)
    text, attachments = split_attachments(text)
    item = {"id": uid, "kind": "user", "at": at, "text": clip(text, TEXT_LIMIT), **submission}
    if steer:
        item["steer"] = True
    else:
        body = prompt_file_body(text)
        if body:
            item["promptFile"] = {"body": clip(body, TEXT_LIMIT)}
    if command:
        item["command"] = command
    if answers:
        item["gateAnswers"] = answers
    if attachments:
        item["attachments"] = attachments[:12]
    return item


def display_path(path, cwd=None):
    """A path as a person reads it: relative inside the session's checkout,
    ``~``-shortened elsewhere."""
    if not isinstance(path, str) or not path:
        return ""
    if path.startswith("file://"):
        path = path[len("file://"):]
    if cwd and os.path.isabs(path):
        root = cwd.rstrip("/") + "/"
        if path.startswith(root):
            return path[len(root):]
    home = str(Path.home()).rstrip("/") + "/"
    if path.startswith(home):
        return "~/" + path[len(home):]
    return path


def diff_counts(lines):
    """Added and removed line counts for unified-diff body lines."""
    added = removed = 0
    for line in lines:
        if line.startswith("+") and not line.startswith("+++"):
            added += 1
        elif line.startswith("-") and not line.startswith("---"):
            removed += 1
    return added, removed


def _flatten(content):
    """Plain text from a Claude content value: a string or a block list."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text") or "")
    return "\n".join(parts)


def _compact_json(value):
    try:
        return json.dumps(value, ensure_ascii=False, separators=(", ", ": "))
    except (TypeError, ValueError):
        return ""


def mcp_arguments_fit(arguments):
    """Whether an MCP call's arguments are small enough to offer the call
    again: an agent's call, or a setup a run recorded."""
    return len(_compact_json(arguments)) <= MCP_ARGUMENTS_LIMIT


def _first_line(text, limit=240):
    text = (text or "").strip()
    return clip(text.split("\n", 1)[0], limit)


_NOTE_VERBS = {"ask": "Asked", "tell": "Told", "answer": "Answered"}


def sent_note(command):
    """The note an `orc-note ask|tell|answer` command sends, so the sender's
    Chat reads it as a note to that run rather than a shell line."""
    try:
        words = shlex.split(command or "")
    except ValueError:
        return None
    at = next((index for index, word in enumerate(words)
               if os.path.basename(word) == "orc-note"), None)
    if at is None or at + 1 >= len(words) or words[at + 1] not in _NOTE_VERBS:
        return None
    kind, rest, to, loose = words[at + 1], words[at + 2:], "", []
    skip = False
    for index, word in enumerate(rest):
        if skip:
            skip = False
        elif word in ("--to", "--run-dir", "--run-id", "--wait"):
            skip = True
            if word == "--to" and index + 1 < len(rest):
                to = rest[index + 1]
        elif word in ("&&", "||", ";", "|", "2>&1"):
            break
        elif not word.startswith("--"):
            loose.append(word)
    if not loose:
        return None
    if kind == "answer":
        return {"kind": kind, "id": loose[0], "text": " ".join(loose[1:])}
    return {"kind": kind, "to": to, "text": " ".join(loose)}


def describe_claude_tool(name, data, cwd):
    """(category, title, detail, extra) for one Claude tool call."""
    data = data if isinstance(data, dict) else {}
    extra = {}
    if name == "Bash":
        command = data.get("command") or ""
        if data.get("description"):
            extra["description"] = clip(data["description"], 240)
        note = sent_note(command)
        if note:
            extra["note"] = {key: clip(value, 600) for key, value in note.items()}
            whom = note.get("to") or "note %s" % note.get("id", "")
            return ("command", _first_line("%s %s: %s" % (_NOTE_VERBS[note["kind"]], whom, note["text"]), 400),
                    clip(command, DETAIL_LIMIT), extra)
        return "command", _first_line(command, 400), clip(command, DETAIL_LIMIT), extra
    if name in ("BashOutput", "KillShell", "KillBash"):
        return "command", name, None, extra
    if name == "Read":
        title = display_path(data.get("file_path"), cwd)
        offset, limit = data.get("offset"), data.get("limit")
        if isinstance(offset, int) and isinstance(limit, int):
            title += ":%d-%d" % (offset, offset + limit - 1)
        return "read", title, None, extra
    if name in ("Edit", "MultiEdit", "Write", "NotebookEdit"):
        path = data.get("file_path") or data.get("notebook_path")
        if isinstance(path, str) and os.path.isabs(path):
            extra["fullPath"] = path
        return "edit", display_path(path, cwd), None, extra
    if name == "Grep":
        title = data.get("pattern") or ""
        if data.get("path"):
            title += " in " + display_path(data["path"], cwd)
        return "search", clip(title, 400), None, extra
    if name == "Glob":
        return "search", clip(data.get("pattern") or "", 400), None, extra
    if name == "WebFetch":
        return "web", clip(data.get("url") or "", 400), clip(data.get("prompt") or "", DETAIL_LIMIT) or None, extra
    if name == "WebSearch":
        return "web", clip(data.get("query") or "", 400), None, extra
    if name in ("Agent", "Task"):
        title = data.get("description") or data.get("subagent_type") or "Agent"
        if data.get("subagent_type"):
            extra["agentType"] = clip(data["subagent_type"], 80)
        return "agent", clip(title, 240), clip(data.get("prompt") or "", DETAIL_LIMIT) or None, extra
    if name == "TodoWrite":
        todos = []
        for todo in data.get("todos") or []:
            if isinstance(todo, dict):
                todos.append({"text": clip(todo.get("content") or todo.get("activeForm") or "", 300),
                              "status": todo.get("status") if todo.get("status") in (
                                  "pending", "in_progress", "completed") else "pending"})
        extra["todos"] = todos[:50]
        return "todo", "Updated the task list", None, extra
    if name == "AskUserQuestion":
        questions = [q.get("question") for q in data.get("questions") or []
                     if isinstance(q, dict) and isinstance(q.get("question"), str)]
        title = questions[0] if questions else "Asked a question"
        detail = "\n".join(questions[1:]) or None
        return "question", clip(title, 400), clip(detail, DETAIL_LIMIT) if detail else None, extra
    if name == "ExitPlanMode":
        return "plan", "Proposed a plan", clip(data.get("plan") or "", PLAN_LIMIT) or None, extra
    if name == "Skill":
        return "skill", clip(data.get("skill") or data.get("command") or "skill", 200), None, extra
    for module in harnesses.enabled().values():
        tools = getattr(module, "CHAT_TOOLS", {})
        if name in tools:
            return tools[name](data, cwd)
    if name.startswith("mcp__"):
        _, _, rest = name.partition("__")
        server, _, tool = rest.partition("__")
        return "mcp", "%s · %s" % (server, tool or "tool"), clip(_compact_json(data), DETAIL_LIMIT) or None, extra
    detail = clip(_compact_json(data), DETAIL_LIMIT) if data else None
    return "other", name, detail, extra


def _patch_lines(result):
    """Unified-diff body lines from a Claude edit result, if it has any."""
    hunks = result.get("structuredPatch") if isinstance(result, dict) else None
    lines = []
    if isinstance(hunks, list):
        for hunk in hunks:
            if not isinstance(hunk, dict):
                continue
            lines.append("@@ -%s,%s +%s,%s @@" % (
                hunk.get("oldStart", "?"), hunk.get("oldLines", "?"),
                hunk.get("newStart", "?"), hunk.get("newLines", "?")))
            lines.extend(line for line in hunk.get("lines") or [] if isinstance(line, str))
    return lines


class Reader:
    """Incremental chat items for one transcript file. With ``summary_only``
    it keeps the file's Summary and builds no items."""

    def __init__(self, harness, path, summary_only=False):
        self.harness = harness
        self.path = path
        self.summary_only = summary_only
        self.lock = threading.Lock()
        self._reset(None)

    def _reset(self, identity):
        self.epoch = secrets.token_hex(4)
        self.identity = identity
        self.offset = 0
        self.rev = 0
        self.items = []
        self.index = {}
        self.image_records = {}
        self.record_offset = 0
        self.discard_line = False
        self.behind = False
        self.cwd = None
        self.last_notice = None
        self.pending_bash = None
        self.last_turn_start = None
        self.codex_legacy = False
        self.packed_read = False
        self.summary_stamp = None
        self.summary = run_subagents.Summary()
        self.mcp_calls = {}
        self.unreadable = 0

    @property
    def cursor(self):
        return "%s:%d" % (self.epoch, self.rev)

    def _bump(self):
        self.rev += 1
        return self.rev

    def _add(self, item):
        # Command output belongs to the notice written just before it.
        self.last_notice = None
        existing = self.index.get(item["id"])
        if existing is not None:
            # Codex reports a tool call when it starts and again when it
            # ends, and the second report's time replaces the first.
            if item.get("kind") == "tool" and existing.get("at") != item.get("at"):
                item["startedAt"] = existing.get("startedAt") or existing.get("at")
            existing.update(item)
            existing["rev"] = self._bump()
            return existing
        item["rev"] = self._bump()
        self.items.append(item)
        self.index[item["id"]] = item
        return item

    def _touch(self, item, **changes):
        item.update(changes)
        item["rev"] = self._bump()

    def since(self, cursor):
        """(reset, items) a client holding ``cursor`` still needs."""
        epoch, _, rev = (cursor or "").partition(":")
        if epoch != self.epoch or not rev.isdigit():
            return True, [dict(item) for item in self.items]
        seen = int(rev)
        return False, [dict(item) for item in self.items if item["rev"] > seen]

    def poll(self):
        """Parse whatever the agent appended since the last poll."""
        packed = str(self.path).endswith(".gz")
        try:
            if self.summary_only and self.summary_stamp is not None and not self.behind:
                if self.summary_stamp == self._file_stamp(os.stat(self.path)):
                    return True
            with open(self.path, "rb") as raw:
                stat = os.fstat(raw.fileno())
                identity = (stat.st_dev, stat.st_ino)
                # A gzipped copy never grows and a refresh is a new file, so
                # once read to its end it has nothing more. Seeking a gzip
                # stream decompresses everything before the offset again.
                if packed and identity == self.identity and self.packed_read:
                    return True
                stream = gzip.GzipFile(fileobj=raw, mode="rb") if packed else raw
                # A gzipped copy's size on disk is not the offset's scale.
                size = None if packed else stat.st_size
                if identity != self.identity or (size is not None and size < self.offset):
                    self._reset(identity)
                stream.seek(self.offset)
                remaining = READ_BUDGET
                while remaining > 0:
                    self.record_offset = stream.tell()
                    line = stream.readline(LINE_LIMIT)
                    if not line:
                        break
                    remaining -= len(line)
                    if not line.endswith(b"\n"):
                        if len(line) >= LINE_LIMIT or self.discard_line:
                            self.discard_line = True
                            self.offset = stream.tell()
                            continue
                        break  # the agent is still writing this record
                    self.offset = stream.tell()
                    if self.discard_line:
                        self.discard_line = False
                        continue
                    try:
                        record = json.loads(line)
                    except (ValueError, UnicodeDecodeError):
                        continue
                    if isinstance(record, dict):
                        try:
                            self.summary.feed(self.harness, record)
                            if self.summary_only:
                                continue
                            if self.harness == "codex":
                                self._codex_record(record)
                            else:
                                self._claude_record(record)
                        except Exception:  # noqa: BLE001 - a record shaped in a way the reader does not know
                            self._unreadable(record)
                # Only a spent budget means more is waiting. A half-written last
                # record is the agent mid-append, or a crash that left it so.
                self.behind = remaining <= 0 and (
                    self.offset < size if size is not None else bool(stream.peek(1)))
                self.packed_read = packed and not self.behind
                if self.summary_only:
                    self.summary_stamp = self._file_stamp(stat)
        except (OSError, EOFError):
            return False
        return True

    @staticmethod
    def _file_stamp(stat):
        return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns

    def _unreadable(self, record):
        """Skip a record this reader cannot parse, which usually means the
        agent CLI changed its transcript format, and say so in one notice
        rather than failing the whole conversation."""
        self.unreadable += 1
        if self.summary_only:
            return
        count = self.unreadable
        text = ("Orc could not read %s of this conversation, so part of it is missing here. %s may have "
                "changed its transcript format; `orc-harness-compat` checks."
                % ("1 entry" if count == 1 else "%d entries" % count,
                   "Codex" if self.harness == "codex" else "Claude Code"))
        found = self.index.get("unreadable")
        if found is None:
            at = record.get("timestamp") if isinstance(record.get("timestamp"), str) else None
            self._add({"id": "unreadable", "kind": "notice", "tone": "error", "at": at, "text": text})
        else:
            self._touch(found, text=text)

    # ---------- Claude Code ----------

    def _claude_record(self, record):
        if record.get("isSidechain"):
            return
        kind = record.get("type")
        if isinstance(record.get("cwd"), str):
            self.cwd = record["cwd"]
        if kind == "assistant":
            self._claude_assistant(record)
        elif kind == "user":
            self._claude_user(record)
        elif kind == "system":
            self._claude_system(record)
        elif kind == "attachment":
            self._claude_queued(record)
            self._claude_steered(record)

    def _claude_assistant(self, record):
        message = record.get("message")
        if not isinstance(message, dict):
            return
        at = record.get("timestamp")
        uid = record.get("uuid") or secrets.token_hex(6)
        blocks = message.get("content")
        if record.get("isApiErrorMessage"):
            self._add({"id": uid, "kind": "notice", "tone": "error", "at": at,
                       "text": clip(_flatten(blocks) or "The model request failed", 600)})
            return
        if not isinstance(blocks, list):
            return
        for position, block in enumerate(blocks):
            if not isinstance(block, dict):
                continue
            block_id = "%s:%d" % (uid, position)
            block_type = block.get("type")
            if block_type == "text":
                text = (block.get("text") or "").strip()
                if text and text != "(no content)":
                    self._add({"id": block_id, "kind": "assistant", "at": at,
                               "text": clip(text, TEXT_LIMIT)})
            elif block_type in ("thinking", "redacted_thinking"):
                item = {"id": block_id, "kind": "thinking", "at": at,
                        "text": clip((block.get("thinking") or "").strip(), DETAIL_LIMIT)}
                if isinstance(record.get("thinkingDurationMs"), (int, float)):
                    item["durationMs"] = int(record["thinkingDurationMs"])
                self._add(item)
            elif block_type in ("tool_use", "server_tool_use") and block.get("id"):
                name = block.get("name") or "tool"
                category, title, detail, extra = describe_claude_tool(
                    name, block.get("input"), self.cwd)
                item = {"id": "tool:" + block["id"], "kind": "tool", "at": at,
                        "name": name, "category": category, "title": title,
                        "status": "running"}
                if detail:
                    item["detail"] = detail
                item.update(extra)
                self._add(item)
                self._remember_mcp_call(block["id"], name, block.get("input"), at)

    def _remember_mcp_call(self, tool_id, name, arguments, at):
        if not name.startswith("mcp__") or not isinstance(arguments, dict):
            return
        server, _, tool = name[len("mcp__"):].partition("__")
        if server and tool and mcp_arguments_fit(arguments):
            self.mcp_calls[tool_id] = {"server": server, "tool": tool, "arguments": arguments, "at": at}

    def _claude_user(self, record):
        message = record.get("message")
        if not isinstance(message, dict):
            return
        content = message.get("content")
        at = record.get("timestamp")
        uid = record.get("uuid") or secrets.token_hex(6)
        origin = (record.get("origin") or {}).get("kind") if isinstance(record.get("origin"), dict) else None
        if isinstance(content, list):
            results = [block for block in content
                       if isinstance(block, dict) and block.get("type") == "tool_result"]
            for block in results:
                self._claude_tool_result(block, record.get("toolUseResult"), at)
            if results:
                return
        if record.get("isCompactSummary"):
            return
        text = unwrap_pasted_content(_flatten(content).strip())
        if origin == "peer":
            sender = AGENT_FROM.search(text)
            self._turn_notice(uid, at, "Message from another agent"
                              + (" (%s)" % sender.group(1) if sender else ""), text)
            return
        if record.get("isMeta"):
            return
        images = sum(1 for block in content if isinstance(block, dict)
                     and block.get("type") == "image") if isinstance(content, list) else 0
        # Every agent turn echoes its whole prompt, Orc's context block included.
        text = orc_context.strip(text).strip()
        match = LEADING_COMMAND.match(text)
        if match and match.group(1) in ORC_COMMANDS:
            self._user_prompt(uid, at, unwrap_launch(match.group(2) or ""), match.group(1), images, origin)
            return
        if text in INTERRUPTED:
            self._add({"id": uid, "kind": "interrupt", "at": at,
                       "text": "Interrupted"})
            return
        if text.startswith("<local-command-caveat>"):
            return
        if text.startswith("<local-command-stdout>"):
            output = clip((LOCAL_STDOUT.search(text) or [None, ""])[1].strip(), DETAIL_LIMIT)
            if output and self.last_notice is not None:
                self._touch(self.last_notice, detail=output)
            elif output:
                self._add({"id": uid, "kind": "notice", "tone": "info", "at": at,
                           "text": _first_line(output, 600)})
            return
        if text.startswith("<bash-input>"):
            command = (BASH_INPUT.search(text) or [None, ""])[1].strip()
            self.pending_bash = self._add({
                "id": uid, "kind": "tool", "at": at, "name": "Bash",
                "category": "command", "title": _first_line(command, 400),
                "detail": clip(command, DETAIL_LIMIT), "status": "running",
                "byUser": True})
            # A headless `!` command arrives with its output in one message.
            if not (BASH_STDOUT.search(text) or BASH_STDERR.search(text)):
                return
        if text.startswith(("<bash-input>", "<bash-stdout>", "<bash-stderr>")):
            stdout = (BASH_STDOUT.search(text) or [None, ""])[1]
            stderr = (BASH_STDERR.search(text) or [None, ""])[1]
            if self.pending_bash is not None:
                self._touch(self.pending_bash, status="error" if stderr.strip() and not stdout.strip() else "done",
                            output=clip((stdout + ("\n" if stdout and stderr else "") + stderr).strip(), OUTPUT_LIMIT))
                self.pending_bash = None
            return
        if text.startswith("<task-notification>"):
            summary = (TASK_SUMMARY.search(text) or [None, ""])[1].strip()
            status = (TASK_STATUS.search(text) or [None, ""])[1].strip()
            self._turn_notice(uid, at, summary or "Background task update",
                              ("Status: " + status) if status else None)
            return
        if text.startswith("<agent-message"):
            sender = AGENT_FROM.search(text)
            self._turn_notice(uid, at, "Message from another agent"
                              + (" (%s)" % sender.group(1) if sender else ""), text)
            return
        if text.startswith("<command-message>") or text.startswith("<command-name>"):
            name = COMMAND_NAME.search(text)
            args = COMMAND_ARGS.search(text)
            name = name.group(1) if name else ""
            args = (args.group(1) if args else "").strip()
            if args or name in ORC_COMMANDS:
                self._user_prompt(uid, at, unwrap_launch(args), name or None, images, origin)
            else:
                self.last_notice = self._add({"id": uid, "kind": "notice", "tone": "info",
                                              "at": at, "text": "Ran " + (name or "a command")})
            return
        if not text and not images:
            return
        self._user_prompt(uid, at, text, None, images, origin)

    def _claude_queued(self, record):
        """A message that reached the agent mid-turn. Claude Code records it
        as a queued_command attachment rather than a user record, and the
        turn it lands in carries on rather than starting over."""
        attachment = record.get("attachment")
        if not isinstance(attachment, dict) or attachment.get("type") != "queued_command":
            return
        prompt = attachment.get("prompt")
        text = unwrap_pasted_content((prompt if isinstance(prompt, str) else _flatten(prompt)).strip())
        if not text:
            return
        at = attachment.get("timestamp") or record.get("timestamp")
        uid = record.get("uuid") or secrets.token_hex(6)
        origin = attachment.get("origin") if isinstance(attachment.get("origin"), dict) else {}
        if attachment.get("commandMode") == "task-notification" or text.startswith("<task-notification>"):
            summary = (TASK_SUMMARY.search(text) or [None, ""])[1].strip()
            self._add({"id": uid, "kind": "notice", "tone": "info", "at": at,
                       "text": clip(summary or "Background task update", 600)})
        elif origin.get("kind") == "peer" or text.startswith("<agent-message"):
            sender = origin.get("from") or (AGENT_FROM.search(text) or [None, None])[1]
            self._add({"id": uid, "kind": "notice", "tone": "info", "at": at,
                       "text": "Message from another agent" + (" (%s)" % sender if sender else ""),
                       "detail": clip(text, DETAIL_LIMIT)})
        elif self._note_item(uid, at, text):
            self._add(self._note_item(uid, at, text, steer=True))
        else:
            item = user_message(uid, at, text, steer=True)
            if origin.get("kind") not in (None, "human"):
                item["source"] = origin["kind"]
            self._add(item)

    def _claude_steered(self, record):
        """Chat messages a headless turn took mid-turn through its PostToolUse
        hook. They read as the person's own messages, like a queued_command."""
        attachment = record.get("attachment")
        if not isinstance(attachment, dict) or attachment.get("type") != "hook_additional_context":
            return
        content = attachment.get("content")
        texts = [part for part in (content if isinstance(content, list) else [content])
                 if isinstance(part, str)]
        at = record.get("timestamp")
        uid = record.get("uuid") or secrets.token_hex(6)
        for index, message in enumerate(m for text in texts for m in CHAT_STEER.findall(text)):
            note = self._note_item("%s:%d" % (uid, index), at, message, steer=True)
            if note:
                self._add(note)
                continue
            if message.strip():
                self._add(user_message("%s:%d" % (uid, index), at, message.strip(), steer=True))

    @staticmethod
    def _note_item(uid, at, text, **extra):
        """A note another run in this run's group sent, or the answer to one
        this run asked: Chat shows who it is from, not Orc's markup."""
        note = run_notes.parse_marker(text)
        if not note:
            return None
        return {"id": uid, "kind": "user", "at": at, "text": clip(note["text"], TEXT_LIMIT),
                "note": {key: clip(str(note.get(key) or ""), 600)
                         for key in ("id", "kind", "from", "label", "question")}, **extra}

    def _user_prompt(self, uid, at, text, command, images, origin):
        note = self._note_item(uid, at, text)
        if note:
            self.last_turn_start = self._add(note)
            return
        if RESCUE_HANDOFF.match(text or ""):
            draft = RESCUE_USER_PROMPT.search(text or "")
            if not draft or not draft.group(1).strip():
                self.last_turn_start = self._add({"id": uid, "kind": "handoff", "at": at})
                return
            text = draft.group(1).strip()
            command = None
        text, forwarded = unwrap_forwarded(text)
        item = user_message(uid, at, text, command=command)
        if forwarded:
            item["forwardedFrom"] = forwarded
        if images:
            item["imageCount"] = images
        if origin not in (None, "human"):
            item["source"] = origin
        self.last_turn_start = self._add(item)

    def _turn_notice(self, uid, at, text, detail=None):
        """A message the agent answers that the person did not type."""
        item = {"id": uid, "kind": "notice", "tone": "info", "at": at,
                "text": clip(text, 600), "turn": True}
        if detail:
            item["detail"] = clip(detail, DETAIL_LIMIT)
        self.last_turn_start = self._add(item)

    def _codex_question_reply(self, uid, at, text):
        """The person's pick lands on the question it answers; the reply itself
        only marks where Codex picks the turn back up."""
        match = re.fullmatch(r"<send_user_message_question_reply>\s*(.*?)\s*</send_user_message_question_reply>",
                             text, re.S)
        try:
            replies = json.loads(match[1]) if match else None
        except ValueError:
            replies = None
        if not isinstance(replies, list):
            self._turn_notice(uid, at, "Answered a question from Codex", text)
            return
        answers = []
        for reply in replies:
            if not isinstance(reply, dict) or not isinstance(reply.get("answer"), str):
                continue
            answers.append(reply["answer"])
            try:
                _, call_id, index = json.loads(reply.get("questionItemId") or "")
                question = self.index["cx:%s" % call_id]["questions"][index]
            except (ValueError, TypeError, KeyError, IndexError):
                continue
            question["answer"] = clip(reply["answer"], 2000)
            self._touch(self.index["cx:%s" % call_id])
        self._turn_notice(uid, at, "You answered")
        if answers:
            self._touch(self.last_turn_start, answer=clip("\n".join(answers), 2000))

    def _claude_tool_result(self, block, result, at):
        item = self.index.get("tool:" + str(block.get("tool_use_id")))
        if item is None:
            return
        text = _flatten(block.get("content")).strip()
        changes = {"status": "done", "endedAt": at}
        if block.get("is_error"):
            changes["status"] = "declined" if text.startswith(DECLINED) else "error"
            exit_code = EXIT_CODE.match(text)
            if exit_code:
                changes["exitCode"] = int(exit_code.group(1))
        if isinstance(result, dict) and result.get("interrupted"):
            changes["status"] = "interrupted"
        category = item.get("category")
        if category == "read":
            file_info = result.get("file") if isinstance(result, dict) else None
            if isinstance(file_info, dict) and isinstance(file_info.get("numLines"), int):
                changes["detail"] = "%d lines" % file_info["numLines"]
            if changes["status"] != "done":
                changes["output"] = clip(text, OUTPUT_LIMIT)
        elif category == "edit":
            lines = _patch_lines(result)
            if lines:
                added, removed = diff_counts(lines)
                changes["diff"] = clip("\n".join(lines), DIFF_LIMIT)
            elif isinstance(result, dict) and result.get("type") == "create" and isinstance(result.get("content"), str):
                added, removed = len(result["content"].splitlines()), 0
            else:
                added = removed = None
            if added is not None and changes["status"] == "done":
                changes["files"] = [{"path": item.get("title") or "", "fullPath": item.get("fullPath"),
                                     "additions": added, "deletions": removed}]
            if changes["status"] != "done":
                changes["output"] = clip(text, OUTPUT_LIMIT)
        elif category == "todo":
            if changes["status"] != "done":
                changes["output"] = clip(text, OUTPUT_LIMIT)
        else:
            if isinstance(result, dict) and isinstance(result.get("stdout"), str):
                stdout, stderr = result.get("stdout") or "", result.get("stderr") or ""
                text = (stdout + ("\n" if stdout and stderr else "") + stderr).strip() or text
            changes["output"] = clip(text, OUTPUT_LIMIT)
        images = self._record_images(block)
        if images:
            changes["images"] = images
        self._touch(item, **changes)

    def _claude_system(self, record):
        subtype = record.get("subtype")
        at = record.get("timestamp")
        uid = record.get("uuid") or secrets.token_hex(6)
        if subtype == "turn_duration":
            item = {"id": uid, "kind": "turn-end", "at": at}
            if isinstance(record.get("durationMs"), (int, float)):
                item["durationMs"] = int(record["durationMs"])
            self._add(item)
        elif subtype == "compact_boundary":
            self._add({"id": uid, "kind": "compaction", "at": at,
                       "text": "Conversation compacted"})
        elif subtype == "informational":
            tone = "warning" if record.get("level") == "warning" else "info"
            self._add({"id": uid, "kind": "notice", "tone": tone, "at": at,
                       "text": clip(record.get("content") or "", 600)})
        elif subtype == "local_command":
            name = COMMAND_NAME.search(record.get("content") or "")
            self.last_notice = self._add({"id": uid, "kind": "notice", "tone": "info", "at": at,
                                          "text": "Ran " + (name.group(1) if name else "a command")})
        elif subtype == "scheduled_task_fire":
            self._turn_notice(uid, at, record.get("content") or "Scheduled task fired",
                              record.get("prompt"))
        elif subtype == "api_error":
            self._add({"id": uid, "kind": "notice", "tone": "error", "at": at,
                       "text": clip(record.get("content") or "The model request failed", 600)})

    # ---------- Codex ----------

    def _codex_record(self, record):
        payload = record.get("payload")
        if not isinstance(payload, dict):
            return
        at = record.get("timestamp")
        kind = record.get("type")
        if kind == "turn_context":
            return
        if kind == "session_meta":
            if isinstance(payload.get("cwd"), str):
                self.cwd = payload["cwd"]
            return
        # Current rollouts describe every turn item in item_completed events
        # and repeat the raw model calls as response_items. Older ones (before
        # Codex 0.150) only have the raw calls, announced by legacy
        # user_message events, so those are read only after one of them.
        if kind == "response_item":
            if payload.get("type") in ("custom_tool_call_output", "function_call_output"):
                images = self._record_images(record)
                if images:
                    self._add({"id": "images:" + str(payload.get("call_id")), "kind": "tool",
                               "at": at, "name": "images", "category": "read",
                               "title": "Tool images", "status": "done", "images": images})
            if self.codex_legacy:
                self._codex_legacy_call(payload, at)
            return
        if kind != "event_msg":
            return
        event = payload.get("type")
        if event == "user_message":
            self.codex_legacy = True
            text = orc_context.strip(unwrap_pasted_content((payload.get("message") or "").strip())).strip()
            if text:
                command = None
                match = LEADING_COMMAND.match(text)
                if match and match.group(1) in ORC_COMMANDS:
                    command, text = match.group(1), unwrap_launch(match.group(2) or "")
                self._user_prompt("cx-user:%s:%d" % (at, self.rev), at, text, command, 0, None)
        elif event == "agent_message":
            self.codex_legacy = True
            text = (payload.get("message") or "").strip()
            if text:
                self._add({"id": "cx-msg:%s:%d" % (at, self.rev), "kind": "assistant",
                           "at": at, "text": clip(text, TEXT_LIMIT)})
        elif event == "patch_apply_end" and payload.get("call_id"):
            self._codex_item({"type": "FileChange", "id": payload["call_id"],
                              "changes": payload.get("changes") or {},
                              "status": "completed" if payload.get("success", True) else "failed",
                              "stdout": payload.get("stdout"), "stderr": payload.get("stderr")}, at, True)
        elif event == "sub_agent_activity":
            self._codex_item({"type": "SubAgentActivity", "id": payload.get("event_id") or at,
                              "agent_thread_id": payload.get("agent_thread_id"),
                              "agent_path": payload.get("agent_path"),
                              "kind": payload.get("kind")}, at, True)
        elif event == "task_complete":
            item = {"id": "turn-end:%s" % payload.get("turn_id"), "kind": "turn-end", "at": at}
            if isinstance(payload.get("duration_ms"), (int, float)):
                item["durationMs"] = int(payload["duration_ms"])
            self._add(item)
        elif event == "turn_aborted":
            self._add({"id": "aborted:%s" % payload.get("turn_id"), "kind": "interrupt",
                       "at": at, "text": "Interrupted"})
            item = {"id": "turn-end:%s" % payload.get("turn_id"), "kind": "turn-end", "at": at}
            if isinstance(payload.get("duration_ms"), (int, float)):
                item["durationMs"] = int(payload["duration_ms"])
            self._add(item)
        elif event == "context_compacted":
            self._add({"id": "compacted:%s:%s" % (at, self.rev), "kind": "compaction",
                       "at": at, "text": "Conversation compacted"})
        elif event in ("error", "stream_error"):
            self._add({"id": "error:%s:%s" % (at, self.rev), "kind": "notice", "tone": "error",
                       "at": at, "text": clip(payload.get("message") or "Codex reported an error", 600)})
        elif event in ("item_started", "item_completed") and isinstance(payload.get("item"), dict):
            self._codex_item(payload["item"], at, event == "item_completed")

    def _codex_item(self, item, at, completed):
        item_type = item.get("type")
        raw_id = item.get("id")
        if not raw_id:
            return
        uid = "cx:%s" % raw_id
        if item_type == "UserMessage":
            text = orc_context.strip(unwrap_pasted_content("\n".join(
                part.get("text") or "" for part in item.get("content") or []
                if isinstance(part, dict)).strip())).strip()
            if not text:
                return
            if text.startswith("<send_user_message_question_reply"):
                self._codex_question_reply(uid, at, text)
                return
            command = None
            match = LEADING_COMMAND.match(text)
            if match and match.group(1) in ORC_COMMANDS:
                command, text = match.group(1), unwrap_launch(match.group(2) or "")
            self._user_prompt(uid, at, text, command, 0, None)
        elif item_type == "AgentMessage":
            text = "\n".join(part.get("text") or "" for part in item.get("content") or []
                             if isinstance(part, dict)).strip()
            questions = [{"title": clip(q["title"], 2000),
                          "options": [clip(o, 400) for o in q.get("options") or [] if isinstance(o, str)][:20]}
                         for q in item.get("questions") or []
                         if isinstance(q, dict) and isinstance(q.get("title"), str)]
            if text or questions:
                entry = {"id": uid, "kind": "assistant", "at": at, "text": clip(text, TEXT_LIMIT)}
                if questions:
                    entry["questions"] = questions[:3]
                self._add(entry)
        elif item_type == "Reasoning":
            text = "\n\n".join(part for part in item.get("summary_text") or []
                               if isinstance(part, str)).strip()
            self._add({"id": uid, "kind": "thinking", "at": at, "text": clip(text, DETAIL_LIMIT)})
        elif item_type == "ContextCompaction":
            # Codex 0.169 writes this item where older releases wrote a context_compacted event.
            self._add({"id": uid, "kind": "compaction", "at": at, "text": "Conversation compacted"})
        elif item_type == "CommandExecution":
            self._add(self._codex_command(item, uid, at, completed))
        elif item_type == "FileChange":
            files, diffs = [], []
            for path, change in (item.get("changes") or {}).items():
                change = change if isinstance(change, dict) else {}
                diff = change.get("unified_diff") or ""
                added, removed = diff_counts(diff.splitlines())
                target = change.get("move_path") or path
                shown = display_path(target, self.cwd)
                full = os.path.join(self.cwd, target) if self.cwd and isinstance(target, str) else target
                files.append({"path": shown, "fullPath": full if isinstance(full, str) and os.path.isabs(full) else None,
                              "additions": added, "deletions": removed})
                if diff:
                    diffs.append("--- " + shown + "\n" + diff)
            title = files[0]["path"] if len(files) == 1 else "%d files" % len(files)
            entry = {"id": uid, "kind": "tool", "at": at, "name": "FileChange",
                     "category": "edit", "title": title,
                     "status": self._codex_status(item, completed)}
            if entry["status"] == "done":
                entry["files"] = files
            if diffs:
                entry["diff"] = clip("\n".join(diffs), DIFF_LIMIT)
            if entry["status"] != "done":
                entry["output"] = clip(((item.get("stderr") or "") + (item.get("stdout") or "")).strip(), OUTPUT_LIMIT)
            self._add(entry)
        elif item_type == "McpToolCall":
            result = item.get("result")
            output = _flatten(result.get("content")) if isinstance(result, dict) else ""
            entry = {"id": uid, "kind": "tool", "at": at, "name": "mcp",
                     "category": "mcp",
                     "title": "%s · %s" % (item.get("server") or "mcp", item.get("tool") or "tool"),
                     "status": self._codex_status(item, completed),
                     "output": clip(output, OUTPUT_LIMIT)}
            arguments = item.get("arguments")
            if arguments:
                entry["detail"] = clip(_compact_json(arguments), DETAIL_LIMIT)
            images = self._record_images(item)
            if images:
                entry["images"] = images
            self._add(entry)
        elif item_type == "Extension":
            query = item.get("query") or (item.get("action") or {}).get("query") or ""
            self._add({"id": uid, "kind": "tool", "at": at, "name": "web_search",
                       "category": "web" if "search" in (item.get("kind") or "") else "other",
                       "title": clip(query or item.get("kind") or "extension", 400),
                       "status": "done" if completed else "running"})
        elif item_type == "ImageView":
            self._add({"id": uid, "kind": "tool", "at": at, "name": "view_image",
                       "category": "read", "title": display_path(item.get("path"), self.cwd),
                       "status": "done" if completed else "running"})
        elif item_type == "SubAgentActivity":
            thread = item.get("agent_thread_id") or raw_id
            existing = self.index.get("cx-agent:%s" % thread)
            status = "running" if item.get("kind") in ("started", "spawned") else "done"
            if existing is not None:
                self._touch(existing, status=status)
            else:
                self._add({"id": "cx-agent:%s" % thread, "kind": "tool", "at": at,
                           "name": "agent", "category": "agent",
                           "title": clip(item.get("agent_path") or "Sub-agent", 240),
                           "status": status})
        elif item_type == "CollabAgentToolCall":
            if item.get("tool") == "wait":
                return
            self._add({"id": uid, "kind": "tool", "at": at, "name": "agent",
                       "category": "agent", "title": clip(item.get("tool") or "agent", 240),
                       "status": self._codex_status(item, completed)})
        elif item_type:
            self._add({"id": uid, "kind": "tool", "at": at, "name": item_type,
                       "category": "other", "title": item_type,
                       "status": "done" if completed else "running"})

    def _record_images(self, record):
        images = []
        for index, url in enumerate(image_blocks(record)):
            if index >= 12:
                break
            digest = hashlib.sha256(url.encode()).hexdigest()
            key = "%s:%d:%s" % (self.epoch, self.record_offset, digest)
            self.image_records[key] = (self.record_offset, digest)
            images.append(key)
        return images

    def _codex_legacy_call(self, payload, at):
        """A tool call from a pre-0.150 rollout, which has no item events."""
        call_type = payload.get("type")
        call_id = payload.get("call_id")
        if not call_id:
            return
        uid = "cx:%s" % call_id
        if call_type == "custom_tool_call":
            source = payload.get("input") or ""
            command = LEGACY_EXEC_CMD.search(source) if payload.get("name") == "exec" else None
            if command:
                try:
                    script = json.loads(command.group(1))
                except ValueError:
                    script = source
                self._add({"id": uid, "kind": "tool", "at": at, "name": "exec",
                           "category": "command", "title": _first_line(script, 400),
                           "detail": clip(script, DETAIL_LIMIT), "status": "running"})
            elif uid not in self.index:
                self._add({"id": uid, "kind": "tool", "at": at,
                           "name": payload.get("name") or "tool", "category": "other",
                           "title": payload.get("name") or "tool",
                           "detail": clip(source, DETAIL_LIMIT), "status": "running"})
        elif call_type == "function_call":
            name = payload.get("name") or "tool"
            self._add({"id": uid, "kind": "tool", "at": at, "name": name,
                       "category": "agent" if "agent" in name else "other", "title": name,
                       "detail": clip(payload.get("arguments") or "", DETAIL_LIMIT),
                       "status": "running"})
        elif call_type in ("custom_tool_call_output", "function_call_output"):
            item = self.index.get(uid)
            if item is None:
                return
            output = payload.get("output")
            if isinstance(output, list):
                output = "\n".join(part.get("text") or "" for part in output if isinstance(part, dict))
            output = LEGACY_EXEC_PREAMBLE.sub("", output or "", count=1)
            changes = {"status": "done" if item["status"] == "running" else item["status"], "endedAt": at}
            if item.get("category") != "edit":
                changes["output"] = clip(output.strip(), OUTPUT_LIMIT)
            self._touch(item, **changes)

    @staticmethod
    def _codex_status(item, completed):
        status = item.get("status")
        if status in ("failed", "error"):
            return "error"
        if status in ("declined", "rejected"):
            return "declined"
        if status in ("inProgress", "in_progress", "running") or not completed:
            return "running"
        exit_code = item.get("exit_code")
        if isinstance(exit_code, int) and exit_code != 0:
            return "error"
        return "done"

    def _codex_command(self, item, uid, at, completed):
        command = item.get("command")
        if isinstance(command, list):
            script = command[-1] if len(command) >= 3 and command[-2] in ("-lc", "-c") else " ".join(command)
        else:
            script = command or ""
        parsed = [part for part in item.get("parsed_cmd") or [] if isinstance(part, dict)]
        category = "command"
        title = _first_line(script, 400)
        if parsed and all(part.get("type") == "read" for part in parsed):
            category = "read"
            title = ", ".join(display_path(part.get("path") or part.get("name"), self.cwd)
                              for part in parsed)
        elif parsed and all(part.get("type") in ("search", "list_files") for part in parsed):
            category = "search"
        output = item.get("aggregated_output")
        if not isinstance(output, str):
            stdout, stderr = item.get("stdout") or "", item.get("stderr") or ""
            output = (stdout + ("\n" if stdout and stderr else "") + stderr)
        entry = {"id": uid, "kind": "tool", "at": at, "name": "exec", "category": category,
                 "title": clip(title, 400), "detail": clip(script, DETAIL_LIMIT),
                 "status": self._codex_status(item, completed)}
        if category != "read" or entry["status"] == "error":
            entry["output"] = clip(output.strip(), OUTPUT_LIMIT)
        if isinstance(item.get("exit_code"), int):
            entry["exitCode"] = item["exit_code"]
        return entry


def _open_transcript(path):
    return gzip.open(path, "rb") if str(path).endswith(".gz") else open(path, "rb")


def claude_transcript(session_id):
    """The Claude Code transcript for a session id, or None."""
    if not isinstance(session_id, str) or not SESSION_ID.fullmatch(session_id):
        return None
    for root in claude_accounts.transcript_roots():
        matches = sorted(root.glob("*/" + session_id + ".jsonl"))
        if matches:
            return matches[0]
    return None


def codex_rollout(thread_id):
    """The Codex rollout for a thread id, or None."""
    # Codex's index keeps a rollout's path after the file is deleted.
    path = codex_questions.rollout_path(thread_id)
    if path is not None and path.is_file():
        return path
    if not isinstance(thread_id, str) or not codex_questions.THREAD_ID.fullmatch(thread_id):
        return None
    sessions = codex_questions.home() / "sessions"
    matches = sorted(sessions.glob("*/*/*/rollout-*-%s.jsonl" % thread_id))
    return matches[-1] if matches else None


def locate(harness, owner, retry_seconds=None):
    """A cached transcript path for (harness, owner), re-looked-up on a miss
    at most every ``retry_seconds``, LOOKUP_RETRY_SECONDS unless given."""
    key = (harness, owner, str(Path.home()))
    cached = _paths.get(key)
    now = time.monotonic()
    if cached is not None:
        path, checked = cached
        if path is not None and path.exists():
            return path
        if retry_seconds is None:
            retry_seconds = LOOKUP_RETRY_SECONDS
        if path is None and now - checked < retry_seconds:
            return None
    path = claude_transcript(owner) if harness == "claude" else codex_rollout(owner)
    if len(_paths) >= 1024:
        _paths.clear()
    _paths[key] = (path, now)
    return path


def _cached_reader(cache, limit, harness, path, summary_only):
    key = (harness, str(path))
    with _readers_lock:
        reader = cache.get(key)
        if reader is None:
            reader = cache[key] = Reader(harness, path, summary_only)
        cache.move_to_end(key)
        while len(cache) > limit:
            cache.popitem(last=False)
        return reader


def _reader(harness, path):
    return _cached_reader(_readers, READERS_MAX, harness, path, False)


def summary_reader(harness, path):
    """The reader for a transcript only its Summary is wanted from: a
    subagent's, or any file a cost estimate adds up."""
    return _cached_reader(_summary_readers, SUMMARY_READERS_MAX, harness, path, True)


def harness_of(meta):
    harness = meta.get("harness")
    if harnesses.known(harness):
        return harness
    return "claude" if meta.get("sessionId") else None


def _runs_dir():
    return os.environ.get("ORC_RUNS_DIR") or os.path.join(os.path.expanduser("~"), ".orc", "runs")


def _run_dir(meta):
    run_id = meta.get("runId")
    if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id) or ".." in run_id:
        return None
    return os.path.join(_runs_dir(), run_id)


def _owner(harness, meta):
    owner = meta.get("sessionId") if harness == "claude" else meta.get("codexThreadId")
    return owner if isinstance(owner, str) and owner else None


def _saved_owner(meta):
    harness = harness_of(meta)
    owner = _owner(harness, meta) if harness in ("claude", "codex") else None
    return owner if owner and SESSION_ID.fullmatch(owner) else None


def conversation_copy(meta, run_dir):
    """(original, link, packed) for a Claude or Codex run's conversation: the
    transcript or rollout on this machine, or None once it is gone, and where
    archiving keeps a hard link to it or a gzipped copy in ``run_dir``. None
    for a run with no such conversation."""
    owner = _saved_owner(meta)
    if owner is None:
        return None
    original = locate(harness_of(meta), owner)
    return (original, Path(run_dir) / (SAVED_LINK % owner),
            Path(run_dir) / (SAVED_TRANSCRIPT % owner))


def kept_conversation(link, packed):
    """Whichever of a saved link and gzipped copy exists, the link first."""
    for path in (link, packed):
        try:
            if stat.S_ISREG(os.lstat(path).st_mode):
                return path
        except OSError:
            continue
    return None


def saved_conversation(meta):
    """The conversation archiving kept in the run folder, or None."""
    owner, run_dir = _saved_owner(meta), _run_dir(meta)
    if owner is None or run_dir is None:
        return None
    return kept_conversation(Path(run_dir) / (SAVED_LINK % owner),
                             Path(run_dir) / (SAVED_TRANSCRIPT % owner))


def _harness_transcript(meta, run_dir=None):
    """A harness package's turns gathered in the run folder, or None before
    its first turn wrote anything. ``run_dir`` names another folder of
    headless turns in place of the run's. With the package off, what it
    already gathered still reads as history."""
    if run_dir is None:
        run_dir = _run_dir(meta)
        if run_dir is None:
            return None
    if not os.path.isdir(os.path.join(run_dir, headless_session.STATE_DIR)):
        return None
    harness = harness_of(meta)
    module = harnesses.get(harness)
    try:
        path = Path(module.sync_transcript(run_dir) if module is not None
                    else headless_session.harness_transcript(run_dir, harness))
        return path if path.is_file() and path.stat().st_size else None
    except OSError:
        return None


def session_transcript(meta):
    """(harness, transcript path) for a run's own conversation, or
    (harness, None) when it has none on this machine yet."""
    harness = harness_of(meta)
    if harness not in harnesses.CORE_AGENTS:
        return harness, _harness_transcript(meta)
    owner = _owner(harness, meta) if harness else None
    return harness, ((locate(harness, owner) or saved_conversation(meta)) if owner else None)


effort_level = run_subagents.effort_level


def launch_effort(args):
    for index, arg in enumerate(args):
        if arg == "--effort" and index + 1 < len(args):
            return effort_level(args[index + 1])
        if arg.startswith("model_reasoning_effort="):
            return effort_level(arg.split("=", 1)[1].strip('"\''))
    return None


def launch_fast(args):
    if 'service_tier="ultrafast"' in args:
        return "ultrafast"
    return any(flag in args for flag in ('service_tier="fast"', '{"fastMode": true}', '--fast'))


def launch_model(args):
    for index, arg in enumerate(args):
        if arg == "--model" and index + 1 < len(args):
            model = str(args[index + 1]).strip()
            return model if model and model != "default" else None
    return None


def _switch_divider_text(harness, model=None, effort=None, account=None):
    parts = []
    if isinstance(model, str) and model.strip() and model != "default":
        parts.append(model.strip())
    elif harness:
        parts.append(harnesses.label(harness))
    if isinstance(effort, str) and effort.strip():
        parts.append(effort.strip().capitalize())
    label = " ".join(parts) or "new session"
    if account:
        label = "%s (~/%s)" % (label, account)
    return "Switched to " + label


def _history_transcript(entry, run_dir=None):
    prev_harness = entry.get("harness") or ("claude" if entry.get("sessionId") else None)
    if not prev_harness or not harnesses.known(prev_harness):
        return None, None
    retained = entry.get("retainedTranscript")
    if isinstance(retained, str) and retained:
        candidate = Path(retained)
        try:
            if candidate.is_file() and candidate.stat().st_size > 0:
                return prev_harness, candidate
        except OSError:
            pass
    if prev_harness in ("claude", "codex"):
        prev_owner = entry.get("sessionId") if prev_harness == "claude" else entry.get("codexThreadId")
        if isinstance(prev_owner, str) and prev_owner:
            found = locate(prev_harness, prev_owner)
            if found is not None:
                return prev_harness, found
            if run_dir and SESSION_ID.fullmatch(prev_owner):
                saved = kept_conversation(Path(run_dir) / (SAVED_LINK % prev_owner),
                                          Path(run_dir) / (SAVED_TRANSCRIPT % prev_owner))
                if saved is not None:
                    return prev_harness, saved
    return prev_harness, None


def _superseded_history(meta):
    history = meta.get("sessionHistory")
    if not isinstance(history, list):
        return []
    return [entry for entry in history if isinstance(entry, dict) and entry.get("state") == "superseded"]


def _history_items(meta, superseded, current_path=None, harness_run_dir=None):
    run_dir = harness_run_dir or _run_dir(meta)
    items = []
    for pos, entry in enumerate(superseded):
        prev_harness, prev_path = _history_transcript(entry, run_dir=run_dir)
        if prev_harness and prev_path is not None and (current_path is None or prev_path != current_path):
            reader = _reader(prev_harness, prev_path)
            with reader.lock:
                reader.poll()
                _, segment = reader.since(None)
            for item in segment:
                copy = dict(item)
                copy["id"] = "h%d:%s" % (pos, item["id"])
                items.append(copy)
        switched = entry.get("switchedTo") if isinstance(entry.get("switchedTo"), dict) else {}
        next_entry = superseded[pos + 1] if pos + 1 < len(superseded) else None
        target_harness = switched.get("harness") or (next_entry.get("harness") if next_entry else harness_of(meta))
        target_model = switched.get("model") or (None if next_entry else meta.get("launchModel"))
        target_effort = switched.get("effort") or (None if next_entry else meta.get("launchEffort"))
        target_account = switched.get("claudeAccount") or (
            next_entry.get("claudeAccount") if next_entry else meta.get("claudeAccount")
        )
        account_changed = (
            target_harness == "claude"
            and prev_harness == "claude"
            and bool(target_account)
            and target_account != entry.get("claudeAccount")
        )
        token = entry.get("token") or str(pos)
        divider = {
            "id": "switch:%s" % token,
            "kind": "model-switch",
            "at": entry.get("supersededAt"),
            "harness": target_harness,
            "text": _switch_divider_text(
                target_harness, target_model, target_effort,
                target_account if account_changed else None,
            ),
        }
        if target_model:
            divider["model"] = target_model
        if target_effort:
            divider["effort"] = target_effort
        if target_account:
            divider["claudeAccount"] = target_account
        if account_changed:
            divider["accountChanged"] = True
        items.append(divider)
    return items


def timeline(meta, cursor=None, harness_run_dir=None):
    """The chat payload for one run's session: the items ``cursor`` lacks.

    ``state`` says why a payload carries no items: ``waiting`` before the
    agent's hook has recorded its session, ``missing`` when the recorded
    session left no transcript on this machine. ``harness_run_dir`` reads a
    harness package's turns from that folder instead of the run's."""
    harness = harness_of(meta)
    effort = _effort(meta)
    if harness is None:
        return {"supported": False, "harness": harness, "items": [],
                "cursor": None, "reset": True}
    if harness not in harnesses.CORE_AGENTS:
        # A harness transcript lives in the run folder, so only its first output ends the wait.
        path = _harness_transcript(meta, harness_run_dir)
        waiting = path is None
    else:
        owner = _owner(harness, meta)
        waiting = owner is None
        path = None if waiting else (locate(harness, owner) or saved_conversation(meta))
    superseded = _superseded_history(meta)
    if not superseded:
        if waiting:
            return {"supported": True, "harness": harness, "state": "waiting",
                    "items": [], "cursor": None, "reset": True, "effort": effort}
        if path is None:
            return {"supported": True, "harness": harness, "state": "missing",
                    "items": [], "cursor": None, "reset": True, "effort": effort}
        reader = _reader(harness, path)
        with reader.lock:
            reader.poll()
            reset, items = reader.since(cursor)
            return {"supported": True, "harness": harness, "state": "ready",
                    "items": items, "cursor": reader.cursor, "reset": reset,
                    "more": reader.behind, "subagents": _subagents(meta, harness, path, reader),
                    "model": reader.summary.model, "effort": _effort(meta, reader)}
    history_key = "h%d:%s" % (len(superseded), superseded[-1].get("token") or len(superseded))
    if waiting or path is None:
        prior_items = _history_items(meta, superseded, current_path=None, harness_run_dir=harness_run_dir)
        if prior_items:
            wait_cursor = "%s|wait" % history_key
            if cursor == wait_cursor:
                return {"supported": True, "harness": harness, "state": "ready",
                        "items": [], "cursor": wait_cursor, "reset": False, "effort": effort}
            return {"supported": True, "harness": harness, "state": "ready",
                    "items": prior_items, "cursor": wait_cursor, "reset": True, "effort": effort}
        return {"supported": True, "harness": harness, "state": "waiting" if waiting else "missing",
                "items": [], "cursor": None, "reset": True, "effort": effort}
    reader = _reader(harness, path)
    req_history, sep, req_cursor = (cursor or "").partition("|")
    same_history = bool(sep and req_history == history_key)
    with reader.lock:
        reader.poll()
        reset, current_items = reader.since(req_cursor if same_history else None)
        combined_cursor = "%s|%s" % (history_key, reader.cursor)
        if reset or not same_history:
            prior_items = _history_items(meta, superseded, current_path=path, harness_run_dir=harness_run_dir)
            out_items = prior_items + current_items
            reset = True
        else:
            out_items = current_items
        return {"supported": True, "harness": harness, "state": "ready",
                "items": out_items, "cursor": combined_cursor, "reset": reset,
                "more": reader.behind, "subagents": _subagents(meta, harness, path, reader),
                "model": reader.summary.model, "effort": _effort(meta, reader)}


def _launch_effort(meta):
    effort = effort_level(meta.get("launchEffort"))
    if effort:
        return effort
    run_dir = _run_dir(meta)
    launch = headless_session.read_launch(run_dir) if run_dir else None
    if launch and launch["agent"] == harness_of(meta):
        return launch_effort(launch["extraArgs"])
    return None


def _effort(meta, reader=None):
    """The effort a run's agent works at: what its session last reported, or
    what it was launched with until the session says."""
    if reader is not None and reader.summary.effort:
        return {"level": reader.summary.effort, "source": "session"}
    return {"level": _launch_effort(meta), "source": "launch"}


def effective_effort(meta):
    """The run's latest session-reported effort, or its launch effort."""
    harness, path = session_transcript(meta)
    if path is not None:
        reader = summary_reader(harness, path)
        with reader.lock:
            reader.poll()
            if reader.summary.effort:
                return reader.summary.effort
    return _launch_effort(meta)


def _subagents(meta, harness, path, reader):
    """The subagents ``reader``'s transcript started. A settled run's agent is
    gone, so none of them still counts as running."""
    return run_subagents.snapshot(harness, path, reader.summary, summary_reader, locate,
        active=meta.get("status") not in ("complete", "cancelled", "merged", "merged-to-parent"))


def crew(meta):
    """The Factory tab's view of a run's own conversation: the model and
    effort it runs on and the subagents it started, read without building
    chat items."""
    harness, path = session_transcript(meta)
    if path is None:
        return {"harness": harness, "model": None, "effort": _effort(meta), "subagents": [], "more": False}
    reader = summary_reader(harness, path)
    with reader.lock:
        reader.poll()
        return {"harness": harness, "model": reader.summary.model, "effort": _effort(meta, reader),
                "subagents": _subagents(meta, harness, path, reader), "more": reader.behind}


def waterfall(meta, build, live=False, now=None, workers=()):
    """Run Control's waterfall for a run's own conversation: ``build`` (a
    run_waterfall.build with its price bound) over the chat items and model
    calls already read, or None when there is nothing timed to show.
    ``workers`` are the run's Orchestrate tasks, for build to place.
    Returns (payload, whether more of the transcript is still to read)."""
    harness, path = session_transcript(meta)
    if path is None:
        return None, False
    reader = _reader(harness, path)
    with reader.lock:
        reader.poll()
        billed = {}
        subagents = run_subagents.snapshot(
            harness, path, reader.summary, summary_reader, locate, active=live, billed=billed)
        main = {"model": reader.summary.model, "effort": _effort(meta, reader)["level"]}
        return build([dict(item) for item in reader.items], reader.summary.calls_billed(),
                     subagents, billed, live=live, now=now, workers=workers, main=main), reader.behind


def worker_usage(meta):
    """What an Orchestrate worker's own conversation adds to its parent's
    waterfall: the model and effort it ran on, when it last wrote, and its
    model calls with its subagents', read without building chat items. None
    when the worker has no transcript on this machine."""
    harness, path = session_transcript(meta)
    if path is None:
        return None
    reader = summary_reader(harness, path)
    with reader.lock:
        reader.poll()
        billed = {}
        run_subagents.snapshot(harness, path, reader.summary, summary_reader, locate, active=False, billed=billed)
        calls, seen = [], set()
        for key, entry in [*reader.summary.calls_billed(), *(call for rows in billed.values() for call in rows)]:
            # A message a subagent shares with its parent is billed once.
            if key not in seen:
                seen.add(key)
                calls.append((key, entry))
        return {"model": reader.summary.model, "effort": _effort(meta, reader)["level"],
                "updatedAt": reader.summary.updated, "calls": calls, "more": reader.behind}


def mcp_calls(meta, server):
    """(calls, more): the calls this run's Claude agent made to the MCP server
    it knows as ``server``, oldest first, each with how the call ended for the
    agent. ``more`` says a long session has more to read, as the chat's polls
    do, so the caller asks again for its newer calls."""
    harness, transcript = session_transcript(meta)
    if harness != "claude" or transcript is None:
        return [], False
    names = {server, re.sub(r"[^A-Za-z0-9_-]", "_", server)}
    reader = _reader(harness, transcript)
    with reader.lock:
        reader.poll()
        return ([{**call, "status": (reader.index.get("tool:" + tool_id) or {}).get("status")}
                 for tool_id, call in reader.mcp_calls.items() if call["server"] in names], reader.behind)


def changed_by_session(meta, path):
    """Whether this run's own agent wrote ``path``, an absolute path. The
    chat's changed-files card can open such a file even outside the
    checkout, a scratchpad note for one, and nothing else outside it."""
    harness, transcript = session_transcript(meta)
    if transcript is None:
        return False
    wanted = os.path.realpath(path)
    reader = _reader(harness, transcript)
    with reader.lock:
        reader.poll()
        return any(isinstance(file, dict) and isinstance(file.get("fullPath"), str)
                   and os.path.realpath(file["fullPath"]) == wanted
                   for item in reader.items for file in item.get("files") or [])


def image_referenced_by_session(meta, path):
    """Temporary previews live outside the checkout; the assistant's exact image
    link is required before chat may serve one."""
    return path_referenced_by_session(meta, path, image=True)


def _named_paths(text, image):
    """Paths an assistant message names. An image needs an image embed or an
    image file in a code span; any file may also be a link or a bare path."""
    for match in re.finditer(r"(?<!`)(`+)((?:/|~/)[^`\r\n]+)\1(?!`)", text):
        if not image or re.search(r"\.(?:png|jpe?g|webp|gif|bmp|avif)$", match[2], re.I):
            yield match[2]
    embed = r"!" if image else r"!?"
    for match in re.finditer(embed + r'\[(?:\\.|[^\]\\])*\]\(\s*(?:<([^>\r\n]+)>|([^\s)]+))(?:\s+"[^"\r\n]*")?\s*\)', text):
        source = match[1] or match[2]
        if source.lower().startswith("file://"):
            url = urllib.parse.urlsplit(source)
            source = urllib.parse.unquote(url.path) if url.netloc in ("", "localhost") else ""
        yield source
    if not image:
        for match in re.finditer(r"(?<![\w`/~:.])((?:~/|/)[^\s`<>()\[\]\"']+)", text):
            yield match[1].rstrip(".,;:!?")


def path_referenced_by_session(meta, path, image=False):
    """A file outside the run's folders is served only when an assistant
    message names its exact path; the user's own messages never count."""
    harness, transcript = session_transcript(meta)
    if transcript is None:
        return False
    reader = _reader(harness, transcript)
    with reader.lock:
        reader.poll()
        for item in reader.items:
            if item.get("kind") != "assistant":
                continue
            for source in _named_paths(item.get("text", ""), image):
                source = os.path.expanduser(source)
                if (os.path.isabs(source) and not source.startswith("//")
                        and not os.path.islink(source) and os.path.realpath(source) == path):
                    return True
    return False


def _read_transcript_image(harness, path, key):
    reader = _reader(harness, path)
    with reader.lock:
        reader.poll()
        position = reader.image_records.get(key)
        if position is None:
            return None
        offset, wanted = position
        try:
            with _open_transcript(path) as stream:
                info = os.fstat(stream.fileno())
                if (info.st_dev, info.st_ino) != reader.identity:
                    return None
                stream.seek(offset)
                record = json.loads(stream.readline(LINE_LIMIT))
            for url in image_blocks(record):
                if hashlib.sha256(url.encode()).hexdigest() == wanted:
                    match = IMAGE_DATA.fullmatch(url)
                    return base64.b64decode(re.sub(r"\s", "", match[2]), validate=True), match[1]
        except (OSError, EOFError, ValueError, binascii.Error):
            return None
    return None


def transcript_image(meta, key):
    harness, path = session_transcript(meta)
    if harness and path is not None:
        found = _read_transcript_image(harness, path, key)
        if found is not None:
            return found
    run_dir = _run_dir(meta)
    for entry in reversed(_superseded_history(meta)):
        prev_harness, prev_path = _history_transcript(entry, run_dir=run_dir)
        if prev_harness and prev_path is not None and prev_path != path:
            found = _read_transcript_image(prev_harness, prev_path, key)
            if found is not None:
                return found
    return None
