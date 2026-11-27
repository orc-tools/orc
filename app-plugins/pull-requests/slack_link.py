"""Orc's own Slack sign-in, and the Slack MCP calls Pull requests makes with it.

Slack's MCP server has no self-registration, so the user makes a Slack app in
their workspace and pastes its client ID and secret here. Orc then signs in to
Slack in the browser with that app (OAuth with PKCE, ``mcp_oauth``) and calls
the server's tools itself (``mcp_client``): no model and no Claude Code session
runs, so a read is a few HTTP requests.

The client secret and both tokens are Keychain secrets named
``orc-slack.<field>``. Everything else, which says nothing secret, is kept in
``slack-sign-in.json`` beside Pull requests' cache, on this Mac only:
config.json is backed up and synced. A sign-in belongs to the MCP address it
was made for, and its token is never sent anywhere else.
"""
from __future__ import annotations

import hashlib
import json
import os
import pwd
import re
import tempfile
import threading
import time

import keychain_secrets
import mcp_client
import mcp_oauth

# What Pull requests does in Slack: read review channels, find a channel by
# name, read and add reactions, and name who reacted.
SCOPES = ("channels:history", "groups:history", "reactions:read", "reactions:write", "users:read",
          "search:read.public", "search:read.private")
# Slack's user tokens say "user" where OAuth says "Bearer"; they are sent as Bearer.
TOKEN_TYPES = ("bearer", "user")
SECRET_PREFIX = "orc-slack."
# Orc's own settings folder, under the account's real home: a fixture server
# or a test runs with another HOME and must not share its Keychain items.
REAL_CONFIG_DIR = os.path.join(pwd.getpwuid(os.getuid()).pw_dir, ".orc")
FIELDS = ("client-secret", "access", "refresh")
CLIENT_ID_RE = re.compile(r"[0-9]{3,20}\.[0-9]{3,20}")
CLIENT_INFO = {"name": "orc", "title": "Orc", "version": "1.0"}
CALL_TIMEOUT = 30.0
NOT_SIGNED_IN = "Orc is not signed in to Slack. Sign in from Settings, Integrations, Slack."


class SlackError(Exception):
    """A Slack step failed; str(exc) is a sentence for the user."""


class NotSignedIn(SlackError):
    def __init__(self, message=NOT_SIGNED_IN):
        super().__init__(message)


