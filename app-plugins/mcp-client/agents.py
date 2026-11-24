"""The MCP servers Claude and Codex already have, read from their own config.

Nothing here writes. A Claude login keeps one global list and one private
list per folder in its ``.claude.json``, and a repo can share servers in a
``.mcp.json`` file. Codex keeps one global list in ``config.toml`` and reads
a project's own from ``.codex/config.toml`` inside it.

One server that agents hold under different names at the same address is one
row, carrying each agent's name for it. Header values stay in this process:
a row tells the screen header and environment names only.
"""
from __future__ import annotations

import hashlib
import json
import os
import shlex
import threading
import time
import tomllib
from pathlib import Path

import agent_accounts
import claude_accounts
import keychain_secrets
import stat_cache
from . import servers as store_module

GLOBAL = "global"
CODEX = "codex"
PATH_LIMIT = 1024
AGENTS_TTL = 2.0
HTTP, SSE, COMMAND = "http", "sse", "command"


def normal_path(value, home=None) -> str:
    """A folder as every list here names it: absolute, with ``~`` standing
    for ``home``, the folder whose agents are being read."""
    value = str(value)
    if home is not None and (value == "~" or value.startswith("~/")):
        value = os.path.join(str(home), value[2:])
    return os.path.abspath(os.path.expanduser(value))


def _table(value) -> dict:
    return value if isinstance(value, dict) else {}


def _header_value(name, value):
    """A header value Orc can send as written. One that reads an environment
    variable, or that Orc's client could not send, is listed by name only."""
    sendable = (isinstance(value, str) and "${" not in value and len(value) <= 2048
                and keychain_secrets.PRINTABLE_ASCII.fullmatch(value)
                and store_module.HEADER_NAME.fullmatch(name)
                and name.lower() not in store_module.RESERVED_HEADERS
                and not name.lower().startswith("mcp-param-"))
    return value if sendable else None


def spec(raw) -> dict | None:
    """One config entry, or None when it names neither a URL nor a command."""
    raw = _table(raw)
    url = raw.get("url")
    if isinstance(url, str) and url.strip():
        url = url.strip()
        headers = {str(name): _header_value(str(name), value)
                   for name, value in {**_table(raw.get("headers")), **_table(raw.get("http_headers"))}.items()}
        # Codex can name the environment variable a header's value comes from.
        for name in _table(raw.get("env_http_headers")):
            headers.setdefault(str(name), None)
        if isinstance(raw.get("bearer_token_env_var"), str):
            headers.setdefault("Authorization", None)
        return {"transport": SSE if raw.get("type") == "sse" else HTTP, "url": url,
                "address": "url:" + store_module.address(url), "headers": headers, "env": []}
    command = raw.get("command")
    if isinstance(command, str) and command.strip():
        args = raw.get("args")
        words = [command.strip(), *(str(arg) for arg in (args if isinstance(args, list) else [])
                                    if isinstance(arg, (str, int, float)))]
        return {"transport": COMMAND, "command": shlex.join(words), "address": "command:" + "\0".join(words),
                "headers": {}, "env": sorted(str(name) for name in _table(raw.get("env")))}
    return None


def specs(raw) -> dict:
    found = {}
    for name, entry in _table(raw).items():
        entry = spec(entry)
        if entry is not None and isinstance(name, str) and name:
            found[name] = entry
    return found


def parse_claude(raw) -> dict:
    """A login's ``.claude.json`` as its global servers and, per folder, the
    private ones and the shared ones that login turned off there."""
    try:
        data = _table(json.loads(raw)) if raw else {}
    except ValueError:
        data = {}
    folders = {}
    for path, entry in _table(data.get("projects")).items():
        entry = _table(entry)
        servers = specs(entry.get("mcpServers"))
        off = entry.get("disabledMcpjsonServers")
        off = frozenset(name for name in (off if isinstance(off, list) else []) if isinstance(name, str))
        if (servers or off) and isinstance(path, str) and os.path.isabs(path):
            folders[normal_path(path)] = {"servers": servers, "off": off}
    return {"servers": specs(data.get("mcpServers")), "folders": folders}


def parse_shared(raw) -> dict:
    try:
        return specs(_table(json.loads(raw)).get("mcpServers")) if raw else {}
    except ValueError:
        return {}


def parse_codex(raw) -> dict:
    """A Codex ``config.toml`` as its servers and the folders it trusts."""
    try:
        data = tomllib.loads(raw.decode()) if raw else {}
    except ValueError:
        data = {}
    trusted = [normal_path(path) for path in _table(data.get("projects")) if os.path.isabs(str(path))]
    return {"servers": specs(data.get("mcp_servers")), "trusted": trusted}


class Files:
    """What each config file holds, parsed again only after the file changes.
    A login's ``.claude.json`` can run to megabytes, and the screen asks for
    its servers every time a tab opens."""

    def __init__(self):
        self.lock = threading.Lock()
        self.entries: dict = {}

    def read(self, path, parse):
        path = str(path)
        try:
            key = stat_cache.file_key(path)
        except OSError:
            return parse(None)
        with self.lock:
            hit = self.entries.get(path)
        if hit is not None and hit[0] == key:
            return hit[1]
        try:
            with open(path, "rb") as handle:
                raw = handle.read()
        except OSError:
            return parse(None)
        value = parse(raw)
        with self.lock:
            self.entries[path] = (key, value)
        return value


