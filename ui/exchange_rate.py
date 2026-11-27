"""The US dollar to pound rate Settings' "Show costs in" pounds uses.

Every cost Orc shows is worked out in US dollars at API prices. A browser
that shows pounds converts with the rate here, fetched at most once a day
from the European Central Bank's reference rates through Frankfurter
(free, no key). The request is one plain GET: no cookies, no ids and a
generic user agent, so it says nothing about who asked.

The rate is cached in ``~/.orc/exchange-rate.json`` with the time Orc
fetched it. ``current()`` answers from that file at once and, when the
cached rate is a day old or missing, starts one background fetch, so no
request waits on the network. A failed fetch keeps the last good rate and
is not tried again for an hour. ``ORC_EXCHANGE_RATE_URL`` points the fetch
elsewhere; under bin/test (``ORC_TEST_REAL_HOME``) it goes to a closed port,
so no test server reaches the real rate.
"""
from __future__ import annotations

import contextlib
import json
import os
import tempfile
import threading
import time
import urllib.request

URL = "https://api.frankfurter.dev/v1/latest?from=USD&to=GBP"
CACHE_FILE = "exchange-rate.json"
MAX_AGE = 24 * 60 * 60
RETRY_AFTER = 60 * 60
TIMEOUT = 10
# Far outside any real dollar-to-pound rate: an answer here is not a rate.
SANE = (0.2, 5.0)


def _url():
    if os.environ.get("ORC_EXCHANGE_RATE_URL"):
        return os.environ["ORC_EXCHANGE_RATE_URL"]
    return "http://127.0.0.1:9/rate" if os.environ.get("ORC_TEST_REAL_HOME") else URL


def fetch_rate(url=None, timeout=TIMEOUT):
    """The day's USD to GBP rate and the ECB date it is for, or raise."""
    request = urllib.request.Request(url or _url(), headers={"User-Agent": "Orc", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = json.loads(response.read())
    rate = _sane((body.get("rates") or {}).get("GBP"))
    if rate is None:
        raise ValueError("no GBP rate in the answer")
    date = body.get("date")
    return rate, date if isinstance(date, str) else None


def _sane(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if SANE[0] < value < SANE[1] else None


class ExchangeRate:
    """The cached rate under ``config_dir``, refreshed once a day."""

    def __init__(self, config_dir, *, fetch=fetch_rate, clock=time.time, background=True):
        self.path = os.path.join(config_dir, CACHE_FILE)
        self.fetch = fetch
        self.clock = clock
        self.background = background
        self._lock = threading.Lock()
        self._fetching = False
        self._failed_at = None

    def cached(self):
        """The last good rate as ``{usdToGbp, date, fetchedAt}``, or None."""
        try:
            with open(self.path) as handle:
                saved = json.load(handle)
        except (OSError, ValueError):
            return None
        if not isinstance(saved, dict):
            return None
        rate = _sane(saved.get("usdToGbp"))
        fetched = saved.get("fetchedAt")
        if rate is None or isinstance(fetched, bool) or not isinstance(fetched, (int, float)):
            return None
        date = saved.get("date")
        return {"usdToGbp": rate, "date": date if isinstance(date, str) else None, "fetchedAt": fetched}

    def stale(self, saved=None):
        saved = self.cached() if saved is None else saved
        return saved is None or self.clock() - saved["fetchedAt"] >= MAX_AGE

    def current(self):
        """The rate the UI shows now, after starting a refresh when it is due."""
        saved = self.cached()
        if self.stale(saved):
            self.refresh_soon()
        return saved

    def refresh_soon(self):
        """Start one refresh unless one is running or the last failed within the hour."""
        with self._lock:
            if self._fetching or (self._failed_at is not None and self.clock() - self._failed_at < RETRY_AFTER):
                return False
            self._fetching = True
        if self.background:
            threading.Thread(target=self._refresh, name="orc-exchange-rate", daemon=True).start()
        else:
            self._refresh()
        return True

    def _refresh(self):
        try:
            rate, date = self.fetch()
            self._save({"usdToGbp": rate, "date": date, "fetchedAt": self.clock()})
            failed = None
        except Exception:  # noqa: BLE001 - any failure keeps the last good rate
            failed = self.clock()
        with self._lock:
            self._fetching = False
            self._failed_at = failed

    def _save(self, value):
        folder = os.path.dirname(self.path)
        os.makedirs(folder, exist_ok=True)
        fd, temporary = tempfile.mkstemp(dir=folder, prefix="." + CACHE_FILE + ".", suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as handle:
                json.dump(value, handle)
                handle.write("\n")
            os.replace(temporary, self.path)
        except OSError:
            with contextlib.suppress(OSError):
                os.unlink(temporary)
            raise


def public(saved):
    """What /api/config carries: the rate and its ECB date, or None."""
    return None if saved is None else {"usdToGbp": saved["usdToGbp"], "date": saved["date"]}
