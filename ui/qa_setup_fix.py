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
                | {"lines": [first, last]}
    return None


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


def start(run_id, fix, cwd, on_success, shell_factory=None):
    """Runs `fix["command"]` for `run_id` in a fresh PTY, replacing any
    earlier fix run. `on_success()` runs after a clean exit and returns an
    error text or None."""
    argv = [os.environ.get("SHELL") or "/bin/sh", "-l", "-c", fix["command"]]
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
