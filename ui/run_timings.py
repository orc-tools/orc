"""How long finished runs took, for Activity's Run times tab (GET /api/timings).

A run's time is its working time: the time the agent spent inside its turns,
summed from the timestamps in the run's transcript. The wait between the end
of one turn and the next prompt is left out, so a branch that sat overnight
before its reviewer came back does not read as a slow run."""
import collections
import datetime
import json
import os
import tempfile
import threading
import time

import run_chat

FINISHED = frozenset({"merged", "merged-to-parent", "complete"})
# A worker's time is already inside its parent's, and a review or a planning
# session is not a task anyone waits on.
LEFT_OUT_ROUTES = frozenset({"orchestration-worker", "local-review", "planning-session"})
STORE_NAME = "run-timings.json"
STORE_VERSION = 2
# Reading every transcript takes over ten seconds, so one request reads for
# this long and reports the rest as pending.
BUDGET_SECONDS = 2.0
CLAUDE_KINDS = tuple(b'"type":%s"%s"' % (gap, kind) for gap in (b"", b" ") for kind in (b"user", b"assistant", b"result"))
CODEX_TURN_STARTS = frozenset({"task_started", "user_message"})

_LOCK = threading.Lock()


def _seconds(stamp):
    if not isinstance(stamp, str):
        return None
    try:
        return datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _iso(seconds):
    return datetime.datetime.fromtimestamp(seconds, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _claude_step(record, models, efforts):
    """(counts, starts a turn) for one Claude-shaped record."""
    kind = record.get("type")
    if kind not in ("user", "assistant") or record.get("isSidechain"):
        return False, False
    message = record.get("message") if isinstance(record.get("message"), dict) else {}
    if kind == "assistant":
        model = message.get("model")
        # Claude Code writes a placeholder reply for an interrupted turn when
        # the session next resumes, which can be hours after the work stopped.
        if model == "<synthetic>":
            return False, False
        if isinstance(model, str) and model:
            models[model] += 1
        effort = run_chat.effort_level(record.get("effort"))
        if effort:
            efforts[effort] += 1
        return True, False
    content = message.get("content")
    answers_a_tool = isinstance(content, list) and any(
        isinstance(block, dict) and block.get("type") == "tool_result" for block in content)
    # Hook feedback, skill text and a compaction summary arrive as user
    # records in the middle of a turn.
    injected = record.get("isMeta") is True or record.get("isCompactSummary") is True
    return True, not answers_a_tool and not injected


def _codex_step(record, models, efforts):
    payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
    if record.get("type") == "turn_context":
        if isinstance(payload.get("model"), str) and payload["model"]:
            models[payload["model"]] += 1
        effort = run_chat.effort_level(payload.get("effort"))
        if effort:
            efforts[effort] += 1
    return True, record.get("type") == "event_msg" and payload.get("type") in CODEX_TURN_STARTS


class _Turns:
    """Working time summed turn by turn. A turn the harness timed itself
    counts at that figure; any other counts the time between its records."""

    def __init__(self):
        self.work = self.longest = 0.0
        self.count = 0
        self._stepped = 0.0
        self._reported = None

    def step(self, seconds):
        self._stepped += seconds
        self.longest = max(self.longest, seconds)

    def report(self, seconds):
        self._reported = (self._reported or 0.0) + seconds

    def close(self):
        self.work += self._stepped if self._reported is None else self._reported
        self._stepped, self._reported = 0.0, None

    def start(self):
        self.close()
        self.count += 1


def measure(harness, path):
    """Working time, turns, longest single step and model for one transcript,
    or None when it holds no timed turn."""
    codex = harness == "codex"
    step = _codex_step if codex else _claude_step
    models = collections.Counter()
    efforts = collections.Counter()
    turns = _Turns()
    first = last = None
    try:
        handle = run_chat._open_transcript(path)
    except OSError:
        return None
    try:
        with handle:
            for line in handle:
                # Most of a transcript's bytes are request bodies and tool
                # output; parsing only the lines that can count keeps a read
                # of every run to seconds.
                if not (codex or any(kind in line for kind in CLAUDE_KINDS)):
                    continue
                try:
                    record = json.loads(line)
                except (ValueError, UnicodeDecodeError):
                    continue
                if not isinstance(record, dict):
                    continue
                # Some harnesses stamp their records when Orc gathers them, so a whole
                # turn can share one timestamp; its result record carries
                # the turn's real duration.
                reported = record.get("duration_ms")
                if not codex and record.get("type") == "result" and isinstance(reported, (int, float)):
                    turns.report(reported / 1000)
                    continue
                at = _seconds(record.get("timestamp"))
                if at is None:
                    continue
                counts, starts = step(record, models, efforts)
                if not counts:
                    continue
                if first is None:
                    first = at
                if starts:
                    turns.start()
                elif last is not None and at > last:
                    turns.step(at - last)
                if last is None or at > last:
                    last = at
    except (OSError, EOFError):
        return None
    turns.close()
    if first is None or not turns.count or turns.work < 1:
        return None
    return {
        "seconds": int(round(turns.work)),
        "turns": turns.count,
        "longestStepSeconds": int(round(min(turns.longest, turns.work))),
        "startedAt": _iso(first),
        "model": models.most_common(1)[0][0] if models else None,
        "effort": efforts.most_common(1)[0][0] if efforts else None,
    }


def counts(meta):
    """Whether a run is a finished task: a delivered or completed change."""
    return (meta.get("status") in FINISHED
            and meta.get("route") not in LEFT_OUT_ROUTES
            and not meta.get("orchestrationWorker")
            and meta.get("outcome") != "question")


def _recorded_model(meta):
    """The model the run recorded for its own orchestrator, newest first."""
    recorded = meta.get("subagentModels")
    if not isinstance(recorded, dict):
        return None
    for entries in reversed(list(recorded.values())):
        for entry in reversed(entries if isinstance(entries, list) else []):
            if (isinstance(entry, dict) and entry.get("role") == "orchestrator"
                    and isinstance(entry.get("model"), str) and entry["model"] not in ("", "unknown")):
                return entry["model"]
    return None


def _model(meta, timing):
    """The run's model, without the provider a harness can put first
    (openai/gpt-6-astra), so one model is one group whatever ran it."""
    model = timing["model"] or _recorded_model(meta) or meta.get("launchModel")
    return (model.rsplit("/", 1)[-1] or None) if isinstance(model, str) else None


def _row(run_id, meta, timing):
    project = meta.get("projectContext") or meta.get("mainRepoPath") or meta.get("repoPath")
    return {
        "id": run_id,
        "title": meta.get("title") if isinstance(meta.get("title"), str) and meta["title"] else run_id,
        "project": project if isinstance(project, str) else "",
        "harness": run_chat.harness_of(meta),
        "model": _model(meta, timing),
        "effort": timing.get("effort") or run_chat.effort_level(meta.get("launchEffort")),
        "status": meta.get("status"),
        "startedAt": timing["startedAt"],
        "seconds": timing["seconds"],
        "turns": timing["turns"],
        "longestStepSeconds": timing["longestStepSeconds"],
    }


def _stamp(path):
    try:
        stat = os.stat(path)
    except OSError:
        return None
    return [str(path), stat.st_mtime_ns, stat.st_size]


def _load(path):
    try:
        with open(path, encoding="utf-8") as handle:
            stored = json.load(handle)
    except (OSError, ValueError):
        return {}
    runs = stored.get("runs") if isinstance(stored, dict) and stored.get("version") == STORE_VERSION else None
    return runs if isinstance(runs, dict) else {}


def _save(path, runs):
    temporary = None
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".run-timings-", dir=os.path.dirname(path))
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump({"version": STORE_VERSION, "runs": runs}, handle)
        os.replace(temporary, path)
    except (OSError, TypeError, ValueError):
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def _current(entry, meta_stamp):
    """Whether a stored entry still holds, judged by stat alone: finding a
    transcript again globs every agent's sessions."""
    if not isinstance(entry, dict) or entry.get("meta") != meta_stamp:
        return False
    transcript = entry.get("transcript")
    return transcript is None or (isinstance(transcript, list) and bool(transcript)
                                  and _stamp(transcript[0]) == transcript)


