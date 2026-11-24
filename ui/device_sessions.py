"""Signed-in phones and browsers: one revocable session per device.

Each device holds 32 random bytes as its cookie. ~/.orc/devices.json (0600)
keeps only their SHA-256, with the device's name, how it signed in, and where
it was last seen, so Settings can list the devices and sign out any one.

A phone paired before sessions existed carries the old shared secret from
~/.orc/lan-secret. It is upgraded in place to a session of method "legacy".

stdlib-only, like the rest of ui/.
"""
import contextlib
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import threading
import time

METHODS = ("github", "code", "legacy")
SEEN_EVERY = 60
LEGACY_REUSE = 5 * 60

_lock = threading.Lock()
# A legacy phone fires several requests before it stores its new cookie; each
# gets the same session rather than one apiece.
_legacy = {}
# Device id -> close callbacks of its open WebSockets, which outlive the
# request that checked the cookie.
_sockets = {}


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def device_name(user_agent):
    """"iPhone · Safari" from a User-Agent, or "Browser"."""
    agent = user_agent or ""
    device = next((name for pattern, name in (
        (r"iPhone", "iPhone"), (r"iPad", "iPad"), (r"Android", "Android"),
        (r"Macintosh|Mac OS X", "Mac"), (r"Windows", "Windows"), (r"CrOS", "Chromebook"),
        (r"Linux", "Linux")) if re.search(pattern, agent)), None)
    browser = next((name for pattern, name in (
        (r"OrcApp/", "Orc app"), (r"Edg/", "Edge"), (r"OPR/", "Opera"), (r"Firefox/|FxiOS/", "Firefox"),
        (r"Chrome/|CriOS/", "Chrome"), (r"Safari/", "Safari")) if re.search(pattern, agent)), None)
    return " · ".join(part for part in (device, browser) if part) or "Browser"


def _read(path):
    try:
        with open(path) as stream:
            data = json.load(stream)
    except (OSError, ValueError):
        return []
    devices = data.get("devices") if isinstance(data, dict) else None
    return [item for item in devices if isinstance(item, dict)] if isinstance(devices, list) else []


def _write(path, devices):
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".devices.", suffix=".tmp")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump({"devices": devices}, stream, indent=2)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def public(device):
    found = {key: device.get(key) for key in (
        "id", "name", "method", "createdAt", "lastSeenAt", "lastIp", "login", "tailscaleLogin")}
    found["push"] = bool(device.get("push"))
    return found


def _create(path, method, user_agent, ip, login, tailscale_login, now):
    if method not in METHODS:
        raise ValueError("unknown sign-in method")
    now = time.time() if now is None else now
    token = secrets.token_urlsafe(32)
    device = {"id": secrets.token_hex(8), "tokenHash": token_hash(token), "name": device_name(user_agent),
              "method": method, "createdAt": now, "lastSeenAt": now, "lastIp": ip,
              "login": login, "tailscaleLogin": tailscale_login}
    devices = _read(path)
    devices.append(device)
    _write(path, devices)
    return token, device


def create(path, method, user_agent, ip, login=None, tailscale_login=None, now=None):
    """A new session; returns (cookie token, its public record)."""
    with _lock:
        token, device = _create(path, method, user_agent, ip, login, tailscale_login, now)
    return token, public(device)


def find(path, token):
    if not token:
        return None
    digest = token_hash(token)
    for device in _read(path):
        if hmac.compare_digest(str(device.get("tokenHash") or ""), digest):
            return device
    return None


def seen(path, device, ip, tailscale_login=None, now=None):
    """Records a request, writing at most once a minute per device unless its
    address changed."""
    now = time.time() if now is None else now
    if (now - (device.get("lastSeenAt") or 0) < SEEN_EVERY and device.get("lastIp") == ip
            and (not tailscale_login or device.get("tailscaleLogin") == tailscale_login)):
        return
    with _lock:
        devices = _read(path)
        for item in devices:
            if item.get("id") == device.get("id"):
                item.update(lastSeenAt=now, lastIp=ip)
                if tailscale_login:
                    item["tailscaleLogin"] = tailscale_login
                _write(path, devices)
                return


PUSH_TOKEN = re.compile(r"[0-9a-f]{64,200}")
PUSH_TOPIC = re.compile(r"[A-Za-z0-9][A-Za-z0-9.-]{0,154}")
PUSH_ENVIRONMENTS = ("development", "production")


