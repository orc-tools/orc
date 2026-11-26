"""Orc's two power modes: Standard and Low power.

`ui.powerMode` in ~/.orc/config.json is `"standard"` (omitted when saved) or
`"low"`:

- `standard`: runs work in parallel, except that a project with
  `runsAtOnce` in its settings lets only that many of its runs work at once;
  its other runs wait in the project's queue.
- `low`: Queue mode. Builds go one at a time in priority order, and each keeps
  its place until it reaches Ship. Child turns receive `ORC_LOW_POWER=1`, and
  test/build runners cap their worker pools to keep the Mac cool and responsive.
  Runs that build nothing (plans, questions, reviews) never queue unless
  `ui.queueBuildsOnly` is false. It is on when absent, saved only when off, and
  stays on this computer like `ui.powerMode`.

Legacy configs migrate without rewriting disk on read: `"focused"` reads as
`"low"`, while `"high"` and `ui.highPower: true` read as `"standard"`.
Neither mode ever widens test scope beyond targeted checks.
"""
import contextlib
import fcntl
import json
import os
import tempfile

import run_relationships

NON_BUILD_ROUTES = run_relationships.NON_BUILD_ROUTES
MODES = ("standard", "low")
QUEUE_SCOPES = ("all", "new-only")
ENV_KEY = "ORC_LOW_POWER"
FOCUS_FILE = "focus.json"
PRIORITY_FILE = "priority.json"
# Why a run keeps working in the queue, saved in the run itself so that losing
# or rewriting focus.json (an older checkout, a restart, an update) never
# forgets it. Strongest first: `hand` the user started or resumed it, which
# lasts until the run finishes; `kept` Queue mode started for only new runs
# and kept it going, until it ships; `turn` it holds the queue's place.
PLACE_FILE = ".queue-place.json"
PLACES = ("hand", "kept", "turn")


def _orc_dir(config_dir=None):
    return config_dir or os.path.join(os.path.expanduser("~"), ".orc")


def _read_json_dict(path):
    try:
        with open(path) as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _write_json_atomic(path, payload):
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    try:
        fd, tmp = tempfile.mkstemp(prefix="." + os.path.basename(path) + ".", suffix=".tmp", dir=directory)
    except OSError:
        return False
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")
        os.replace(tmp, path)
        return True
    except OSError:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        return False


def mode(config):
    ui = config.get("ui") if isinstance(config, dict) else None
    if not isinstance(ui, dict):
        return "standard"
    saved = ui.get("powerMode")
    if saved in MODES:
        return saved
    if saved == "focused":
        return "low"
    return "standard"


def builds_only(config):
    """Whether Queue mode queues only builds, so plans and questions start
    straight away."""
    ui = config.get("ui") if isinstance(config, dict) else None
    return not (isinstance(ui, dict) and ui.get("queueBuildsOnly") is False)


def builds(meta):
    """Whether a run builds. A change run an agent has not classified yet
    counts, since nothing tells a question asked of it from a build."""
    return meta.get("route") not in NON_BUILD_ROUTES


def queues_in_low(meta, config):
    return builds(meta) or not builds_only(config)


def has_place(run_id, state):
    """Whether the last scheduling pass let the run work."""
    return run_id in (state.get("active") or []) or run_id in (state.get("beside") or [])


def read_place(run_dir):
    """Why the run keeps working in the queue: one of `PLACES`, or None."""
    data = _read_json_dict(os.path.join(run_dir, PLACE_FILE))
    return data.get("by") if data and data.get("by") in PLACES else None


def write_place(run_dir, place):
    """Save `place` (None forgets it). Returns whether it is on disk."""
    path = os.path.join(run_dir, PLACE_FILE)
    if place is None:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        except OSError:
            return False
        return True
    return os.path.isdir(run_dir) and _write_json_atomic(path, {"by": place})


def read_config(config_dir=None):
    return _read_json_dict(os.path.join(_orc_dir(config_dir), "config.json")) or {}


def configured(config_dir=None):
    return mode(read_config(config_dir))


