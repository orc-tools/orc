"""Generic development servers for Git worktrees, built into Orc.

bin/orc-worktree activates this module with its own helpers: it owns Git and
recorded-process cleanup. A project's dev server runs only from settings the
user saved (``repos[<project>].worktreeServer``); detection only suggests one.
"""

from __future__ import annotations

import errno
import hashlib
import math
from pathlib import Path
import re
import shutil
import socket
import subprocess
import time

import command_suggestions


def activate(context):
    global host, WorktreeError
    host = context
    WorktreeError = context.WorktreeError


LOCALHOST_FAMILIES = ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1"))
UNSUPPORTED_FAMILY_ERRORS = {errno.EAFNOSUPPORT, errno.EADDRNOTAVAIL,
                             errno.EPROTONOSUPPORT}
DEFAULT_SERVER_PORT = 4321
SERVER_PORT_SPAN = 40
SERVER_PORT_BANDS = 16
SERVER_READY_TIMEOUT = 60.0
INSTALL_TIMEOUT = 900


def default_port(repo: Path) -> int:
    """Unlike hash(), SHA-1 keeps teardown's port anchors stable across processes."""
    digest = hashlib.sha1(str(repo).encode("utf-8")).digest()
    band = int.from_bytes(digest[:4], "big") % SERVER_PORT_BANDS
    return DEFAULT_SERVER_PORT + band * SERVER_PORT_SPAN


def server_config(repo: Path, config: dict | None = None) -> dict | None:
    if config is None:
        config = host.load_config()
    value, found = host.matching_value(config.get("repos"), repo, "worktreeServer")
    if not found or value is None:
        return None
    if not isinstance(value, dict):
        raise WorktreeError("worktreeServer must be a JSON object")
    command = value.get("command")
    if not isinstance(command, str) or not command.strip():
        raise WorktreeError("worktreeServer.command must be a non-empty string")
    port = value.get("port", default_port(repo))
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise WorktreeError("worktreeServer.port must be a port number")
    copy = value.get("copy", [])
    if not isinstance(copy, list) or any(
            not isinstance(item, str) or not item.strip() for item in copy):
        raise WorktreeError("worktreeServer.copy must be an array of paths")
    install = value.get("install")
    if install is not None and (not isinstance(install, str) or not install.strip()):
        raise WorktreeError("worktreeServer.install must be a non-empty string")
    ready = value.get("readyTimeout", SERVER_READY_TIMEOUT)
    if (isinstance(ready, bool) or not isinstance(ready, (int, float))
            or not math.isfinite(ready) or ready < 0):
        raise WorktreeError("worktreeServer.readyTimeout must be a number of seconds")
    return {"command": command.strip(), "port": port, "copy": list(copy),
            "install": install.strip() if install else None,
            "readyTimeout": float(ready)}


DEV_ENV_FILES = (".dev.vars", ".prod.vars", ".env.local", ".env")


def gitignored(repo: Path, name: str) -> bool:
    return host.run_git(repo, "check-ignore", "-q", name, check=False).returncode == 0


def detect_server(repo: Path, config: dict | None = None) -> dict:
    if config is None:
        config = host.load_config()
    stored = server_config(repo, config)
    result = {"ok": True, "repo": str(repo), "configured": stored is not None,
              "stored": stored, "supported": False, "detected": None,
              "reason": None, "changes": []}
    if host.devd_repo(repo):
        result["excluded"] = True
        result["reason"] = ("orc-devd runs this repo's worktrees and wires "
                            "them to their run's other repos")
        return result
    suggestion = command_suggestions.dev_command(repo)
    if suggestion is None:
        result["reason"] = (
            "package.json has no dev script and no other dev command was found"
            if (repo / "package.json").is_file()
            else "no dev command found in package.json, bin/dev, a makefile, or README")
        result["changes"] = [
            'add a dev script that accepts a port, e.g. "dev": "<your dev '
            'server> --port $PORT", or enter the command in the project\'s '
            'settings under Runs & workspace']
        return result
    detected = {"command": suggestion["command"]}
    if "install" in suggestion:
        detected["install"] = suggestion["install"]
    copy = [name for name in DEV_ENV_FILES
            if (repo / name).is_file() and gitignored(repo, name)]
    if copy:
        detected["copy"] = copy
    result.update(supported=True, detected=detected, source=suggestion["source"])
    if "script" in suggestion:
        result["script"] = suggestion["script"]
    return result


