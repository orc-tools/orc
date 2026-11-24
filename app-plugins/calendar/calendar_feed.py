"""Parse iCal (.ics) feeds and expand their events into occurrences for a time window."""

from __future__ import annotations

import calendar as _calendar
import html
import re
from datetime import date, datetime, time, timedelta, timezone
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

UTC = timezone.utc
MAX_STEPS = 50_000
DESCRIPTION_LIMIT = 4000

WEEKDAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
FREQUENCIES = ("DAILY", "WEEKLY", "MONTHLY", "YEARLY")

# Outlook and Exchange export Windows zone names that zoneinfo does not know.
WINDOWS_ZONES = {
    "GMT Standard Time": "Europe/London",
    "Greenwich Standard Time": "Atlantic/Reykjavik",
    "W. Europe Standard Time": "Europe/Berlin",
    "Central European Standard Time": "Europe/Berlin",
    "Central Europe Standard Time": "Europe/Budapest",
    "Romance Standard Time": "Europe/Paris",
    "E. Europe Standard Time": "Europe/Chisinau",
    "FLE Standard Time": "Europe/Kiev",
    "GTB Standard Time": "Europe/Bucharest",
    "Pacific Standard Time": "America/Los_Angeles",
    "Mountain Standard Time": "America/Denver",
    "US Mountain Standard Time": "America/Phoenix",
    "Central Standard Time": "America/Chicago",
    "Eastern Standard Time": "America/New_York",
    "Atlantic Standard Time": "America/Halifax",
    "AUS Eastern Standard Time": "Australia/Sydney",
    "India Standard Time": "Asia/Kolkata",
    "Tokyo Standard Time": "Asia/Tokyo",
    "China Standard Time": "Asia/Shanghai",
    "Singapore Standard Time": "Asia/Singapore",
    "UTC": "UTC",
    "Coordinated Universal Time": "UTC",
}

JOIN_HOSTS = (
    "meet.google.com",
    "zoom.us",
    "teams.microsoft.com",
    "teams.live.com",
    "whereby.com",
    "around.co",
    "webex.com",
)

_DATE_TIME = re.compile(r"(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$")
_DURATION = re.compile(
    r"([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$"
)
_BYDAY = re.compile(r"([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$")
_ESCAPE = re.compile(r"\\([nN\\,;:])")
_URL = re.compile(r"https?://[^\s<>\"'()\[\]{}]+", re.I)
_HTML = re.compile(r"<(?:br|p|div|a|b|i|u|span|ul|ol|li|strong|em|html|body)\b[^>]*>|</[a-z]+>", re.I)
_UNSAFE_ID = re.compile(r"[^A-Za-z0-9_-]")
_GOOGLE_RULE = "-::~:~::~"


class FeedError(ValueError):
    """The text is not an iCal VCALENDAR."""


class Calendar:
    __slots__ = ("name", "_series")

    def __init__(self, name, series):
        self.name = name
        self._series = series


class _Prop:
    __slots__ = ("name", "params", "value")

    def __init__(self, name, params, value):
        self.name = name
        self.params = params
        self.value = value


class _Component:
    __slots__ = ("name", "props", "children")

    def __init__(self, name):
        self.name = name
        self.props = []
        self.children = []

    def first(self, name):
        for prop in self.props:
            if prop.name == name:
                return prop
        return None

    def every(self, name):
        return [prop for prop in self.props if prop.name == name]


class _Rule:
    __slots__ = ("freq", "interval", "count", "until", "byday", "bymonthday", "bymonth", "bysetpos", "wkst")


class _Event:
    __slots__ = (
        "uid", "recurrence", "sequence", "status", "all_day", "wall", "zone", "start", "span",
        "rule", "exkeys", "exdays", "rdates", "title", "fields", "earliest", "latest",
    )


