"""The MCP servers the MCP client itself holds, and what Orc sends them.

A server added to a throwaway environment (environments.py) keeps its name,
URL, header names, environment and sign-in details (the authorization server
it found and the client it registered there) in config.json under
``mcpClient``. Header values, tokens and a client secret are Keychain
secrets named ``orc-mcp-client.<server id>.<field>``, read once and kept in
memory. A token too long for the Keychain lasts until Orc restarts.

A ``linked`` entry is not one of those servers: it holds Orc's own sign-in
and headers for a server an agent has (agents.py), found by its address.
"""
from __future__ import annotations

import json
import re
import secrets
import threading
import time
import urllib.parse

import keychain_secrets
import mcp_oauth

CONFIG_KEY = "mcpClient"
SERVER_ID = re.compile(r"[a-z0-9]{10}")
HEADER_NAME = re.compile(r"[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}")
# Orc's MCP client sets these itself.
RESERVED_HEADERS = {"accept", "connection", "content-length", "content-type", "host", "transfer-encoding",
                    "mcp-protocol-version", "mcp-session-id", "mcp-method", "mcp-name"}
NAME_LIMIT = 80
URL_LIMIT = 2048
HEADERS_LIMIT = 8
MAX_SERVERS = 50
MAX_LINKED = 200
FIELDS = ("headers", "access", "refresh", "client-secret")


class StoreError(ValueError):
    """A change Orc refused, worded for the MCP client screen."""


def secret_name(server_id: str, field: str) -> str:
    return "orc-mcp-client.%s.%s" % (server_id, field)


def clean_url(value) -> str:
    url = value.strip() if isinstance(value, str) else ""
    parts = urllib.parse.urlsplit(url)
    if len(url) > URL_LIMIT or parts.scheme not in ("http", "https") or not parts.hostname:
        raise StoreError("Paste the server's full http or https address, such as https://example.com/mcp.")
    if parts.username or parts.password:
        raise StoreError("Leave the sign-in out of the address. Add it as a header, or sign in after saving.")
    return urllib.parse.urlunsplit(parts._replace(fragment=""))


def address(url: str) -> str:
    """A URL as two config entries for one server share it: the scheme and
    host in lower case, and no trailing slash or fragment."""
    parts = urllib.parse.urlsplit(url.strip())
    return urllib.parse.urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"),
                                    parts.query, ""))


