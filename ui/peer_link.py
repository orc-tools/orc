"""Linked laptops: home Orcs reach each other over Wi-Fi.

Each laptop owns a self-signed TLS identity made once with `openssl`. Linking
gives each laptop the other's certificate; afterwards every connection is
mutual TLS pinned to exactly that certificate. A laptop holds one link per
other laptop.

Two ways swap the certificates. With a pairing code, the code the other
laptop shows is mixed into an HMAC over both fingerprints and both names, so
a machine sitting between the laptops cannot complete it without the code.
Between laptops signed in to the same GitHub account, the user's Worker lists
each laptop's certificate, so they link with no code as soon as they see
each other on the Wi-Fi.

The link listener speaks a few JSON endpoints plus CONNECT, which tunnels a
paired laptop to this laptop's loopback Orc (or a run's worktree app). Bonjour
advertising and browsing go through macOS's `dns-sd`.

stdlib-only, like the rest of ui/.
"""

import hashlib
import hmac
import ipaddress
import http.client
import json
import os
import re
import secrets
import select
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LINK_PORT = 4177
SERVICE = "_orc-link._tcp"
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6
CODE_TTL = 10 * 60
MAX_FAILED_ATTEMPTS = 5
MAX_BODY = 64 * 1024
NAME_LIMIT = 40
TUNNEL_IDLE = 3600
# How a status names a linked laptop: the start of its certificate
# fingerprint, which is also what its Bonjour advert carries.
ID_LENGTH = 16
SNI_SUFFIX = ".orc-link"
VIA_CODE, VIA_ACCOUNT = "code", "github"


# Named in a laptop's hello when its Orc honours peer_view.PHONE_HEADER, so a
# phone's request never reaches an Orc that would treat it as its own window.
PHONE_CAPABILITY = "phoneVia"


class LinkError(Exception):
    def __init__(self, status, message, **data):
        super().__init__(message)
        self.status = status
        self.data = data


def clean_name(value):
    name = " ".join(str(value or "").split())[:NAME_LIMIT]
    if not name:
        raise LinkError(400, "Name both laptops.")
    return name


def fingerprint(pem):
    return hashlib.sha256(ssl.PEM_cert_to_DER_cert(pem)).hexdigest()


def peer_id(found):
    return found[:ID_LENGTH]


def pairing_mac(code, requester_fp, host_fp, requester_name, host_name):
    message = "orc-link-v1|%s|%s|%s|%s" % (requester_fp, host_fp, requester_name, host_name)
    return hmac.new(code.upper().encode(), message.encode(), hashlib.sha256).hexdigest()


def parse_browse(output):
    """Services from `dns-sd -Z` zone output: {instance: {name, host, port, fp}}."""
    found = {}
    for line in output.splitlines():
        match = re.match(r"^(\S+)\.%s\s+(SRV|TXT)\s+(.*)$" % re.escape(SERVICE), line.strip())
        if not match:
            continue
        instance = match[1].replace("\\032", " ")
        entry = found.setdefault(instance, {"name": instance, "host": None, "port": None, "fp": None})
        if match[2] == "SRV":
            parts = match[3].split()
            if len(parts) >= 4 and parts[2].isdigit():
                entry["port"], entry["host"] = int(parts[2]), parts[3].rstrip(".")
        else:
            for key, value in re.findall(r'"([a-z]+)=([^"]*)"', match[3]):
                if key == "fp":
                    entry["fp"] = value
    return [entry for entry in found.values() if entry["host"] and entry["port"]]


def parse_avahi(output):
    found = {}
    for line in output.splitlines():
        fields = line.split(";", 9)
        if len(fields) != 10 or fields[0] != "=" or fields[2] != "IPv4" or fields[4] != SERVICE:
            continue
        _, _, _, instance, _, _, _, address, port, txt = fields
        match = re.search(r'"fp=([0-9a-f]{16})"', txt)
        try:
            host = str(ipaddress.IPv4Address(address))
            port = int(port)
        except ValueError:
            continue
        if match and 0 < port < 65536:
            escaped = re.sub(rb"\\([0-9]{3})", lambda m: bytes([int(m[1])]) if int(m[1]) < 256 else m[0],
                             instance.encode())
            name = escaped.decode("utf-8", errors="replace")
            found.setdefault(match[1], {"name": name, "host": host, "port": port, "fp": match[1]})
    return list(found.values())


def _write_private(path, text):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".link-")
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(text)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _send_all(sock, data):
    view = memoryview(data)
    while view:
        try:
            sent = sock.send(view)
        except (ssl.SSLWantWriteError, ssl.SSLWantReadError, BlockingIOError):
            select.select([], [sock], [], 5)
            continue
        view = view[sent:]


def pipe(a, b, idle=TUNNEL_IDLE):
    """Copy bytes both ways until either side closes. One thread drives both
    directions so an SSL object never reads and writes from two threads."""
    sockets = (a, b)
    for sock in sockets:
        sock.setblocking(False)
    try:
        while True:
            ready = [s for s in sockets if isinstance(s, ssl.SSLSocket) and s.pending()]
            if not ready:
                ready, _, _ = select.select(sockets, [], [], idle)
                if not ready:
                    return
            for sock in ready:
                try:
                    data = sock.recv(65536)
                except (ssl.SSLWantReadError, ssl.SSLWantWriteError, BlockingIOError):
                    continue
                if not data:
                    return
                _send_all(b if sock is a else a, data)
    except OSError:
        return
    finally:
        for sock in sockets:
            try:
                sock.close()
            except OSError:
                pass


