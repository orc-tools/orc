"""A second loopback origin for the pages agents write: run folders and checkouts.

A mockup, report or SVG in a run folder is someone else's file, so on Orc's own
origin it runs in a CSP sandbox's opaque origin (see `disk_file_headers` in
serve.py). That keeps it from acting as Orc, and it also takes away module
scripts, `fetch` of the files beside it and storage. Opened as a page from Orc
itself, such a file is redirected here instead: a listener on its own port,
so its own origin, that serves only files. Nothing on it answers Orc's API,
and Orc refuses writes and terminals from its origin.

Every URL here is signed for one run folder or one checkout,
`/<signature>/<run id>/<path>`, and serves only beneath that root, so a page
can read the files beside it but not another run's. Dotfiles and dot folders
(`.env`, `.git`, `.headless`) are never served here.

Pages on this origin share its storage with each other, never with Orc.

stdlib-only, like the rest of ui/.
"""

import hashlib
import hmac
import os
import secrets
import threading
from http.server import ThreadingHTTPServer
from urllib.parse import quote, unquote

# Kinds of load that render the file as a page. An <img> of an SVG or a fetch
# from Orc's own script keeps today's answer.
PAGE_DESTINATIONS = frozenset({"document", "iframe", "frame"})
# Only a load Orc's own page starts, or one the user starts (a typed or
# bookmarked URL, a link opened in the browser from Orc.app). A page on this
# origin is same-site with Orc, and framing Orc's URL for another run must not
# hand it that run's signed URL.
STARTED_BY = frozenset({"same-origin", "none"})
# 4174 to 4177 already belong to the MCP route, the phone, the laptop switch
# and the link.
PORT_OFFSET = 5
SCOPES = ("run", "checkout")


def load_key(path):
    """The signing key, created once and kept so a page's URL stays the same
    across restarts."""
    try:
        with open(path, "rb") as handle:
            key = handle.read()
        if len(key) >= 32:
            return key
    except OSError:
        pass
    key = secrets.token_bytes(32)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        descriptor = os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(key)
        os.replace(path + ".tmp", path)
    except OSError:
        pass
    return key


def hidden(relative):
    """True when any part of the path is empty, a dot segment or a dotfile."""
    return any(not part or part.startswith(".") for part in relative.split("/"))


class Origin:
    """The files origin. `roots` maps each scope to a function from a run id to
    that scope's directory (or None); `page_origins()` names Orc's own page
    origins, the only ones that may frame a file served here."""

    def __init__(self, key_path, roots, page_origins):
        self.key_path = key_path
        self.roots = roots
        self.page_origins = page_origins
        self.port = None
        self.server = None
        self._key = None

    @property
    def key(self):
        if self._key is None:
            self._key = load_key(self.key_path)
        return self._key

    def start(self, handler, preferred_port):
        """Listen on 127.0.0.1, at `preferred_port` when it is free and on any
        port otherwise. Returns the port, or None when nothing could bind, in
        which case every page stays sandboxed on Orc's origin."""
        for port in (preferred_port, 0):
            try:
                server = ThreadingHTTPServer(("127.0.0.1", port), handler)
            except OSError:
                continue
            server.orc_file_origin = self
            self.server, self.port = server, server.server_address[1]
            threading.Thread(target=server.serve_forever, name="orc-run-file-origin",
                             daemon=True).start()
            return self.port
        return None

    def stop(self):
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
            self.server = self.port = None

    def signature(self, scope, run_id):
        message = ("%s:%s" % (scope, run_id)).encode()
        return hmac.new(self.key, message, hashlib.sha256).hexdigest()[:32]

    def url(self, scope, run_id, relative, query=""):
        path = "/".join(quote(part) for part in relative.split("/"))
        return "http://127.0.0.1:%d/%s/%s/%s%s" % (
            self.port, self.signature(scope, run_id), quote(run_id), path,
            "?" + query if query else "")

    def redirect_for(self, headers, scope, run_id, relative, query=""):
        """Where a page load of `relative` should go, or None to answer it on
        Orc's origin, sandboxed. `headers` are the request's."""
        if self.port is None or hidden(relative) or hidden(run_id):
            return None
        if headers.get("Sec-Fetch-Dest") not in PAGE_DESTINATIONS:
            return None
        if headers.get("Sec-Fetch-Site") not in STARTED_BY:
            return None
        return self.url(scope, run_id, relative, query)

    def resolve(self, path):
        """The file a request path names, or None."""
        parts = path.lstrip("/").split("/", 2)
        if len(parts) != 3:
            return None
        signature, run_id, relative = parts[0], unquote(parts[1]), unquote(parts[2])
        if hidden(run_id) or hidden(relative) or "/" in run_id:
            return None
        for scope in SCOPES:
            if hmac.compare_digest(signature, self.signature(scope, run_id)):
                root = self.roots[scope](run_id)
                break
        else:
            return None
        if not root:
            return None
        root = os.path.realpath(root)
        full = os.path.realpath(os.path.join(root, relative))
        # A symlink inside the root may still point out of it.
        if not full.startswith(root + os.sep) or hidden(os.path.relpath(full, root)):
            return None
        return full if os.path.isfile(full) else None

    def headers(self):
        """Headers for every file served here. Only Orc's own page may frame
        one, and its signed URL never leaves in a Referer."""
        return {
            "Content-Security-Policy": "frame-ancestors %s" % " ".join(self.page_origins()),
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "same-origin",
        }

    def own_host(self, host):
        """The Host a request to this listener must carry. Any other means a
        page pointed its own domain at 127.0.0.1."""
        port = self.port
        return (host or "").lower() in {"127.0.0.1:%s" % port, "localhost:%s" % port,
                                        "[::1]:%s" % port}
