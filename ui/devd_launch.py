"""Opt-in Rails helpers supply the run's MCP repository and server identities."""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

import rails_helpers

DEFAULT_HTTP_PORT = 8080


def devd_home() -> Path:
    return Path(os.environ.get("ORC_DEVD_HOME")
                or Path(os.environ.get("HOME", str(Path.home()))) / ".orc" / "devd")


DEFAULT_CONTROL_PORT = 4479


def _config_port(key: str, default: int) -> int:
    try:
        value = json.loads((devd_home() / "config.json").read_text()).get(key)
    except (OSError, ValueError, AttributeError):
        return default
    return value if isinstance(value, int) and 0 < value < 65536 else default


def http_port() -> int:
    """orc-devd's plain-HTTP port: Node MCP clients don't trust the keychain,
    so `mcp.localhost` answers without TLS."""
    return _config_port("httpPort", DEFAULT_HTTP_PORT)


def control_port() -> int:
    return _config_port("controlPort", DEFAULT_CONTROL_PORT)


ORIGIN_TTL = 3600.0
ORIGIN_RETRY = 60.0
_ORIGINS: dict[str, tuple[float, str]] = {}


def _origin(path: str) -> str:
    """`origin`'s URL for a project checkout, kept for an hour because the run
    list asks again for every live run on each scan. A lookup that found no
    URL is tried again after a minute: git can fail for a moment, and a
    checkout can gain its remote."""
    now = time.monotonic()
    known = _ORIGINS.get(path)
    if known is not None and known[0] > now:
        return known[1]
    try:
        result = subprocess.run(["git", "-C", path, "remote", "get-url", "origin"],
                                capture_output=True, text=True, timeout=10)
        url = result.stdout.strip() if result.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        url = ""
    _ORIGINS[path] = (now + (ORIGIN_TTL if url else ORIGIN_RETRY), url)
    return url


def is_devd_repo(path: str | None, config: dict | None = None) -> bool:
    if not path:
        return False
    config = rails_helpers.configuration() if config is None else config
    if not config.get("remotes"):
        return False
    return bool(rails_helpers.repository(_origin(path), config))


def server(run_id: str, port: int) -> dict:
    return {"type": "http",
            "url": "http://mcp.localhost%s/mcp" % ("" if port == 80 else ":%d" % port),
            "headers": {"X-Orc-Run": run_id}}


def run_server(run_id: str | None, path: str | None,
               config: dict | None = None) -> tuple[str, dict] | None:
    """The run MCP entry orc-devd answers for a run whose checkout at `path` is
    a devd repository, as (server name, entry); None for any other run."""
    config = rails_helpers.configuration() if config is None else config
    name = config.get("mcpServer")
    if not run_id or not name or not is_devd_repo(path, config):
        return None
    return name, server(run_id, http_port())


def with_run_mcp(args: list[str] | None, cwd: str | None, agent: str,
                 run_id: str) -> list[str] | None:
    """`args` plus the run's MCP entry, merged into an existing `--mcp-config`
    so a session carries one config, for a Claude session on a devd repo.
    Anything else gets `args` back unchanged."""
    found = run_server(run_id, cwd) if agent == "claude" else None
    if found is None:
        return args
    server_name, entry = found
    out = list(args or [])
    if "--mcp-config" in out:
        index = out.index("--mcp-config") + 1
        try:
            config = json.loads(out[index])
        except (IndexError, ValueError):
            config = None
        if isinstance(config, dict) and isinstance(config.get("mcpServers"), dict):
            config["mcpServers"][server_name] = entry
            out[index] = json.dumps(config)
            return out
    return out + ["--mcp-config", json.dumps({"mcpServers": {server_name: entry}})]
