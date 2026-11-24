"""A standard-library MCP client over Streamable HTTP for Orc's MCP tab.

Orc's server is the MCP client; the browser only talks to Orc. Protocol details
follow the official Python SDK (mcp 2.3.0): connect-time era negotiation from
``mcp/client/_probe.py``, request stamping from ``mcp/client/session.py`` and
status handling from ``mcp/client/streamable_http.py``. No stdio. OAuth lives in
mcp_oauth: a 401's TransportError carries the server's challenge for it.
"""

from __future__ import annotations

import base64
import http.client
import itertools
import json
import re
import socket
import ssl
import threading
import time
import urllib.parse
from collections.abc import Mapping

__all__ = [
    "Connection",
    "McpError",
    "Sessions",
    "TransportError",
    "param_headers",
]

HANDSHAKE_PROTOCOL_VERSIONS = ("2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25")
MODERN_PROTOCOL_VERSIONS = ("2026-07-28",)
LATEST_HANDSHAKE_VERSION = HANDSHAKE_PROTOCOL_VERSIONS[-1]
LATEST_MODERN_VERSION = MODERN_PROTOCOL_VERSIONS[-1]
DISCOVER_TIMEOUT_SECONDS = 10.0
SESSION_DELETE_TIMEOUT_SECONDS = 3.0
SIDE_POST_TIMEOUT_SECONDS = 5.0
MAX_BODY_BYTES = 16 * 1024 * 1024
MAX_LIST_PAGES = 50

UNSUPPORTED_PROTOCOL_VERSION = -32022
METHOD_NOT_FOUND = -32601

PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion"
CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo"
CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities"
SERVER_INFO_META_KEY = "io.modelcontextprotocol/serverInfo"

PROTOCOL_VERSION_HEADER = "MCP-Protocol-Version"
METHOD_HEADER = "Mcp-Method"
NAME_HEADER = "Mcp-Name"
SESSION_HEADER = "Mcp-Session-Id"
PARAM_HEADER_PREFIX = "Mcp-Param-"
NAME_BEARING_METHODS = {"tools/call": "name", "prompts/get": "name", "resources/read": "uri"}

DEFAULT_CLIENT_INFO = {"name": "orc", "version": "1.0"}
EXCERPT_CHARS = 300


class McpError(Exception):
    """A JSON-RPC error object the server returned."""

    def __init__(self, code: int, message: str, data: object | None = None, *, http_status: int | None = None):
        self.code = code
        self.message = message
        self.data = data
        self.http_status = http_status
        self.notifications: list[dict] = []
        text = message.strip() or "no message"
        super().__init__(f"The server answered with error {code}: {_sentence(text)}")

    def as_dict(self) -> dict:
        out: dict = {"code": self.code, "message": self.message}
        if self.data is not None:
            out["data"] = self.data
        return out


class TransportError(Exception):
    """The server could not be reached, timed out, or answered outside the protocol."""

    def __init__(self, message: str, *, status: int | None = None, detail: str = "", auth: bool = False,
                 timeout: bool = False, challenge: str | None = None):
        super().__init__(message)
        self.status = status
        self.detail = detail
        self.auth = auth
        self.timeout = timeout
        # The WWW-Authenticate header of a 401 or 403, which says where to sign in.
        self.challenge = challenge


def _sentence(text: str) -> str:
    return text if text[-1:] in ".!?" else text + "."


def _seconds(value: float) -> str:
    shown = f"{value:g}"
    return f"{shown} second" if shown == "1" else f"{shown} seconds"


def _excerpt(raw: bytes | str) -> str:
    text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
    text = text.strip()
    return text if len(text) <= EXCERPT_CHARS else text[:EXCERPT_CHARS] + "…"


def _first_line(raw: bytes, content_type: str) -> str:
    text = raw.decode("utf-8", "replace")
    if "html" in content_type:
        text = re.sub(r"(?s)<(script|style)\b.*?</\1>", " ", text)
        text = re.sub(r"<[^>]+>", "\n", text)
    for line in text.splitlines():
        line = " ".join(line.split())
        if line:
            return line if len(line) <= EXCERPT_CHARS else line[:EXCERPT_CHARS] + "…"
    return ""


def _put(headers: dict[str, str], name: str, value: str) -> None:
    for existing in [k for k in headers if k.lower() == name.lower()]:
        del headers[existing]
    headers[name] = value


