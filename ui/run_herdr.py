"""herdr as Orc's terminal multiplexer: one herdr session of Orc's own, a
workspace in it for each project root and each run, its TUI client on one PTY,
and its workspaces and tabs read over herdr's socket API so Orc can draw the
sidebar and the tab strip itself."""
from __future__ import annotations

import copy
import datetime
import hashlib
import json
import math
import os
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time

import run_terminal

# The run terminal's registry key for the herdr client, beside numbered shells.
HERDR_TAB = "herdr"
SESSION = "orc"
# The workspace token marking the scope Orc opened a workspace for. herdr
# cuts a token's value at 80 characters, shorter than many scopes, so the
# token is the scope's digest and the registry says which scope that is.
SCOPE_TOKEN = "orc_scope"
REFRESH_SECONDS = 10
# Orc's tab strip shows a whole label up to this; a command line can be longer.
MAX_LABEL = 40

# Orc draws the outer chrome, so herdr's sidebar goes and its tab row stays put
# on row 0 where the browser pane clips it. The `terminal` theme paints with
# the ANSI palette Orc derives from its own theme.
OVERRIDES = {
    "onboarding": False,
    "theme": {"name": "terminal", "auto_switch": False},
    "ui": {
        "sidebar_start_collapsed": True,
        "sidebar_collapsed_mode": "hidden",
        "hide_tab_bar_when_single_tab": False,
        "tab_bar_position": "top",
        "mobile_width_threshold": 0,
    },
}

TAB_EVENTS = ("tab.created", "tab.closed", "tab.focused", "tab.renamed", "tab.moved",
              "workspace.created", "workspace.closed", "workspace.focused", "workspace.renamed",
              "workspace.metadata_updated", "pane.created", "pane.closed")


class HerdrError(Exception):
    pass


class CommandUnconfirmed(HerdrError):
    """The command's tab exists but herdr never confirmed it took the command,
    which it may already be running."""

    def __init__(self, message, tab_id, pane_id):
        super().__init__(message)
        self.tab_id, self.pane_id = tab_id, pane_id


def binary(environ=None):
    """The herdr executable, or None. herdr sets HERDR_BIN_PATH in its panes,
    and Orc's test harnesses point it at nothing to keep herdr out."""
    environ = os.environ if environ is None else environ
    configured = environ.get("HERDR_BIN_PATH")
    if configured:
        return configured if os.path.isfile(configured) and os.access(configured, os.X_OK) else None
    return shutil.which("herdr", path=environ.get("PATH"))


def default_orc_dir():
    return os.path.join(os.path.expanduser("~"), ".orc")


def herdr_dir(environ=None):
    """Where herdr keeps its config and sessions."""
    environ = os.environ if environ is None else environ
    base = environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "herdr")


def session_name(orc_dir=None):
    """`orc` for the user's own Orc home. Another config dir, a preview or
    fixture server's, gets a session of its own and never drives that one."""
    home = default_orc_dir()
    if not orc_dir or os.path.realpath(orc_dir) == os.path.realpath(home):
        return SESSION
    return "%s-%s" % (SESSION, hashlib.sha1(os.path.realpath(orc_dir).encode()).hexdigest()[:8])


def run_scope(run_id):
    return "run:%s" % run_id


def project_scope(path):
    return "project:%s" % os.path.realpath(os.path.expanduser(path))


def scope_token(scope):
    return hashlib.sha1(scope.encode()).hexdigest()[:16]


def client_env(environ, config_path):
    """herdr refuses to launch inside one of its own panes, and the Orc daemon
    may itself run in one."""
    env = {key: value for key, value in environ.items() if not key.startswith("HERDR_")}
    env["HERDR_CONFIG_PATH"] = config_path
    return env


def merged_config(user):
    merged = copy.deepcopy(user) if isinstance(user, dict) else {}

    def apply(target, overrides):
        for key, value in overrides.items():
            if isinstance(value, dict):
                if not isinstance(target.get(key), dict):
                    target[key] = {}
                apply(target[key], value)
            else:
                target[key] = value

    apply(merged, OVERRIDES)
    return merged


_BARE_KEY = re.compile(r"[A-Za-z0-9_-]+")


