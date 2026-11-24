"""Local PTY shells for the run terminal, independent of agent turns."""
from __future__ import annotations

import base64
import fcntl
import hashlib
import json
import os
import signal
import struct
import subprocess
import sys
import termios
import threading
from typing import Any

import uuid
import atexit

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_FRAME = 1 << 20

# A controlling terminal delivers resize signals to interactive programs.
# Forking this threaded server to acquire one would inherit unsafe locks.
_CTTY_SHIM = ("import fcntl,os,sys,termios;"
              "fcntl.ioctl(0,termios.TIOCSCTTY,0);"
              "os.execvp(sys.argv[1],sys.argv[1:])")


def shell_index(value: Any) -> int | None:
    """A positive shell tab number from a query value, else None."""
    text = str(value or "")
    if not text.isdecimal():
        return None
    try:
        return int(text) or None
    except ValueError:
        return None


def shell_indexes(run_id):
    with _SHELL_LOCK:
        return sorted(index for (owner, index), shell in _SHELLS.items()
                      if owner == run_id and isinstance(index, int) and shell.proc.poll() is None)


def accept_key(key: str) -> str:
    digest = hashlib.sha1((key + WS_GUID).encode()).digest()
    return base64.b64encode(digest).decode()


def clamp_size(value: Any, default: int, low: int, high: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def unmask(payload: bytes, mask: bytes) -> bytes:
    """XOR a client frame with its 4-byte mask as two big integers: a pasted
    block would otherwise cost one Python operation per byte."""
    if not payload:
        return payload
    key = (mask * (len(payload) // 4 + 1))[:len(payload)]
    value = int.from_bytes(payload, "big") ^ int.from_bytes(key, "big")
    return value.to_bytes(len(payload), "big")


class WebSocket:
    """The server half of RFC 6455 over a finished HTTP upgrade: unmasked
    frames out, masked frames in. Sends are locked because the pty pump and
    the reader (answering pings) both write."""

    def __init__(self, rfile, wfile):
        self.rfile = rfile
        self.wfile = wfile
        self.lock = threading.Lock()
        self.closed = False

    def send(self, opcode: int, payload: bytes = b"") -> bool:
        size = len(payload)
        if size < 126:
            header = struct.pack("!BB", 0x80 | opcode, size)
        elif size < 1 << 16:
            header = struct.pack("!BBH", 0x80 | opcode, 126, size)
        else:
            header = struct.pack("!BBQ", 0x80 | opcode, 127, size)
        with self.lock:
            if self.closed:
                return False
            try:
                self.wfile.write(header + payload)
                self.wfile.flush()
            except OSError:
                self.closed = True
                return False
        return True

    def send_json(self, message: dict[str, Any]) -> bool:
        return self.send(0x1, json.dumps(message).encode())

    def close(self, code: int = 1000) -> None:
        self.send(0x8, struct.pack("!H", code))
        with self.lock:
            self.closed = True

    def _read(self, size: int) -> bytes | None:
        data = self.rfile.read(size) if size else b""
        return data if len(data) == size else None

    def recv(self) -> tuple[int, bytes] | None:
        """The next text/binary message as (opcode, payload), or None once the
        peer closes or breaks framing. Pings are answered here."""
        message, opcode = b"", 0
        while True:
            head = self._read(2)
            if head is None:
                return None
            fin, op = head[0] & 0x80, head[0] & 0x0F
            masked, size = head[1] & 0x80, head[1] & 0x7F
            if size == 126:
                ext = self._read(2)
                size = struct.unpack("!H", ext)[0] if ext else -1
            elif size == 127:
                ext = self._read(8)
                size = struct.unpack("!Q", ext)[0] if ext else -1
            if not masked or size < 0 or size > MAX_FRAME:
                return None
            mask = self._read(4)
            payload = self._read(size)
            if mask is None or payload is None:
                return None
            payload = unmask(payload, mask)
            if op == 0x8:
                return None
            if op == 0x9:
                self.send(0xA, payload)
                continue
            if op == 0xA:
                continue
            if op in (0x1, 0x2):
                message, opcode = payload, op
            elif op == 0x0 and opcode:
                message += payload
            else:
                return None
            if len(message) > MAX_FRAME:
                return None
            if fin:
                return opcode, message


def terminal_cwd(meta: dict[str, Any]) -> str | None:
    """The first of the run's worktree, its recorded checkout, and its main
    repository that still exists. A merged run's worktree is usually gone, and
    its repoPath with it; the terminal then opens in the main repository."""
    worktree = meta.get("worktree") if isinstance(meta.get("worktree"), dict) else {}
    for path in (worktree.get("path"), meta.get("repoPath"), meta.get("mainRepoPath")):
        if isinstance(path, str) and path and os.path.isdir(path):
            return path
    return None


def shell_cwd(meta: dict[str, Any]) -> str | None:
    """A shell opens on the run's branch whatever its status, so review fixes
    on a pushed PR land in the worktree rather than the main checkout."""
    return terminal_cwd(meta)


def set_size(fd: int, cols: int, rows: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def stop_attach(proc: subprocess.Popen, master: int) -> None:
    if proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except OSError:
            pass
    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        proc.wait()
    try:
        os.close(master)
    except OSError:
        pass


_SHELLS = {}
_SHELL_LOCK = threading.RLock()


class Shell:
    """A PTY running `argv`, a login shell by default, in `environ` (the
    daemon's own environment by default) plus `env`."""

    def __init__(self, cwd, env=None, argv=None, environ=None):
        self.id = uuid.uuid4().hex
        self.lock = threading.RLock()
        self.output = bytearray()
        self.clients = set()
        self.closed = False
        # herdr's tab state and the thread that follows it, for a herdr client.
        self.tabs = None
        self.feed = None
        self.master, slave = os.openpty()
        set_size(self.master, 80, 24)
        environment = dict(os.environ if environ is None else environ,
                           TERM="xterm-256color", COLORTERM="truecolor", **(env or {}))
        try:
            self.proc = subprocess.Popen(
                [sys.executable, "-c", _CTTY_SHIM, *(argv or [os.environ.get("SHELL") or "/bin/sh", "-l"])],
                cwd=cwd, stdin=slave, stdout=slave, stderr=slave, env=environment,
                start_new_session=True, close_fds=True)
        except BaseException:
            os.close(self.master)
            raise
        finally:
            os.close(slave)
        threading.Thread(target=self.pump, daemon=True).start()

    def pump(self):
        try:
            while True:
                try:
                    data = os.read(self.master, 65536)
                except OSError:
                    break
                if not data:
                    break
                with self.lock:
                    self.output.extend(data)
                    del self.output[:-1024 * 1024]
                    for ws in tuple(self.clients):
                        if not ws.send(0x2, data):
                            self.clients.discard(ws)
        finally:
            with self.lock:
                for ws in tuple(self.clients):
                    ws.send_json({"type": "exit"})
                    ws.close()
                self.clients.clear()
            self.proc.wait()

    def send(self, text):
        os.write(self.master, text.encode())

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
        stop_attach(self.proc, self.master)


def get_shell(run_id, index=1, cwd=None, env=None, argv=None, environ=None):
    with _SHELL_LOCK:
        key = (run_id, index)
        shell = _SHELLS.get(key)
        if shell is not None and shell.proc.poll() is not None:
            shell.close()
            del _SHELLS[key]
            shell = None
        if shell is None and cwd:
            shell = _SHELLS[key] = Shell(cwd, env, argv, environ)
        return shell


def new_shell(run_id, cwd, command=None, env=None, enter=True):
    """(index, shell) of the run's next free shell, running `command` when
    given, or only typing it at the prompt when `enter` is false."""
    with _SHELL_LOCK:
        used = set(shell_indexes(run_id))
        index = next(i for i in range(1, len(used) + 2) if i not in used)
        shell = get_shell(run_id, index, cwd, env)
        if command:
            shell.send(command + ("\n" if enter else ""))
        return index, shell


def shell_by_id(identity):
    with _SHELL_LOCK:
        return next((shell for shell in _SHELLS.values() if shell.id == identity), None)


def close_terminal(run_id, index=1):
    with _SHELL_LOCK:
        shell = _SHELLS.pop((run_id, index), None)
    if shell:
        shell.close()
    return shell is not None


def close_all():
    with _SHELL_LOCK:
        shells = list(_SHELLS.values())
        _SHELLS.clear()
    for shell in shells:
        shell.close()


atexit.register(close_all)


COPY_LIMIT = 1024 * 1024


def copy_to_mac(text):
    """Puts `text` on this Mac's clipboard, where a browser on the Mac can
    miss it: WebKit may refuse a write that lands after the gesture."""
    try:
        subprocess.run(["pbcopy"], input=text.encode(), env=dict(os.environ, LC_CTYPE="UTF-8"),
                       timeout=5, check=False)
    except (OSError, subprocess.TimeoutExpired):
        pass


def bridge(ws, shell, cols=80, rows=24, on_copy=None):
    """Joins `ws` to `shell`. `on_copy` takes the text the browser copied out
    of the terminal, for a browser on this Mac only."""
    set_size(shell.master, cols, rows)
    with shell.lock:
        ws.send(0x2, bytes(shell.output))
        if shell.tabs is not None:
            ws.send_json(dict(shell.tabs, type="tabs"))
        shell.clients.add(ws)
    try:
        while True:
            message = ws.recv()
            if message is None:
                break
            opcode, payload = message
            if opcode == 0x2:
                os.write(shell.master, payload)
            else:
                try:
                    control = json.loads(payload)
                except ValueError:
                    continue
                if not isinstance(control, dict):
                    continue
                if control.get("type") == "resize":
                    set_size(shell.master, clamp_size(control.get("cols"), 80, 2, 1000),
                             clamp_size(control.get("rows"), 24, 1, 500))
                elif control.get("type") == "copy" and on_copy and isinstance(control.get("text"), str):
                    on_copy(control["text"][:COPY_LIMIT])
    except OSError:
        pass
    finally:
        with shell.lock:
            shell.clients.discard(ws)
        ws.close()
