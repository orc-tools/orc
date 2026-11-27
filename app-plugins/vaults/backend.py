"""The Vaults page's routes, and the thread that runs each vault's
automations, both only while the plugin is enabled."""
import html
import json
import re
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import claude_accounts

from . import vault_build, vault_store, vault_sync

PREFIX = "/api/vaults"
# A note is at most 256 KB, and JSON escaping can double it.
BODY_LIMIT = 2 * vault_store.NOTE_MAX_BYTES + 16 * 1024
NOTE = re.compile(r"/api/vaults/([a-z0-9-]+)/notes/(.+?)(/delete)?")
PAGE = re.compile(r"/api/vaults/([a-z0-9-]+)/page/(.*)")
FRAME = re.compile(r"/api/vaults/([a-z0-9-]+)/frame")
PROPOSAL = re.compile(r"/api/vaults/([a-z0-9-]+)/proposals/([a-f0-9]{32})/(approve|dismiss)")
AUTOMATION = re.compile(r"/api/vaults/([a-z0-9-]+)/automations/([a-z0-9-]+)")
# A vault's own app, for a phone's home screen: its page and the box, at an
# address of its own, with a manifest that names it after the vault.
STANDALONE = re.compile(r"/vault/([a-z0-9-]+)(/manifest\.webmanifest)?")
APP_FILES = {"vault-app.js": "text/javascript", "vault-app.css": "text/css", "vault-helpers.js": "text/javascript"}
APP_FILE = re.compile(r"/vault-app/([a-z-]+\.(?:js|css))")
HERE = Path(__file__).resolve().parent
VAULT = re.compile(r"/api/vaults/([a-z0-9-]+)(/soul|/notes|/delete|/build|/stop|/undo|/settings|/tools|/links|/sync)?")
HISTORY_SHOWN = 20
HOST = re.compile(r"[A-Za-z0-9.\-\[\]:]{1,255}\Z")
HEAD = re.compile(r"<head(?:\s[^>]*)?>", re.I)
DOCTYPE = re.compile(r"\A\s*<!doctype[^>]*>", re.I)
HTML_TAG = re.compile(r"<html(?=[\s>])", re.I)
HTML_OPEN = re.compile(r"<html(?:\s[^>]*)?>", re.I)
# Orc's mode, which the page is told as data-orc-mode on its <html>.
MODES = ("light", "dark")
# What a page's frames may do: run their own script, and nothing that opens a
# window, submits a form or touches the window above them.
SANDBOX = "allow-scripts"
# What Orc puts at the top of every page: its links handed to Orc, and the
# orcVault bridge that lets a page hold its own box. The showcase reads it too.
PAGE_SCRIPT = "page-script.js"
LEAD = "<script>%s</script>" % (HERE / PAGE_SCRIPT).read_text(encoding="utf-8").strip()
# The page rides inside the frame's own document rather than at an address
# of its own: one request shows it, so it loads wherever Orc does, a paired
# phone included, whose sign-in does not follow a request a sandboxed frame makes.
WRAPPER = """<!doctype html><html lang="en"><head><meta charset="utf-8"><title>%(title)s</title>
<style>html,body{margin:0;height:100%%}iframe{display:block;width:100%%;height:100%%;border:0}%(scheme)s</style></head>
<body><iframe sandbox="%(sandbox)s" referrerpolicy="no-referrer" title="%(title)s" srcdoc="%(page)s"></iframe></body></html>"""


