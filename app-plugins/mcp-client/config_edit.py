"""Changes to the files Claude and Codex keep their MCP servers in, as text
in and text out. Nothing here touches a file: config_files.py reads, backs
up and writes them.

A Claude login keeps servers as JSON in its ``.claude.json``: ``mcpServers``
for every folder, and ``projects[<folder>].mcpServers`` for one. Codex keeps
them as ``[mcp_servers.<name>]`` tables in a ``config.toml``.

A server passes between the two as a spec:
``{'transport': 'http' | 'sse' | 'stdio', 'url', 'headers', 'command',
'args', 'env'}``. Codex names an environment variable for a secret where
Claude writes ``${VAR}`` inside a header, so a spec holds the Claude form.
"""
from __future__ import annotations

import copy
import json
import re
import tomllib

NAME = re.compile(r"[A-Za-z0-9_-]{1,64}")
BARE_KEY = re.compile(r"[A-Za-z0-9_-]+")
ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
ENV_REFERENCE = re.compile(r"\$\{(%s)\}" % ENV_NAME.pattern)
_KEY = re.compile(r"""\s*(?:([A-Za-z0-9_-]+)|"((?:[^"\\]|\\.)*)"|'([^']*)')\s*""")
# What a spec sets in each agent's entry. An edit replaces these and keeps
# the entry's other settings, such as Claude's `oauth` or Codex's `enabled`.
CLAUDE_KEYS = ("type", "url", "headers", "command", "args", "env")
CODEX_KEYS = ("url", "http_headers", "env_http_headers", "bearer_token_env_var", "command", "args", "env")


class EditError(ValueError):
    """A change Orc refused, worded for the MCP client screen."""


def clean_name(value) -> str:
    name = value.strip() if isinstance(value, str) else ""
    if not NAME.fullmatch(name):
        raise EditError("Name the server with letters, numbers, hyphens and underscores, up to 64 characters.")
    return name


# -- specs --

def _strings(value) -> dict:
    return {key: item for key, item in value.items() if isinstance(key, str) and isinstance(item, str)} \
        if isinstance(value, dict) else {}


def _stdio(entry) -> dict:
    args = entry.get("args")
    return {"transport": "stdio", "command": entry["command"],
            "args": [item for item in args if isinstance(item, str)] if isinstance(args, list) else [],
            "env": _strings(entry.get("env"))}


def spec_from_claude(entry) -> dict | None:
    """The spec of one server in a Claude config, or None for an entry that
    is neither a command nor an address."""
    if not isinstance(entry, dict):
        return None
    kind = entry.get("type")
    if isinstance(entry.get("command"), str) and kind in (None, "stdio"):
        return _stdio(entry)
    if isinstance(entry.get("url"), str) and kind in (None, "http", "sse"):
        return {"transport": "sse" if kind == "sse" else "http", "url": entry["url"],
                "headers": _strings(entry.get("headers"))}
    return None


def spec_from_codex(entry) -> dict | None:
    if not isinstance(entry, dict):
        return None
    if isinstance(entry.get("command"), str):
        return _stdio(entry)
    if not isinstance(entry.get("url"), str):
        return None
    headers = _strings(entry.get("http_headers"))
    for name, variable in _strings(entry.get("env_http_headers")).items():
        headers[name] = "${%s}" % variable
    if isinstance(entry.get("bearer_token_env_var"), str):
        headers["Authorization"] = "Bearer ${%s}" % entry["bearer_token_env_var"]
    return {"transport": "http", "url": entry["url"], "headers": headers}


def _kept(current, modelled) -> dict:
    return {key: value for key, value in current.items() if key not in modelled} if isinstance(current, dict) else {}


def _same_kind(current, spec, read) -> bool:
    before = read(current)
    return before is not None and (before["transport"] == "stdio") == (spec["transport"] == "stdio")


def claude_entry(spec, current=None) -> dict:
    """The entry Claude keeps for a spec. ``current`` is the entry it
    replaces, whose other settings stay while the server is still the same
    kind: an OAuth client belongs to an address, not to a command."""
    if spec["transport"] == "stdio":
        entry = {"type": "stdio", "command": spec["command"], "args": list(spec.get("args") or []),
                 "env": dict(spec.get("env") or {})}
    else:
        entry = {"type": spec["transport"], "url": spec["url"]}
        if spec.get("headers"):
            entry["headers"] = dict(spec["headers"])
    if _same_kind(current, spec, spec_from_claude):
        entry.update(_kept(current, CLAUDE_KEYS))
    return entry


