"""A short catch-up on a run nobody has touched for days.

The Chat offers it once a run's conversation has been quiet for a few days
(the rule is catchUpState in ui/js/chat-timeline.js). One small Claude call reads the end of the conversation and writes where the
run stands; nothing else in the run changes. Kept in the run's
``catch-up.json`` until it is dismissed or replaced.
"""
from __future__ import annotations

import contextlib
import json
import os
import subprocess
from datetime import datetime, timezone

import quick_claude
from keychain_secrets import _write_json

CATCH_UP_FILE = "catch-up.json"
TIMEOUT = 90
CONVERSATION_BUDGET = 12000
MESSAGE_LIMIT = 3000
SUMMARY_LIMIT = 600

INSTRUCTIONS = """\
Someone is coming back to this piece of work after {days} away and has forgotten where it stands.
Below are its title, its state and the end of the conversation between them (user) and their coding agent (assistant).

Write a catch-up of at most three short lines and 60 words in total, as plain text with no markdown, headings or bullets:
- line 1: where the work stands now
- line 2: what is still open or being waited on; leave the line out when nothing is
- last line: starts with "Next:" and names the one thing the reader does next

Use only what the conversation says. Reply with those lines and nothing else.
"""


class CatchUpError(Exception):
    """Why no summary came back, worded for the Chat."""


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def recent_conversation(items):
    """The newest user and assistant messages that fit the budget, oldest
    first: the end of the conversation says where the run stands."""
    kept, budget = [], CONVERSATION_BUDGET
    for item in reversed(list(items or [])):
        if not isinstance(item, dict) or item.get("kind") not in ("user", "assistant"):
            continue
        text = item.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        text = text.strip()[:MESSAGE_LIMIT]
        if len(text) > budget:
            break
        kept.append("%s: %s" % (item["kind"], text))
        budget -= len(text)
    return list(reversed(kept))


def prompt(meta, items, days=None):
    """The whole request, or None when the run has no conversation to read."""
    conversation = recent_conversation(items)
    if not conversation:
        return None
    away = "%d days" % days if isinstance(days, int) and days > 1 else "a few days"
    state = ["Title: %s" % (meta.get("title") or "untitled"),
             "Phase: %s, status: %s" % (meta.get("phase") or "unknown", meta.get("status") or "unknown")]
    if isinstance(meta.get("prUrl"), str):
        state.append("Pull request: %s" % meta["prUrl"])
    return "\n".join([INSTRUCTIONS.format(days=away), *state, "", "Conversation:", *conversation]) + "\n"


def summarise(request, run=subprocess.run):
    """One tool-less Claude call's reply to ``request``."""
    try:
        text = tidy(quick_claude.ask(request, noun="catch-up", consequence="so the catch-up can't be written",
                                     timeout=TIMEOUT, override_env="ORC_CATCH_UP_CLAUDE", run=run))
    except quick_claude.QuickError as exc:
        raise CatchUpError(str(exc)) from None
    if not text:
        raise CatchUpError("Claude Code returned no catch-up. Try again.")
    return text


def tidy(text):
    """The reply as its non-empty lines, cut at the last whole line that fits."""
    lines, size = [], 0
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        if size + len(line) > SUMMARY_LIMIT:
            break
        lines.append(line)
        size += len(line)
    return "\n".join(lines)


def view(run_dir):
    """The saved catch-up as {text, at}, or None."""
    try:
        with open(os.path.join(run_dir, CATCH_UP_FILE)) as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("text"), str) \
            or not data["text"].strip() or not isinstance(data.get("at"), str):
        return None
    return {"text": data["text"], "at": data["at"]}


def generate(run_dir, meta, items, days=None, run=subprocess.run, now=None):
    request = prompt(meta, items, days)
    if request is None:
        raise CatchUpError("This run has no conversation to catch up on yet.")
    saved = {"text": summarise(request, run), "at": now or _now()}
    _write_json(os.path.join(run_dir, CATCH_UP_FILE), saved)
    return saved


def dismiss(run_dir):
    with contextlib.suppress(FileNotFoundError):
        os.unlink(os.path.join(run_dir, CATCH_UP_FILE))
