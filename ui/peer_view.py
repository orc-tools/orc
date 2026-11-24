"""The laptop switch: this laptop's windows onto its linked laptops' Orcs.

Each linked laptop gets a loopback-only listener that forwards every request
through the link to that laptop's own Orc, rewriting Host and Origin so that
Orc treats the page as its own. While that laptop sleeps the listener answers
with this laptop's own page and code and the last data it saw, read-only, and
holds messages, question answers, new runs and messages to its assistant in a
queue that replays when the laptop is back.

`/api/link/` stays on this laptop: it describes the links from the viewer's
side, so the switch and the queues work from any window.

stdlib-only, like the rest of ui/.
"""

import base64
import functools
import hashlib
import http.client
import http.cookies
import json
import os
import re
import secrets
import select
import shutil
import socket
import ssl
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import peer_link

CACHE_LIMIT = 2 * 1024 * 1024
# Saved with a run-list part and sent again offline, so an asleep laptop
# answers with a matching live and settled pair.
REPLAYED_HEADERS = ("ETag", "X-Orc-Settled-Etag")
BODY_LIMIT = 64 * 1024 * 1024
HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
               "trailer", "transfer-encoding", "upgrade", "content-length"}
STATIC = re.compile(r"^/(?:js|vendor|theme-kit|assets|fonts|pwa)/|^/[\w.-]+\.(?:js|css|wav|woff2?|png|webmanifest)$")
# While the other laptop sleeps, its page runs this laptop's code. The saved
# copy holds only the files that loaded before, from whatever Orc it ran then,
# and a page mixing two versions' modules fails to start. Plugin files are
# named by a digest that changes with each version, so the plugin list that
# names them comes from here too. Only data comes from the saved copy.
OWN_CODE_OFFLINE = re.compile(STATIC.pattern + r"|^/app-plugin-assets/|^/api/app-plugins$"
                              r"|^/(?:sounds|gallery-backdrops)/")
NEVER_CACHE = re.compile(r"^/api/(?:link|events|lan|tailscale)\b|/terminal\b")
QUEUEABLE = (
    (re.compile(r"^/runs/([^/]+)/chat-send$"), "orc", "Message to %s"),
    (re.compile(r"^/runs/([^/]+)/answer-question$"), "orc", "Answer for %s"),
    (re.compile(r"^/api/new-conversation$"), "orc", "New run"),
    (re.compile(r"^/api/orchestrator/send$"), "assistant", "Message to its assistant"),
)
TEXT_KEYS = ("text", "prompt")
# Each fresh tunnel costs a TCP, TLS and CONNECT round trip before the request,
# so a page load through the switch borrows tunnels dialled ahead instead.
POOL_SIZE = 8
POOL_AGE = 15
# Set on /api/link/ requests relayed from a switched window to the id of the
# laptop it shows, so this laptop answers with its own side of that link.
VIEW_HEADER = "X-Orc-Link-View"
# Set on every request forwarded to the other laptop's Orc. That Orc then
# answers a run file itself rather than redirect to its files origin, a
# loopback port this laptop cannot reach.
LINKED_HEADER = "X-Orc-Via-Link"


def _mark_view(page):
    return page.replace(b"</head>", b"<script>window.ORC_LINK_VIEW = true;</script></head>", 1)


def _mark_asleep_view(page):
    """This laptop's own page standing in for a sleeping one. The cover reads
    the mark: a page served from here starts in a second or two, or not at all."""
    return page.replace(b"</head>", b"<script>window.ORC_LINK_VIEW = true; window.ORC_LINK_VIEW_ASLEEP = true;"
                                    b"</script></head>", 1)


def _write_atomic(path, data):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".view-")
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


