"""Hold an idle-sleep assertion for the lifetime of Orc's desktop server.

The macOS child watches the server PID. The Windows child watches its input
pipe, so the power request also ends when the server is killed.
"""

import os
import subprocess
import threading

import windows_host


def enabled(config):
    ui = config.get("ui") if isinstance(config, dict) else None
    return isinstance(ui, dict) and ui.get("stayAwake") is True


def _spawn(argv):
    if windows_host.WSL:
        # EOF releases the Windows thread's power request even if orc-ui is killed.
        script = """$ErrorActionPreference='Stop';
Add-Type -Namespace Orc -Name Power -MemberDefinition '
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint flags);';
if ([Orc.Power]::SetThreadExecutionState(2147483649) -eq 0) { exit 1 };
[void][Console]::In.ReadToEnd()"""
        return subprocess.Popen([*windows_host.POWERSHELL, script], stdin=subprocess.PIPE,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, start_new_session=True)


class Keeper:
    def __init__(self, spawn=None, pid=None):
        self._spawn = spawn or _spawn
        self._pid = os.getpid() if pid is None else pid
        self._process = None
        self._lock = threading.Lock()
        self.error = None

    @property
    def active(self):
        return self._process is not None and self._process.poll() is None

    def sync(self, on):
        with self._lock:
            if on:
                if self.active:
                    # A replacement keeps the last failure until it has
                    # survived one more sync, so a caffeinate that dies at
                    # once cannot look healthy between checks.
                    self.error = None
                    return
                died = self._process
                try:
                    self._process = self._spawn(["caffeinate", "-i", "-w", str(self._pid)])
                    self.error = None if died is None else (
                        "caffeinate stopped (exit status %s) and was restarted" % died.poll())
                except OSError as exc:
                    self._process = None
                    self.error = "could not start caffeinate: %s" % exc
                return
            self.error = None
            process, self._process = self._process, None
            if process is not None and process.poll() is None:
                if getattr(process, "stdin", None):
                    process.stdin.close()
                else:
                    process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
