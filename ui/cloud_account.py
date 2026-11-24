"""GitHub sign-in through the user's Worker (cloud/project-memory), and the
settings that follow a GitHub account from computer to computer.

A computer signs in once: the Worker sends the browser to GitHub and back to
this orc-ui on loopback with a single-use ticket, which is redeemed here with
the nonce held in memory for a machine token. The token has its own Keychain
item; while this computer is signed in, usage stats, vault sync and the
assistant use it through cloud_worker.credentials(). The user's own Worker
token (orc-cloud configure) is never touched.

A phone signs in the same way through its own origin's /pair/github/done,
using this computer's token, and is admitted only as this computer's own
GitHub sign-in.

Settings sync carries an explicit allowlist of ~/.orc/config.json keys.
Nothing else in the file, and nothing from the Keychain, is ever sent.

stdlib-only, like the rest of ui/.
"""
import contextlib
import hashlib
import json
import os
import re
import secrets
import socket
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import keychain_secrets
import cloud_worker

CONFIG_KEY = cloud_worker.ACCOUNT_KEY
STATUS_FILE = "cloud-settings.json"
MACHINE_SECRET = cloud_worker.MACHINE_SECRET
PENDING_TTL = 10 * 60
# GET /pair asks this on every load, and a locked Keychain can take the
# security CLI's whole timeout to answer.
READY_TTL = 30
BEGIN_WINDOW = 60
BEGINS_PER_CLIENT = 5
PUSH_DELAY = 3
MAX_PENDING = 32
TOP_KEYS = ("branch", "review", "shipAction", "offerOtherShipActions", "prPushAction")
UI_KEYS = ("sounds", "eventSounds", "archiveSettledAssetsDays", "prPoll", "projectOrder",
           "statusOrder", "modelPins", "planRenewalDays", "hiddenServerProjects", "notifications")
SECTIONS = ("worktree", "ui", "repos")
# Settings that fit one computer's hardware, agents and accounts are not
# synced, so each computer keeps its own: Orchestrate's rules and presets
# (`orchestrate`), the power mode (`ui.powerMode`) and each project's
# `runsAtOnce`. An Orc that synced them left `orchestrate`,
# `orchestrateProfiles` (presets' name then) and `ui.powerMode` in the
# document; with_unknown carries them through untouched, and nothing applies
# them here.
RETURN_VIEWS = ("settings/account", "welcome")
# A leaked token must not be able to hand another computer a command to run,
# so repo keys that carry one stay on the computer that set them.
RUNS_COMMANDS = re.compile(r"script|command|install|setup|server|hook|generated", re.I)
LOCAL_REPO_KEYS = ("runsAtOnce",)
LOGIN = re.compile(r"[A-Za-z0-9-]{1,39}")
MISSING = object()


class CloudError(RuntimeError):
    pass


class LinksUnsupported(CloudError):
    """The Worker was deployed before it kept laptop-link certificates."""


class Busy(CloudError):
    """A phone sign-in refused before anything reached the Worker: this client
    began too many in the last minute, or every pending slot is taken."""


def _now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def _copy(value):
    return json.loads(json.dumps(value))


def _section(config, key):
    value = config.get(key) if isinstance(config, dict) else None
    return value if isinstance(value, dict) else {}


def _stays_here(name):
    """A repo key that never leaves the computer that set it."""
    return name in LOCAL_REPO_KEYS or bool(RUNS_COMMANDS.search(name))


def home_key(key):
    """A repos key that names a folder under the home folder: ~/ and at least
    one segment, none empty, . or ..."""
    if not isinstance(key, str) or not key.startswith("~/"):
        return False
    return all(part not in ("", ".", "..") for part in key[2:].split("/"))


def settings_document(config):
    """The allowlisted part of config.json that follows the GitHub account.
    Repos travel under their ~/ key, so a path means the same on each Mac."""
    config = config if isinstance(config, dict) else {}
    doc = {key: config[key] for key in TOP_KEYS if key in config}
    picked = {key: value for key, value in _section(config, "worktree").items()
              if isinstance(value, (bool, int, float, str))}
    if picked:
        doc["worktree"] = picked
    ui = _section(config, "ui")
    picked = {key: ui[key] for key in UI_KEYS if key in ui}
    if picked:
        doc["ui"] = picked
    picked = {}
    for key, value in _section(config, "repos").items():
        entry = {name: item for name, item in value.items() if not _stays_here(name)} \
            if home_key(key) and isinstance(value, dict) else None
        if entry:
            picked[key] = entry
    if picked:
        doc["repos"] = picked
    return _copy(doc)