def _is_peer_record(value):
    return (isinstance(value, dict) and bool(value.get("cert"))
            and isinstance(value.get("fingerprint"), str))


def _fold_legacy(data):
    """state.json written while a laptop held one link kept it as `peer`,
    with `lastSeen` beside it."""
    peers = [peer for peer in data.get("peers") or [] if _is_peer_record(peer)]
    legacy, seen = data.pop("peer", None), data.pop("lastSeen", None)
    if _is_peer_record(legacy) and not any(peer["fingerprint"] == legacy["fingerprint"] for peer in peers):
        peers.append({"lastSeen": seen, **legacy} if seen is not None else dict(legacy))
    data["peers"] = peers
    return data


def _unique_name(wanted, taken):
    taken = {name.lower() for name in taken if name}
    name, count = wanted, 1
    while name.lower() in taken:
        count += 1
        suffix = " %d" % count
        name = wanted[:NAME_LIMIT - len(suffix)] + suffix
    return name


def _address(sock, fallback=None):
    """Where a socket is connected. A laptop that refuses this one hangs up
    right after the handshake, and a reset socket has no peer name to give."""
    try:
        return sock.getpeername()[0]
    except OSError:
        return fallback


class PeerHandle:
    """One linked laptop, with the calls a view of it makes."""

    def __init__(self, link, fingerprint):
        self.link = link
        self.fingerprint = fingerprint

    @property
    def id(self):
        return peer_id(self.fingerprint)

    def peer(self):
        return self.link.peer(self.fingerprint)

    @property
    def online(self):
        return self.link.is_online(self.fingerprint)

    @online.setter
    def online(self, value):
        self.link.set_live(self.fingerprint, online=bool(value))

    @property
    def peer_hello(self):
        return self.link.hello_of(self.fingerprint)

    @peer_hello.setter
    def peer_hello(self, value):
        self.link.set_live(self.fingerprint, hello=value)

    def open_tunnel(self, port=None, timeout=5):
        return self.link.open_tunnel(port, timeout, fingerprint=self.fingerprint)

    def orc_request(self, method, path, body=None, timeout=15):
        return self.link.orc_request(method, path, body, timeout, fingerprint=self.fingerprint)

    def heartbeat(self):
        return self.link.heartbeat(self.fingerprint)