def parse(text: str) -> Calendar:
    if not isinstance(text, str) or not re.search(r"^BEGIN:VCALENDAR[ \t]*\r?$", text, re.I | re.M):
        raise FeedError("not an iCal feed: no BEGIN:VCALENDAR")
    calendars = [c for c in _components(_content_lines(text)) if c.name == "VCALENDAR"]
    if not calendars:
        raise FeedError("not an iCal feed: no VCALENDAR component")

    name = None
    aliases = {}
    vevents = []
    for vcal in calendars:
        prop = vcal.first("X-WR-CALNAME")
        if name is None and prop is not None:
            name = _unescape(prop.value).strip() or None
        for child in vcal.children:
            if child.name == "VTIMEZONE":
                tzid, location = child.first("TZID"), child.first("X-LIC-LOCATION")
                if tzid is not None and location is not None:
                    aliases[tzid.value.strip()] = location.value.strip()
            elif child.name == "VEVENT":
                vevents.append(child)

    zones = _Zones(aliases)
    owner = name.lower() if name and "@" in name else None
    groups = {}
    for index, component in enumerate(vevents):
        event = _build_event(component, zones, owner, index)
        if event is None:
            continue
        group = groups.setdefault(event.uid, [None, {}])
        if event.recurrence is not None:
            previous = group[1].get(event.recurrence)
            if previous is None or event.sequence >= previous.sequence:
                group[1][event.recurrence] = event
        elif group[0] is None or event.sequence >= group[0].sequence:
            group[0] = event
    return Calendar(name, [(master, overrides) for master, overrides in groups.values()])


def events_between(calendar: Calendar, start: datetime, end: datetime) -> list[dict]:
    start, end = _aware(start), _aware(end)
    if end <= start:
        return []
    out = []
    for master, overrides in calendar._series:
        if master is not None and master.earliest < end and (master.latest is None or master.latest >= start):
            for instant in _occurrences(master, start, end):
                key = _key(instant)
                if key not in overrides:
                    _emit(out, master, instant, key)
        for key, override in overrides.items():
            if _overlaps(override.start, override.span, start, end):
                _emit(out, override, override.start, key)
    out.sort(key=lambda item: (not item["allDay"], item["start"], item["title"], item["id"]))
    return out


# --- content lines -----------------------------------------------------------


def _content_lines(text):
    lines = []
    for raw in re.split(r"\r\n|\n|\r", text.lstrip("﻿")):
        if raw[:1] in (" ", "\t"):
            if lines:
                lines[-1].append(raw[1:])
        elif raw:
            lines.append([raw])
    return ["".join(parts) for parts in lines]


def _parse_line(line):
    n = len(line)
    i = 0
    while i < n and line[i] not in ";:":
        i += 1
    name = line[:i].strip().upper()
    params = {}
    while i < n and line[i] == ";":
        i += 1
        j = i
        while j < n and line[j] not in "=;:":
            j += 1
        pname = line[i:j].strip().upper()
        values = []
        if j < n and line[j] == "=":
            j += 1
            while True:
                if j < n and line[j] == '"':
                    close = line.find('"', j + 1)
                    if close < 0:
                        close = n
                    values.append(line[j + 1 : close])
                    j = close + 1
                    while j < n and line[j] not in ",;:":
                        j += 1
                else:
                    k = j
                    while k < n and line[k] not in ",;:":
                        k += 1
                    values.append(line[j:k])
                    j = k
                if j < n and line[j] == ",":
                    j += 1
                    continue
                break
        if pname:
            params[pname] = ",".join(values)
        i = j
    if not name or i >= n or line[i] != ":":
        return None
    return _Prop(name, params, line[i + 1 :])


def _components(lines):
    roots = []
    stack = []
    for line in lines:
        prop = _parse_line(line)
        if prop is None:
            continue
        if prop.name == "BEGIN":
            component = _Component(prop.value.strip().upper())
            (stack[-1].children if stack else roots).append(component)
            stack.append(component)
        elif prop.name == "END":
            name = prop.value.strip().upper()
            for depth in range(len(stack) - 1, -1, -1):
                if stack[depth].name == name:
                    del stack[depth:]
                    break
        elif stack:
            stack[-1].props.append(prop)
    return roots


# --- values ------------------------------------------------------------------


class _Zones:
    def __init__(self, aliases):
        self._aliases = aliases
        self._cache = {}

    def get(self, tzid):
        tzid = tzid.strip().strip('"')
        if tzid not in self._cache:
            parts = [p for p in tzid.split("/") if p]
            candidates = [tzid, self._aliases.get(tzid), WINDOWS_ZONES.get(tzid)]
            # Mozilla-style ids embed the Olson name as a path suffix.
            candidates += ["/".join(parts[-size:]) for size in (3, 2) if len(parts) > size]
            self._cache[tzid] = next(filter(None, map(_zone, candidates)), UTC)
        return self._cache[tzid]


def _zone(key):
    if not key:
        return None
    try:
        return ZoneInfo(key)
    except Exception:
        return None


