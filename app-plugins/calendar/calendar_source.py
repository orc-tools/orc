"""The calendar view's feeds: private iCal addresses kept in the Keychain.

Each address is a secret (anyone holding it can read the calendar), so it is
stored as a Keychain generic password and never appears in a response, an
error message or a log line. The first calendar is ORC_CALENDAR_ICS_URL and
later ones ORC_CALENDAR_ICS_URL_2 to _10; a calendar's slot number also picks
its colour, so removing one leaves the others' colours alone.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zlib
import subprocess

from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit

import windows_host

from . import calendar_feed

SECRET_NAME = "ORC_CALENDAR_ICS_URL"
MAX_CALENDARS = 10
SLOT_NAME = re.compile(r"ORC_CALENDAR_ICS_URL(?:_([2-9]|10))?")
# A calendar rarely changes minute to minute, and Google feeds run to megabytes.
CACHE_SECONDS = 5 * 60
FETCH_TIMEOUT = 15
MAX_FEED_BYTES = 25 * 1024 * 1024
MAX_URL_LENGTH = 2048
MAX_RANGE = timedelta(days=63)
# Quiet during meetings asks again every few minutes; a day ahead keeps it
# right through a restart or an hour offline.
MEETINGS_AHEAD = timedelta(hours=24)
MEETING_MAX = timedelta(hours=24)
# Google keeps a window of events under its exact bounds, so the window moves
# in steps and every page that asks within one step shares it.
MEETINGS_STEP = 5 * 60
GRANOLA_APPS = ("/Applications/Granola.app", "~/Applications/Granola.app")


class CalendarError(ValueError):
    pass


def slot_name(slot):
    return SECRET_NAME if slot == 1 else "%s_%d" % (SECRET_NAME, slot)


def slot_of(name):
    match = SLOT_NAME.fullmatch(name) if isinstance(name, str) else None
    return int(match.group(1) or 1) if match else None


def normalize_url(url):
    if not isinstance(url, str) or not url.strip():
        raise CalendarError("Paste your calendar's iCal address.")
    url = url.strip()
    if len(url) > MAX_URL_LENGTH or any(ord(ch) < 0x21 or ord(ch) > 0x7e for ch in url):
        raise CalendarError("That address is not a valid link.")
    if url.lower().startswith("webcal://"):
        url = "https://" + url[len("webcal://"):]
    try:
        parts = urlsplit(url)
        parts.port
    except ValueError:
        raise CalendarError('That address is not a valid link.') from None
    if parts.scheme.lower() != "https" or not parts.hostname:
        raise CalendarError("Use the https:// or webcal:// address of your calendar.")
    return url


def parse_instant(value):
    if not isinstance(value, str) or not value:
        raise CalendarError("from and to are required.")
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise CalendarError("from and to must be ISO 8601 times.") from None
    if moment.tzinfo is None:
        raise CalendarError("from and to need a time zone.")
    return moment.astimezone(timezone.utc)


def granola_installed(paths=GRANOLA_APPS):
    if windows_host.WSL and paths is GRANOLA_APPS:
        try:
            return subprocess.run(["reg.exe", "query", r"HKCR\granola\shell\open\command"],
                                  capture_output=True, timeout=3).returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            return False
    return any(os.path.isdir(os.path.expanduser(path)) for path in paths)


def _meeting_instant(value):
    if not isinstance(value, str) or "T" not in value:
        raise CalendarError("Open both needs the meeting's start and end times.")
    try:
        return parse_instant(value).strftime("%Y-%m-%dT%H:%M:%SZ")
    except CalendarError:
        raise CalendarError("Open both needs the meeting's start and end times.") from None


def meeting_links(meeting):
    """What Open both hands to macOS: a Granola note for the event, then the meeting itself.

    Granola's put-document link reuses the note already tied to that calendar
    event, or starts one, and begins transcribing either way.
    """
    meeting = meeting if isinstance(meeting, dict) else {}
    join = meeting.get("join")
    if not isinstance(join, str) or len(join) > MAX_URL_LENGTH \
            or urlsplit(join).scheme.lower() not in ("https", "http") or not urlsplit(join).hostname:
        raise CalendarError("This meeting has no web link to join.")
    uid = meeting.get("uid")
    if not isinstance(uid, str) or not uid.strip() or len(uid) > 1024:
        raise CalendarError("This meeting has no calendar id for Granola.")
    title = meeting.get("title") if isinstance(meeting.get("title"), str) else ""
    event = {"iCalUID": uid.strip(), "summary": title[:500],
             "start": {"dateTime": _meeting_instant(meeting.get("start"))},
             "end": {"dateTime": _meeting_instant(meeting.get("end"))}}
    query = urlencode({"event": json.dumps(event, separators=(",", ":")), "creation_source": "orc_calendar"})
    return ["granola://put-document?" + query, join]


def meetings(events):
    """When meetings start and end, and on which calendar.

    A meeting has a start and an end time less than a day apart and keeps you
    busy. All-day events, a conference entered as three days with times,
    events shown as free and ones you declined are not meetings. Quiet during
    meetings needs no more than the times, so titles and guests stay out of a
    reply every open page asks for.
    """
    return [{"start": event["start"], "end": event["end"], "calendarId": event["calendarId"]}
            for event in events if is_meeting(event)]


def is_meeting(event):
    return (not event["allDay"] and not event.get("free") and event.get("response") != "declined"
            and timedelta(0) < parse_instant(event["end"]) - parse_instant(event["start"]) < MEETING_MAX)


def upcoming(events, calendars):
    """The same meetings with what a prep card needs: the title, place,
    organizer, guests and description. ``calendars`` is ``{id: name}``.
    These stay on this Mac, where ``meetings`` goes to every open page."""
    found = []
    for event in events:
        if not is_meeting(event):
            continue
        guests = [guest.get("name") or guest.get("email") for guest in event.get("guests") or []
                  if isinstance(guest, dict)]
        found.append({key: value for key, value in {
            "id": event["id"], "title": event.get("title"), "start": event["start"], "end": event["end"],
            "calendar": calendars.get(event["calendarId"]), "location": event.get("location"),
            "organizer": event.get("organizer"), "attendees": event.get("attendees"),
            "guests": [guest for guest in guests if guest], "join": event.get("join"),
            "description": event.get("description"), "url": event.get("url"),
        }.items() if value not in (None, "", [])})
    return sorted(found, key=lambda item: (item["start"], item["id"]))


def download(url):
    request = urllib.request.Request(url, headers={
        "Accept": "text/calendar, text/plain;q=0.5, */*;q=0.1",
        "User-Agent": "Orc calendar"})
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT) as response:
        body = response.read(MAX_FEED_BYTES + 1)
    if len(body) > MAX_FEED_BYTES:
        raise CalendarError("the calendar is too large to read")
    return body.decode("utf-8", "replace")


def describe_failure(exc):
    """Why a download failed, without the address."""
    if isinstance(exc, urllib.error.HTTPError):
        if exc.code in (401, 403, 404):
            return "the address was refused (HTTP %d). It may have been reset" % exc.code
        return "the calendar server answered HTTP %d" % exc.code
    if isinstance(exc, calendar_feed.FeedError):
        return "the address did not return an iCal calendar"
    if isinstance(exc, CalendarError):
        return str(exc)
    if isinstance(exc, TimeoutError) or "timed out" in str(exc):
        return "the calendar took too long to answer"
    return "could not reach the calendar"


def _in_background(work):
    threading.Thread(target=work, name="calendar-refresh", daemon=True).start()


def _iso(stamp):
    if not stamp:
        return None
    return (datetime.fromtimestamp(stamp, timezone.utc)
            .isoformat(timespec="seconds").replace("+00:00", "Z"))


class SavedCopies:
    """The last download of each calendar, kept on disk because orc-ui restarts
    on every update and a feed takes seconds to download again. A feed holds
    private meeting details, so files are mode 0600, and each is filed under
    its address's digest, never the address."""

    _FILE = re.compile(r"(\d+)\.json\.gz")

    def __init__(self, folder):
        self._folder = folder

    def _path(self, slot):
        return os.path.join(self._folder, "%d.json.gz" % slot)

    @staticmethod
    def _digest(url):
        return hashlib.sha256(url.encode()).hexdigest()

    def load(self, slot, url):
        """(ics text, fetched at) for this address, or None."""
        try:
            with open(self._path(slot), "rb") as handle:
                saved = json.loads(gzip.decompress(handle.read()))
            if saved["addressSha256"] == self._digest(url) and isinstance(saved["ics"], str):
                return saved["ics"], float(saved["fetchedAt"])
        except (OSError, EOFError, zlib.error, ValueError, KeyError, TypeError):
            pass
        return None

    def save(self, slot, url, text, fetched_at):
        blob = gzip.compress(json.dumps(
            {"addressSha256": self._digest(url), "fetchedAt": fetched_at, "ics": text}).encode(), compresslevel=6)
        temp = None
        try:
            os.makedirs(self._folder, mode=0o700, exist_ok=True)
            handle, temp = tempfile.mkstemp(dir=self._folder, prefix=".saving-")
            with os.fdopen(handle, "wb") as out:
                out.write(blob)
            os.replace(temp, self._path(slot))
        except OSError:
            if temp:
                self._remove(temp)

    def forget(self, slot):
        self._remove(self._path(slot))

    def keep_only(self, slots):
        try:
            names = os.listdir(self._folder)
        except OSError:
            return
        for name in names:
            match = self._FILE.fullmatch(name)
            if match and int(match.group(1)) not in slots:
                self._remove(os.path.join(self._folder, name))

    @staticmethod
    def _remove(path):
        try:
            os.remove(path)
        except OSError:
            pass