class Cache:
    """The last successful GET for each path, for read-only offline viewing."""

    def __init__(self, directory):
        self.dir = directory

    def _file(self, path):
        return os.path.join(self.dir, hashlib.sha256(path.encode()).hexdigest() + ".json")

    def put(self, path, content_type, body, headers=None):
        record = {"path": path, "contentType": content_type, "savedAt": time.time(),
                  "body": base64.b64encode(body).decode(), "headers": headers or {}}
        _write_atomic(self._file(path), json.dumps(record).encode())

    def get(self, path):
        """(content type, body, saved at, headers to replay), or None."""
        try:
            with open(self._file(path)) as stream:
                record = json.load(stream)
            return (record["contentType"], base64.b64decode(record["body"]), record["savedAt"],
                    record.get("headers") or {})
        except (OSError, ValueError, KeyError):
            return None

    def clear(self):
        try:
            names = os.listdir(self.dir)
        except OSError:
            return
        for name in names:
            try:
                os.unlink(os.path.join(self.dir, name))
            except OSError:
                pass


class Queue:
    """Requests held for a sleeping laptop, sent in order when it's back."""

    def __init__(self, path):
        self.path = path
        self._lock = threading.RLock()

    def items(self):
        try:
            with open(self.path) as stream:
                data = json.load(stream)
            return data if isinstance(data, list) else []
        except (OSError, ValueError):
            return []

    def _save(self, items):
        _write_atomic(self.path, (json.dumps(items, indent=2) + "\n").encode())

    @staticmethod
    def match(method, path):
        if method != "POST":
            return None
        for pattern, target, label in QUEUEABLE:
            found = pattern.match(path)
            if found:
                return target, (label % found[1]) if found.groups() else label
        return None

    def add(self, method, path, body):
        matched = self.match(method, path)
        if not matched or not isinstance(body, dict):
            return None
        if path == "/api/new-conversation" and body.get("launchAction", "start") != "start":
            return None
        target, label = matched
        item = {"id": secrets.token_hex(6), "method": method, "path": path, "body": body,
                "target": target, "label": label, "createdAt": time.time(),
                "state": "waiting", "error": None}
        with self._lock:
            self._save(self.items() + [item])
        return item

    def edit(self, item_id, text):
        if not isinstance(text, str) or not text.strip():
            raise peer_link.LinkError(400, "Write something to send.")
        with self._lock:
            items = self.items()
            for item in items:
                if item["id"] == item_id:
                    key = next((k for k in TEXT_KEYS if isinstance(item["body"].get(k), str)), None)
                    if key is None:
                        raise peer_link.LinkError(409, "This item has no text to edit.")
                    item["body"][key] = text
                    item["state"], item["error"] = "waiting", None
                    self._save(items)
                    return item
        raise peer_link.LinkError(404, "That item already went or was deleted.")

    def delete(self, item_id):
        with self._lock:
            items = self.items()
            kept = [item for item in items if item["id"] != item_id]
            if len(kept) == len(items):
                raise peer_link.LinkError(404, "That item already went or was deleted.")
            self._save(kept)

    def drop_all(self):
        with self._lock:
            count = sum(1 for item in self.items())
            try:
                os.unlink(self.path)
            except FileNotFoundError:
                pass
            return count

    def flush(self, send):
        """Send waiting items in order with `send(method, path, body) -> status, data`.
        Stops at the first item the laptop can't take yet; a refusal marks the
        item failed and moves on, so one bad item doesn't block the rest."""
        sent = 0
        with self._lock:
            for item in self.items():
                if item["state"] != "waiting":
                    continue
                try:
                    status, data = send(item["method"], item["path"], item["body"])
                except peer_link.LinkError:
                    break
                if status >= 500:
                    break
                items = self.items()
                if status < 400:
                    items = [other for other in items if other["id"] != item["id"]]
                    sent += 1
                else:
                    for other in items:
                        if other["id"] == item["id"]:
                            other["state"] = "failed"
                            other["error"] = (data or {}).get("error") or "Refused (%d)." % status
                self._save(items)
        return sent

    def public(self):
        return [{key: item.get(key) for key in ("id", "label", "target", "path", "createdAt", "state", "error")}
                | {"text": next((item["body"][k] for k in TEXT_KEYS if isinstance(item["body"].get(k), str)), None)}
                for item in self.items()]


