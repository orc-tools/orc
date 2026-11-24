"""Public, read-only server for shared plan copies (Tailscale Funnel backend).

Stdlib only. Serves nothing but snapshots created by Store.share() and the
static page assets, so the public URL cannot reach anything else on the Mac.
"""

import html
import json
import os
import re
import secrets
import shutil
import tempfile
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BACKEND_PORT = 4190
# Funnel puts this server on the internet: idle connections are dropped, and
# only so many are served at once, so it cannot tie up the Orc process.
SOCKET_TIMEOUT = 15
MAX_CONNECTIONS = 32
LIFETIME_SECONDS = 7 * 24 * 3600
MAX_IMAGE_BYTES = 15 * 1024 * 1024
IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
}
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")
FILE_NAME_RE = re.compile(r"^[0-9]+\.(png|jpe?g|gif|webp|svg)$")
SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
FRONT_MATTER_RE = re.compile(r"\A---[ \t]*\r?\n.*?\r?\n---[ \t]*(?:\r?\n|\Z)", re.S)
GONE_MESSAGE = "This shared plan has expired or was stopped."

PAGE_DIR = Path(__file__).resolve().parent / "share-page"
UI_DIR = Path(__file__).resolve().parents[2] / "ui"
# Orc's own Markdown renderer and cleaner, so a shared plan is drawn and
# cleaned exactly as Orc draws it.
ORC_SCRIPTS = {
    "marked.min.js": UI_DIR / "marked.min.js",
    "orc-safe-html.min.js": UI_DIR / "vendor" / "orc-safe-html.min.js",
}

CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; "
    "img-src 'self' https: data:; connect-src 'self'; base-uri 'none'; "
    "form-action 'none'; frame-ancestors 'none'"
)
SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'"

# One pass over the markdown: a markdown image, an HTML <img>, or a link.
_REF_RE = re.compile(
    r"""
    (?P<img>!\[(?P<ialt>[^\]]*)\]\(\s*<?(?P<iurl>[^)\s>]*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\))
  | (?P<html><img\b[^>]*>)
  | (?P<link>\[(?P<ltext>(?:[^\[\]]|!\[[^\]]*\]\([^)]*\))*)\]\(\s*<?(?P<lurl>[^)\s>]*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\))
    """,
    re.X,
)
_SRC_RE = re.compile(r"""\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", re.I)
_ALT_RE = re.compile(r"""\balt\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)


class ShareError(ValueError):
    pass


def _is_remote(url):
    return url.lower().startswith(("http://", "https://"))


def _is_relative(url):
    return bool(url) and not SCHEME_RE.match(url) and url[0] not in "/#"


