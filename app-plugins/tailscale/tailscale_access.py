"""Tailscale routes for Orc: private phone access and public shared plans.
Each channel is one Tailscale Serve or Funnel route to a loopback backend that
Orc starts. Part of the Tailscale plugin; core reaches it only through the
plugin's backend while the plugin is on."""
import atexit
import contextlib
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading


CHANNELS = {
    "phone": {"port": 8443, "backend": 4175},
    # Keep the existing public address for shared plans on port 10000. The
    # backend stays clear of Orc's own PORT..PORT+3, where a linked laptop's
    # view proxy listens: a public route left on that port would publish it.
    "share": {"port": 10000, "backend": 4190},
}
PUBLIC_CHANNEL = "share"
LEGACY_MCP_ROUTE = {"port": 443, "backend": 4174}


class AccessError(ValueError):
    pass


def executable():
    candidates = [shutil.which("tailscale"), "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
                  "/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale"]
    for path in candidates:
        if path and os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    raise AccessError("Install Tailscale on this machine, sign in, then refresh. https://tailscale.com/download")


def command(*args):
    try:
        result = subprocess.run([executable(), *args], capture_output=True, text=True,
                                stdin=subprocess.DEVNULL, timeout=12)
    except subprocess.TimeoutExpired as exc:
        output = exc.stdout or exc.stderr or b""
        if isinstance(output, bytes):
            output = output.decode("utf-8", "replace")
        raise AccessError("Tailscale needs attention. " + output[-1800:] +
                          " Open Tailscale, complete any HTTPS approval, then retry.") from exc
    except OSError as exc:
        raise AccessError("Could not run Tailscale: " + str(exc)) from exc
    if result.returncode:
        raise AccessError((result.stderr or result.stdout or "Tailscale command failed.").strip()[-2000:])
    return result.stdout


def command_json(*args):
    try:
        value = json.loads(command(*args))
    except json.JSONDecodeError as exc:
        raise AccessError("Tailscale returned invalid status. Update Tailscale and retry.") from exc
    if value is None and args == ("serve", "status", "--json"):
        return {}
    if not isinstance(value, dict):
        raise AccessError("Tailscale returned invalid status.")
    return value


def hostname():
    status = command_json("status", "--json")
    if status.get("BackendState") != "Running":
        raise AccessError("Open Tailscale and connect this machine to your tailnet, then refresh.")
    own = status.get("Self")
    host = str(own.get("DNSName") or "").rstrip(".").lower() if isinstance(own, dict) else ""
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.ts\.net", host):
        raise AccessError("Enable MagicDNS and HTTPS in Tailscale, then refresh.")
    return host


ADMIN_DNS = "https://login.tailscale.com/admin/dns"
ADMIN_POLICY = "https://login.tailscale.com/admin/acls/file"
# The tailnet policy entry that lets members' machines use Funnel.
FUNNEL_POLICY = '"nodeAttrs": [{"target": ["autogroup:member"], "attr": ["funnel"]}]'
FUNNEL_CAPS = ("funnel", "https://tailscale.com/cap/funnel")


def _caps(own):
    caps = set(own.get("Capabilities") or []) if isinstance(own.get("Capabilities"), list) else set()
    if isinstance(own.get("CapMap"), dict):
        caps |= set(own["CapMap"])
    return {cap for cap in caps if isinstance(cap, str)}


def funnel_allowed(own):
    """Whether the tailnet policy lets this machine use Funnel on port 10000."""
    caps = _caps(own)
    if not caps & set(FUNNEL_CAPS):
        return False
    ports = [cap.split("ports=", 1)[1] for cap in caps
             if cap.startswith("https://tailscale.com/cap/funnel-ports?ports=")]
    return not ports or any(str(CHANNELS["share"]["port"]) in port.split(",") for port in ports)


