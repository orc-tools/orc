import contextlib
import json
import os
import tempfile
from datetime import datetime, timezone

import headless_session


def _turns(run_dir):
    try:
        names = os.listdir(headless_session._dir(run_dir))
    except OSError:
        return []
    return sorted(int(match.group(1)) for match in map(headless_session._TURN_FILE.match, names)
                  if match and match.group(2) == "jsonl")


def _first_turn(run_dir):
    launch = headless_session.read_launch(run_dir)
    turn = (launch or {}).get("firstTurn")
    if isinstance(turn, int) and turn > 1:
        return turn
    try:
        with open(os.path.join(run_dir, "meta.json")) as handle:
            rescue = (json.load(handle) or {}).get("sessionRescue") or {}
    except (OSError, ValueError):
        return 1
    turn = rescue.get("firstTurn")
    return turn if isinstance(turn, int) and turn > 1 else 1


def _write_index(run_dir, agent, index):
    fd, temporary = tempfile.mkstemp(dir=headless_session._dir(run_dir), prefix=".transcript-")
    with os.fdopen(fd, "w") as handle:
        json.dump(index, handle)
    os.replace(temporary, headless_session._path(run_dir, agent + "-transcript.json"))


def sync(run_dir, agent, final=False, strict=False):
    """Keep complete NDJSON records before headless turn logs are pruned."""
    transcript = headless_session._path(run_dir, agent + "-transcript.jsonl")
    with headless_session._locked(run_dir, ".transcript.lock"):
        first_turn = _first_turn(run_dir)
        try:
            with open(headless_session._path(run_dir, agent + "-transcript.json")) as handle:
                index = json.load(handle)
        except (OSError, ValueError):
            index = None
        valid = (isinstance(index, dict) and isinstance(index.get("turn"), int)
                 and isinstance(index.get("offset"), int) and isinstance(index.get("line"), int))
        recorded_first = index.get("firstTurn", 1) if valid else None
        reset_generation = (valid and recorded_first != first_turn) or (
            not valid and first_turn > 1 and os.path.exists(transcript))
        if not valid or recorded_first != first_turn:
            index = {"firstTurn": first_turn, "turn": first_turn, "offset": 0, "line": 0}
            saved = None
        else:
            saved = dict(index)
        if reset_generation:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(transcript)
        turns = [turn for turn in _turns(run_dir) if turn >= max(first_turn, index["turn"])]
        if not turns and not strict:
            if reset_generation:
                _write_index(run_dir, agent, index)
            return transcript
        out = []
        for position, turn in enumerate(turns):
            last = position == len(turns) - 1
            if turn != index["turn"]:
                index.update(turn=turn, offset=0, line=0)
            log = headless_session._path(run_dir, headless_session._turn_name(turn, "jsonl"))
            try:
                with open(log, "rb") as handle:
                    stamp = datetime.fromtimestamp(os.fstat(handle.fileno()).st_mtime, timezone.utc)
                    handle.seek(index["offset"])
                    data = handle.read()
            except OSError:
                if strict:
                    raise
                continue
            complete = data
            if last:
                complete = data[:data.rfind(b"\n") + 1]
                if final and _parses(data[len(complete):]):
                    complete = data
            index["offset"] += len(complete)
            records = _records(agent, turn, complete, index["line"], stamp)
            index["line"] += len(complete.splitlines())
            out.extend(json.dumps(record) + "\n" for record in records)
        if strict:
            out += _missing_records(run_dir, agent, transcript, out, final, first_turn)
        # Each orc-ui's first run-list scan asks every external-harness run for its thread,
        # which lands here; with nothing new, writing would only fsync and
        # rename the same bytes again.
        if not out and index == saved and os.path.exists(transcript):
            return transcript
        if not out and not turns and reset_generation:
            _write_index(run_dir, agent, index)
            return transcript
        with open(transcript, "a") as handle:
            handle.writelines(out)
            handle.flush()
            os.fsync(handle.fileno())
        _write_index(run_dir, agent, index)
    return transcript


def _records(agent, turn, data, first_line, stamp):
    records = []
    for line, raw in enumerate(data.splitlines(), first_line + 1):
        try:
            record = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(record, dict):
            continue
        record.setdefault("uuid", "%s-%d-%d" % (agent, turn, line))
        record.setdefault("timestamp", stamp.isoformat().replace("+00:00", "Z"))
        records.append(record)
    return records


def _missing_records(run_dir, agent, transcript, pending, final, first_turn=1):
    seen = set()
    for line in pending:
        seen.add(json.loads(line).get("uuid"))
    try:
        with open(transcript, "rb") as handle:
            for raw in handle:
                with contextlib.suppress(ValueError, AttributeError):
                    seen.add(json.loads(raw).get("uuid"))
    except FileNotFoundError:
        pass
    turns = [turn for turn in _turns(run_dir) if turn >= first_turn]
    out = []
    for turn in turns:
        with open(headless_session._path(run_dir, headless_session._turn_name(turn, "jsonl")), "rb") as handle:
            stamp = datetime.fromtimestamp(os.fstat(handle.fileno()).st_mtime, timezone.utc)
            data = handle.read()
        if turn == turns[-1]:
            complete = data[:data.rfind(b"\n") + 1]
            if final and _parses(data[len(complete):]):
                complete = data
            data = complete
        out.extend(json.dumps(record) + "\n" for record in _records(agent, turn, data, 0, stamp)
                   if record["uuid"] not in seen)
    return out


def _parses(data):
    try:
        return isinstance(json.loads(data), dict)
    except ValueError:
        return False

