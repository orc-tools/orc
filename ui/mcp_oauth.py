"""A standard-library OAuth 2.1 client that signs Orc in to remote MCP servers.

It is the client half of the MCP authorization spec (2025-06-18 and 2025-11-25):
RFC 9728 protected resource metadata, RFC 8414 authorization server metadata
with the OIDC fallbacks, RFC 7591 dynamic client registration, PKCE S256, the
RFC 8707 ``resource`` parameter, refresh tokens and the RFC 9207 ``iss`` check.
Discovery order, scope selection, issuer checks, resource rules and token forms
follow the official Python SDK (``mcp/client/auth/utils.py`` and
``mcp/client/auth/oauth2.py``), including its 2025-03-26 legacy fallback.

Every step is a plain function over JSON-serialisable dicts so callers can keep
the discovery, client, pending sign-in and tokens wherever they store secrets;
this module stores nothing.
"""

from __future__ import annotations

import base64
import hashlib
import http.client
import json
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

__all__ = [
    "OAuthError",
    "PENDING_TTL",
    "discover",
    "expired",
    "finish",
    "parse_www_authenticate",
    "refresh",
    "register",
    "start",
]

PROTOCOL_VERSION = "2025-11-25"
PENDING_TTL = 600
MAX_BODY_BYTES = 1024 * 1024
DEFAULT_TIMEOUT = 10.0
SECRET_AUTH_METHODS = ("client_secret_post", "client_secret_basic")
USABLE_AUTH_METHODS = (None, "none", *SECRET_AUTH_METHODS)
# The ``ok: false`` refusals (Slack's way) that mean the sign-in itself is no
# longer good, as opposed to a rate limit or an outage.
AUTH_REFUSALS = frozenset(("invalid_grant", "invalid_refresh_token", "token_revoked", "token_expired",
                           "invalid_client", "invalid_client_id", "bad_client_secret", "invalid_auth",
                           "account_inactive", "unauthorized_client"))
NO_REGISTRATION = ("This server's sign-in does not let Orc register itself. "
                   "Add a client ID for Orc from the server's developer settings.")