@contextlib.contextmanager
def focus_lock(config_dir=None):
    """One flock over the priority and Low power queue state, shared by every
    orc-ui instance's scheduler and the priority/focus HTTP handlers."""
    directory = _orc_dir(config_dir)
    os.makedirs(directory, exist_ok=True)
    with open(os.path.join(directory, ".focus.lock"), "a+") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def read_focus(config_dir=None):
    data = _read_json_dict(os.path.join(_orc_dir(config_dir), FOCUS_FILE))
    if not data:
        return {}
    state = {
        key: [item for item in data[key] if isinstance(item, str)]
        for key in ("order", "beside", "queue", "paused", "active", "exempt")
        if isinstance(data.get(key), list)
    }
    if isinstance(data.get("focused"), str):
        state["focused"] = data["focused"]
    if isinstance(data.get("lanes"), dict):
        state["lanes"] = {run_id: lane for run_id, lane in data["lanes"].items()
                          if isinstance(run_id, str) and isinstance(lane, str)}
    if isinstance(data.get("resumedAt"), dict):
        state["resumedAt"] = {
            run_id: at for run_id, at in data["resumedAt"].items()
            if isinstance(run_id, str) and isinstance(at, (int, float)) and not isinstance(at, bool)
        }
    return state


def write_focus(state, config_dir=None):
    path = os.path.join(_orc_dir(config_dir), FOCUS_FILE)
    if not state:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        except OSError:
            return False
        return True
    return _write_json_atomic(path, state)


def clear_focus(config_dir=None):
    return write_focus({}, config_dir)


def sanitize_priority(runs):
    if not isinstance(runs, list):
        return []
    seen, clean = set(), []
    for item in runs:
        if not isinstance(item, str):
            continue
        run_id = item.strip()
        if run_id and run_id not in seen:
            seen.add(run_id)
            clean.append(run_id)
    return clean


def read_priority(config_dir=None):
    base = _orc_dir(config_dir)
    saved = _read_json_dict(os.path.join(base, PRIORITY_FILE))
    if saved is not None:
        return sanitize_priority(saved.get("runs"))
    return sanitize_priority(read_focus(base).get("order"))


def write_priority(runs, config_dir=None):
    clean = sanitize_priority(runs)
    path = os.path.join(_orc_dir(config_dir), PRIORITY_FILE)
    if not clean:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(path)
        return []
    if not _write_json_atomic(path, {"runs": clean}):
        raise OSError("could not write priority.json")
    return clean


def low_for(run_id=None, config_dir=None):
    del run_id
    return configured(config_dir) == "low"


def turn_env(run_id=None, config_dir=None):
    return {ENV_KEY: "1"} if low_for(run_id, config_dir) else {}


def hook_context(run_id=None, meta=None, config_dir=None):
    if isinstance(meta, (str, os.PathLike)):
        config_dir, meta = meta, None
    if isinstance(meta, dict):
        if (meta.get("status") not in ("running", "awaiting-gate", "escalated")
                or meta.get("outcome") or meta.get("phase") == "done"
                or meta.get("route") in NON_BUILD_ROUTES):
            return ""
    if not low_for(run_id, config_dir):
        return ""
    return (
        "Orc Low power is on: keep this Mac cool and responsive by capping test "
        "runners and builds to 1-2 workers where supported and avoiding parallel "
        "heavy commands. It never widens which checks to run: keep the targeted "
        "checks, and run the full suite only when the user asks for it or test "
        "selection falls back to it."
    )


