"""Pairing for the phone listener Tailscale serves.

The loopback listener stays unauthenticated, as it always was. Anything that
arrives on the phone listener must carry the device cookie, which a phone gets
by entering the short pairing code shown in Settings on the Mac. The cookie
is named for the Wi-Fi listener Orc once had, so phones paired then stay
signed in. The older shared secret lives in ~/.orc/lan-secret (0600);
rotating it signs out every phone still on it.

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
from urllib.parse import quote, unquote

COOKIE = "orc_lan"
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6
CODE_TTL = 10 * 60
MAX_FAILED_ATTEMPTS = 5
COOKIE_MAX_AGE = 365 * 24 * 3600

_lock = threading.Lock()
_pairing = {"code": None, "expires": 0.0, "failures": 0}


def read_secret(path, create=True):
    try:
        with open(path) as f:
            secret = f.read().strip()
        if len(secret) >= 32:
            return secret
    except OSError:
        pass
    return rotate_secret(path) if create else None


def rotate_secret(path):
    secret = secrets.token_urlsafe(32)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)),
                               prefix=os.path.basename(path) + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(secret + "\n")
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise
    return secret


def cookie_value(headers):
    raw = headers.get("Cookie") or ""
    for part in raw.split(";"):
        name, _, value = part.strip().partition("=")
        if name == COOKIE:
            return value
    return None


def cookie_valid(headers, secret):
    value = cookie_value(headers)
    return bool(value and secret and hmac.compare_digest(value, secret))


def set_cookie_header(secret):
    # SameSite=Strict keeps another site from riding the cookie into a POST.
    # The caller adds Secure for the HTTPS origin Tailscale serves.
    return "%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Strict" % (
        COOKIE, secret, COOKIE_MAX_AGE)


# A vault's own app (app-plugins/vaults), which a phone opens from its home screen.
VAULT_APP_PATH = re.compile(r"/vault/[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?")


def pairing_return_path(candidate):
    if isinstance(candidate, str) and VAULT_APP_PATH.fullmatch(candidate):
        return candidate
    if not isinstance(candidate, str) or not (candidate == "/" or candidate.startswith("/#")):
        return "/"
    decoded = unquote(candidate)
    if any(ord(char) < 32 or ord(char) == 127 or char == "\\" for char in decoded):
        return "/"
    return quote(candidate, safe="/#?=&%:+,;@!$'()*-._~")


def set_custom_code(path, code):
    if not isinstance(code, str) or not re.fullmatch(r"[A-Za-z0-9]{6,64}", code):
        raise ValueError("Use 6–64 letters or numbers for the pairing code.")
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", code.upper().encode(), salt.encode(), 200000).hex()
    with _lock:
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump({"salt": salt, "digest": digest}, stream)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        _pairing.update(code=None, expires=0.0, failures=0)


def clear_custom_code(path):
    with _lock:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass


def redeem_custom_code(candidate, path, now):
    with _lock:
        if _pairing["failures"] >= MAX_FAILED_ATTEMPTS:
            if _pairing["expires"] > now:
                return False
            _pairing["failures"] = 0
        try:
            with open(path) as stream:
                saved = json.load(stream)
            digest = hashlib.pbkdf2_hmac("sha256", candidate.encode(), saved["salt"].encode(), 200000).hex()
            valid = hmac.compare_digest(digest, saved["digest"])
        except (OSError, ValueError, KeyError, TypeError):
            return False
        if valid:
            _pairing["failures"] = 0
        else:
            _pairing["failures"] += 1
            _pairing["expires"] = now + CODE_TTL
        return valid


def new_code(now=None):
    now = time.time() if now is None else now
    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
    with _lock:
        _pairing.update(code=code, expires=now + CODE_TTL, failures=0)
    return {"code": code, "expiresAt": now + CODE_TTL}


def current_code(now=None):
    now = time.time() if now is None else now
    with _lock:
        if _pairing["code"] and _pairing["expires"] > now:
            return {"code": _pairing["code"], "expiresAt": _pairing["expires"]}
    return None


def redeem_code(candidate, now=None, custom_path=None):
    now = time.time() if now is None else now
    candidate = "".join((candidate or "").split()).upper()
    if custom_path and os.path.exists(custom_path):
        return redeem_custom_code(candidate, custom_path, now)
    with _lock:
        code = _pairing["code"]
        if not code or _pairing["expires"] <= now:
            return False
        if hmac.compare_digest(candidate, code):
            _pairing.update(code=None, expires=0.0, failures=0)
            return True
        _pairing["failures"] += 1
        if _pairing["failures"] >= MAX_FAILED_ATTEMPTS:
            _pairing.update(code=None, expires=0.0, failures=0)
        return False
