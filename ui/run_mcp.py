"""The MCP tab's side of Orc's server: the MCP servers a run's agent can
reach, and the connect, list and call requests the tab makes to them through
mcp_client (GET /api/runs/<id>/mcp and POST /runs/<id>/mcp in serve.py)."""

from __future__ import annotations

import hashlib
import json
import time

import devd_launch
import mcp_inspect
import rails_helpers
import run_chat

RUN_SERVER = "run"
FINISHED = {"merged", "merged-to-parent", "cancelled"}
NAME_LIMIT = mcp_inspect.NAME_LIMIT
URI_LIMIT = mcp_inspect.URI_LIMIT

SETUPS_LIMIT = 12
SETUP_KINDS = {"tool": "tools", "resource": "resources", "prompt": "prompts"}

HELPERS_TTL = 30.0
_helpers_cache: list = [0.0, {}]


def _helpers() -> dict:
    """The Rails helper plugin's settings, read at most every
    HELPERS_TTL seconds: reading them walks the plugin registry, and the run
    list asks for every live run on each scan."""
    now = time.monotonic()
    if _helpers_cache[0] > now:
        return _helpers_cache[1]
    try:
        config = rails_helpers.configuration()
    except Exception:  # a broken package must not take the run list down
        config = {}
    _helpers_cache[:] = [now + HELPERS_TTL, config if isinstance(config, dict) else {}]
    return _helpers_cache[1]


def _paths(meta: dict) -> list[str]:
    """The project checkouts that decide a run's server. A run's own worktree
    shares its project's remote, and asking git about every run's worktree on
    each run-list scan took seconds on a large run store."""
    paths = [meta.get("mainRepoPath") or meta.get("repoPath")]
    paths += [repo.get("mainRepoPath") for repo in meta.get("repositories") or []
              if isinstance(repo, dict)]
    unique: list[str] = []
    for path in paths:
        if isinstance(path, str) and path and path not in unique:
            unique.append(path)
    return unique


def servers(run_id: str, meta: dict) -> list[dict]:
    """Every MCP server the tab offers for a run, in the order it lists them.
    Today that is the run MCP orc-devd answers for a run in one of its
    repositories, the same entry that run's Claude sessions get."""
    if meta.get("status") in FINISHED or meta.get("outcome") == "question":
        return []
    found = run_server(run_id, meta)
    if found is None:
        return []
    name, entry = found
    return [{"id": RUN_SERVER, "name": name, "source": "run", "url": entry["url"],
             "headers": dict(entry.get("headers") or {}), "auto": True}]


def run_server(run_id: str, meta: dict) -> tuple[str, dict] | None:
    """The run MCP entry for a run in a devd repository, as (server name,
    entry), whatever the run's status. The same address without the run's
    header reaches the project's main checkout."""
    config = _helpers()
    for path in _paths(meta):
        found = devd_launch.run_server(run_id, path, config)
        if found is not None:
            return found
    return None


def _public(run_id: str, server: dict) -> dict:
    """A server as the viewer sees it: header values stay on this machine."""
    return {"id": server["id"], "name": server["name"], "source": server["source"],
            "transport": "http", "url": server["url"], "headers": sorted(server["headers"]),
            "auto": server["auto"], "connection": mcp_inspect.connection_for((run_id, server["id"]))}


def close_run(run_id: str, keep: set | None = None) -> int:
    keep = keep or set()
    return mcp_inspect.close_where(lambda key: key[0] == run_id and key[1] not in keep)


def _setup(kind: str, name: str, arguments, server: str, **fields) -> dict:
    digest = hashlib.sha256(json.dumps([server, kind, name, arguments], sort_keys=True).encode()).hexdigest()
    return {"id": digest[:12], "server": server, "kind": kind, "name": name, "arguments": arguments, **fields}