def _merge(headers: dict[str, str], extra: Mapping[str, str] | None) -> None:
    for name, value in (extra or {}).items():
        # The local proxy in front of run servers lends the user's login only to
        # loopback requests without Origin, so Orc never sends one.
        if name.lower() != "origin":
            _put(headers, name, str(value))


def _error_object(payload: object) -> dict | None:
    candidates = payload if isinstance(payload, list) else [payload]
    for item in candidates:
        if isinstance(item, dict) and isinstance(item.get("error"), dict):
            error = item["error"]
            if isinstance(error.get("code"), int) and not isinstance(error.get("code"), bool):
                return error
    return None


def _mcp_error(error: dict, http_status: int | None) -> McpError:
    message = error.get("message")
    return McpError(error["code"], message if isinstance(message, str) else "", error.get("data"),
                    http_status=http_status)


def _same_id(left: object, right: object) -> bool:
    return left == right or str(left) == str(right)


def _supported_versions(data: object) -> list[str] | None:
    if isinstance(data, dict) and isinstance(data.get("supported"), list):
        return [v for v in data["supported"] if isinstance(v, str)]
    return None


def _server_info_stamp(result: Mapping) -> dict | None:
    meta = result.get("_meta")
    stamp = meta.get(SERVER_INFO_META_KEY) if isinstance(meta, Mapping) else None
    if isinstance(stamp, Mapping) and isinstance(stamp.get("name"), str) and isinstance(stamp.get("version"), str):
        return dict(stamp)
    return None


# --- Mcp-Param-* headers, ported from mcp/shared/inbound.py -------------------

_HEADER_SAFE = re.compile(r"^[\x20-\x7E]*$")
_B64_SENTINEL = re.compile(r"^=\?base64\?(?P<payload>.*)\?=$")
_RFC9110_TOKEN = re.compile(r"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$")
_X_MCP_HEADER_KEY = "x-mcp-header"
_X_MCP_HEADER_TYPES = frozenset({"string", "integer", "boolean"})
_SUBSCHEMA_SINGLE = frozenset({
    "items", "contains", "unevaluatedItems", "additionalProperties", "propertyNames",
    "unevaluatedProperties", "not", "if", "then", "else", "contentSchema",
})
_SUBSCHEMA_LIST = frozenset({"allOf", "anyOf", "oneOf", "prefixItems"})
_SUBSCHEMA_MAP = frozenset({"patternProperties", "dependentSchemas", "$defs", "definitions"})


def encode_header_value(value: str) -> str:
    if _HEADER_SAFE.fullmatch(value) and value == value.strip() and not _B64_SENTINEL.fullmatch(value):
        return value
    return f"=?base64?{base64.b64encode(value.encode('utf-8')).decode('ascii')}?="


def _schema_positions(root: object):
    stack: list[tuple[tuple[str, ...] | None, object]] = [((), root)]
    while stack:
        path, node = stack.pop()
        if not isinstance(node, Mapping):
            continue
        yield path, node
        for keyword, value in node.items():
            if keyword == "properties" and isinstance(value, Mapping):
                for name, sub in value.items():
                    stack.append(((*path, name) if path is not None else None, sub))
            elif keyword in _SUBSCHEMA_SINGLE:
                stack.append((None, value))
            elif keyword in _SUBSCHEMA_LIST and isinstance(value, list):
                stack.extend((None, sub) for sub in value)
            elif keyword in _SUBSCHEMA_MAP and isinstance(value, Mapping):
                stack.extend((None, sub) for sub in value.values())


def _x_mcp_headers(input_schema: object) -> tuple[dict[tuple[str, ...], str], str | None]:
    """The annotated property paths with their header tokens, or why an
    annotation is invalid: a modern-era client drops such a tool."""
    seen: dict[str, str] = {}
    found: dict[tuple[str, ...], str] = {}
    for path, schema in _schema_positions(input_schema):
        if _X_MCP_HEADER_KEY not in schema:
            continue
        if not path:
            return {}, "an x-mcp-header sits outside the schema's plain properties"
        where = ".".join(path)
        token = schema[_X_MCP_HEADER_KEY]
        if not isinstance(token, str) or not _RFC9110_TOKEN.fullmatch(token):
            return {}, f"the x-mcp-header on {where!r} is not a header name"
        kind = schema.get("type")
        if not isinstance(kind, str) or kind not in _X_MCP_HEADER_TYPES:
            return {}, f"the x-mcp-header on {where!r} is on a property that is not a string, integer or boolean"
        if token.lower() in seen:
            first, second = sorted((seen[token.lower()], where))
            return {}, f"the properties {first!r} and {second!r} have the same x-mcp-header"
        seen[token.lower()] = where
        found[path] = token
    return found, None


