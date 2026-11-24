"""Push notifications to the Orc iOS app through Apple's push service.

Apple accepts a notification only from the holder of a signing key made in
the developer account that owns the app. `bin/orc-push-setup` stores that key
as ~/.orc/apns/key.p8 (0600) beside config.json, which names the team and the
key. Each signed-in phone keeps its own address in ~/.orc/devices.json; see
device_sessions.set_push.

stdlib-only, like the rest of ui/. The standard library has neither ES256
nor HTTP/2, both of which Apple requires, so the signature comes from
/usr/bin/openssl and the request goes through /usr/bin/curl.
"""
import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time

import device_sessions

HOSTS = {"development": "api.sandbox.push.apple.com", "production": "api.push.apple.com"}
TEAM_ID = re.compile(r"[A-Z0-9]{10}")
KEY_ID = re.compile(r"[A-Z0-9]{10}")
# Apple rejects a provider token older than an hour and throttles one that is
# renewed more than once every 20 minutes.
TOKEN_LIFETIME = 45 * 60
BODY_MAX = 1000
TITLE_MAX = 120
# Apple's answers that mean this address will never work again for this app.
GONE = ("BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic")

_lock = threading.Lock()
_token = {}


class PushError(Exception):
    pass


def home(config_dir):
    return os.path.join(str(config_dir), "apns")


def credentials(config_dir):
    """{"teamId", "keyId", "keyPath"}, or None until push is set up."""
    folder = home(config_dir)
    key_path = os.path.join(folder, "key.p8")
    try:
        with open(os.path.join(folder, "config.json")) as stream:
            config = json.load(stream)
    except (OSError, ValueError):
        return None
    if not isinstance(config, dict) or not os.path.isfile(key_path):
        return None
    team, key = config.get("teamId"), config.get("keyId")
    if not (isinstance(team, str) and TEAM_ID.fullmatch(team) and isinstance(key, str) and KEY_ID.fullmatch(key)):
        return None
    return {"teamId": team, "keyId": key, "keyPath": key_path}


def save_credentials(config_dir, team_id, key_id, key_file):
    if not TEAM_ID.fullmatch(team_id or ""):
        raise PushError("The team ID is 10 letters and digits, shown under Membership details in your Apple developer account.")
    if not KEY_ID.fullmatch(key_id or ""):
        raise PushError("The key ID is 10 letters and digits, shown beside the key in your Apple developer account.")
    try:
        with open(key_file) as stream:
            key = stream.read()
    except (OSError, UnicodeDecodeError) as error:
        raise PushError("Could not read the key file: %s" % error) from None
    if "BEGIN PRIVATE KEY" not in key:
        raise PushError("That file is not an Apple push key. Download the .p8 file from Certificates, IDs & Profiles > Keys.")
    folder = home(config_dir)
    os.makedirs(folder, mode=0o700, exist_ok=True)
    for name, body in (("key.p8", key), ("config.json", json.dumps({"teamId": team_id, "keyId": key_id}, indent=2))):
        fd, tmp = tempfile.mkstemp(dir=folder, prefix=".apns.", suffix=".tmp")
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w") as stream:
                stream.write(body)
            os.replace(tmp, os.path.join(folder, name))
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    with _lock:
        _token.clear()
    return credentials(config_dir)


def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def raw_signature(der):
    """The 64-byte r||s form a JWT carries, from the DER pair openssl writes."""
    def integer(at):
        if at + 2 > len(der) or der[at] != 0x02 or der[at + 1] > 33:
            raise PushError("openssl returned a signature Orc cannot read.")
        size = der[at + 1]
        value = der[at + 2:at + 2 + size]
        if len(value) != size:
            raise PushError("openssl returned a signature Orc cannot read.")
        return value.lstrip(b"\x00").rjust(32, b"\x00"), at + 2 + size
    if len(der) < 8 or der[0] != 0x30:
        raise PushError("openssl returned a signature Orc cannot read.")
    # A P-256 signature is at most 72 bytes, so its length is one byte.
    r, at = integer(2)
    s, _ = integer(at)
    if len(r) != 32 or len(s) != 32:
        raise PushError("openssl returned a signature Orc cannot read.")
    return r + s


