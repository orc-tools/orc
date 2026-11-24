"""Steps a run leaves for the user to do by hand.

A run's agent records each one with ``bin/orc-manual-step add``: a deploy, a
migration, a database to start. The run's Chat lists them with the exact
command to paste, and orc-ui refuses to settle the run until every step is
ticked. They are kept in the run's ``manual-steps.json``.

A done run's PR body ``Follow-up:`` items join the list once, as steps of kind
``follow-up``: Chat offers each as a run to start. Starting that run ticks the
step, and ticking one by hand dismisses it. Each run started from a follow-up
is noted on its step, so Chat links to that run instead of offering another.
"""
from __future__ import annotations

import json
import os
import re
import secrets
from datetime import datetime, timezone

import next_runs
from keychain_secrets import _locked, _write_json
from run_relationships import valid_run_id

STEPS_FILE = "manual-steps.json"
LOCK_FILE = ".manual-steps.lock"
TITLE_MAX = 200
COMMAND_MAX = 2000
DETAIL_MAX = 600
STEPS_MAX = 20
FOLLOW_UP_PREFIX = "Follow-up: "
RUNS_PER_STEP = 10


class StepError(ValueError):
    pass


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _text(value, label, limit):
    if not isinstance(value, str):
        raise StepError("%s must be text." % label)
    value = value.strip()
    if len(value) > limit:
        raise StepError("Keep the %s under %d characters." % (label.lower(), limit))
    return value


def _load(run_dir):
    try:
        with open(os.path.join(run_dir, STEPS_FILE)) as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _items(data):
    return [item for item in data.get("items") or [] if isinstance(item, dict)
            and isinstance(item.get("id"), str) and isinstance(item.get("title"), str)]


def _save(run_dir, items):
    # The record of imported follow-ups outlives their steps, so a removed one
    # is not imported again.
    data = _load(run_dir)
    data["items"] = items
    _write_json(os.path.join(run_dir, STEPS_FILE), data)


def steps(run_dir):
    return _items(_load(run_dir))


def open_count(run_dir):
    if not os.path.exists(os.path.join(run_dir, STEPS_FILE)):
        return 0
    return sum(item.get("state") != "done" for item in steps(run_dir))


def add(run_dir, title, command="", detail="", follow_up=False):
    """Record one step. A follow-up step is a run for the user to start, such
    as a review comment the user moved out of its PR: Chat offers it as a run
    rather than a command."""
    title = _text(title, "Title", TITLE_MAX)
    command = _text(command, "Command", COMMAND_MAX)
    detail = _text(detail, "Detail", DETAIL_MAX)
    if not title or "\n" in title:
        raise StepError("Give the step a one-line title that says what to do.")
    if follow_up and command:
        raise StepError("A follow-up run takes no command.")
    with _locked(run_dir, LOCK_FILE):
        items = steps(run_dir)
        for item in items:
            if (item.get("state") != "done" and item["title"] == title
                    and item.get("command", "") == command):
                return item
        if len(items) >= STEPS_MAX:
            raise StepError("A run holds at most %d steps. Remove one that no longer applies." % STEPS_MAX)
        item = {"id": secrets.token_hex(4), "title": title, "command": command,
                "detail": detail, "state": "open", "addedAt": _now()}
        if follow_up:
            item.update(kind="follow-up", task=title)
        _save(run_dir, items + [item])
        return item


def _find(items, step_id):
    item = next((entry for entry in items if entry["id"] == step_id), None)
    if item is None:
        raise StepError("That step is no longer on this run.")
    return item


def set_done(run_dir, step_id, done, by="user"):
    with _locked(run_dir, LOCK_FILE):
        items = steps(run_dir)
        item = _find(items, step_id)
        if done:
            item.update(state="done", doneAt=_now(), doneBy=by)
        else:
            item["state"] = "open"
            for key in ("doneAt", "doneBy", "run"):
                item.pop(key, None)
        _save(run_dir, items)
        return item


def remove(run_dir, step_id):
    with _locked(run_dir, LOCK_FILE):
        items = steps(run_dir)
        item = _find(items, step_id)
        _save(run_dir, [entry for entry in items if entry is not item])
        return item


def started_runs(step):
    """The run ids noted as started for a follow-up step, oldest first, with
    the run that ticked it when its prompt named the follow-up."""
    noted = [run_id for run_id in step.get("runs") or [] if isinstance(run_id, str)]
    ticked = step.get("run") if step.get("doneBy") == "run" else None
    return noted + [ticked] if isinstance(ticked, str) and ticked not in noted else noted


def note_run_started(run_dir, step_id, run_id):
    """Note `run_id` as started for the follow-up step `step_id`. Returns the
    step, or None when the run no longer holds that follow-up."""
    with _locked(run_dir, LOCK_FILE):
        items = steps(run_dir)
        item = next((entry for entry in items if entry["id"] == step_id
                     and entry.get("kind") == "follow-up"), None)
        if item is None:
            return None
        started = [known for known in started_runs(item) if known != run_id]
        item["runs"] = (started + [run_id])[-RUNS_PER_STEP:]
        _save(run_dir, items)
        return item


def import_follow_ups(run_dir):
    """Add the PR body's follow-up items not yet imported as follow-up steps.
    Returns how many were added."""
    found = next_runs.suggestions(run_dir)
    if not found:
        return 0
    data = _load(run_dir)
    if set(found) <= set(data.get("followUpsImported") or []):
        return 0
    with _locked(run_dir, LOCK_FILE):
        data = _load(run_dir)
        imported = [text for text in data.get("followUpsImported") or [] if isinstance(text, str)]
        items = _items(data)
        added = 0
        for text in found:
            if text in imported or len(items) >= STEPS_MAX:
                continue
            title = text if len(text) <= TITLE_MAX else text[:TITLE_MAX - 1].rsplit(" ", 1)[0] + "\u2026"
            items.append({"id": secrets.token_hex(4), "title": title, "command": "",
                          "detail": text if title != text else "", "kind": "follow-up",
                          "task": text, "state": "open", "addedAt": _now()})
            imported.append(text)
            added += 1
        data.update(items=items, followUpsImported=imported)
        _write_json(os.path.join(run_dir, STEPS_FILE), data)
        return added


def tick_started_follow_ups(runs_dir, run_id, prompt):
    """Tick the follow-ups a new run was started for. Chat's Start run drafts
    ``<run-id> Follow-up: <task>``, so a follow-up is started when the prompt
    names its run and has a line ending in its exact task after that prefix.
    Returns the ids of the runs whose steps were ticked."""
    if not isinstance(prompt, str) or FOLLOW_UP_PREFIX not in prompt:
        return []
    ticked = []
    for parent in dict.fromkeys(prompt.split()):
        if parent == run_id or not valid_run_id(parent):
            continue
        run_dir = os.path.join(runs_dir, parent)
        if not os.path.exists(os.path.join(run_dir, STEPS_FILE)):
            continue
        with _locked(run_dir, LOCK_FILE):
            items = steps(run_dir)
            started = [item for item in items if item.get("kind") == "follow-up"
                       and item.get("state") != "done" and item.get("task")
                       and re.search(re.escape(FOLLOW_UP_PREFIX + item["task"]) + r"[ \t]*$",
                                     prompt, re.MULTILINE)]
            if not started:
                continue
            for item in started:
                item.update(state="done", doneAt=_now(), doneBy="run", run=run_id)
            _save(run_dir, items)
        ticked.append(parent)
    return ticked