# Orc's own PWA icons: a phone shows the vault's name under them.
APP_ICONS = [
    {"src": "/pwa/icon-192.png?v=3d-1", "sizes": "192x192", "type": "image/png", "purpose": "any"},
    {"src": "/pwa/icon-512.png?v=3d-1", "sizes": "512x512", "type": "image/png", "purpose": "any"},
    {"src": "/pwa/icon-maskable-512.png?v=3d-1", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
]
APP_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>%(name)s</title>
<link rel="manifest" href="/vault/%(slug)s/manifest.webmanifest" crossorigin="use-credentials">
<link rel="apple-touch-icon" sizes="180x180" href="/pwa/icon-180.png?v=3d-1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="%(name)s">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#1a1c20">
<link rel="stylesheet" href="/vendor/orc-ds.tokens.css">
<link rel="stylesheet" href="/vault-app/vault-app.css">
</head>
<body data-vault="%(slug)s" style="--vault-hue: %(hue)d">
<main id="vault-app" class="vault-app" aria-busy="true"><p class="vault-app-loading">Opening %(name)s…</p></main>
<script type="module" src="/vault-app/vault-app.js"></script>
</body>
</html>
"""
MISSING_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vault not found</title><link rel="stylesheet" href="/vendor/orc-ds.tokens.css">
<style>body{margin:0;padding:24px 16px;background:var(--orc-bg);color:var(--orc-text);font-family:system-ui,sans-serif}</style>
</head><body><h1>Vault not found</h1><p>%(error)s</p><p><a href="/#vaults">Open your vaults in Orc</a></p></body></html>
"""


def vault_hue(slug):
    """frontend's vaultHue, so the app wears the vault's colour before its
    script runs."""
    value = 0
    for char in slug:
        value = (value * 31 + ord(char)) % 360
    return value


def app_manifest(slug, name):
    """A vault's app as a phone installs it. Its scope is all of Orc, so
    pairing a phone from inside the app keeps it in the app."""
    return {
        "id": "/vault/%s" % slug, "name": name, "short_name": name[:12],
        "description": "Your %s vault, from Orc." % name, "lang": "en",
        "start_url": "/vault/%s" % slug, "scope": "/", "display": "standalone",
        "background_color": "#1a1c20", "theme_color": "#1a1c20", "icons": APP_ICONS,
    }


def _own(host, slug):
    """This vault's page files as a CSP source, or '' for a Host no browser sends."""
    if not isinstance(host, str) or not HOST.fullmatch(host):
        return ""
    return " http://%s/api/vaults/%s/page/ https://%s/api/vaults/%s/page/" % (host, slug, host, slug)


def page_policy(host, slug):
    """The Content-Security-Policy a vault's page lives under.

    A model wrote the page, from text that can include calendar invites and
    documents other people wrote, and it holds the user's own notes. So it
    runs in a sandbox with an origin of its own, where it cannot read Orc or
    call its routes, and it may load nothing from the network. Pictures
    beside the page are the one thing it loads from this server.

    A policy cannot stop a document sending itself to another address,
    taking what it holds with it in that address. The document that frames
    it can, so the page is framed by one Orc writes, and ``frame-src 'none'``
    there keeps the page's frame from ever going anywhere. The page inherits
    the rest of this policy from that frame."""
    own = _own(host, slug)
    return ("sandbox %s; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
            "img-src data: blob:%s; media-src data: blob:%s; font-src data:; form-action 'none'; base-uri%s; "
            "frame-src 'none'; frame-ancestors 'self'; webrtc 'block'" % (SANDBOX, own, own, own or " 'none'"))


def with_mode(text, mode):
    """The page with Orc's mode, light or dark, as data-orc-mode on its
    <html>, so it paints in that mode with no script (the Vaults list's still
    runs none). The first of two same-named attributes wins, so it goes
    straight after the tag's name; a page with no <html> tag gets one."""
    if mode not in MODES:
        return text
    attribute = ' data-orc-mode="%s"' % mode
    match = HTML_TAG.search(text)
    if match:
        return text[:match.end()] + attribute + text[match.end():]
    doctype = DOCTYPE.search(text)
    at = doctype.end() if doctype else 0
    return text[:at] + "<html%s>" % attribute + text[at:]


def framed(body, slug, mode=None):
    """A page's HTML as the frame holds it: Orc's mode, files beside it found
    by their names, its links handed to Orc to open, and the orcVault bridge."""
    lead = '<base href="/api/vaults/%s/page/">%s' % (slug, LEAD)
    text = with_mode(body.decode("utf-8", "replace"), mode)
    for pattern in (HEAD, HTML_OPEN, DOCTYPE):
        match = pattern.search(text)
        if match:
            return text[:match.end()] + lead + text[match.end():]
    return lead + text


class Service:
    def __init__(self, context):
        self.context = context
        self.store = vault_store.Store(context["home"] / ".orc")
        self.builder = vault_build.Builder(self.store, meetings=context.get("calendar_meetings"),
                                           read_config=context.get("read_config_full"))
        config_dir = context.get("config_dir")
        self.sync = vault_sync.Sync(self.store, config_dir() if callable(config_dir) else context["home"] / ".orc",
                                    building=self.builder.building)
        self._stop = threading.Event()
        self._threads = []
        may_run = context.get("run_schedules")
        if may_run is not None:
            self._start("vault-automations", self.builder.watch, lambda: bool(may_run()) and context["is_enabled"]())
        # Only Orc's own server on the real run store syncs, never a preview or a test.
        if context.get("allow_network"):
            self._start("vault-sync", self.sync.watch, context["is_enabled"])

    def _start(self, name, target, may_run):
        thread = threading.Thread(target=target, name=name, daemon=True, args=(self._stop, may_run))
        thread.start()
        self._threads.append(thread)

    def handle(self, handler, method, path):
        app = (STANDALONE.fullmatch(path) or APP_FILE.fullmatch(path)) if method == "GET" else None
        if not (app or path == PREFIX or path.startswith(PREFIX + "/")) or method not in ("GET", "POST"):
            return False
        if not self.context["is_enabled"]():
            handler.json_error(404, "Vaults is disabled.", False)
            return True
        try:
            if app:
                return self.serve_app(handler, app)
            page = PAGE.fullmatch(path) if method == "GET" else None
            if page:
                return self.serve_page(handler, page[1], page[2] or vault_store.PAGE_INDEX)
            frame = FRAME.fullmatch(path) if method == "GET" else None
            if frame:
                mode = (parse_qs(urlsplit(handler.path).query).get("mode") or [None])[0]
                return self.serve_frame(handler, frame[1], mode)
            if method == "GET":
                status, payload = self.get(path)
            else:
                data = handler.read_json_object(BODY_LIMIT)
                if data is None:
                    raise vault_store.invalid("Send a JSON object.")
                status, payload = self.post(path, data)
                # A change here goes to the other machines soon, not at the next minute.
                if status == 200:
                    self.sync.nudge()
        except vault_store.VaultError as error:
            status, payload = error.status, error.payload()
        except OSError as error:
            status, payload = 503, {"error": "Your vaults are unavailable: %s" % error.strerror, "code": "unavailable"}
        if status is None:
            status, payload = 404, {"error": "Not found.", "code": "not_found"}
        handler._respond(status, json.dumps(payload).encode(), "application/json", {"Cache-Control": "no-store"})
        return True

    def _send(self, handler, slug, body, kind):
        handler._respond(200, body, kind, {
            "Cache-Control": "no-store", "Content-Security-Policy": page_policy(handler.headers.get("Host"), slug),
            "X-Frame-Options": "SAMEORIGIN",
            "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"})
        return True

    def serve_page(self, handler, slug, path):
        """A file beside the page, such as a picture. The page itself is
        shown only inside its frame: at an address of its own it would have
        nothing around it to keep it there."""
        body, kind = self.store.page_file(slug, path)
        if kind == "text/html":
            raise vault_store.VaultError(403, "A vault's page opens inside Orc.", "framed_only")
        return self._send(handler, slug, body, kind)

    def serve_frame(self, handler, slug, mode=None):
        name = self.store.detail(slug)["vault"]["name"]
        body, _kind = self.store.page_file(slug, vault_store.PAGE_INDEX)
        # The frame wears Orc's mode as its colour scheme, so it shows no white
        # behind a dark page and a page that asks prefers-color-scheme hears it.
        scheme = ":root{color-scheme:%s}" % mode if mode in MODES else ""
        wrapper = WRAPPER % {"title": html.escape("%s page" % name, quote=True), "sandbox": SANDBOX,
                             "scheme": scheme, "page": html.escape(framed(body, slug, mode), quote=True)}
        return self._send(handler, slug, wrapper.encode("utf-8"), "text/html")

    def serve_app(self, handler, match):
        """A vault's standalone app: its page, its manifest or the two files
        beside them, all behind Orc's own sign-in like the rest of Orc."""
        if match.re is APP_FILE:
            kind = APP_FILES.get(match[1])
            if kind is None:
                raise vault_store.VaultError(404, "Not found.")
            body = (HERE / match[1]).read_bytes()
            handler._respond(200, body, kind, {"Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"})
            return True
        slug = match[1]
        try:
            name = self.store.detail(slug)["vault"]["name"]
        except vault_store.VaultError as error:
            if match[2]:
                raise
            body = (MISSING_PAGE % {"error": html.escape(str(error))}).encode()
            handler._respond(error.status, body, "text/html", {
                "Cache-Control": "no-store",
                "Content-Security-Policy": "frame-ancestors 'none'",
                "X-Frame-Options": "DENY",
            })
            return True
        if match[2]:
            body, kind = json.dumps(app_manifest(slug, name)).encode(), "application/manifest+json"
            headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                       "Referrer-Policy": "no-referrer"}
        else:
            body = (APP_PAGE % {"name": html.escape(name, quote=True), "slug": slug, "hue": vault_hue(slug)}).encode()
            kind = "text/html"
            headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                       "Referrer-Policy": "no-referrer",
                       "Content-Security-Policy": "frame-ancestors 'none'",
                       "X-Frame-Options": "DENY"}
        handler._respond(200, body, kind, headers)
        return True

    def phone_url(self):
        """Orc's private Tailscale address while phone access is on, else None."""
        found = self.context.get("phone_url")
        try:
            return found() if callable(found) else None
        except Exception:
            return None

    def listed(self):
        return [{**vault, "building": self.builder.building(vault["slug"])} for vault in self.store.list()]

    def detail(self, slug):
        """A vault as its page in Orc shows it: the store's detail, how its
        build stands and what it was last asked."""
        # First, as reading it records a build that has just ended.
        build = self.builder.status(slug)
        return {**self.store.detail(slug), "build": build, "history": self.store.history(slug, HISTORY_SHOWN),
                "accounts": claude_accounts.available(), "phoneUrl": self.phone_url(), "sync": self.sync.status(slug)}

    def get(self, path):
        if path == PREFIX:
            # The New vault dialog starts on the defaults and offers the logins.
            return 200, {"vaults": self.listed(), "templates": vault_store.templates(), "root": str(self.store.root),
                         "defaults": {"model": vault_store.DEFAULT_MODEL, "effort": vault_store.DEFAULT_EFFORT},
                         "accounts": claude_accounts.available()}
        match = NOTE.fullmatch(path)
        if match and not match[3]:
            return 200, {"note": self.store.read_note(match[1], match[2])}
        match = VAULT.fullmatch(path)
        if match and not match[2]:
            return 200, self.detail(match[1])
        return None, None

    def post(self, path, data):
        store = self.store
        if path == PREFIX:
            only(data, "name", "template", "purpose", "model", "effort", "account")
            check_account(data)
            settings = {key: data[key] for key in ("model", "effort", "account") if key in data}
            created = store.create(data.get("name"), data.get("template") or "blank", data.get("purpose"), settings)
            return 200, self.detail(created["vault"]["slug"])
        match = PROPOSAL.fullmatch(path)
        if match:
            only(data)
            proposal = store.decide(match[1], match[2], match[3] == "approve")
            if match[3] == "approve":
                # The page takes up the entry now; one that cannot start
                # leaves it for the next build.
                try:
                    self.builder.absorb(match[1])
                except vault_store.VaultError:
                    pass
            return 200, {"proposal": proposal, **self.detail(match[1])}
        match = AUTOMATION.fullmatch(path)
        if match:
            only(data, "enabled", "delete", "run")
            if data.get("run") is True:
                self.builder.run_automation(match[1], match[2])
            elif data.get("delete") is True:
                store.set_automation(match[1], match[2], delete=True)
            else:
                store.set_automation(match[1], match[2], enabled=data.get("enabled"))
            return 200, self.detail(match[1])
        match = NOTE.fullmatch(path)
        if match:
            if match[3]:
                only(data)
                store.delete_note(match[1], match[2])
                return 200, self.detail(match[1])
            only(data, "text", "baseMtime")
            return 200, {"note": store.save_note(match[1], match[2], data.get("text"), data.get("baseMtime"))}
        match = VAULT.fullmatch(path)
        if not match:
            return None, None
        slug, action = match[1], match[2]
        if action == "/build":
            only(data, "prompt")
            self.builder.start(slug, data.get("prompt"))
        elif action == "/stop":
            only(data)
            self.builder.stop(slug)
        elif action == "/undo":
            only(data)
            if self.builder.building(slug):
                raise vault_store.VaultError(409, "Stop the build before undoing.", "busy")
            store.undo(slug)
        elif action == "/settings":
            only(data, "model", "effort", "account", "calendar")
            check_account(data)
            store.save_settings(slug, data)
        elif action == "/tools":
            only(data, "tool", "allowed")
            if not isinstance(data.get("allowed"), bool):
                raise vault_store.invalid("allowed is true or false.")
            store.allow_tool(slug, data.get("tool"), data["allowed"])
        elif action == "/links":
            only(data, "host", "allowed")
            if not isinstance(data.get("allowed"), bool):
                raise vault_store.invalid("allowed is true or false.")
            store.allow_link(slug, data.get("host"), data["allowed"])
        elif action == "/soul":
            only(data, "text", "baseMtime")
            store.save_soul(slug, data.get("text"), data.get("baseMtime"))
        elif action == "/notes":
            only(data, "path", "text")
            return 200, {"note": store.create_note(slug, data.get("path"), data.get("text") or "")}
        elif action == "/sync":
            only(data, "enabled", "join")
            if not isinstance(data.get("enabled"), bool) or not isinstance(data.get("join", False), bool):
                raise vault_store.invalid("enabled and join are true or false.")
            if data["enabled"] and not self.sync.available():
                raise vault_store.VaultError(409, "Set up your Cloudflare Worker first.", "no_worker")
            self.sync.set_enabled(slug, data["enabled"], data.get("join", False))
        elif action == "/delete":
            only(data, "confirm")
            if data.get("confirm") is not True:
                raise vault_store.invalid("Deleting a vault needs confirm: true.")
            self.builder.stop(slug)
            self.sync.forget(slug)
            store.delete(slug)
            return 200, {"vaults": self.listed()}
        else:
            only(data, "name")
            store.rename(slug, data.get("name"))
        return 200, self.detail(slug)

    def deactivate(self):
        self._stop.set()
        self.sync.nudge()
        for thread in self._threads:
            if thread.is_alive():
                thread.join(timeout=2)
        self._threads = []
        return True


def check_account(data):
    if data.get("account") not in (None, "", *claude_accounts.available()):
        raise vault_store.invalid("That Claude login is not on this Mac.")


def only(data, *allowed):
    unknown = sorted(set(data) - set(allowed))
    if unknown:
        raise vault_store.invalid("Unknown fields: %s." % ", ".join(unknown))


def activate(context):
    return Service(context)