def _unused(sock):
    """True while a dialled tunnel has heard nothing, so it is still open and
    no stray bytes would land in front of the next response."""
    try:
        if isinstance(sock, ssl.SSLSocket) and sock.pending():
            return False
        if not select.select([sock], [], [], 0)[0]:
            return True
        sock.setblocking(False)
        try:
            sock.recv(1)
            return False
        except (ssl.SSLWantReadError, ssl.SSLWantWriteError, BlockingIOError):
            return True
        finally:
            sock.setblocking(True)
    except (OSError, ValueError):
        return False


class TunnelPool:
    """Tunnels to the other laptop's Orc, dialled before the switch needs them.

    `warm` keeps up to `size` ready for the next `max_age` seconds, and every
    borrow extends that, so the pool stays full while the switched window is in
    use and empties once nobody is switching. Only reads borrow: a pooled
    tunnel can be dead without knowing it, and a read can safely go again on a
    fresh one."""

    def __init__(self, link, size=POOL_SIZE, max_age=POOL_AGE, clock=time.monotonic):
        self.link = link
        self.size = size
        self.max_age = max_age
        self.clock = clock
        self._lock = threading.Lock()
        self._ready = []
        self._lent = set()
        self._dialling = 0
        self._wanted_until = 0.0

    def ready(self):
        with self._lock:
            return len(self._ready)

    def warm(self):
        with self._lock:
            self._wanted_until = self.clock() + self.max_age
        self._fill()

    def take(self):
        """A ready tunnel, or None when the caller should dial its own."""
        self.warm()
        while True:
            with self._lock:
                if not self._ready:
                    return None
                sock, dialled = self._ready.pop()
                fresh = self.clock() - dialled < self.max_age
                if fresh:
                    self._lent.add(sock)
            if fresh and _unused(sock):
                self._fill()
                return sock
            self.done(sock)
            _close(sock)

    def done(self, sock):
        with self._lock:
            self._lent.discard(sock)

    def prune(self):
        """Close tunnels nobody borrowed in time."""
        now = self.clock()
        with self._lock:
            stale = [sock for sock, dialled in self._ready if now - dialled >= self.max_age]
            self._ready = [(sock, dialled) for sock, dialled in self._ready if now - dialled < self.max_age]
        for sock in stale:
            _close(sock)

    def drain(self):
        """The other laptop went away: drop the pool and hang up borrowed
        tunnels, so a request on one fails over instead of waiting it out."""
        with self._lock:
            ready, self._ready = self._ready, []
            lent, self._lent = self._lent, set()
            self._wanted_until = 0.0
        for sock, _ in ready:
            _close(sock)
        for sock in lent:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def _fill(self):
        with self._lock:
            if not self.link.online or self.clock() >= self._wanted_until:
                return
            need = self.size - len(self._ready) - self._dialling
            if need <= 0:
                return
            self._dialling += need
        for _ in range(need):
            threading.Thread(target=self._dial, daemon=True).start()

    def _dial(self):
        try:
            sock = self.link.open_tunnel()
        except (peer_link.LinkError, OSError):
            sock = None
        with self._lock:
            self._dialling -= 1
            if sock is not None and self.clock() < self._wanted_until:
                self._ready.append((sock, self.clock()))
                sock = None
        if sock is not None:
            _close(sock)


def _close(sock):
    try:
        sock.close()
    except OSError:
        pass