def _time_of(prop, zones, value=None):
    """Return (wall, zone): a date, or a naive wall-clock datetime with its zone (None = floating)."""
    match = _DATE_TIME.match((prop.value if value is None else value).strip().upper())
    if not match:
        return None
    y, mo, d, hh, mm, ss, z = match.groups()
    try:
        if hh is None:
            return date(int(y), int(mo), int(d)), None
        wall = datetime(int(y), int(mo), int(d), int(hh), int(mm), min(int(ss or 0), 59))
    except ValueError:
        return None
    if z:
        return wall, UTC
    tzid = prop.params.get("TZID")
    return wall, (zones.get(tzid) if tzid else None)


def _to_utc(wall, zone):
    if not isinstance(wall, datetime):
        return _local_midnight(wall)
    if zone is None:
        return wall.astimezone(UTC)
    return wall.replace(tzinfo=zone).astimezone(UTC)


def _local_midnight(day):
    return datetime(day.year, day.month, day.day).astimezone(UTC)


def _aware(moment):
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def _parse_duration(value):
    match = _DURATION.match(value.strip().upper())
    if not match:
        return None
    sign, weeks, days, hours, minutes, seconds = match.groups()
    delta = timedelta(
        weeks=int(weeks or 0), days=int(days or 0), hours=int(hours or 0),
        minutes=int(minutes or 0), seconds=int(seconds or 0),
    )
    return -delta if sign == "-" else delta


def _unescape(value):
    return _ESCAPE.sub(lambda m: "\n" if m.group(1) in "nN" else m.group(1), value)


def _key(instant):
    if isinstance(instant, datetime):
        return instant.strftime("%Y%m%dT%H%M%SZ")
    return instant.strftime("%Y%m%d")


# --- events ------------------------------------------------------------------


def _build_event(component, zones, owner, index):
    dtstart = component.first("DTSTART")
    parsed = _time_of(dtstart, zones) if dtstart is not None else None
    if parsed is None:
        return None
    event = _Event()
    event.wall, event.zone = parsed
    event.all_day = not isinstance(event.wall, datetime)
    event.start = event.wall if event.all_day else _to_utc(event.wall, event.zone)
    event.span = _span(component, event, zones)

    uid = component.first("UID")
    event.uid = (uid.value.strip() if uid is not None else "") or f"event-{index}"
    recurrence = component.first("RECURRENCE-ID")
    rid = _time_of(recurrence, zones) if recurrence is not None else None
    event.recurrence = _key(_instant(rid, event)) if rid is not None else None
    sequence = component.first("SEQUENCE")
    try:
        event.sequence = int(sequence.value) if sequence is not None else 0
    except ValueError:
        event.sequence = 0
    status = component.first("STATUS")
    event.status = status.value.strip().upper() if status is not None else ""

    rrule = component.first("RRULE")
    event.rule = _parse_rule(rrule.value, event) if rrule is not None and event.recurrence is None else None
    event.exkeys, event.exdays = set(), set()
    for prop in component.every("EXDATE"):
        for value in prop.value.split(","):
            item = _time_of(prop, zones, value)
            if item is None:
                continue
            if isinstance(item[0], datetime):
                event.exkeys.add(_key(_to_utc(*item)))
            else:
                event.exdays.add(item[0])
                event.exkeys.add(_key(item[0]))
    event.rdates = []
    for prop in component.every("RDATE"):
        for value in prop.value.split(","):
            item = _time_of(prop, zones, value.split("/")[0])
            if item is not None:
                event.rdates.append(_instant(item, event))

    event.title, event.fields = _fields(component, owner)
    _bound(event)
    return event


def _instant(item, event):
    wall, zone = item
    if event.all_day:
        return wall.date() if isinstance(wall, datetime) else wall
    if not isinstance(wall, datetime):
        return _to_utc(datetime.combine(wall, event.wall.time()), event.zone)
    return _to_utc(wall, zone)


def _span(component, event, zones):
    dtend = component.first("DTEND")
    parsed = _time_of(dtend, zones) if dtend is not None else None
    if parsed is not None:
        wall, zone = parsed
        if event.all_day:
            days = ((wall.date() if isinstance(wall, datetime) else wall) - event.wall).days
            return timedelta(days=max(days, 1))
        if not isinstance(wall, datetime):
            wall, zone = datetime.combine(wall, time()), event.zone
        return max(_to_utc(wall, zone) - event.start, timedelta(0))
    duration = component.first("DURATION")
    delta = _parse_duration(duration.value) if duration is not None else None
    if delta is not None:
        if event.all_day:
            return timedelta(days=max(delta.days, 1))
        return max(delta, timedelta(0))
    return timedelta(days=1) if event.all_day else timedelta(0)


