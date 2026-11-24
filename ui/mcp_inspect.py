"""The actions Orc's MCP inspector takes on one MCP server, whoever offers it.

A run's MCP tab (run_mcp) and the MCP client screen (the mcp-client plugin)
both send the same JSON actions: connect, disconnect, list, call, read,
prompt and suggest. Each caller resolves its own server and session key and
hands them to act(); the connections live in one Sessions pool.
"""

from __future__ import annotations

import threading
import time

import mcp_client
import mcp_suggest

SESSIONS = mcp_client.Sessions()

# What a list action names, mapped to the MCP method and its result's field.
LISTS = {
    "tools": ("tools/list", "tools"),
    "resources": ("resources/list", "resources"),
    "templates": ("resources/templates/list", "resourceTemplates"),
    "prompts": ("prompts/list", "prompts"),
}
ACTIONS = {"connect", "disconnect", "list", "call", "read", "prompt", "suggest"}
LIST_TIMEOUT = 30.0
NAME_LIMIT = 512
URI_LIMIT = 8192
# orc-devd gives a forwarded request three minutes; a tool call gets as long.
CALL_TIMEOUT = 180.0
# A 2026-era server sends log messages only to a request that asks for them;
# older servers ignore the key.
LOGS = {"io.modelcontextprotocol/logLevel": "info"}

_schemas: dict = {}
_schemas_lock = threading.Lock()


class BadRequest(ValueError):
    pass


def is_text(value, limit: int) -> bool:
    return isinstance(value, str) and bool(value.strip()) and len(value) <= limit


def _text(data: dict, field: str, limit: int) -> str:
    value = data.get(field)
    if not is_text(value, limit):
        raise BadRequest("%s must be a non-empty string of at most %d characters" % (field, limit))
    return value


def _object(data: dict, field: str, strings: bool = False) -> dict:
    value = data.get(field, {})
    if not isinstance(value, dict):
        raise BadRequest("%s must be an object" % field)
    if strings and not all(isinstance(item, str) for item in value.values()):
        raise BadRequest("every prompt argument must be a string")
    return value


def connection(conn) -> dict | None:
    """A live connection as the inspector shows it, or None."""
    info = conn.info if conn is not None and not conn.closed else None
    if not info:
        return None
    return {"era": info.get("era"), "protocolVersion": info.get("protocolVersion"),
            "serverInfo": info.get("serverInfo"), "capabilities": info.get("capabilities") or {},
            "instructions": info.get("instructions")}


def connection_for(key) -> dict | None:
    return connection(SESSIONS.get(key))


def close_where(predicate) -> int:
    """Ends every connection whose key matches, forgetting its tool schemas."""
    with _schemas_lock:
        for key in [key for key in _schemas if predicate(key)]:
            del _schemas[key]
    return SESSIONS.close_where(predicate)


def _remember_tools(key, tools: list) -> dict:
    schemas = {tool["name"]: tool.get("inputSchema") for tool in tools
               if isinstance(tool, dict) and isinstance(tool.get("name"), str)}
    with _schemas_lock:
        _schemas[key] = schemas
    return schemas


def _tool_headers(key, conn, name: str, arguments: dict) -> dict:
    """The Mcp-Param-* headers a 2026-era tools/call needs, from the tool's
    input schema. A server that has not listed its tools since Orc started is
    asked for them first: a missing header fails the call."""
    if (conn.info or {}).get("era") != "modern":
        return {}
    with _schemas_lock:
        schemas = _schemas.get(key)
    if schemas is None or name not in schemas:
        schemas = _remember_tools(key, conn.list_all("tools/list", "tools", timeout=LIST_TIMEOUT)["items"])
    schema = schemas.get(name)
    return mcp_client.param_headers(schema, arguments) if schema else {}


def _suggest(key, server: dict, data: dict, context: list[str]) -> tuple[int, dict]:
    """Arguments a fast model proposes for one tool or prompt. Nothing is
    called: the inspector puts them in the form for the person to check."""
    try:
        request = mcp_suggest.Request.parse(data)
    except mcp_suggest.BadRequest as exc:
        return 400, {"error": str(exc)}
    info = connection_for(key) or {}
    started = time.monotonic()
    try:
        arguments = mcp_suggest.suggest(request, server=server.get("name") or "",
                                        instructions=info.get("instructions"), context=context)
    except mcp_suggest.SuggestError as exc:
        return 409, {"error": str(exc), "retryable": True}
    return 200, {"ok": True, "arguments": arguments, "ms": (time.monotonic() - started) * 1000}


def act(key, server: dict, data: dict, *, client_info: dict | None = None,
        context: list[str] | None = None) -> tuple[int, dict]:
    """One inspector action on ``server`` ({name, url, headers}), as (HTTP
    status, body). Any action but disconnect and suggest connects first when
    the server has no live connection under ``key``. A JSON-RPC error is a 200
    with `ok: false`: it is the server's answer, and the inspector shows it
    like a result. A transport failure is a 502 carrying `auth` and the
    server's sign-in `challenge` when it wants one."""
    SESSIONS.sweep()
    action = data.get("action")
    if action not in ACTIONS:
        return 400, {"error": "action must be one of: %s" % ", ".join(sorted(ACTIONS))}
    if action == "disconnect":
        with _schemas_lock:
            _schemas.pop(key, None)
        SESSIONS.close(key)
        return 200, {"ok": True, "connection": None}
    if action == "suggest":
        return _suggest(key, server, data, context or [])
    try:
        if action == "call":
            name, arguments = _text(data, "tool", NAME_LIMIT), _object(data, "arguments")
        elif action == "read":
            uri = _text(data, "uri", URI_LIMIT)
        elif action == "prompt":
            name, arguments = _text(data, "name", NAME_LIMIT), _object(data, "arguments", strings=True)
        elif action == "list" and data.get("what") not in LISTS:
            raise BadRequest("what must be one of: %s" % ", ".join(sorted(LISTS)))
    except BadRequest as exc:
        return 400, {"error": str(exc)}
    started = time.monotonic()
    conn = None
    try:
        conn = SESSIONS.connect(key, server["url"], server.get("headers") or {},
                                fresh=action == "connect" and data.get("fresh") is True,
                                client_info=client_info)
        if action == "connect":
            return 200, {"ok": True, "connection": connection(conn)}
        if action == "list":
            method, field = LISTS[data["what"]]
            reply = conn.list_all(method, field, timeout=LIST_TIMEOUT)
            if data["what"] == "tools":
                _remember_tools(key, reply["items"])
        elif action == "call":
            reply = conn.request("tools/call", {"name": name, "arguments": arguments, "_meta": dict(LOGS)},
                                 timeout=CALL_TIMEOUT, headers=_tool_headers(key, conn, name, arguments))
        elif action == "read":
            reply = conn.request("resources/read", {"uri": uri, "_meta": dict(LOGS)}, timeout=LIST_TIMEOUT)
        else:
            reply = conn.request("prompts/get", {"name": name, "arguments": arguments, "_meta": dict(LOGS)},
                                 timeout=LIST_TIMEOUT)
        return 200, {"ok": True, **reply, "connection": connection(conn)}
    except mcp_client.McpError as exc:
        return 200, {"ok": False, "error": exc.as_dict(), "notifications": exc.notifications,
                     "ms": (time.monotonic() - started) * 1000, "connection": connection(conn)}
    except mcp_client.TransportError as exc:
        return 502, {"error": str(exc), "auth": exc.auth, "challenge": exc.challenge, "timeout": exc.timeout,
                     "connection": connection(conn)}
