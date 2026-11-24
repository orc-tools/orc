"""orc-ui: starts and stops Orc's demo from Orc's source checkout.

bin/orc-demo is a publisher tool that never enters the public export, so a
public install has no demo and its commands stay hidden. The command owns the
demo's state; this module only asks it."""

import json
import os
import subprocess

# Seeding two machines and starting their servers takes about half a minute.
START_TIMEOUT = 180
COMMAND_TIMEOUT = 20
# Copying and zipping the demo's files takes a few seconds.
PACK_TIMEOUT = 120


class DemoError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def command(repo):
    return os.path.join(repo, "bin", "orc-demo")


def available(repo):
    return os.path.isfile(command(repo))


def _ask(repo, action, timeout, environ=None, options=()):
    if not available(repo):
        raise DemoError(404, "The demo is only in Orc's source checkout.")
    environ = dict(os.environ if environ is None else environ)
    environ["PYTHONDONTWRITEBYTECODE"] = "1"
    try:
        done = subprocess.run([command(repo), action, *options, "--json"], cwd=repo, capture_output=True,
                              text=True, timeout=timeout, env=environ)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise DemoError(500, "The demo did not answer: " + str(error)) from error
    if done.returncode:
        lines = [line for line in (done.stderr or "").splitlines() if line.strip()]
        raise DemoError(500, lines[-1] if lines else "orc-demo exited %d." % done.returncode)
    try:
        state = json.loads(done.stdout)
    except ValueError as error:
        raise DemoError(500, "orc-demo gave no answer.") from error
    if not isinstance(state, dict):
        raise DemoError(500, "orc-demo gave no answer.")
    return state


def _running(state):
    return {"running": state.get("running") is True, "url": state.get("url")}


def status(repo, environ=None):
    return _running(_ask(repo, "status", COMMAND_TIMEOUT, environ))


def start(repo, environ=None):
    """Starts the demo unless it is running, opens it in the browser, and
    returns once it is serving."""
    return _running(_ask(repo, "start", START_TIMEOUT, environ))


def stop(repo, environ=None):
    return _running(_ask(repo, "stop", COMMAND_TIMEOUT, environ))


def pack(repo, folder, environ=None):
    """Zips a copy of the demo that runs on another Mac into folder and
    returns its path, name and size."""
    state = _ask(repo, "pack", PACK_TIMEOUT, environ, ("--out", folder))
    if not isinstance(state.get("path"), str) or not isinstance(state.get("name"), str):
        raise DemoError(500, "orc-demo did not say where the zip is.")
    return {"path": state["path"], "name": state["name"], "size": state.get("size")}