def _parse_rule(value, event):
    parts = {}
    for chunk in value.split(";"):
        name, _, setting = chunk.partition("=")
        parts[name.strip().upper()] = setting.strip().upper()
    if parts.get("FREQ") not in FREQUENCIES:
        return None

    def numbers(name):
        out = []
        for item in parts.get(name, "").split(","):
            try:
                out.append(int(item))
            except ValueError:
                pass
        return [n for n in out if n]

    rule = _Rule()
    rule.freq = parts["FREQ"]
    rule.interval = max(1, (numbers("INTERVAL") or [1])[0])
    count = numbers("COUNT")
    rule.count = max(1, count[0]) if count else None
    rule.until = None
    if parts.get("UNTIL"):
        match = _DATE_TIME.match(parts["UNTIL"])
        try:
            if match and match.group(4) is None:
                rule.until = date(*map(int, match.groups()[:3]))
            elif match:
                y, mo, d, hh, mm, ss, z = match.groups()
                wall = datetime(int(y), int(mo), int(d), int(hh), int(mm), min(int(ss or 0), 59))
                rule.until = wall.replace(tzinfo=UTC) if z else _to_utc(wall, event.zone)
        except ValueError:
            rule.until = None
    rule.byday = []
    for item in parts.get("BYDAY", "").split(","):
        match = _BYDAY.match(item.strip())
        if match:
            ordinal = int(match.group(1)) if match.group(1) else None
            rule.byday.append((ordinal or None, WEEKDAYS[match.group(2)]))
    rule.bymonthday = [n for n in numbers("BYMONTHDAY") if -31 <= n <= 31]
    rule.bymonth = sorted({n for n in numbers("BYMONTH") if 1 <= n <= 12})
    rule.bysetpos = numbers("BYSETPOS")
    rule.wkst = WEEKDAYS.get(parts.get("WKST", "MO"), 0)
    return rule


def _bound(event):
    """Precompute the UTC range a series can touch, so events_between skips it cheaply."""
    starts = [event.start, *event.rdates]
    event.earliest = min(_bounds(s, event.span)[0] for s in starts)
    rule = event.rule
    if rule is None:
        event.latest = max(_bounds(s, event.span)[1] for s in starts)
    elif rule.until is None:
        event.latest = None
    else:
        if isinstance(rule.until, datetime) and not event.all_day:
            last = rule.until
        else:
            last_day = rule.until.date() if isinstance(rule.until, datetime) else rule.until
            last = _local_midnight(last_day + timedelta(days=1))
        # A day of slack covers wall-clock vs UTC drift at the UNTIL boundary.
        last = last + event.span + timedelta(days=1)
        event.latest = max([last, *(_bounds(s, event.span)[1] for s in event.rdates)])


def _fields(component, owner):
    def text(name):
        prop = component.first(name)
        value = _unescape(prop.value).strip() if prop is not None else ""
        return value or None

    title = text("SUMMARY") or "(no title)"
    location = text("LOCATION")
    raw_description = text("DESCRIPTION")
    conference = component.first("X-GOOGLE-CONFERENCE")

    organizer = None
    prop = component.first("ORGANIZER")
    if prop is not None:
        organizer = prop.params.get("CN", "").strip() or _strip_mailto(prop.value) or None

    attendees = component.every("ATTENDEE")
    response = None
    if owner:
        for attendee in attendees:
            email = _strip_mailto(attendee.params.get("EMAIL") or attendee.value)
            if email.lower() == owner:
                response = attendee.params.get("PARTSTAT", "NEEDS-ACTION").strip().lower()
                break

    url = component.first("URL")
    transparency = component.first("TRANSP")
    return title, {
        "location": location,
        "join": join_link(conference.value if conference is not None else None, location, raw_description),
        "description": clean_description(raw_description) if raw_description else None,
        "organizer": organizer,
        "response": response,
        "attendees": len(attendees),
        "url": (url.value.strip() or None) if url is not None else None,
        # "Show as: Free" in Google and Outlook. An event without it keeps you busy.
        "free": transparency is not None and transparency.value.strip().upper() == "TRANSPARENT",
    }


