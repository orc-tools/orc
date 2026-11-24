"""The run list a viewer last served, kept on disk for the next start.

A viewer reads every run folder before it can build its first run list,
which takes a minute or more on a few thousand runs on a busy Mac, and
every install restarts it. Until that first scan lands, a restarted viewer
answers the run list from the bodies the previous one kept here, then
replaces them with its own.

The settled part is nearly all of the bytes and changes only when a run
settles or comes back, so it is written whenever it changes. The live part
is small and changes on most scans, so it is written at most every
LIVE_SECONDS, and always straight after a new settled part, so the pair on
disk never lists a run in both parts or in neither.
"""

import os
import tempfile
import threading

LIVE_SECONDS = 60
PARTS = ("settled", "live")


class Snapshot:
    def __init__(self, folder):
        self.folder = folder
        self.lock = threading.Lock()
        self.kept = {"settled": None, "live": None}
        self.scanned_at = self.live_at = None

    def path(self, part):
        return os.path.join(self.folder, part + ".json")

    def keep(self, bodies, scanned_at):
        """Write what has changed of `bodies`, {"live", "settled"} each with
        "body" and "etag", encoded together from the scan that began at
        `scanned_at` (time.monotonic()). An older scan than one already
        kept, whose writer was slower to get here, is not written over it."""
        with self.lock:
            if self.scanned_at is not None and scanned_at < self.scanned_at:
                return
            self.scanned_at = scanned_at
            settled = bodies["settled"]["etag"] != self.kept["settled"]
            live_due = self.live_at is None or scanned_at - self.live_at >= LIVE_SECONDS
            if settled:
                self._write("settled", bodies)
            if settled or (bodies["live"]["etag"] != self.kept["live"] and live_due):
                self._write("live", bodies)
                self.live_at = scanned_at

    def _write(self, part, bodies):
        os.makedirs(self.folder, mode=0o700, exist_ok=True)
        fd, temporary = tempfile.mkstemp(dir=self.folder, prefix="." + part + "-", suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(bodies[part]["body"])
            os.replace(temporary, self.path(part))
        except BaseException:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise
        self.kept[part] = bodies[part]["etag"]

    def load(self):
        """{"live": bytes, "settled": bytes} a previous viewer kept, or None
        when there is no whole pair. A live part older than its settled
        part means the write after a new settled part never happened.

        A viewer stopped mid-write leaves its temporary file behind, so the
        ones no writer can still be using go first."""
        try:
            for name in os.listdir(self.folder):
                if name.startswith(".") and name.endswith(".tmp"):
                    os.unlink(os.path.join(self.folder, name))
        except OSError:
            pass
        bodies, stamps = {}, {}
        try:
            for part in PARTS:
                with open(self.path(part), "rb") as handle:
                    stamps[part] = os.fstat(handle.fileno()).st_mtime_ns
                    bodies[part] = handle.read()
        except OSError:
            return None
        if stamps["live"] < stamps["settled"]:
            return None
        if not all(body.startswith(b"[") and body.endswith(b"]") for body in bodies.values()):
            return None
        return bodies