class Link:
    """This laptop's half of every link: identity, pairing, listener, tunnels.

    A call that names no fingerprint means the first linked laptop."""

    def __init__(self, directory, orc_port, version=lambda: None, tunnel_ports=lambda: (),
                 on_forget=lambda reason, peer: 0, openssl=None, link_port=LINK_PORT, dns_sd="dns-sd",
                 checkout=lambda: None, remote_url=lambda: None, on_nudge=lambda: None):
        self.dir = directory
        self.orc_port = orc_port
        self.link_port = link_port
        self.version = version
        self.checkout = checkout
        self.remote_url = remote_url
        self.tunnel_ports = tunnel_ports
        self.on_forget = on_forget
        self.on_nudge = on_nudge
        self.openssl = openssl
        self.dns_sd = dns_sd
        self._lock = threading.RLock()
        self._incoming = None
        self._live = {}
        self.server = None
        self.error = None
        self._advert = None

    # ---------- state ----------

    def _path(self, name):
        return os.path.join(self.dir, name)

    def state(self):
        try:
            with open(self._path("state.json")) as stream:
                data = json.load(stream)
        except (OSError, ValueError):
            data = {}
        return _fold_legacy(data if isinstance(data, dict) else {})

    def _save(self, data):
        os.makedirs(self.dir, mode=0o700, exist_ok=True)
        _write_private(self._path("state.json"), json.dumps(data, indent=2) + "\n")

    def _update(self, **fields):
        with self._lock:
            data = self.state()
            data.update(fields)
            self._save(data)
            return data

    def peers(self):
        return self.state()["peers"]

    def peer(self, fingerprint=None):
        peers = self.peers()
        if fingerprint is None:
            return peers[0] if peers else None
        return next((peer for peer in peers if peer["fingerprint"] == fingerprint), None)

    def find(self, wanted):
        """The linked laptop a status `id` names."""
        if not isinstance(wanted, str) or len(wanted) < ID_LENGTH:
            return None
        return next((peer for peer in self.peers() if peer["fingerprint"].startswith(wanted)), None)

    def of(self, fingerprint):
        return PeerHandle(self, fingerprint)

    def handles(self):
        return [self.of(peer["fingerprint"]) for peer in self.peers()]

    def update_peer(self, fingerprint, **fields):
        with self._lock:
            data = self.state()
            for peer in data["peers"]:
                if peer["fingerprint"] == fingerprint:
                    peer.update(fields)
                    self._save(data)
                    return peer
        return None

    def is_online(self, fingerprint):
        return bool(self._live.get(fingerprint, {}).get("online"))

    def hello_of(self, fingerprint):
        return self._live.get(fingerprint, {}).get("hello")

    def set_live(self, fingerprint, **fields):
        if fingerprint:
            self._live.setdefault(fingerprint, {"online": False, "hello": None}).update(fields)

    def _first(self):
        return (self.peer() or {}).get("fingerprint")

    @property
    def online(self):
        return self.is_online(self._first())

    @online.setter
    def online(self, value):
        self.set_live(self._first(), online=bool(value))

    @property
    def peer_hello(self):
        return self.hello_of(self._first())

    @peer_hello.setter
    def peer_hello(self, value):
        self.set_live(self._first(), hello=value)

    def enabled(self):
        return self.state().get("enabled") is True

    def self_name(self):
        return self.state().get("selfName") or socket.gethostname().split(".")[0]

    # ---------- identity ----------

    def identity(self):
        """(cert path, key path, cert PEM), made on first use."""
        cert, key = self._path("identity.crt"), self._path("identity.key")
        with self._lock:
            if not (os.path.exists(cert) and os.path.exists(key)):
                os.makedirs(self.dir, mode=0o700, exist_ok=True)
                tool = self.openssl or shutil.which("openssl") or "/usr/bin/openssl"
                subprocess.run(
                    [tool, "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
                     "-nodes", "-keyout", key, "-out", cert, "-days", "3650", "-subj", "/CN=orc-link",
                     "-addext", "basicConstraints=critical,CA:TRUE",
                     "-addext", "keyUsage=critical,digitalSignature,keyCertSign"],
                    check=True, capture_output=True, timeout=30)
                os.chmod(key, 0o600)
            with open(cert) as stream:
                return cert, key, stream.read()

    def own_fingerprint(self):
        return fingerprint(self.identity()[2])

    # ---------- TLS ----------

    def _server_context(self):
        cert, key, _ = self.identity()
        data = self.state()
        pems = {entry["fingerprint"]: entry["cert"] for entry in [*self.trusted(data), *data["peers"]]}

        def trusting(certs):
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.load_cert_chain(cert, key)
            context.verify_mode = ssl.CERT_OPTIONAL
            # Every identity is CN=orc-link, and OpenSSL picks a trust anchor
            # by name alone. An Orc from before SNI_SUFFIX names no anchor, so
            # this has the verifier fall back to an exact certificate match.
            context.verify_flags |= getattr(ssl, "VERIFY_X509_PARTIAL_CHAIN", 0)
            for pem in certs:
                try:
                    context.load_verify_locations(cadata=pem)
                except (ssl.SSLError, ValueError):
                    pass
            return context

        def trust_the_named_caller(sock, name, _context):
            caller = (name or "")[:-len(SNI_SUFFIX)] if (name or "").endswith(SNI_SUFFIX) else ""
            named = [pem for found, pem in pems.items() if len(caller) == ID_LENGTH and found.startswith(caller)]
            if named:
                sock.context = trusting(named)

        context = trusting(pems.values())
        context.sni_callback = trust_the_named_caller
        return context

    def _client_context(self, pinned, show_own=True):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.check_hostname = False
        if pinned:
            context.verify_mode = ssl.CERT_REQUIRED
            context.load_verify_locations(cadata=pinned["cert"])
            if show_own:
                cert, key, _ = self.identity()
                context.load_cert_chain(cert, key)
        else:
            context.verify_mode = ssl.CERT_NONE
        return context

    def _sni_name(self, pinned):
        """Says which certificate this laptop is about to show, so the other
        laptop checks it against that one certificate."""
        return peer_id(self.own_fingerprint()) + SNI_SUFFIX if pinned else None

    def _dial(self, hosts, port, pinned, timeout, show_own=True):
        """A TLS socket to the first host that answers. With `pinned`, the
        other laptop must show that certificate, and sees this laptop's
        unless `show_own` is off. A LinkError's `reached` says a laptop
        answered at all, as opposed to none being there."""
        last, reached = None, False
        for host in hosts:
            if not host:
                continue
            try:
                raw = socket.create_connection((host, port), timeout=timeout)
            except OSError as exc:
                last = exc
                continue
            reached = True
            try:
                tls = self._client_context(pinned, show_own).wrap_socket(
                    raw, server_hostname=self._sni_name(pinned and show_own))
            except (OSError, ssl.SSLError) as exc:
                raw.close()
                last = exc
                continue
            seen = hashlib.sha256(tls.getpeercert(binary_form=True)).hexdigest()
            if pinned and seen != pinned["fingerprint"]:
                tls.close()
                raise LinkError(502, "The other laptop's identity changed. Unlink and pair again.")
            if pinned:
                self.remember_peer_address(seen, _address(tls))
            return tls, seen
        raise LinkError(503, "Can't reach the other laptop%s." % (": %s" % last if last else ""), reached=reached)

    def _peer_hosts(self, peer):
        return [peer.get("host"), peer.get("mdnsHost")]

    def remember_peer_address(self, caller_fp, address):
        """Keep the address a linked laptop was last reached at. The laptop
        that showed the pairing code has no .local name for the other one, so
        without this a DHCP move after pairing makes it look asleep forever."""
        if not (caller_fp and address):
            return
        with self._lock:
            data = self.state()
            for peer in data["peers"]:
                if hmac.compare_digest(caller_fp, peer["fingerprint"]):
                    if peer.get("host") != address:
                        peer["host"] = address
                        self._save(data)
                    return

    def _call(self, sock, method, path, body=None, timeout=5):
        conn = http.client.HTTPConnection("orc-link", timeout=timeout)
        conn.sock = sock
        payload = None if body is None else json.dumps(body).encode()
        headers = {"Content-Type": "application/json"} if payload is not None else {}
        try:
            conn.request(method, path, payload, headers)
            response = conn.getresponse()
            raw = response.read(MAX_BODY + 1)
        except (OSError, http.client.HTTPException) as exc:
            raise LinkError(503, "The other laptop stopped answering: %s" % exc, reached=True)
        finally:
            conn.close()
        try:
            data = json.loads(raw or b"{}")
        except ValueError:
            data = {}
        if response.status >= 400:
            raise LinkError(response.status, data.get("error") or "The other laptop refused (%d)." % response.status,
                            declined=data.get("declined") is True, reached=True)
        return data

    def _taken_names(self, data, apart_from=None):
        return [data.get("selfName") or self.self_name()] + [
            peer["name"] for peer in data["peers"] if peer["fingerprint"] != apart_from]

    # ---------- pairing (the laptop typing the code) ----------

    def request_code(self, host, port, my_name):
        sock, _ = self._dial([host], port, None, 5)
        return self._call(sock, "POST", "/pair/request", {"name": clean_name(my_name)})

    def confirm(self, host, port, code, my_name, peer_name):
        my_name, peer_name = clean_name(my_name), clean_name(peer_name)
        if my_name.lower() == peer_name.lower():
            raise LinkError(400, "Give the two laptops different names.")
        code = "".join(str(code or "").split()).upper()
        _, _, my_cert = self.identity()
        sock, host_fp = self._dial([host], port, None, 5)
        if any(peer["name"].lower() == peer_name.lower() and peer["fingerprint"] != host_fp for peer in self.peers()):
            sock.close()
            raise LinkError(409, "Another linked laptop is already called %s." % peer_name)
        address = _address(sock, host)
        reply = self._call(sock, "POST", "/pair/confirm", {
            "cert": my_cert, "name": my_name, "peerName": peer_name, "orcPort": self.orc_port,
            "linkPort": self.link_port,
            "mac": pairing_mac(code, fingerprint(my_cert), host_fp, my_name, peer_name)})
        cert = reply.get("cert")
        if not isinstance(cert, str) or fingerprint(cert) != host_fp:
            raise LinkError(502, "The other laptop answered with a different identity.")
        peer = {"name": peer_name, "host": address, "mdnsHost": host if host != address else None,
                "port": port, "cert": cert, "fingerprint": host_fp,
                "orcPort": int(reply.get("orcPort") or self.orc_port), "pairedAt": time.time(), "via": VIA_CODE}
        self._keep(peer, selfName=my_name)
        return peer

    def _keep(self, peer, **fields):
        """Save a newly linked laptop over any earlier link with it."""
        with self._lock:
            data = self.state()
            data["peers"] = [other for other in data["peers"] if other["fingerprint"] != peer["fingerprint"]] + [peer]
            data["declined"] = [fp for fp in data.get("declined") or [] if fp != peer["fingerprint"]]
            data.update(fields, enabled=True)
            self._save(data)
        self.set_live(peer["fingerprint"], online=True)
        self.restart_advert()

    # ---------- pairing (the laptop showing the code) ----------

    def start_pairing(self, requester, address, now=None):
        now = time.time() if now is None else now
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        with self._lock:
            self._incoming = {"from": clean_name(requester), "address": address, "code": code,
                              "expiresAt": now + CODE_TTL, "failures": 0}
        return {"ok": True}

    def incoming(self, now=None):
        now = time.time() if now is None else now
        with self._lock:
            pending = self._incoming
            if pending and pending["expiresAt"] > now:
                return {"from": pending["from"], "code": pending["code"], "expiresAt": pending["expiresAt"]}
            self._incoming = None
        return None

    def cancel_incoming(self):
        with self._lock:
            self._incoming = None

    def accept_pairing(self, data, address, now=None):
        now = time.time() if now is None else now
        with self._lock:
            pending = self._incoming
            if not pending or pending["expiresAt"] <= now:
                raise LinkError(410, "No pairing code is waiting. Ask for a new one.")
            try:
                cert = data["cert"]
                requester_fp = fingerprint(cert)
                name, own_name = clean_name(data["name"]), clean_name(data["peerName"])
                orc_port, link_port = int(data["orcPort"]), int(data["linkPort"])
            except (KeyError, TypeError, ValueError):
                raise LinkError(400, "The pairing request was malformed.")
            expected = pairing_mac(pending["code"], requester_fp, self.own_fingerprint(), name, own_name)
            if not hmac.compare_digest(expected, str(data.get("mac") or "")):
                pending["failures"] += 1
                if pending["failures"] >= MAX_FAILED_ATTEMPTS:
                    self._incoming = None
                raise LinkError(403, "That code didn't match.")
            self._incoming = None
            state = self.state()
            # The first laptop to pair names this one; later ones keep that name.
            own_name = own_name if not state["peers"] else state.get("selfName") or own_name
            peer = {"name": _unique_name(name, self._taken_names(state, requester_fp)), "host": address,
                    "mdnsHost": None, "port": link_port, "cert": cert, "fingerprint": requester_fp,
                    "orcPort": orc_port, "pairedAt": now, "via": VIA_CODE}
            self._keep(peer, selfName=own_name)
        return {"cert": self.identity()[2], "name": own_name, "orcPort": self.orc_port}

    # ---------- laptops on the same GitHub account ----------

    def trusted(self, data=None):
        """The laptops the Worker last listed for this GitHub login."""
        account = (self.state() if data is None else data).get("account")
        machines = account.get("machines") if isinstance(account, dict) else None
        return [machine for machine in machines or [] if _is_peer_record(machine)]

    def set_trusted(self, machines):
        """Take the Worker's list of this GitHub login's laptops, or None once
        this laptop is signed out. A laptop linked through the account that
        the list no longer names is forgotten."""
        own = self.own_fingerprint()
        kept = []
        for machine in machines or []:
            try:
                found = fingerprint(machine["cert"])
            except (KeyError, TypeError, ValueError):
                continue
            if found != own and all(found != other["fingerprint"] for other in kept):
                kept.append({"machineId": machine.get("machineId"), "cert": machine["cert"], "fingerprint": found,
                             "name": " ".join(str(machine.get("name") or "").split())[:NAME_LIMIT]})
        names = {machine["fingerprint"] for machine in kept}
        with self._lock:
            data = self.state()
            gone = [peer for peer in data["peers"]
                    if peer.get("via") == VIA_ACCOUNT and peer["fingerprint"] not in names]
            before = (self.trusted(data), data.get("declined") or [])
            declined = [found for found in before[1] if found in names]
            if (kept, declined) != before:
                data["account"], data["declined"] = {"machines": kept}, declined
                self._save(data)
        for peer in gone:
            self.forget("it is no longer signed in to your GitHub account", peer["fingerprint"])
        return kept

    def _trusted_machine(self, found, data=None):
        if not isinstance(found, str) or len(found) < ID_LENGTH:
            return None
        return next((machine for machine in self.trusted(data) if machine["fingerprint"].startswith(found)), None)

    def candidates(self, found):
        """Orcs seen on this Wi-Fi that the GitHub account vouches for, are
        not linked yet, and were not unlinked by hand."""
        data = self.state()
        skip = {peer["fingerprint"] for peer in data["peers"]} | set(data.get("declined") or [])
        wanted = {peer_id(machine["fingerprint"]): machine["fingerprint"]
                  for machine in self.trusted(data) if machine["fingerprint"] not in skip}
        return [{**entry, "fingerprint": wanted[entry["fp"]]} for entry in found if entry.get("fp") in wanted]

    def wants_account_peers(self):
        data = self.state()
        skip = {peer["fingerprint"] for peer in data["peers"]} | set(data.get("declined") or [])
        return any(machine["fingerprint"] not in skip for machine in self.trusted(data))

    def link_account(self, host, port, found, asked=False):
        """Link with a laptop the GitHub account vouches for. `asked` says the
        user chose it, which also lifts an earlier unlink on both laptops."""
        machine = self._trusted_machine(found)
        if not machine:
            raise LinkError(403, "That laptop isn't signed in to your GitHub account.")
        theirs = machine["fingerprint"]
        if self.peer(theirs):
            raise LinkError(409, "That laptop is already linked.")
        if theirs in (self.state().get("declined") or []) and not asked:
            raise LinkError(409, "That laptop was unlinked here.")
        try:
            sock, _ = self._dial([host], port, machine, 5)
            address = _address(sock, host)
            reply = self._call(sock, "POST", "/pair/account", {
                "name": self.self_name(), "linkPort": self.link_port, "orcPort": self.orc_port,
                "asked": bool(asked)})
        except LinkError as exc:
            if exc.data.get("declined"):
                self._decline(theirs)
            elif exc.data.get("reached"):
                self._nudge(host, port)
            raise
        return self._adopt(machine, reply.get("name") or machine["name"], address,
                           host if host != address else None, port, reply.get("orcPort"), asked)

    def _nudge(self, host, port):
        """Ask a laptop that doesn't know this one yet to look at the GitHub
        account again, so it need not wait for its own next look."""
        try:
            sock, _ = self._dial([host], port, None, 3)
            self._call(sock, "POST", "/account/nudge", {}, timeout=3)
        except (LinkError, ssl.SSLError, OSError):
            pass

    def _decline(self, found):
        with self._lock:
            data = self.state()
            if found not in (data.get("declined") or []):
                data["declined"] = [*(data.get("declined") or []), found]
                self._save(data)

    def _adopt(self, machine, name, host, mdns_host, port, orc_port, asked):
        theirs = machine["fingerprint"]
        with self._lock:
            data = self.state()
            known = next((peer for peer in data["peers"] if peer["fingerprint"] == theirs), None)
            try:
                wanted = clean_name(name or machine.get("name") or "Laptop")
            except LinkError:
                wanted = "Laptop"
            peer = {"name": _unique_name(wanted, self._taken_names(data, theirs)), "host": host,
                    "mdnsHost": mdns_host, "port": int(port), "cert": machine["cert"], "fingerprint": theirs,
                    "orcPort": int(orc_port or self.orc_port), "pairedAt": time.time(),
                    "via": VIA_ACCOUNT, "machineId": machine.get("machineId")}
            if known:
                peer.update({key: known[key] for key in ("name", "pairedAt", "via", "viewPort", "lastSeen")
                             if key in known})
            data["peers"] = [other for other in data["peers"] if other["fingerprint"] != theirs] + [peer]
            if asked:
                data["declined"] = [found for found in data.get("declined") or [] if found != theirs]
            self._save(data)
        self.set_live(theirs, online=True)
        return peer

    def accept_account(self, data, caller_fp, address):
        state = self.state()
        machine = self._trusted_machine(caller_fp, state) if caller_fp and len(caller_fp) == 64 else None
        if not machine:
            raise LinkError(403, "This laptop isn't signed in to the same GitHub account.")
        try:
            name = clean_name(data["name"])
            link_port, orc_port = int(data["linkPort"]), int(data["orcPort"])
        except (KeyError, TypeError, ValueError):
            raise LinkError(400, "The link request was malformed.")
        asked = data.get("asked") is True
        if caller_fp in (state.get("declined") or []) and not asked:
            raise LinkError(403, "%s unlinked this laptop." % self.self_name(), declined=True)
        self._adopt(machine, name, address, None, link_port, orc_port, asked)
        return {"name": self.self_name(), "orcPort": self.orc_port}

    # ---------- talking to a linked laptop ----------

    def hello(self, caller_fp=None):
        state = self.state()
        linked = bool(caller_fp and any(hmac.compare_digest(caller_fp, peer["fingerprint"])
                                        for peer in state["peers"]))
        return {"name": self.self_name(), "fingerprint": self.own_fingerprint(),
                "orcPort": self.orc_port, "version": self.version(), "checkout": self.checkout(),
                "linked": linked, "declined": bool(caller_fp) and caller_fp in (state.get("declined") or []),
                # A linked laptop on an older Orc opens this one's own phone
                # address from its phone badge.
                "remoteUrl": self.remote_url() if linked else None,
                PHONE_CAPABILITY: True}

    def open_tunnel(self, port=None, timeout=5, fingerprint=None):
        """A pinned TLS socket already CONNECTed to `port` on a linked laptop's loopback."""
        peer = self.peer(fingerprint)
        if not peer:
            raise LinkError(409, "No laptop is linked.")
        port = peer.get("orcPort", self.orc_port) if port is None else port
        try:
            sock, _ = self._dial(self._peer_hosts(peer), peer["port"], peer, timeout)
        except LinkError as exc:
            # Until the next heartbeat, the switched window answers from its
            # cache instead of waiting out a dial per request.
            if exc.status == 503:
                self.set_live(peer["fingerprint"], online=False)
            raise
        try:
            sock.sendall(("CONNECT 127.0.0.1:%d HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n\r\n" % (port, port)).encode())
            head = b""
            while not head.endswith(b"\r\n\r\n"):
                chunk = sock.recv(1)
                if not chunk or len(head) > 4096:
                    raise LinkError(502, "The other laptop closed the tunnel.")
                head += chunk
        except OSError as exc:
            sock.close()
            raise LinkError(503, "The other laptop stopped answering: %s" % exc)
        status = head.split(b" ", 2)[1:2]
        if status != [b"200"]:
            sock.close()
            raise LinkError(502, "The other laptop refused the tunnel (%s)." % head.split(b"\r\n", 1)[0].decode("latin-1"))
        sock.settimeout(None)
        return sock

    def orc_request(self, method, path, body=None, timeout=15, fingerprint=None):
        """(status, parsed JSON) for a request to a linked laptop's own Orc."""
        peer = self.peer(fingerprint)
        sock = self.open_tunnel(timeout=min(timeout, 5), fingerprint=fingerprint)
        sock.settimeout(timeout)
        port = peer.get("orcPort", self.orc_port)
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
        conn.sock = sock
        payload = None if body is None else json.dumps(body).encode()
        headers = {"Host": "127.0.0.1:%d" % port, "Origin": "http://127.0.0.1:%d" % port}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        try:
            conn.request(method, path, payload, headers)
            response = conn.getresponse()
            raw = response.read()
        except (OSError, http.client.HTTPException) as exc:
            raise LinkError(503, "The other laptop stopped answering: %s" % exc)
        finally:
            conn.close()
        try:
            return response.status, json.loads(raw or b"{}")
        except ValueError:
            return response.status, {}

    def _ask_hello(self, peer):
        sock, _ = self._dial(self._peer_hosts(peer), peer["port"], peer, 3)
        return self._call(sock, "GET", "/hello", timeout=3)

    def _ask_standing(self, peer):
        """Whether a laptop that refused this laptop's certificate still holds
        a link with it. Asked without showing a certificate; the answer is
        the other laptop's own because its certificate is still checked."""
        try:
            sock, _ = self._dial(self._peer_hosts(peer), peer["port"], peer, 3, show_own=False)
            return self._call(sock, "GET", "/standing/" + self.own_fingerprint(), timeout=3)
        except (LinkError, ssl.SSLError, OSError):
            return None

    def standing(self, caller_fp):
        state = self.state()
        return {"linked": any(caller_fp == peer["fingerprint"] for peer in state["peers"]),
                "declined": caller_fp in (state.get("declined") or [])}

    def heartbeat(self, fingerprint=None):
        """Ping a linked laptop. Returns its hello, or None while it's away.
        A laptop that no longer knows this one has unlinked, so it is
        forgotten here too."""
        peer = self.peer(fingerprint)
        if not peer:
            return None
        theirs, by_account = peer["fingerprint"], peer.get("via") == VIA_ACCOUNT
        try:
            hello = self._ask_hello(peer)
        except LinkError as exc:
            hello = self._ask_standing(peer) if exc.data.get("reached") else None
        except (ssl.SSLError, OSError):
            hello = None
        if hello and by_account and not hello.get("linked") and not hello.get("declined"):
            # It lost its half of an account link, which it takes back on request.
            try:
                sock, _ = self._dial(self._peer_hosts(peer), peer["port"], peer, 3)
                self._call(sock, "POST", "/pair/account", {
                    "name": self.self_name(), "linkPort": self.link_port, "orcPort": self.orc_port,
                    "asked": False}, timeout=3)
                hello = self._ask_hello(peer)
            except LinkError as exc:
                hello = {"linked": False, "declined": True} if exc.data.get("declined") else None
                if hello is None and exc.data.get("reached"):
                    self._nudge(peer.get("host") or peer.get("mdnsHost"), peer["port"])
            except (ssl.SSLError, OSError):
                hello = None
        if hello is None or "name" not in hello and hello.get("linked"):
            self.set_live(theirs, online=False)
            return None
        if not hello.get("linked"):
            self.forget("the other laptop unlinked", theirs, decline=by_account)
            return None
        self.set_live(theirs, online=True, hello=hello)
        self.update_peer(theirs, lastSeen=time.time())
        return hello

    def unlink(self, fingerprint=None):
        peer = self.peer(fingerprint)
        if not peer:
            raise LinkError(409, "No laptop is linked.")
        try:
            sock, _ = self._dial(self._peer_hosts(peer), peer["port"], peer, 3)
            self._call(sock, "POST", "/unlink", {}, timeout=3)
        except (LinkError, ssl.SSLError, OSError):
            pass
        return self.forget("unlinked here", peer["fingerprint"], decline=peer.get("via") == VIA_ACCOUNT)

    def forget(self, reason, fingerprint=None, decline=False):
        """Drop a linked laptop. `decline` keeps the GitHub account from
        linking it again until someone asks for it."""
        with self._lock:
            data = self.state()
            peer = next((peer for peer in data["peers"]
                         if fingerprint in (None, peer["fingerprint"])), None)
            if not peer:
                return {"dropped": 0, "reason": reason}
            theirs = peer["fingerprint"]
            data["peers"] = [other for other in data["peers"] if other["fingerprint"] != theirs]
            if decline and theirs not in (data.get("declined") or []):
                data["declined"] = [*(data.get("declined") or []), theirs]
            self._save(data)
        self._live.pop(theirs, None)
        return {"dropped": self.on_forget(reason, peer) or 0, "reason": reason, "name": peer["name"]}

    def rename(self, my_name=None, peer_name=None, fingerprint=None):
        with self._lock:
            data = self.state()
            if my_name is not None:
                data["selfName"] = clean_name(my_name)
            peer = next((peer for peer in data["peers"] if fingerprint in (None, peer["fingerprint"])), None)
            if peer_name is not None and peer:
                wanted = clean_name(peer_name)
                if wanted.lower() in {name.lower() for name in self._taken_names(data, peer["fingerprint"])}:
                    raise LinkError(409, "Another laptop is already called %s." % wanted)
                peer["name"] = wanted
            self._save(data)
        self.restart_advert()

    # ---------- listener and Bonjour ----------

    def sync(self):
        """Start or stop the listener and Bonjour advert to match `enabled`."""
        with self._lock:
            want = self.enabled()
            if want and self.server is None:
                try:
                    self.identity()
                    self.server = _LinkServer(("0.0.0.0", self.link_port), self)
                except (OSError, subprocess.SubprocessError) as exc:
                    self.error = "could not listen on port %d: %s" % (self.link_port, getattr(exc, "strerror", None) or exc)
                    self.server = None
                    return
                self.error = None
                self.link_port = self.server.server_address[1]
                threading.Thread(target=self.server.serve_forever, daemon=True).start()
                self.restart_advert()
            elif not want and self.server is not None:
                server, self.server = self.server, None
                server.shutdown()
                server.server_close()
                self._stop_advert()

    def set_enabled(self, enabled):
        self._update(enabled=bool(enabled))
        self.sync()

    def restart_advert(self):
        self._stop_advert()
        if self.server is None or not self.dns_sd:
            return
        if shutil.which(self.dns_sd):
            command = [self.dns_sd, "-R", self.self_name(), SERVICE, "local"]
        elif self.dns_sd == "dns-sd" and shutil.which("avahi-publish-service"):
            command = ["avahi-publish-service", "--no-fail", "--", self.self_name(), SERVICE]
        else:
            self.error = "Install a DNS-SD service to advertise this computer on the LAN."
            return
        try:
            self._advert = subprocess.Popen(
                [*command, str(self.link_port), "fp=%s" % peer_id(self.own_fingerprint()), "v=1"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            self._advert = None

    def _stop_advert(self):
        advert, self._advert = self._advert, None
        if advert is not None:
            advert.terminate()

    def discover(self, seconds=2.0):
        if not self.dns_sd:
            return []
        if shutil.which(self.dns_sd):
            command, parse = [self.dns_sd, "-Z", SERVICE, "local"], parse_browse
        elif self.dns_sd == "dns-sd" and shutil.which("avahi-browse"):
            command, parse = ["avahi-browse", "--parsable", "--resolve", "--terminate", SERVICE], parse_avahi
        else:
            return []
        with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              text=True, errors="replace") as browse:
            try:
                output = browse.communicate(timeout=seconds)[0]
            except subprocess.TimeoutExpired:
                browse.terminate()
                output = browse.communicate()[0]
        own = peer_id(self.own_fingerprint())
        return [entry for entry in parse(output) if entry["fp"] != own]

    def public_peer(self, peer):
        return {"id": peer_id(peer["fingerprint"]), "name": peer["name"],
                "online": self.is_online(peer["fingerprint"]), "host": peer.get("host"),
                "lastSeen": peer.get("lastSeen"), "pairedAt": peer.get("pairedAt"),
                "via": peer.get("via") or VIA_CODE}

    def status(self):
        peers = [self.public_peer(peer) for peer in self.peers()]
        return {
            "enabled": self.enabled(), "running": self.server is not None, "error": self.error,
            "selfName": self.self_name(), "linkPort": self.link_port,
            "peers": peers, "peer": peers[0] if peers else None,
            "incoming": self.incoming(),
        }


class _LinkServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, link):
        self.link = link
        super().__init__(address, _LinkHandler)

    def handle_error(self, request, client_address):
        pass