def origin(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    return "%s://%s" % (parts.scheme.lower(), (parts.netloc or "").lower())


def clean_name(value, url: str) -> str:
    name = " ".join(value.split()) if isinstance(value, str) else ""
    return (name or urllib.parse.urlsplit(url).hostname or "MCP server")[:NAME_LIMIT]


def clean_client(data) -> tuple[str | None, str | None, bool]:
    """The OAuth client ID typed for a server whose sign-in has no
    registration, its secret, and whether a secret was typed at all."""
    client_id = data.get("clientId")
    client_id = client_id.strip() if isinstance(client_id, str) else ""
    if client_id and (len(client_id) > 256 or not keychain_secrets.PRINTABLE_ASCII.fullmatch(client_id)):
        raise StoreError("The client ID must be printable ASCII on one line, up to 256 characters.")
    secret = data.get("clientSecret")
    typed = isinstance(secret, str) and secret != ""
    if typed and (len(secret) > 2048 or not keychain_secrets.PRINTABLE_ASCII.fullmatch(secret)):
        raise StoreError("The client secret must be printable ASCII on one line, up to 2048 characters.")
    return client_id or None, secret if typed else None, typed


def clean_headers(value) -> list[dict]:
    """[{name, value?}] as the screen sends it; a missing value keeps the saved one."""
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > HEADERS_LIMIT:
        raise StoreError("Add at most %d headers." % HEADERS_LIMIT)
    found, seen = [], set()
    for item in value:
        name = item.get("name").strip() if isinstance(item, dict) and isinstance(item.get("name"), str) else ""
        if not HEADER_NAME.fullmatch(name) or name.lower() in RESERVED_HEADERS or name.lower().startswith("mcp-param-"):
            raise StoreError("%s is not a header Orc can send." % (name or "A header without a name"))
        if name.lower() in seen:
            raise StoreError("%s is there twice." % name)
        seen.add(name.lower())
        header = {"name": name}
        if "value" in item:
            text = item["value"]
            if not isinstance(text, str) or not keychain_secrets.PRINTABLE_ASCII.fullmatch(text) or len(text) > 2048:
                raise StoreError("The value of %s must be printable ASCII on one line, up to 2048 characters." % name)
            header["value"] = text
        found.append(header)
    return found


class Store:
    def __init__(self, context):
        self.context = context
        self.read_secret = context.get("read_secret", keychain_secrets.read)
        self.save_secret = context.get("save_secret", keychain_secrets.save)
        self.delete_secret = context.get("delete_secret", keychain_secrets.delete)
        self.lock = threading.RLock()
        self.cache: dict = {}

    # -- config --

    def servers(self) -> list[dict]:
        config, _broken = self.context["read_config"]()
        section = config.get(CONFIG_KEY) if isinstance(config, dict) else None
        raw = section.get("servers") if isinstance(section, dict) else None
        found = []
        for entry in raw if isinstance(raw, list) else []:
            if isinstance(entry, dict) and isinstance(entry.get("id"), str) and SERVER_ID.fullmatch(entry["id"]) \
                    and isinstance(entry.get("url"), str) and isinstance(entry.get("name"), str):
                found.append(entry)
        return found

    def get(self, server_id) -> dict | None:
        return next((entry for entry in self.servers() if entry["id"] == server_id), None)

    def saved(self) -> list[dict]:
        """The servers added in the MCP client itself, each to a throwaway
        environment."""
        return [entry for entry in self.servers() if not entry.get("linked")]

    def by_url(self, url) -> dict | None:
        """The entry that holds Orc's sign-in for an agent's server at an
        address. An environment's own server keeps its sign-in to itself, so
        closing the environment signs no agent's server out."""
        wanted = address(url)
        return next((entry for entry in self.servers()
                     if entry.get("linked") and address(entry["url"]) == wanted), None)

    def _change(self, server_id, change):
        """Rewrites one saved server (or adds it when server_id is new) under
        the Settings lock. ``change(entry)`` returns the new entry, or None to
        remove it."""
        result = {}

        def transform(config):
            section = dict(config.get(CONFIG_KEY) or {})
            servers = [entry for entry in section.get("servers") or [] if isinstance(entry, dict)]
            index = next((i for i, entry in enumerate(servers) if entry.get("id") == server_id), None)
            current = dict(servers[index]) if index is not None else None
            updated = change(current)
            if updated is not None:
                updated["revision"] = int((current or {}).get("revision") or 0) + 1
            if index is None and updated is not None:
                linked = bool(updated.get("linked"))
                if sum(bool(entry.get("linked")) == linked for entry in servers) >= (MAX_LINKED if linked else MAX_SERVERS):
                    raise StoreError("Orc keeps its sign-in for at most %d servers that agents have. Sign out of one first."
                                     % MAX_LINKED if linked
                                     else "Orc keeps at most %d MCP servers. Remove one first." % MAX_SERVERS)
                servers.append(updated)
            elif index is not None and updated is not None:
                servers[index] = updated
            elif index is not None:
                servers.pop(index)
            section["servers"] = servers
            config[CONFIG_KEY] = section
            result["entry"] = updated
            return config
        self.context["update_config"](transform)
        return result.get("entry")

    def save(self, server_id, data, *, linked=False, environment=None) -> dict:
        """Adds a server (server_id None) to the throwaway environment
        ``environment``, or edits one from the screen's form.
        Saved secrets stay only with the server they were typed for: an edit
        that moves the URL to another origin needs every header value and a
        client secret typed again, and any change of URL or client signs the
        server out."""
        url = clean_url(data.get("url"))
        name = clean_name(data.get("name"), url)
        headers = clean_headers(data.get("headers"))
        client_id, client_secret, secret_typed = clean_client(data)
        new = server_id is None
        server_id = server_id or secrets.token_hex(5)
        with self.lock:
            current = None if new else self.get(server_id)
            if current is None and not new:
                raise StoreError("That MCP server is no longer saved.")
            moved = current is not None and origin(current["url"]) != origin(url)
            saved = {} if current is None or moved else self.header_values(server_id)
            values = {}
            for header in headers:
                value = header.get("value", saved.get(header["name"]))
                if value is None:
                    raise StoreError(("%s is on another server now, so enter %s again." % (origin(url), header["name"]))
                                     if moved else "Enter a value for %s." % header["name"])
                values[header["name"]] = value
            packed = json.dumps(values) if values else None
            if packed and len(packed) > keychain_secrets.VALUE_MAX:
                raise StoreError("The header values add up to more than the Keychain holds. Shorten them.")
            other_client = current is not None and (current.get("clientId") != client_id or (moved and not client_id))
            reset = current is not None and (current.get("url") != url or other_client or secret_typed)
            drop_secret = current is not None and not secret_typed and (other_client or moved)

            def change(entry):
                if entry is None and not new:
                    raise StoreError("That MCP server is no longer saved.")
                entry = dict(entry or ({"id": server_id, "linked": True} if linked
                                       else {"id": server_id, "environment": environment}))
                entry.update(name=name, url=url, headers=list(values))
                if client_id:
                    entry["clientId"] = client_id
                else:
                    entry.pop("clientId", None)
                if reset:
                    entry.pop("oauth", None)
                return entry
            entry = self._change(server_id, change)
            self.set_secret(server_id, "headers", packed)
            if reset:
                self.forget_sign_in(server_id, client=other_client)
            if secret_typed:
                self.set_secret(server_id, "client-secret", client_secret)
            elif drop_secret:
                self.set_secret(server_id, "client-secret", None)
        return entry

    def remove(self, server_id) -> None:
        with self.lock:
            if self.get(server_id) is None:
                raise StoreError("That MCP server is no longer saved.")
            self._change(server_id, lambda current: None)
            for field in FIELDS:
                self.set_secret(server_id, field, None)

    def update_oauth(self, server_id, oauth) -> dict:
        def change(current):
            if current is None:
                raise StoreError("That MCP server is no longer saved.")
            entry = dict(current)
            if oauth:
                entry["oauth"] = oauth
            else:
                entry.pop("oauth", None)
            return entry
        return self._change(server_id, change)

    # -- secrets --

    def secret(self, server_id, field):
        key = (server_id, field)
        with self.lock:
            if key not in self.cache:
                self.cache[key] = self.read_secret(secret_name(server_id, field))
            return self.cache[key]

    def set_secret(self, server_id, field, value) -> None:
        name = secret_name(server_id, field)
        with self.lock:
            if value is None:
                self.delete_secret(name)
            else:
                try:
                    keychain_secrets.validate_value(value)
                except keychain_secrets.SecretError:
                    # A token too long or not ASCII for the Keychain lasts until
                    # Orc restarts; the one it replaces must not come back then.
                    self.delete_secret(name)
                else:
                    self.save_secret(name, value)
            self.cache[(server_id, field)] = value

    def header_values(self, server_id) -> dict:
        raw = self.secret(server_id, "headers")
        try:
            values = json.loads(raw) if raw else {}
        except ValueError:
            values = {}
        return {name: value for name, value in values.items() if isinstance(value, str)} \
            if isinstance(values, dict) else {}

    # -- sign-in --

    def tokens(self, server_id, entry) -> dict | None:
        oauth = entry.get("oauth") if isinstance(entry.get("oauth"), dict) else None
        access, refresh = self.secret(server_id, "access"), self.secret(server_id, "refresh")
        if not oauth or not (access or refresh):
            return None
        return {"access_token": access, "refresh_token": refresh, "token_type": "Bearer",
                "expires_at": oauth.get("expiresAt")}

    def client(self, server_id, entry, *, redirect_uri=None, issuer=None) -> dict | None:
        """The OAuth client Orc signs in as: the one typed for the server, or
        the one it registered at the last sign-in."""
        if isinstance(entry.get("clientId"), str):
            secret = self.secret(server_id, "client-secret")
            return {"client_id": entry["clientId"], "redirect_uri": redirect_uri, "issuer": issuer, "typed": True,
                    "token_endpoint_auth_method": "client_secret_post" if secret else "none",
                    **({"client_secret": secret} if secret else {})}
        oauth = entry.get("oauth") if isinstance(entry.get("oauth"), dict) else {}
        client = oauth.get("client")
        if not isinstance(client, dict) or not isinstance(client.get("client_id"), str):
            return None
        secret = self.secret(server_id, "client-secret")
        return {**client, **({"client_secret": secret} if secret else {})}

    def link(self, url, name) -> dict:
        """The entry that holds Orc's sign-in for an agent's server, made
        when the address has none."""
        with self.lock:
            return self.by_url(url) or self.save(None, {"url": url, "name": name}, linked=True)

    def save_sign_in(self, server_id, discovery, client, tokens) -> dict:
        with self.lock:
            self.set_secret(server_id, "client-secret", client.get("client_secret"))
            self.set_secret(server_id, "access", tokens.get("access_token"))
            # A refresh carries the old refresh token forward; a new sign-in
            # that issues none must not keep the last one.
            self.set_secret(server_id, "refresh", tokens.get("refresh_token"))
            public_client = {key: value for key, value in client.items() if key != "client_secret"}
            return self.update_oauth(server_id, {"discovery": discovery, "client": public_client,
                                                 "expiresAt": tokens.get("expires_at"), "scope": tokens.get("scope"),
                                                 "signedInAt": time.time()})

    def forget_sign_in(self, server_id, *, client=False) -> None:
        """Signs out: drops the tokens, and the registered client too when asked."""
        with self.lock:
            self.set_secret(server_id, "access", None)
            self.set_secret(server_id, "refresh", None)
            if client:
                self.set_secret(server_id, "client-secret", None)
            entry = self.get(server_id)
            if entry is None or "oauth" not in entry:
                return
            oauth = None if client else {key: value for key, value in entry["oauth"].items()
                                         if key in ("discovery", "client")}
            self.update_oauth(server_id, oauth)

    def fresh_tokens(self, server_id, *, rejected=None) -> dict | None:
        """The server's tokens, refreshed first when they have expired or the
        server just refused the access token ``rejected``. A request that
        waited on another's refresh takes its result. A refresh the server
        refuses signs the server out."""
        with self.lock:
            entry = self.get(server_id)
            tokens = self.tokens(server_id, entry) if entry else None
            force = rejected is not None and tokens is not None and tokens.get("access_token") == rejected
            if tokens is None or not (force or mcp_oauth.expired(tokens)):
                return tokens
            oauth, client = entry["oauth"], self.client(server_id, entry)
            if not tokens.get("refresh_token") or client is None:
                return tokens if not force and tokens.get("access_token") else None
            try:
                renewed = mcp_oauth.refresh(oauth.get("discovery") or {}, client, tokens)
            except mcp_oauth.OAuthError as exc:
                if exc.sign_in:
                    self.forget_sign_in(server_id)
                    return None
                raise
            self.save_sign_in(server_id, oauth.get("discovery") or {}, client, renewed)
            return renewed

    def request_headers(self, server_id, entry, *, rejected=None) -> dict:
        headers = {name: value for name, value in self.header_values(server_id).items()
                   if name in (entry.get("headers") or [])}
        tokens = self.fresh_tokens(server_id, rejected=rejected)
        if tokens and tokens.get("access_token"):
            headers = {name: value for name, value in headers.items() if name.lower() != "authorization"}
            headers["Authorization"] = "Bearer %s" % tokens["access_token"]
        return headers