class OAuthError(Exception):
    """A sign-in step failed; str(exc) is a sentence for the user.

    ``sign_in`` is True when the stored sign-in is no longer usable and the user
    must sign in again, such as a refresh the server rejected.
    """

    def __init__(self, message: str, *, sign_in: bool = False):
        super().__init__(message)
        self.sign_in = sign_in


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """The SDK follows no redirects during sign-in; a 3xx comes back as an HTTPError."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect()).open


def _host(url: str) -> str:
    return urllib.parse.urlsplit(url).netloc or url


def _http_url(url: object, what: str = "The sign-in address") -> str:
    parts = urllib.parse.urlsplit(url) if isinstance(url, str) else None
    if parts is None or parts.scheme.lower() not in ("http", "https") or not parts.netloc:
        raise OAuthError(f"{what} {url!r} is not an http or https URL.")
    return url


def _origin(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def _canonical_resource(url: str) -> str:
    """RFC 8707 canonical form: lowercase scheme and host, no fragment (SDK resource_url_from_server_url)."""
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit(parts._replace(scheme=parts.scheme.lower(), netloc=parts.netloc.lower(),
                                                  fragment=""))


def _resource_allowed(requested: str, configured: str) -> bool:
    """SDK check_resource_allowed: same origin and the requested path sits under the configured one."""
    want, have = urllib.parse.urlparse(requested), urllib.parse.urlparse(configured)
    if want.scheme.lower() != have.scheme.lower() or want.netloc.lower() != have.netloc.lower():
        return False
    return (want.path.rstrip("/") + "/").startswith(have.path.rstrip("/") + "/")


def _issuers_match(a: str | None, b: str | None) -> bool:
    """Simple string comparison, except a root issuer with and without its trailing slash (SDK issuers_match)."""
    if a is None or b is None:
        return a == b
    if a == b:
        return True
    shorter, longer = sorted((a, b), key=len)
    return longer == f"{shorter}/" and shorter == _origin(shorter)


def _send(request: urllib.request.Request, opener, timeout: float) -> tuple[int, bytes]:
    """Send one request and return (status, body) for any HTTP answer; network failures raise OAuthError."""
    _http_url(request.full_url)
    try:
        response = (opener or _OPENER)(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        response = exc
    except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException) as exc:
        raise OAuthError(f"Orc could not reach {_host(request.full_url)} to sign in.") from exc
    try:
        body = response.read(MAX_BODY_BYTES + 1) or b""
    except (OSError, http.client.HTTPException) as exc:
        raise OAuthError(f"Orc could not reach {_host(request.full_url)} to sign in.") from exc
    finally:
        response.close()
    if len(body) > MAX_BODY_BYTES:
        raise OAuthError(f"{_host(request.full_url)} sent a sign-in answer larger than 1 MiB.")
    return int(getattr(response, "status", None) or response.getcode()), body


def _json(body: bytes) -> dict | None:
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _get_metadata(url: str, opener, timeout: float) -> tuple[int, dict | None]:
    request = urllib.request.Request(url, headers={"MCP-Protocol-Version": PROTOCOL_VERSION,
                                                   "Accept": "application/json"})
    status, body = _send(request, opener, timeout)
    return status, _json(body) if status == 200 else None


def _refusal(status: int, body: bytes) -> str:
    error = _json(body) or {}
    code, detail = error.get("error"), error.get("error_description")
    if isinstance(code, str) and code:
        suffix = f" ({detail.strip().rstrip('.')})" if isinstance(detail, str) and detail.strip() else ""
        return f"The server refused the sign-in: {code}{suffix}."
    return f"The server refused the sign-in (HTTP {status})."


def parse_www_authenticate(header: str | None) -> dict:
    """The Bearer challenge's parameters with lowercased names, or {} when there is none."""
    if not header:
        return {}
    match = re.search(r"(?:^|,)\s*Bearer(?=\s|,|$)", header, re.IGNORECASE)
    if not match:
        return {}
    params: dict = {}
    param = re.compile(r'\s*,?\s*([A-Za-z0-9_.\-]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^\s,"]*)\s*(?=[\s,]|$)')
    pos = match.end()
    while pos < len(header):
        found = param.match(header, pos)
        if not found:
            break  # the next challenge's scheme, or a token68 we do not use
        name, value = found.group(1).lower(), found.group(2)
        if value.startswith('"'):
            value = re.sub(r"\\(.)", r"\1", value[1:-1])
        params.setdefault(name, value)
        pos = found.end()
    return params


def _protected_resource(server_url: str, metadata_url: str | None, opener, timeout: float):
    """RFC 9728 discovery in the SDK's order: the challenge's URL, the path-based, then the root well-known URL."""
    parts = urllib.parse.urlsplit(server_url)
    urls = [metadata_url] if metadata_url else []
    if parts.path and parts.path != "/":
        urls.append(f"{_origin(server_url)}/.well-known/oauth-protected-resource{parts.path}")
    urls.append(f"{_origin(server_url)}/.well-known/oauth-protected-resource")
    failed = None
    for url in urls:
        status, data = _get_metadata(_http_url(url), opener, timeout)
        if status >= 500 or status == 429:
            failed = status
        servers = (data or {}).get("authorization_servers")
        if isinstance(data, dict) and isinstance(data.get("resource"), str) and isinstance(servers, list) \
                and servers and all(isinstance(s, str) for s in servers):
            return url, data
    if failed is not None:
        # A server error says nothing about whether metadata exists, so the SDK does not fall back.
        raise OAuthError(f"{_host(server_url)} could not describe its sign-in right now (HTTP {failed}).")
    return None, None


def _authorization_server_urls(issuer: str | None, server_url: str) -> list[str]:
    if not issuer:
        return [f"{_origin(server_url)}/.well-known/oauth-authorization-server"]
    path = urllib.parse.urlsplit(issuer).path.rstrip("/")
    base = _origin(issuer)
    if path:
        return [f"{base}/.well-known/oauth-authorization-server{path}",
                f"{base}/.well-known/openid-configuration{path}",
                f"{base}{path}/.well-known/openid-configuration"]
    return [f"{base}/.well-known/oauth-authorization-server", f"{base}/.well-known/openid-configuration"]


