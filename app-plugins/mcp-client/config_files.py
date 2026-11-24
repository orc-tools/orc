"""Writes to the config files Claude and Codex keep MCP servers in.

Each write reads the file under a lock, keeps a copy of it as it was, and
replaces it in one step, so an agent never reads half a file. An agent that
saved the file in between wins: the write is refused instead of undoing it.

Copies go to ``<Orc's folder>/backups/mcp-client``, the newest ``KEPT`` of
each file.
"""
from __future__ import annotations

from contextlib import ExitStack
import fcntl
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import time

from . import config_edit

KEPT = 20
# project_trust.py takes the same lock beside a login's config, so marking a
# folder trusted and changing its servers never overwrite each other.
LOCK_SUFFIX = ".orc-trust.lock"
# Claude Code holds this folder beside its config while it saves it.
CLAUDE_SAVING = ".lock"
CLAUDE_SAVING_WAIT = 2.0
GIT_TIMEOUT = 10
CODEX_PROJECT_FILE = ".codex/config.toml"


def _key(path) -> str:
    return hashlib.sha256(str(path).encode()).hexdigest()[:12]


def _read(path) -> bytes | None:
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def _replace(path, data, mode) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".%s." % path.name, dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


class Files:
    def __init__(self, orc_dir, *, now=time.time):
        self.orc_dir = Path(orc_dir)
        self.backups = self.orc_dir / "backups" / "mcp-client"
        self.now = now

    def _lock(self, stack, path, beside) -> None:
        if beside:
            lock = path.with_name(path.name + LOCK_SUFFIX)
        else:
            lock = self.orc_dir / "mcp-client" / "locks" / _key(path)
        lock.parent.mkdir(parents=True, exist_ok=True)
        fcntl.flock(stack.enter_context(open(lock, "a")).fileno(), fcntl.LOCK_EX)

    def back_up(self, path, data) -> Path:
        """Keeps ``data``, the file as it was, and drops the oldest copies
        of that file past ``KEPT``."""
        self.backups.mkdir(parents=True, exist_ok=True)
        os.chmod(self.backups, 0o700)
        prefix = "%s-%s" % (_key(path), path.name.lstrip("."))
        stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime(self.now()))
        copies = sorted(self.backups.glob(prefix + ".*"))
        copy = self.backups / ("%s.%s-%03d" % (prefix, stamp, len([c for c in copies if stamp in c.name])))
        _replace(copy, data, 0o600)
        for old in copies[:max(0, len(copies) + 1 - KEPT)]:
            old.unlink(missing_ok=True)
        return copy

    def change(self, edits) -> dict:
        """Applies ``{path: (edit, beside)}``, where ``edit(text)`` answers
        the file's new text and ``beside`` says its lock sits next to it (a
        file in a repo keeps its lock in Orc's folder instead). Every edit
        runs before any file is written, so one that is refused leaves them
        all as they were. Answers ``{path: copy}`` for the files that
        changed: the copy of each as it was, or None for a new file."""
        edits = {Path(os.path.realpath(path)): how for path, how in edits.items()}
        with ExitStack() as stack:
            for path in sorted(edits):
                self._lock(stack, path, edits[path][1])
                _wait_for_claude(path)
            planned = {}
            for path, (edit, _beside) in edits.items():
                was = _read(path)
                try:
                    text = (was or b"").decode("utf-8")
                except UnicodeError:
                    raise config_edit.EditError("Orc could not read %s, so it left it alone." % path.name) from None
                updated = edit(text)
                if updated != text:
                    planned[path] = (was, updated.encode("utf-8"))
            for path, (was, _updated) in planned.items():
                if _read(path) != was:
                    raise config_edit.EditError("%s changed while Orc was saving. Try again." % path.name)
            changed = {}
            for path, (was, updated) in planned.items():
                changed[path] = self.back_up(path, was) if was is not None else None
                _replace(path, updated, os.stat(path).st_mode & 0o777 if was is not None else 0o600)
            return changed


def _wait_for_claude(path) -> None:
    saving = path.with_name(path.name + CLAUDE_SAVING)
    deadline = time.monotonic() + CLAUDE_SAVING_WAIT
    while saving.exists() and time.monotonic() < deadline:
        time.sleep(0.05)


def _git(folder, *args) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(folder), *args], capture_output=True, text=True, timeout=GIT_TIMEOUT,
                          env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"})


def keep_out_of_git(folder, relative=CODEX_PROJECT_FILE) -> bool:
    """Makes git ignore ``relative`` in the repo ``folder`` is in, through
    the repo's own ``info/exclude``, which is never committed. True when it
    added the line. A folder outside git needs nothing, and a repo that
    already commits the file shares it with a team, so Orc refuses."""
    try:
        if _git(folder, "rev-parse", "--is-inside-work-tree").stdout.strip() != "true":
            return False
        if _git(folder, "ls-files", "--error-unmatch", "--", relative).returncode == 0:
            raise config_edit.EditError(
                "This repo commits %s, which its team shares, so Orc leaves it alone." % relative)
        if _git(folder, "check-ignore", "-q", "--", relative).returncode == 0:
            return False
        prefix = _git(folder, "rev-parse", "--show-prefix").stdout.strip()
        exclude = Path(_git(folder, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude").stdout.strip())
    except (OSError, subprocess.SubprocessError):
        raise config_edit.EditError("Orc could not ask git about %s. Try again." % folder) from None
    try:
        was = exclude.read_text(encoding="utf-8") if exclude.exists() else ""
        exclude.parent.mkdir(parents=True, exist_ok=True)
        with open(exclude, "a", encoding="utf-8") as stream:
            stream.write("%s/%s%s\n" % ("" if was.endswith("\n") or not was else "\n", prefix, relative))
    except (OSError, UnicodeError):
        raise config_edit.EditError("Orc could not keep %s out of git." % relative) from None
    return True
