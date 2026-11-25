"""Bounded JSON-RPC client for Codex's local Unix WebSocket control socket."""

import base64
import hashlib
import json
import os
import re
from pathlib import Path
import socket
import selectors
import subprocess
import struct
import threading
import time
import tomllib

LIMIT = 2 * 1024 * 1024
# How long one connection may take in all, and how long a call that changes a
# thread may go without hearing from Codex. A call that changes a thread always
# gets its quiet limit, even after a slow read used up most of the window.
WINDOW_SECONDS = 5
QUIET_SECONDS = 2
# Calls that only read a thread. Codex holds the first one after a terminal
# opens a thread until that thread has loaded, which took up to 2.5s on 0.172,
# so these wait out the whole window. Calls that start, steer or interrupt a
# turn keep the quiet limit and are never retried, so nothing is sent twice.
READ_ONLY_METHODS = frozenset({"thread/read", "thread/loaded/list", "thread/turns/list"})
_loaded_lock = threading.Lock()
_loaded_cache = None
_status_lock = threading.Lock()
_status_cache = {}


def thread_status(home, thread_id, *, for_completion=False):
    """Read thread liveness without loading it or subscribing this client."""
    if not isinstance(thread_id, str) or not re.fullmatch(r"[0-9a-f-]{36}", thread_id):
        return None
    path = home.resolve() / "app-server-control/app-server-control.sock"
    key = (path, thread_id, for_completion)
    with _status_lock:
        now = time.monotonic()
        cached = _status_cache.get(key)
        if not for_completion and cached and now < cached[0]:
            return cached[1]
        status = None
        try:
            if path.exists():
                with Client(path) as client:
                    thread = client.call("thread/read", {
                        "threadId": thread_id, "includeTurns": False,
                    }).get("thread", {})
                value = thread.get("status", {})
                if thread.get("id") == thread_id and isinstance(value, dict):
                    kind = value.get("type")
                    if kind in ("active", "idle", "notLoaded", "systemError"):
                        status = kind
                        if not for_completion and kind == "active" and value.get("activeFlags"):
                            status = "idle"
        except (OSError, RpcError, ValueError, TypeError, AttributeError):
            pass
        _status_cache[key] = (time.monotonic() + (5 if status else 1), status)
        if len(_status_cache) > 256:
            del _status_cache[min(_status_cache, key=lambda item: _status_cache[item][0])]
        return status


def launch_args():
    """Keep CLI config overrides from selecting an unreachable embedded server."""
    home = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))
    path = home.resolve() / "app-server-control/app-server-control.sock"
    args = ["-c", "check_for_update_on_startup=false"]
    if path.exists():
        args.extend(["--remote", "unix://" + str(path)])
    return args


def loaded_threads(home):
    """Share one bounded daemon snapshot across every run for ten seconds."""
    global _loaded_cache
    path = home.resolve() / "app-server-control/app-server-control.sock"
    with _loaded_lock:
        now = time.monotonic()
        if _loaded_cache and _loaded_cache[0] == path and now < _loaded_cache[1]:
            return _loaded_cache[2]
        loaded = set()
        try:
            if path.exists():
                with Client(path) as client:
                    cursor = None
                    for _ in range(4):
                        page = client.call("thread/loaded/list", {"limit": 256, "cursor": cursor})
                        ids = page.get("data")
                        if not isinstance(ids, list) or any(not isinstance(i, str) for i in ids):
                            raise RpcError("Invalid loaded-thread snapshot")
                        loaded.update(ids[:256])
                        cursor = page.get("nextCursor")
                        if not cursor:
                            break
        except (OSError, RpcError, ValueError, TypeError):
            loaded.clear()
        snapshot = frozenset(loaded)
        _loaded_cache = (path, time.monotonic() + 10, snapshot)
        return snapshot


class RpcError(Exception):
    pass


class RpcRejected(RpcError):
    pass


class RpcTimeout(RpcError):
    """Codex did not answer in time; a request it may have received."""