def setup_steps():
    """The five things Orc needs from Tailscale, in order, each done or with
    what to do next. Never raises: a missing Tailscale is the first step."""
    steps = [
        {"id": "installed", "label": "Tailscale installed"},
        {"id": "signed-in", "label": "Signed in to a tailnet"},
        {"id": "magicdns", "label": "MagicDNS turned on"},
        {"id": "https", "label": "HTTPS certificates"},
        {"id": "funnel", "label": "Funnel allowed for this Mac"},
    ]
    for step in steps:
        step["done"] = False
    todo = {
        "installed": "Install Tailscale on this Mac, then check again.",
        "signed-in": "Open Tailscale on this Mac and sign in, then check again.",
        "magicdns": "Turn on MagicDNS in the Tailscale admin console, then come back.",
        "https": "Turn on HTTPS in the Tailscale admin console, then come back.",
        "funnel": "Only needed to share plans with people outside your tailnet.",
    }
    for step in steps:
        step["detail"] = todo[step["id"]]
    links = {"installed": "https://tailscale.com/download", "magicdns": ADMIN_DNS, "https": ADMIN_DNS,
             "funnel": ADMIN_POLICY}
    for step in steps:
        step["link"] = links.get(step["id"])
    steps[4]["policy"] = FUNNEL_POLICY
    try:
        status = command_json("status", "--json")
    except AccessError as exc:
        try:
            executable()
        except AccessError:
            return steps
        steps[0]["done"] = True
        steps[0]["detail"] = "Found, but it did not answer: " + str(exc)[:300]
        return steps
    steps[0]["done"] = True
    version = str(status.get("Version") or "").split("-")[0]
    steps[0]["detail"] = ("Version %s found" % version) if version else "Found"
    own = status.get("Self") if isinstance(status.get("Self"), dict) else {}
    tailnet = status.get("CurrentTailnet") if isinstance(status.get("CurrentTailnet"), dict) else {}
    if status.get("BackendState") != "Running":
        return steps
    steps[1]["done"] = True
    machine = str(own.get("HostName") or "this Mac")
    suffix = str(tailnet.get("MagicDNSSuffix") or tailnet.get("Name") or "").rstrip(".")
    steps[1]["detail"] = machine + (" on " + suffix if suffix else "")
    host = str(own.get("DNSName") or "").rstrip(".").lower()
    if tailnet.get("MagicDNSEnabled") is False or not host.endswith(".ts.net"):
        return steps
    steps[2]["done"] = True
    steps[2]["detail"] = host
    certs = status.get("CertDomains")
    if not isinstance(certs, list) or not certs:
        return steps
    steps[3]["done"] = True
    steps[3]["detail"] = "Phones on your tailnet get a trusted address"
    if funnel_allowed(own):
        steps[4]["done"] = True
        steps[4]["detail"] = "Shared plans can reach people outside your tailnet"
    return steps


def origin(host, channel):
    return "https://%s:%d" % (host, CHANNELS[channel]["port"])


def private_phone_url(value):
    if isinstance(value, str) and re.fullmatch(
            r"https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.ts\.net:8443/", value):
        return value
    return None


def route_state(config, host, spec):
    if not isinstance(config, dict):
        raise AccessError("Unrecognised Tailscale routing configuration; no routes were changed.")
    port = str(spec["port"])
    key = host + ":" + port
    target = "http://127.0.0.1:%d" % spec["backend"]
    tcp, web, funnel = (config.get(name) or {} for name in ("TCP", "Web", "AllowFunnel"))
    foreground = config.get("Foreground") or {}
    if not all(isinstance(value, dict) for value in (tcp, web, funnel, foreground)):
        raise AccessError("Unrecognised Tailscale routing configuration; no routes were changed.")
    if any(route_state(child, host, spec) != "absent" for child in foreground.values()):
        return "conflict"
    port_web = {name: value for name, value in web.items() if name.endswith(":" + port)}
    port_funnel = {name: value for name, value in funnel.items() if name.endswith(":" + port) and value}
    if port not in tcp and not port_web and not port_funnel:
        return "absent"
    if tcp.get(port) == {"HTTPS": True} and port_web == {key: {"Handlers": {"/": {"Proxy": target}}}}:
        if not port_funnel:
            return "private"
        if port_funnel == {key: True}:
            return "public"
    return "conflict"


def remove_route(host, spec, route):
    port = "--https=%d" % spec["port"]
    if route == "public":
        command("funnel", port, "off")
        route = route_state(command_json("serve", "status", "--json"), host, spec)
    if route == "private":
        command("serve", port, "off")
        route = route_state(command_json("serve", "status", "--json"), host, spec)
    return route


