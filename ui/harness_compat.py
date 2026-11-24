"""Checks that the agent CLIs Orc drives still work the way Orc reads them.

Orc leans on parts of Claude Code, Codex and harness plugins that are not public
APIs: print-mode flags, stream-json events, transcript files, Codex's SQLite
index and its app-server method names. A probe drives a CLI the way a headless
run does, against a scripted model server on localhost so it needs no sign-in
and spends nothing, then reads what the CLI wrote back through Orc's own
readers. A harness package whose model service cannot be scripted can supply
its own ``compat_probe`` in its harness module.

The scheduled check (``tick``, started by the server's watch loop) probes each
installed CLI and the newest release npm publishes, installed into a cache, so
Orc can say a release breaks it before the CLI updates itself. ``status`` is
what the main UI and the assistant read: the results, the releases that could
not be checked and why, and the warnings that need the user. Probe results
are evidence only: nothing here changes a run, a setting or an installed CLI.
"""
import contextlib
import datetime
import http.server
import itertools
import json
import os
import queue
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import harnesses
import headless_session
import run_chat

FIXTURE_MODEL = "claude-sonnet-4-5"
TURN_SECONDS = 60
COMMAND_SECONDS = 30
TOOL_OUTPUT = "compat-tool-output"
# A probe's temporary folders. The Codex probe's CODEX_HOME sits in /tmp under
# the short prefix and holds the pid of the app server it starts.
SANDBOX_PREFIX = "orc-%s-compat-"
SHORT_HOME_PREFIX = "orc-cx-"
DAEMON_PID = "app-server.pid"
LEFTOVER_SECONDS = 3600


class ModelServer(http.server.ThreadingHTTPServer):
    """A scripted model on 127.0.0.1 speaking both the OpenAI Responses API
    (Codex) and the Anthropic Messages API (Claude Code). Each model request
    takes the next scripted reply: ``("text", words)``, ``("tool", name,
    arguments)``, ``("events", [(name, event), ...])`` for a stream a probe
    writes out itself, ``"fail"`` for a 400 (repeated for retries until the
    next scripted reply), or ``"hold"`` to stall until ``release`` is set.
    A probe whose requests can arrive in either order sets ``answer``, a
    function from a request's body to its reply, in place of the script.
    ``routes`` answers any other path a CLI asks for: ``{path: (status,
    JSON body)}``."""

    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), _ModelHandler)
        self.script = queue.Queue()
        self.requests = queue.Queue()
        self.release = threading.Event()
        self.errors = queue.Queue()
        self.routes = {}
        self.answer = None
        self.failing = False
        self._seq = itertools.count(1)
        self.thread = threading.Thread(target=self.serve_forever, kwargs={"poll_interval": 0.01},
                                       daemon=True)

    @property
    def url(self):
        return "http://127.0.0.1:%d" % self.server_port

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.release.set()
        self.shutdown()
        self.server_close()
        self.thread.join(timeout=2)

    def take(self, timeout=5):
        """The next (path, body) a CLI sent to the model."""
        return self.requests.get(timeout=timeout)


def _sse(handler, events):
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.end_headers()
    for name, event in events:
        handler.wfile.write((("event: %s\n" % name) if name else "").encode()
                            + ("data: " + json.dumps(event) + "\n\n").encode())
        handler.wfile.flush()


