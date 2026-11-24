"""Credentials stored with Windows DPAPI or the macOS Keychain, plus per-run
secret requests shown in Chat.

Only credential names and request metadata belong on disk; secret values stay
in the OS credential store.
"""
from __future__ import annotations

import contextlib
import fcntl
import getpass
import json
import os
import re
import secrets
import subprocess
import tempfile

from datetime import datetime, timezone

import windows_host

INDEX_FILE = "secrets.json"
REQUESTS_FILE = "secret-requests.json"
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")
VALUE_MAX = 4096
REASON_MAX = 300
# `security find-generic-password -w` prints any other password as hex, so a
# command reading it back would get the wrong value.
PRINTABLE_ASCII = re.compile(r"[\x20-\x7e]+")
NOT_FOUND = 44


class SecretError(ValueError):
    pass


def current_account():
    return getpass.getuser()


def validate_name(name):
    if not isinstance(name, str) or not NAME.fullmatch(name):
        raise SecretError("Use 1–128 letters, numbers, dots, dashes or underscores, "
                          "starting with a letter or number.")
    return name


def validate_value(value):
    if not isinstance(value, str) or not value:
        raise SecretError("Enter the secret.")
    if len(value) > VALUE_MAX:
        raise SecretError("The secret is longer than %d characters." % VALUE_MAX)
    if not PRINTABLE_ASCII.fullmatch(value):
        raise SecretError("Use printable ASCII only, on one line.")
    return value


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _quoted(text):
    return '"%s"' % text.replace("\\", "\\\\").replace('"', '\\"')


def _security_error(result, action):
    lines = (result.stderr or b"").decode("utf-8", "replace").strip().splitlines()
    return SecretError("The Keychain could not %s the secret%s" % (
        action, ": " + lines[-1] if lines else "."))


def _security(run, action, argv, **kwargs):
    """run() for the security CLI; a locked Keychain that never answers is a
    SecretError like any other refusal."""
    try:
        return run(argv, capture_output=True, timeout=30, **kwargs)
    except subprocess.SubprocessError as exc:
        raise SecretError("The Keychain did not answer when asked to %s the secret." % action) from exc


def save(name, value, *, account=None, run=subprocess.run):
    """`security -i` takes the add command on stdin, so the value never
    appears in another process's view of this one's arguments."""
    validate_name(name)
    validate_value(value)
    if windows_host.WSL:
        path = windows_host.credential_file(name, account or current_account())
        try:
            windows_host.save_credential(path, value, run=run)
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            raise SecretError("Windows could not save the secret.") from exc
        return
    command = "add-generic-password -U -a %s -s %s -w %s\n" % (
        _quoted(account or current_account()), _quoted(name), _quoted(value))
    result = _security(run, "save", ["security", "-i"], input=command.encode())
    if result.returncode != 0:
        raise _security_error(result, "save")


def exists(name, *, account=None, run=subprocess.run):
    validate_name(name)
    if windows_host.WSL:
        return windows_host.credential_file(name, account or current_account()).is_file()
    result = run(["security", "find-generic-password", "-a", account or current_account(),
                  "-s", name], capture_output=True, timeout=30)
    return result.returncode == 0


def read(name, *, account=None, run=subprocess.run):
    """Read a credential for a local consumer, or return None when absent."""
    validate_name(name)
    if windows_host.WSL:
        path = windows_host.credential_file(name, account or current_account())
        try:
            return windows_host.protect(path.read_bytes(), decrypt=True, run=run).decode()
        except FileNotFoundError:
            if not path.exists():
                return None
            raise SecretError("Windows credential storage is unavailable.")
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            raise SecretError("Windows could not read the secret.") from exc
    result = _security(run, "read", ["security", "find-generic-password", "-a", account or current_account(),
                                     "-s", name, "-w"])
    if result.returncode == NOT_FOUND:
        return None
    if result.returncode != 0:
        raise _security_error(result, "read")
    return (result.stdout or b"").decode("utf-8", "replace").rstrip("\n") or None