def _timing(row):
    return {key: row[key] for key in ("seconds", "turns", "longestStepSeconds", "startedAt", "model", "effort")}


def summary(runs_dir, usage_dir, read_meta, budget=BUDGET_SECONDS, clock=time.monotonic):
    """Every finished run's time, measured once and kept in ``usage_dir``.

    ``pending`` counts the runs this call ran out of time to read; asking
    again reads more. A figure outlives its transcript, so history stays
    after an agent prunes its old sessions."""
    store = os.path.join(usage_dir, STORE_NAME)
    with _LOCK:
        stored = _load(store)
        kept, rows, pending, changed = {}, [], 0, False
        deadline = clock() + budget
        try:
            names = sorted(os.listdir(runs_dir))
        except OSError:
            names = []
        for run_id in names:
            try:
                meta_stamp = os.stat(os.path.join(runs_dir, run_id, "meta.json")).st_mtime_ns
            except OSError:
                continue
            entry = stored.get(run_id)
            if not _current(entry, meta_stamp):
                meta = read_meta(run_id) or {}
                old = entry.get("row") if isinstance(entry, dict) and isinstance(entry.get("row"), dict) else None
                if not counts(meta):
                    entry = {"meta": meta_stamp, "transcript": None, "row": None}
                elif clock() >= deadline:
                    pending += 1
                    # A figure that may be out of date still beats a gap.
                    entry = entry if old else None
                else:
                    meta.setdefault("runId", run_id)
                    harness, path = run_chat.session_transcript(meta)
                    transcript = _stamp(path) if path is not None else None
                    if transcript is None:
                        timing = _timing(old) if old else None
                    elif old and entry.get("transcript") == transcript:
                        timing = _timing(old)
                    else:
                        timing = measure(harness, path)
                    entry = {"meta": meta_stamp, "transcript": transcript,
                             "row": _row(run_id, meta, timing) if timing else None}
                changed = changed or entry != stored.get(run_id)
            if entry is None:
                continue
            kept[run_id] = entry
            if entry.get("row"):
                rows.append(entry["row"])
        if changed or len(kept) != len(stored):
            _save(store, kept)
    rows.sort(key=lambda row: (row["startedAt"], row["id"]))
    return {"runs": rows, "pending": pending}