def _toml_string(text):
    # JSON's escapes are all valid TOML; DEL is the one control JSON leaves raw.
    return json.dumps(text, ensure_ascii=False).replace("\x7f", "\\u007f")


def _toml_key(key):
    return key if _BARE_KEY.fullmatch(key) else _toml_string(key)


def _toml_value(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if math.isnan(value):
            return "nan"
        if math.isinf(value):
            return "inf" if value > 0 else "-inf"
        return repr(value)
    if isinstance(value, str):
        return _toml_string(value)
    if isinstance(value, (datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(item) for item in value) + "]"
    if isinstance(value, dict):
        if not value:
            return "{}"
        return "{ " + ", ".join("%s = %s" % (_toml_key(k), _toml_value(v)) for k, v in value.items()) + " }"
    raise TypeError("cannot write %r as TOML" % (value,))


def _table_array(value):
    return isinstance(value, list) and bool(value) and all(isinstance(item, dict) for item in value)


def _write_table(lines, path, table):
    direct = [(k, v) for k, v in table.items() if not isinstance(v, dict) and not _table_array(v)]
    for key, value in direct:
        lines.append("%s = %s" % (_toml_key(key), _toml_value(value)))
    for key, value in table.items():
        sub = path + [key]
        header = ".".join(_toml_key(part) for part in sub)
        if isinstance(value, dict):
            if not value or any(not isinstance(v, dict) and not _table_array(v) for v in value.values()):
                lines += ["", "[%s]" % header]
            _write_table(lines, sub, value)
        elif _table_array(value):
            for item in value:
                lines += ["", "[[%s]]" % header]
                _write_table(lines, sub, item)


def dumps(config):
    lines = []
    _write_table(lines, [], config)
    return "\n".join(lines).lstrip("\n") + "\n"


def write_config(orc_dir, environ=None):
    """Orc's own copy of the user's herdr config with OVERRIDES applied, so a
    herdr the user runs elsewhere keeps its sidebar and theme."""
    import tomllib
    environ = os.environ if environ is None else environ
    path = os.path.join(orc_dir, "herdr", "config.toml")
    default = os.path.join(herdr_dir(environ), "config.toml")
    source = environ.get("HERDR_CONFIG_PATH") or default
    # Inside one of Orc's own herdr panes HERDR_CONFIG_PATH names this copy.
    if os.path.realpath(source) == os.path.realpath(path):
        source = default
    try:
        with open(source, "rb") as f:
            user = tomllib.load(f)
    except (OSError, tomllib.TOMLDecodeError):
        user = {}
    text = dumps(merged_config(user))
    try:
        with open(path, encoding="utf-8") as f:
            if f.read() == text:
                return path
    except OSError:
        pass
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)
    return path


def socket_path(name):
    herdr = binary()
    if herdr:
        try:
            listed = subprocess.run([herdr, "session", "list", "--json"], capture_output=True, text=True,
                                    timeout=5, env=client_env(os.environ, ""))
            for session in json.loads(listed.stdout).get("sessions", []):
                if session.get("name") == name and session.get("socket_path"):
                    return session["socket_path"]
        except (OSError, ValueError, subprocess.TimeoutExpired, AttributeError):
            pass
    return os.path.join(herdr_dir(), "sessions", name, "herdr.sock")


def call(path, method, params=None, timeout=5):
    try:
        with socket.socket(socket.AF_UNIX) as conn:
            conn.settimeout(timeout)
            conn.connect(path)
            conn.sendall(json.dumps({"id": "orc", "method": method, "params": params or {}}).encode() + b"\n")
            line = conn.makefile("rb").readline()
    except OSError as error:
        raise HerdrError("cannot reach herdr: %s" % error) from error
    try:
        reply = json.loads(line)
    except ValueError as error:
        raise HerdrError("herdr sent no reply") from error
    if "error" in reply:
        raise HerdrError((reply["error"] or {}).get("message") or "herdr refused " + method)
    return reply.get("result") or {}


def snapshot(path):
    return call(path, "session.snapshot")["snapshot"]


_REGISTRY_LOCK = threading.RLock()


def registry_path(orc_dir):
    return os.path.join(orc_dir, "herdr", "workspaces.json")


def read_registry(orc_dir):
    """{scope: {"workspaceId", "label", "project"}} for the workspaces Orc
    opened. herdr restores a stopped session's workspaces under the same ids
    and labels but without their tokens, so this file is what still names them."""
    try:
        with open(registry_path(orc_dir), encoding="utf-8") as f:
            scopes = json.load(f).get("scopes")
    except (OSError, ValueError, AttributeError):
        return {}
    if not isinstance(scopes, dict):
        return {}
    return {scope: entry for scope, entry in scopes.items()
            if isinstance(entry, dict) and isinstance(entry.get("workspaceId"), str)}


def write_registry(orc_dir, scopes):
    path = registry_path(orc_dir)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump({"scopes": scopes}, f, indent=2)
    os.replace(tmp, path)


def workspace_scopes(snap, registry):
    """{workspace id: scope} for the workspaces Orc opened: by herdr's token
    while it has one, else by the registry's id and label. A token the
    registry cannot name leaves its workspace unknown."""
    tokens = {scope_token(scope): scope for scope in registry}
    scopes, untagged = {}, {}
    for workspace in snap.get("workspaces", []):
        token = (workspace.get("tokens") or {}).get(SCOPE_TOKEN)
        if not token:
            untagged[workspace["workspace_id"]] = workspace.get("label")
        elif token in tokens:
            scopes[workspace["workspace_id"]] = tokens[token]
    tagged = set(scopes.values())
    for scope, entry in registry.items():
        workspace = entry["workspaceId"]
        if (scope not in tagged and workspace not in scopes
                and workspace in untagged and untagged[workspace] == entry.get("label")):
            scopes[workspace] = scope
    return scopes


def tab_state(snap, registry=None):
    """The focused workspace's tabs in herdr's order, and every workspace with
    the scope Orc opened it for. sessionTabs counts every workspace's tabs,
    since closing the last of those ends the session."""
    registry = registry or {}
    scopes = workspace_scopes(snap, registry)
    workspace = snap.get("focused_workspace_id")
    if not workspace and snap.get("tabs"):
        workspace = snap["tabs"][0]["workspace_id"]
    tabs = sorted((t for t in snap.get("tabs", []) if t.get("workspace_id") == workspace),
                  key=lambda t: t.get("number", 0))
    focused = next((t["tab_id"] for t in tabs if t.get("focused")), None)
    workspaces = []
    for item in sorted(snap.get("workspaces", []), key=lambda w: w.get("number", 0)):
        scope = scopes.get(item["workspace_id"])
        workspaces.append({
            "id": item["workspace_id"], "label": item.get("label") or "", "focused": item["workspace_id"] == workspace,
            "agentStatus": item.get("agent_status") or "unknown", "tabCount": item.get("tab_count", 0),
            "scope": scope, "project": (registry.get(scope) or {}).get("project") if scope else None})
    return {
        "tabs": [{"id": t["tab_id"], "number": t.get("number"), "label": t.get("label") or str(t.get("number")),
                  "focused": bool(t.get("focused")), "agentStatus": t.get("agent_status") or "unknown",
                  "paneCount": t.get("pane_count", 1)} for t in tabs],
        "focusedTabId": focused,
        "sessionTabs": len(snap.get("tabs", [])),
        "focusedWorkspaceId": workspace,
        "workspaces": workspaces,
    }


EMPTY_STATE = {"tabs": [], "focusedTabId": None, "sessionTabs": 0, "focusedWorkspaceId": None, "workspaces": []}


def _pane_ids(snap):
    return sorted(pane["pane_id"] for pane in snap.get("panes", []))


def pane_exists(path, pane_id):
    try:
        call(path, "pane.get", {"pane_id": pane_id})
    except HerdrError:
        return False
    return True


def create_tab(path, workspace, cwd, label=None, command=None, env=None, enter=True):
    """(tab id, pane id) of a new focused tab in `workspace`, running
    `command` when given, or only typing it at the prompt when `enter` is
    false. herdr focuses the tab's workspace with it."""
    params = {"workspace_id": workspace, "cwd": cwd, "label": label, "focus": True}
    if env:
        params["env"] = env
    created = call(path, "tab.create", {k: v for k, v in params.items() if v is not None})
    tab_id, pane_id = created["tab"]["tab_id"], created["root_pane"]["pane_id"]
    if command:
        try:
            call(path, "pane.send_text", {"pane_id": pane_id, "text": command + ("\r" if enter else "")})
        except HerdrError as error:
            raise CommandUnconfirmed(str(error), tab_id, pane_id) from error
    return tab_id, pane_id


def watch_tabs(socket_for, publish, alive, state_of=tab_state):
    """Publishes the session's state whenever herdr reports a change. The
    snapshot that counts is read once the subscription is acknowledged, as
    herdr's docs prescribe, so no change falls between the two. Agent status is
    subscribed per pane, so a new pane means a new subscription."""
    last = None
    panes = None
    while alive():
        path = socket_for()
        try:
            if panes is None:
                panes = _pane_ids(snapshot(path))
            subscriptions = [{"type": kind} for kind in TAB_EVENTS]
            subscriptions += [{"type": "pane.agent_status_changed", "pane_id": pane} for pane in panes]
            with socket.socket(socket.AF_UNIX) as conn:
                conn.settimeout(REFRESH_SECONDS)
                conn.connect(path)
                conn.sendall(json.dumps({"id": "orc-events", "method": "events.subscribe",
                                         "params": {"subscriptions": subscriptions}}).encode() + b"\n")
                stream = conn.makefile("rb")
                if "error" in json.loads(stream.readline() or b"{}"):
                    raise HerdrError("herdr refused the subscription")
                event = {}
                while alive():
                    snap = snapshot(path)
                    state = state_of(snap)
                    if state != last:
                        publish(state)
                        last = state
                    if _pane_ids(snap) != panes:
                        panes = _pane_ids(snap)
                        break
                    if "lost" in str(event.get("event", "")):
                        break
                    line = stream.readline()
                    if not line:
                        break
                    event = json.loads(line)
        except (OSError, ValueError, HerdrError):
            panes = None
            time.sleep(0.2)


_FEED_LOCK = threading.Lock()
_SOCKETS = {}


def session_socket(orc_dir=None):
    name = session_name(orc_dir)
    if name not in _SOCKETS:
        _SOCKETS[name] = socket_path(name)
    return _SOCKETS[name]


def client_owner(orc_dir=None):
    """run_terminal's owner key for the session's one client; no run id starts with @."""
    return "@" + session_name(orc_dir)


def _publish(shell, state):
    with shell.lock:
        shell.tabs = state
        for ws in tuple(shell.clients):
            ws.send_json(dict(state, type="tabs"))


_SERVER_LOCK = threading.Lock()


def start_server(herdr, orc_dir, cwd, environ, timeout=5):
    """Start the session's server headless when it is not answering. A client
    that starts the server hands it its own environment, panes and all, and
    the client's SSH_TTY must not reach the panes."""
    path = session_socket(orc_dir)
    with _SERVER_LOCK:
        try:
            snapshot(path)
            return
        except HerdrError:
            pass
        proc = subprocess.Popen([herdr, "--session", session_name(orc_dir), "server"], cwd=cwd, env=environ,
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
        threading.Thread(target=proc.wait, name="orc-herdr-server", daemon=True).start()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                snapshot(path)
                return
            except HerdrError:
                if proc.poll() is not None:
                    break
                time.sleep(0.05)
        # The client would start one itself, and hand it SSH_TTY.
        raise HerdrError("herdr's server did not start")


def client(orc_dir=None, cwd=None):
    """The session's herdr TUI client on a PTY, started in `cwd` when it is
    not running. Every scope and every browser viewer shares it."""
    herdr = binary()
    if not herdr:
        raise HerdrError("herdr is not installed")
    orc_dir = orc_dir or default_orc_dir()
    owner = client_owner(orc_dir)
    shell = run_terminal.get_shell(owner, HERDR_TAB)
    if shell is None:
        if not cwd:
            return None
        environ = client_env(os.environ, write_config(orc_dir))
        start_server(herdr, orc_dir, cwd, environ)
        # A local client copies with pbcopy, onto the Mac's clipboard whichever
        # device made the selection. Under SSH it sends OSC 52 instead, which
        # terminal.js writes on the device that made it.
        shell = run_terminal.get_shell(owner, HERDR_TAB, cwd, argv=[herdr, "--session", session_name(orc_dir)],
                                       environ=dict(environ, SSH_TTY="orc-browser"))
    with _FEED_LOCK:
        if not shell.feed:
            shell.feed = threading.Thread(
                target=watch_tabs, name="orc-herdr-tabs", daemon=True,
                args=(lambda: session_socket(orc_dir), lambda state: _publish(shell, state),
                      lambda: not shell.closed and shell.proc.poll() is None,
                      lambda snap: tab_state(snap, read_registry(orc_dir))))
            shell.feed.start()
    return shell


def ensure_session(orc_dir, cwd, timeout=8):
    """The session's socket once it answers and has a workspace. The client
    creates that workspace in its cwd on a fresh server; a server that
    outlived its workspaces gets one here."""
    client(orc_dir, cwd)
    path = session_socket(orc_dir)
    deadline = time.monotonic() + timeout
    answered = None
    while time.monotonic() < deadline:
        try:
            snap = snapshot(path)
        except HerdrError:
            time.sleep(0.1)
            continue
        if snap.get("workspaces"):
            return path
        answered = answered or time.monotonic()
        if time.monotonic() - answered > 2:
            call(path, "workspace.create", {"cwd": cwd, "focus": True})
            return path
        time.sleep(0.1)
    raise HerdrError("Orc's herdr session did not start")


def _short(label):
    label = (label or "").strip()
    return label[:MAX_LABEL - 1].rstrip() + "\u2026" if len(label) > MAX_LABEL else label


def _started_here(snap, scopes, cwd):
    """The id of the one workspace a new server's client opened in `cwd`, which
    belongs to the scope that started the session."""
    workspaces = snap.get("workspaces", [])
    if (len(workspaces) != 1 or workspaces[0]["workspace_id"] in scopes
            or (workspaces[0].get("tokens") or {}).get(SCOPE_TOKEN)):
        return None
    panes = [pane for pane in snap.get("panes", []) if pane.get("cwd")]
    if len(panes) != 1 or os.path.realpath(panes[0]["cwd"]) != os.path.realpath(cwd):
        return None
    return workspaces[0]["workspace_id"]


def ensure_workspace(orc_dir, scope, cwd, label=None, project=None, focus=True):
    """(socket, workspace id) of the scope's workspace, starting the session
    and opening the workspace in `cwd` when either is missing. Orc owns the
    label; `project` is the project scope a run's workspace lists under."""
    orc_dir = orc_dir or default_orc_dir()
    path = ensure_session(orc_dir, cwd)
    label = _short(label) or os.path.basename(cwd.rstrip(os.sep)) or scope
    with _REGISTRY_LOCK:
        snap = snapshot(path)
        registry = read_registry(orc_dir)
        scopes = workspace_scopes(snap, registry)
        workspace = next((found for found, owner in scopes.items() if owner == scope), None)
        if workspace is None:
            workspace = _started_here(snap, scopes, cwd)
        if workspace is None:
            created = call(path, "workspace.create", {"cwd": cwd, "label": label, "focus": bool(focus)})
            workspace = created["workspace"]["workspace_id"]
            current = {"label": label, "focused": bool(focus)}
        else:
            current = next(w for w in snap["workspaces"] if w["workspace_id"] == workspace)
        live = {item["workspace_id"] for item in snap.get("workspaces", [])} | {workspace}
        kept = {owner: entry for owner, entry in registry.items()
                if owner != scope and entry["workspaceId"] in live and entry["workspaceId"] != workspace}
        kept[scope] = {"workspaceId": workspace, "label": label, "project": project}
        # Before the calls below: each makes herdr report a change, and the tab
        # feed names the workspace from this file when it looks again.
        if kept != registry:
            write_registry(orc_dir, kept)
        if (current.get("tokens") or {}).get(SCOPE_TOKEN) != scope_token(scope):
            call(path, "workspace.report_metadata",
                 {"workspace_id": workspace, "source": "orc", "tokens": {SCOPE_TOKEN: scope_token(scope)}})
        if current.get("label") != label:
            call(path, "workspace.rename", {"workspace_id": workspace, "label": label})
        if focus and not current.get("focused"):
            call(path, "workspace.focus", {"workspace_id": workspace})
    return path, workspace


def run_command(orc_dir, scope, cwd, command, label, env=None, workspace_label=None, project=None, enter=True):
    """(tab id, pane id) of a new herdr tab in the scope's workspace, running
    `command` when given (typing it without Enter when `enter` is false)."""
    path, workspace = ensure_workspace(orc_dir, scope, cwd, workspace_label, project, focus=False)
    return create_tab(path, workspace, cwd, label=_short(label) or None, command=command, env=env, enter=enter)


def read_pane(path, pane_id, lines):
    """The pane's recent output as plain text, wrapped lines joined."""
    read = call(path, "pane.read", {"pane_id": pane_id, "source": "recent_unwrapped", "lines": lines})
    return (read.get("read") or {}).get("text") or ""


def current_tabs(orc_dir=None):
    """(running, state) of the session, without starting it."""
    orc_dir = orc_dir or default_orc_dir()
    try:
        return True, tab_state(snapshot(session_socket(orc_dir)), read_registry(orc_dir))
    except HerdrError:
        return False, dict(EMPTY_STATE)


def stop(orc_dir=None, timeout=3):
    """Ends the session and every program in it, then deletes it so
    `herdr session list` keeps no dead session. herdr deletes only a stopped
    session, and its server exits a moment after server.stop."""
    orc_dir = orc_dir or default_orc_dir()
    try:
        call(session_socket(orc_dir), "server.stop")
    except HerdrError:
        pass
    run_terminal.close_terminal(client_owner(orc_dir), HERDR_TAB)
    with _REGISTRY_LOCK:
        try:
            os.remove(registry_path(orc_dir))
        except OSError:
            pass
    herdr = binary()
    if not herdr:
        return
    deadline = time.monotonic() + timeout
    while True:
        try:
            deleted = subprocess.run([herdr, "session", "delete", session_name(orc_dir), "--json"],
                                     capture_output=True, text=True, timeout=5, env=client_env(os.environ, ""))
            if deleted.returncode == 0 or time.monotonic() > deadline:
                return
        except (OSError, subprocess.TimeoutExpired):
            return
        time.sleep(0.05)


def close_tab(orc_dir, tab_id):
    """Closes one tab and says what went with it: "session" when it was the
    session's last tab in any workspace, which ends the session as closing the
    last shell tab does; "workspace" when it was its workspace's last, which
    herdr closes with it; else None. HerdrError when herdr cannot say which
    tabs it has."""
    path = session_socket(orc_dir)
    tabs = snapshot(path).get("tabs", [])
    if [t.get("tab_id") for t in tabs] == [tab_id]:
        stop(orc_dir)
        return "session"
    workspace = next((t.get("workspace_id") for t in tabs if t.get("tab_id") == tab_id), None)
    call(path, "tab.close", {"tab_id": tab_id})
    if workspace and sum(1 for t in tabs if t.get("workspace_id") == workspace) == 1:
        return "workspace"
    return None


def close_workspace(orc_dir, workspace_id):
    """Closes a workspace with every tab in it and says what went with it:
    "session" when no other workspace has a tab, which ends the session as
    closing its last tab does; else "workspace". HerdrError when herdr cannot
    say which tabs it has."""
    path = session_socket(orc_dir)
    tabs = snapshot(path).get("tabs", [])
    if tabs and all(t.get("workspace_id") == workspace_id for t in tabs):
        stop(orc_dir)
        return "session"
    call(path, "workspace.close", {"workspace_id": workspace_id})
    return "workspace"


def close_scope(orc_dir, scope):
    with _REGISTRY_LOCK:
        snap = snapshot(session_socket(orc_dir))
        for workspace, owner in workspace_scopes(snap, read_registry(orc_dir)).items():
            if owner == scope and close_workspace(orc_dir, workspace) == "session":
                return