def _flat(doc):
    """{(key,) or (section, key): value} for a settings document."""
    flat = {}
    for key, value in (doc if isinstance(doc, dict) else {}).items():
        if key in SECTIONS and isinstance(value, dict):
            flat.update({(key, name): item for name, item in value.items()})
        else:
            flat[(key,)] = value
    return flat


def _unflat(flat):
    doc = {}
    for path, value in flat.items():
        node = doc
        for part in path[:-1]:
            node = node.setdefault(part, {})
        node[path[-1]] = value
    return doc


def merge(base, local, remote):
    """A three-way merge of settings documents, key by key: a key changed on
    this computer since the last sync (base) keeps its value, and otherwise
    the remote's value is taken. Without a base, the remote wins where it has
    a value."""
    here, there = _flat(settings_document(local)), _flat(settings_document(remote))
    if base is None:
        return _unflat({**here, **there})
    was = _flat(settings_document(base))
    merged = {}
    for path in set(here) | set(there):
        mine = here.get(path, MISSING)
        unchanged = mine == was.get(path, MISSING)
        value = there.get(path, MISSING) if unchanged else mine
        if value is not MISSING:
            merged[path] = value
    return _unflat(merged)


def with_unknown(doc, remote):
    """doc plus the remote's top-level and ui keys this version does not
    sync, unchanged, so a push from an older Orc keeps a newer one's keys."""
    out = _copy(doc)
    for key, value in (remote if isinstance(remote, dict) else {}).items():
        if key not in TOP_KEYS and key not in SECTIONS:
            out[key] = value
    extra = {key: value for key, value in _section(remote, "ui").items() if key not in UI_KEYS}
    if extra:
        out["ui"] = {**extra, **out.get("ui", {})}
    return out


def _set(mapping, key, value):
    if value is MISSING:
        mapping.pop(key, None)
    else:
        mapping[key] = value


def _put(config, path, value):
    if len(path) == 1:
        return _set(config, path[0], value)
    section = dict(_section(config, path[0]))
    if path[0] == "repos" and value is not MISSING:
        old = section.get(path[1]) if isinstance(section.get(path[1]), dict) else {}
        value = {**{name: item for name, item in old.items() if _stays_here(name)}, **value}
    _set(section, path[1], value)
    config[path[0]] = section


def apply_document(config, doc, removed=()):
    """config with the synced keys from doc laid over it and the synced
    paths in removed taken out, a removed repo whole. Every other key, every
    repo this computer has that the document lacks, and the commands of each
    repo the document updates are kept, with its other keys that stay here."""
    config = _copy(config if isinstance(config, dict) else {})
    for path, value in _flat(settings_document(doc)).items():
        _put(config, path, value)
    for path in removed:
        _put(config, path, MISSING)
    return config


def _without_base(state):
    """A sync state that keeps its last outcome but no Worker's history."""
    return {key: value for key, value in state.items() if key not in ("revision", "base", "url")}


def machine_name():
    name = socket.gethostname().strip()
    return re.sub(r"\.local$", "", name)[:80] or "Computer"


