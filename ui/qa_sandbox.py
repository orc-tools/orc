"""Sandboxed command and interactive PTY execution for QA command steps.

Uses Anthropic's ``@anthropic-ai/sandbox-runtime`` bundled into
``lib/qa-sandbox.cjs`` so QA commands and interactive shells run with:
- localhost-only networking (``127.0.0.1``, ``localhost``, ``::1``)
- a read-only checkout directory
- ephemeral per-step scratch writes (``$HOME`` / ``$TMPDIR``)
- read denies on host credential directories/files
- a scrubbed environment containing only safe baseline variables plus
  ``ORC_QA_APP_URL`` and ``ORC_QA_MAIN_URL``.
"""
from __future__ import annotations

import atexit
import contextlib
import glob
import json
import os
import pwd
import shutil
import subprocess
import tempfile
import threading
from typing import Any
from urllib.parse import quote

import run_terminal

MIN_NODE_VERSION = (22, 12)
ENGINE_NAME = "sandbox-runtime"
DEFAULT_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
SAFE_ENV_KEYS = ("PATH", "LANG", "LC_ALL")
URL_ENV_KEYS = ("ORC_QA_APP_URL", "ORC_QA_MAIN_URL")
INTERACTIVE_PS1 = r"\[\e[36m\]qa-sandbox\[\e[0m\] \W $ "

DENY_READ_REL = (
    ".ssh",
    ".aws",
    ".gnupg",
    ".kube",
    ".orc",
    ".config/gh",
    "Library/Keychains",
    ".netrc",
    ".npmrc",
    ".pypirc",
)

_NODE_FALLBACKS = (
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "~/.local/bin/node",
)

_check_lock = threading.Lock()
_check_cache: dict[tuple[str, str, float], dict[str, Any]] = {}
_node_cache: str | None = None

_shells_lock = threading.RLock()
_qa_shells: dict[tuple[str, str], tuple[run_terminal.Shell, list[str]]] = {}
_tab_sessions: dict[tuple[str, str], tuple[run_terminal.Shell, list[str]]] = {}


class SandboxError(RuntimeError):
    """Raised when the QA sandbox cannot start or fails closed."""


def bundle_path() -> str:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(root, "lib", "qa-sandbox.cjs")


