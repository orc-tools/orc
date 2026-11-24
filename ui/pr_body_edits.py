"""Remember which PR bodies the user last saved from Orc.

The PR-body lint caps the agent's draft (one-sentence context, template
checklist, step counts). Once the user edits the body in Orc they are its
author, so those caps no longer apply. The edit is recorded as a hash of the
saved bytes, so an agent rewrite after the save is linted again.
"""

import hashlib
import json
import os
from pathlib import Path
import tempfile

RECORD = "pr-body-edits.json"


def _digest(data):
    return hashlib.sha256(data).hexdigest()


def _read(run_dir):
    try:
        value = json.loads((Path(run_dir) / RECORD).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def record(run_dir, rel_path, data):
    """Note that the user saved `data` as the PR body at `rel_path`."""
    edits = _read(run_dir)
    edits[rel_path] = _digest(data)
    fd, tmp = tempfile.mkstemp(dir=run_dir, prefix=".pr-body-edits.", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(edits, handle, indent=2, sort_keys=True)
    os.replace(tmp, Path(run_dir) / RECORD)


def user_authored(body, run_dir):
    """True when `body` still holds exactly what the user last saved."""
    if run_dir is None:
        return False
    try:
        rel_path = Path(body).resolve().relative_to(Path(run_dir).resolve()).as_posix()
        data = Path(body).read_bytes()
    except (OSError, ValueError):
        return False
    return _read(run_dir).get(rel_path) == _digest(data)