class Link:
    """One Mac's Slack sign-in for Pull requests. Thread-safe: reads run two
    at a time, and a click can react while they do."""

    def __init__(self, path, *, read_secret=None, save_secret=None, delete_secret=None,
                 opener=None, connection=None, clock=time.time):
        self.path = path
        self.prefix = secret_prefix(path)
        self.read_secret = read_secret or keychain_secrets.read
        self.save_secret = save_secret or keychain_secrets.save
        self.delete_secret = delete_secret or keychain_secrets.delete
        self.opener = opener
        self.connection_factory = connection or mcp_client.Connection
        self.clock = clock
        self._lock = threading.RLock()
        self._secrets = {}
        self._pending = {}
        self._connection = None
        self._tools = None

    # -- saved state --

    def _meta(self):
        try:
            with open(self.path) as handle:
                data = json.load(handle)
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def _write(self, data):
        directory = os.path.dirname(self.path)
        os.makedirs(directory, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=directory, prefix=".slack-sign-in.")
        try:
            with os.fdopen(fd, "w") as handle:
                json.dump(data, handle)
            os.chmod(tmp, 0o600)
            os.replace(tmp, self.path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def _secret(self, field):
        if field not in self._secrets:
            try:
                self._secrets[field] = self.read_secret(self.prefix + field)
            except keychain_secrets.SecretError:
                self._secrets[field] = None
        return self._secrets[field]

    def _set_secret(self, field, value):
        name = self.prefix + field
        if value:
            self.save_secret(name, value)
        else:
            try:
                self.delete_secret(name)
            except keychain_secrets.SecretError:
                pass
        self._secrets[field] = value or None

    def _drop_connection(self):
        connection, self._connection, self._tools = self._connection, None, None
        if connection is not None:
            connection.close()

    def _forget_tokens(self, meta):
        meta.pop("signIn", None)
        self._set_secret("access", None)
        self._set_secret("refresh", None)
        self._drop_connection()

    # -- what the card shows --

    def status(self, mcp_url):
        with self._lock:
            meta = self._meta()
            sign_in = meta.get("signIn") if isinstance(meta.get("signIn"), dict) else None
            return {"clientId": meta.get("clientId"),
                    "appSaved": bool(meta.get("clientId") and self._secret("client-secret")),
                    "signedIn": self.signed_in(mcp_url),
                    "signedInAt": (sign_in or {}).get("at"),
                    "notice": meta.get("notice")}

    def signed_in(self, mcp_url):
        """True when a sign-in for ``mcp_url`` and its token are both here."""
        with self._lock:
            sign_in = self._meta().get("signIn")
            return bool(isinstance(sign_in, dict) and sign_in.get("mcpUrl") == mcp_url
                        and (self._secret("access") or self._secret("refresh")))

    # -- the app and the sign-in --

    def save_app(self, client_id, client_secret):
        """Keep the Slack app's client ID and secret. Another app's sign-in
        does not carry over, so a new client ID signs Orc out."""
        client_id = client_id.strip() if isinstance(client_id, str) else ""
        if not CLIENT_ID_RE.fullmatch(client_id):
            raise SlackError("Paste the app's Client ID from Basic Information, two numbers joined by a dot.")
        typed = isinstance(client_secret, str) and client_secret.strip() != ""
        if typed and not re.fullmatch(r"[0-9a-f]{16,128}", client_secret.strip()):
            raise SlackError("Paste the app's Client Secret from Basic Information, letters a to f and digits.")
        with self._lock:
            meta = self._meta()
            if not typed and not (meta.get("clientId") == client_id and self._secret("client-secret")):
                raise SlackError("Paste the app's Client Secret too.")
            if meta.get("clientId") != client_id or typed:
                self._forget_tokens(meta)
            if typed:
                self._set_secret("client-secret", client_secret.strip())
            meta["clientId"] = client_id
            meta.pop("notice", None)
            self._write(meta)

    def forget_app(self):
        with self._lock:
            meta = self._meta()
            self._forget_tokens(meta)
            self._set_secret("client-secret", None)
            self._pending.clear()
            self._write({})

    def sign_out(self):
        with self._lock:
            meta = self._meta()
            self._forget_tokens(meta)
            meta.pop("notice", None)
            self._write(meta)

    def _client(self, meta):
        secret = self._secret("client-secret")
        if not meta.get("clientId") or not secret:
            raise SlackError("Save your Slack app's client ID and secret first.")
        return {"client_id": meta["clientId"], "client_secret": secret,
                "token_endpoint_auth_method": "client_secret_post"}

    def start(self, mcp_url, redirect_uri):
        """The Slack page that asks you to let Orc in."""
        with self._lock:
            client = self._client(self._meta())
        try:
            discovery = mcp_oauth.discover(mcp_url, opener=self.opener)
            url, pending = mcp_oauth.start(discovery, client, redirect_uri=redirect_uri, scope=" ".join(SCOPES),
                                           now=self.clock())
        except mcp_oauth.OAuthError as error:
            raise SlackError(str(error)) from None
        now = self.clock()
        with self._lock:
            self._pending = {state: login for state, login in self._pending.items()
                             if now - login["at"] < mcp_oauth.PENDING_TTL}
            self._pending[pending["state"]] = {"pending": pending, "discovery": discovery, "client": client,
                                               "mcpUrl": mcp_url, "at": now}
        return url

    def finish(self, query):
        """Settle the browser's answer. Returns a notice for the card, or
        None when the answer was not for a sign-in Orc started."""
        state = (query.get("state") or [""])[0]
        with self._lock:
            login = self._pending.pop(state, None)
        if login is None:
            return None
        error = (query.get("error") or [""])[0]
        if error:
            notice = {"ok": False, "text": "You did not let Orc in to Slack." if error == "access_denied"
                      else "Slack did not sign you in (%s)." % error[:80]}
        else:
            try:
                tokens = mcp_oauth.finish(login["discovery"], login["client"], login["pending"],
                                          code=(query.get("code") or [""])[0], state=state,
                                          iss=(query.get("iss") or [None])[0], opener=self.opener,
                                          now=self.clock(), token_types=TOKEN_TYPES)
                with self._lock:
                    meta = self._meta()
                    if meta.get("clientId") != login["client"]["client_id"]:
                        raise SlackError("Your Slack app changed while you signed in. Sign in again.")
                    self._save_tokens(meta, login["discovery"], login["mcpUrl"], tokens, fresh_sign_in=True)
                notice = {"ok": True, "text": "Signed in to Slack."}
            except (mcp_oauth.OAuthError, SlackError) as exc:
                notice = {"ok": False, "text": str(exc)}
            except (keychain_secrets.SecretError, OSError):
                notice = {"ok": False, "text": "Orc could not save the Slack sign-in. Try again."}
        with self._lock:
            meta = self._meta()
            meta["notice"] = notice
            self._write(meta)
        return notice

    def _save_tokens(self, meta, discovery, mcp_url, tokens, fresh_sign_in=False):
        previous = meta.get("signIn") if isinstance(meta.get("signIn"), dict) else {}
        self._set_secret("access", tokens.get("access_token"))
        self._set_secret("refresh", tokens.get("refresh_token"))
        meta["signIn"] = {"mcpUrl": mcp_url, "discovery": discovery, "expiresAt": tokens.get("expires_at"),
                          "scope": tokens.get("scope"),
                          "at": self.clock() if fresh_sign_in else previous.get("at")}
        meta.pop("notice", None)
        self._write(meta)
        self._drop_connection()

    # -- calls --

    def _token(self, mcp_url, rejected=None):
        """The access token to send ``mcp_url``, refreshed first when it has
        expired or the server just turned ``rejected`` away. One refresh at a
        time: Slack's refresh tokens work once."""
        with self._lock:
            meta = self._meta()
            sign_in = meta.get("signIn")
            if not isinstance(sign_in, dict) or sign_in.get("mcpUrl") != mcp_url:
                raise NotSignedIn()
            access, refresh = self._secret("access"), self._secret("refresh")
            tokens = {"access_token": access, "refresh_token": refresh, "expires_at": sign_in.get("expiresAt"),
                      "scope": sign_in.get("scope")}
            if access and access != rejected and not mcp_oauth.expired(tokens, now=self.clock()):
                return access
            if not refresh:
                self._forget_tokens(meta)
                self._write(meta)
                raise NotSignedIn("Your Slack sign-in has expired. Sign in again from Settings, Integrations, Slack.")
            try:
                fresh = mcp_oauth.refresh(sign_in["discovery"], self._client(meta), tokens, opener=self.opener,
                                          now=self.clock(), token_types=TOKEN_TYPES)
            except mcp_oauth.OAuthError as error:
                if error.sign_in:
                    self._forget_tokens(meta)
                    self._write(meta)
                    raise NotSignedIn("Slack ended Orc's sign-in (%s). Sign in again from Settings, "
                                      "Integrations, Slack." % str(error).rstrip(".")) from None
                raise SlackError(str(error)) from None
            self._save_tokens(meta, sign_in["discovery"], mcp_url, fresh)
            return fresh["access_token"]

    def _connect(self, mcp_url, token):
        with self._lock:
            connection = self._connection
            if connection is None or connection.closed or connection.url != mcp_url \
                    or connection.headers.get("Authorization") != "Bearer " + token:
                self._drop_connection()
                connection = self.connection_factory(mcp_url, {"Authorization": "Bearer " + token},
                                                     client_info=CLIENT_INFO, timeout=CALL_TIMEOUT)
                self._connection = connection
            return connection

    def _request(self, mcp_url, method, params=None):
        rejected = None
        for attempt in (0, 1):
            token = self._token(mcp_url, rejected)
            connection = self._connect(mcp_url, token)
            try:
                if method == "tools/list":
                    return connection.list_all("tools/list", "tools")["items"]
                return connection.request(method, params)["result"]
            except mcp_client.TransportError as error:
                with self._lock:
                    if self._connection is connection:
                        self._drop_connection()
                if error.auth and attempt == 0:
                    rejected = token
                    continue
                if error.auth:
                    raise NotSignedIn("Slack turned Orc's sign-in away. Sign in again from Settings, "
                                      "Integrations, Slack.") from None
                raise SlackError("Slack could not be reached: %s" % str(error).rstrip(".")) from None
            except mcp_client.McpError as error:
                raise SlackError("Slack answered with an error: %s" % error.message.strip()[:200]) from None
        raise AssertionError("unreachable")

    def tools(self, mcp_url):
        """Slack's tools, by name, each with its input schema."""
        with self._lock:
            if self._tools is not None and self._connection is not None:
                return self._tools
        found = {tool["name"]: tool for tool in self._request(mcp_url, "tools/list")
                 if isinstance(tool, dict) and isinstance(tool.get("name"), str)}
        with self._lock:
            self._tools = found
        return found

    def call(self, mcp_url, name, arguments):
        """(texts, is_error) from one tool call."""
        result = self._request(mcp_url, "tools/call", {"name": name, "arguments": arguments})
        result = result if isinstance(result, dict) else {}
        texts = [item["text"] for item in result.get("content") or []
                 if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str)]
        return texts, bool(result.get("isError"))


def secret_prefix(path):
    """``orc-slack.`` for the sign-in kept in Orc's own settings folder, else
    a prefix named for the folder that keeps it."""
    folder = os.path.realpath(os.path.dirname(os.path.dirname(path)))
    if folder == os.path.realpath(REAL_CONFIG_DIR):
        return SECRET_PREFIX
    return "orc-slack-%s." % hashlib.sha256(folder.encode()).hexdigest()[:10]