def _strip_mailto(value):
    value = value.strip()
    return value[7:] if value.lower().startswith("mailto:") else value


def _urls(text):
    for match in _URL.finditer(text):
        yield match.group(0).rstrip(".,;:!?")


def join_link(conference, location, description):
    if conference:
        for url in _urls(conference):
            return url
    for text in (location, description):
        if not text:
            continue
        if _HTML.search(text):
            text = html.unescape(text)
        for url in _urls(text):
            host = (urlparse(url).hostname or "").lower()
            if any(host == h or host.endswith("." + h) for h in JOIN_HOSTS):
                return url
    return None


def clean_description(text):
    if _HTML.search(text):
        text = re.sub(r"(?i)<br\s*/?>", "\n", text)
        text = re.sub(r"(?i)</(?:p|div|li|h[1-6]|tr)>", "\n", text)
        text = re.sub(r"<[^>]+>", "", text)
        text = html.unescape(text)
    text = _drop_google_block(text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:DESCRIPTION_LIMIT].rstrip() or None


def _drop_google_block(text):
    # Google wraps its invite boilerplate between two identical "-::~:~::~...::-" lines.
    first = text.find(_GOOGLE_RULE)
    if first < 0:
        return text
    line_end = text.find("\n", first)
    second = text.find(_GOOGLE_RULE, line_end) if line_end >= 0 else -1
    if second < 0:
        return text[:first]
    close = text.find("\n", second)
    return text[:first] + ("" if close < 0 else text[close:])


# --- expansion ---------------------------------------------------------------


def _bounds(instant, span):
    if isinstance(instant, datetime):
        return instant, instant + span
    return _local_midnight(instant), _local_midnight(instant + span)


def _overlaps(instant, span, start, end):
    s, e = _bounds(instant, span)
    if e > s:
        return s < end and e > start
    return start <= s < end


def _emit(out, event, instant, key):
    if event.status == "CANCELLED" or event.fields["response"] == "declined":
        return
    finish = instant + event.span
    if event.all_day:
        first, last = instant.isoformat(), finish.isoformat()
    else:
        first, last = instant.strftime("%Y-%m-%dT%H:%M:%SZ"), finish.strftime("%Y-%m-%dT%H:%M:%SZ")
    out.append({
        "id": _UNSAFE_ID.sub("_", f"{event.uid}_{key}"),
        "uid": event.uid,
        "title": event.title,
        "allDay": event.all_day,
        "start": first,
        "end": last,
        **event.fields,
    })


def _occurrences(event, start, end):
    instants = []
    if event.rule is None:
        instants.append(event.start)
    else:
        from_day, stop_day = _wall_window(event, start, end)
        for instant in _series(event, from_day, stop_day):
            if _bounds(instant, event.span)[0] >= end:
                break
            instants.append(instant)
    instants.extend(event.rdates)
    seen = set()
    for instant in instants:
        key = _key(instant)
        if key in seen or key in event.exkeys or not _overlaps(instant, event.span, start, end):
            continue
        if event.exdays and not event.all_day and _wall_day(event, instant) in event.exdays:
            continue
        seen.add(key)
        yield instant


def _wall_day(event, instant):
    if event.zone is None:
        return instant.astimezone().date()
    return instant.astimezone(event.zone).date()


def _wall_window(event, start, end):
    if event.all_day:
        first, last = start.astimezone().date(), end.astimezone().date()
    else:
        first, last = _wall_day(event, start), _wall_day(event, end)
    return first - timedelta(days=event.span.days + 2), last + timedelta(days=1)


def _series(event, from_day, stop_day):
    """Yield the rule's instants in order: DTSTART first, then each period's matches."""
    yield event.start
    rule = event.rule
    produced = 1
    if rule.count is not None and produced >= rule.count:
        return
    first = event.wall
    d0 = first if event.all_day else first.date()
    clock = None if event.all_day else first.time()
    anchor = d0 - timedelta(days=(d0.weekday() - rule.wkst) % 7) if rule.freq == "WEEKLY" else d0
    # COUNT is relative to DTSTART, so only an uncounted series may jump ahead.
    k = 0 if rule.count is not None else max(0, _period_index(rule, anchor, from_day) - 1)
    for _ in range(MAX_STEPS):
        try:
            period_start, days = _period(rule, anchor, d0, k)
        except (ValueError, OverflowError):
            return
        if period_start > stop_day:
            return
        for day in days:
            wall = day if event.all_day else datetime.combine(day, clock)
            if wall <= first:
                continue
            try:
                instant = wall if event.all_day else _to_utc(wall, event.zone)
            except (ValueError, OverflowError):
                return
            if _past_until(rule.until, wall, instant, event.all_day):
                return
            yield instant
            produced += 1
            if rule.count is not None and produced >= rule.count:
                return
        k += 1