def _sign(key_path, message):
    openssl = "/usr/bin/openssl" if os.path.exists("/usr/bin/openssl") else shutil.which("openssl")
    if not openssl:
        raise PushError("openssl is not installed, so Orc cannot sign notifications.")
    try:
        done = subprocess.run([openssl, "dgst", "-sha256", "-sign", key_path], input=message,
                              capture_output=True, timeout=15, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise PushError("Could not sign the notification: %s" % error) from None
    if done.returncode != 0:
        raise PushError("The push key could not sign: %s" % (done.stderr.decode(errors="replace").strip() or "openssl failed"))
    return raw_signature(done.stdout)


def provider_token(found, now=None, sign=_sign):
    """The signed token that proves to Apple who is sending, reused until it
    is 45 minutes old."""
    now = time.time() if now is None else now
    with _lock:
        cached = _token.get((found["teamId"], found["keyId"]))
        if cached and now - cached[1] < TOKEN_LIFETIME:
            return cached[0]
        head = _b64(json.dumps({"alg": "ES256", "kid": found["keyId"]}, separators=(",", ":")).encode())
        claims = _b64(json.dumps({"iss": found["teamId"], "iat": int(now)}, separators=(",", ":")).encode())
        signed = "%s.%s" % (head, claims)
        token = "%s.%s" % (signed, _b64(sign(found["keyPath"], signed.encode())))
        _token[(found["teamId"], found["keyId"])] = (token, now)
        return token


def payload(title, body, url=None, thread=None):
    def clip(value, high):
        value = " ".join(str(value or "").split())
        return value if len(value) <= high else value[:high - 1].rstrip() + "…"
    aps = {"alert": {"title": clip(title, TITLE_MAX), "body": clip(body, BODY_MAX)}, "sound": "default"}
    if thread:
        aps["thread-id"] = str(thread)[:64]
    found = {"aps": aps}
    if url:
        found["url"] = str(url)[:512]
    return found


def _quoted(value):
    return '"%s"' % value.replace("\\", "\\\\").replace('"', '\\"')


def _post(host, device_token, headers, body):
    """(status, reason) from Apple. The provider token goes to curl on stdin
    so it never shows in the process list."""
    curl = "/usr/bin/curl" if os.path.exists("/usr/bin/curl") else shutil.which("curl")
    if not curl:
        raise PushError("curl is not installed, so Orc cannot reach Apple's push service.")
    lines = ["url = %s" % _quoted("https://%s/3/device/%s" % (host, device_token)), "http2", "silent", "show-error",
             "max-time = 20", "write-out = %s" % _quoted("\\n%{http_code}"), "data-binary = %s" % _quoted(body)]
    lines += ["header = %s" % _quoted("%s: %s" % item) for item in headers.items()]
    try:
        done = subprocess.run([curl, "--config", "-"], input="\n".join(lines).encode(),
                              capture_output=True, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise PushError("Could not reach Apple's push service: %s" % error) from None
    answer, _, status = done.stdout.decode(errors="replace").rpartition("\n")
    if done.returncode != 0 or not status.isdigit():
        raise PushError("Could not reach Apple's push service: %s" % (
            done.stderr.decode(errors="replace").strip() or "curl exit %d" % done.returncode))
    try:
        reason = json.loads(answer or "{}").get("reason", "")
    except (ValueError, AttributeError):
        reason = ""
    return int(status), reason


def send(found, target, message, post=_post, sign=_sign):
    """One notification to one device: (delivered, reason)."""
    headers = {"authorization": "bearer %s" % provider_token(found, sign=sign), "apns-topic": target["topic"],
               "apns-push-type": "alert", "apns-priority": "10"}
    status, reason = post(HOSTS[target["environment"]], target["token"], headers,
                          json.dumps(message, separators=(",", ":")))
    return status == 200, reason or ("" if status == 200 else "HTTP %d" % status)


def notify(config_dir, devices_path, title, body, url=None, thread=None, post=_post, sign=_sign):
    """Sends one notification to every phone with the Orc app signed in.
    Returns {"sent", "failed", "reason"}; never raises, because its callers
    are background loops that must outlive a failed delivery."""
    result = {"sent": 0, "failed": 0, "reason": ""}
    targets = device_sessions.push_targets(devices_path)
    if not targets:
        return result
    found = credentials(config_dir)
    if found is None:
        return dict(result, failed=len(targets), reason="Push is not set up. Run bin/orc-push-setup.")
    message = payload(title, body, url, thread)
    for target in targets:
        try:
            delivered, reason = send(found, target, message, post=post, sign=sign)
        except PushError as error:
            delivered, reason = False, str(error)
        if delivered:
            result["sent"] += 1
            continue
        result["failed"] += 1
        result["reason"] = reason
        if reason in GONE:
            device_sessions.clear_push(devices_path, target["token"])
    return result