def _authorization_server(issuer: str | None, server_url: str, opener, timeout: float) -> dict | None:
    expected = issuer or _origin(server_url)
    for url in _authorization_server_urls(issuer, server_url):
        status, data = _get_metadata(url, opener, timeout)
        if status >= 500:
            raise OAuthError(f"The sign-in server {_host(url)} answered with an error (HTTP {status}).")
        if data is None or not all(isinstance(data.get(k), str) for k in
                                   ("issuer", "authorization_endpoint", "token_endpoint")):
            continue  # not served here (redirects are not followed) or not valid metadata
        found = data["issuer"]
        if found != expected and not (issuer is None and _issuers_match(found, expected)):
            raise OAuthError(f"The sign-in server at {_host(url)} names a different issuer ({found}) "
                             f"than expected ({expected}).")
        return data
    return None


def _list(value: object) -> list[str]:
    return [v for v in value if isinstance(v, str)] if isinstance(value, list) else []


def _select_scope(challenge_scope: str | None, prm: dict | None, asm: dict | None) -> str | None:
    """SDK get_client_metadata_scopes for a client that uses refresh tokens."""
    scope = challenge_scope
    if scope is None and prm is not None and isinstance(prm.get("scopes_supported"), list):
        scope = " ".join(_list(prm["scopes_supported"]))
    elif scope is None and asm is not None and isinstance(asm.get("scopes_supported"), list):
        scope = " ".join(_list(asm["scopes_supported"]))
    if scope is not None and asm is not None and "offline_access" in _list(asm.get("scopes_supported")) \
            and "offline_access" not in scope.split():
        scope = f"{scope} offline_access"
    return scope


def discover(server_url: str, *, www_authenticate: str | None = None, opener=None,
             timeout: float = DEFAULT_TIMEOUT, protocol_version: str | None = None) -> dict:
    """Find the MCP server's authorization server and its endpoints.

    ``protocol_version`` is the MCP version the server speaks, when known. As in the SDK, a server
    without protected resource metadata gets the ``resource`` parameter only from 2025-06-18 on.
    """
    _http_url(server_url, "The MCP server address")
    challenge = parse_www_authenticate(www_authenticate)
    metadata_url, prm = _protected_resource(server_url, challenge.get("resource_metadata"), opener, timeout)
    resource = _canonical_resource(server_url)
    if prm is not None:
        if not _resource_allowed(resource, prm["resource"]):
            raise OAuthError(f"{_host(server_url)} says its sign-in is for {prm['resource']}, "
                             f"which does not match {resource}.")
        resource = prm["resource"]
        issuer_url = _http_url(prm["authorization_servers"][0], "The sign-in server address")
    else:
        issuer_url = None  # 2025-03-26 legacy: the MCP server's origin is the authorization server
    asm = _authorization_server(issuer_url, server_url, opener, timeout)
    if asm is None and prm is not None:
        raise OAuthError(f"Orc could not find the sign-in server {issuer_url} that {_host(server_url)} names.")
    methods = _list((asm or {}).get("code_challenge_methods_supported"))
    if asm is not None and "code_challenge_methods_supported" in asm and "S256" not in methods:
        raise OAuthError(f"The sign-in server for {_host(server_url)} does not support PKCE with S256, "
                         "which MCP requires.")
    origin = _origin(server_url)
    if asm is not None:
        authorize, token, registration = (asm["authorization_endpoint"], asm["token_endpoint"],
                                          asm.get("registration_endpoint"))
    else:
        authorize, token, registration = f"{origin}/authorize", f"{origin}/token", f"{origin}/register"
    for url in (authorize, token, registration):
        if url is not None:
            _http_url(url, "The sign-in server's endpoint")
    return {
        "resource": resource,
        "sendResource": prm is not None or (protocol_version or "") >= "2025-06-18",
        "resourceMetadataUrl": metadata_url,
        "authorizationServer": issuer_url or (asm["issuer"] if asm else origin),
        "issuer": asm["issuer"] if asm else None,
        "authorizationEndpoint": authorize,
        "tokenEndpoint": token,
        "registrationEndpoint": registration if isinstance(registration, str) else None,
        "scope": _select_scope(challenge.get("scope"), prm, asm),
        "codeChallengeMethods": methods,
        "tokenAuthMethods": _list((asm or {}).get("token_endpoint_auth_methods_supported")),
        "issParameterSupported": bool((asm or {}).get("authorization_response_iss_parameter_supported") is True),
        "clientIdMetadataDocumentSupported": bool((asm or {}).get("client_id_metadata_document_supported") is True),
    }