def _probe_node(executable: str) -> tuple[tuple[int, ...], str] | None:
    try:
        probe = subprocess.run(
            [executable, "-p", "JSON.stringify([process.versions.node, process.execPath])"],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if probe.returncode != 0:
        return None
    try:
        raw_version, exec_path = json.loads(probe.stdout.strip())
    except (ValueError, TypeError):
        return None
    parts = str(raw_version).split(".")
    try:
        version = tuple(int(part) for part in parts[:3])
    except ValueError:
        return None
    resolved = exec_path if isinstance(exec_path, str) and os.path.isfile(exec_path) else executable
    return version, resolved


def _is_shim(executable: str) -> bool:
    try:
        real = os.path.realpath(executable)
    except OSError:
        return False
    return os.path.basename(real) in ("mise", "rtx", "asdf") or "/shims/" in executable


def _node_candidates() -> list[str]:
    direct: list[str] = []
    shims: list[str] = []

    def add(path: str | None) -> None:
        if not path:
            return
        target = shims if _is_shim(path) else direct
        if path not in direct and path not in shims:
            target.append(path)

    add(os.environ.get("ORC_NODE_BIN"))
    which = shutil.which("node")
    add(which)
    homes = [os.path.expanduser("~")]
    for extra in (os.environ.get("ORC_TEST_REAL_HOME"), pwd.getpwuid(os.getuid()).pw_dir):
        if extra and extra not in homes:
            homes.append(extra)
    for home in homes:
        for pattern in (
            ".local/share/mise/installs/node/*/bin/node",
            ".nvm/versions/node/*/bin/node",
        ):
            for match in sorted(glob.glob(os.path.join(home, pattern)), reverse=True):
                add(match)
    for item in _NODE_FALLBACKS:
        add(os.path.expanduser(item))
    return direct + shims


def find_node() -> str | None:
    """Return a Node.js >= 22.12 executable path (resolving shims), or None."""
    global _node_cache
    with _check_lock:
        cached = _node_cache
    if cached and os.path.isfile(cached) and os.access(cached, os.X_OK):
        return cached
    for candidate in _node_candidates():
        if not os.path.isfile(candidate) or not os.access(candidate, os.X_OK):
            continue
        probed = _probe_node(candidate)
        if probed is not None and probed[0] >= MIN_NODE_VERSION:
            with _check_lock:
                _node_cache = probed[1]
            return probed[1]
    return None


def _base_status(available: bool, reason: str | None = None) -> dict[str, Any]:
    return {
        "available": available,
        "engine": ENGINE_NAME,
        "network": "localhost",
        "writes": "scratch-only",
        "reason": reason,
    }


def clear_cache() -> None:
    global _node_cache
    with _check_lock:
        _check_cache.clear()
        _node_cache = None


def availability() -> dict[str, Any]:
    """Check whether Node.js >= 22.12, the sandbox bundle, and OS primitives work."""
    bundle = bundle_path()
    if not os.path.isfile(bundle):
        return _base_status(False, "QA sandbox bundle is missing (lib/qa-sandbox.cjs).")
    node = find_node()
    if not node:
        return _base_status(
            False,
            "Node.js %d.%d+ is required for the QA sandbox." % MIN_NODE_VERSION,
        )
    try:
        mtime = os.path.getmtime(bundle)
    except OSError:
        mtime = 0.0
    key = (node, bundle, mtime)
    with _check_lock:
        cached = _check_cache.get(key)
    if cached is not None:
        return dict(cached)
    try:
        probe = subprocess.run(
            [node, bundle, "--check"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return _base_status(False, "Could not verify the QA sandbox: %s" % exc)
    info: dict[str, Any] = {}
    try:
        info = json.loads(probe.stdout or "{}")
    except ValueError:
        info = {}
    if probe.returncode == 0 and info.get("ok") is True:
        status = _base_status(True, None)
        with _check_lock:
            _check_cache[key] = status
        return dict(status)
    errors = info.get("errors") if isinstance(info.get("errors"), list) else []
    reason = "; ".join(str(item) for item in errors if item) or (
        probe.stderr.strip() or "QA sandbox dependencies are unavailable on this computer."
    )
    status = _base_status(False, reason)
    with _check_lock:
        _check_cache[key] = status
    return dict(status)


def step_info(run_id: str, step_id: str) -> dict[str, Any]:
    """Payload metadata for a command step's sandbox and terminal socket."""
    status = availability()
    status["terminalPath"] = "/api/runs/%s/qa/terminal?step=%s" % (
        quote(run_id, safe=""),
        quote(step_id, safe=""),
    )
    return status


def scrubbed_env(
    scratch_dir: str,
    urls: dict[str, str] | None = None,
    interactive: bool = False,
) -> dict[str, str]:
    """Build a minimal environment stripped of host secrets."""
    env: dict[str, str] = {
        "PATH": os.environ.get("PATH") or DEFAULT_PATH,
        "TERM": "xterm-256color",
        "COLORTERM": "truecolor",
        "SHELL": "/bin/bash",
        "HOME": scratch_dir,
        "TMPDIR": scratch_dir,
        "CLAUDE_CODE_TMPDIR": scratch_dir,
        "XDG_CONFIG_HOME": os.path.join(scratch_dir, ".config"),
        "XDG_CACHE_HOME": os.path.join(scratch_dir, ".cache"),
        "ORC_QA_SANDBOX": "1",
    }
    for key in ("LANG", "LC_ALL"):
        value = os.environ.get(key)
        if isinstance(value, str) and value:
            env[key] = value
    if interactive:
        env["PS1"] = INTERACTIVE_PS1
    if isinstance(urls, dict):
        for key in URL_ENV_KEYS:
            value = urls.get(key)
            if isinstance(value, str) and value:
                env[key] = value
    return env


def _deny_read_paths() -> list[str]:
    home = os.path.expanduser("~")
    paths: list[str] = []
    for rel in DENY_READ_REL:
        candidate = os.path.join(home, rel)
        for spelling in (candidate, os.path.realpath(candidate)):
            if spelling and spelling not in paths:
                paths.append(spelling)
    return paths


def sandbox_config(scratch_dir: str, checkout_dir: str | None = None) -> dict[str, Any]:
    """Build the SandboxRuntimeConfig dictionary for @anthropic-ai/sandbox-runtime."""
    real_scratch = os.path.realpath(scratch_dir)
    deny_write: list[str] = []
    if checkout_dir:
        real_checkout = os.path.realpath(checkout_dir)
        if real_checkout and real_checkout != real_scratch:
            deny_write.append(real_checkout)
    return {
        "allowPty": True,
        "network": {
            "allowedDomains": ["localhost", "127.0.0.1", "[::1]"],
            "deniedDomains": [],
            "strictAllowlist": True,
            "allowLocalBinding": True,
        },
        "filesystem": {
            "denyRead": _deny_read_paths(),
            "allowWrite": [real_scratch],
            "denyWrite": deny_write,
        },
    }


def _create_session_files(cwd: str, urls: dict[str, str] | None, interactive: bool) -> tuple[str, str, dict[str, str], list[str]]:
    status = availability()
    if not status["available"]:
        raise SandboxError(status["reason"] or "QA sandbox is unavailable.")
    scratch_dir = os.path.realpath(tempfile.mkdtemp(prefix="orc-qa-sbx-"))
    paths = [scratch_dir]
    try:
        os.makedirs(os.path.join(scratch_dir, ".config"), exist_ok=True)
        os.makedirs(os.path.join(scratch_dir, ".cache"), exist_ok=True)
        fd, cfg_path = tempfile.mkstemp(prefix="orc-qa-cfg-", suffix=".json")
        paths.append(cfg_path)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(sandbox_config(scratch_dir, cwd), handle)
        env = scrubbed_env(scratch_dir, urls=urls, interactive=interactive)
    except BaseException:
        cleanup_paths(paths)
        raise
    return scratch_dir, cfg_path, env, paths


def prepare_run(
    command: str,
    cwd: str,
    urls: dict[str, str] | None = None,
) -> tuple[list[str], dict[str, str], list[str]]:
    """Prepare ``(argv, env, cleanup_paths)`` to run a one-shot sandboxed command."""
    node = find_node()
    bundle = bundle_path()
    _, cfg_path, env, paths = _create_session_files(cwd, urls, interactive=False)
    if not node or not os.path.isfile(bundle):
        cleanup_paths(paths)
        raise SandboxError("QA sandbox runtime is unavailable.")
    argv = [node, bundle, "--config", cfg_path, "--command", command]
    return argv, env, paths


def cleanup_paths(paths: list[str] | tuple[str, ...] | None) -> None:
    """Best-effort removal of ephemeral scratch directories and config files."""
    for path in paths or ():
        if not path:
            continue
        try:
            if os.path.isdir(path) and not os.path.islink(path):
                shutil.rmtree(path, ignore_errors=True)
            else:
                os.unlink(path)
        except OSError:
            pass


def _close_entry(entry: tuple[run_terminal.Shell, list[str]]) -> None:
    shell, paths = entry
    try:
        shell.close()
    finally:
        cleanup_paths(paths)


def _start_terminal(cwd: str, urls: dict[str, str] | None) -> tuple[run_terminal.Shell, list[str]]:
    if not cwd or not os.path.isdir(cwd):
        raise SandboxError("This run's checkout is not on this computer.")
    node = find_node()
    bundle = bundle_path()
    _, cfg_path, env, paths = _create_session_files(cwd, urls, interactive=True)
    if not node or not os.path.isfile(bundle):
        cleanup_paths(paths)
        raise SandboxError("QA sandbox runtime is unavailable.")
    argv = [node, bundle, "--config", cfg_path, "--shell"]
    try:
        return run_terminal.Shell(cwd, argv=argv, environ=env), paths
    except BaseException:
        cleanup_paths(paths)
        raise


@contextlib.contextmanager
def terminal_tab(run_id: str, tab_id: str, cwd: str, urls: dict[str, str] | None = None):
    """Own one sandboxed shell for the lifetime of a tab's WebSocket."""
    key = (run_id, tab_id)
    with _shells_lock:
        if key in _tab_sessions:
            raise SandboxError("This QA terminal tab is already connected.")
        entry = _tab_sessions[key] = _start_terminal(cwd, urls)
    try:
        yield entry[0]
    finally:
        with _shells_lock:
            if _tab_sessions.pop(key, None) is not None:
                _close_entry(entry)


def get_terminal_shell(
    run_id: str,
    step_id: str,
    cwd: str,
    urls: dict[str, str] | None = None,
) -> run_terminal.Shell:
    """Return a live sandboxed interactive PTY shell for ``(run_id, step_id)``."""
    if not cwd or not os.path.isdir(cwd):
        raise SandboxError("This run's checkout is not on this computer.")
    key = (run_id, step_id)
    with _shells_lock:
        existing = _qa_shells.get(key)
        if existing is not None:
            shell, _ = existing
            if shell.proc.poll() is None and not shell.closed:
                return shell
            del _qa_shells[key]
            _close_entry(existing)
        entry = _start_terminal(cwd, urls)
        _qa_shells[key] = entry
        return entry[0]


def send_terminal_command(
    run_id: str,
    step_id: str,
    command: str,
    cwd: str,
    urls: dict[str, str] | None = None,
) -> run_terminal.Shell:
    """Start (if needed) and type ``command`` into the step's sandboxed shell."""
    shell = get_terminal_shell(run_id, step_id, cwd, urls=urls)
    shell.send(command + "\n")
    return shell


def reset_terminal(run_id: str, step_id: str) -> bool:
    """Close the sandboxed shell for ``(run_id, step_id)`` and wipe its scratch dir."""
    with _shells_lock:
        entry = _qa_shells.pop((run_id, step_id), None)
    if entry is None:
        return False
    _close_entry(entry)
    return True


def close_all() -> None:
    with _shells_lock:
        entries = [*_qa_shells.values(), *_tab_sessions.values()]
        _qa_shells.clear()
        _tab_sessions.clear()
    for entry in entries:
        _close_entry(entry)


atexit.register(close_all)