def plan(members, previous=None, priority=None, prioritise=None, start=None,
         limit=1, lane_limits=None, exempt=None):
    """Order `members` and pick the active runs. A member is `{id, started,
    waiting, lane?, keeps?, shipped?}`.

    Explicitly prioritised runs lead in exact priority order and preempt
    lower-ranked runs immediately. An active run stays active until it stops
    for the user, or, when it `keeps` its place, until it gives that up. A
    run that `shipped` and has changes to make comes next: it takes the next
    free place, and preempts only when the user prioritises it again. The rest
    follow oldest-started first (`started`, then `id`). At most `limit` runs are
    active (None: no overall limit; Low power uses 1), and at most
    `lane_limits[lane]` from one lane, a project with a run queue. Runs in
    `exempt` (existing runs kept going when Queue mode starts for only new
    runs) are never auto-paused by `limit` until they ship, and non-exempt runs wait behind
    active exempt runs rather than running alongside them. `start` marks a
    member the user started or resumed by hand: it stays in `beside` while
    it is a member, so Orc never pauses it again, and it works beside the
    active runs whenever it is not one of them. Starting one while the active
    runs all wait for the user moves the place on to it.
    """
    previous = previous if isinstance(previous, dict) else {}
    by_id = {member["id"]: member for member in members}
    raw_priority = priority if priority is not None else previous.get("order")
    prio_ids = [run_id for run_id in sanitize_priority(raw_priority) if run_id in by_id]
    if prioritise in by_id:
        prio_ids = [prioritise] + [run_id for run_id in prio_ids if run_id != prioritise]
    prio_set = set(prio_ids)

    raw_exempt = previous.get("exempt") if exempt is None else exempt
    exempt_ids = [run_id for run_id in sanitize_priority(raw_exempt)
                  if run_id in by_id and not by_id[run_id].get("shipped")]
    exempt_set = set(exempt_ids)

    prev_active = previous.get("active")
    if not isinstance(prev_active, list):
        prev_active = [previous["focused"]] if previous.get("focused") else []
    kept = [run_id for run_id in prev_active if run_id in by_id
            and (not by_id[run_id]["waiting"] or by_id[run_id].get("keeps"))]
    if (start in by_id and not by_id[start]["waiting"] and start not in kept
            and all(by_id[run_id]["waiting"] for run_id in kept)):
        kept = [start] if kept else []
    kept_set = set(kept)
    leading = [run_id for run_id in prio_ids
               if run_id in kept_set or run_id == prioritise or not by_id[run_id].get("shipped")]
    sticky = [run_id for run_id in kept if run_id not in prio_set]
    returning = [run_id for run_id in prio_ids if run_id not in leading]
    rest = [
        member["id"] for member in sorted(
            members, key=lambda m: (not m.get("shipped"), m.get("started") or "", m["id"]))
        if member["id"] not in prio_set and member["id"] not in kept_set
    ]

    ordered = leading + sticky + returning + rest
    working = [run_id for run_id in ordered if not by_id[run_id]["waiting"]]
    candidates = [run_id for run_id in ordered
                  if not by_id[run_id]["waiting"] or run_id in kept_set]
    lane_limits = lane_limits or {}
    active, per_lane = [], {}
    for run_id in candidates:
        if run_id not in exempt_set:
            continue
        lane = by_id[run_id].get("lane")
        if lane in lane_limits and per_lane.get(lane, 0) >= lane_limits[lane]:
            continue
        per_lane[lane] = per_lane.get(lane, 0) + 1
        active.append(run_id)
    active_set = set(active)
    for run_id in candidates:
        if run_id in active_set:
            continue
        if limit is not None and len(active) >= limit:
            break
        lane = by_id[run_id].get("lane")
        if lane in lane_limits and per_lane.get(lane, 0) >= lane_limits[lane]:
            continue
        per_lane[lane] = per_lane.get(lane, 0) + 1
        active.append(run_id)
        active_set.add(run_id)
    focused = active[0] if active else None
    queue = active + [run_id for run_id in ordered if run_id not in active_set]

    beside = [run_id for run_id in sanitize_priority(previous.get("beside")) if run_id in by_id]
    if start in by_id and start not in beside:
        beside.append(start)
    beside_set = set(beside)
    paused = [run_id for run_id in working if run_id not in active_set and run_id not in beside_set]

    result = {
        "focused": focused,
        "active": active,
        "queue": queue,
        "order": prio_ids,
        "beside": beside,
        "paused": paused,
    }
    if exempt_ids:
        result["exempt"] = exempt_ids
    return result
