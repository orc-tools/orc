"""Incremental, thread-owned async question discovery from Codex rollouts."""

import collections
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import time

THREAD_ID = re.compile(r"[0-9a-fA-F-]{36}\Z")
READ_BUDGET = 2 * 1024 * 1024
LINE_LIMIT = 1024 * 1024
_cache = collections.OrderedDict()
_lock = threading.RLock()
# A headless send can wait for the queue while its owner reads pending questions.
_reply_lock = threading.Lock()


def _home():
    return Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))


def home():
    return _home().resolve()


def rollout_path(thread_id):
    """The rollout file Codex indexed for this thread, or None."""
    if not isinstance(thread_id, str) or not THREAD_ID.fullmatch(thread_id):
        return None
    return _rollout(home(), thread_id)


def _rollout(home, thread_id):
    # The indexed lookup avoids walking every session directory on each poll.
    for db in sorted(home.glob("state_*.sqlite"), reverse=True)[:3]:
        try:
            with closing(sqlite3.connect(db.as_uri() + "?mode=ro", uri=True, timeout=0.1)) as conn:
                row = conn.execute("SELECT rollout_path FROM threads WHERE id = ?",
                                   (thread_id,)).fetchone()
            if row:
                path = Path(row[0]).resolve()
                if path.is_relative_to((home / "sessions").resolve()):
                    return path
        except (OSError, sqlite3.Error, ValueError):
            continue
    return None


class Reader:
    def __init__(self, thread_id):
        self.thread_id = thread_id
        self.path = None
        self.identity = None
        self.offset = 0
        self.owned = False
        self.questions = {}
        self.answered = collections.deque(maxlen=32)
        self.next_lookup = 0
        self.discard_line = False

    def event(self, record):
        payload = record.get("payload")
        if not isinstance(payload, dict):
            return
        if record.get("type") == "session_meta":
            self.owned = payload.get("id") == self.thread_id
            return
        if not self.owned or record.get("type") != "event_msg":
            return
        if payload.get("thread_id", self.thread_id) != self.thread_id:
            return
        kind = payload.get("type")
        if kind in ("task_complete", "turn_aborted"):
            for q in self.questions.values():
                if q["turnId"] == payload.get("turn_id"):
                    q["turnEnded"] = True
            return
        if kind != "item_completed":
            return
        item = payload.get("item")
        if not isinstance(item, dict):
            return
        if item.get("type") == "AgentMessage" and item.get("delivery") == "async":
            call_id, turn_id = item.get("id"), payload.get("turn_id")
            questions = item.get("questions")
            if not isinstance(call_id, str) or not isinstance(turn_id, str) or not isinstance(questions, list):
                return
            for index, raw in enumerate(questions[:3]):
                if not isinstance(raw, dict) or not isinstance(raw.get("title"), str):
                    continue
                title = raw["title"]
                if not title.strip() or len(title) > 16000:
                    continue
                options = raw.get("options") or []
                if not isinstance(options, list) or any(not isinstance(o, str) for o in options):
                    continue
                qid = json.dumps(["request_user_input_async", call_id, index], separators=(",", ":"))
                version = hashlib.sha256(json.dumps([self.thread_id, turn_id, qid, raw],
                    sort_keys=True).encode()).hexdigest()
                if qid in self.questions or any(a["id"] == qid for a in self.answered):
                    continue
                self.questions[qid] = {"id": qid, "version": version, "turnId": turn_id,
                    "question": title, "header": "", "options": [{"label": o} for o in options[:20]],
                    "turnEnded": False}
        elif item.get("type") == "UserMessage":
            for block in item.get("content", []):
                if not isinstance(block, dict) or block.get("type") != "text":
                    continue
                text = block.get("text", "")
                matches = re.finditer(r"<send_user_message_question_reply>\s*(.*?)\s*</send_user_message_question_reply>", text, re.S)
                for match in matches:
                    try:
                        replies = json.loads(match[1])
                    except (ValueError, TypeError):
                        continue
                    if not isinstance(replies, list):
                        continue
                    for reply in replies:
                        if not isinstance(reply, dict):
                            continue
                        q = self.questions.get(reply.get("questionItemId"))
                        if q and reply.get("question") == q["question"] and isinstance(reply.get("answer"), str):
                            self.answered.append({"id": q["id"], "version": q["version"]})
                            del self.questions[q["id"]]

    def poll(self, home, *, headless=False):
        if self.path is None:
            if time.monotonic() < self.next_lookup:
                return None
            self.next_lookup = time.monotonic() + 10
            self.path = _rollout(home, self.thread_id)
            if self.path is None:
                return None
        try:
            with self.path.open("rb") as stream:
                stat = os.fstat(stream.fileno())
                identity = (stat.st_dev, stat.st_ino)
                if self.identity != identity or stat.st_size < self.offset:
                    self.offset = 0
                    self.owned = False
                    self.questions.clear()
                    self.answered.clear()
                    self.discard_line = False
                    self.identity = identity
                stream.seek(self.offset)
                remaining = READ_BUDGET
                while remaining > 0:
                    line = stream.readline(min(LINE_LIMIT, remaining))
                    if not line:
                        break
                    remaining -= len(line)
                    if not line.endswith(b"\n"):
                        if len(line) >= LINE_LIMIT or self.discard_line:
                            self.discard_line = True
                            self.offset = stream.tell()
                            continue
                        break  # Writer is still appending this record.
                    self.offset = stream.tell()
                    if self.discard_line:
                        self.discard_line = False
                        continue
                    try:
                        record = json.loads(line)
                        if isinstance(record, dict):
                            self.event(record)
                    except (ValueError, TypeError):
                        continue
                if self.offset < os.fstat(stream.fileno()).st_size:
                    return None  # Never advertise an old question before reading its reply.
        except OSError:
            self.path = None
            return None
        if not self.questions:
            return None
        from codex_rpc import loaded_threads
        return {"harness": "codex", "threadId": self.thread_id, "kind": "async",
                "replyMode": "inline" if headless or self.thread_id in loaded_threads(home) else "terminal", "questions": list(self.questions.values()),
                "acknowledged": list(self.answered)}