class Client:
    def __init__(self, path=None):
        home = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))
        self.path = path or home / "app-server-control/app-server-control.sock"
        self.sock = None
        self.stream = None
        self.sequence = 0
        self.deadline = time.monotonic() + WINDOW_SECONDS
        self.quiet = QUIET_SECONDS

    def __enter__(self):
        try:
            self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.sock.settimeout(QUIET_SECONDS)
            self.sock.connect(str(self.path))
            self.stream = self.sock.makefile("rb")
            key = base64.b64encode(os.urandom(16)).decode()
            self.sock.sendall(("GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n"
                "Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: "
                + key + "\r\n\r\n").encode())
            status = self.stream.readline(4096)
            headers = {}
            for _ in range(32):
                line = self.stream.readline(4096)
                if line == b"\r\n":
                    break
                name, _, value = line.decode().partition(":")
                headers[name.lower()] = value.strip()
            expected = base64.b64encode(hashlib.sha1((key +
                "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
            if b" 101 " not in status or headers.get("sec-websocket-accept") != expected:
                raise RpcError("Codex did not accept the local connection")
            self.call("initialize", {"clientInfo": {"name": "orc_questions", "version": "1"},
                                     "capabilities": {"experimentalApi": True}})
            self.send(1, json.dumps({"method": "initialized", "params": {}}).encode())
            return self
        except Exception:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_):
        if self.stream:
            self.stream.close()
        if self.sock:
            self.sock.close()

    def send(self, opcode, payload):
        size = len(payload)
        if size > LIMIT:
            raise RpcError("Codex message exceeds the local transport limit")
        head = bytes([0x80 | opcode])
        if size < 126:
            head += bytes([0x80 | size])
        elif size < 65536:
            head += b"\xfe" + struct.pack("!H", size)
        else:
            head += b"\xff" + struct.pack("!Q", size)
        mask = os.urandom(4)
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def read(self, size):
        self.sock.settimeout(max(0.01, min(self.quiet, self.deadline - time.monotonic())))
        data = self.stream.read(size)
        if len(data) != size:
            raise RpcError("Codex closed the local connection")
        return data

    def receive(self):
        message = bytearray()
        started = False
        while time.monotonic() < self.deadline:
            head = self.read(2)
            size, opcode = head[1] & 127, head[0] & 15
            if size == 126:
                size = struct.unpack("!H", self.read(2))[0]
            elif size == 127:
                size = struct.unpack("!Q", self.read(8))[0]
            if head[1] & 128 or head[0] & 112 or size + len(message) > LIMIT:
                raise RpcError("Invalid Codex WebSocket frame")
            body = self.read(size)
            if opcode >= 8 and (not head[0] & 128 or size > 125):
                raise RpcError("Invalid Codex WebSocket control frame")
            if opcode == 8:
                raise RpcError("Codex closed the local connection")
            if opcode == 9:
                self.send(10, body)
                continue
            if opcode == 10:
                continue
            if opcode not in (0, 1):
                raise RpcError("Unexpected Codex WebSocket message")
            if (opcode == 0 and not started) or (opcode == 1 and started):
                raise RpcError("Invalid Codex WebSocket continuation")
            started = True
            message.extend(body)
            if head[0] & 128:
                return json.loads(message)
        raise RpcTimeout("Codex did not acknowledge the request in time")

    def call(self, method, params):
        self.sequence += 1
        self.send(1, json.dumps({"id": self.sequence, "method": method, "params": params}).encode())
        started = time.monotonic()
        if method in READ_ONLY_METHODS:
            self.quiet = WINDOW_SECONDS
        else:
            self.deadline = max(self.deadline, started + QUIET_SECONDS)
        try:
            for _ in range(256):
                response = self.receive()
                if response.get("id") != self.sequence:
                    continue
                if "error" in response:
                    raise RpcRejected(str(response["error"].get("message", "Codex refused the request")))
                return response.get("result", {})
        except (TimeoutError, RpcTimeout) as error:
            raise RpcTimeout("Codex did not answer %s in time (%.1fs)"
                             % (method, time.monotonic() - started)) from error
        finally:
            self.quiet = QUIET_SECONDS
        raise RpcError("Codex sent too many events before acknowledging")


class StdioClient(Client):
    def __init__(self, cwd):
        super().__init__()
        self.cwd = cwd
        self.process = None
        self.selector = None
        self.pending = b""
        self.deadline = time.monotonic() + 10

    def __enter__(self):
        try:
            self.process = subprocess.Popen(
                ["codex", "app-server", "--listen", "stdio://"], cwd=self.cwd,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                bufsize=0,
            )
            self.selector = selectors.DefaultSelector()
            self.selector.register(self.process.stdout, selectors.EVENT_READ)
            self.call("initialize", {"clientInfo": {"name": "orc_skills", "version": "1"}})
            self.send(1, json.dumps({"method": "initialized", "params": {}}).encode())
            return self
        except Exception:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_):
        if self.selector:
            self.selector.close()
        if self.process:
            if self.process.poll() is None:
                self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
            self.process.stdin.close()
            self.process.stdout.close()

    def send(self, opcode, payload):
        if len(payload) > LIMIT:
            raise RpcError("Codex message exceeds the local transport limit")
        self.process.stdin.write(payload + b"\n")
        self.process.stdin.flush()

    def receive(self):
        while time.monotonic() < self.deadline:
            if b"\n" in self.pending:
                line, self.pending = self.pending.split(b"\n", 1)
                return json.loads(line)
            if not self.selector.select(max(0, self.deadline - time.monotonic())):
                break
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise RpcError("Codex closed the local connection")
            self.pending += chunk
            if len(self.pending) > LIMIT:
                raise RpcError("Codex message exceeds the local transport limit")
        raise RpcTimeout("Codex did not acknowledge the request in time")


# Codex's auto mode. The sandbox alone is not enough: an Orc run creates its
# branch in the project's .git and its worktree beside the project, both outside
# the sandbox. on-request lets Codex ask to leave it and auto_review answers, so
# a run with nobody watching neither stalls on a prompt nor fails on a denial.
# Config overrides, not `--full-auto`: Codex 0.167 removed that flag, and these
# are accepted by the TUI, `exec` and `exec resume` alike.
AUTO_MODE_CONFIG = {"sandbox_mode": "workspace-write", "approval_policy": "on-request",
                    "approvals_reviewer": "auto_review"}
AUTO_MODE_ARGS = tuple(arg for key, value in AUTO_MODE_CONFIG.items()
                       for arg in ("-c", '%s="%s"' % (key, value)))
# What a run launched in auto mode before Codex removed the flag has recorded.
LEGACY_AUTO_FLAG = "--full-auto"
# thread/start takes these two as its own parameters.
THREAD_PARAM_KEYS = {"sandbox_mode": "sandbox", "approval_policy": "approvalPolicy"}


def scoped_thread_params(argv, cwd):
    params = {"cwd": cwd, "config": {}}
    argv = [arg for flag in argv
            for arg in (AUTO_MODE_ARGS if flag == LEGACY_AUTO_FLAG else (flag,))]
    index = 0
    while index < len(argv):
        flag = argv[index]
        if flag in ("-c", "--config"):
            key, separator, value = argv[index + 1].partition("=")
            if not separator:
                raise ValueError("invalid Codex configuration override")
            try:
                parsed = tomllib.loads("value=" + value)["value"]
            except ValueError:
                parsed = value
            if key in THREAD_PARAM_KEYS:
                params[THREAD_PARAM_KEYS[key]] = parsed
            else:
                params["config"][key] = parsed
            index += 2
        elif flag in ("--model", "--sandbox", "--ask-for-approval"):
            params[{"--model": "model", "--sandbox": "sandbox",
                    "--ask-for-approval": "approvalPolicy"}[flag]] = argv[index + 1]
            index += 2
        elif flag == "--dangerously-bypass-approvals-and-sandbox":
            params.update(approvalPolicy="never", sandbox="danger-full-access")
            index += 1
        elif flag in ("--remote", "--cd"):
            index += 2
        else:
            raise ValueError("unsupported scoped Codex launch option: " + flag)
    return params