def _without_invalid_tools(tools: list) -> tuple[list, list[dict]]:
    """A modern-era tool listing less the tools whose x-mcp-header annotations
    are invalid, which clients must drop, and each dropped tool's name and
    reason."""
    kept: list = []
    dropped: list[dict] = []
    for tool in tools:
        problem = _x_mcp_headers(tool.get("inputSchema"))[1] if isinstance(tool, Mapping) else None
        if problem is None:
            kept.append(tool)
        else:
            name = tool.get("name")
            dropped.append({"name": name if isinstance(name, str) else "", "reason": problem})
    return kept, dropped


def _render_header_scalar(value: object) -> str | None:
    if isinstance(value, bool):
        return "true" if value else "false"
    if not isinstance(value, (str, int, float)):
        return None
    try:
        return str(value)
    except ValueError:
        return None


def param_headers(input_schema: Mapping | None, arguments: Mapping | None) -> dict[str, str]:
    """The ``Mcp-Param-*`` headers a modern-era tools/call carries for ``x-mcp-header`` properties."""
    if not isinstance(input_schema, Mapping) or not isinstance(arguments, Mapping):
        return {}
    header_map, problem = _x_mcp_headers(input_schema)
    if problem or not header_map:
        return {}
    headers: dict[str, str] = {}
    for path, token in header_map.items():
        node: object = arguments
        for key in path:
            node = node.get(key) if isinstance(node, Mapping) else None
        rendered = None if node is None else _render_header_scalar(node)
        if rendered is not None:
            headers[PARAM_HEADER_PREFIX + token] = encode_header_value(rendered)
    return headers


# --- Connection ----------------------------------------------------------------

_EOL = re.compile(rb"[\r\n]")