def _past_until(until, wall, instant, all_day):
    if until is None:
        return False
    if isinstance(until, datetime):
        return wall > until.date() if all_day else instant > until
    return (wall if all_day else wall.date()) > until


def _period_index(rule, anchor, target):
    if rule.freq == "DAILY":
        steps = (target - anchor).days
    elif rule.freq == "WEEKLY":
        steps = (target - anchor).days // 7
    elif rule.freq == "MONTHLY":
        steps = (target.year - anchor.year) * 12 + target.month - anchor.month
    else:
        steps = target.year - anchor.year
    return steps // rule.interval


def _period(rule, anchor, d0, k):
    step = k * rule.interval
    if rule.freq == "DAILY":
        day = anchor + timedelta(days=step)
        days = [day] if _day_matches(day, rule) else []
        return day, _setpos(days, rule)
    if rule.freq == "WEEKLY":
        week = anchor + timedelta(weeks=step)
        weekdays = {wd for _, wd in rule.byday} or {d0.weekday()}
        days = [week + timedelta(days=i) for i in range(7)]
        days = [d for d in days if d.weekday() in weekdays and (not rule.bymonth or d.month in rule.bymonth)]
        return week, _setpos(days, rule)
    if rule.freq == "MONTHLY":
        year, month = divmod(anchor.month - 1 + step, 12)
        year, month = anchor.year + year, month + 1
        days = [] if rule.bymonth and month not in rule.bymonth else _month_days(year, month, rule, d0)
        return date(year, month, 1), _setpos(days, rule)
    year = anchor.year + step
    if rule.bymonth:
        months = rule.bymonth
    elif rule.bymonthday:
        months = range(1, 13)
    elif rule.byday:
        return date(year, 1, 1), _setpos(_year_days(year, rule), rule)
    else:
        months = (d0.month,)
    days = [d for month in months for d in _month_days(year, month, rule, d0)]
    return date(year, 1, 1), _setpos(days, rule)


def _day_matches(day, rule):
    if rule.bymonth and day.month not in rule.bymonth:
        return False
    if rule.bymonthday:
        length = _calendar.monthrange(day.year, day.month)[1]
        if not any(day.day == (n if n > 0 else length + n + 1) for n in rule.bymonthday):
            return False
    if rule.byday and day.weekday() not in {wd for _, wd in rule.byday}:
        return False
    return True


def _pick(matches, ordinal, into):
    if ordinal is None:
        into.update(matches)
        return
    index = ordinal - 1 if ordinal > 0 else ordinal
    if -len(matches) <= index < len(matches):
        into.add(matches[index])


def _month_days(year, month, rule, d0):
    length = _calendar.monthrange(year, month)[1]
    picked = None
    if rule.bymonthday:
        picked = {n if n > 0 else length + n + 1 for n in rule.bymonthday}
        picked = {n for n in picked if 1 <= n <= length}
    if rule.byday:
        first_weekday = date(year, month, 1).weekday()
        by = set()
        for ordinal, wd in rule.byday:
            _pick(list(range(1 + (wd - first_weekday) % 7, length + 1, 7)), ordinal, by)
        picked = by if picked is None else picked & by
    if picked is None:
        # Months without DTSTART's day (e.g. the 31st) are skipped, per RFC 5545.
        picked = {d0.day} if d0.day <= length else set()
    return [date(year, month, n) for n in sorted(picked)]


def _year_days(year, rule):
    jan1 = date(year, 1, 1)
    length = 366 if _calendar.isleap(year) else 365
    by = set()
    for ordinal, wd in rule.byday:
        _pick(list(range(1 + (wd - jan1.weekday()) % 7, length + 1, 7)), ordinal, by)
    return [jan1 + timedelta(days=n - 1) for n in sorted(by)]


def _setpos(days, rule):
    if not rule.bysetpos:
        return days
    size = len(days)
    chosen = {days[p - 1 if p > 0 else size + p] for p in rule.bysetpos if -size <= (p - 1 if p > 0 else p) < size}
    return sorted(chosen)