def codex_entry(spec, current=None) -> dict:
    if spec["transport"] == "sse":
        raise EditError("Codex cannot use a server that only speaks SSE.")
    if spec["transport"] == "stdio":
        entry = {"command": spec["command"]}
        if spec.get("args"):
            entry["args"] = list(spec["args"])
        if spec.get("env"):
            entry["env"] = dict(spec["env"])
    else:
        entry, literal, from_env = {"url": spec["url"]}, {}, {}
        for name, value in (spec.get("headers") or {}).items():
            bearer = re.fullmatch(r"Bearer %s" % ENV_REFERENCE.pattern, value) if name.lower() == "authorization" else None
            whole = ENV_REFERENCE.fullmatch(value)
            if bearer:
                entry["bearer_token_env_var"] = bearer.group(1)
            elif whole:
                from_env[name] = whole.group(1)
            else:
                literal[name] = value
        if literal:
            entry["http_headers"] = literal
        if from_env:
            entry["env_http_headers"] = from_env
    if _same_kind(current, spec, spec_from_codex):
        entry.update(_kept(current, CODEX_KEYS))
    return entry


# -- Claude: JSON --

def _claude_config(text) -> dict:
    try:
        config = json.loads(text) if text.strip() else {}
    except ValueError:
        config = None
    if not isinstance(config, dict):
        raise EditError("Orc could not read that Claude config, so it left it alone.")
    return config


def claude_folders(text) -> list[str]:
    """Each folder a Claude config keeps settings for, as it spells it."""
    projects = _claude_config(text).get("projects")
    return [key for key in projects if isinstance(key, str)] if isinstance(projects, dict) else []


def claude_servers(text, folder=None) -> dict:
    """The servers a Claude config holds for every folder, or for one."""
    holder = _claude_config(text)
    if folder is not None:
        projects = holder.get("projects")
        holder = projects.get(folder) if isinstance(projects, dict) else None
    servers = holder.get("mcpServers") if isinstance(holder, dict) else None
    return servers if isinstance(servers, dict) else {}


def _claude_text(config, was_text, was_config) -> str:
    """The config as Claude wrote it: its own escaping and final newline,
    found by writing the config it had the same way."""
    for ascii_only in (True, False):
        body = json.dumps(was_config, indent=2, ensure_ascii=ascii_only)
        for tail in ("", "\n"):
            if body + tail == was_text:
                return json.dumps(config, indent=2, ensure_ascii=ascii_only) + tail
    return json.dumps(config, indent=2, ensure_ascii=False) + "\n"


def claude_change(text, folder, name, entry) -> str:
    """The Claude config with server ``name`` set to ``entry``, or removed
    when ``entry`` is None, for every folder (``folder`` None) or for one.
    A change that changes nothing answers the same text."""
    config = _claude_config(text)
    was = copy.deepcopy(config)
    holder = config
    if folder is not None:
        projects = config.setdefault("projects", {}) if entry is not None else config.get("projects", {})
        if not isinstance(projects, dict):
            raise EditError("Orc could not read that Claude config, so it left it alone.")
        holder = projects.setdefault(folder, {}) if entry is not None else projects.get(folder, {})
    servers = holder.get("mcpServers") if isinstance(holder, dict) else None
    if not isinstance(holder, dict) or not (servers is None or isinstance(servers, dict)):
        raise EditError("Orc could not read that Claude config, so it left it alone.")
    if entry is None:
        (servers or {}).pop(name, None)
    else:
        if servers is None:
            servers = holder["mcpServers"] = {}
        servers[name] = entry
    return text if config == was else _claude_text(config, text, was)


def claude_rename(text, folder, name, new_name) -> str:
    """The Claude config with a server renamed where it stands in its list."""
    config = _claude_config(text)
    was = copy.deepcopy(config)
    holder = config if folder is None else (config.get("projects") or {}).get(folder)
    servers = holder.get("mcpServers") if isinstance(holder, dict) else None
    if not isinstance(servers, dict) or name not in servers:
        raise EditError("%s is no longer in that Claude config." % name)
    if new_name in servers:
        raise EditError("Claude already has a server named %s there." % new_name)
    holder["mcpServers"] = {(new_name if key == name else key): value for key, value in servers.items()}
    return _claude_text(config, text, was)


# -- Codex: TOML --

def _codex_config(text) -> dict:
    try:
        config = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        config = None
    if config is None or not isinstance(config.get("mcp_servers", {}), dict):
        raise EditError("Orc could not read that Codex config, so it left it alone.")
    return config


def codex_servers(text) -> dict:
    return {name: entry for name, entry in _codex_config(text).get("mcp_servers", {}).items() if isinstance(entry, dict)}


def _toml_key(key) -> str:
    return key if BARE_KEY.fullmatch(key) else _toml_value(key)


def _toml_value(value) -> str:
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False).replace("\x7f", "\\u007f")
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return repr(value)
    if isinstance(value, list):
        return "[%s]" % ", ".join(_toml_value(item) for item in value)
    if isinstance(value, dict):
        return "{ %s }" % ", ".join("%s = %s" % (_toml_key(key), _toml_value(item)) for key, item in value.items())
    # A date or a time, which TOML writes as ISO 8601.
    return value.isoformat()


def _table_lines(path, table) -> list[str]:
    """A table and the tables inside it, as Codex writes them: its own
    values first, then each table under its own header."""
    lines = ["[%s]\n" % ".".join(_toml_key(key) for key in path)]
    lines += ["%s = %s\n" % (_toml_key(key), _toml_value(value))
              for key, value in table.items() if not isinstance(value, dict)]
    for key, value in table.items():
        if isinstance(value, dict):
            lines += ["\n", *_table_lines([*path, key], value)]
    return lines


