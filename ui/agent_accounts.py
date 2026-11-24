"""Claude Code, Codex and Gemini accounts, as each CLI reports its own sign-in.

One row per config folder: every Claude login from ``claude_accounts``, the
one Codex home, and Gemini's while agy is signed in. Claude Code and Codex are
asked who is signed in (``claude auth status --json`` and ``codex login
status``). Gemini's row comes from ``harnesses.signed_in``, which only asks
whether agy's Keychain item exists; no token is read from the Keychain, and
the only token file read is the Codex ID token ``provider_usage`` already
decodes. Orc does not sign Gemini in or out: agy has no command for it.

stdlib-only, like the rest of ui/.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import claude_accounts
import harnesses
import provider_usage
import windows_host

CACHE_FILE = "agent-accounts.json"
NAMES_FILE = "agent-account-names.json"
NAME_MAX = 40
FRESH_SECONDS = 5 * 60
PROBE_TIMEOUT = 15
SIGN_IN_WAIT = 5 * 60
SIGN_IN_POLL = 3
NUMBER_WORDS = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9}
WORD_NUMBERS = {number: word for word, number in NUMBER_WORDS.items()}
PLAN_WORDS = {"max": "Max", "pro": "Pro", "team": "Team", "enterprise": "Enterprise", "plus": "Plus",
              "free": "Free", "business": "Business", "edu": "Edu"}
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


class AccountError(ValueError):
    pass


def label(provider, account):
    """"Claude" for ~/.claude, "Claude 2" for ~/.claude-two, "Codex"."""
    if provider == "codex":
        return "Codex"
    if account == claude_accounts.DEFAULT:
        return "Claude"
    suffix = account[len(".claude-"):]
    return "Claude %s" % NUMBER_WORDS.get(suffix.lower(), suffix)


def plan_label(value):
    """``max_20x`` reads "Max 20x"; ``pro`` reads "Pro"."""
    if not isinstance(value, str) or not value.strip():
        return None
    words = [part for part in re.split(r"[_\s-]+", value.strip().lower()) if part]
    return " ".join(PLAN_WORDS.get(word, word if re.fullmatch(r"\d+x", word) else word.capitalize())
                    for word in words) or None


def _short(text):
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    return (lines[-1] if lines else "")[:200]


def _run(command, env, run):
    try:
        result = run(command, env=env, capture_output=True, text=True,
                     stdin=subprocess.DEVNULL, timeout=PROBE_TIMEOUT)
    except FileNotFoundError:
        return None
    except subprocess.TimeoutExpired:
        return "timeout"
    except OSError as exc:
        return exc
    return result


def _claude_env(account, home):
    """The default login runs with no CLAUDE_CONFIG_DIR, even an inherited
    one: CLAUDE_CONFIG_DIR=~/.claude makes Claude Code treat it as a fresh
    install (see claude_accounts)."""
    env = dict(os.environ)
    env.pop("CLAUDE_CONFIG_DIR", None)
    if account != claude_accounts.DEFAULT:
        env["CLAUDE_CONFIG_DIR"] = str(Path(home) / account)
    return env


def _row(provider, account, state, **extra):
    row = {"provider": provider, "account": account, "label": label(provider, account), "state": state,
           "email": None, "plan": None, "org": None, "expiresAt": None, "detail": None}
    row.update(extra)
    return row


def probe_claude(account, home=None, run=subprocess.run, which=shutil.which):
    home = Path(home) if home else Path.home()
    binary = which("claude")
    if not binary:
        return _row("claude", account, "missing", detail="Install Claude Code to use this account.")
    result = _run([binary, "auth", "status", "--json"], _claude_env(account, home), run)
    if result is None:
        return _row("claude", account, "missing", detail="Install Claude Code to use this account.")
    if result == "timeout":
        return _row("claude", account, "error", detail="claude auth status timed out.")
    if isinstance(result, OSError):
        return _row("claude", account, "error", detail=str(result)[:200])
    try:
        status = json.loads(result.stdout or "")
    except ValueError:
        status = None
    if not isinstance(status, dict):
        return _row("claude", account, "error",
                    detail=_short(result.stderr) or _short(result.stdout) or "claude auth status gave no answer.")
    if status.get("loggedIn") is not True:
        return _row("claude", account, "signin")
    def text(key):
        value = status.get(key)
        return value if isinstance(value, str) and value else None
    return _row("claude", account, "ready", email=text("email"),
                plan=plan_label(text("planTier") or text("subscriptionType")),
                org=text("orgName"), expiresAt=text("loginExpiresAt"))


def probe_codex(run=subprocess.run, which=shutil.which, claims=None):
    binary = which("codex")
    if not binary:
        return _row("codex", ".codex", "missing", detail="Install the Codex CLI to use Codex.")
    result = _run([binary, "login", "status"], dict(os.environ), run)
    if result is None:
        return _row("codex", ".codex", "missing", detail="Install the Codex CLI to use Codex.")
    if result == "timeout":
        return _row("codex", ".codex", "error", detail="codex login status timed out.")
    if isinstance(result, OSError):
        return _row("codex", ".codex", "error", detail=str(result)[:200])
    output = "%s\n%s" % (result.stdout or "", result.stderr or "")
    if re.search(r"not logged in", output, re.I):
        return _row("codex", ".codex", "signin")
    # An API-key sign-in prints "API key configured", with no "logged in".
    if result.returncode != 0 or not re.search(r"logged in|api key configured", output, re.I):
        return _row("codex", ".codex", "error", detail=_short(output) or "codex login status failed.")
    claims = provider_usage._codex_sign_in() if claims is None else claims
    auth = claims.get("https://api.openai.com/auth")
    plan = plan_label(auth.get("chatgpt_plan_type") if isinstance(auth, dict) else None)
    if plan is None and re.search(r"api key", output, re.I):
        plan = "API key"
    return _row("codex", ".codex", "ready", email=provider_usage.email("codex"), plan=plan)


def _now():
    return time.time()


class Accounts:
    """The probed rows, cached in memory for five minutes and on disk so the
    first paint after a restart needs no CLI call."""

    def __init__(self, config_dir, home=None, run=subprocess.run, which=shutil.which,
                 launch=None, platform=sys.platform):
        self.config_dir = Path(config_dir)
        self.home = Path(home) if home else None
        self.run, self.which, self.platform = run, which, platform
        self.launch = launch or self._launch
        self.lock = threading.Lock()
        self.actions = threading.RLock()
        self.rows, self.checked = None, 0.0
        self.refreshing = False
        self.pending = set()
        self.signing_in = {}

    def _home(self):
        return self.home or Path.home()

    def folders(self):
        names = claude_accounts.available(self._home())
        with self.lock:
            extra = sorted(name for name in self.pending if name not in names)
        return [("claude", name) for name in names + extra] + [("codex", ".codex")]

    def probe(self, provider, account):
        if provider == "codex":
            return probe_codex(self.run, self.which)
        return probe_claude(account, self._home(), self.run, self.which)

    def _disk(self):
        try:
            data = json.loads((self.config_dir / CACHE_FILE).read_text())
        except (OSError, ValueError):
            return None
        rows = data.get("accounts") if isinstance(data, dict) else None
        return rows if isinstance(rows, list) else None

    def _write(self, name, data):
        self.config_dir.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.config_dir, prefix="." + name + ".")
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump(data, stream)
            os.replace(tmp, self.config_dir / name)
        except OSError:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise

    def _save(self, rows, checked):
        try:
            self._write(CACHE_FILE, {"checkedAt": checked, "accounts": rows})
        except OSError:
            pass

    def names(self):
        """The names the user gave accounts, keyed ``provider:account``."""
        try:
            data = json.loads((self.config_dir / NAMES_FILE).read_text())
        except (OSError, ValueError):
            return {}
        if not isinstance(data, dict):
            return {}
        return {key: value for key, value in data.items() if isinstance(value, str) and value}

    def claude_names(self):
        """Each Claude folder's name as Settings shows it: the user's, else its label."""
        names = self.names()
        return {account: names.get("claude:%s" % account) or label("claude", account)
                for account in claude_accounts.available(self._home())}

    def name_usage(self, providers):
        """Adds ``name`` to each usage row whose account the user renamed."""
        names = self.names()
        for row in providers:
            name = names.get("%s:%s" % (row.get("provider"), row.get("account") or "." + str(row.get("provider"))))
            if name:
                row["name"] = name
        return providers

    def rename(self, provider, account, name):
        """An empty name returns the account to its folder's label."""
        with self.actions:
            if not isinstance(provider, str) or not isinstance(account, str) or (provider, account) not in self.folders():
                raise AccountError("Unknown account.")
            if not isinstance(name, str):
                raise AccountError("Name the account with text.")
            name = " ".join(name.split())
            if len(name) > NAME_MAX:
                raise AccountError("Keep the name to %d characters or fewer." % NAME_MAX)
            names, key = self.names(), "%s:%s" % (provider, account)
            names.pop(key, None)
            if name and name != label(provider, account):
                taken = {(names.get("%s:%s" % folder) or label(*folder)).casefold()
                         for folder in self.folders() if folder != (provider, account)}
                if name.casefold() in taken:
                    raise AccountError("Another account already uses that name.")
                names[key] = name
            self._write(NAMES_FILE, names)

    def refresh(self):
        with self.actions:
            return self._refresh()

    def _refresh(self):
        folders = self.folders()
        with ThreadPoolExecutor(max_workers=max(1, len(folders))) as pool:
            rows = list(pool.map(lambda folder: self.probe(*folder), folders))
        checked = _now()
        with self.lock:
            self.rows, self.checked = rows, checked
            for row in rows:
                if row["state"] == "ready":
                    self.pending.discard(row["account"])
        self._save(rows, checked)
        return rows

    def _background(self):
        try:
            self.refresh()
        finally:
            with self.lock:
                self.refreshing = False

    def snapshot(self, refresh=False, probe=True):
        """probe=False serves what is cached and never starts a CLI."""
        if refresh and probe:
            rows = self.refresh()
        else:
            with self.lock:
                rows, fresh = self.rows, self.rows is not None and _now() - self.checked < FRESH_SECONDS
                start = probe and not fresh and not self.refreshing
                if start:
                    self.refreshing = True
            if start:
                threading.Thread(target=self._background, daemon=True).start()
            rows = rows if rows is not None else self._disk() or []
        folders = self.folders()
        known = {(row.get("provider"), row.get("account")) for row in rows}
        rows = [row for row in rows if (row.get("provider"), row.get("account")) in folders]
        rows = rows + [_row(provider, account, "checking") for provider, account in folders
                       if (provider, account) not in known]
        order = {folder: index for index, folder in enumerate(folders)}
        rows.sort(key=lambda row: order.get((row.get("provider"), row.get("account")), len(order)))
        with self.lock:
            signing = {key for key, until in self.signing_in.items() if until > _now()}
            refreshing = self.refreshing
        names = self.names()

        def named(provider, account):
            default = label(provider, account)
            custom = names.get("%s:%s" % (provider, account))
            return {"label": custom or default, "defaultLabel": default, "renamed": bool(custom)}

        rows = [dict(row, signingIn=(row.get("provider"), row.get("account")) in signing,
                     **named(row.get("provider"), row.get("account"))) for row in rows]
        # Gemini's row has no folder Orc manages, so rename, sign-in and the
        # other actions, which accept only folders(), refuse it.
        if harnesses.signed_in("gemini", refresh=refresh) if probe else harnesses.last_sign_in("gemini"):
            rows.append({"provider": "gemini", "account": ".gemini", "state": "ready", "builtin": True,
                         "label": "Gemini", "defaultLabel": "Gemini", "renamed": False, "signingIn": False})
        listed = {account for provider, account in folders if provider == "claude"}
        removed = [{"provider": "claude", "account": account, "label": named("claude", account)["label"]}
                   for account in claude_accounts.available(self._home(), include_removed=True)
                   if account not in listed]
        return {"accounts": rows, "removed": removed, "refreshing": refreshing,
                "anyReady": any(row.get("state") == "ready" for row in rows)}

    def _command(self, provider, account):
        """The login command and the whole environment it runs with."""
        if provider == "codex":
            binary = self.which("codex")
            return ([binary, "login"] if binary else None), dict(os.environ)
        binary = self.which("claude")
        return ([binary, "auth", "login"] if binary else None), _claude_env(account, self._home())

    def _launch(self, provider, account, command, env):
        """Starts the login and returns a call that is true once it has ended."""
        # Codex finishes its login through the browser on its own. Claude Code
        # may ask to paste a code back, so it runs where the user can type.
        if (provider == "codex" or self.platform != "darwin") and not windows_host.WSL:
            process = subprocess.Popen(command, env=env, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            return lambda: process.poll() is not None
        folder = self.config_dir / "agent-login"
        folder.mkdir(parents=True, exist_ok=True)
        script = folder / ("%s.command" % account.lstrip("."))
        ended = folder / ("%s.ended" % account.lstrip("."))
        ended.unlink(missing_ok=True)
        # Terminal starts the script from a fresh login shell, not from env.
        config_dir = env.get("CLAUDE_CONFIG_DIR")
        lines = ["#!/bin/sh", "export CLAUDE_CONFIG_DIR=%s" % _sh(config_dir) if config_dir
                 else "unset CLAUDE_CONFIG_DIR"]
        # Terminal's own process outlives the login, so the script leaves a
        # file when the login ends, a closed window included.
        lines += ["ended=%s" % _sh(ended), """trap 'touch "$ended"' EXIT HUP INT TERM"""]
        if windows_host.WSL:
            lines.append("export PATH=" + _sh(env.get("PATH", os.defpath)))
            lines.append("export BROWSER=" + _sh(str(Path(windows_host.__file__).resolve())))
        lines.append(" ".join(_sh(part) for part in command))
        script.write_text("\n".join(lines) + "\n")
        script.chmod(0o700)
        if windows_host.WSL:
            arguments = subprocess.list2cmdline(["-d", os.environ["WSL_DISTRO_NAME"], "--exec", "/bin/sh", str(script)])
            result = windows_host.powershell("Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/wsl.exe') "
                                             "-ArgumentList ([Text.Encoding]::UTF8.GetString($data))", arguments.encode())
            if result.returncode:
                raise OSError("Windows could not open the Ubuntu login terminal.")
        else:
            subprocess.Popen(["open", "-a", "Terminal", str(script)], stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return ended.exists

    def _unused_folder(self, account):
        """True for ~/.claude-<slug> made by an add whose login never finished."""
        if not (isinstance(account, str) and account.startswith(".claude-")
                and SLUG.fullmatch(account[len(".claude-"):])):
            return False
        folder = self._home() / account
        return folder.is_dir() and not folder.is_symlink() and not (folder / ".claude.json").exists()

    def sign_in(self, provider, account):
        with self.actions:
            return self._sign_in(provider, account)

    def _sign_in(self, provider, account):
        if provider == "codex":
            account = ".codex"
        elif provider != "claude" or not (
                account in [name for kind, name in self.folders() if kind == "claude"]
                or self._unused_folder(account)):
            raise AccountError("Unknown account.")
        started, key = {"provider": provider, "account": account}, (provider, account)
        with self.lock:
            if self.signing_in.get(key, 0) > _now():
                return started
            self.signing_in[key] = _now() + SIGN_IN_WAIT
            rows = self.rows
        # The CLI reports a reconnected login as signed in from the start, so
        # only the end of the login process shows that it finished.
        reconnect = any((row.get("provider"), row.get("account")) == key and row.get("state") == "ready"
                        for row in (rows if rows is not None else self._disk() or []))
        try:
            command, env = self._command(provider, account)
            if not command:
                raise AccountError("Install the %s CLI first." % ("Codex" if provider == "codex" else "Claude Code"))
            if provider == "claude" and account != claude_accounts.DEFAULT:
                with self.lock:
                    self.pending.add(account)
            ended = self.launch(provider, account, command, env)
        except BaseException:
            with self.lock:
                self.signing_in.pop(key, None)
            raise
        threading.Thread(target=self._wait, args=(provider, account, ended, reconnect), daemon=True).start()
        return started

    def _action_target(self, provider, account):
        if not isinstance(provider, str) or not isinstance(account, str) or (provider, account) not in self.folders():
            raise AccountError("Unknown account.")
        if provider == "claude" and (self._home() / account).is_symlink():
            raise AccountError("Manage linked account folders outside Orc.")
        with self.lock:
            if self.signing_in.get((provider, account), 0) > _now():
                raise AccountError("Finish signing in before changing this account.")

    def _logout(self, provider, account):
        command, env = self._command(provider, account)
        if not command:
            raise AccountError("Install the agent CLI before disconnecting.")
        command[-1] = "logout"
        result = _run(command, env, self.run)
        if result is None or result == "timeout" or isinstance(result, OSError):
            raise AccountError("Could not disconnect. Check the CLI and try again.")
        if result.returncode:
            raise AccountError("Could not disconnect. Sign out through the agent CLI and try again.")

    def disconnect(self, provider, account):
        with self.actions:
            self._action_target(provider, account)
            self._logout(provider, account)
            with self.lock:
                rows = [row for row in self.rows or []
                        if (row["provider"], row["account"]) != (provider, account)]
                rows.append(_row(provider, account, "signin"))
                self.rows, self.checked = rows, _now()
            self._save(rows, self.checked)

    def remove(self, provider, account):
        with self.actions:
            self._action_target(provider, account)
            if provider != "claude" or account == claude_accounts.DEFAULT:
                raise AccountError("Only extra Claude accounts can be removed. Use Disconnect to sign out.")
            marker = self._home() / account / claude_accounts.REMOVED
            descriptor = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(descriptor)
            with self.lock:
                self.pending.discard(account)
                self.rows = [row for row in self.rows or []
                             if (row["provider"], row["account"]) != (provider, account)]
            self._save(self.rows, self.checked)

    def _removed_marker(self, provider, account):
        home = self._home()
        if (provider != "claude" or not isinstance(account, str)
                or account not in claude_accounts.available(home, include_removed=True)
                or account in claude_accounts.available(home)):
            raise AccountError("Unknown account.")
        marker = home / account / claude_accounts.REMOVED
        if (home / account).is_symlink() or marker.is_symlink() or not marker.is_file():
            raise AccountError("Manage linked account folders outside Orc.")
        return marker

    def restore(self, provider, account):
        """Lists a removed account again. Its login was never touched, so
        this starts no sign-in."""
        with self.actions:
            self._removed_marker(provider, account).unlink()

    def forget(self, provider, account):
        """Signs a removed account out and stops offering it to restore. The
        folder and its transcripts stay on disk."""
        with self.actions:
            marker = self._removed_marker(provider, account)
            self._logout(provider, account)
            descriptor = os.open(marker.with_name(claude_accounts.FORGOTTEN), os.O_CREAT | os.O_WRONLY, 0o600)
            os.close(descriptor)
            names = self.names()
            if names.pop("claude:%s" % account, None) is not None:
                self._write(NAMES_FILE, names)

    def _wait(self, provider, account, ended=None, reconnect=False):
        """Polls the account until its login finishes or SIGN_IN_WAIT passes.
        ``ended`` is the launcher's call that is true once the login process
        is gone; a reconnect finishes only then."""
        while True:
            with self.lock:
                if self.signing_in.get((provider, account), 0) <= _now():
                    self.signing_in.pop((provider, account), None)
                    return
            time.sleep(SIGN_IN_POLL)
            gone = bool(ended and ended())
            row = self.probe(provider, account)
            with self.lock:
                rows = list(self.rows or [])
                rows = [row if (item["provider"], item["account"]) == (provider, account) else item for item in rows]
                if (provider, account) not in [(item["provider"], item["account"]) for item in rows]:
                    rows.append(row)
                self.rows = rows
                if gone or (row["state"] == "ready" and not reconnect):
                    self.signing_in.pop((provider, account), None)
                    if row["state"] == "ready":
                        self.pending.discard(account)
                    return

    def add_claude(self, name):
        with self.actions:
            return self._add_claude(name)

    def _next_number(self):
        """The lowest number from 2 that no login folder holds, as a digit or
        a word. A folder left by an add whose login never finished is reused."""
        home, number = self._home(), 2
        while True:
            folder = ".claude-%d" % number
            word = WORD_NUMBERS.get(number)
            if not (word and os.path.lexists(home / (".claude-" + word))) and (
                    not os.path.lexists(home / folder) or self._unused_folder(folder)):
                return str(number)
            number += 1

    def _add_claude(self, name):
        """Make ~/.claude-<slug> and sign in there; no name takes the next
        free number. claude_accounts lists the folder everywhere once the
        login writes its .claude.json."""
        if name is None or (isinstance(name, str) and not name.strip()):
            name = self._next_number()
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:32].strip("-") if isinstance(name, str) else ""
        if not SLUG.fullmatch(slug):
            raise AccountError("Name the account with letters or numbers.")
        home = self._home()
        folder = home / (".claude-" + slug)
        if folder.resolve().parent != home.resolve():
            raise AccountError("That name points outside your home folder.")
        marker = folder / claude_accounts.REMOVED
        if not folder.is_symlink() and marker.is_file():
            marker.unlink()
            marker.with_name(claude_accounts.FORGOTTEN).unlink(missing_ok=True)
            with self.lock:
                self.pending.add(folder.name)
            return self.sign_in("claude", folder.name)
        if not self._unused_folder(folder.name):
            if os.path.lexists(folder):
                raise AccountError("~/.claude-%s already exists. Pick another name." % slug)
            folder.mkdir(mode=0o700)
        return self.sign_in("claude", folder.name)


def _sh(value):
    return "'" + str(value).replace("'", "'\\''") + "'"
