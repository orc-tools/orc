"""Action bars built ahead of the page that shows them.

Building a run's Ship bar runs Git and the delivery-authority check, which
takes a second or two. This keeps the last build for each run, so the page
draws the bar at once and checks it afterwards.

Each build is kept under a stamp: the caller's cheap fingerprint of what the
run itself can change about its bar. A kept bar is drawn only while that
stamp still holds, so a bar never redraws the state its own click just left.
What the stamp cannot see (Git state, other runs) is caught by the page,
which asks for a fresh build's version after it draws and reloads the bar
when that differs.
"""
import hashlib
import threading
from typing import NamedTuple, Optional


class Bar(NamedTuple):
    stamp: object
    body: Optional[bytes]   # None when the build offered no bar
    version: str            # "" when the build offered no bar


def version_of(body):
    return hashlib.sha256(body).hexdigest()[:16] if body else ""


class PrebuiltBars:
    def __init__(self):
        self._lock = threading.Lock()
        self._bars = {}
        self._builds = {}   # run id -> lock held for the length of one build

    def _kept(self, run_id, stamp):
        # A run with no stamp cannot be told apart from its earlier self.
        if stamp is None:
            return None
        with self._lock:
            bar = self._bars.get(run_id)
        return bar if bar is not None and bar.stamp == stamp else None

    def _build_lock(self, run_id):
        with self._lock:
            return self._builds.setdefault(run_id, threading.Lock())

    def _build(self, run_id, stamp, build):
        # The stamp is read before the build, so a change that lands while it
        # runs leaves the result looking stale instead of current.
        try:
            body = build() or None
        except Exception:
            # Remembered as tried, so a broken run is not rebuilt every tick.
            self._keep(run_id, Bar(stamp, None, ""))
            raise
        bar = Bar(stamp, body, version_of(body))
        self._keep(run_id, bar)
        return bar

    def _keep(self, run_id, bar):
        if bar.stamp is None:
            return
        with self._lock:
            self._bars[run_id] = bar

    def built(self, run_id, stamp):
        """Whether a build already ran under this stamp, bar or no bar."""
        return self._kept(run_id, stamp) is not None

    def building(self, run_id):
        """Whether a build of this run is running now."""
        with self._lock:
            lock = self._builds.get(run_id)
        return lock is not None and lock.locked()

    def shown(self, run_id, stamp_of, build):
        """The bar to draw, as `(body, version)`.

        `version` is set only for a kept bar the caller did not just build:
        the page should check that one. A build that offered no bar is never
        drawn from the keep, so the next request builds again.
        """
        bar = self._kept(run_id, stamp_of())
        if bar is not None and bar.body:
            return bar.body, bar.version
        with self._build_lock(run_id):
            # A build that finished while this one waited is as fresh as its own.
            stamp = stamp_of()
            bar = self._kept(run_id, stamp)
            if bar is None or not bar.body:
                bar = self._build(run_id, stamp, build)
        return bar.body, None

    def fresh(self, run_id, stamp_of, build):
        """Build now, keep the result, and return its version ("" for no bar).

        Waits for a build already running and then builds again: the caller
        wants a build that started after it asked.
        """
        with self._build_lock(run_id):
            return self._build(run_id, stamp_of(), build).version

    def keep_only(self, run_ids):
        """Forget every run not named, such as one that left the gate."""
        wanted = set(run_ids)
        with self._lock:
            for run_id in set(self._bars) - wanted:
                del self._bars[run_id]
            for run_id in set(self._builds) - wanted:
                # A lock in use belongs to a build that will keep its result;
                # the next sweep forgets that run again.
                if not self._builds[run_id].locked():
                    del self._builds[run_id]