class Store:
    def __init__(self, root, clock=time.time):
        self.root = Path(root)
        self.clock = clock
        self._lock = threading.RLock()

    # -- index ---------------------------------------------------------
    def _index_path(self):
        return self.root / "index.json"

    def _load(self):
        try:
            data = json.loads(self._index_path().read_text("utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def _save(self, index):
        self.root.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.root, prefix=".index-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(index, fh)
            os.replace(tmp, self._index_path())
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def _live(self, entry):
        return (
            isinstance(entry, dict)
            and TOKEN_RE.match(str(entry.get("token", "")))
            and entry.get("expiresAt", 0) > self.clock()
        )

    @staticmethod
    def _public(run_id, entry):
        return {
            "runId": run_id,
            "token": entry["token"],
            "path": "/p/%s/" % entry["token"],
            "createdAt": entry["createdAt"],
            "expiresAt": entry["expiresAt"],
        }

    def _rmtree(self, token):
        if TOKEN_RE.match(str(token)):
            shutil.rmtree(self.root / token, ignore_errors=True)

    # -- public API ----------------------------------------------------
    def share(self, run_id, run_dir, title):
        if not isinstance(run_id, str) or not RUN_ID_RE.match(run_id):
            raise ShareError("Invalid run id.")
        run_dir = Path(run_dir)
        source = run_dir / "planning" / "planning.mdx"
        try:
            real_run = run_dir.resolve()
            real_source = source.resolve(strict=True)
            real_source.relative_to(real_run)
            if not real_source.is_file():
                raise OSError
            text = real_source.read_text("utf-8", errors="replace")
        except (OSError, ValueError):
            raise ShareError("This run has no plan to share.")
        text = FRONT_MATTER_RE.sub("", text, count=1)

        with self._lock:
            now = self.clock()
            index = self._load()
            old = index.get(run_id)
            if self._live(old):
                token, created = old["token"], old.get("createdAt", now)
            else:
                if old:
                    self._rmtree(old.get("token"))
                token, created = secrets.token_urlsafe(32), now
            expires = now + LIFETIME_SECONDS

            self.root.mkdir(parents=True, exist_ok=True)
            tmp = Path(tempfile.mkdtemp(dir=self.root, prefix=".tmp-"))
            try:
                markdown = self._rewrite(text, real_run, real_source.parent, tmp)
                (tmp / "plan.md").write_text(markdown, "utf-8")
                (tmp / "share.json").write_text(
                    json.dumps({"title": str(title), "createdAt": created, "expiresAt": expires}),
                    "utf-8",
                )
                dest = self.root / token
                if dest.exists():
                    parked = self.root / (".old-" + secrets.token_hex(8))
                    os.replace(dest, parked)
                    os.replace(tmp, dest)
                    shutil.rmtree(parked, ignore_errors=True)
                else:
                    os.replace(tmp, dest)
            except BaseException:
                shutil.rmtree(tmp, ignore_errors=True)
                raise
            entry = {"token": token, "createdAt": created, "expiresAt": expires}
            index[run_id] = entry
            self._save(index)
            return self._public(run_id, entry)

    def stop(self, run_id):
        with self._lock:
            index = self._load()
            entry = index.pop(run_id, None)
            if entry is None:
                return False
            self._rmtree(entry.get("token"))
            self._save(index)
            return True

    def get(self, run_id):
        with self._lock:
            entry = self._load().get(run_id)
            return self._public(run_id, entry) if self._live(entry) else None

    def resolve(self, token):
        if not isinstance(token, str) or not TOKEN_RE.match(token):
            return None
        with self._lock:
            for entry in self._load().values():
                if self._live(entry) and entry["token"] == token:
                    path = self.root / token
                    return path if path.is_dir() else None
        return None

    def prune(self):
        with self._lock:
            index = self._load()
            removed = 0
            for run_id in list(index):
                if not self._live(index[run_id]):
                    self._rmtree(index[run_id].get("token") if isinstance(index[run_id], dict) else None)
                    del index[run_id]
                    removed += 1
            keep = {e["token"] for e in index.values()}
            if self.root.is_dir():
                for child in self.root.iterdir():
                    if child.is_dir() and not child.is_symlink() and child.name not in keep:
                        shutil.rmtree(child, ignore_errors=True)
                        if not child.name.startswith("."):
                            removed += 1
            if removed:
                self._save(index)
            return removed

    # -- markdown rewriting -------------------------------------------
    def _rewrite(self, text, real_run, base, snapshot):
        copied = {}

        def copy_image(url):
            clean = urllib.parse.unquote(re.split(r"[?#]", url, maxsplit=1)[0])
            if not _is_relative(clean):
                return None
            try:
                real = (base / clean).resolve(strict=True)
                real.relative_to(real_run)
                ext = real.suffix.lower()
                if ext not in IMAGE_TYPES or not real.is_file():
                    return None
                if real.stat().st_size > MAX_IMAGE_BYTES:
                    return None
            except (OSError, ValueError, RuntimeError):
                return None
            if real not in copied:
                name = "%d%s" % (len(copied), ext)
                (snapshot / "files").mkdir(exist_ok=True)
                shutil.copyfile(real, snapshot / "files" / name)
                copied[real] = "files/" + name
            return copied[real]

        def sub(match):
            if match.group("img") is not None:
                alt, url = match.group("ialt"), match.group("iurl")
                if _is_remote(url):
                    return match.group(0)
                new = copy_image(url)
                return "![%s](%s)" % (alt, new) if new else alt
            if match.group("html") is not None:
                tag = match.group("html")
                src = _SRC_RE.search(tag)
                value = next((g for g in src.groups() if g is not None), "") if src else ""
                if _is_remote(value):
                    return tag
                new = copy_image(value) if src else None
                if new:
                    return tag[: src.start()] + 'src="%s"' % new + tag[src.end():]
                alt = _ALT_RE.search(tag)
                return html.escape(next((g for g in alt.groups() if g), "")) if alt else ""
            inner = _REF_RE.sub(sub, match.group("ltext"))
            url = match.group("lurl")
            if _is_remote(url) or url.lower().startswith("mailto:") or url.startswith("#"):
                return "[%s](%s)" % (inner, url)
            return inner

        return _REF_RE.sub(sub, text)


def make_server(store, address=("127.0.0.1", BACKEND_PORT)):
    assets = {
        "/assets/share.js": (PAGE_DIR / "share.js", "text/javascript; charset=utf-8"),
        "/assets/share.css": (PAGE_DIR / "share.css", "text/css; charset=utf-8"),
    }
    for name, path in ORC_SCRIPTS.items():
        if path.is_file():
            assets["/assets/" + name] = (path, "text/javascript; charset=utf-8")

    class Handler(BaseHTTPRequestHandler):
        server_version = "share"
        sys_version = ""
        protocol_version = "HTTP/1.1"
        timeout = SOCKET_TIMEOUT

        def log_message(self, *args):
            pass

        def _send(self, status, body, ctype="text/plain; charset=utf-8", csp=CSP, extra=None):
            if isinstance(body, str):
                body = body.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Security-Policy", csp)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Robots-Tag", "noindex")
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def send_error(self, code, message=None, explain=None):
            self._send(code, "Error")

        def _not_found(self, message="Not found"):
            self._send(404, message)

        def _serve_file(self, path, ctype, csp=CSP):
            try:
                body = path.read_bytes()
            except OSError:
                return self._not_found()
            self._send(200, body, ctype, csp)

        def _route(self):
            raw = self.path.split("?", 1)[0].split("#", 1)[0]
            if raw in assets:
                path, ctype = assets[raw]
                return self._serve_file(path, ctype)
            parts = raw.split("/")
            if len(parts) < 3 or parts[0] != "" or parts[1] != "p" or not TOKEN_RE.match(parts[2]):
                return self._not_found()
            token, rest = parts[2], parts[3:]
            if rest == []:
                return self._send(301, "", extra={"Location": "/p/%s/" % token})
            snap = store.resolve(token)
            if snap is None:
                return self._not_found(GONE_MESSAGE)
            if rest == [""]:
                try:
                    meta = json.loads((snap / "share.json").read_text("utf-8"))
                    shell = (PAGE_DIR / "share.html").read_text("utf-8")
                except (OSError, ValueError):
                    return self._not_found()
                title = html.escape(str(meta.get("title") or "Shared plan"))
                return self._send(200, shell.replace("{{TITLE}}", title), "text/html; charset=utf-8")
            if rest == ["plan.md"]:
                return self._serve_file(snap / "plan.md", "text/markdown; charset=utf-8")
            if rest == ["share.json"]:
                return self._serve_file(snap / "share.json", "application/json")
            if len(rest) == 2 and rest[0] == "files" and FILE_NAME_RE.match(rest[1]):
                ext = "." + rest[1].rsplit(".", 1)[1].lower()
                csp = SVG_CSP if ext == ".svg" else CSP
                return self._serve_file(snap / "files" / rest[1], IMAGE_TYPES[ext], csp)
            return self._not_found()

        def do_GET(self):
            self._route()

        do_HEAD = do_GET

        def _method_not_allowed(self):
            self._send(405, "Method not allowed", extra={"Allow": "GET, HEAD"})

        do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _method_not_allowed

    class Server(ThreadingHTTPServer):
        daemon_threads = True
        slots = threading.BoundedSemaphore(MAX_CONNECTIONS)

        def process_request(self, request, client_address):
            if not self.slots.acquire(blocking=False):
                self.shutdown_request(request)
                return
            try:
                super().process_request(request, client_address)
            except BaseException:
                self.slots.release()
                raise

        def process_request_thread(self, request, client_address):
            try:
                super().process_request_thread(request, client_address)
            finally:
                self.slots.release()

    return Server(address, Handler)