class PortForwards:
    """Local loopback ports that tunnel to the linked laptop's worktree apps."""

    def __init__(self, link):
        self.link = link
        self._lock = threading.Lock()
        self._listeners = {}

    def local_port(self, peer_port):
        with self._lock:
            if peer_port in self._listeners:
                return self._listeners[peer_port].getsockname()[1]
            listener = socket.create_server(("127.0.0.1", 0))
            self._listeners[peer_port] = listener
        threading.Thread(target=self._accept, args=(listener, peer_port), daemon=True).start()
        return listener.getsockname()[1]

    def _accept(self, listener, peer_port):
        while True:
            try:
                client, _ = listener.accept()
            except OSError:
                return
            threading.Thread(target=self._serve, args=(client, peer_port), daemon=True).start()

    def _serve(self, client, peer_port):
        try:
            upstream = self.link.open_tunnel(peer_port)
        except (peer_link.LinkError, OSError):
            client.close()
            return
        peer_link.pipe(client, upstream)

    def close_all(self):
        with self._lock:
            listeners, self._listeners = self._listeners, {}
        for listener in listeners.values():
            listener.close()


class ViewProxy:
    def __init__(self, link, local_port, view_port, cache, queue, forwards, same_version=lambda: False,
                 view_id="1"):
        self.link = link
        self.view_id = view_id
        self.local_port = local_port
        self.view_port = view_port
        self.cache = cache
        self.queue = queue
        self.forwards = forwards
        self.same_version = same_version
        self.pool = TunnelPool(link)
        self.server = None
        self.error = None
        self._lock = threading.Lock()

    def sync(self, want):
        with self._lock:
            if want and self.server is None:
                try:
                    self.server = ThreadingHTTPServer(("127.0.0.1", self.view_port), _ViewHandler)
                except OSError as exc:
                    self.error = "could not listen on port %d: %s" % (self.view_port, exc.strerror or exc)
                    return
                self.error = None
                self.server.daemon_threads = True
                self.server.view = self
                self.view_port = self.server.server_address[1]
                threading.Thread(target=self.server.serve_forever, daemon=True).start()
            elif not want and self.server is not None:
                server, self.server = self.server, None
                server.shutdown()
                server.server_close()

    def base_url(self):
        return "http://127.0.0.1:%d/" % self.view_port


class Views:
    """One switch window per linked laptop, each with its own loopback port,
    saved pages and send queue under `directory/peers/<id>/`."""

    def __init__(self, link, local_port, first_port, directory, same_version=lambda handle: False):
        self.link = link
        self.local_port = local_port
        self.first_port = first_port
        self.dir = directory
        self.same_version = same_version
        self._views = {}
        self._lock = threading.Lock()

    def _dir(self, fingerprint):
        return os.path.join(self.dir, "peers", peer_link.peer_id(fingerprint))

    def get(self, fingerprint):
        return self._views.get(fingerprint)

    def all(self):
        return list(self._views.values())

    def _adopt_single_link_files(self, peers):
        """A laptop that held one link kept its saved pages and unsent
        messages beside state.json; they belong to that one laptop."""
        if not peers:
            return
        home = self._dir(peers[0]["fingerprint"])
        for name in ("queue.json", "cache"):
            old, new = os.path.join(self.dir, name), os.path.join(home, name)
            if os.path.exists(old) and not os.path.exists(new):
                os.makedirs(home, mode=0o700, exist_ok=True)
                os.replace(old, new)

    def _make(self, peer, taken):
        handle = self.link.of(peer["fingerprint"])
        port = peer.get("viewPort")
        if port is None:
            port = self.first_port if self.first_port not in taken else 0
        home = self._dir(peer["fingerprint"])
        return ViewProxy(handle, self.local_port, port, Cache(os.path.join(home, "cache")),
                         Queue(os.path.join(home, "queue.json")), PortForwards(handle),
                         same_version=functools.partial(self.same_version, handle), view_id=handle.id)

    def sync(self):
        """Open a window for every linked laptop and close the others."""
        peers = self.link.peers()
        with self._lock:
            self._adopt_single_link_files(peers)
            wanted = {peer["fingerprint"] for peer in peers}
            for fingerprint in [found for found in self._views if found not in wanted]:
                self._close(self._views.pop(fingerprint))
            taken = {peer.get("viewPort") for peer in peers}
            for peer in peers:
                view = self._views.get(peer["fingerprint"])
                if view is None:
                    view = self._views[peer["fingerprint"]] = self._make(peer, taken)
                    taken.add(view.view_port)
                if view.server is not None:
                    continue
                view.sync(True)
                if view.server is None and view.view_port not in (0, self.first_port):
                    # Another program took the port this window had last time.
                    view.view_port = 0
                    view.sync(True)
                if view.server is not None and peer.get("viewPort") != view.view_port:
                    self.link.update_peer(peer["fingerprint"], viewPort=view.view_port)

    @staticmethod
    def _close(view):
        view.forwards.close_all()
        view.pool.drain()
        threading.Thread(target=view.sync, args=(False,), daemon=True).start()

    def drop(self, fingerprint):
        """Delete everything kept for a laptop that is no longer linked.
        Returns how many unsent items went with it."""
        with self._lock:
            view = self._views.pop(fingerprint, None)
        if view is not None:
            self._close(view)
        home = self._dir(fingerprint)
        dropped = Queue(os.path.join(home, "queue.json")).drop_all()
        shutil.rmtree(home, ignore_errors=True)
        return dropped