class Connection:
    """One negotiated MCP connection to a Streamable HTTP endpoint."""

    def __init__(self, url: str, headers: Mapping[str, str] | None = None, *,
                 client_info: Mapping[str, object] | None = None, timeout: float = 30.0):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise TransportError(f"{url} is not an http or https URL.")
        self.url = url
        self.headers: dict[str, str] = {}
        _merge(self.headers, headers)
        self.client_info = dict(client_info) if client_info else dict(DEFAULT_CLIENT_INFO)
        self.timeout = float(timeout)
        self.info: dict | None = None
        self.closed = False
        self.last_used = time.monotonic()
        self._https = parts.scheme == "https"
        self._host = parts.hostname
        self._port = parts.port
        self._target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        self._era: str | None = None
        self._version: str | None = None
        self._session_id: str | None = None
        self._session_gen = 0
        self._state = threading.Lock()
        self._negotiation = threading.RLock()
        self._ids = itertools.count(1)
        self._live: set[socket.socket] = set()

    # -- public API --

    def connect(self) -> dict:
        with self._negotiation:
            if self.closed:
                raise TransportError("This MCP connection is closed.")
            if self.info is None:
                self.info = self._negotiate()
            return self.info

    def request(self, method: str, params: dict | None = None, *, timeout: float | None = None,
                headers: Mapping[str, str] | None = None) -> dict:
        if self.closed:
            raise TransportError("This MCP connection is closed.")
        self.connect()
        started = time.monotonic()
        self.last_used = started
        wait = self.timeout if timeout is None else float(timeout)
        request_id = self._next_id()
        params = dict(params) if params is not None else None
        if method == "tools/call":
            params = params if params is not None else {}
            meta = dict(params.get("_meta") or {})
            meta.setdefault("progressToken", request_id)
            params["_meta"] = meta
        for attempt in (0, 1):
            generation, message, request_headers = self._stamp(method, params, request_id, headers)
            notifications: list[dict] = []
            try:
                reply, notifications = self._exchange(message, request_headers, wait, method)
                result = self._settle(reply, method)
            except (McpError, TransportError) as exc:
                if attempt == 0 and self._session_expired(exc, request_headers):
                    self._renew_session(generation)
                    continue
                if isinstance(exc, McpError):
                    exc.notifications = notifications
                if isinstance(exc, TransportError) and exc.timeout:
                    self._cancel_later(request_id, wait)
                raise
            return {"result": result, "notifications": notifications,
                    "ms": round((time.monotonic() - started) * 1000, 1)}
        raise AssertionError("unreachable")

    def list_all(self, method: str, key: str, *, limit: int = 1000, timeout: float | None = None) -> dict:
        started = time.monotonic()
        items: list = []
        notifications: list = []
        cursor = None
        truncated = False
        for page in range(MAX_LIST_PAGES):
            reply = self.request(method, {"cursor": cursor} if cursor else None, timeout=timeout)
            notifications.extend(reply["notifications"])
            result = reply["result"] if isinstance(reply["result"], dict) else {}
            page_items = result.get(key)
            items.extend(page_items if isinstance(page_items, list) else [])
            next_cursor = result.get("nextCursor")
            cursor = next_cursor if isinstance(next_cursor, str) and next_cursor else None
            if len(items) >= limit:
                truncated = len(items) > limit or cursor is not None
                items = items[:limit]
                break
            if cursor is None:
                break
            if page == MAX_LIST_PAGES - 1:
                truncated = True
        dropped: list[dict] = []
        if method == "tools/list" and (self.info or {}).get("era") == "modern":
            items, dropped = _without_invalid_tools(items)
        return {"items": items, "truncated": truncated, "dropped": dropped, "notifications": notifications,
                "ms": round((time.monotonic() - started) * 1000, 1)}

    def close(self) -> None:
        try:
            with self._state:
                if self.closed:
                    return
                self.closed = True
                era, session_id, live = self._era, self._session_id, list(self._live)
            for sock in live:
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            if era == "handshake" and session_id:
                self._delete_session(session_id)
        except Exception:
            pass

    # -- negotiation (mirrors negotiate_auto in mcp/client/_probe.py) --

    def _negotiate(self) -> dict:
        version = LATEST_MODERN_VERSION
        for attempt in range(2):
            try:
                result = self._discover(version)
            except McpError as exc:
                if exc.code == UNSUPPORTED_PROTOCOL_VERSION:
                    supported = _supported_versions(exc.data)
                    mutual = [v for v in MODERN_PROTOCOL_VERSIONS if v in (supported or ())]
                    if mutual and attempt == 0:
                        version = mutual[-1]
                        continue
                    if supported is not None and not any(v in HANDSHAKE_PROTOCOL_VERSIONS for v in supported):
                        raise
                reprobe = self._handshake_or_reprobe(attempt)
            except TransportError as exc:
                # The SDK's transport turns every HTTP-level rejection into an RPC
                # error, which falls back; only network failures propagate.
                if not exc.timeout and exc.status is None:
                    raise
                reprobe = self._handshake_or_reprobe(attempt)
            else:
                supported = result.get("supportedVersions") if isinstance(result, dict) else None
                mutual = [v for v in MODERN_PROTOCOL_VERSIONS if isinstance(supported, list) and v in supported]
                if not mutual:
                    return self._initialize()
                return self._adopt_modern(result, mutual[-1])
            if isinstance(reprobe, dict):
                return reprobe
            version = reprobe
        raise AssertionError("unreachable")

    def _handshake_or_reprobe(self, attempt: int) -> dict | str:
        """The handshake info, or the modern version to re-probe at when initialize answers -32022."""
        try:
            return self._initialize()
        except McpError as exc:
            # A probe that timed out here but succeeded on a slow-starting server
            # locks it modern, so it answers this initialize with -32022.
            if exc.code != UNSUPPORTED_PROTOCOL_VERSION or attempt != 0:
                raise
            mutual = [v for v in MODERN_PROTOCOL_VERSIONS if v in (_supported_versions(exc.data) or ())]
            if not mutual:
                raise
            return mutual[-1]

    def _envelope(self, version: str) -> dict:
        return {
            PROTOCOL_VERSION_META_KEY: version,
            CLIENT_INFO_META_KEY: dict(self.client_info),
            CLIENT_CAPABILITIES_META_KEY: {},
        }

    def _discover(self, version: str) -> dict:
        message = {"jsonrpc": "2.0", "id": self._next_id(), "method": "server/discover",
                   "params": {"_meta": self._envelope(version)}}
        headers = self._base_headers()
        headers[PROTOCOL_VERSION_HEADER] = version
        headers[METHOD_HEADER] = "server/discover"
        reply, _ = self._exchange(message, headers, min(self.timeout, DISCOVER_TIMEOUT_SECONDS), "server/discover")
        return self._settle(reply, "server/discover")

    def _adopt_modern(self, result: dict, version: str) -> dict:
        with self._state:
            self._era, self._version, self._session_id = "modern", version, None
            self._session_gen += 1
        capabilities = result.get("capabilities")
        instructions = result.get("instructions")
        return {"era": "modern", "protocolVersion": version, "serverInfo": _server_info_stamp(result),
                "capabilities": capabilities if isinstance(capabilities, dict) else {},
                "instructions": instructions if isinstance(instructions, str) else None}

    def _initialize(self) -> dict:
        message = {"jsonrpc": "2.0", "id": self._next_id(), "method": "initialize",
                   "params": {"protocolVersion": LATEST_HANDSHAKE_VERSION, "capabilities": {},
                              "clientInfo": dict(self.client_info)}}
        try:
            reply, _, response_headers = self._exchange(message, self._base_headers(), self.timeout, "initialize",
                                                        with_headers=True)
        except (McpError, TransportError) as exc:
            status = exc.http_status if isinstance(exc, McpError) else exc.status
            if status in (404, 405):
                raise TransportError(
                    f"{self.url} answered {status} to an MCP initialize POST, so it does not take "
                    "Streamable HTTP MCP requests at that URL.",
                    status=status, detail=exc.detail if isinstance(exc, TransportError) else exc.message,
                ) from exc
            raise
        result = self._settle(reply, "initialize")
        version = result.get("protocolVersion") if isinstance(result, dict) else None
        if version not in HANDSHAKE_PROTOCOL_VERSIONS:
            raise TransportError(f"The server chose MCP protocol version {version!r}, which Orc's MCP client "
                                 "does not speak.", status=200, detail=_excerpt(json.dumps(result)))
        session_id = response_headers.get(SESSION_HEADER.lower()) or None
        with self._state:
            self._era, self._version, self._session_id = "handshake", version, session_id
            self._session_gen += 1
        notification = {"jsonrpc": "2.0", "method": "notifications/initialized"}
        self._exchange(notification, self._protocol_headers(version, session_id), self.timeout,
                       "notifications/initialized")
        capabilities = result.get("capabilities")
        server_info = result.get("serverInfo")
        instructions = result.get("instructions")
        return {"era": "handshake", "protocolVersion": version,
                "serverInfo": server_info if isinstance(server_info, dict) else None,
                "capabilities": capabilities if isinstance(capabilities, dict) else {},
                "instructions": instructions if isinstance(instructions, str) else None}

    def _session_expired(self, exc: Exception, sent_headers: Mapping[str, str]) -> bool:
        status = exc.http_status if isinstance(exc, McpError) else getattr(exc, "status", None)
        return status == 404 and SESSION_HEADER in sent_headers and not self.closed

    def _renew_session(self, generation: int) -> None:
        with self._negotiation:
            with self._state:
                if self._session_gen != generation:
                    return
            self.info = self._initialize()

    # -- stamping --

    def _next_id(self) -> int:
        with self._state:
            return next(self._ids)

    def _base_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
                   "User-Agent": "orc-mcp-client"}
        _merge(headers, self.headers)
        _put(headers, "Content-Type", "application/json")
        _put(headers, "Accept", "application/json, text/event-stream")
        return headers

    def _protocol_headers(self, version: str | None, session_id: str | None) -> dict[str, str]:
        headers = self._base_headers()
        if version:
            _put(headers, PROTOCOL_VERSION_HEADER, version)
        if session_id:
            _put(headers, SESSION_HEADER, session_id)
        return headers

    def _stamp(self, method: str, params: dict | None, request_id: int,
               extra: Mapping[str, str] | None) -> tuple[int, dict, dict[str, str]]:
        with self._state:
            era, version, session_id, generation = self._era, self._version, self._session_id, self._session_gen
        message: dict = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if era == "modern":
            params = dict(params or {})
            caller_meta = params.get("_meta")
            meta = dict(caller_meta) if isinstance(caller_meta, Mapping) else {}
            meta.update(self._envelope(version or LATEST_MODERN_VERSION))
            params["_meta"] = meta
            headers = self._protocol_headers(version, None)
            _put(headers, METHOD_HEADER, method)
            name = params.get(NAME_BEARING_METHODS.get(method, ""))
            if method in NAME_BEARING_METHODS and isinstance(name, str):
                _put(headers, NAME_HEADER, encode_header_value(name))
        else:
            headers = self._protocol_headers(version, session_id)
        if params is not None:
            message["params"] = params
        _merge(headers, extra)
        return generation, message, headers

    def _answer_headers(self) -> dict[str, str]:
        with self._state:
            version, session_id = self._version, self._session_id if self._era == "handshake" else None
        return self._protocol_headers(version, session_id)

    # -- side posts --

    def _cancel_later(self, request_id: int, waited: float) -> None:
        # Modern HTTP has no client-to-server notifications; dropping the POST is
        # the cancellation there.
        with self._state:
            if self._era != "handshake" or self.closed:
                return
        headers = self._answer_headers()
        notification = {"jsonrpc": "2.0", "method": "notifications/cancelled",
                        "params": {"requestId": request_id, "reason": f"Timed out after {_seconds(waited)}"}}
        thread = threading.Thread(target=self._post_quietly, args=(notification, headers), daemon=True,
                                  name="mcp-cancel")
        thread.start()

    def _post_quietly(self, message: dict, headers: dict[str, str]) -> None:
        try:
            self._exchange(message, headers, SIDE_POST_TIMEOUT_SECONDS, str(message.get("method") or "response"))
        except Exception:
            pass

    def _answer_server_request(self, message: dict) -> None:
        if message.get("method") == "ping":
            answer = {"jsonrpc": "2.0", "id": message["id"], "result": {}}
        else:
            answer = {"jsonrpc": "2.0", "id": message["id"],
                      "error": {"code": METHOD_NOT_FOUND, "message": "Method not found", "data": message.get("method")}}
        self._post_quietly(answer, self._answer_headers())

    def _delete_session(self, session_id: str) -> None:
        conn = None
        try:
            conn = self._new_http(SESSION_DELETE_TIMEOUT_SECONDS)
            conn.request("DELETE", self._target, headers=self._protocol_headers(self._version, session_id))
            conn.getresponse().read(65536)
        except Exception:
            pass
        finally:
            if conn is not None:
                conn.close()

    # -- HTTP --

    def _new_http(self, timeout: float) -> http.client.HTTPConnection:
        if self._https:
            return http.client.HTTPSConnection(self._host, self._port, timeout=timeout,
                                               context=ssl.create_default_context())
        return http.client.HTTPConnection(self._host, self._port, timeout=timeout)

    def _exchange(self, message: dict, headers: dict[str, str], timeout: float, label: str, *,
                  with_headers: bool = False):
        """POST one JSON-RPC message; for a request return its response message and notifications."""
        deadline = time.monotonic() + timeout
        conn = self._new_http(max(timeout, 0.001))
        sock = None
        try:
            try:
                conn.connect()
                sock = conn.sock
                with self._state:
                    self._live.add(sock)
                body = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                conn.request("POST", self._target, body=body, headers=headers)
                self._arm(sock, deadline)
                response = conn.getresponse()
                reply, notifications = self._read_reply(message, response, sock, deadline, label)
            except (OSError, http.client.HTTPException) as exc:
                raise self._network_error(exc, label, timeout) from exc
            if with_headers:
                return reply, notifications, {k.lower(): v for k, v in response.getheaders()}
            return reply, notifications
        finally:
            if sock is not None:
                with self._state:
                    self._live.discard(sock)
            conn.close()

    @staticmethod
    def _arm(sock, deadline: float) -> None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("deadline passed")
        sock.settimeout(remaining)

    def _read_chunk(self, response, sock, deadline: float) -> bytes:
        # http.client closes the socket itself once a sized body is fully read.
        if response.isclosed():
            return b""
        self._arm(sock, deadline)
        return response.read1(65536)

    def _network_error(self, exc: BaseException, label: str, timeout: float) -> TransportError:
        detail = str(exc) or type(exc).__name__
        if isinstance(exc, (TimeoutError, socket.timeout)):
            return TransportError(f"The server did not answer {label} within {_seconds(timeout)}.",
                                  detail=detail, timeout=True)
        if self.closed:
            return TransportError(f"The MCP connection was closed while waiting for {label}.", detail=detail)
        if isinstance(exc, ConnectionRefusedError):
            return TransportError(f"Nothing answered at {self.url} (connection refused).", detail=detail)
        if isinstance(exc, socket.gaierror):
            return TransportError(f"Could not find the host {self._host} for {self.url} "
                                  f"({exc.strerror or detail}).", detail=detail)
        if isinstance(exc, ssl.SSLError):
            reason = getattr(exc, "verify_message", None) or exc.reason or detail
            return TransportError(f"The secure connection to {self.url} failed ({reason}).", detail=detail)
        if isinstance(exc, (http.client.HTTPException, ConnectionResetError, BrokenPipeError)):
            return TransportError(f"The connection to {self.url} closed before the server answered {label}.",
                                  detail=detail)
        reason = getattr(exc, "strerror", None) or detail
        return TransportError(f"Could not reach {self.url} ({reason}).", detail=detail)

    def _read_reply(self, message: dict, response, sock, deadline: float, label: str):
        status = response.status
        content_type = (response.getheader("Content-Type") or "").split(";")[0].strip().lower()
        if status >= 300:
            raw = self._read_body(response, sock, deadline, label)
            error = _error_object(_loads(raw))
            if error is not None:
                raise _mcp_error(error, status)
            raise self._status_error(status, response, raw, content_type)
        if not ("method" in message and "id" in message):
            return None, []
        if status in (202, 204):
            raise TransportError(f"The server accepted {label} but sent no answer to it.", status=status)
        if content_type == "text/event-stream":
            return self._read_stream(message["id"], response, sock, deadline, label, status)
        raw = self._read_body(response, sock, deadline, label)
        payload = _loads(raw)
        if payload is _NOT_JSON:
            raise TransportError(f"The server answered {label} with something that is not MCP JSON.",
                                 status=status, detail=_excerpt(raw))
        if isinstance(payload, list):
            matches = [m for m in payload if isinstance(m, dict) and _same_id(m.get("id"), message["id"])]
            payload = matches[0] if matches else None
        return payload, []

    def _status_error(self, status: int, response, raw: bytes, content_type: str) -> TransportError:
        detail = _excerpt(raw)
        if status in (401, 403):
            return TransportError(f"The server answered {status}: it needs you to sign in.", status=status,
                                  detail=detail, auth=True, challenge=response.getheader("WWW-Authenticate"))
        if 300 <= status < 400:
            location = response.getheader("Location") or "another address"
            return TransportError(f"The server answered {status} and redirects to {location}; use that URL if "
                                  "it is the MCP endpoint.", status=status, detail=detail)
        line = _first_line(raw, content_type)
        if line:
            return TransportError(f"The server answered {status}: {line}", status=status, detail=detail)
        reason = f" {response.reason}" if response.reason else ""
        return TransportError(f"The server answered {status}{reason}.", status=status, detail=detail)

    def _oversize(self, label: str) -> TransportError:
        return TransportError(f"The server's answer to {label} is larger than {MAX_BODY_BYTES // (1024 * 1024)} "
                              "MiB, so Orc stopped reading it.")

    def _read_body(self, response, sock, deadline: float, label: str) -> bytes:
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = self._read_chunk(response, sock, deadline)
            if not chunk:
                return b"".join(chunks)
            total += len(chunk)
            if total > MAX_BODY_BYTES:
                raise self._oversize(label)
            chunks.append(chunk)

    def _lines(self, response, sock, deadline: float, label: str):
        buffer = bytearray()
        total = 0
        scan = 0
        while True:
            match = _EOL.search(buffer, scan)
            if match is not None:
                at = match.start()
                if buffer[at] == 0x0D and at + 1 == len(buffer):
                    scan = at
                else:
                    end = at + (2 if buffer[at:at + 2] == b"\r\n" else 1)
                    line = bytes(buffer[:at]).decode("utf-8", "replace")
                    del buffer[:end]
                    scan = 0
                    yield line
                    continue
            else:
                scan = len(buffer)
            chunk = self._read_chunk(response, sock, deadline)
            if not chunk:
                if buffer:
                    yield bytes(buffer).rstrip(b"\r").decode("utf-8", "replace")
                return
            total += len(chunk)
            if total > MAX_BODY_BYTES:
                raise self._oversize(label)
            buffer += chunk

    def _events(self, response, sock, deadline: float, label: str):
        data: list[str] = []
        for line in self._lines(response, sock, deadline, label):
            if not line:
                if data:
                    yield "\n".join(data)
                    data = []
                continue
            if line.startswith(":"):
                continue
            field, _, value = line.partition(":")
            if field == "data":
                data.append(value[1:] if value.startswith(" ") else value)
        if data:
            yield "\n".join(data)

    def _read_stream(self, request_id: int, response, sock, deadline: float, label: str, status: int):
        notifications: list[dict] = []
        for data in self._events(response, sock, deadline, label):
            if not data.strip():
                continue
            payload = _loads(data.encode("utf-8"))
            if payload is _NOT_JSON:
                raise TransportError(f"The server sent an event for {label} that is not JSON.", status=status,
                                     detail=_excerpt(data))
            for item in payload if isinstance(payload, list) else [payload]:
                if not isinstance(item, dict):
                    continue
                if "method" in item:
                    if "id" in item:
                        self._answer_server_request(item)
                    else:
                        notifications.append({"method": item["method"], "params": item.get("params")})
                elif ("result" in item or "error" in item) and (
                        item.get("id") is None or _same_id(item.get("id"), request_id)):
                    return item, notifications
        raise TransportError(f"The server ended its event stream before answering {label}.", status=status)

    def _settle(self, reply: object, label: str):
        if isinstance(reply, dict):
            if isinstance(reply.get("error"), dict):
                error = _error_object(reply)
                if error is not None:
                    raise _mcp_error(error, None)
            elif "result" in reply:
                return reply["result"]
        raise TransportError(f"The server's answer to {label} is not a JSON-RPC response.",
                             detail=_excerpt(json.dumps(reply, default=str)))


