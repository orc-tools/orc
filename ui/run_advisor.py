"""The advisor's asks, read from a Claude Code transcript.

A model with an advisor asks it through a server tool: the ask is a
``server_tool_use`` block named ``advisor`` and the answer comes back in the
same assistant message as an ``advisor_tool_result`` block. The advice itself
is encrypted, so what Orc can tell about an ask is when it was made, how long
the advisor read, how much it read and wrote, which model it was, and what
the agent said just before asking and just after.

Claude Code sometimes drops an ask and makes it again a second or two later.
An ask repeated before the agent has said or done anything else counts once.
An ask nobody answered closes when the agent moves on without it.
"""

from datetime import datetime

# How long after an unanswered ask a new one still counts as the same ask.
RESEND_SECONDS = 60
# How much of what the agent said either side of an ask is kept.
QUOTE_LIMIT = 280
# How many asks a snapshot lists, newest last.
SNAPSHOT_LIMIT = 20
# What an advisor error code means, in the words the Factory and Chat use.
ERRORS = {
    "too_many_requests": "the advisor was busy",
    "overloaded": "the advisor was busy",
    "execution_time_exceeded": "the advisor ran out of time",
    "max_uses_exceeded": "no asks left this turn",
    "prompt_too_long": "too much for the advisor to read",
}


