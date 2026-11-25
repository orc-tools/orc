"""Why a run's app process stopped, and the fix for it.

The QA window shows the end of a stopped process's log. An enabled app plugin
can name known failures (`contributes.qaSetupFixes`): a pattern over that log
end, the reason in words and one command that fixes it. Orc core only matches
and runs: the command runs in a terminal of its own, outside the QA sandbox,
and only when the person presses Run it. When it exits cleanly, `on_success`
starts the app again."""

import os
import re
import threading
import uuid

import run_terminal

TAIL_LINES = 14
TAIL_BYTES = 16 * 1024

# The prefix a package manager puts on each line of its error output, so the
# cause reads without it.
TOOL_PREFIX = re.compile(r"^\s*(?:npm (?:error|ERR!)|pnpm:?|yarn error|error:?|ERROR:?|fatal:)\s*", re.I)
# Lines that say an error happened without saying why.
NOISE = re.compile(r"^(?:code \S+|errno \S+|syscall \S+|path \S+|A complete log of this run can be found in"
                   r"|\$ )", re.I)
ERROR_MARK = re.compile(r"^\s*(?:npm (?:error|ERR!)|error\b|ERR_|fatal\b|\w*Error\b)", re.I)
TOOL_LOG = re.compile(r"A complete log of this run can be found in:?\s+(\S+)")

# Failures any project can hit, which Orc fixes without a plugin. Same shape
# as an app plugin's `qaSetupFixes`, matched after them.
BUILTIN_FIXES = [{
    "plugin": None, "id": "npm-lock-out-of-sync",
    "match": r"`npm ci` can only install packages when your package\.json and",
    "reason": "npm ci: package-lock.json is out of sync with package.json",
    "explain": "npm install rebuilds the lock file and installs; Orc then starts the app. "
               "It may change package-lock.json in the worktree, which stays yours to keep or drop.",
    "command": "npm install",
}]
LOCK_MISMATCH = re.compile(r"Invalid: lock file's (\S+)@(\S+) does not satisfy \S+@(\S+)")


def failure_lines(text, count=TAIL_LINES):
    """The lines of a failed command's output that say why it failed: blank
    lines, bare `npm error` prefixes and npm's usage block dropped, then the
    last `count`. npm ci prints its whole usage after a lock-file mismatch,
    which would otherwise push the cause out of view."""
    lines = []
    usage = False
    for line in text.splitlines():
        line = line.rstrip()[:400]
        bare = TOOL_PREFIX.sub("", line, count=1).strip()
        if not bare:
            continue
        if bare == "Usage:" and lines:
            usage = True
            lines.pop()  # the command's one-line description above it
            continue
        if usage:
            usage = not bare.startswith('Run "npm help')
            continue
        lines.append(line)
    return lines[-count:]


def failure_headline(lines):
    """The one line that says why a command failed: the first error line that
    says more than a code, else the last line that does. Never npm's closing
    'A complete log of this run can be found in…'."""
    said = [TOOL_PREFIX.sub("", line, count=1).strip() for line in lines]
    useful = [(line, bare) for line, bare in zip(lines, said) if bare and not NOISE.match(bare)]
    if not useful:
        return None
    marked = [bare for line, bare in useful if ERROR_MARK.match(line)]
    headline = (marked or [useful[-1][1]])[0]
    # The first sentence, when the line goes on to say what to do about it.
    first = re.match(r"(.{20,}?[.!])\s+[A-Z]", headline)
    return (first.group(1) if first else headline)[:200]


def tool_log(lines):
    """The full log a tool such as npm wrote elsewhere, when its output names one."""
    for line in reversed(lines or []):
        found = TOOL_LOG.search(line)
        if found:
            return found.group(1)
    return None


def log_tail(path, count=TAIL_LINES):
    """The last `count` non-blank lines of a log, right-stripped but with their
    indentation kept, since tools such as pnpm indent the cause under the
    error. An unreadable log has no lines."""
    try:
        with open(path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            handle.seek(max(0, handle.tell() - TAIL_BYTES))
            text = handle.read().decode("utf-8", "replace")
    except OSError:
        return []
    lines = [line.rstrip()[:400] for line in text.splitlines() if line.strip()]
    return lines[-count:]


def match_fix(lines, fixes):
    """The first fix whose pattern is found in `lines`, as the fix plus
    `lines`: [first, last], the matched lines' indexes. None when no fix
    matches, or a pattern is bad (plugin validation should have refused it)."""
    text = "\n".join(lines or [])
    if not text:
        return None
    for fix in fixes or []:
        try:
            found = re.search(fix["match"], text)
        except (re.error, KeyError, TypeError):
            continue
        if found:
            first = text.count("\n", 0, found.start())
            last = text.count("\n", 0, max(found.start(), found.end() - 1))
            return {key: fix[key] for key in ("plugin", "id", "reason", "explain", "command") if key in fix} \
                | {"lines": [first, last], "explain": _explain(fix, text)}
    return None


def _explain(fix, text):
    """A fix's explanation, with the versions an npm lock-file mismatch names."""
    found = LOCK_MISMATCH.search(text) if fix.get("id") == "npm-lock-out-of-sync" else None
    if not found:
        return fix.get("explain")
    name, locked, wanted = found.groups()
    return "The worktree's lock file asks for %s %s, but package.json needs %s. %s" % (
        name, locked, wanted, fix["explain"])


class FixRun:
    """One fix command running, or finished, for one run."""

    def __init__(self, fix, shell):
        self.fix = fix
        self.shell = shell
        self.token = uuid.uuid4().hex
        self.exit_code = None
        self.error = None

    def view(self):
        state = "running" if self.exit_code is None else "done" if self.exit_code == 0 else "failed"
        return {"id": self.fix["id"], "token": self.token, "command": self.fix["command"], "state": state,
                "exitCode": self.exit_code, "error": self.error}


_RUNS = {}
_LOCK = threading.Lock()


TERMINAL = {"id": "terminal", "command": "Terminal"}


def start(run_id, fix, cwd, on_success, shell_factory=None):
    """Runs `fix["command"]` for `run_id` in a fresh PTY, replacing any
    earlier fix run. `on_success()` runs after a clean exit and returns an
    error text or None. The `TERMINAL` fix is a login shell of its own, for
    sorting out by hand what no fix knows."""
    login = os.environ.get("SHELL") or "/bin/sh"
    argv = [login, "-l"] if fix is TERMINAL else [login, "-l", "-c", fix["command"]]
    shell = (shell_factory or run_terminal.Shell)(cwd, None, argv)
    run = FixRun(fix, shell)
    with _LOCK:
        previous = _RUNS.get(run_id)
        _RUNS[run_id] = run
    if previous:
        previous.shell.close()

    def watch():
        code = shell.proc.wait()
        run.exit_code = code
        if code == 0:
            try:
                run.error = on_success()
            except Exception as error:  # noqa: BLE001 - shown to the person, never raised on a thread
                run.error = str(error) or "Setup did not start again."

    threading.Thread(target=watch, name="orc-qa-setup-fix", daemon=True).start()
    return run


def get(run_id):
    with _LOCK:
        return _RUNS.get(run_id)


def view(run_id):
    run = get(run_id)
    return run.view() if run else None


def close(run_id):
    """Stops and forgets the run's fix command. True when there was one."""
    with _LOCK:
        run = _RUNS.pop(run_id, None)
    if run:
        run.shell.close()
    return run is not None


def close_all():
    with _LOCK:
        runs = list(_RUNS.values())
        _RUNS.clear()
    for run in runs:
        run.shell.close()