def _recorded(meta: dict, server_ids: list[str]) -> list[dict]:
    """The setups the run recorded in meta.mcpSetups, the way
    worktree.relevantLinks names worktree pages: one tool, resource or prompt
    each, with a title. Entries that do not fit are left out."""
    raw = meta.get("mcpSetups")
    found = []
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        title, server = entry.get("title"), entry.get("server", server_ids[0])
        kinds = [key for key in SETUP_KINDS if key in entry]
        if not mcp_inspect.is_text(title, 80) or server not in server_ids or len(kinds) != 1:
            continue
        name, arguments = entry[kinds[0]], entry.get("arguments", {})
        if (not mcp_inspect.is_text(name, URI_LIMIT if kinds[0] == "resource" else NAME_LIMIT)
                or not isinstance(arguments, dict)
                or (kinds[0] == "prompt" and not all(isinstance(value, str) for value in arguments.values()))
                or not run_chat.mcp_arguments_fit(arguments)):
            continue
        found.append(_setup(SETUP_KINDS[kinds[0]], name, {} if kinds[0] == "resource" else arguments,
                            server, source="run", title=title.strip()))
    return found


def _agent_calls(meta: dict, listed: list[dict]) -> tuple[list[dict], bool]:
    """The calls the run's agent made to each of its servers, newest first,
    and whether its session has more to read."""
    found, more = [], False
    for server in listed:
        try:
            calls, behind = run_chat.mcp_calls(meta, server["name"])
        except Exception:  # an unreadable transcript only costs the agent's calls
            calls, behind = [], False
        more = more or behind
        found += [_setup("tools", call["tool"], call["arguments"], server["id"], source="agent",
                         title=call["tool"], status=call.get("status"), at=call.get("at"))
                  for call in calls]
    return found[::-1], more


def setups(meta: dict, listed: list[dict]) -> tuple[list[dict], bool]:
    """The calls the tab offers to load and run again: those the run recorded,
    then those its agent made, each once; and whether the agent's session has
    more to read, so the tab asks again."""
    if not listed:
        return [], False
    calls, more = _agent_calls(meta, listed)
    chosen, seen = [], set()
    for setup in _recorded(meta, [server["id"] for server in listed]) + calls:
        if setup["id"] not in seen:
            seen.add(setup["id"])
            chosen.append(setup)
    return chosen[:SETUPS_LIMIT], more


def view(run_id: str, meta: dict) -> dict:
    """GET /api/runs/<id>/mcp: the run's servers, their live connections and
    its setups, with `more` while its agent's session is still being read. A
    server the run no longer has loses its connection here."""
    mcp_inspect.SESSIONS.sweep()
    listed = servers(run_id, meta)
    close_run(run_id, keep={server["id"] for server in listed})
    found, more = setups(meta, listed)
    return {"servers": [_public(run_id, server) for server in listed], "setups": found, "more": more}


def sign_in(run_id: str) -> tuple[int, dict]:
    """Starts the sign-in the run's server takes its login from, and answers
    the page to finish it on. orc-devd holds that login and adds it to each
    request, so Orc keeps no token: the tab connects again once it lands."""
    try:
        url = devd_launch.begin_login(run_id)
    except devd_launch.LoginError as exc:
        return 502, {"error": str(exc)}
    return 200, {"ok": True, "url": url}


def act(run_id: str, meta: dict, data: dict, client_info: dict | None = None) -> tuple[int, dict]:
    """POST /runs/<id>/mcp: one inspector action (mcp_inspect.act) on one of
    the run's servers. A suggestion also reads the run's title, so the
    arguments fit the work the run is doing."""
    server = next((item for item in servers(run_id, meta) if item["id"] == data.get("server")), None)
    if server is None:
        return 404, {"error": "This run has no MCP server with that id."}
    if data.get("action") == "sign-in":
        return sign_in(run_id)
    title = meta.get("title")
    context = ["The server belongs to a coding run: %s" % title] if isinstance(title, str) and title else []
    return mcp_inspect.act((run_id, server["id"]), server, data, client_info=client_info, context=context)