def register(discovery: dict, *, redirect_uri: str, client_name: str = "Orc", opener=None,
             timeout: float = DEFAULT_TIMEOUT) -> dict:
    """RFC 7591 dynamic client registration as a public client."""
    endpoint = discovery.get("registrationEndpoint")
    if not endpoint:
        raise OAuthError(NO_REGISTRATION)
    metadata = {"redirect_uris": [redirect_uri], "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"], "token_endpoint_auth_method": "none", "client_name": client_name}
    if discovery.get("scope"):
        metadata["scope"] = discovery["scope"]
    request = urllib.request.Request(endpoint, data=json.dumps(metadata).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json", "Accept": "application/json"})
    status, body = _send(request, opener, timeout)
    if status not in (200, 201):
        message = _refusal(status, body).replace("refused the sign-in", "refused to register Orc")
        raise OAuthError(message)
    info = _json(body) or {}
    client_id, secret = info.get("client_id"), info.get("client_secret") or None
    method = info.get("token_endpoint_auth_method") or None
    if not isinstance(client_id, str) or not client_id:
        raise OAuthError("The server registered Orc but sent no client ID.")
    if method not in USABLE_AUTH_METHODS or (method in SECRET_AUTH_METHODS and not isinstance(secret, str)):
        raise OAuthError(f"The server registered Orc for a sign-in method Orc cannot use ({method}).")
    client = {"client_id": client_id, "token_endpoint_auth_method": method or "none",
              "issuer": discovery.get("issuer") or discovery.get("authorizationServer"),
              "redirect_uri": redirect_uri}
    if secret:
        client["client_secret"] = secret
    return client


def start(discovery: dict, client: dict, *, redirect_uri: str, scope: str | None = None,
          now: float | None = None) -> tuple[str, dict]:
    """The browser URL that starts the sign-in, and the pending state finish() needs."""
    verifier = secrets.token_urlsafe(96)  # 128 unreserved characters, the SDK's length
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).decode().rstrip("=")
    state = secrets.token_urlsafe(32)
    scope = scope if scope is not None else discovery.get("scope")
    params = {"response_type": "code", "client_id": client["client_id"], "redirect_uri": redirect_uri,
              "state": state, "code_challenge": challenge, "code_challenge_method": "S256"}
    if discovery.get("sendResource", True):
        params["resource"] = discovery["resource"]
    if scope:
        params["scope"] = scope
        if "offline_access" in scope.split():
            params["prompt"] = "consent"  # OIDC requires consent for offline_access, as the SDK sends
    endpoint = _http_url(discovery["authorizationEndpoint"], "The sign-in server's endpoint")
    parts = urllib.parse.urlsplit(endpoint)
    query = "&".join(q for q in (parts.query, urllib.parse.urlencode(params)) if q)
    url = urllib.parse.urlunsplit(parts._replace(query=query, fragment=""))
    pending = {"state": state, "verifier": verifier, "redirectUri": redirect_uri,
               "createdAt": time.time() if now is None else now, "scope": scope or None}
    return url, pending


