"""Claude Code accounts a run can launch under.

Each Claude Code login keeps its own config directory: ``~/.claude`` by
default, or the directory CLAUDE_CONFIG_DIR names. A directory used that way
holds its own ``.claude.json``, which is what tells a second login such as
``~/.claude-two`` apart from a backup or cache folder beside it. The default
login keeps that file at ``~/.claude.json`` instead, so it is always offered.
"""
import contextlib
import json
import os
import tempfile
import threading
from pathlib import Path

DEFAULT = ".claude"
REMOVED = ".orc-removed"
FORGOTTEN = ".orc-forgotten"


def _folders(home, keep):
    try:
        extra = sorted(entry.name for entry in home.glob(".claude-*")
                       if (entry / ".claude.json").is_file() and keep(entry))
    except OSError:
        extra = []
    return [DEFAULT, *extra]


def available(home=None, include_removed=False):
    """Account directory names under home, the default first. A forgotten
    account is never offered, removed or not."""
    home = Path(home) if home else Path.home()
    return _folders(home, lambda entry: not (entry / FORGOTTEN).exists()
                    and (include_removed or not (entry / REMOVED).exists()))


def launch_env(name):
    """Pane environment that starts Claude Code under the named account.

    The default sets nothing. CLAUDE_CONFIG_DIR=~/.claude would make Claude
    Code look for ``~/.claude/.claude.json`` rather than ``~/.claude.json``
    and treat the default login as a fresh install."""
    if name == DEFAULT or name not in available():
        return {}
    return {"CLAUDE_CONFIG_DIR": str(Path.home() / name)}


def transcript_roots():
    """Every account's transcript folder. Session ids are UUIDs, so one is
    found under whichever account ran it."""
    home = Path.home()
    return [home / name / "projects" for name in _folders(home, lambda entry: True)]


# Claude Fast mode is billed only to extra usage. A login without it still
# accepts the fastMode setting, then reports on its first event (system
# init) that Fast mode is off because extra usage is disabled, and answers at
# normal speed. Orc keeps that answer per login so the composer stops offering
# a switch that does nothing; a turn that comes back with Fast mode on, or
# Settings' "Show it again", forgets it.
FAST_FILE = "claude-fast-mode.json"
NO_EXTRA_USAGE = "extra_usage_disabled"
# The init event leads a turn's log; a resumed session can put a few lines first.
_INIT_LINES = 16
_FAST_LOCK = threading.Lock()


def _fast_path():
    return Path.home() / ".orc" / FAST_FILE


def _read_fast():
    try:
        record = json.loads(_fast_path().read_text())
    except (OSError, ValueError):
        return {}
    accounts = record.get("noExtraUsage") if isinstance(record, dict) else None
    return {name: at for name, at in accounts.items()
            if isinstance(name, str) and isinstance(at, str)} if isinstance(accounts, dict) else {}


def _write_fast(accounts):
    path = _fast_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix="." + FAST_FILE + ".")
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump({"noExtraUsage": accounts}, handle, indent=2, sort_keys=True)
        os.replace(temporary, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temporary)
        raise


def fast_unavailable():
    """The logins whose last Fast mode turn came back without it, because
    their account has no extra usage, default login first when listed."""
    names = _read_fast()
    return [name for name in available(include_removed=True) if name in names]


def _fast_init(log_path):
    try:
        with open(log_path, encoding="utf-8", errors="replace") as handle:
            for _, line in zip(range(_INIT_LINES), handle):
                with contextlib.suppress(ValueError):
                    event = json.loads(line)
                    if (isinstance(event, dict) and event.get("type") == "system"
                            and event.get("subtype") == "init"):
                        return event
    except OSError:
        pass
    return None


def record_fast_turn(account, log_path, now):
    """Remember what a finished Claude turn's init event said about Fast
    mode under ``account`` (None is the default login). Only a turn that
    asked for Fast mode says anything: the rest report it was not asked for.
    Returns True when the record changed."""
    init = _fast_init(log_path)
    if init is None:
        return False
    name = account if isinstance(account, str) and account else DEFAULT
    with _FAST_LOCK:
        accounts = _read_fast()
        if init.get("fast_mode_disabled_reason") == NO_EXTRA_USAGE:
            if name in accounts:
                return False
            accounts[name] = now
        elif init.get("fast_mode_state") == "on" and name in accounts:
            del accounts[name]
        else:
            return False
        _write_fast(accounts)
    return True


def forget_fast_unavailable():
    """Offer Fast mode again on every login, after the user turns on extra usage."""
    with _FAST_LOCK:
        if _read_fast():
            _write_fast({})
