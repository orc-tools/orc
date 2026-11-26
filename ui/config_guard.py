"""Keep ~/.orc/config.json, every setting the user has, from being wiped.

Twice a test replaced it with a fixture. Two rules, each enough on its own:

- A test never writes the real file, however it was started (`test_refusal`).
- The running Orc keeps the last good settings and puts them back when
  something else empties the file (`Keeper`). That also covers what the first
  rule cannot see: an older checkout, a script, a shell redirect.

stdlib-only: bin/ helpers and ui/ import it.
"""
import json
import os
import pwd
import sys
import tempfile
import threading
import time

TEST_RUNNERS = ("unittest", "pytest", "_pytest")
BACKUP_DIR = os.path.join("backups", "config")
LAST_GOOD = "last-good.json"
SNAPSHOT_SECONDS = 60 * 60
KEEP_RECENT = 24
KEEP_DAYS = 30


def real_config_path():
    """The user's own config.json. From the account, not HOME, which tests move."""
    try:
        home = pwd.getpwuid(os.getuid()).pw_dir
    except KeyError:
        home = os.path.expanduser("~")
    return os.path.realpath(os.path.join(home, ".orc", "config.json"))


def test_refusal(path):
    """Why a test may not write `path`, or None. bin/test exports
    ORC_TEST_REAL_HOME; a test run straight through Python has only its
    runner's modules to show for it."""
    target = os.path.realpath(os.fspath(path))
    test_home = os.environ.get("ORC_TEST_REAL_HOME")
    if test_home and target == os.path.realpath(os.path.join(test_home, ".orc", "config.json")):
        return "refusing to write the real config.json under the test suite"
    if target == real_config_path() and any(name in sys.modules for name in TEST_RUNNERS):
        return "refusing to write the real config.json under the test suite"
    return None


def _keys(value):
    return set(value) if isinstance(value, dict) else set()


def wipes(before, after):
    """Whether going from `before` to `after` throws settings away wholesale.
    The user's own edits drop a project or a setting at a time."""
    if not isinstance(before, dict) or not before:
        return False
    if not isinstance(after, dict) or not after:
        return True
    had, kept = _keys(before.get("repos")), _keys(after.get("repos"))
    lost = len(had - kept)
    if lost >= 3 and lost * 2 > len(had):
        return True
    if len(_keys(before) - _keys(after)) >= 3:
        return True
    ui, ui_after = _keys(before.get("ui")), _keys(after.get("ui"))
    return len(ui) >= 4 and len(ui - ui_after) * 2 > len(ui)


def _write(path, data):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".config.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except OSError:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _encode(config):
    return (json.dumps(config, indent=2) + "\n").encode()


def _load(path):
    """(config, bytes) of a file: None for missing or empty bytes, and None
    for a config that does not parse."""
    try:
        with open(path, "rb") as handle:
            raw = handle.read()
    except FileNotFoundError:
        return None, None
    try:
        config = json.loads(raw)
    except ValueError:
        return None, raw
    return config, raw


class Keeper:
    """The last good settings of one config.json, kept beside it."""

    def __init__(self, path):
        self.path = os.fspath(path)
        self.directory = os.path.join(os.path.dirname(self.path), BACKUP_DIR)
        self.lock = threading.Lock()
        self.good = None

    def _last_good(self):
        if self.good is None:
            self.good, _ = _load(os.path.join(self.directory, LAST_GOOD))
        return self.good

    def replacement(self):
        """The settings to use in place of what the file holds now, or None
        when the file is fine. A file with a syntax error is left for the user
        to fix by hand, as a half-finished edit is worth keeping."""
        with self.lock:
            good = self._last_good()
            config, raw = _load(self.path)
            if good is None or (config is None and (raw or b"").strip()):
                return None
            return good if wipes(good, config) else None

    def accept(self, config):
        """Remember `config` as good, with a dated copy at most once an hour."""
        with self.lock:
            if config == self._last_good():
                return
            data = _encode(config)
            _write(os.path.join(self.directory, LAST_GOOD), data)
            self.good = json.loads(data)
            names = self._snapshots()
            newest = os.path.join(self.directory, names[-1]) if names else None
            if newest is None or time.time() - os.path.getmtime(newest) >= SNAPSHOT_SECONDS:
                _write(os.path.join(self.directory, time.strftime("config-%Y%m%d-%H%M%S.json")), data)
                self._prune()

    def heal(self):
        """Put the last good settings back over a wiped file, keeping the
        wiped copy. Answers where that copy went, "" for a missing file, or
        None when nothing was wrong. Call under the config write lock."""
        good = self.replacement()
        if good is None:
            return None
        _, raw = _load(self.path)
        kept = ""
        if raw is not None:
            kept = os.path.join(self.directory, time.strftime("wiped-%Y%m%d-%H%M%S.json"))
            _write(kept, raw)
        _write(self.path, _encode(good))
        return kept

    def _snapshots(self):
        try:
            names = os.listdir(self.directory)
        except OSError:
            return []
        return sorted(name for name in names if name.startswith("config-") and name.endswith(".json"))

    def _prune(self):
        names = self._snapshots()
        keep = set(names[-KEEP_RECENT:])
        daily = {name[7:15]: name for name in names}
        keep.update(daily[day] for day in sorted(daily)[-KEEP_DAYS:])
        for name in names:
            if name not in keep:
                os.unlink(os.path.join(self.directory, name))
