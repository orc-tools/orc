"""Google Calendar accounts for the calendar view: sign-in, reading and editing.

An account signs in with PKCE in the system browser and returns to Orc's own
port. Its refresh token is a Keychain secret; config holds only the account's
address and which of its calendars show. Events are read one window at a time
and kept for CACHE_SECONDS, and every edit drops that calendar's windows so
the next read shows it.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone

from . import calendar_feed

AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN = "https://oauth2.googleapis.com/token"
REVOKE = "https://oauth2.googleapis.com/revoke"
API = "https://www.googleapis.com/calendar/v3"
LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events"
SCOPES = (LIST_SCOPE, EVENTS_SCOPE)
# The full-calendar permission covers both, for a client that was granted it.
FULL_SCOPE = "https://www.googleapis.com/auth/calendar"
MAX_ACCOUNTS = 5
REFRESH_SECRET = "ORC_CALENDAR_GOOGLE_REFRESH"
CLIENT_SECRET_NAME = "ORC_CALENDAR_GOOGLE_CLIENT_SECRET"
CLIENT_ID = re.compile(r"[0-9]{6,24}-[0-9a-z]{8,64}\.apps\.googleusercontent\.com\Z")
CLIENT_SECRET = re.compile(r"[\x21-\x7e]{8,256}\Z")
REFERENCE = re.compile(r"google:([1-9]):(.{1,256})\Z")
EVENT_ID = re.compile(r"[A-Za-z0-9_@.\-]{1,1024}\Z")
DAY = re.compile(r"\d{4}-\d{2}-\d{2}\Z")
ZONE = re.compile(r"[A-Za-z][A-Za-z0-9_+\-/]{0,63}\Z")
EMAIL = re.compile(r"[^@\s<>,;\"']{1,64}@[A-Za-z0-9.\-]{1,255}\Z")
COLOUR = re.compile(r"#[0-9a-fA-F]{6}\Z")
# A sign-in left half done expires, so an old state cannot be replayed.
LOGIN_TTL = 600
TIMEOUT = 15
CACHE_SECONDS = 60
LIST_SECONDS = 10 * 60
MAX_WINDOWS = 96
PAGE_SIZE = 2500
MAX_PAGES = 4
MAX_GUESTS = 100
TEXT_LIMITS = {"title": 1024, "location": 1024, "description": 8192}
RESPONSES = {"needsAction": "needs-action", "accepted": "accepted", "tentative": "tentative", "declined": "declined"}
REPLIES = {"accepted": "accepted", "tentative": "tentative", "declined": "declined"}
REASONS = {
    "forbiddenForNonOrganizer": (403, "Only the organiser can change this event."),
    "insufficientPermissions": (403, "Google did not give Orc that permission. Sign in to Google again and allow both."),
    "accessNotConfigured": (403, "The Google Calendar API is switched off for this sign-in app. Enable it in Google Cloud, then try again."),
    "rateLimitExceeded": (429, "Google is limiting requests. Try again in a minute."),
    "userRateLimitExceeded": (429, "Google is limiting requests. Try again in a minute."),
    "quotaExceeded": (429, "Google is limiting requests. Try again in a minute."),
    "requiredAccessLevel": (403, "This calendar is read-only for your account."),
}


class GoogleError(Exception):
    def __init__(self, status, message, code=None):
        super().__init__(message)
        self.status = status
        self.code = code


def secret_name(slot):
    return "%s_%d" % (REFRESH_SECRET, slot)


def reference(slot, calendar_id):
    return "google:%d:%s" % (slot, calendar_id)


def _pkce():
    verifier = secrets.token_urlsafe(64)[:96]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def _instant(value):
    """A Google dateTime as a UTC instant, or None."""
    if not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment.astimezone(timezone.utc) if moment.tzinfo else None


def _stamp(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _colour(value):
    return value.lower() if isinstance(value, str) and COLOUR.fullmatch(value) else None


def shape_calendar(item):
    """One calendarList entry as the view needs it, or None for one Google hides."""
    if not isinstance(item, dict) or not isinstance(item.get("id"), str) or item.get("deleted") or item.get("hidden"):
        return None
    name = item.get("summaryOverride") or item.get("summary") or item["id"]
    return {
        "id": item["id"], "name": str(name)[:200],
        "color": _colour(item.get("backgroundColor")),
        "writable": item.get("accessRole") in ("owner", "writer"),
        "primary": bool(item.get("primary")), "selected": bool(item.get("selected")),
    }


def _guest(attendee):
    email = attendee.get("email") if isinstance(attendee.get("email"), str) else ""
    return {
        "name": str(attendee.get("displayName") or email)[:200], "email": email[:320],
        "response": RESPONSES.get(attendee.get("responseStatus"), "needs-action"),
        "organizer": bool(attendee.get("organizer")), "self": bool(attendee.get("self")),
        "optional": bool(attendee.get("optional")),
    }


def _join(item, location, description):
    conference = item.get("conferenceData") if isinstance(item.get("conferenceData"), dict) else {}
    for entry in conference.get("entryPoints") or []:
        if isinstance(entry, dict) and entry.get("entryPointType") == "video" and isinstance(entry.get("uri"), str):
            return entry["uri"]
    if isinstance(item.get("hangoutLink"), str):
        return item["hangoutLink"]
    return calendar_feed.join_link(None, location, description)


def shape_event(item, ref, calendar):
    """One Google event in the shape calendar_feed emits, plus what editing needs."""
    if not isinstance(item, dict) or not isinstance(item.get("id"), str) or item.get("status") == "cancelled":
        return None
    kind = item.get("eventType") or "default"
    # A working location is a daily all-day marker, not a meeting.
    if kind == "workingLocation":
        return None
    start = item.get("start") if isinstance(item.get("start"), dict) else {}
    end = item.get("end") if isinstance(item.get("end"), dict) else {}
    all_day = isinstance(start.get("date"), str)
    if all_day:
        if not DAY.fullmatch(start["date"]):
            return None
        first = start["date"]
        last = end.get("date") if isinstance(end.get("date"), str) and DAY.fullmatch(end["date"]) else first
    else:
        begins, ends = _instant(start.get("dateTime")), _instant(end.get("dateTime"))
        if begins is None:
            return None
        first, last = _stamp(begins), _stamp(ends if ends and ends >= begins else begins)
    attendees = [attendee for attendee in item.get("attendees") or []
                 if isinstance(attendee, dict) and not attendee.get("resource")]
    me = next((attendee for attendee in attendees if attendee.get("self")), None)
    organizer = item.get("organizer") if isinstance(item.get("organizer"), dict) else {}
    location = item.get("location") if isinstance(item.get("location"), str) else None
    description = item.get("description") if isinstance(item.get("description"), str) else None
    ordinary = calendar["writable"] and kind == "default" and not item.get("locked")
    title = item.get("summary") if isinstance(item.get("summary"), str) else ""
    return {
        "id": "%s:%s" % (ref, item["id"]), "eventId": item["id"], "source": "google",
        "uid": item.get("iCalUID") if isinstance(item.get("iCalUID"), str) else None,
        "calendarId": ref,
        # A calendar shared as free/busy carries no titles.
        "title": title.strip() or ("" if calendar["writable"] else "Busy"),
        "allDay": all_day, "start": first, "end": last,
        "location": location or None,
        "join": _join(item, location, description),
        "description": calendar_feed.clean_description(description) if description else None,
        "organizer": (organizer.get("displayName") or organizer.get("email") or None),
        "response": RESPONSES.get(me.get("responseStatus")) if me else None,
        # "Show as: Free". Quiet during meetings leaves these out, as it does for a feed.
        "free": item.get("transparency") == "transparent",
        "attendees": len(attendees),
        "guests": [_guest(attendee) for attendee in attendees[:MAX_GUESTS]],
        "url": item.get("htmlLink") if isinstance(item.get("htmlLink"), str) else None,
        "editable": bool(ordinary and (organizer.get("self") or item.get("guestsCanModify") or not organizer)),
        "removable": bool(ordinary),
        "canRespond": bool(ordinary and me),
        "recurring": bool(item.get("recurringEventId") or item.get("recurrence")),
        "meet": bool(item.get("conferenceData") or item.get("hangoutLink")),
    }


def _text(data, key, required=False):
    value = data.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, str) or len(value) > TEXT_LIMITS[key]:
        raise GoogleError(400, "The %s is too long." % key)
    return value.strip()


def clean_fields(data, *, creating):
    """What the editor sent, checked: only the fields present are changed."""
    if not isinstance(data, dict):
        raise GoogleError(400, "Expected an object.")
    fields = {}
    for key in TEXT_LIMITS:
        if key in data or (creating and key == "title"):
            fields[key] = _text(data, key) or ""
    if creating or "start" in data or "end" in data or "allDay" in data:
        all_day = data.get("allDay") is True
        start, end = data.get("start"), data.get("end")
        if all_day:
            if not (isinstance(start, str) and isinstance(end, str) and DAY.fullmatch(start) and DAY.fullmatch(end)):
                raise GoogleError(400, "An all-day event needs a first and last day.")
            try:
                if date.fromisoformat(end) <= date.fromisoformat(start):
                    raise GoogleError(400, "The event must end after it starts.")
            except ValueError:
                raise GoogleError(400, "That is not a real date.") from None
            fields["when"] = (True, start, end)
        else:
            begins, ends = _instant(start), _instant(end)
            if begins is None or ends is None:
                raise GoogleError(400, "The event needs a start and an end time.")
            if ends <= begins:
                raise GoogleError(400, "The event must end after it starts.")
            fields["when"] = (False, _stamp(begins), _stamp(ends))
        zone = data.get("timeZone")
        fields["zone"] = zone if isinstance(zone, str) and ZONE.fullmatch(zone) else None
    if "guests" in data:
        guests = data["guests"]
        if not isinstance(guests, list) or len(guests) > MAX_GUESTS:
            raise GoogleError(400, "An event takes at most %d guests." % MAX_GUESTS)
        cleaned = []
        for guest in guests:
            email = guest.strip() if isinstance(guest, str) else ""
            if not EMAIL.fullmatch(email):
                raise GoogleError(400, "%s is not an email address." % (email[:80] or "A guest"))
            if email.lower() not in (known.lower() for known in cleaned):
                cleaned.append(email)
        fields["guests"] = cleaned
    if data.get("meet") is True:
        fields["meet"] = True
    fields["notify"] = data.get("notify") is True
    return fields


def _when(fields, *, creating):
    """Google's start and end for the cleaned time. A patch names the unused
    form as null, since Google merges an object it is sent into the one it has."""
    all_day, start, end = fields["when"]
    if all_day:
        shaped = [{"date": start}, {"date": end}]
        cleared = {"dateTime": None, "timeZone": None}
    else:
        shaped = [{"dateTime": start}, {"dateTime": end}]
        if fields.get("zone"):
            for side in shaped:
                side["timeZone"] = fields["zone"]
        cleared = {"date": None}
    if not creating:
        for side in shaped:
            side.update(cleared)
    return shaped


def _reason(payload):
    error = payload.get("error") if isinstance(payload, dict) else None
    if not isinstance(error, dict):
        return "", ""
    first = (error.get("errors") or [{}])[0]
    reason = first.get("reason") if isinstance(first, dict) else ""
    return reason or "", error.get("message") if isinstance(error.get("message"), str) else ""


class Google:
    def __init__(self, *, client, read_settings, update_settings, read_secret, save_secret, delete_secret,
                 opener=urllib.request.urlopen, clock=time.time, is_enabled=lambda: True):
        self._client = client
        self._read_settings = read_settings
        self._update_settings = update_settings
        self._read_secret = read_secret
        self._save_secret = save_secret
        self._delete_secret = delete_secret
        self._opener = opener
        self._clock = clock
        self._is_enabled = is_enabled
        self._lock = threading.Lock()
        self._refreshing = {slot: threading.Lock() for slot in range(1, MAX_ACCOUNTS + 1)}
        self._tokens = {}
        self._lists = {}
        self._windows = OrderedDict()
        self._logins = {}
        self._signed_out = {}

    # --- accounts ---------------------------------------------------------

    def accounts(self):
        """{slot: {"email", "shown"}} for each account config names."""
        saved = (self._read_settings() or {}).get("accounts")
        accounts = {}
        for key, record in (saved.items() if isinstance(saved, dict) else ()):
            if key in "12345" and len(key) == 1 and isinstance(record, dict) and isinstance(record.get("email"), str):
                shown = record.get("shown") if isinstance(record.get("shown"), dict) else {}
                accounts[int(key)] = {"email": record["email"],
                                      "shown": {name: value for name, value in shown.items() if isinstance(value, bool)}}
        return accounts

    def _write_accounts(self, change):
        def transform(settings):
            accounts = settings.get("accounts") if isinstance(settings.get("accounts"), dict) else {}
            accounts = change(dict(accounts))
            if accounts:
                settings["accounts"] = accounts
            else:
                settings.pop("accounts", None)
            return settings
        self._update_settings(transform)

    def login_url(self, redirect_uri):
        client = self._client()
        if not client:
            raise GoogleError(400, "Add a Google sign-in app first.")
        verifier, challenge = _pkce()
        state = secrets.token_urlsafe(24)
        now = self._clock()
        with self._lock:
            self._logins = {key: value for key, value in self._logins.items() if now - value["at"] < LOGIN_TTL}
            self._logins[state] = {"verifier": verifier, "redirect": redirect_uri, "at": now}
        return AUTH + "?" + urllib.parse.urlencode({
            "client_id": client[0], "response_type": "code", "redirect_uri": redirect_uri,
            "scope": " ".join(SCOPES), "state": state,
            "code_challenge_method": "S256", "code_challenge": challenge,
            # Google returns a refresh token only for offline access, and only
            # on a sign-in that shows the consent screen.
            "access_type": "offline", "prompt": "consent select_account",
        })

    def finish_login(self, state, code):
        """Stores the account the browser signed in to and returns its address."""
        with self._lock:
            login = self._logins.pop(state or "", None)
        if not login or self._clock() - login["at"] >= LOGIN_TTL:
            raise GoogleError(400, "That Google sign-in expired. Start it again from Orc.")
        if not code:
            raise GoogleError(400, "Google did not sign you in.")
        data = self._token({"grant_type": "authorization_code", "code": code,
                            "redirect_uri": login["redirect"], "code_verifier": login["verifier"]})
        granted = set(str(data.get("scope") or "").split())
        refresh = data.get("refresh_token")
        if not (FULL_SCOPE in granted or granted >= set(SCOPES)):
            self._revoke(refresh or data["access_token"])
            raise GoogleError(403, "Orc needs both permissions on Google's screen: to see your calendars and to edit events. Sign in again and tick both.")
        if not refresh:
            raise GoogleError(502, "Google did not keep Orc signed in. Remove Orc from your Google account's connected apps, then sign in again.")
        try:
            calendars = self._list(data["access_token"])
        except GoogleError:
            # A grant Orc cannot use is not left standing at Google.
            self._revoke(refresh)
            raise
        email = next((calendar["id"] for calendar in calendars if calendar["primary"]), None)
        if not email:
            self._revoke(refresh)
            raise GoogleError(502, "Google did not say which account signed in.")
        accounts = self.accounts()
        slot = next((slot for slot, record in accounts.items() if record["email"].lower() == email.lower()), None)
        if slot is None:
            free = sorted(set(range(1, MAX_ACCOUNTS + 1)) - set(accounts))
            if not free:
                self._revoke(refresh)
                raise GoogleError(400, "Orc holds at most %d Google accounts. Sign one out first." % MAX_ACCOUNTS)
            slot = free[0]
        self._save_secret(secret_name(slot), refresh)
        self._write_accounts(lambda saved: {**saved, str(slot): {**(saved.get(str(slot)) or {}), "email": email}})
        with self._lock:
            self._tokens[slot] = (data["access_token"], self._clock() + int(data.get("expires_in") or 3600) - 60)
            self._lists[slot] = (calendars, self._clock())
            self._signed_out.pop(slot, None)
        return email

    def sign_out(self, slot):
        if slot not in self.accounts():
            raise GoogleError(400, "That is not a signed-in Google account.")
        refresh = self._read_secret(secret_name(slot))
        if refresh:
            self._revoke(refresh)
        self._delete_secret(secret_name(slot))
        self._write_accounts(lambda saved: {key: value for key, value in saved.items() if key != str(slot)})
        self._forget(slot)

    def sign_out_all(self):
        for slot in self.accounts():
            self.sign_out(slot)

    def _forget(self, slot):
        with self._lock:
            self._tokens.pop(slot, None)
            self._lists.pop(slot, None)
            self._signed_out.pop(slot, None)
            for key in [key for key in self._windows if key[0] == slot]:
                del self._windows[key]

    def show(self, slot, calendar_id, shown):
        """Chooses whether one of an account's calendars shows in the view."""
        if slot not in self.accounts() or not isinstance(calendar_id, str) or not isinstance(shown, bool):
            raise GoogleError(400, "That is not a calendar of a signed-in account.")
        if not any(calendar["id"] == calendar_id for calendar in self.calendars(slot)):
            raise GoogleError(400, "That is not a calendar of a signed-in account.")

        def change(saved):
            record = dict(saved.get(str(slot)) or {})
            record["shown"] = {**(record.get("shown") if isinstance(record.get("shown"), dict) else {}), calendar_id: shown}
            return {**saved, str(slot): record}
        self._write_accounts(change)

    # --- tokens and requests ----------------------------------------------

    def _open(self, request):
        if not self._is_enabled():
            raise GoogleError(503, "Calendar is disabled.")
        with self._opener(request, timeout=TIMEOUT) as response:
            return response.read()

    def _token(self, form):
        client = self._client()
        if not client:
            raise GoogleError(400, "Add a Google sign-in app first.")
        form = {**form, "client_id": client[0]}
        if client[1]:
            form["client_secret"] = client[1]
        request = urllib.request.Request(TOKEN, data=urllib.parse.urlencode(form).encode(), method="POST",
                                         headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            data = json.loads(self._open(request) or b"{}")
        except urllib.error.HTTPError as error:
            try:
                reason = json.loads(error.read() or b"{}").get("error")
            except (ValueError, AttributeError):
                reason = None
            finally:
                error.close()
            if reason == "invalid_grant":
                raise GoogleError(401, "Google signed this account out. Sign in again.", "signed-out") from None
            if reason in ("invalid_client", "unauthorized_client"):
                raise GoogleError(400, "Google does not accept this sign-in app. Check its client ID and secret.", "client") from None
            raise GoogleError(502, "Google refused the sign-in.") from None
        except (OSError, ValueError):
            raise GoogleError(503, "Google could not be reached.") from None
        if not isinstance(data, dict) or not isinstance(data.get("access_token"), str):
            raise GoogleError(502, "Google refused the sign-in.")
        return data

    def _revoke(self, token):
        request = urllib.request.Request(REVOKE, data=urllib.parse.urlencode({"token": token}).encode(), method="POST",
                                         headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            self._open(request)
        except (GoogleError, OSError, ValueError):
            # Signing out still removes Orc's copy; Google's expires unused.
            pass

    def _access(self, slot):
        # Calls that find the token expired together share one refresh.
        with self._refreshing[slot]:
            with self._lock:
                held = self._tokens.get(slot)
                gone = self._signed_out.get(slot)
            if held and self._clock() < held[1]:
                return held[0]
            if gone:
                raise GoogleError(401, gone, "signed-out")
            refresh = self._read_secret(secret_name(slot))
            if not refresh:
                self._mark_signed_out(slot)
                raise GoogleError(401, self._signed_out[slot], "signed-out")
            try:
                data = self._token({"grant_type": "refresh_token", "refresh_token": refresh})
            except GoogleError as error:
                if error.code == "signed-out":
                    # A revoked or expired refresh token cannot recover.
                    self._delete_secret(secret_name(slot))
                    self._mark_signed_out(slot)
                raise
            with self._lock:
                self._tokens[slot] = (data["access_token"], self._clock() + int(data.get("expires_in") or 3600) - 60)
            return data["access_token"]

    def _mark_signed_out(self, slot):
        with self._lock:
            self._tokens.pop(slot, None)
            self._signed_out[slot] = "Google signed this account out. Sign in again."

    def _send(self, token, method, path, query=None, body=None):
        url = API + path + ("?" + urllib.parse.urlencode(query) if query else "")
        headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            raw = self._open(request)
        except urllib.error.HTTPError as error:
            try:
                payload = json.loads(error.read() or b"{}")
            except ValueError:
                payload = {}
            finally:
                error.close()
            reason, message = _reason(payload)
            if error.code == 401:
                raise GoogleError(401, "Google signed this account out. Sign in again.", "expired") from None
            if reason in REASONS:
                raise GoogleError(*REASONS[reason], reason) from None
            if error.code in (404, 410):
                raise GoogleError(404, "That event is no longer on the calendar.", "gone") from None
            if error.code == 400 and message:
                raise GoogleError(400, "Google refused that change: %s" % message[:300]) from None
            if error.code == 403:
                raise GoogleError(403, "Google does not allow that for this account.") from None
            raise GoogleError(502, "Google Calendar answered HTTP %d." % error.code) from None
        except (OSError, ValueError):
            raise GoogleError(503, "Google Calendar could not be reached.") from None
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except ValueError:
            raise GoogleError(502, "Google Calendar sent an answer Orc could not read.") from None

    def call(self, slot, method, path, query=None, body=None):
        try:
            return self._send(self._access(slot), method, path, query, body)
        except GoogleError as error:
            if error.code != "expired":
                raise
        # Google can retire an access token before its hour is up.
        with self._lock:
            self._tokens.pop(slot, None)
        try:
            return self._send(self._access(slot), method, path, query, body)
        except GoogleError as error:
            if error.code == "expired":
                self._mark_signed_out(slot)
                raise GoogleError(401, "Google signed this account out. Sign in again.", "signed-out") from None
            raise

    # --- reading ------------------------------------------------------------

    def _list(self, token=None, slot=None):
        calendars, page = [], None
        for _ in range(MAX_PAGES):
            query = {"maxResults": 250, "minAccessRole": "freeBusyReader"}
            if page:
                query["pageToken"] = page
            data = (self._send(token, "GET", "/users/me/calendarList", query) if token
                    else self.call(slot, "GET", "/users/me/calendarList", query))
            calendars += [shaped for shaped in map(shape_calendar, data.get("items") or []) if shaped]
            page = data.get("nextPageToken")
            if not page:
                break
        calendars.sort(key=lambda calendar: (not calendar["primary"], not calendar["writable"], calendar["name"].lower()))
        return calendars

    def calendars(self, slot, *, fresh=False):
        with self._lock:
            held = self._lists.get(slot)
        if held and not fresh and self._clock() - held[1] < LIST_SECONDS:
            return held[0]
        try:
            calendars = self._list(slot=slot)
        except GoogleError:
            if held:
                return held[0]
            raise
        with self._lock:
            self._lists[slot] = (calendars, self._clock())
        return calendars

    @staticmethod
    def _shown(calendar, record):
        chosen = record["shown"].get(calendar["id"])
        return chosen if isinstance(chosen, bool) else calendar["selected"] or calendar["primary"]

    def _window(self, slot, calendar, start, end):
        """(events, fetched at, error, signed out) for one calendar's window."""
        key = (slot, calendar["id"], start, end)
        with self._lock:
            held = self._windows.get(key)
        if held and self._clock() - held[1] < CACHE_SECONDS:
            return held[0], held[1], None, False
        ref = reference(slot, calendar["id"])
        try:
            events, page = [], None
            for _ in range(MAX_PAGES):
                query = {"timeMin": start, "timeMax": end, "singleEvents": "true", "orderBy": "startTime",
                         "maxResults": PAGE_SIZE}
                if page:
                    query["pageToken"] = page
                data = self.call(slot, "GET", "/calendars/%s/events" % urllib.parse.quote(calendar["id"], safe=""), query)
                events += [shaped for shaped in (shape_event(item, ref, calendar) for item in data.get("items") or []) if shaped]
                page = data.get("nextPageToken")
                if not page:
                    break
        except GoogleError as error:
            gone = error.code == "signed-out"
            if held:
                return held[0], held[1], "%s: %s Showing the copy from earlier." % (calendar["name"], error), gone
            return [], None, "%s: %s" % (calendar["name"], error), gone
        now = self._clock()
        with self._lock:
            self._windows[key] = (events, now)
            self._windows.move_to_end(key)
            while len(self._windows) > MAX_WINDOWS:
                self._windows.popitem(last=False)
        return events, now, None, False

    def _drop_windows(self, slot, calendar_id):
        with self._lock:
            for key in [key for key in self._windows if key[:2] == (slot, calendar_id)]:
                del self._windows[key]

    def snapshot(self, start, end):
        """(accounts, shown calendars, events) between two instants."""
        start, end = _stamp(start), _stamp(end)
        accounts, shown, jobs = [], [], []
        for slot, record in sorted(self.accounts().items()):
            account = {"id": str(slot), "email": record["email"], "error": None, "needsLogin": False, "calendars": []}
            accounts.append(account)
            try:
                calendars = self.calendars(slot)
            except GoogleError as error:
                account["error"] = str(error)
                account["needsLogin"] = error.code == "signed-out"
                continue
            for calendar in calendars:
                ref = reference(slot, calendar["id"])
                visible = self._shown(calendar, record)
                account["calendars"].append({"id": ref, "name": calendar["name"], "color": calendar["color"],
                                             "writable": calendar["writable"], "primary": calendar["primary"],
                                             "shown": visible})
                if visible:
                    row = {"id": ref, "name": calendar["name"], "source": "google", "account": str(slot),
                           "color": calendar["color"], "writable": calendar["writable"],
                           "primary": calendar["primary"], "fetchedAt": None, "error": None}
                    shown.append(row)
                    jobs.append((slot, calendar, row))
        events = []
        if jobs:
            with ThreadPoolExecutor(max_workers=min(6, len(jobs)), thread_name_prefix="calendar-google") as pool:
                results = list(pool.map(lambda job: self._window(job[0], job[1], start, end), jobs))
            for (slot, _calendar, row), (found, fetched_at, error, gone) in zip(jobs, results):
                events += found
                row["error"] = error
                if fetched_at:
                    row["fetchedAt"] = _stamp(datetime.fromtimestamp(fetched_at, timezone.utc))
                if gone:
                    account = next(item for item in accounts if item["id"] == str(slot))
                    account["needsLogin"], account["error"] = True, "Google signed this account out. Sign in again."
        return accounts, shown, events

    # --- editing ------------------------------------------------------------

    def _target(self, ref):
        match = REFERENCE.fullmatch(ref) if isinstance(ref, str) else None
        slot = int(match.group(1)) if match else None
        if slot not in self.accounts():
            raise GoogleError(400, "That is not a calendar of a signed-in Google account.")
        calendar = next((item for item in self.calendars(slot) if item["id"] == match.group(2)), None)
        if calendar is None:
            raise GoogleError(400, "That is not a calendar of a signed-in Google account.")
        if not calendar["writable"]:
            raise GoogleError(403, "%s is read-only for your account." % calendar["name"])
        return slot, calendar, "/calendars/%s/events" % urllib.parse.quote(calendar["id"], safe="")

    @staticmethod
    def _event_path(base, event_id):
        if not isinstance(event_id, str) or not EVENT_ID.fullmatch(event_id):
            raise GoogleError(400, "That is not an event Orc can change.")
        return "%s/%s" % (base, urllib.parse.quote(event_id, safe=""))

    def _resolve(self, slot, base, event_id, scope):
        """(path, event) for the event a change applies to: the one occurrence,
        or the series it belongs to."""
        if scope not in ("this", "series"):
            raise GoogleError(400, "Choose this event or the whole series.")
        path = self._event_path(base, event_id)
        event = self.call(slot, "GET", path)
        series = event.get("recurringEventId")
        if scope == "series" and isinstance(series, str):
            path = self._event_path(base, series)
            event = self.call(slot, "GET", path)
        return path, event

    @staticmethod
    def _updates(notify):
        return "all" if notify else "none"

    def create(self, ref, data):
        slot, calendar, base = self._target(ref)
        fields = clean_fields(data, creating=True)
        start, end = _when(fields, creating=True)
        body = {"summary": fields["title"], "start": start, "end": end}
        for key in ("location", "description"):
            if fields.get(key):
                body[key] = fields[key]
        if fields.get("guests"):
            body["attendees"] = [{"email": email} for email in fields["guests"]]
        query = {"sendUpdates": self._updates(fields["notify"])}
        if fields.get("meet"):
            body["conferenceData"] = {"createRequest": {"requestId": secrets.token_hex(12),
                                                        "conferenceSolutionKey": {"type": "hangoutsMeet"}}}
            query["conferenceDataVersion"] = 1
        event = self.call(slot, "POST", base, query, body)
        self._drop_windows(slot, calendar["id"])
        return shape_event(event, ref, calendar)

    def update(self, ref, event_id, data, scope="this"):
        slot, calendar, base = self._target(ref)
        fields = clean_fields(data, creating=False)
        if scope == "series" and "when" in fields:
            raise GoogleError(400, "Orc changes the time of one event at a time. Change when a whole series happens in Google Calendar.")
        body, path = {}, None
        if "guests" in fields or scope == "series":
            path, current = self._resolve(slot, base, event_id, scope)
            if "guests" in fields:
                known = {str(attendee.get("email", "")).lower(): attendee
                         for attendee in current.get("attendees") or [] if isinstance(attendee, dict)}
                wanted = {email.lower() for email in fields["guests"]}
                # Rooms and the like are not guests the editor lists, so they stay.
                body["attendees"] = [attendee for email, attendee in known.items()
                                     if attendee.get("resource") or attendee.get("self") or email in wanted]
                body["attendees"] += [{"email": email} for email in fields["guests"] if email.lower() not in known]
        path = path or self._event_path(base, event_id)
        if "title" in fields:
            body["summary"] = fields["title"]
        for key in ("location", "description"):
            if key in fields:
                body[key] = fields[key]
        if "when" in fields:
            body["start"], body["end"] = _when(fields, creating=False)
        query = {"sendUpdates": self._updates(fields["notify"])}
        if fields.get("meet"):
            body["conferenceData"] = {"createRequest": {"requestId": secrets.token_hex(12),
                                                        "conferenceSolutionKey": {"type": "hangoutsMeet"}}}
            query["conferenceDataVersion"] = 1
        if not body:
            raise GoogleError(400, "Nothing to change.")
        event = self.call(slot, "PATCH", path, query, body)
        self._drop_windows(slot, calendar["id"])
        return shape_event(event, ref, calendar)

    def delete(self, ref, event_id, scope="this", notify=False):
        slot, calendar, base = self._target(ref)
        path = self._event_path(base, event_id)
        if scope == "series":
            path, _event = self._resolve(slot, base, event_id, scope)
        elif scope != "this":
            raise GoogleError(400, "Choose this event or the whole series.")
        try:
            self.call(slot, "DELETE", path, {"sendUpdates": self._updates(notify)})
        except GoogleError as error:
            # Already gone is what was asked for.
            if error.code != "gone":
                raise
        self._drop_windows(slot, calendar["id"])

    def respond(self, ref, event_id, reply, scope="this"):
        if reply not in REPLIES:
            raise GoogleError(400, "Reply Yes, Maybe or No.")
        slot, calendar, base = self._target(ref)
        path, current = self._resolve(slot, base, event_id, scope)
        attendees = [attendee for attendee in current.get("attendees") or [] if isinstance(attendee, dict)]
        if not any(attendee.get("self") for attendee in attendees):
            raise GoogleError(400, "You are not a guest of this event.")
        for attendee in attendees:
            if attendee.get("self"):
                attendee["responseStatus"] = REPLIES[reply]
        # The organiser hears about a reply, as when it is given in Google Calendar.
        event = self.call(slot, "PATCH", path, {"sendUpdates": "all"}, {"attendees": attendees})
        self._drop_windows(slot, calendar["id"])
        return shape_event(event, ref, calendar)