def _token_request(discovery: dict, client: dict, form: dict, opener, timeout: float) -> tuple[int, bytes]:
    form = {**form, "client_id": client["client_id"]}
    if discovery.get("sendResource", True):
        form["resource"] = discovery["resource"]
    headers = {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"}
    method, secret = client.get("token_endpoint_auth_method") or "none", client.get("client_secret")
    if method == "client_secret_basic" and secret:
        pair = f"{urllib.parse.quote(client['client_id'], safe='')}:{urllib.parse.quote(secret, safe='')}"
        headers["Authorization"] = "Basic " + base64.b64encode(pair.encode("utf-8")).decode("ascii")
    elif method == "client_secret_post" and secret:
        form["client_secret"] = secret
    elif method not in USABLE_AUTH_METHODS:
        raise OAuthError(f"Orc cannot use this server's sign-in method ({method}).", sign_in=True)
    request = urllib.request.Request(discovery["tokenEndpoint"], method="POST", headers=headers,
                                     data=urllib.parse.urlencode(form).encode("ascii"))
    return _send(request, opener, timeout)


def _tokens(body: bytes, now: float | None, token_types=("bearer",), *, sign_in: bool = False) -> dict:
    """The tokens in a token endpoint's answer. ``token_types`` are the lowercased types the caller
    sends as a Bearer token: Slack's user tokens say "user". A 200 with ``ok: false``, Slack's way of
    refusing, is a refusal."""
    data = _json(body) or {}
    if data.get("ok") is False:
        raise OAuthError(_refusal(200, body), sign_in=sign_in and data.get("error") in AUTH_REFUSALS)
    access, token_type = data.get("access_token"), data.get("token_type", "Bearer")
    if not isinstance(access, str) or not access:
        raise OAuthError("The server finished the sign-in but sent no access token.")
    if not isinstance(token_type, str) or token_type.lower() not in token_types:
        raise OAuthError(f"The server sent a {token_type} token, but MCP needs a Bearer token.")
    expires_in = data.get("expires_in")
    try:
        expires_at = (time.time() if now is None else now) + int(expires_in) if expires_in is not None else None
    except (TypeError, ValueError):
        expires_at = None
    tokens = {"access_token": access, "token_type": "Bearer", "expires_at": expires_at}
    for key in ("refresh_token", "scope"):
        if isinstance(data.get(key), str) and data[key]:
            tokens[key] = data[key]
    return tokens


def finish(discovery: dict, client: dict, pending: dict, *, code: str, state: str, iss: str | None = None,
           opener=None, now: float | None = None, timeout: float = DEFAULT_TIMEOUT,
           token_types=("bearer",)) -> dict:
    """Check the browser's answer and exchange its code for tokens."""
    expected_state = pending.get("state")
    if not (isinstance(state, str) and isinstance(expected_state, str) and expected_state
            and secrets.compare_digest(state.encode(), expected_state.encode())):
        raise OAuthError("This sign-in answer does not belong to the sign-in Orc started. Try signing in again.")
    if (time.time() if now is None else now) - float(pending.get("createdAt") or 0) >= PENDING_TTL:
        raise OAuthError("This sign-in took longer than ten minutes. Try signing in again.")
    expected = discovery.get("issuer")
    if iss is not None and not _issuers_match(iss, expected):
        raise OAuthError(f"The sign-in answer came from {iss}, not the server Orc asked ({expected}).")
    if iss is None and discovery.get("issParameterSupported"):
        raise OAuthError("The sign-in answer did not say which server sent it, though that server promised to.")
    if not code:
        raise OAuthError("The sign-in answer carried no authorization code.")
    form = {"grant_type": "authorization_code", "code": code, "redirect_uri": pending["redirectUri"],
            "code_verifier": pending["verifier"]}
    status, body = _token_request(discovery, client, form, opener, timeout)
    if status not in (200, 201):
        raise OAuthError(_refusal(status, body))
    tokens = _tokens(body, now, token_types)
    if "scope" not in tokens and pending.get("scope"):
        tokens["scope"] = pending["scope"]  # RFC 6749 §5.1: omitted means what was requested
    return tokens


def refresh(discovery: dict, client: dict, tokens: dict, *, opener=None, now: float | None = None,
            timeout: float = DEFAULT_TIMEOUT, token_types=("bearer",)) -> dict:
    """Trade the refresh token for a new access token."""
    old = (tokens or {}).get("refresh_token")
    if not old:
        raise OAuthError("This sign-in has expired. Sign in again.", sign_in=True)
    status, body = _token_request(discovery, client, {"grant_type": "refresh_token", "refresh_token": old},
                                  opener, timeout)
    if status != 200:
        raise OAuthError(_refusal(status, body), sign_in=status in (400, 401))
    fresh = _tokens(body, now, token_types, sign_in=True)
    fresh.setdefault("refresh_token", old)  # RFC 6749 §6: the server may keep the same refresh token
    if "scope" not in fresh and tokens.get("scope"):
        fresh["scope"] = tokens["scope"]
    return fresh


def expired(tokens: dict | None, *, now: float | None = None, margin: float = 60.0) -> bool:
    """True when there is no access token or it expires within ``margin`` seconds."""
    if not tokens or not tokens.get("access_token"):
        return True
    expires_at = tokens.get("expires_at")
    if expires_at is None:
        return False
    return float(expires_at) - margin <= (time.time() if now is None else now)