class Backends:
    def __init__(self, make_server, make_share):
        self.make_server = make_server
        self.make_share = make_share
        self.phone = None
        self.share = None
        # Once closed, a late start (the restore thread racing a disable)
        # must not bind servers nobody will stop.
        self.closed = False
        self.lock = threading.Lock()
        atexit.register(self.close)

    def running(self, channel):
        return getattr(self, channel) is not None

    def start(self, channel, public_origin):
        with self.lock:
            if self.closed:
                raise AccessError("Tailscale is turning off; turn the plugin on again to retry.")
            if self.running(channel):
                return
            address = ("127.0.0.1", CHANNELS[channel]["backend"])
            if channel == "phone":
                server = self.make_server(address)
                server.orc_lan = True
                server.orc_remote_origin = public_origin
            else:
                try:
                    server = self.make_share(address)
                except OSError as exc:
                    raise AccessError("Could not start the share server on port %d: %s" % (address[1], exc)) from exc
            threading.Thread(target=server.serve_forever, daemon=True).start()
            setattr(self, channel, server)

    def stop(self, channel):
        server = getattr(self, channel)
        setattr(self, channel, None)
        if server:
            server.shutdown()
            server.server_close()

    def close(self):
        with self.lock:
            self.closed = True
        for channel in CHANNELS:
            self.stop(channel)


