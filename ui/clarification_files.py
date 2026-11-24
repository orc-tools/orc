"""Settle a run's answered Clarification: publish its brief, drop its questions.

The brief is immutable once written. The question file lives at the run root,
with a clarification/ sibling serve.py also reads, so both go; the frozen
copies under clarification-review/ stay as the record of what was asked.
"""
import os
import tempfile
from pathlib import Path

BRIEF = Path("inputs") / "clarification-brief.md"
QUESTIONS = (Path("clarification-questions.json"),
             Path("clarification") / "clarification-questions.json")


class ClarificationError(Exception):
    pass


def remove_questions(run_dir):
    """The question files removed, as run-relative strings."""
    removed = []
    for relative in QUESTIONS:
        path = Path(run_dir) / relative
        if path.is_file() or path.is_symlink():
            path.unlink()
            removed.append(str(relative))
    return removed


def publish_brief(run_dir, payload):
    """Write the brief once; the same bytes again are a no-op."""
    if not payload.strip():
        raise ClarificationError("the brief is empty")
    path = Path(run_dir) / BRIEF
    if path.exists():
        if path.is_symlink() or path.read_bytes() != payload:
            raise ClarificationError("%s already holds a different brief" % BRIEF)
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=".brief.", suffix=".tmp")
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
    return True