def pending(meta):
    thread_id = meta.get("codexThreadId")
    if not isinstance(thread_id, str) or not THREAD_ID.fullmatch(thread_id):
        return None
    home = _home().resolve()
    key = (str(home), thread_id)
    with _lock:
        reader = _cache.setdefault(key, Reader(thread_id))
        _cache.move_to_end(key)
        while len(_cache) > 128:
            _cache.popitem(last=False)
        return reader.poll(home, headless=meta.get("sessionBackend") == "headless")


def validate_reply(question, data):
    if not question or data.get("threadId") != question["threadId"]:
        return "This question no longer belongs to this session. Refresh the run."
    for q in question["questions"]:
        if q["id"] == data.get("questionId") and q["version"] == data.get("version"):
            return None
    return "This question has changed or was already answered. Refresh the run."


def acknowledgements(meta):
    with _lock:
        reader = _cache.get((str(_home().resolve()), meta.get("codexThreadId")))
        return list(reader.answered) if reader else []


def reply_state(run_dir):
    try:
        value = json.loads((Path(run_dir) / ".codex-replies.json").read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_replies(run_dir, state):
    path = Path(run_dir) / ".codex-replies.json"
    temp = path.with_suffix(".tmp")
    with temp.open("w") as stream:
        json.dump(state, stream)
        stream.flush()
        os.fsync(stream.fileno())
    temp.replace(path)


def answer(meta, run_dir, data, *, headless_send=None):
    from codex_rpc import Client, RpcError, RpcRejected

    with _reply_lock:
        if meta.get("harness") != "codex" or meta.get("status") in ("complete", "merged", "merged-to-parent", "cancelled"):
            return 409, {"error": "This run no longer accepts Codex replies."}
        question = pending(meta)
        error = validate_reply(question, data)
        if error:
            return 409, {"error": error}
        q = next(q for q in question["questions"] if q["id"] == data["questionId"])
        state = reply_state(run_dir)
        key = q["version"]
        if key in state:
            return 409, {"error": "This reply was already submitted. Check Codex in the terminal before answering again."}
        if data.get("action") == "dismiss":
            state[key] = "dismissed"
            _save_replies(run_dir, state)
            return 200, {"state": "dismissed"}
        text = "<send_user_message_question_reply>\n" + json.dumps([{
            "questionItemId": q["id"], "question": q["question"],
            "answer": data["text"].strip(),
        }]) + "\n</send_user_message_question_reply>"
        if meta.get("sessionBackend") == "headless":
            if headless_send is None:
                return 409, {"error": "This headless session is unavailable. Reopen it in Chat."}
            state[key] = "sending"
            _save_replies(run_dir, state)
            try:
                error = headless_send(text)
            except Exception:
                state[key] = "unconfirmed"
                _save_replies(run_dir, state)
                return 503, {"error": "Reply not confirmed. Check Chat before retrying.", "retryable": False}
            if error:
                state.pop(key, None)
                _save_replies(run_dir, state)
                return error[0], {"error": error[1], "retryable": True}
            return 202, {"state": "sending", "questionId": q["id"], "version": key}
        try:
            with Client() as client:
                turns = client.call("thread/turns/list", {"threadId": question["threadId"],
                    "limit": 1, "itemsView": "summary"}).get("data", [])
                active = next((turn for turn in turns if turn.get("status") == "inProgress"), None)
                state[key] = "sending"
                _save_replies(run_dir, state)
                params = {"threadId": question["threadId"], "input": [{"type": "text", "text": text}]}
                if active:
                    params["expectedTurnId"] = active["id"]
                result = client.call("turn/steer" if active else "turn/start", params)
                if active and result.get("turnId") != active["id"]:
                    raise RpcError("Codex returned a different turn")
        except RpcRejected as exc:
            state.pop(key, None)
            _save_replies(run_dir, state)
            return 409, {"error": "Codex refused the reply; it was not sent. Refresh and retry. " + str(exc)}
        except (OSError, RpcError, ValueError) as exc:
            if key in state:
                state[key] = "unconfirmed"
                _save_replies(run_dir, state)
            return 503, {"error": "Reply not confirmed. Open the terminal to check before retrying. " + str(exc),
                         "retryable": key not in state}
        return 202, {"state": "sending", "questionId": q["id"], "version": key}
