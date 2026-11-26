"""What a run did, step by step, for Run Control's waterfall
(GET /api/runs/<id>/waterfall).

A run is a list of turns, and a turn is cut into steps: stretches of one kind
of work, such as reading, editing or running commands. Every span is placed on
one axis of working time, the seconds the agent spent inside its turns, so the
wait between two turns takes no room and an overnight pause does not flatten
the rest. Tokens come from the transcript's own usage records, so a step's
cost is an estimate at API rates, as the Cost section's total is.

The run's crew says which model did what: the run's own agent by each model
it ran on, its subagents, and the workers Orchestrate started for it. A
worker is a run of its own, so its tokens and cost sit beside the run's
totals and are never added to them.

Nothing here reads a file: ``build`` takes the chat items a Reader already
parsed and the model calls its Summary recorded."""
import bisect
import datetime

import token_usage

ACTIVITIES = ("think", "explore", "edit", "run", "agent", "ask")
CATEGORY_ACTIVITY = {"read": "explore", "search": "explore", "web": "explore", "edit": "edit",
                     "command": "run", "mcp": "run", "skill": "run", "other": "run",
                     "agent": "agent", "question": "ask"}
# What a step's label counts, by chat tool category. Task lists and plans are
# the agent thinking aloud, so they are not counted as work on their own.
CATEGORY_COUNT = {"read": "read", "search": "search", "web": "web", "edit": "edit", "command": "command",
                  "mcp": "tool", "skill": "tool", "other": "tool", "agent": "agent", "question": "question"}
COUNT_ACTIVITY = {"read": "explore", "search": "explore", "web": "explore", "edit": "edit",
                  "command": "run", "tool": "run", "agent": "agent", "question": "ask"}
COUNT_PHRASES = {
    "edit": ("edited %d file", "edited %d files"),
    "command": ("ran %d command", "ran %d commands"),
    "read": ("read %d file", "read %d files"),
    "search": ("searched %d time", "searched %d times"),
    "web": ("looked up %d page", "looked up %d pages"),
    "tool": ("made %d tool call", "made %d tool calls"),
    "agent": ("started %d subagent", "started %d subagents"),
    "question": ("asked %d question", "asked %d questions"),
}
MAX_STEPS_PER_TURN = 12
# A step shorter than this share of its turn, or of the whole run, is a
# sliver nobody can point at, so it joins a neighbour.
MIN_TURN_SHARE = 0.02
MIN_RUN_SHARE = 0.006
MIN_STEP_SECONDS = 3.0
LABEL_PARTS = 3
HIGHLIGHTS = 4
TEXT_LIMIT = 120
# An Orchestrate task's state, as the status a subagent row carries.
WORKER_STATUS = {"queued": "queued", "launching": "queued", "running": "running", "waiting": "running",
                 "completed": "done", "failed": "error", "cancelled": "interrupted", "interrupted": "interrupted"}
WORKER_ACTIVE = ("queued", "launching", "running", "waiting")