class Manager:
    def __init__(self, root, backends):
        self.path = Path(root) / "tailscale.json"
        self.backends = backends
        self.lock = threading.RLock()
        self.errors = {}

    def read(self):
        try:
            state = json.loads(self.path.read_text())
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as exc:
            raise AccessError("Could not read machine Tailscale settings: " + str(exc)) from exc
        if not isinstance(state, dict) or set(state) - (CHANNELS.keys() | {"mcp"}) or any(
                not isinstance(entry, dict) or not isinstance(entry.get("host"), str)
                or not re.fullmatch(r"[a-z0-9][a-z0-9.-]*\.ts\.net", entry["host"])
                or type(entry.get("enabled")) is not bool or type(entry.get("owned")) is not bool
                or type(entry.get("public", False)) is not bool
                or entry.get("public") and channel not in (PUBLIC_CHANNEL, "mcp")
                for channel, entry in state.items()):
            raise AccessError("Invalid machine Tailscale settings; no routes were changed.")
        return state

    @contextlib.contextmanager
    def editing(self):
        # The installer may retire a route while the viewer restores phone
        # access. Both must read and replace the same version of tailscale.json.
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.with_suffix(".lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                yield

    def save(self, state):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(dir=self.path.parent, prefix=".tailscale-")
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump(state, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def phone_url(self):
        # Heartbeats must not wait for the Tailscale CLI; the destination still
        # enforces private access and device pairing when the browser opens it.
        with self.lock:
            try:
                phone = self.read().get("phone", {})
            except AccessError:
                return None
            if not phone.get("enabled") or not self.backends.running("phone"):
                return None
            return private_phone_url(origin(phone.get("host", ""), "phone") + "/")

    def status(self):
        with self.lock:
            state = self.read()
            result = {"eligible": True, "connected": False, "host": None}
            config = None
            try:
                result["host"] = hostname()
                config = command_json("serve", "status", "--json")
                result["connected"] = True
            except AccessError as exc:
                result["error"] = str(exc)
            for channel in CHANNELS:
                entry = state.get(channel, {})
                host = entry.get("host", result["host"])
                public = entry.get("public", channel == PUBLIC_CHANNEL)
                matching = (config is not None and host
                            and route_state(config, host, CHANNELS[channel]) == ("public" if public else "private"))
                running = bool(entry.get("enabled") and matching and self.backends.running(channel)
                               and host == result["host"])
                result[channel] = {"enabled": entry.get("enabled", False), "owned": entry.get("owned", False),
                                   "public": public, "running": running, "url": origin(host, channel) + "/" if host else None,
                                   "error": self.errors.get(channel), "available": True}
                if entry.get("enabled") and not running and not result[channel]["error"]:
                    result[channel]["error"] = "Access is not running. Check Tailscale and retry on this machine."
            return result

    def change(self, channel, enabled, public=None):
        if channel not in CHANNELS or type(enabled) is not bool or public not in (None, True, False):
            raise AccessError("Choose phone or share, and enable or disable.")
        if public and channel != PUBLIC_CHANNEL:
            raise AccessError("Only shared plans can be public.")
        if channel == PUBLIC_CHANNEL:
            public = True
        with self.editing():
            state = self.read()
            entry = state.get(channel, {})
            spec = CHANNELS[channel]
            saved = "public" if entry.get("public", channel == PUBLIC_CHANNEL) else "private"
            wanted = saved if public is None else "public" if public else "private"
            self.errors.pop(channel, None)
            try:
                if not enabled:
                    self.backends.stop(channel)
                    if not entry:
                        return
                    entry["enabled"] = False
                    self.save(state)
                    host = entry["host"]
                else:
                    host = hostname()
                    if entry.get("owned") and entry.get("host") != host:
                        raise AccessError("This machine's Tailscale name changed. Disable its old Orc route before enabling again.")
                config = command_json("serve", "status", "--json")
                route = route_state(config, host, spec)
                if route != "absent" and (not entry.get("owned") or route not in (saved, wanted)):
                    raise AccessError("Tailscale port %d already has a route Orc does not own. Remove that route in Tailscale or use another machine." % spec["port"])
                if enabled:
                    self.backends.start(channel, origin(host, channel))
                    state[channel] = {"enabled": True, "owned": True, "host": host, "public": wanted == "public"}
                    self.save(state)
                    if route != wanted:
                        if remove_route(host, spec, route) != "absent":
                            raise AccessError("Tailscale still has the old Orc route. Retry on this machine.")
                        command("funnel" if wanted == "public" else "serve", "--bg", "--yes",
                                "--https=%d" % spec["port"], "http://127.0.0.1:%d" % spec["backend"])
                    if route_state(command_json("serve", "status", "--json"), host, spec) != wanted:
                        raise AccessError("Tailscale did not confirm the Orc route. Complete HTTPS setup"
                                          + (" and allow Funnel for this machine in Tailscale" if wanted == "public" else "")
                                          + ", then retry.")
                else:
                    if remove_route(host, spec, route) != "absent":
                        raise AccessError("Tailscale still has this route. Retry disabling it on this machine.")
                    state.pop(channel, None)
                    self.save(state)
            except (AccessError, OSError) as exc:
                self.backends.stop(channel)
                self.errors[channel] = str(exc)
                # A public route must never outlive the server it points at.
                if channel == PUBLIC_CHANNEL:
                    self._drop_route(channel)
                raise AccessError(str(exc)) from exc

    def _drop_route(self, channel):
        """Removes this machine's route for ``channel`` from Tailscale, keeping
        what was saved, so a later restore can put it back. Best effort."""
        try:
            host = hostname()
            route = route_state(command_json("serve", "status", "--json"), host, CHANNELS[channel])
            if route in ("public", "private"):
                remove_route(host, CHANNELS[channel], route)
        except (AccessError, OSError):
            pass

    def suspend_public(self):
        """Takes down every public route Orc owns while the plugin is off,
        since nothing behind them answers any more and the port could be
        taken by something else. The saved state stays, so turning the plugin
        on again on this Mac restores them."""
        with self.lock:
            try:
                state = self.read()
            except AccessError:
                return
            if state.get(PUBLIC_CHANNEL, {}).get("owned"):
                self._drop_route(PUBLIC_CHANNEL)

    def retire_mcp_route(self):
        """Remove the retired route after the old Orc owner has shut down."""
        if not self.path.exists():
            return
        with self.editing():
            state = self.read()
            entry = state.get("mcp")
            if entry is None:
                return
            if entry["owned"]:
                host = entry["host"]
                if hostname() != host:
                    raise AccessError("The saved Orc MCP route belongs to a different Tailscale name.")
                route = route_state(command_json("serve", "status", "--json"), host, LEGACY_MCP_ROUTE)
                if route in ("public", "private") and remove_route(host, LEGACY_MCP_ROUTE, route) != "absent":
                    raise AccessError("Tailscale could not confirm removal of the retired Orc MCP route.")
            # Retain the ownership record if inspection or removal fails, so
            # restarting Orc can retry once Tailscale is available.
            del state["mcp"]
            self.save(state)

    def restore(self):
        try:
            # The installer retires the route after its rollback window closes.
            if not (self.path.parent / "install.lock").exists():
                self.retire_mcp_route()
        except (AccessError, OSError) as exc:
            print("Tailscale upgrade cleanup will retry: %s" % exc, file=sys.stderr)
        try:
            state = self.read()
        except AccessError:
            return
        for channel in CHANNELS:
            if state.get(channel, {}).get("enabled"):
                try:
                    self.change(channel, True)
                except AccessError:
                    pass


def retire_mcp_route(root):
    """Upgrade entry point for installations with the Tailscale plugin off."""
    Manager(root, None).retire_mcp_route()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: tailscale_access.py <orc-config-dir>")
    try:
        retire_mcp_route(sys.argv[1])
    except (AccessError, OSError) as exc:
        sys.exit("Tailscale upgrade cleanup will retry: %s" % exc)