_NOT_JSON = object()


def _loads(raw: bytes):
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return _NOT_JSON


# --- Sessions ------------------------------------------------------------------


def _header_spec(headers: Mapping[str, str] | None) -> tuple:
    return tuple(sorted((str(k).lower(), str(v)) for k, v in (headers or {}).items()))


class Sessions:
    """Live connections by caller-chosen hashable key."""

    def __init__(self, *, idle_seconds: float = 900.0, clock=time.monotonic, factory=Connection):
        self.idle_seconds = idle_seconds
        self._clock = clock
        self._factory = factory
        self._lock = threading.Lock()
        self._key_locks: dict = {}
        self._connections: dict = {}
        self._specs: dict = {}

    def _key_lock(self, key) -> threading.Lock:
        with self._lock:
            return self._key_locks.setdefault(key, threading.Lock())

    def _pop(self, key):
        with self._lock:
            self._specs.pop(key, None)
            return self._connections.pop(key, None)

    def connect(self, key, url: str, headers: Mapping[str, str] | None = None, *, fresh: bool = False,
                client_info: Mapping | None = None) -> Connection:
        spec = (url, _header_spec(headers))
        with self._key_lock(key):
            with self._lock:
                current = self._connections.get(key)
                current_spec = self._specs.get(key)
            if current is not None and not current.closed and not fresh and current_spec == spec:
                return current
            old = self._pop(key)
            if old is not None:
                old.close()
            connection = self._factory(url, headers, client_info=client_info)
            try:
                connection.connect()
            except BaseException:
                connection.close()
                raise
            with self._lock:
                self._connections[key] = connection
                self._specs[key] = spec
            return connection

    def get(self, key) -> Connection | None:
        with self._lock:
            connection = self._connections.get(key)
            if connection is not None and connection.closed:
                self._connections.pop(key, None)
                self._specs.pop(key, None)
                return None
            return connection

    def close(self, key) -> bool:
        connection = self._pop(key)
        if connection is None:
            return False
        connection.close()
        return True

    def close_where(self, predicate) -> int:
        with self._lock:
            keys = [key for key in self._connections if predicate(key)]
        return sum(1 for key in keys if self.close(key))

    def sweep(self) -> int:
        now = self._clock()
        with self._lock:
            for key in [key for key, conn in self._connections.items() if conn.closed]:
                self._connections.pop(key)
                self._specs.pop(key, None)
            keys = [key for key, conn in self._connections.items() if now - conn.last_used > self.idle_seconds]
        return sum(1 for key in keys if self.close(key))

    def close_all(self) -> None:
        with self._lock:
            keys = list(self._connections)
        for key in keys:
            self.close(key)