def _header(line) -> list[str] | None:
    """The key path a table header line names, else None."""
    text = line.strip()
    if not text.startswith("["):
        return None
    close = "]]" if text.startswith("[[") else "]"
    at, path = len(close), []
    while True:
        match = _KEY.match(text, at)
        if not match:
            return None
        bare, basic, literal = match.groups()
        if basic is not None:
            try:
                path.append(json.loads('"%s"' % basic))
            except ValueError:
                return None
        else:
            path.append(bare if bare is not None else literal)
        at = match.end()
        if not text.startswith(".", at):
            break
        at += 1
    rest = text[at + len(close):].strip() if text.startswith(close, at) else None
    return path if rest is not None and (not rest or rest.startswith("#")) else None


def _blank(line) -> bool:
    return not line.strip()


def _aside(line) -> bool:
    return _blank(line) or line.lstrip().startswith("#")


def _server_blocks(lines, name=None) -> list[list[int]]:
    """[start, end) line ranges of the tables under ``mcp_servers``, or of
    one server's. A range stops before the blank lines and comments that
    lead into the next table, and one server's tables with only those
    between them are one range."""
    headers = [(index, path) for index, line in enumerate(lines) if (path := _header(line)) is not None]
    ranges = []
    for position, (start, path) in enumerate(headers):
        if path[:1] != ["mcp_servers"] or (name is not None and path[1:2] != [name]):
            continue
        end = headers[position + 1][0] if position + 1 < len(headers) else len(lines)
        while end > start + 1 and _aside(lines[end - 1]):
            end -= 1
        if ranges and name is not None and all(_aside(line) for line in lines[ranges[-1][1]:start]):
            ranges[-1][1] = end
        else:
            ranges.append([start, end])
    return ranges


def _normal(config) -> dict:
    """The config without an empty ``mcp_servers``, which a bare
    ``[mcp_servers]`` header leaves behind once its last server goes."""
    return {key: value for key, value in config.items() if not (key == "mcp_servers" and value == {})}


def _spliced(lines, ranges, block, at) -> str:
    """The lines without ``ranges``, and with ``block`` put in before line
    ``at`` (none when ``at`` is -1). Where lines went or came, a blank line
    separates what is left, the blank lines that followed go, and none ends
    the file; every other line keeps its bytes."""
    out, seam = [], False

    def put(line):
        nonlocal seam
        if seam:
            if _blank(line):
                return
            if out and not _blank(out[-1]):
                out.append("\n")
            seam = False
        out.append(line if line.endswith("\n") else line + "\n")

    for index in range(len(lines) + 1):
        if index == at:
            seam = True
            for line in block:
                put(line)
            seam = True
        if index == len(lines):
            break
        if any(start <= index < end for start, end in ranges):
            seam = True
        else:
            put(lines[index])
    while seam and out and _blank(out[-1]):
        out.pop()
    return "".join(out)


def codex_change(text, name, entry) -> str:
    """The Codex config with server ``name`` set to ``entry``, or removed
    when ``entry`` is None. The rest of the file keeps its own bytes. An edit
    whose result does not read back as exactly that change is refused: a
    server written some other way than its own table is one."""
    current = _codex_config(text)
    expected = copy.deepcopy(current)
    servers = expected.setdefault("mcp_servers", {})
    if entry is None:
        servers.pop(name, None)
    else:
        servers[name] = entry
    if _normal(expected) == _normal(current):
        return text
    lines = text.splitlines(keepends=True)
    owned = _server_blocks(lines, name)
    block = _table_lines(["mcp_servers", name], entry) if entry is not None else []
    if owned:
        at = owned[0][0]
    else:
        every = _server_blocks(lines)
        at = every[-1][1] if every else len(lines)
    candidate = _spliced(lines, owned, block, at if block else -1)
    try:
        if _normal(tomllib.loads(candidate)) == _normal(expected):
            return candidate
    except tomllib.TOMLDecodeError:
        pass
    raise EditError("Orc could not safely change %s in that Codex config. Change it in the file." % name)


def codex_rename(text, name, new_name) -> str:
    """The Codex config with a server renamed where it stands."""
    servers = codex_servers(text)
    if name not in servers:
        raise EditError("%s is no longer in that Codex config." % name)
    if new_name in servers:
        raise EditError("Codex already has a server named %s there." % new_name)
    lines = text.splitlines(keepends=True)
    owned = _server_blocks(lines, name)
    block = _table_lines(["mcp_servers", new_name], servers[name])
    candidate = _spliced(lines, owned, block, owned[0][0]) if owned else None
    expected = _codex_config(text)
    expected["mcp_servers"] = {(new_name if key == name else key): value
                               for key, value in expected["mcp_servers"].items()}
    try:
        if candidate is not None and tomllib.loads(candidate) == expected:
            return candidate
    except tomllib.TOMLDecodeError:
        pass
    raise EditError("Orc could not safely rename %s in that Codex config. Rename it in the file." % name)