class _LinkHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "OrcLink/1"

    def setup(self):
        self.request.settimeout(10)
        self.request = self.server.link._server_context().wrap_socket(self.request, server_side=True)
        super().setup()

    def finish(self):
        # socketserver closes the raw socket it accepted, which the TLS
        # wrapper already took over, so the wrapper has to close itself.
        try:
            super().finish()
        finally:
            self.request.close()

    def log_message(self, *args):
        pass

    def _caller_fp(self):
        der = self.connection.getpeercert(binary_form=True)
        return hashlib.sha256(der).hexdigest() if der else None

    def _is_peer(self):
        caller = self._caller_fp()
        return bool(caller and self.server.link.peer(caller))

    def _reply(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if not 0 <= length <= MAX_BODY:
            raise LinkError(413, "Request too large.")
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            raise LinkError(400, "Send JSON.")
        if not isinstance(data, dict):
            raise LinkError(400, "Send a JSON object.")
        return data

    def do_GET(self):
        if self.path == "/hello":
            caller = self._caller_fp()
            self.server.link.remember_peer_address(caller, self.client_address[0])
            return self._reply(200, self.server.link.hello(caller))
        standing = re.fullmatch(r"/standing/([0-9a-f]{64})", self.path)
        if standing:
            return self._reply(200, self.server.link.standing(standing[1]))
        self._reply(404, {"error": "Not found."})

    def do_POST(self):
        link = self.server.link
        try:
            if self.path == "/pair/request":
                return self._reply(200, link.start_pairing(self._body().get("name"), self.client_address[0]))
            if self.path == "/pair/confirm":
                return self._reply(200, link.accept_pairing(self._body(), self.client_address[0]))
            if self.path == "/pair/account":
                return self._reply(200, link.accept_account(self._body(), self._caller_fp(), self.client_address[0]))
            if self.path == "/account/nudge":
                self._body()
                link.on_nudge()
                return self._reply(200, {"ok": True})
            if self.path == "/unlink":
                peer = link.peer(self._caller_fp() or "")
                if not peer:
                    raise LinkError(403, "Not linked.")
                self._body()
                link.forget("the other laptop unlinked", peer["fingerprint"],
                            decline=peer.get("via") == VIA_ACCOUNT)
                return self._reply(200, {"ok": True})
            raise LinkError(404, "Not found.")
        except LinkError as exc:
            self._reply(exc.status, {"error": str(exc),
                                     **({"declined": True} if exc.data.get("declined") else {})})

    def do_CONNECT(self):
        link = self.server.link
        if not self._is_peer():
            return self._reply(403, {"error": "Not linked."})
        match = re.fullmatch(r"127\.0\.0\.1:(\d{1,5})", self.path)
        port = int(match[1]) if match else None
        if port is None or port not in {link.orc_port, *link.tunnel_ports()}:
            return self._reply(403, {"error": "That port isn't shared over the link."})
        try:
            upstream = socket.create_connection(("127.0.0.1", port), timeout=5)
        except OSError:
            return self._reply(502, {"error": "Nothing is listening on port %d." % port})
        self.wfile.write(b"HTTP/1.1 200 Connection established\r\n\r\n")
        self.wfile.flush()
        # open_tunnel waits for this 200 before it sends a byte, so rfile
        # holds nothing buffered that the pipe would miss.
        self.close_connection = True
        upstream.settimeout(None)
        self.connection.settimeout(None)
        pipe(self.connection, upstream)