def link(members: list[dict]) -> list[list[dict]]:
    """Groups entries into rows: entries at one address are one row across
    agents, and two entries inside one agent stay two rows. An agent's entry
    joins the row that already has its name before any other."""
    groups: dict = {}
    for member in members:
        groups.setdefault(member["address"], []).append(member)
    rows = []
    for group in groups.values():
        slots: list[list[dict]] = []
        for agent in dict.fromkeys(member["agent"] for member in group):
            def free(slot, agent=agent):
                return all(other["agent"] != agent for other in slot)
            waiting = []
            for member in sorted((item for item in group if item["agent"] == agent),
                                 key=lambda item: item["name"].casefold()):
                slot = next((slot for slot in slots
                             if free(slot) and any(other["name"] == member["name"] for other in slot)), None)
                if slot is None:
                    waiting.append(member)
                else:
                    slot.append(member)
            for member in waiting:
                slot = next((slot for slot in slots if free(slot)), None)
                if slot is None:
                    slots.append([member])
                else:
                    slot.append(member)
        rows.extend(slots)
    return rows


def row(project: str, slot: list[dict]) -> dict:
    """One row for the screen. ``values`` holds header values for Orc's own
    requests and never leaves this process."""
    first = slot[0]
    identity = "\0".join([project, first["address"], first["agent"], first["scope"], first["name"]])
    names = sorted({name for member in slot for name in member["headers"]}, key=str.casefold)
    values = next(({name: value for name, value in member["headers"].items() if value is not None}
                   for member in slot if any(value is not None for value in member["headers"].values())), {})
    return {
        "id": hashlib.sha1(identity.encode()).hexdigest()[:10], "name": first["name"],
        "transport": first["transport"], "url": first.get("url"), "command": first.get("command"),
        "address": first["address"], "headers": names, "values": values,
        "env": sorted({name for member in slot for name in member["env"]}),
        "agents": [{"agent": member["agent"], "label": member["label"], "name": member["name"],
                    "scope": member["scope"]} for member in slot],
        "readOnly": all(member["scope"] == "shared" for member in slot),
    }


class Reader:
    def __init__(self, home, config_dir=None):
        self.home = Path(home)
        self.config_dir = Path(config_dir) if config_dir else None
        # CODEX_HOME only counts against the real home, never a fixture.
        configured = os.environ.get("CODEX_HOME", "").strip() if self.home == Path.home() else ""
        self.codex_dir = Path(normal_path(configured)) if configured else self.home / ".codex"
        self.files = Files()
        self.lock = threading.Lock()
        self.found: tuple[float, list[dict]] | None = None

    def agents(self) -> list[dict]:
        """Each Claude login as Settings names it, then Codex when it has a
        home. One look serves a whole request, which asks once per folder."""
        with self.lock:
            if self.found is None or time.monotonic() - self.found[0] > AGENTS_TTL:
                self.found = (time.monotonic(), self._agents())
            return self.found[1]

    def _agents(self) -> list[dict]:
        logins = claude_accounts.available(self.home)
        names = (agent_accounts.Accounts(self.config_dir, home=self.home).claude_names()
                 if self.config_dir else {})
        found = [{"id": "claude:%s" % login, "login": login,
                  "label": names.get(login) or agent_accounts.label("claude", login)} for login in logins]
        if self.codex_dir.is_dir():
            found.append({"id": CODEX, "label": "Codex"})
        return found

    def _claude(self, login) -> dict:
        folder = self.home if login == claude_accounts.DEFAULT else self.home / login
        return self.files.read(folder / ".claude.json", parse_claude)

    def _codex(self) -> dict:
        return self.files.read(self.codex_dir / "config.toml", parse_codex)

    def _codex_project(self, project) -> dict:
        """The servers a folder's own ``.codex/config.toml`` adds. The home
        folder's is Codex's global list, not a project's."""
        folder = Path(project) / ".codex"
        return {} if folder == self.codex_dir else self.files.read(folder / "config.toml", parse_codex)["servers"]

    def members(self, project: str) -> list[dict]:
        """Every agent's entries for the global lists or one folder."""
        found = []

        def take(agent, scope, servers):
            found.extend({"agent": agent["id"], "label": agent["label"], "name": name, "scope": scope, **entry}
                         for name, entry in servers.items())
        shared = {} if project == GLOBAL else self.files.read(Path(project) / ".mcp.json", parse_shared)
        for agent in self.agents():
            if agent["id"] == CODEX:
                take(agent, "global" if project == GLOBAL else "project",
                     self._codex()["servers"] if project == GLOBAL else self._codex_project(project))
                continue
            claude = self._claude(agent["login"])
            if project == GLOBAL:
                take(agent, "global", claude["servers"])
                continue
            folder = claude["folders"].get(project) or {"servers": {}, "off": frozenset()}
            take(agent, "private", folder["servers"])
            take(agent, "shared", {name: entry for name, entry in shared.items() if name not in folder["off"]})
        return found

    def rows(self, project: str) -> list[dict]:
        rows = [row(project, slot) for slot in link(self.members(project))]
        return sorted(rows, key=lambda item: (item["name"].casefold(), item["id"]))

    def folders(self, also=()) -> set[str]:
        """Every folder some agent keeps servers for. A folder's own
        ``.mcp.json`` or ``.codex/config.toml`` is found only for a folder
        that is named: one Codex trusts, or one in ``also``."""
        found = set()
        for agent in self.agents():
            if agent["id"] != CODEX:
                found.update(path for path, folder in self._claude(agent["login"])["folders"].items()
                             if folder["servers"])
        for path in {*self._codex()["trusted"], *also} - found:
            if self.files.read(Path(path) / ".mcp.json", parse_shared) or self._codex_project(path):
                found.add(path)
        return found