def free_port(start: int) -> int:
    """The probe is advisory: ownership must be verified after spawning."""
    for candidate in range(start, min(start + SERVER_PORT_SPAN, 65536)):
        if host.port_open(candidate):
            continue
        free = True
        for family, address in LOCALHOST_FAMILIES:
            try:
                with socket.socket(family) as probe:
                    probe.bind((address, candidate))
            except OSError as exc:
                # An unsupported address family cannot hold the port.
                if exc.errno not in UNSUPPORTED_FAMILY_ERRORS:
                    free = False
                    break
        if free:
            return candidate
    raise WorktreeError("no free port in %d-%d" % (start, start + SERVER_PORT_SPAN))


ANNOUNCED_PORT_RE = re.compile(
    r"Dev server running at https?://(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)")


def announced_ports(log: Path, offset: int) -> list[int]:
    """Ignore earlier launches; a server's latest port announcement wins."""
    try:
        with open(log, "rb") as stream:
            stream.seek(offset)
            data = stream.read().decode("utf-8", "replace")
    except OSError:
        return []
    ports = [int(match) for match in ANNOUNCED_PORT_RE.findall(data)]
    ports.reverse()
    return ports


def owned_port(worktree: dict, ports: list[int], pgid: int | None) -> int | None:
    """A port alone cannot prove ownership: another setup may win the bind race."""
    target = host.normalized(worktree.get("path", ""))
    for candidate in ports:
        if not host.port_open(candidate):
            continue
        if any(host.process_in_tree(pid, target)
               or (pgid is not None and host.process_group(pid) == pgid)
               for pid in host.listening_pids(candidate)):
            return candidate
    return None


def seed_worktree(repo: Path, target: Path, config: dict,
                  marker: Path) -> list[str]:
    """Keep the install marker outside the tree so teardown's dirty check passes."""
    copied = []
    for relative in config["copy"]:
        source = repo / relative
        destination = target / relative
        if destination.exists() or not source.exists():
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            shutil.copytree(source, destination, symlinks=True)
        else:
            shutil.copy2(source, destination)
        copied.append(relative)
    install = config["install"]
    if install and not marker.exists():
        try:
            result = subprocess.run(["/bin/bash", "-lc", install],
                                    cwd=str(target), text=True,
                                    capture_output=True, timeout=INSTALL_TIMEOUT)
        except subprocess.TimeoutExpired:
            raise WorktreeError("worktreeServer.install timed out after %ds"
                                % INSTALL_TIMEOUT) from None
        if result.returncode:
            detail = (result.stderr or result.stdout).strip().splitlines()
            raise WorktreeError("worktreeServer.install failed: %s" %
                                (detail[-1] if detail else "no output"))
        marker.write_text("")
    return copied


def server_stop_anchors(raw_repo: object, worktree: dict) -> list[dict]:
    server = worktree.get("server")
    if isinstance(server, dict):
        return [server]
    if not isinstance(raw_repo, str):
        return []
    config = server_config(host.canonical_repo(raw_repo))
    if config is None:
        return []
    return [{"port": port} for port in range(
        config["port"], min(config["port"] + SERVER_PORT_SPAN, 65536))]