def delete(name, *, account=None, run=subprocess.run):
    validate_name(name)
    if windows_host.WSL:
        windows_host.credential_file(name, account or current_account()).unlink(missing_ok=True)
        return
    result = _security(run, "delete", ["security", "delete-generic-password", "-a", account or current_account(),
                                       "-s", name])
    if result.returncode not in (0, NOT_FOUND):
        raise _security_error(result, "delete")


def _read_json(path, key):
    try:
        with open(path) as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return []
    items = data.get(key) if isinstance(data, dict) else None
    return [item for item in items or [] if isinstance(item, dict)
            and isinstance(item.get("name"), str)]


def _write_json(path, data):
    fd, temporary = tempfile.mkstemp(prefix=".%s." % os.path.basename(path),
                                     suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(data, handle, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temporary)
        raise


@contextlib.contextmanager
def _locked(folder, name):
    with open(os.path.join(folder, name), "a+") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def saved(config_dir):
    return sorted(_read_json(os.path.join(config_dir, INDEX_FILE), "secrets"),
                  key=lambda entry: entry["name"].lower())


def remember(config_dir, name, *, run_id=None):
    os.makedirs(config_dir, exist_ok=True)
    with _locked(config_dir, ".secrets.lock"):
        path = os.path.join(config_dir, INDEX_FILE)
        entries = [entry for entry in _read_json(path, "secrets") if entry["name"] != name]
        entry = {"name": name, "savedAt": _now()}
        if run_id:
            entry["runId"] = run_id
        _write_json(path, {"secrets": entries + [entry]})


def forget(config_dir, name):
    path = os.path.join(config_dir, INDEX_FILE)
    if not os.path.exists(path):
        return
    with _locked(config_dir, ".secrets.lock"):
        _write_json(path, {"secrets": [entry for entry in _read_json(path, "secrets")
                                       if entry["name"] != name]})


def requests(run_dir):
    return _read_json(os.path.join(run_dir, REQUESTS_FILE), "items")


def pending(run_dir):
    if not os.path.exists(os.path.join(run_dir, REQUESTS_FILE)):
        return []
    return [item for item in requests(run_dir) if item.get("state") == "pending"]


def request(run_dir, name, reason, *, replaces):
    validate_name(name)
    if not isinstance(reason, str) or len(reason) > REASON_MAX:
        raise SecretError("Keep the reason under %d characters." % REASON_MAX)
    with _locked(run_dir, ".secret-requests.lock"):
        items = requests(run_dir)
        for item in items:
            if item["name"] == name and item.get("state") == "pending":
                return item
        item = {
            "id": secrets.token_hex(6),
            "name": name,
            "reason": reason.strip(),
            "replaces": bool(replaces),
            "state": "pending",
            "requestedAt": _now(),
        }
        _write_json(os.path.join(run_dir, REQUESTS_FILE), {"items": items + [item]})
        return item


def resolve(run_dir, request_id, state):
    with _locked(run_dir, ".secret-requests.lock"):
        items = requests(run_dir)
        item = next((entry for entry in items if entry.get("id") == request_id), None)
        if item is None or item.get("state") != "pending":
            raise SecretError("That secret request is no longer open.")
        item.update(state=state, resolvedAt=_now())
        _write_json(os.path.join(run_dir, REQUESTS_FILE), {"items": items})
        return item


def read_command(name):
    if windows_host.WSL:
        return "orc-secret read " + validate_name(name)
    return 'security find-generic-password -a "$USER" -s %s -w' % validate_name(name)


def saved_notice(name):
    if windows_host.WSL:
        return ("The user saved %s with Windows data protection. Use $(%s) inside the "
                "command that needs it. Never print, echo or log its value." % (name, read_command(name)))
    return ("The user saved secret %s in the macOS Keychain. Read it inside the command "
            "that needs it, for example `TOKEN=\"$(security find-generic-password -a "
            "\"$USER\" -s %s -w)\"`. Never print, echo or log its value." % (name, name))


def dismissed_notice(name):
    return ("The user dismissed the request for secret %s. Continue without it, or say "
            "in your reply why the work needs it." % name)