def set_push(path, device_id, token, environment, topic):
    """Keeps the address Apple gave this device's Orc app with its session,
    so signing the device out also stops its notifications. Any other session
    holding the same address loses it: a phone that paired again has one."""
    if not (isinstance(token, str) and PUSH_TOKEN.fullmatch(token)):
        raise ValueError("token must be the device's push token in lowercase hex")
    if environment not in PUSH_ENVIRONMENTS:
        raise ValueError("environment must be development or production")
    if not (isinstance(topic, str) and PUSH_TOPIC.fullmatch(topic)):
        raise ValueError("topic must be the app's bundle identifier")
    push = {"token": token, "environment": environment, "topic": topic}
    with _lock:
        devices = _read(path)
        if not any(item.get("id") == device_id for item in devices):
            return False
        changed = False
        for item in devices:
            wanted = push if item.get("id") == device_id else (
                None if (item.get("push") or {}).get("token") == token else item.get("push"))
            if item.get("push") != wanted:
                changed = True
                if wanted is None:
                    item.pop("push", None)
                else:
                    item["push"] = wanted
        if changed:
            _write(path, devices)
    return True


def clear_push(path, token):
    """Forgets an address Apple says no longer exists."""
    with _lock:
        devices = _read(path)
        stale = [item for item in devices if (item.get("push") or {}).get("token") == token]
        for item in stale:
            del item["push"]
        if stale:
            _write(path, devices)
    return bool(stale)


def push_targets(path):
    return [dict(device["push"], device=device.get("id")) for device in _read(path)
            if isinstance(device.get("push"), dict)]


def _legacy_secret(secret_path):
    try:
        with open(secret_path) as stream:
            return stream.read().strip()
    except OSError:
        return ""


def upgrade_legacy(path, secret_path, cookie, user_agent, ip, tailscale_login=None, now=None):
    """The session that replaces a phone's old shared-secret cookie, or
    (None, None) once the cookie no longer matches the secret. Checked under
    the lock revoke_all takes, so a sign-out that rotates the secret first
    cannot be followed by a fresh upgrade."""
    now = time.time() if now is None else now
    key = (path, user_agent or "", ip)
    with _lock:
        secret = _legacy_secret(secret_path)
        if not (cookie and len(secret) >= 32 and hmac.compare_digest(cookie, secret)):
            return None, None
        for stale in [k for k, (_, until) in _legacy.items() if until <= now]:
            del _legacy[stale]
        cached = _legacy.get(key)
        device = find(path, cached[0]) if cached else None
        if device:
            return cached[0], device
        token, device = _create(path, "legacy", user_agent, ip, None, tailscale_login, now)
        _legacy[key] = (token, now + LEGACY_REUSE)
    return token, device


def listing(path):
    return sorted((public(device) for device in _read(path)),
                  key=lambda device: -(device.get("lastSeenAt") or 0))


@contextlib.contextmanager
def holding(path, device_id, close):
    """Registers close() to end a long-lived connection when device_id is
    signed out; a None device_id (loopback) registers nothing. A device
    already signed out is closed at once: the check and the registration
    share revoke's lock, so neither order of the two is missed."""
    registered = False
    if device_id:
        with _lock:
            registered = any(device.get("id") == device_id for device in _read(path))
            if registered:
                _sockets.setdefault(device_id, set()).add(close)
        if not registered:
            _close([close])
    try:
        yield
    finally:
        if registered:
            with _lock:
                _sockets.get(device_id, set()).discard(close)
                if not _sockets.get(device_id):
                    _sockets.pop(device_id, None)


def _close(callbacks):
    for close in callbacks:
        with contextlib.suppress(OSError):
            close()


def revoke(path, device_id):
    with _lock:
        devices = _read(path)
        kept = [device for device in devices if device.get("id") != device_id]
        if len(kept) == len(devices):
            return False
        _write(path, kept)
        gone = {device.get("tokenHash") for device in devices if device.get("id") == device_id}
        for key in [key for key, (token, _) in _legacy.items() if token_hash(token) in gone]:
            del _legacy[key]
        callbacks = _sockets.pop(device_id, set())
    _close(callbacks)
    return True


def revoke_all(path):
    with _lock:
        _legacy.clear()
        _write(path, [])
        callbacks = set().union(*_sockets.values())
        _sockets.clear()
    _close(callbacks)