def launch_server(repo: Path, worktree: dict, state_dir: Path, save,
                  seed: bool = True) -> dict:
    if host.devd_repo(repo):
        raise WorktreeError("orc-devd owns this project's servers")
    config = server_config(repo)
    if config is None:
        return {"ok": True, "configured": False, "started": False}
    target = host.normalized(worktree.get("path", ""))
    if not target.is_dir():
        raise WorktreeError("worktree path is missing: %s" % target)
    existing = worktree.get("server")
    if isinstance(existing, dict) and host.server_pids(worktree, existing):
        return {"ok": True, "configured": True, "started": True, "reused": True,
                "url": worktree.get("url"), **existing}
    copied = seed_worktree(repo, target, config, host.install_marker(
        state_dir, worktree)) if seed else []
    port = free_port(config["port"])
    command = config["command"].replace("{port}", str(port)).replace(
        "{path}", str(target))
    log = state_dir / "worktree-server.log"
    with open(log, "ab") as stream:
        stream.write(("\n=== %s :: %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"),
                                            command)).encode())
        stream.flush()
        log_offset = log.stat().st_size
        process = subprocess.Popen(
            ["/bin/bash", "-lc", command], cwd=str(target),
            stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT,
            start_new_session=True)
    # Core must be able to stop this process even during readiness or after removal.
    host.clear_server(worktree)
    worktree["server"] = {"pid": process.pid, "port": port, "command": command,
                          "log": str(log), "startedAt": host.process_identity(process.pid)}
    save()
    # Dev servers can shift ports after losing the bind race.
    band = list(range(config["port"],
                      min(config["port"] + SERVER_PORT_SPAN, 65536)))
    pgid = host.process_group(process.pid)
    deadline = time.monotonic() + config["readyTimeout"]
    exit_grace = None
    owned = None
    while time.monotonic() < deadline:
        found = announced_ports(log, log_offset)
        candidates = found + [candidate for candidate in [port] + band
                              if candidate not in found]
        owned = owned_port(worktree, candidates, pgid)
        if owned is not None:
            break
        if process.poll() is not None:
            # A launcher that exits has not necessarily failed: Astro 7's
            # `astro dev` forks a background server and returns 0. Give the
            # port a grace period before calling it dead.
            exit_grace = exit_grace or time.monotonic() + 15
            if time.monotonic() > exit_grace:
                break
        time.sleep(0.3)
    exited = process.poll()
    # An announcement is the server's own word on where it bound, so it also
    # answers the two failure guards below: neither a launcher that exited nor
    # a stranger on the port we asked for means we have no server.
    announced = announced_ports(log, log_offset) if owned is None else []
    if owned is None and not announced and exited is not None:
        host.clear_server(worktree)
        save()
        raise WorktreeError("dev server exited with %d; see %s" % (exited, log))
    if owned is None and not announced and host.port_open(port):
        # Retain our process record for cleanup, but never expose a stranger's URL.
        raise WorktreeError(
            "port %d is held by another process and no dev server of ours is "
            "listening in %d-%d; see %s"
            % (port, config["port"], config["port"] + SERVER_PORT_SPAN - 1, log))
    ready = owned is not None
    if ready:
        port = owned
    elif announced:
        # Unproven, but astro told us where it actually bound — trust that
        # over the guess we started it with.
        port = announced[0]
    # `localhost`, not `127.0.0.1`: the server may be listening on ::1 only.
    url = "http://localhost:%d" % port
    worktree["server"]["port"] = port
    worktree["url"] = url
    worktree["started"] = ready
    save()
    return {"ok": True, "configured": True, "started": ready, "reused": False,
            "pid": process.pid, "port": port, "url": url, "log": str(log),
            "copied": copied}


def setup(run_dir: Path, repo_id: str | None, details: dict) -> None:
    if not details["start"]:
        return
    repo = Path(details["mainRepoPath"])
    try:
        if details["server"] is None:
            # Detection never saves a command: the project's settings offer
            # it, and only the user's choice there turns the server on.
            detection = detect_server(repo)
            details["serverSuggestion"] = (
                {"detected": detection["detected"]} if detection["supported"]
                else {"reason": detection["reason"]})
            return
        raw_repo, worktree, save = host.run_server_state(run_dir, repo_id)
        details["serverStart"] = launch_server(repo, worktree, run_dir, save)
    except WorktreeError as exc:
        details["serverStart"] = {"ok": False, "error": str(exc)}