class _Feed:
    def __init__(self, slot, url):
        self.slot = slot
        self.url = url
        self.calendar = None
        self.fetched_at = None
        self.checked_at = None
        self.error = None
        self.refreshing = None
        self.refreshed = threading.Event()

    @property
    def name(self):
        named = getattr(self.calendar, "name", None)
        return named or ("Calendar" if self.slot == 1 else "Calendar %d" % self.slot)


class CalendarSource:
    """Downloads and parses each feed at most once per CACHE_SECONDS. Only a
    feed's first download makes a request wait, since a feed takes seconds to
    fetch, and several first downloads run side by side; later refreshes run
    in the background while the last copy is served. With a store, the last
    copy outlives a restart, so even the first request after one is served
    from it. A failed refresh keeps that copy and reports the failure next to
    it."""

    def __init__(self, *, read_secret, save_secret, delete_secret, list_names=None,
                 fetch=download, clock=time.time, cache_seconds=CACHE_SECONDS,
                 spawn=_in_background, store=None, is_enabled=lambda: True):
        self._read_secret = read_secret
        self._save_secret = save_secret
        self._delete_secret = delete_secret
        self._list_names = list_names or (lambda: ())
        self._fetch = fetch
        self._clock = clock
        self._cache_seconds = cache_seconds
        self._spawn = spawn
        self._store = SavedCopies(store) if store else None
        self._lock = threading.Lock()
        self._feeds = {}
        self._is_enabled = is_enabled
        self._stopped = False

    def stop(self):
        with self._lock:
            self._stopped = True
            return not any(feed.refreshing for feed in self._feeds.values())

    def _saved(self):
        """(slot, url) for each calendar with an address in the Keychain. The
        first slot is always checked, since it predates the secrets index;
        later slots only when the index names them."""
        slots = {1} | {slot_of(name) for name in self._list_names()}
        saved = []
        for slot in sorted(slot for slot in slots if slot):
            url = self._read_secret(slot_name(slot))
            if url:
                saved.append((slot, url))
        return saved

    def _refresh(self, slot, url):
        """Downloads outside the lock, so readers keep the current copy."""
        try:
            if self._stopped or not self._is_enabled():
                raise CalendarError('Calendar is disabled')
            text = self._fetch(url)
            calendar, error = calendar_feed.parse(text), None
        except Exception as exc:  # noqa: BLE001 — every failure becomes a message
            calendar, error = None, describe_failure(exc)
        with self._lock:
            feed = self._feeds.get(slot)
            if feed is None or feed.refreshing != url:
                return
            feed.refreshing = None
            feed.refreshed.set()
            if url != feed.url:
                return
            feed.checked_at = self._clock()
            if calendar is not None:
                feed.calendar, feed.fetched_at, feed.error = calendar, feed.checked_at, None
                self._save(slot, url, text, feed.fetched_at)
            elif feed.calendar is not None:
                feed.error = "%s: %s. Showing the copy from earlier." % (feed.name, error)
            else:
                feed.error = "%s: %s." % (feed.name, error)

    def connect(self, url):
        url = normalize_url(url)
        saved = self._saved()
        if any(known == url for _, known in saved):
            raise CalendarError("That calendar is already connected.")
        if len(saved) >= MAX_CALENDARS:
            raise CalendarError("Orc shows at most %d calendars. Disconnect one first." % MAX_CALENDARS)
        used = {slot for slot, _ in saved}
        slot = min(set(range(1, MAX_CALENDARS + 1)) - used)
        try:
            text = self._fetch(url)
            calendar = calendar_feed.parse(text)
        except Exception as exc:  # noqa: BLE001 — every failure becomes a message
            raise CalendarError("Orc could not read that calendar: %s." % describe_failure(exc)) from None
        self._save_secret(slot_name(slot), url)
        feed = _Feed(slot, url)
        feed.calendar = calendar
        feed.fetched_at = feed.checked_at = self._clock()
        with self._lock:
            self._feeds[slot] = feed
            self._save(slot, url, text, feed.fetched_at)
        return slot_name(slot)

    def disconnect(self, calendar_id):
        slot = slot_of(calendar_id)
        if slot is None:
            raise CalendarError("That is not a connected calendar.")
        self._delete_secret(slot_name(slot))
        with self._lock:
            self._feeds.pop(slot, None)
            if self._store:
                self._store.forget(slot)

    def _save(self, slot, url, text, fetched_at):
        if self._store:
            self._store.save(slot, url, text, fetched_at)

    def _restore(self, slot, url):
        """The saved (calendar, fetched at) for this address, parsed outside the lock."""
        copy = self._store.load(slot, url) if self._store else None
        if copy is None:
            return None
        text, fetched_at = copy
        try:
            return calendar_feed.parse(text), min(fetched_at, self._clock())
        except Exception:  # noqa: BLE001 — a damaged copy is downloaded again
            return None

    def events(self, start, end):
        if end <= start:
            raise CalendarError("to must be after from.")
        if end - start > MAX_RANGE:
            raise CalendarError("Ask for at most 63 days at a time.")
        saved = self._saved()
        with self._lock:
            unloaded = [(slot, url) for slot, url in saved
                        if slot not in self._feeds or self._feeds[slot].url != url]
        restored = {slot: self._restore(slot, url) for slot, url in unloaded}
        first_loads, background, waits = [], [], []
        with self._lock:
            for slot in set(self._feeds) - {slot for slot, _ in saved}:
                del self._feeds[slot]
            if self._store:
                self._store.keep_only({slot for slot, _ in saved})
            for slot, url in saved:
                feed = self._feeds.get(slot)
                if feed is None or feed.url != url:
                    feed = self._feeds[slot] = _Feed(slot, url)
                    if restored.get(slot):
                        feed.calendar, feed.fetched_at = restored[slot]
                        feed.checked_at = feed.fetched_at
                stale = (feed.checked_at is None
                         or self._clock() - feed.checked_at >= self._cache_seconds)
                first_load = feed.checked_at is None
                if stale and feed.refreshing != url:
                    feed.refreshing, feed.refreshed = url, threading.Event()
                    (first_loads if first_load else background).append((slot, url))
                elif first_load:
                    waits.append(feed.refreshed)
        for slot, url in background:
            self._spawn(lambda slot=slot, url=url: self._refresh(slot, url))
        helpers = [threading.Thread(target=self._refresh, args=job, name="calendar-load", daemon=True)
                   for job in first_loads[1:]]
        for helper in helpers:
            helper.start()
        if first_loads:
            self._refresh(*first_loads[0])
        for helper in helpers:
            helper.join(FETCH_TIMEOUT + 5)
        for refreshed in waits:
            refreshed.wait(FETCH_TIMEOUT + 5)
        if not saved:
            return {"connected": False, "events": []}
        calendars, events = [], []
        with self._lock:
            feeds = [self._feeds[slot] for slot, _ in saved if slot in self._feeds]
            for feed in feeds:
                calendar_id = slot_name(feed.slot)
                calendars.append({"id": calendar_id, "slot": feed.slot, "name": feed.name,
                                  "fetchedAt": _iso(feed.fetched_at), "error": feed.error})
                if feed.calendar is None:
                    continue
                for event in calendar_feed.events_between(feed.calendar, start, end):
                    events.append(dict(event, id="%d:%s" % (feed.slot, event["id"]),
                                       calendarId=calendar_id))
        events.sort(key=lambda item: (not item["allDay"], item["start"], item["title"], item["id"]))
        return {"connected": True, "calendars": calendars, "events": events}

    def meeting_window(self):
        """(from, to) that Quiet during meetings asks about: the day ahead of the last step."""
        start = datetime.fromtimestamp(self._clock() // MEETINGS_STEP * MEETINGS_STEP, timezone.utc)
        return start, start + MEETINGS_AHEAD