def _responses_events(action, seq=1):
    if action[0] == "text":
        item = {"id": "msg_fixture_%d" % seq, "type": "message", "role": "assistant", "status": "completed",
                "content": [{"type": "output_text", "text": action[1], "annotations": []}]}
    else:
        item = {"id": "fc_fixture_%d" % seq, "type": "function_call", "call_id": "call_fixture_%d" % seq,
                "name": action[1], "arguments": json.dumps(action[2])}
    return [(None, {"type": "response.output_item.done", "output_index": 0, "item": item}),
            (None, {"type": "response.completed", "response": {
                "id": "resp_fixture_%d" % seq, "status": "completed", "output": [item],
                "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}})]


def _messages_events(action, model, seq=1):
    if action[0] == "text":
        start = {"type": "text", "text": ""}
        deltas = [{"type": "text_delta", "text": action[1]}]
        stop = "end_turn"
    else:
        start = {"type": "tool_use", "id": "toolu_fixture_%d" % seq, "name": action[1], "input": {}}
        deltas = [{"type": "input_json_delta", "partial_json": json.dumps(action[2])}]
        stop = "tool_use"
    message = {"id": "msg_fixture_%d" % seq, "type": "message", "role": "assistant", "model": model,
               "content": [], "stop_reason": None, "stop_sequence": None,
               "usage": {"input_tokens": 1, "output_tokens": 1}}
    return [("message_start", {"type": "message_start", "message": message}),
            ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": start}),
            *(("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": delta})
              for delta in deltas),
            ("content_block_stop", {"type": "content_block_stop", "index": 0}),
            ("message_delta", {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None},
                               "usage": {"output_tokens": 1}}),
            ("message_stop", {"type": "message_stop"})]


class _ModelHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def _json(self, status, value):
        payload = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self._json(*self.server.routes.get(self.path.split("?", 1)[0], (404, {"error": {"message": "not scripted"}})))

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            path = self.path.split("?", 1)[0]
            if path.endswith("/count_tokens"):
                return self._json(200, {"input_tokens": 1})
            if path in self.server.routes:
                return self._json(*self.server.routes[path])
            if path not in ("/v1/responses", "/v1/messages"):
                return self._json(404, {"error": {"message": "not scripted"}})
            self.server.requests.put((path, body))
            # A CLI that retries a failed request keeps getting the failure.
            try:
                action = (self.server.answer(body) if self.server.answer
                          else self.server.script.get(timeout=0 if self.server.failing else 5))
            except queue.Empty:
                if not self.server.failing:
                    raise
                action = "fail"
            self.server.failing = action == "fail"
            if action == "hold":
                self.server.release.wait(TURN_SECONDS)
                return None
            if action == "fail":
                return self._json(400, {"type": "error", "error": {
                    "type": "invalid_request_error", "message": "scripted compatibility failure"}})
            if action[0] == "events":
                return _sse(self, action[1])
            seq = next(self.server._seq)
            if path == "/v1/responses":
                return _sse(self, _responses_events(action, seq))
            if not body.get("stream"):
                return self._json(500, {"error": {"message": "the probe only scripts streamed replies"}})
            return _sse(self, _messages_events(action, body.get("model") or FIXTURE_MODEL, seq))
        except (BrokenPipeError, ConnectionResetError):
            return None
        except Exception as error:  # noqa: BLE001 - reported through server.errors
            self.server.errors.put(repr(error))
            with contextlib.suppress(OSError):
                self.send_error(500)
            return None


# ---------- shared probe steps ----------

def version(binary):
    """The first line ``<binary> --version`` prints, or None."""
    try:
        done = subprocess.run([binary, "--version"], capture_output=True, text=True,
                              timeout=COMMAND_SECONDS, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    line = (done.stdout or done.stderr).strip().splitlines()
    return line[0].strip() if done.returncode == 0 and line else None


def version_number(text):
    found = re.search(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?", text or "")
    return found.group(0) if found else None


def run_help(binary, command, env=None):
    """The finished ``<binary> <command> --help``."""
    return subprocess.run([binary, *command, "--help"], capture_output=True, text=True,
                          timeout=COMMAND_SECONDS, stdin=subprocess.DEVNULL, env=env)


def help_text(binary, *command, env=None):
    done = run_help(binary, command, env)
    return done.stdout + done.stderr


def _last_line(done):
    lines = (done.stderr or done.stdout or "").strip().splitlines()
    return lines[-1].strip() if lines else "no output"


def missing_flags(text, argv):
    """The options in ``argv`` that a CLI's help ``text`` no longer names."""
    flags = dict.fromkeys(arg.split("=", 1)[0] for arg in argv
                          if re.fullmatch(r"--?[A-Za-z][\w-]*(=.*)?", arg))
    return [flag for flag in flags if not re.search(r"(?<![\w-])%s(?![\w-])" % re.escape(flag), text)]


def flag_failures(binary, command, argv, env=None):
    named = " ".join([Path(binary).name, *command])
    try:
        done = run_help(binary, command, env)
    except (OSError, subprocess.SubprocessError) as error:
        return ["`%s --help` did not run: %s" % (named, error)]
    missing = missing_flags(done.stdout + done.stderr, argv)
    # The exit status alone does not say help is missing, so help that names
    # any option Orc passes is still read for the rest.
    if done.returncode and missing and missing == missing_flags("", argv):
        return ["`%s --help` stopped with status %d: %s" % (named, done.returncode, _last_line(done))]
    return ["`%s --help` no longer lists %s, which Orc passes" % (named, flag) for flag in missing]


class NotStarted(Exception):
    """A CLI that runs for the user did not start in a probe's sandbox, so the
    probe has nothing to say about it: the release is not checked."""


def must_start(binary, env):
    """Raise NotStarted unless ``<binary> --version`` runs in a probe's
    ``env``. ``check`` has already run it in the user's own environment."""
    try:
        done = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=COMMAND_SECONDS,
                              stdin=subprocess.DEVNULL, env=env)
    except (OSError, subprocess.SubprocessError) as error:
        raise NotStarted("`%s --version` did not run in the check's sandbox: %s" % (Path(binary).name, error))
    if done.returncode:
        raise NotStarted("`%s --version` runs here but stopped with status %d in the check's sandbox, which has "
                         "an empty HOME: %s" % (Path(binary).name, done.returncode, _last_line(done)))


def run_turn(run_dir, agent, argv, prompt, cwd, env):
    """Run one headless turn to its end and return its state."""
    headless_session.start_turn(str(run_dir), agent=agent, argv=argv, prompt=prompt, cwd=str(cwd), env=env)
    deadline = time.monotonic() + TURN_SECONDS
    while time.monotonic() < deadline:
        state = headless_session.turn_state(str(run_dir))
        if state and state["state"] == "idle" and state["exitCode"] is not None:
            return state
        time.sleep(0.05)
    headless_session.interrupt(str(run_dir), wait=0.5)
    return {"outcome": "timeout", "error": "the turn did not finish in %d seconds" % TURN_SECONDS}


def turn_failure(label, state):
    if state.get("outcome") == "completed":
        return None
    return "%s ended %s rather than completing: %s" % (label, state.get("outcome"), state.get("error") or "no error")


def read_items(harness, path):
    reader = run_chat.Reader(harness, path)
    reader.poll()
    return reader.items, reader


def item_failures(cli, items, reply):
    failures = []
    if not any(item["kind"] == "assistant" and item.get("text") == reply for item in items):
        failures.append("Orc's chat reader found no reply %r in the %s transcript" % (reply, cli))
    if not any(item["kind"] == "tool" for item in items):
        failures.append("Orc's chat reader found no tool call in the %s transcript" % cli)
    return failures


@contextlib.contextmanager
def sandbox(prefix):
    with tempfile.TemporaryDirectory(prefix=prefix) as folder:
        root = Path(folder).resolve()
        (root / "run").mkdir()
        (root / "work").mkdir()
        (root / "work" / "compat.txt").write_text(TOOL_OUTPUT + "\n")
        yield root
        with contextlib.suppress(Exception):
            headless_session.interrupt(str(root / "run"), wait=0.2)


def sweep(now=None, parents=None):
    """Clear what a check left behind when its server died mid-probe: sandbox
    folders over an hour old, and the Codex app server whose pid one holds."""
    now = time.time() if now is None else now
    for parent in parents or {Path(tempfile.gettempdir()), Path("/tmp")}:
        for pattern in (SANDBOX_PREFIX % "*" + "*", SHORT_HOME_PREFIX + "*"):
            for folder in parent.glob(pattern):
                try:
                    if not folder.is_dir() or now - folder.stat().st_mtime < LEFTOVER_SECONDS:
                        continue
                    pid = int((folder / DAEMON_PID).read_text())
                    command = subprocess.run(["ps", "-p", str(pid), "-o", "command="], capture_output=True,
                                             text=True, timeout=COMMAND_SECONDS).stdout
                    if "app-server" in command:
                        os.killpg(pid, signal.SIGTERM)
                except (OSError, ValueError, subprocess.SubprocessError):
                    pass
                finally:
                    if folder.is_dir() and now - folder.stat().st_mtime >= LEFTOVER_SECONDS:
                        shutil.rmtree(folder, ignore_errors=True)


def real_node_folder(path):
    """The folder of the node that ``path`` runs, when the ``node`` it finds
    first is a version manager's shim (asdf, mise, volta, nodenv), else None.
    A shim picks its node from files under HOME, so in a probe's empty HOME it
    stops with status 126, and with it every npm release, whose launcher is
    ``#!/usr/bin/env node``."""
    found = shutil.which("node", path=path)
    if not found:
        return None
    try:
        done = subprocess.run([found, "-e", "process.stdout.write(process.execPath)"], capture_output=True,
                              text=True, timeout=COMMAND_SECONDS, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    real = Path(done.stdout.strip() or found)
    if done.returncode or not real.is_file() or real.resolve() == Path(found).resolve():
        return None
    return str(real.parent)


def base_env(root):
    path = os.environ.get("PATH", "/usr/bin:/bin")
    return {"PATH": os.pathsep.join(filter(None, [real_node_folder(path), path])), "HOME": str(root),
            "TMPDIR": str(root), "ORC_RUNS_DIR": str(root / "runs"), "LANG": "en_US.UTF-8"}


def server_errors(server):
    return ["The scripted model server failed: " + error for error in list(server.errors.queue)]


# ---------- running checks ----------

def clis():
    """{cli: (label, npm package, probe)} for every agent CLI with a probe:
    Claude Code and Codex, and each enabled harness package with one."""
    # Imported here because both modules import this one for the shared steps.
    import harness_compat_claude
    import harness_compat_codex
    found = {cli: (module.LABEL, module.PACKAGE, module.probe) for cli, module in
             (("claude", harness_compat_claude), ("codex", harness_compat_codex))}
    for cli, module in harnesses.enabled().items():
        if callable(getattr(module, "compat_probe", None)):
            found[cli] = (harnesses.label(cli), getattr(module, "COMPAT_PACKAGE", None), module.compat_probe)
    return found


def installed(cli):
    return shutil.which(headless_session.agent_binary(cli))


def check(cli, binary):
    """{"cli", "binary", "version", "ok", "failures"} for one executable. A
    probe that crashes is a failure too: it means the CLI changed somewhere
    the probe did not expect. A CLI that did not start in the probe's sandbox
    is not checked: ``ok`` is None, with ``why`` and ``reason``."""
    known = clis()
    if cli not in known:
        raise ValueError("no compatibility probe for %s" % cli)
    text = version(binary)
    result = {"cli": cli, "label": known[cli][0], "binary": binary, "version": version_number(text) or text}
    if text is None:
        return {**result, "ok": False, "failures": ["`%s --version` did not run" % binary]}
    try:
        failures = known[cli][2](binary)
    except NotStarted as error:
        return {**result, "ok": None, "why": NOT_STARTED, "reason": str(error)}
    except Exception as error:  # noqa: BLE001 - any crash is the finding
        failures = ["The probe stopped with %s: %s" % (type(error).__name__, error)]
    return {**result, "ok": not failures, "failures": failures}


def latest_version(package):
    npm = shutil.which("npm")
    if not npm or not package:
        return None
    try:
        done = subprocess.run([npm, "view", package, "version"], capture_output=True, text=True,
                              timeout=COMMAND_SECONDS, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    return version_number(done.stdout) if done.returncode == 0 else None


def install_release(cache, cli, package, release):
    """The executable of ``package@release`` installed under ``cache``, which
    keeps one release per CLI. None when npm cannot install it."""
    npm = shutil.which("npm")
    folder = Path(cache) / cli / release
    binary = folder / "node_modules" / ".bin" / cli
    if binary.exists():
        return str(binary)
    if not npm:
        return None
    for old in (Path(cache) / cli).glob("*") if (Path(cache) / cli).is_dir() else ():
        shutil.rmtree(old, ignore_errors=True)
    try:
        subprocess.run([npm, "install", "--prefix", str(folder), "--no-save", "--no-audit", "--no-fund",
                        "--loglevel=error", "%s@%s" % (package, release)],
                       capture_output=True, timeout=600, check=True, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        shutil.rmtree(folder, ignore_errors=True)
        return None
    return str(binary) if binary.exists() else None


# Why a release has no result. The first two are how this machine is set up;
# the rest mean a check that should have run did not, and count toward the
# warning after STALE_AFTER.
NOT_INSTALLED, NO_PACKAGE = "not-installed", "no-package"
NO_NPM, LOOKUP_FAILED, INSTALL_FAILED = "no-npm", "lookup-failed", "install-failed"
NOT_STARTED = "not-started"
SHOULD_HAVE_RUN = (NO_NPM, LOOKUP_FAILED, INSTALL_FAILED, NOT_STARTED)


def unchecked(cli, label, release, why, reason):
    """The result for a release that was not checked: ``ok`` is None."""
    return {"cli": cli, "label": label, "release": release, "ok": None, "why": why, "reason": reason}


def newest_release(cache, cli, label, package, current):
    """The result for the newest npm release of a CLI whose installed release
    is ``current``, or None when the installed release is the newest."""
    if not package:
        return unchecked(cli, label, "latest", NO_PACKAGE,
                         "%s is not published on npm, so Orc checks only the installed release." % label)
    if not shutil.which("npm"):
        return unchecked(cli, label, "latest", NO_NPM,
                         "npm is not installed, so Orc cannot fetch the newest %s." % label)
    newest = latest_version(package)
    if newest is None:
        return unchecked(cli, label, "latest", LOOKUP_FAILED, "`npm view %s version` gave no answer." % package)
    if newest == current:
        return None
    binary = install_release(cache, cli, package, newest)
    if not binary:
        return unchecked(cli, label, "latest", INSTALL_FAILED, "npm could not install %s@%s." % (package, newest))
    return {**check(cli, binary), "release": "latest"}


def check_all(cache=None, latest=False, only=None):
    """A result for each CLI Orc drives and, with ``latest``, for its newest
    npm release. A release that could not be checked gets a result too, saying
    why. An installed release that is also the newest has ``newest`` set
    instead of a second result."""
    results = []
    for cli, (label, package, _) in clis().items():
        if only and cli not in only:
            continue
        binary = installed(cli)
        if not binary:
            results.append(unchecked(cli, label, "installed", NOT_INSTALLED, "%s is not installed here." % label))
            continue
        current = {**check(cli, binary), "release": "installed"}
        results.append(current)
        if not latest or cache is None:
            continue
        newest = newest_release(cache, cli, label, package, current["version"])
        if newest is None:
            current["newest"] = True
        else:
            results.append(newest)
    return results


# ---------- the scheduled check ----------

CHECK_EVERY = datetime.timedelta(hours=6)
STALE_AFTER = datetime.timedelta(days=3)


def home(config_dir):
    return Path(config_dir) / "harness-compat"


def read_state(config_dir):
    try:
        state = json.loads((home(config_dir) / "state.json").read_text())
    except (OSError, ValueError):
        return {}
    return state if isinstance(state, dict) else {}


def write_state(config_dir, state):
    folder = home(config_dir)
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = folder / ".state.json.tmp"
    temporary.write_text(json.dumps(state, indent=2))
    os.replace(temporary, folder / "state.json")


def _moment(now=None):
    return (now or datetime.datetime.now()).astimezone()


def _parse(stamp):
    try:
        return datetime.datetime.fromisoformat(stamp).astimezone()
    except (TypeError, ValueError):
        return None


def _results(state):
    return [result for result in state.get("results") or []
            if isinstance(result, dict) and result.get("release") in ("installed", "latest")]


def _named(result):
    """"Claude Code 2.1.325", or the label alone when ``--version`` did not run."""
    return " ".join(filter(None, (result["label"], result.get("version"))))


def warning(result, results):
    """The line that says a failed result needs the user."""
    first = result["failures"][0].rstrip(".")
    more = len(result["failures"]) - 1
    detail = first + (" (and %d more)" % more if more else "")
    if result["release"] == "latest":
        mine = next((item for item in results if item["cli"] == result["cli"] and item["release"] == "installed"), None)
        held = (" Your %s still passes, so hold off updating it." % mine["version"]) if mine and mine["ok"] else ""
        return ("%s, the newest release, breaks something Orc relies on: %s.%s "
                "Run `orc-harness-compat %s --latest` for the full report."
                % (_named(result), detail, held, result["cli"]))
    return ("The %s installed here breaks something Orc relies on: %s. Runs on it may fail or show an "
            "empty chat. Run `orc-harness-compat %s` for the full report." % (_named(result), detail, result["cli"]))


def _days(since, now):
    days = (now - since).days
    return "%d day%s" % (days, "" if days == 1 else "s")


def warnings(state, now=None):
    """What needs the user, as ``{"key", "cli", "kind", "title", "text"}``: a
    ``broken`` release, a release ``unchecked`` for STALE_AFTER, or a check
    that has kept stopping for as long (``stopped``)."""
    now = _moment(now)
    results = _results(state)
    found = [{"key": "%s@%s" % (result["cli"], result.get("version") or "unknown"), "cli": result["cli"],
              "kind": "broken", "release": result["release"], "title": _named(result),
              "text": warning(result, results)}
             for result in results if result.get("ok") is False]
    labels = {result["cli"]: result["label"] for result in results}
    for slot, wait in sorted((state.get("waiting") or {}).items()):
        cli, _, release = slot.partition(":")
        since = _parse(wait.get("since"))
        if cli not in labels or since is None or now - since < STALE_AFTER:
            continue
        what = "the newest %s release" % labels[cli] if release == "latest" else "the %s installed here" % labels[cli]
        found.append({"key": "%s@not-checked-%s" % (cli, release), "cli": cli, "kind": "unchecked",
                      "release": release, "title": labels[cli],
                      "text": "Orc has not checked %s for %s: %s Run `orc-harness-compat %s%s` to try now."
                              % (what, _days(since, now), wait.get("reason") or "no reason was recorded.", cli,
                                 " --latest" if release == "latest" else "")})
    since = _parse(state.get("stoppedSince"))
    if state.get("error") and since is not None and now - since >= STALE_AFTER:
        found.append({"key": "check@stopped", "cli": None, "kind": "stopped", "release": None,
                      "title": "CLI compatibility check",
                      "text": "The check that agent CLIs still work with Orc has not finished for %s: %s. "
                              "Run `orc-harness-compat --latest` to see why." % (_days(since, now), state["error"])})
    return found


_RUNNING = threading.Lock()


def status(config_dir, now=None):
    """The last check as the main UI shows it: one row per CLI with its
    installed and newest release, and the warnings that need the user."""
    state = read_state(config_dir)
    rows = {}
    for result in _results(state):
        row = rows.setdefault(result["cli"], {"cli": result["cli"], "label": result.get("label") or result["cli"],
                                              "installed": None, "latest": None})
        row[result["release"]] = {key: value for key, value in result.items() if key not in ("cli", "label", "binary")}
    return {"checkedAt": state.get("checkedAt"), "error": state.get("error"), "running": _RUNNING.locked(),
            "clis": list(rows.values()), "warnings": warnings(state, now)}


def due(config_dir, now=None):
    last = _parse(read_state(config_dir).get("checkedAt"))
    return last is None or not datetime.timedelta(0) <= _moment(now) - last < CHECK_EVERY


def _waiting(earlier, results, stamp):
    waiting = {}
    for result in results:
        if result["ok"] is None and result["why"] in SHOULD_HAVE_RUN:
            slot = "%s:%s" % (result["cli"], result["release"])
            since = (earlier.get(slot) or {}).get("since") or stamp
            waiting[slot] = {"since": since, "why": result["why"], "reason": result["reason"]}
    return waiting


def tick(config_dir, *, now=None, background=True, check=check_all, force=False):
    """Check every CLI when CHECK_EVERY has passed since the last check (or
    now, with ``force``), in the background so the caller's loop never waits
    on it, and record the results in state.json for ``status``. A check that
    stops keeps the last results and records why."""
    if not (force or due(config_dir, now)) or not _RUNNING.acquire(blocking=False):
        return False

    def work():
        stamp = _moment(now).isoformat(timespec="seconds")
        sweep()
        state = read_state(config_dir)
        earlier = state.get("waiting") if isinstance(state.get("waiting"), dict) else {}
        try:
            results = [{**result, "checkedAt": stamp} for result in check(cache=home(config_dir) / "cli", latest=True)]
            record = {"checkedAt": stamp, "results": results, "waiting": _waiting(earlier, results, stamp)}
        except Exception as error:  # noqa: BLE001 - recorded; the next check tries again
            record = {"checkedAt": stamp, "results": _results(state), "waiting": earlier,
                      "error": "%s: %s" % (type(error).__name__, error),
                      "stoppedSince": state.get("stoppedSince") or stamp}
        try:
            write_state(config_dir, record)
        except OSError:
            pass
        finally:
            _RUNNING.release()

    if background:
        threading.Thread(target=work, name="harness-compat", daemon=True).start()
    else:
        work()
    return True