def _seconds(stamp):
    if not isinstance(stamp, str):
        return None
    try:
        return datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _iso(seconds):
    return datetime.datetime.fromtimestamp(seconds, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _clip(text, limit=TEXT_LIMIT):
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


class Bill:
    """Tokens by model, and what they cost at API rates."""

    def __init__(self):
        self.models = {}

    def add(self, model, tokens):
        token_usage.add(self.models.setdefault(model, token_usage.blank()), tokens)

    def merge(self, other):
        for model, tokens in other.models.items():
            self.add(model, tokens)

    def view(self, price):
        """{"tokens", "cost", "models", "unpriced"}: cost is None when no
        model here has a price, and covers only the priced ones otherwise."""
        total, cost, priced, unpriced, models = token_usage.blank(), 0.0, False, [], []
        for model, tokens in sorted(self.models.items(), key=lambda item: -sum(item[1][f] for f in token_usage.FIELDS)):
            # Claude's <synthetic> messages carry no billable usage.
            if not any(tokens[field] for field in token_usage.FIELDS):
                continue
            token_usage.add(total, tokens)
            models.append(model)
            amount = price(model, tokens)
            if amount is None:
                unpriced.append(model)
            else:
                priced = True
                cost += amount
        return {"tokens": total, "cost": cost if priced else None, "models": models, "unpriced": unpriced}


def _turn_label(item):
    answers = item.get("gateAnswers")
    if isinstance(answers, dict) and answers.get("label"):
        return "Answered the %s questions" % answers["label"]
    return (_clip((item.get("text") or "").split("\n", 1)[0])
            or ("Run resumed" if item.get("resumed") else "Prompt"))


def _split_turns(items):
    """[(start item, [timed items])] in transcript order."""
    turns, current = [], None
    for item in items:
        kind = item.get("kind")
        if (kind == "user" and not item.get("steer")) or (kind == "notice" and item.get("turn")):
            current = (item, [])
            turns.append(current)
        elif current is None:
            continue
        elif kind == "interrupt":
            # An interrupted turn is over. Claude Code closes it with a
            # placeholder reply only when the session next resumes, which
            # can be hours later.
            current[1].append(dict(item, kind="turn-end"))
            current = None
        elif kind in ("assistant", "thinking", "tool", "turn-end"):
            current[1].append(item)
    return turns


def _segments(start, timed, end_of_turn):
    """A turn's time, cut wherever the kind of work changes. The time before
    an item is the model producing it, so it takes that item's activity; a
    tool call then runs until its result."""
    events = []
    for item in timed:
        if item.get("kind") == "turn-end":
            continue
        tool = item.get("kind") == "tool"
        at = _seconds(item.get("startedAt") if tool and item.get("startedAt") else item.get("at"))
        if at is None:
            continue
        ended = None
        if tool:
            ended = _seconds(item.get("endedAt")) if item.get("endedAt") else (
                _seconds(item.get("at")) if item.get("startedAt") else None)
        activity = CATEGORY_ACTIVITY.get(item.get("category"), "think") if tool else "think"
        events.append((at, ended, activity, tool, item))
    events.sort(key=lambda event: event[0])
    segments, cursor = [], start

    def cover(until, activity):
        nonlocal cursor
        if until <= cursor:
            return
        if segments and segments[-1][2] == activity:
            segments[-1][1] = until
        else:
            segments.append([cursor, until, activity])
        cursor = until

    for index, (at, ended, activity, tool, item) in enumerate(events):
        cover(at, activity)
        if not tool:
            continue
        if ended is None:
            # No result was recorded: it ran until the next thing happened.
            later = next((other[0] for other in events[index + 1:] if other[0] > at), None)
            ended = later if later is not None else (end_of_turn if item.get("status") == "running" else at)
        cover(ended, activity)
    if end_of_turn is not None:
        cover(end_of_turn, "think")
    return segments, events


def _primary(segments):
    """The kind of work a group of segments was mostly, thinking aside."""
    spent = dict.fromkeys(ACTIVITIES, 0.0)
    for start, end, activity in segments:
        spent[activity] += end - start
    working = {activity: seconds for activity, seconds in spent.items() if activity != "think" and seconds > 0}
    return max(working, key=working.get) if working else "think"


def _steps(segments, floor):
    """Segments grouped into at most MAX_STEPS_PER_TURN steps, none shorter
    than ``floor`` seconds unless it is the turn's only one."""
    groups, pending = [], []
    for segment in segments:
        pending.append(segment)
        if segment[2] != "think":
            groups.append(pending)
            pending = []
    if pending:
        # Thinking that leads nowhere else is the reply being written.
        groups.append(pending)
    merged = []
    for group in groups:
        if merged and _primary(merged[-1]) == _primary(group):
            merged[-1] = merged[-1] + group
        else:
            merged.append(group)
    length = lambda group: group[-1][1] - group[0][0]
    while len(merged) > 1:
        shortest = min(range(len(merged)), key=lambda index: length(merged[index]))
        if len(merged) <= MAX_STEPS_PER_TURN and length(merged[shortest]) >= floor:
            break
        neighbours = [index for index in (shortest - 1, shortest + 1) if 0 <= index < len(merged)]
        other = min(neighbours, key=lambda index: length(merged[index]))
        low, high = sorted((shortest, other))
        merged[low:high + 1] = [merged[low] + merged[high]]
    return merged


def _step_label(counts, spent, wrote):
    parts = sorted(counts, key=lambda name: (-spent.get(COUNT_ACTIVITY[name], 0), -counts[name], name))[:LABEL_PARTS]
    if not parts:
        return "Wrote the reply" if wrote else "Thinking"
    text = ", ".join(COUNT_PHRASES[name][counts[name] != 1] % counts[name] for name in parts)
    return text[0].upper() + text[1:]


def _highlights(tools):
    """A few of the things a step touched: files it edited first, then the
    commands it ran, by the agent's own description where it gave one."""
    seen, picked = set(), []
    ranked = sorted(tools, key=lambda tool: {"edit": 0, "command": 1, "agent": 2}.get(tool.get("category"), 3))
    for tool in ranked:
        if tool.get("category") not in ("edit", "command", "agent"):
            continue
        text = tool.get("description") or tool.get("title") or ""
        if tool.get("category") == "edit":
            # A file outside the session's folder shows its whole path.
            text = "/".join(text.split("/")[-2:])
        text = _clip(text, 90)
        if text and text not in seen:
            seen.add(text)
            picked.append(text)
        if len(picked) == HIGHLIGHTS:
            break
    return picked


def _crew_key(kind, role, model):
    return "%s:%s:%s" % (kind, role or "", model or "unknown")


def _helper_view(kind, row, name, status, start, end, bill, price, offset_of):
    """A subagent's or a worker's row: placed on the run's axis by when it
    started, timed by its own clock, because most of a background helper's
    work happens while the run's agent waits."""
    end = max(end, start)
    view = bill.view(price)
    model = row.get("model") or (view["models"][0] if view["models"] else None)
    return {"kind": kind, "id": row.get("id"), "name": _clip(name), "role": row.get("role"), "model": model,
            "effort": row.get("effort"), "crew": _crew_key(kind, row.get("role"), model),
            "status": status, "startedAt": _iso(start), "seconds": round(end - start, 1),
            "start": round(offset_of(start), 1), "end": round(offset_of(end), 1), "wallStart": start,
            "tokens": view["tokens"], "cost": view["cost"], "unpriced": view["unpriced"]}


def _agent_view(row, bill, price, offset_of, now, live):
    start = _seconds(row.get("startedAt"))
    if start is None:
        return None
    end = _seconds(row.get("endedAt"))
    if end is None and isinstance(row.get("durationMs"), (int, float)):
        end = start + row["durationMs"] / 1000
    if end is None:
        end = now if live and row.get("status") == "running" else (_seconds(row.get("updatedAt")) or start)
    kind = row.get("kind") if row.get("kind") in ("swarm", "workflow") else "subagent"
    return _helper_view(kind, row, row.get("name") or "Subagent", row.get("status") or "unknown",
                        start, end, bill, price, offset_of)


def _worker_view(row, bill, price, offset_of, now):
    """An Orchestrate task's row. It starts when the run delegated it and
    runs up to ``now`` while its agent is working (``live``) or has not
    started. Otherwise it ends at its conversation's last record: a task can
    stay unsettled long after its worker stopped. A settled one ends when
    its result reached the run instead, if someone has chatted in the
    worker's run since."""
    start = _seconds(row.get("createdAt"))
    if start is None:
        return None
    usage = row.get("usage") or {}
    state = row.get("state")
    active = state in WORKER_ACTIVE
    if active and now is not None and (row.get("live") or not usage):
        end = now
    else:
        # The watch tick restamps an unsettled task, so its updatedAt says
        # nothing about when the worker stopped.
        stamps = [stamp for stamp in (_seconds(usage.get("updatedAt")), None if active else _seconds(row.get("updatedAt")))
                  if stamp is not None]
        end = min(stamps) if stamps else start
    # The model the worker's conversation ran on outranks the one asked for.
    chosen = dict(row, id=row.get("taskId"), model=usage.get("model") or row.get("model"),
                  effort=usage.get("effort") or row.get("effort"))
    view = _helper_view("worker", chosen, row.get("title") or row.get("text") or "Worker",
                        WORKER_STATUS.get(state, "unknown"), start, end, bill, price, offset_of)
    view.update(agent=row.get("agent"), runId=row.get("childRunId"), error=_clip(row.get("error")) or None)
    return view


def _crew(steps, main_bill, helpers, main, price):
    """Who did the run's work, the run's own agent first: one entry for each
    model it ran on, then its subagents and its workers grouped by role and
    model. ``steps`` are (crew key, model, seconds) and ``helpers`` are
    (view, Bill)."""
    main = main or {}
    entries, order = {}, []

    def entry(key, kind, role, model):
        if key not in entries:
            entries[key] = {"key": key, "kind": kind, "role": role, "model": model, "count": 0, "seconds": 0.0,
                            "bill": Bill(), "efforts": set()}
            order.append(key)
        return entries[key]

    for model in main_bill.view(price)["models"]:
        entry(_crew_key("main", None, model), "main", None, model)["bill"].add(model, main_bill.models[model])
    for key, model, seconds in steps:
        entry(key, "main", None, model)["seconds"] += seconds
    for key in order:
        entries[key]["count"] = 1
        # The session reports one effort, for the model it is on now.
        if main.get("effort") and (len(order) == 1 or entries[key]["model"] == main.get("model")):
            entries[key]["efforts"].add(main["effort"])
    for view, bill in helpers:
        row = entry(view["crew"], view["kind"], view["role"], view["model"])
        row["count"] += 1
        row["seconds"] += view["seconds"]
        row["bill"].merge(bill)
        row["efforts"].add(view["effort"])
    out = []
    for key in order:
        row = entries[key]
        view = row["bill"].view(price)
        efforts = row["efforts"]
        out.append({"key": key, "kind": row["kind"], "role": row["role"], "model": row["model"],
                    "effort": next(iter(efforts)) if len(efforts) == 1 else None, "count": row["count"],
                    "seconds": round(row["seconds"], 1), "tokens": view["tokens"], "cost": view["cost"],
                    "unpriced": view["unpriced"]})
    return out


def build(items, calls, subagents, billed, price, live=False, now=None, workers=(), main=None):
    """The waterfall payload for one conversation.

    ``items`` are a Reader's chat items, ``calls`` its Summary's own model
    calls as (key, entry), ``subagents`` the rows run_subagents.snapshot
    returns and ``billed`` each one's model calls by id. ``price(model,
    tokens)`` is the cost estimate. ``live`` says the agent is working now,
    so its last turn runs up to ``now``. ``workers`` are the run's
    Orchestrate tasks, each with the ``usage`` its own run's conversation
    recorded and whether its agent is working now (``live``), and ``main``
    the model and effort the run's agent is on."""
    split = _split_turns(items)
    turns = []
    for index, (opener, timed) in enumerate(split):
        start = _seconds(opener.get("at"))
        if start is None:
            continue
        last = index == len(split) - 1
        stamps = [_seconds(item.get(key)) for item in timed for key in ("at", "endedAt")]
        end = max([stamp for stamp in stamps if stamp is not None] + [start])
        if live and last and now is not None:
            end = max(end, now)
        segments, events = _segments(start, timed, end)
        if not segments:
            continue
        turns.append({"opener": opener, "wallStart": start, "wallEnd": segments[-1][1],
                      "segments": segments, "events": events})
    if not turns:
        return None
    offset = 0.0
    for turn in turns:
        turn["offset"] = offset
        offset += turn["wallEnd"] - turn["wallStart"]
    total_seconds = offset
    starts = [turn["wallStart"] for turn in turns]

    def offset_of(wall):
        turn = turns[max(bisect.bisect_right(starts, wall) - 1, 0)]
        return turn["offset"] + min(max(wall - turn["wallStart"], 0.0), turn["wallEnd"] - turn["wallStart"])

    steps = []
    for turn in turns:
        length = turn["wallEnd"] - turn["wallStart"]
        floor = max(MIN_STEP_SECONDS, length * MIN_TURN_SHARE, total_seconds * MIN_RUN_SHARE)
        turn["steps"] = []
        for group in _steps(turn["segments"], floor):
            step = {"turn": turn, "wallStart": group[0][0], "wallEnd": group[-1][1], "segments": group,
                    "bill": Bill(), "tools": [], "wrote": False}
            turn["steps"].append(step)
            steps.append(step)
        ends = [step["wallEnd"] for step in turn["steps"]]
        for at, ended, _, tool, item in turn["events"]:
            # A tool call belongs to the step it ran in, which starts where
            # the one before it ends.
            probe = at + min(0.001, (ended - at) / 2) if ended is not None and ended > at else at
            step = turn["steps"][min(bisect.bisect_left(ends, probe), len(ends) - 1)]
            if tool:
                step["tools"].append(item)
            elif item.get("kind") == "assistant":
                step["wrote"] = True

    step_ends = [step["wallEnd"] for step in steps]
    seen = set()
    for key, entry in calls:
        seen.add(key)
        at = _seconds(entry.get("at"))
        # A call recorded outside every turn joins the nearest step.
        index = 0 if at is None else min(bisect.bisect_left(step_ends, at), len(steps) - 1)
        steps[index]["bill"].add(entry.get("model") or "unknown", entry["tokens"])

    run_bill, run_spent, agents, helpers = Bill(), dict.fromkeys(ACTIVITIES, 0.0), [], []
    for row in subagents:
        bill = Bill()
        for key, entry in billed.get(row.get("id"), ()):
            # A message a subagent shares with its parent is billed once.
            if key in seen:
                continue
            seen.add(key)
            bill.add(entry.get("model") or "unknown", entry["tokens"])
        view = _agent_view(row, bill, price, offset_of, now, live)
        if view is not None:
            run_bill.merge(bill)
            agents.append(view)
            helpers.append((view, bill))
    for row in workers:
        bill = Bill()
        for _, entry in (row.get("usage") or {}).get("calls", ()):
            bill.add(entry.get("model") or "unknown", entry["tokens"])
        view = _worker_view(row, bill, price, offset_of, now)
        if view is not None:
            agents.append(view)
            helpers.append((view, bill))
    agents.sort(key=lambda agent: agent["wallStart"])

    out, main_bill, main_steps = [], Bill(), []
    for number, turn in enumerate(turns, 1):
        turn_bill, turn_spent, turn_steps = Bill(), dict.fromkeys(ACTIVITIES, 0.0), []
        for step in turn["steps"]:
            spent, counts, edited = dict.fromkeys(ACTIVITIES, 0.0), {}, set()
            for start, end, activity in step["segments"]:
                spent[activity] += end - start
            for tool in step["tools"]:
                name = CATEGORY_COUNT.get(tool.get("category"))
                if name == "edit":
                    edited.add(tool.get("title"))
                elif name:
                    counts[name] = counts.get(name, 0) + 1
            if edited:
                counts["edit"] = len(edited)
            view = step["bill"].view(price)
            turn_bill.merge(step["bill"])
            for activity in ACTIVITIES:
                turn_spent[activity] += spent[activity]
            turn_steps.append({
                "model": view["models"][0] if view["models"] else None,
                "label": _step_label(counts, spent, step["wrote"]),
                "activity": _primary(step["segments"]),
                "startedAt": _iso(step["wallStart"]),
                "start": round(offset_of(step["wallStart"]), 1),
                "end": round(turn["offset"] + step["wallEnd"] - turn["wallStart"], 1),
                "segments": [[round(turn["offset"] + start - turn["wallStart"], 1),
                              round(turn["offset"] + end - turn["wallStart"], 1), activity]
                             for start, end, activity in step["segments"]],
                "spent": {activity: round(seconds, 1) for activity, seconds in spent.items() if seconds > 0},
                "counts": counts,
                "failed": sum(1 for tool in step["tools"] if tool.get("status") == "error"),
                "highlights": _highlights(step["tools"]),
                "tokens": view["tokens"], "cost": view["cost"], "models": view["models"],
                "unpriced": view["unpriced"],
            })
        view = turn_bill.view(price)
        run_bill.merge(turn_bill)
        main_bill.merge(turn_bill)
        for activity in ACTIVITIES:
            run_spent[activity] += turn_spent[activity]
        previous = turns[number - 2]["wallEnd"] if number > 1 else None
        last = number == len(turns)
        out.append({
            "index": number,
            "model": view["models"][0] if view["models"] else None,
            "label": _turn_label(turn["opener"]),
            "startedAt": _iso(turn["wallStart"]),
            "start": round(turn["offset"], 1),
            "end": round(turn["offset"] + turn["wallEnd"] - turn["wallStart"], 1),
            "idleBefore": round(max(turn["wallStart"] - previous, 0.0), 1) if previous is not None else 0,
            "spent": {activity: round(seconds, 1) for activity, seconds in turn_spent.items() if seconds > 0},
            "tokens": view["tokens"], "cost": view["cost"], "models": view["models"], "unpriced": view["unpriced"],
            "steps": turn_steps,
            "agents": [{key: value for key, value in agent.items() if key != "wallStart"} for agent in agents
                       if turn["wallStart"] <= agent["wallStart"]
                       and (last or agent["wallStart"] < turns[number]["wallStart"])],
        })
    # A subagent that started before the first turn still belongs to the run.
    out[0]["agents"] = [{key: value for key, value in agent.items() if key != "wallStart"}
                        for agent in agents if agent["wallStart"] < turns[0]["wallStart"]] + out[0]["agents"]
    # A step that made no model call of its own ran on its turn's model, and
    # a turn that made none on the run's.
    used = main_bill.view(price)["models"]
    fallback = used[0] if used else (main or {}).get("model") or "unknown"
    for turn in out:
        turn["model"] = turn["model"] or fallback
        turn["crew"] = _crew_key("main", None, turn["model"])
        for step in turn["steps"]:
            step["model"] = step["model"] or turn["model"]
            step["crew"] = _crew_key("main", None, step["model"])
            main_steps.append((step["crew"], step["model"], step["end"] - step["start"]))
    view = run_bill.view(price)
    return {
        "startedAt": _iso(turns[0]["wallStart"]),
        "endedAt": _iso(turns[-1]["wallEnd"]),
        "seconds": round(total_seconds, 1),
        "spent": {activity: round(seconds, 1) for activity, seconds in run_spent.items() if seconds > 0},
        "tokens": view["tokens"], "cost": view["cost"], "models": view["models"], "unpriced": view["unpriced"],
        "crew": _crew(main_steps, main_bill, helpers, main, price),
        "turns": out,
    }
