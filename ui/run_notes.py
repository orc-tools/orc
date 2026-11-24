"""Notes between the runs of a group.

A plan can open one run per repository. Those runs (and a run with the
siblings it opened) are a group, and members send each other notes: an `ask`
wants an answer, a `tell` does not. The store is `<config_dir>/run-notes.json`.
This module only keeps the store and builds the marker text; the server
delivers undelivered notes into the receiving run's session.
"""
from __future__ import annotations

import contextlib
import fcntl
import html
import json
import os
import re
import secrets
import tempfile
from datetime import datetime, timedelta, timezone

import run_relationships

MAX_NOTES = 2000
MAX_TEXT = 4000
KINDS = ("ask", "tell")
STORE_NAME = "run-notes.json"


class RunNotesError(Exception):
    pass


def utc_now():
    return datetime.now(timezone.utc)


def iso(moment):
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def parse_iso(value):
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def store_path(config_dir):
    return os.path.join(config_dir, STORE_NAME)


def _load(config_dir):
    """The notes list. Raises RunNotesError when the file exists but is corrupt."""
    try:
        with open(store_path(config_dir), encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        return []
    except (OSError, ValueError) as exc:
        raise RunNotesError("run notes store is unreadable") from exc
    notes = data.get("notes") if isinstance(data, dict) else None
    if not isinstance(notes, list):
        raise RunNotesError("run notes store is malformed")
    return [note for note in notes if isinstance(note, dict)]


def read_notes(config_dir):
    """Every note, oldest first. A missing or corrupt store reads as empty."""
    try:
        return _load(config_dir)
    except RunNotesError:
        return []


def _write(config_dir, notes):
    os.makedirs(config_dir, mode=0o700, exist_ok=True)
    encoded = (json.dumps({"version": 1, "notes": notes[-MAX_NOTES:]}, indent=2) + "\n").encode()
    fd, temporary = tempfile.mkstemp(dir=config_dir, prefix=".run-notes.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, store_path(config_dir))
    except Exception:
        with contextlib.suppress(OSError):
            os.unlink(temporary)
        raise


@contextlib.contextmanager
def _locked(config_dir):
    os.makedirs(config_dir, mode=0o700, exist_ok=True)
    with open(os.path.join(config_dir, ".run-notes.lock"), "a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            notes = _load(config_dir)
            yield notes
            _write(config_dir, notes)
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _find(notes, note_id):
    note = next((item for item in notes if item.get("id") == note_id), None)
    if note is None:
        raise ValueError("no note %s" % note_id)
    return note


def _clean_text(text):
    text = text.strip() if isinstance(text, str) else ""
    if not text:
        raise ValueError("note text is empty")
    if len(text) > MAX_TEXT:
        raise ValueError("note text is longer than %d characters" % MAX_TEXT)
    return text


# ---- groups ----

def _meta_reader(config_dir):
    def read(run_id):
        try:
            with open(os.path.join(config_dir, "runs", run_id, "meta.json"), encoding="utf-8") as handle:
                meta = json.load(handle)
        except (OSError, ValueError):
            return {}
        return meta if isinstance(meta, dict) else {}
    return read


def _group_rows(config_dir):
    try:
        rows = run_relationships.read_store(config_dir)["children"]
    except Exception:
        return []
    return [row for row in rows if isinstance(row, dict)
            and (row.get("planGroup") is True or row.get("sibling") is True)]


def group_members(config_dir, run_id, run_meta=None):
    """`{"root": id|None, "members": [{runId, repo, title, step, state}]}`."""
    meta_of = run_meta or _meta_reader(config_dir)
    rows = _group_rows(config_dir)
    root = next((row.get("sourceRunId") for row in rows if row.get("childRunId") == run_id), None)
    if root is None and any(row.get("sibling") is True and row.get("sourceRunId") == run_id
                            for row in rows):
        root = run_id
    if root is None:
        return {"root": None, "members": []}
    members = []
    root_meta = meta_of(root) or {}
    if root_meta.get("route") != "planning-session":
        path = root_meta.get("repoPath") or root_meta.get("mainRepoPath") or ""
        members.append({"runId": root, "repo": os.path.basename(path.rstrip("/")) or None,
                        "title": root_meta.get("title"), "step": None,
                        "state": "launched"})
    group = [row for row in rows if row.get("sourceRunId") == root]
    group.sort(key=lambda row: row["planStep"] if isinstance(row.get("planStep"), int) else 10 ** 9)
    for row in group:
        child = row.get("childRunId") or None
        title = row.get("planStepTitle")
        if not title and child:
            title = (meta_of(child) or {}).get("title")
        repo = row.get("planRepo") or os.path.basename(str(row.get("targetProject") or "").rstrip("/")) or None
        step = row.get("planStep") if isinstance(row.get("planStep"), int) else None
        members.append({"runId": child, "repo": repo, "title": title, "step": step,
                        "state": row.get("state") or "waiting"})
    return {"root": root, "members": members}


def _describe(members):
    lines = []
    for member in members:
        who = member["repo"] or member["title"] or "run"
        where = member["runId"] or member["state"]
        step = "step %s " % member["step"] if member["step"] is not None else ""
        lines.append("%s%s (%s)" % (step, who, where))
    return "; ".join(lines) or "none"


def resolve_peer(config_dir, run_id, target, run_meta=None):
    """The run id of the group member `target` names (run id, repo or "step N")."""
    group = group_members(config_dir, run_id, run_meta)
    if group["root"] is None:
        raise ValueError("this run is not in a group of runs")
    target = (target or "").strip()
    others = [member for member in group["members"] if member["runId"] != run_id]
    listing = "Members: %s" % _describe(others)
    if not target:
        raise ValueError("name a run, a repository or a step. " + listing)
    step = re.fullmatch(r"(?:step\s*)(\d+)", target, re.IGNORECASE)
    if step:
        matches = [m for m in others if m["step"] == int(step.group(1))]
    else:
        matches = [m for m in others if m["runId"] == target]
        if not matches:
            matches = [m for m in others if (m["repo"] or "").lower() == target.lower()]
    if not matches:
        raise ValueError("no run in the group matches %r. %s" % (target, listing))
    if len(matches) > 1:
        raise ValueError("%r matches more than one run; use a run id or step. %s" % (target, listing))
    match = matches[0]
    if not match["runId"]:
        raise ValueError("%s has not started yet (%s). %s"
                         % (match["repo"] or target, match["state"], listing))
    return match["runId"]


# ---- notes ----

def add(config_dir, from_run, to_run, kind, text):
    if kind not in KINDS:
        raise ValueError("kind must be ask or tell")
    text = _clean_text(text)
    if from_run == to_run:
        raise ValueError("a run cannot send a note to itself")
    group = group_members(config_dir, from_run)
    if group["root"] is None or to_run not in [m["runId"] for m in group["members"]]:
        raise ValueError("%s is not in the same group as %s" % (to_run, from_run))
    with _locked(config_dir) as notes:
        taken = {note.get("id") for note in notes}
        note_id = "n-" + secrets.token_hex(4)
        while note_id in taken:
            note_id = "n-" + secrets.token_hex(4)
        note = {"id": note_id, "fromRunId": from_run, "toRunId": to_run, "kind": kind,
                "text": text, "at": iso(utc_now()), "delivered": False, "deliveredAt": None,
                "waitingUntil": None, "readAt": None, "answer": None}
        notes.append(note)
        return dict(note)


def answer(config_dir, note_id, by_run, text):
    text = _clean_text(text)
    with _locked(config_dir) as notes:
        note = _find(notes, note_id)
        if note.get("toRunId") != by_run:
            raise ValueError("note %s was not sent to this run" % note_id)
        if note.get("kind") != "ask":
            raise ValueError("note %s is a tell and needs no answer" % note_id)
        if note.get("answer"):
            raise ValueError("note %s is already answered" % note_id)
        note["answer"] = {"text": text, "at": iso(utc_now()), "delivered": False,
                          "deliveredAt": None}
        return json.loads(json.dumps(note))


def get(config_dir, note_id):
    return next((note for note in read_notes(config_dir) if note.get("id") == note_id), None)


def for_run(config_dir, run_id):
    return [note for note in read_notes(config_dir)
            if run_id in (note.get("fromRunId"), note.get("toRunId"))]


def _update(config_dir, note_id, change):
    with _locked(config_dir) as notes:
        note = _find(notes, note_id)
        change(note)
        return json.loads(json.dumps(note))


def mark_waiting(config_dir, note_id, until_iso):
    def change(note):
        note["waitingUntil"] = until_iso
    return _update(config_dir, note_id, change)


def mark_read(config_dir, note_id):
    def change(note):
        note["readAt"] = iso(utc_now())
    return _update(config_dir, note_id, change)


def mark_delivered(config_dir, note_id, which):
    if which not in ("note", "answer"):
        raise ValueError("which must be note or answer")

    def change(note):
        target = note if which == "note" else note.get("answer")
        if target is None:
            raise ValueError("note %s has no answer" % note_id)
        target["delivered"] = True
        target["deliveredAt"] = iso(utc_now())
    return _update(config_dir, note_id, change)


def undelivered(config_dir, now=None):
    now = now or utc_now()
    pending = []
    for note in read_notes(config_dir):
        if not note.get("delivered"):
            pending.append((note, "note"))
        reply = note.get("answer")
        if isinstance(reply, dict) and not reply.get("delivered") and not note.get("readAt"):
            until = parse_iso(note.get("waitingUntil"))
            if until is None or until <= now:
                pending.append((note, "answer"))
    return pending


def _clip(text, limit):
    text = str(text or "")
    return text if len(text) <= limit else text[:limit - 1] + "…"


def latest_by_run(store_or_notes):
    notes = store_or_notes.get("notes", []) if isinstance(store_or_notes, dict) else store_or_notes
    latest = {}
    for note in notes or []:
        if not isinstance(note, dict):
            continue
        reply = note.get("answer") if isinstance(note.get("answer"), dict) else None
        for run_id, direction, peer in ((note.get("fromRunId"), "out", note.get("toRunId")),
                                        (note.get("toRunId"), "in", note.get("fromRunId"))):
            if run_id:
                latest[run_id] = {"id": note.get("id"), "direction": direction, "peer": peer,
                                  "kind": note.get("kind"), "text": _clip(note.get("text"), 160),
                                  "at": note.get("at"), "answered": reply is not None,
                                  "answerAt": reply.get("at") if reply else None}
    return latest


# ---- markers ----

def _attr(value, limit=None):
    value = " ".join(str(value or "").split())
    if limit:
        value = _clip(value, limit)
    return html.escape(value, quote=True)


def marker(note, which, sender_label):
    """The text queued into the receiving agent's session."""
    note_id = note["id"]
    if which == "answer":
        sender = note["toRunId"]
        body = note["answer"]["text"]
        head = '<orc-note id="%s" kind="answer" from="%s" label="%s" question="%s">' % (
            note_id, _attr(sender), _attr(sender_label), _attr(note.get("text"), 200))
        tail = "This answers your note %s." % note_id
    else:
        body = note["text"]
        head = '<orc-note id="%s" kind="%s" from="%s" label="%s">' % (
            note_id, note["kind"], _attr(note["fromRunId"]), _attr(sender_label))
        if note["kind"] == "ask":
            tail = 'Answer it with: orc-note answer %s "<your answer>"' % note_id
        else:
            tail = "No answer is needed; reply with orc-note tell if useful."
    return "%s\n%s\n</orc-note>\n%s" % (head, body, tail)


_HEADER = re.compile(r"<orc-note((?:\s+[a-z]+=\"[^\"]*\")+)\s*>")
_ATTR = re.compile(r'([a-z]+)="([^"]*)"')


def parse_marker(text):
    if not isinstance(text, str):
        return None
    text = text.strip()
    match = _HEADER.match(text)
    if not match or not text[match.end():].startswith("\n"):
        return None
    close = text.rfind("\n</orc-note>")
    if close < match.end():
        return None
    attrs = {key: html.unescape(value) for key, value in _ATTR.findall(match.group(1))}
    if not attrs.get("id") or attrs.get("kind") not in ("ask", "tell", "answer"):
        return None
    result = {"id": attrs["id"], "kind": attrs["kind"], "from": attrs.get("from", ""),
              "label": attrs.get("label", ""), "text": text[match.end() + 1:close]}
    if "question" in attrs:
        result["question"] = attrs["question"]
    return result