def _seconds(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (AttributeError, TypeError, ValueError):
        return None


def _quote(text):
    text = " ".join(text.split())
    return text if len(text) <= QUOTE_LIMIT else text[:QUOTE_LIMIT - 1].rstrip() + "…"


def error_text(code):
    """What an advisor error code means, for a person."""
    if not isinstance(code, str) or not code:
        return "the advisor did not answer"
    return ERRORS.get(code, code.replace("_", " "))


class AdvisorLog:
    """Every advisor ask in one transcript, oldest first. ``feed`` takes each
    record in order; ``changed`` collects the ids of asks a record changed,
    for a reader that shows them to drain."""

    def __init__(self):
        self.asks = {}
        # A resent ask's tool id, by the id of the ask it repeats.
        self.alias = {}
        self.by_message = {}
        self.changed = set()
        self.last_said = None
        self.said_since_ask = False
        self.open = None

    def __bool__(self):
        return bool(self.asks)

    def canonical(self, tool_id):
        return self.alias.get(tool_id, tool_id)

    def feed(self, record, at):
        if record.get("isSidechain"):
            return
        kind = record.get("type")
        if kind == "user":
            self._prompted(record, at)
            return
        if kind == "system" and record.get("subtype") == "turn_duration":
            self._turn_over(at)
            return
        if kind != "assistant":
            return
        message = record.get("message")
        if not isinstance(message, dict) or not isinstance(message.get("content"), list):
            return
        message_id = message.get("id")
        for block in message["content"]:
            if not isinstance(block, dict):
                continue
            kind = block.get("type")
            if kind == "server_tool_use" and block.get("name") == "advisor" and isinstance(block.get("id"), str):
                self._ask(block["id"], record, message_id, at)
            elif kind == "advisor_tool_result":
                self._answer(block, at)
            elif kind == "text":
                text = (block.get("text") or "").strip()
                if text and text != "(no content)":
                    self._said(_quote(text), message_id, at)
            elif kind == "tool_use":
                self._moved_on(message_id, at)
        ask = self.asks.get(self.by_message.get(message_id)) if message_id else None
        if ask is not None:
            self._usage(ask, message.get("usage"), record.get("advisorModel"))

    def _ask(self, tool_id, record, message_id, at):
        if tool_id in self.asks or tool_id in self.alias:
            return
        open_ask = self.asks.get(self.open) if self.open else None
        if open_ask is not None and not self.said_since_ask:
            started, now = _seconds(open_ask["startedAt"]), _seconds(at)
            if started is not None and now is not None and now - started <= RESEND_SECONDS:
                # Claude Code dropped the first ask and made it again.
                self.alias[tool_id] = open_ask["id"]
                open_ask["resent"] = open_ask.get("resent", 0) + 1
                if message_id:
                    self.by_message[message_id] = open_ask["id"]
                    open_ask["message"] = message_id
                return
        self._drop_open(at)
        model = record.get("advisorModel")
        ask = {"id": tool_id, "status": "reading", "startedAt": at, "endedAt": None,
               "model": model if isinstance(model, str) else None,
               "readTokens": None, "wroteTokens": None, "before": self.last_said, "after": None,
               "message": message_id}
        self.asks[tool_id] = ask
        if message_id:
            self.by_message[message_id] = tool_id
        self.open = tool_id
        self.said_since_ask = False
        self.changed.add(tool_id)

    def _answer(self, block, at):
        ask = self.asks.get(self.canonical(block.get("tool_use_id")))
        if ask is None or ask["status"] not in ("reading", "dropped"):
            return
        content = block.get("content") if isinstance(block.get("content"), dict) else {}
        if content.get("type") == "advisor_tool_result_error":
            ask["status"] = "failed"
            ask["error"] = content.get("error_code") if isinstance(content.get("error_code"), str) else None
        else:
            ask["status"] = "answered"
        ask["endedAt"] = at or ask["endedAt"] or ask["startedAt"]
        if self.open == ask["id"]:
            self.open = None
        self.changed.add(ask["id"])

    def _said(self, text, message_id, at):
        self.last_said = text
        self._moved_on(message_id, at)
        # What the agent said first after an answer is what it made of it.
        for ask in reversed(self.asks.values()):
            if ask["after"] is not None or ask["status"] == "reading":
                break
            ask["after"] = text
            self.changed.add(ask["id"])

    def _prompted(self, record, at):
        """A user record. A tool's result is part of the agent's turn; a
        prompt or an interruption means that turn is over."""
        message = record.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if record.get("isMeta") or (isinstance(content, list) and any(
                isinstance(block, dict) and block.get("type") == "tool_result" for block in content)):
            return
        self._turn_over(at)
        # What the agent said in an earlier turn is not what it asked after.
        self.last_said = None

    def _turn_over(self, at):
        """The agent's turn ended: an ask still open was never answered."""
        self._drop_open(at)
        self.said_since_ask = True

    def _moved_on(self, message_id, at):
        """The agent said or did something: an ask from an earlier message
        that has had no answer never will. What the same message goes on to
        do beside its ask is not moving on."""
        open_ask = self.asks.get(self.open) if self.open else None
        if open_ask is not None and message_id and message_id == open_ask.get("message"):
            return
        self._drop_open(at)
        self.said_since_ask = True

    def _drop_open(self, at):
        ask = self.asks.get(self.open) if self.open else None
        self.open = None
        if ask is not None and ask["status"] == "reading":
            ask.update(status="dropped", endedAt=at or ask["startedAt"])
            self.changed.add(ask["id"])

    def _usage(self, ask, usage, model):
        if isinstance(model, str) and model:
            ask["model"] = model
        iterations = usage.get("iterations") if isinstance(usage, dict) else None
        for step in iterations if isinstance(iterations, list) else ():
            if not isinstance(step, dict) or step.get("type") != "advisor_message":
                continue
            read = sum(value for key in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
                       if type(value := step.get(key)) is int and value >= 0)
            wrote = step.get("output_tokens")
            if read > (ask["readTokens"] or 0):
                ask["readTokens"] = read
                self.changed.add(ask["id"])
            if type(wrote) is int and wrote > (ask["wroteTokens"] or 0):
                ask["wroteTokens"] = wrote
                self.changed.add(ask["id"])
            if isinstance(step.get("model"), str):
                ask["model"] = step["model"]

    def entry(self, ask_id):
        """One ask as a reader shows it."""
        ask = self.asks[ask_id]
        entry = {key: ask[key] for key in ("id", "status", "startedAt", "endedAt", "model",
                                            "readTokens", "wroteTokens", "before", "after")}
        if ask.get("error") is not None or ask["status"] == "failed":
            entry["error"] = ask.get("error")
            entry["errorText"] = error_text(ask.get("error"))
        if ask.get("resent"):
            entry["resent"] = ask["resent"]
        started, ended = _seconds(ask["startedAt"]), _seconds(ask["endedAt"])
        entry["durationMs"] = (max(0, int((ended - started) * 1000))
                               if started is not None and ended is not None else None)
        return entry

    def snapshot(self, active=True):
        """The newest asks, oldest first, and how many there were. When the
        run's agent has stopped, an ask still open is no longer being read."""
        asks = [self.entry(key) for key in list(self.asks)[-SNAPSHOT_LIMIT:]]
        if not active:
            for ask in asks:
                if ask["status"] == "reading":
                    ask["status"] = "dropped"
        return {"total": len(self.asks), "asks": asks}