class _ViewHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    @property
    def view(self):
        return self.server.view

    def do_GET(self):
        self._handle()

    do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = do_OPTIONS = do_GET

    def _body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > BODY_LIMIT:
            raise peer_link.LinkError(413, "Request too large.")
        return self.rfile.read(length) if length > 0 else b""

    def _json(self, status, data, extra=None):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _handle(self):
        path = urlsplit(self.path).path
        try:
            body = self._body()
        except peer_link.LinkError as exc:
            self.close_connection = True
            return self._json(exc.status, {"error": str(exc)})
        if path == "/api/link" or path.startswith("/api/link/"):
            return self._relay_local(body, view=True)
        transform = _mark_view if path == "/" and self.command == "GET" else None
        if self.command == "GET" and STATIC.match(path) and self.view.same_version():
            return self._relay_local(body)
        if self._loads_code(path) and self._page_code() == "here":
            # A page opened while the other laptop slept keeps running this
            # laptop's code after it wakes, so its modules and plugins match.
            return self._relay_local(body)
        # Each dial to a sleeping laptop can take seconds per host, and the page
        # loads dozens of files, so wait for the heartbeat to see it back.
        if not self.view.link.online:
            return self._offline(path, body)
        preview = re.fullmatch(r"/runs/([^/]+)/preview", path)
        if preview and self.command == "GET":
            return self._preview(preview[1])
        if self.headers.get("Upgrade", "").lower() == "websocket":
            return self._upgrade(body)
        peer = self.view.link.peer()
        if not peer:
            return self._offline(path, body)
        port = peer.get("orcPort")
        pool = self.view.pool
        pooled = pool.take() if self.command in ("GET", "HEAD") else None
        if pooled is not None:
            try:
                if self._forward(pooled, port, body, cache=True, transform=transform, retry=True):
                    return
            finally:
                pool.done(pooled)
        try:
            upstream = self.view.link.open_tunnel()
        except peer_link.LinkError:
            return self._offline(path, body)
        self._forward(upstream, port, body, cache=True, transform=transform)

    def _rewrite_headers(self, port, origin_from):
        headers = []
        target = "http://127.0.0.1:%d" % port
        for name, value in self.headers.items():
            lower = name.lower()
            if lower in HOP_HEADERS or lower == "host":
                continue
            if lower in ("origin", "referer") and value.startswith(origin_from):
                value = target + value[len(origin_from):]
            headers.append((name, value))
        headers.append(("Host", "127.0.0.1:%d" % port))
        headers.append((LINKED_HEADER, "1"))
        return headers

    def _own_origin(self):
        return "http://127.0.0.1:%d" % self.view.view_port

    def _loads_code(self, path):
        return path != "/" and self.command in ("GET", "HEAD") and OWN_CODE_OFFLINE.match(path) is not None

    # Each page records whose code it runs, in a cookie named for this window's
    # port, since cookies are shared by every port on 127.0.0.1. Its later
    # script, style and plugin requests then come from the same Orc after the
    # other laptop falls asleep or wakes.
    def _code_cookie(self):
        return "orc-view-code-%d" % self.view.view_port

    def _page_code(self):
        cookie = http.cookies.SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie") or "")
        except http.cookies.CookieError:
            return None
        found = cookie.get(self._code_cookie())
        return found.value if found else None

    def _forward(self, sock, port, body, cache=False, transform=None, extra=(), retry=False):
        """Send the request down `sock` and relay the answer. With `retry`, a
        tunnel that fails before answering returns False and sends nothing, so
        the caller can go again on a fresh one."""
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=300)
        conn.sock = sock
        try:
            conn.putrequest(self.command, self.path, skip_host=True, skip_accept_encoding=True)
            for name, value in [*self._rewrite_headers(port, self._own_origin()), *extra]:
                conn.putheader(name, value)
            conn.putheader("Content-Length", str(len(body)))
            conn.endheaders(body or None)
            response = conn.getresponse()
        except (OSError, http.client.HTTPException) as exc:
            conn.close()
            if retry:
                return False
            self._json(502, {"error": "The other laptop stopped answering: %s" % exc})
            return True
        try:
            self._send_response(response, port, cache, transform)
        except OSError:
            self.close_connection = True
        finally:
            conn.close()
        return True

    def _cache_key(self):
        """The run list's live and settled parts share a path and differ by
        header, so each part is saved under its own key."""
        part = self.headers.get("X-Orc-Runs-Part")
        return self.path + "#part=" + part if part else self.path

    def _cache_limit(self):
        # A busy machine's settled part runs to several MB, and an offline
        # live part names a settled ETag that only the saved settled part can
        # answer, so run-list parts are saved up to the body limit.
        return BODY_LIMIT if self.headers.get("X-Orc-Runs-Part") else CACHE_LIMIT

    def _send_response(self, response, port, cache, transform):
        source = "http://127.0.0.1:%d" % port
        content_type = response.getheader("Content-Type") or ""
        whole = transform is not None or (cache and self.command == "GET" and response.status == 200
                                          and not NEVER_CACHE.search(urlsplit(self.path).path)
                                          and not OWN_CODE_OFFLINE.match(urlsplit(self.path).path)
                                          and (response.length or 0) <= self._cache_limit()
                                          and response.length is not None)
        self.send_response(response.status, response.reason)
        if transform is not None:
            self.send_header("Set-Cookie", "%s=%s; Path=/; HttpOnly; SameSite=Strict" % (
                self._code_cookie(), "here" if transform is _mark_asleep_view else "there"))
        for name, value in response.getheaders():
            lower = name.lower()
            if lower in HOP_HEADERS:
                continue
            if lower == "location" and value.startswith(source):
                value = self._own_origin() + value[len(source):]
            self.send_header(name, value)
        no_body = self.command == "HEAD" or response.status in (204, 304) or 100 <= response.status < 200
        if no_body:
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if whole:
            data = response.read()
            if transform is not None:
                data = transform(data)
            elif data:
                saved = {name: response.getheader(name) for name in REPLAYED_HEADERS
                         if response.getheader(name) is not None}
                self.view.cache.put(self._cache_key(), content_type, data, saved)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if response.length is not None:
            self.send_header("Content-Length", str(response.length))
            self.end_headers()
            while True:
                chunk = response.read(65536)
                if not chunk:
                    return
                self.wfile.write(chunk)
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        while True:
            chunk = response.read1(65536)
            if not chunk:
                break
            self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
            self.wfile.flush()
        self.wfile.write(b"0\r\n\r\n")

    def _relay_local(self, body, view=False, transform=None):
        sock = socket.create_connection(("127.0.0.1", self.view.local_port), timeout=10)
        extra = [(VIEW_HEADER, self.view.view_id)] if view else []
        self._forward(sock, self.view.local_port, body, transform=transform, extra=extra)

    def _upgrade(self, body):
        """Terminal WebSockets: send the request head, then copy raw bytes."""
        try:
            upstream = self.view.link.open_tunnel()
        except peer_link.LinkError as exc:
            return self._json(503, {"error": str(exc), "offline": True})
        port = self.view.link.peer().get("orcPort")
        head = "%s %s HTTP/1.1\r\n" % (self.command, self.path)
        for name, value in self.headers.items():
            lower = name.lower()
            if lower == "host":
                continue
            if lower == "origin" and value.startswith(self._own_origin()):
                value = "http://127.0.0.1:%d" % port + value[len(self._own_origin()):]
            head += "%s: %s\r\n" % (name, value)
        head += "Host: 127.0.0.1:%d\r\n\r\n" % port
        upstream.sendall(head.encode("latin-1") + body)
        self.wfile.flush()
        self.close_connection = True
        peer_link.pipe(self.connection, upstream)

    def _preview(self, run_id):
        """Open a run's worktree app through its own tunnelled port."""
        query = parse_qs(urlsplit(self.path).query)
        try:
            status, target = self.view.link.orc_request(
                "GET", "/api/link/worktree-target/%s" % run_id)
        except peer_link.LinkError as exc:
            return self._json(503, {"error": str(exc), "offline": True})
        if status != 200 or not isinstance(target.get("port"), int):
            return self._json(status if status >= 400 else 409, {"error": target.get("error") or "This run has no worktree app."})
        local = self.view.forwards.local_port(target["port"])
        path = (query.get("path") or [target.get("path") or "/"])[0]
        if not path.startswith("/"):
            path = "/" + path
        self.send_response(303)
        self.send_header("Location", "http://127.0.0.1:%d%s" % (local, path))
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _offline(self, path, body):
        """The other laptop is asleep: last-known pages, read-only, plus the queue."""
        name = (self.view.link.peer() or {}).get("name") or "The other laptop"
        if self.command == "POST":
            try:
                data = json.loads(body or b"{}")
            except ValueError:
                data = None
            item = self.view.queue.add(self.command, path, data)
            if item:
                return self._json(202, {"queued": True, "item": {"id": item["id"], "label": item["label"]},
                                        "ok": True})
            return self._json(503, {"error": "%s is asleep, so this can't be done right now." % name,
                                    "offline": True})
        if self.command in ("GET", "HEAD"):
            if path == "/":
                return self._relay_local(body, transform=_mark_asleep_view if self.command == "GET" else None)
            if self._loads_code(path):
                if self._page_code() == "there" and not self.view.same_version():
                    # A page from the other laptop's Orc, open when it fell
                    # asleep: this laptop's files would not fit it.
                    return self._json(503, {"error": "%s is asleep." % name, "offline": True})
                return self._relay_local(body)
            cached = self.view.cache.get(self._cache_key())
            if cached:
                content_type, data, saved_at, saved = cached
                unchanged = (saved.get("ETag") is not None
                             and self.headers.get("If-None-Match") == saved["ETag"])
                self.send_response(304 if unchanged else 200)
                self.send_header("Content-Type", content_type)
                for name, value in saved.items():
                    self.send_header(name, value)
                self.send_header("Content-Length", "0" if unchanged else str(len(data)))
                self.send_header("X-Orc-Link-Offline", "1")
                self.send_header("X-Orc-Link-Saved-At", str(int(saved_at)))
                self.end_headers()
                if self.command != "HEAD" and not unchanged:
                    self.wfile.write(data)
                return
        return self._json(503, {"error": "%s is asleep. Showing what it last sent." % name, "offline": True})