class Cloud:
    def __init__(self, config_dir, update_config, keychain=keychain_secrets,
                 call=cloud_worker.request, applied=None):
        self.config_dir = Path(config_dir)
        self.update_config = update_config
        self.keychain, self.call = keychain, call
        self.applied = applied
        self.local = threading.local()
        self.lock = threading.Lock()
        self.sync_lock = threading.Lock()
        # Held by sync, by every local sign-out and by a sign-in's Keychain
        # and config writes, so none of them interleave: no sync pushes after
        # the local sign-out drops cloudAccount, and a 401 cannot undo half of
        # a re-sign-in.
        self.account_lock = threading.RLock()
        self.machine_pending = None
        self.device_pending = {}
        self.ready_cache = (None, 0.0)
        self.begins = {}
        self.timer = None
        self.last_error = None

    # ---------- state ----------

    def config(self):
        return cloud_worker.read_config(self.config_dir)

    def url(self):
        return cloud_worker.url(self.config_dir)

    def account(self):
        value = self.config().get(CONFIG_KEY)
        return value if isinstance(value, dict) and isinstance(value.get("login"), str) else None

    def ready(self):
        """Signed in with a token to sign phones in with."""
        with self.lock:
            value, until = self.ready_cache
            if until > time.time():
                return value
        try:
            value = bool(self._base() and self._token())
        except CloudError:
            value = False
        with self.lock:
            self.ready_cache = (value, time.time() + READY_TTL)
        return value

    def _forget_caches(self):
        with self.lock:
            self.ready_cache = (None, 0.0)

    def _write(self, transform):
        """update_config for Cloud's own writes, which schedule no push."""
        self.local.applying = True
        try:
            self.update_config(transform)
        finally:
            self.local.applying = False

    def _sync_state(self):
        try:
            value = json.loads((self.config_dir / STATUS_FILE).read_text())
        except (OSError, ValueError):
            return {}
        return value if isinstance(value, dict) else {}

    def _save_sync_state(self, state):
        self.config_dir.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.config_dir, prefix="." + STATUS_FILE + ".")
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump(state, stream)
            os.replace(tmp, self.config_dir / STATUS_FILE)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def status(self):
        account = self.account()
        sync = self._sync_state()
        return {
            "configured": self.url() is not None, "url": self.url(),
            "signedIn": account is not None, "login": (account or {}).get("login"),
            "machineId": (account or {}).get("machineId"),
            "lastSync": {key: sync.get(key) for key in ("ok", "at", "error", "revision", "summary")} if sync else None,
            "error": self.last_error,
        }

    def _token(self):
        token = None
        if self.account():
            try:
                token = self.keychain.read(MACHINE_SECRET)
            except (OSError, keychain_secrets.SecretError):
                pass
        if not token:
            raise CloudError("Sign this computer in with GitHub first.")
        return token

    def _base(self):
        """The Worker this computer signed in to: the only one its machine
        token may be sent to."""
        found = (self.account() or {}).get("url")
        if not isinstance(found, str) or not cloud_worker.URL.fullmatch(found):
            raise CloudError("Sign this computer in with GitHub first.")
        return found.rstrip("/")

    def _request(self, base, token, method, path, payload=None):
        try:
            return self.call(base, token, method, path, payload)
        except cloud_worker.WorkerError as exc:
            raise CloudError(str(exc)) from exc

    def _remember(self, error):
        self.last_error = error
        return error

    def _bearer(self, method, path, payload=None):
        """A Worker call with this computer's token. A 401 signs this
        computer out here too, but only while the token it sent is still the
        one in the Keychain: another computer revoked this sign-in, not an
        earlier one."""
        token = self._token()
        try:
            return self._request(self._base(), token, method, path, payload)
        except CloudError as exc:
            if "HTTP 401" not in str(exc):
                raise
            with self.account_lock:
                if not self.account():
                    raise
                try:
                    current = self.keychain.read(MACHINE_SECRET)
                except (OSError, keychain_secrets.SecretError):
                    current = None
                if current != token:
                    raise
                self._sign_out_here()
            raise CloudError(self._remember(
                "This computer was signed out of GitHub elsewhere. Sign in again to keep syncing.")) from exc

    # ---------- this computer ----------

    def begin_machine(self, return_url, worker_url=None, view=RETURN_VIEWS[0]):
        base = (worker_url or "").strip().rstrip("/") or self.url()
        if not base or not cloud_worker.URL.fullmatch(base):
            raise CloudError("Use your Worker's https:// address.")
        nonce = secrets.token_urlsafe(32)
        try:
            answer = self._request(base, "", "POST", "/v1/auth/github/begin", {
                "purpose": "machine", "returnUrl": return_url, "nonce": nonce, "machineName": machine_name()})
        except CloudError as exc:
            raise CloudError(self._remember(str(exc))) from exc
        if not isinstance(answer, dict) or not str(answer.get("authorizeUrl", "")).startswith("https://github.com/"):
            raise CloudError(self._remember("The Worker sent an unreadable answer."))
        with self.lock:
            self.machine_pending = (nonce, base, time.time() + PENDING_TTL,
                                    view if view in RETURN_VIEWS else RETURN_VIEWS[0])
        self.last_error = None
        return answer["authorizeUrl"]

    def return_view(self):
        """The view the pending computer sign-in began from."""
        with self.lock:
            return self.machine_pending[3] if self.machine_pending else RETURN_VIEWS[0]

    def finish_machine(self, ticket):
        if not isinstance(ticket, str) or not ticket:
            raise CloudError(self._remember("GitHub did not finish the sign-in."))
        with self.lock:
            pending = self.machine_pending
        if not pending or pending[2] < time.time():
            raise CloudError(self._remember("This sign-in expired. Start it again from Settings."))
        nonce, base = pending[:2]
        # An unreadable Keychain stops here, before the Worker mints a machine.
        self.keychain.read(MACHINE_SECRET)
        answer = self._request(base, "", "POST", "/v1/auth/ticket/redeem",
                               {"ticket": ticket, "nonce": nonce, "purpose": "machine"})
        with self.lock:
            if self.machine_pending is pending:
                self.machine_pending = None
        login, machine, token = (answer.get(key) if isinstance(answer, dict) else None
                                 for key in ("login", "machineId", "machineToken"))
        if not (isinstance(login, str) and LOGIN.fullmatch(login) and isinstance(machine, str)
                and isinstance(token, str) and len(token) >= 32):
            raise CloudError(self._remember("The Worker sent an unreadable answer."))
        # sync is called after the lock is released: it takes sync_lock first.
        failure = None
        with self.account_lock:
            account = self.account()
            try:
                old_base = self._base()
            except CloudError:
                old_base = None

            def signed_in(config):
                config[CONFIG_KEY] = {"login": login, "machineId": machine, "url": base}
                return config
            try:
                previous = self.keychain.read(MACHINE_SECRET)
            except (OSError, keychain_secrets.SecretError) as exc:
                failure = exc
            else:
                try:
                    self.keychain.save(MACHINE_SECRET, token)
                    self.keychain.remember(str(self.config_dir), MACHINE_SECRET)
                    self._write(signed_in)
                except Exception as exc:
                    # A write can land and still raise; config.json then names
                    # the new machine and the Keychain must keep its token.
                    if (self.account() or {}).get("machineId") != machine:
                        self._roll_back_sign_in(account and previous)
                        failure = exc
            self._forget_caches()
        if failure:
            with contextlib.suppress(CloudError, OSError):
                self._request(base, token, "DELETE", "/v1/machines/" + machine)
            raise failure
        self.last_error = None
        old_machine = (account or {}).get("machineId")
        if old_machine and old_machine != machine and previous and old_base:
            with contextlib.suppress(CloudError, OSError):
                self._request(old_base, previous, "DELETE", "/v1/machines/" + old_machine)
        self.sync()
        return login

    def _roll_back_sign_in(self, previous):
        """Gives the machine token item back to the sign-in still on disk,
        or empties it when there is none."""
        with contextlib.suppress(OSError, keychain_secrets.SecretError):
            if previous:
                self.keychain.save(MACHINE_SECRET, previous)
            else:
                self.keychain.delete(MACHINE_SECRET)
                self.keychain.forget(str(self.config_dir), MACHINE_SECRET)

    def sign_out(self):
        """Signs this computer out here whatever the Worker or the Keychain
        answers; a revoke that did not reach the Worker comes back as a
        warning."""
        account = self.account()
        if not account:
            return dict(self.status(), warning=None)
        warning = None
        if account.get("machineId"):
            try:
                self._request(self._base(), self._token(), "DELETE", "/v1/machines/" + account["machineId"])
            except (CloudError, keychain_secrets.SecretError, OSError) as exc:
                if "HTTP 401" not in str(exc) and "HTTP 404" not in str(exc):
                    warning = ("Signed out here, but the Worker could not revoke this computer (%s). "
                               "Sign it out from Connected devices on another computer." % exc)
        with self.account_lock:
            self._sign_out_here()
        self.last_error = None
        return dict(self.status(), warning=warning)

    def _sign_out_here(self):
        """The local half of sign-out: forget the account, its sync base and
        its token. A token left behind by a Keychain failure is never sent
        again: credentials(), _token() and _base() all need the account.
        Call it under account_lock."""
        if not self.account():
            return

        def signed_out(config):
            config.pop(CONFIG_KEY, None)
            return config
        self._write(signed_out)
        self._forget_caches()
        with contextlib.suppress(OSError):
            self._save_sync_state(_without_base(self._sync_state()))
        with contextlib.suppress(OSError, keychain_secrets.SecretError):
            self.keychain.delete(MACHINE_SECRET)
            self.keychain.forget(str(self.config_dir), MACHINE_SECRET)

    def machines(self):
        answer = self._bearer("GET", "/v1/machines")
        rows = answer.get("machines") if isinstance(answer, dict) else None
        if not isinstance(rows, list):
            raise CloudError("The Worker sent an unreadable answer.")
        own = (self.account() or {}).get("machineId") or answer.get("current")
        return [{**row, "kind": "computer", "thisDevice": row.get("id") == own,
                 # The Worker counts in milliseconds; device sessions in seconds.
                 "lastSeenAt": (row.get("lastSeenAt") or 0) / 1000 or None,
                 "createdAt": (row.get("createdAt") or 0) / 1000 or None}
                for row in rows if isinstance(row, dict)]

    def revoke_machine(self, machine_id):
        if machine_id == (self.account() or {}).get("machineId"):
            return self.sign_out()
        if not isinstance(machine_id, str) or not re.fullmatch(r"[a-f0-9]{32}", machine_id):
            raise CloudError("Unknown computer.")
        self._bearer("DELETE", "/v1/machines/" + machine_id)
        return self.status()

    # ---------- linked laptops ----------

    def _links(self, method, path, payload=None):
        try:
            return self._bearer(method, path, payload)
        except CloudError as exc:
            if "HTTP 404" in str(exc):
                raise LinksUnsupported(
                    "Your Worker can't link laptops by GitHub account yet. Run its schema.sql again and redeploy it.") from exc
            raise

    def publish_link(self, cert, name):
        """Shows this computer's laptop-link certificate to the other
        computers signed in with the same GitHub login."""
        self._links("PUT", "/v1/machines/link", {"cert": cert, "name": name})

    def link_machines(self):
        """The other computers on this GitHub login that published a
        laptop-link certificate: [{machineId, name, cert}]."""
        answer = self._links("GET", "/v1/machines/links")
        rows = answer.get("links") if isinstance(answer, dict) else None
        if not isinstance(rows, list):
            raise CloudError("The Worker sent an unreadable answer.")
        own = (self.account() or {}).get("machineId") or answer.get("current")
        return [{"machineId": row.get("machineId"), "name": str(row.get("name") or ""), "cert": row["cert"]}
                for row in rows
                if isinstance(row, dict) and isinstance(row.get("cert"), str) and row.get("machineId") != own]

    # ---------- phones ----------

    def _room(self, now):
        self.device_pending = {key: value for key, value in self.device_pending.items() if value[1] > now}
        if len(self.device_pending) >= MAX_PENDING:
            raise Busy("Too many sign-ins are waiting. Try again in a few minutes, or enter a pairing code.")

    def begin_device(self, origin, return_to, client=""):
        """The GitHub address for a phone, and the nonce its pending cookie
        holds. The ticket only redeems with that nonce, so a sign-in started
        in one browser cannot finish in another. Anyone on the network can
        ask, so each client gets a few a minute and a full table refuses new
        ones rather than dropping a sign-in under way."""
        now = time.time()
        with self.lock:
            self.begins = {key: [at for at in times if at > now - BEGIN_WINDOW]
                           for key, times in self.begins.items()}
            self.begins = {key: times for key, times in self.begins.items() if times}
            if len(self.begins.get(client, ())) >= BEGINS_PER_CLIENT:
                raise Busy("Too many sign-ins from this device. Wait a minute, or enter a pairing code.")
            self._room(now)
            self.begins.setdefault(client, []).append(now)
            nonce = secrets.token_urlsafe(32)
            self.device_pending[_digest(nonce)] = (return_to, now + PENDING_TTL)
        try:
            answer = self._bearer("POST", "/v1/auth/github/begin", {
                "purpose": "device", "returnUrl": origin.rstrip("/") + "/pair/github/done", "nonce": nonce})
            url = answer.get("authorizeUrl") if isinstance(answer, dict) else None
            if not isinstance(url, str) or not url.startswith("https://github.com/"):
                raise CloudError("The Worker sent an unreadable answer.")
        except BaseException:
            with self.lock:
                self.device_pending.pop(_digest(nonce), None)
            raise
        return nonce, url

    def finish_device(self, nonce, ticket):
        """(login, return_to) once the ticket proves this computer's own
        GitHub login, and only while this computer stays signed in as it."""
        with self.lock:
            pending = self.device_pending.pop(_digest(nonce), None) if isinstance(nonce, str) and nonce else None
        if not pending or pending[1] < time.time():
            raise CloudError("This sign-in expired or began in another browser. Start it again.")
        if not isinstance(ticket, str) or not ticket:
            raise CloudError("GitHub did not finish the sign-in.")
        owner = (self.account() or {}).get("login")
        if not owner:
            raise CloudError("Sign this computer in with GitHub first.")
        answer = self._bearer("POST", "/v1/auth/ticket/redeem",
                              {"ticket": ticket, "nonce": nonce, "purpose": "device"})
        if (self.account() or {}).get("login") != owner:
            raise CloudError("This computer signed out of GitHub. Sign it in again, or enter a pairing code.")
        login = answer.get("login") if isinstance(answer, dict) else None
        if not isinstance(login, str) or login.lower() != owner.lower():
            raise CloudError("%s is not the GitHub account that owns this Orc." % (login or "That account"))
        return login, pending[0]

    # ---------- settings ----------

    def _merge_once(self, record):
        remote = self._bearer("GET", "/v1/settings")
        remote = remote if isinstance(remote, dict) else {}
        revision, body = remote.get("revision"), remote.get("body")
        if type(revision) is not int or not isinstance(body, (dict, type(None))):
            raise CloudError("The Worker sent an unreadable answer.")
        local = settings_document(self.config())
        if body is None:
            merged = local
        else:
            # A revision behind the last one synced is a fresh Worker database,
            # not this computer's history.
            last = record.get("revision")
            known = type(last) is int and revision >= last and record.get("url") == self.url()
            merged = merge(record.get("base") if known else None, local, body)
        pulled = merged != local
        if pulled:
            self._apply(merged, [path for path in _flat(local) if path not in _flat(merged)])
        if body is not None:
            record.update(revision=revision, base=body, url=self.url())
        pushed = with_unknown(merged, body)
        if merged == settings_document(body):
            return "pulled" if pulled else "current"
        saved = self._bearer("PUT", "/v1/settings", {"revision": revision, "body": pushed})
        saved = saved.get("revision") if isinstance(saved, dict) else None
        record.update(revision=saved if type(saved) is int else revision + 1, base=pushed, url=self.url())
        return "merged" if pulled else "pushed"

    def _apply(self, doc, removed):
        seen = {}

        def transform(config):
            seen["before"] = _copy(config)
            seen["after"] = apply_document(config, doc, removed)
            return seen["after"]
        self._write(transform)
        if self.applied and "after" in seen:
            self.applied(seen["before"], seen["after"])

    def sync(self):
        """Merges the remote document with this computer's settings key by
        key against the last one synced, applies the result here and pushes
        it whenever it differs from the remote, so a push that failed earlier
        goes out on the next sync. Another computer's push in between is
        merged once more. Records the outcome rather than raising."""
        if not self.account():
            return None
        with self.sync_lock, self.account_lock:
            if not self.account():
                return None
            record = dict(self._sync_state(), at=_now_iso())
            try:
                try:
                    summary = self._merge_once(record)
                except CloudError as exc:
                    if "HTTP 409" not in str(exc):
                        raise
                    summary = self._merge_once(record)
            except (CloudError, keychain_secrets.SecretError, OSError) as exc:
                record.update(ok=False, error=str(exc))
            else:
                record.update(ok=True, error=None, summary=summary)
            if not self.account():
                record = _without_base(record)
            with contextlib.suppress(OSError):
                self._save_sync_state(record)
            return record

    def schedule_push(self, config=None):
        """Pushes soon after a config write that changed a synced key."""
        if getattr(self.local, "applying", False) or not self.account():
            return
        if config is not None and settings_document(config) == settings_document(self._sync_state().get("base")):
            return
        with self.lock:
            if self.timer:
                self.timer.cancel()
            self.timer = threading.Timer(PUSH_DELAY, self.sync)
            self.timer.daemon = True
            self.timer.start()

    def start_pull(self):
        if self.account() and not self.sync_lock.locked():
            threading.Thread(target=self.sync, daemon=True).start()
