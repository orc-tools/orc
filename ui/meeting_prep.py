"""Prep runs for calendar meetings: the meeting Calendar sends with a launch,
checked before any of it reaches a run, and what the run's stub records.

Anyone who can send an invite writes its title and description. The server
words the prompt: it shows the meeting so the run reads as an ordinary
conversation about it, with the invite's own text quoted and labelled as from
the invite, and the whole meeting reaches the agent as data in
``inputs/meeting.json``. The answered run keeps ``source`` and ``sourceRef``
(``run_relationships.QUESTION_META_KEYS``), which is how Calendar finds a
meeting's flashcard again, and its ``route``
(``run_relationships.ANSWER_ROUTES``), which is how Orc shows it as a
flashcard."""
from datetime import datetime, timedelta, timezone
import re
from zoneinfo import ZoneInfo

ROUTE = "meeting-prep"
SOURCE = "calendar"
BRIEF = "inputs/meeting.json"
ASK = "Make me a flashcard to prep for this meeting."
# The invite as the prompt quotes it; inputs/meeting.json keeps all of it.
INVITE_CHARS = 600
INVITE_LABEL = "From the invite:"
# What the user typed beside the meeting in New conversation: their own ask,
# quoted under its own label so it can never pass for the invite or a field.
NOTE_LABEL = "From you:"
NOTE_CHARS = 4000

TEXT_LIMITS = {"key": 512, "title": 300, "organizer": 300, "location": 500,
               "calendar": 200, "description": 8000}
URL_LIMIT = 2000
FIELDS = frozenset(TEXT_LIMITS) | {"start", "end", "allDay", "attendees", "url", "timeZone"}
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
DAY = re.compile(r"\d{4}-\d{2}-\d{2}\Z")
TIME_ZONE = re.compile(r"[A-Za-z][A-Za-z0-9_+\-/]{0,63}\Z")


def _text(record, name, required=False):
    value = record.get(name)
    if value is None or value == "":
        if required:
            raise ValueError("meetingPrep.%s is required" % name)
        return None
    if not isinstance(value, str):
        raise ValueError("meetingPrep.%s must be text" % name)
    if name == "description":
        value = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    elif name != "key":
        # The key comes back as the run's sourceRef, so it must stay byte for byte.
        value = " ".join(value.split())
    if len(value) > TEXT_LIMITS[name]:
        raise ValueError("meetingPrep.%s is longer than %d characters" % (name, TEXT_LIMITS[name]))
    if CONTROL.search(value) or (name != "description" and "\n" in value):
        raise ValueError("meetingPrep.%s contains control characters" % name)
    if not value.strip():
        if required:
            raise ValueError("meetingPrep.%s is required" % name)
        return None
    return value


def _when(record, name, all_day):
    value = record.get(name)
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError("meetingPrep.%s must be a date or time" % name)
    if all_day:
        if not DAY.match(value):
            raise ValueError("meetingPrep.%s must be a date for an all-day meeting" % name)
        try:
            return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
        except ValueError:
            raise ValueError("meetingPrep.%s must be a date for an all-day meeting" % name) from None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("meetingPrep.%s must be a time with its offset" % name) from None
    if moment.tzinfo is None:
        raise ValueError("meetingPrep.%s must be a time with its offset" % name)
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse(value):
    """The meeting as a run stores it, or ValueError naming the first bad field."""
    if not isinstance(value, dict):
        raise ValueError("meetingPrep must be an object")
    unknown = sorted(set(value) - FIELDS)
    if unknown:
        raise ValueError("meetingPrep has unknown fields: " + ", ".join(unknown))
    all_day = value.get("allDay", False)
    if not isinstance(all_day, bool):
        raise ValueError("meetingPrep.allDay must be true or false")
    record = {name: _text(value, name, required=name in ("key", "title")) for name in TEXT_LIMITS}
    record["allDay"] = all_day
    record["start"] = _when(value, "start", all_day)
    record["end"] = _when(value, "end", all_day)
    if record["end"] < record["start"]:
        raise ValueError("meetingPrep.end is before its start")
    attendees = value.get("attendees")
    if attendees is not None and (type(attendees) is not int or not 0 <= attendees <= 100000):
        raise ValueError("meetingPrep.attendees must be a count")
    record["attendees"] = attendees
    url = value.get("url")
    if url is not None and (not isinstance(url, str) or len(url) > URL_LIMIT
                            or not re.match(r"https?://[^\s]+\Z", url)):
        raise ValueError("meetingPrep.url must be a web address")
    record["url"] = url
    zone = value.get("timeZone")
    if zone is not None and (not isinstance(zone, str) or not TIME_ZONE.match(zone)):
        raise ValueError("meetingPrep.timeZone must be a time zone name")
    record["timeZone"] = zone
    return record


def stub_fields(record):
    """The run identity a prep stub carries; the caller words its title."""
    fields = {"route": ROUTE, "source": SOURCE, "sourceRef": record["key"]}
    if record.get("url"):
        fields["sourceUrl"] = record["url"]
    return fields


def brief(record):
    """``inputs/meeting.json``: what the agent reads about the meeting."""
    meeting = {name: value for name, value in record.items()
               if name != "key" and value is not None}
    return {"schemaVersion": 1, "untrusted": True, "meeting": meeting}


def _zone(record):
    try:
        return ZoneInfo(record["timeZone"]) if record.get("timeZone") else None
    except (KeyError, ValueError):
        return None


def when_text(record):
    """``Tue 24 Nov, 10:30 to 11:00`` in the user's zone, or the days of an
    all-day meeting (its end date is the day after it ends)."""
    if record["allDay"]:
        first = datetime.strptime(record["start"], "%Y-%m-%d")
        last = datetime.strptime(record["end"], "%Y-%m-%d") - timedelta(days=1)
        day = lambda moment: moment.strftime("%a ") + str(moment.day) + moment.strftime(" %b")
        return day(first) if last <= first else "%s to %s" % (day(first), day(last))
    zone = _zone(record)
    start, end = (datetime.strptime(record[name], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                  for name in ("start", "end"))
    if zone:
        start, end = start.astimezone(zone), end.astimezone(zone)
    text = "%s %d %s, %s to %s" % (start.strftime("%a"), start.day, start.strftime("%b"),
                                   start.strftime("%H:%M"), end.strftime("%H:%M"))
    return text if zone else text + " UTC"


def note(value):
    """The user's note from the composer, tidied, or ValueError."""
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValueError("a meeting note must be text")
    value = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if len(value) > NOTE_CHARS:
        raise ValueError("a meeting note is longer than %d characters" % NOTE_CHARS)
    if CONTROL.search(value.replace("\t", " ")):
        raise ValueError("a meeting note contains control characters")
    return value


def _quoted(label, text):
    return ["", label] + [("> " + line.rstrip()).rstrip() for line in text.split("\n")]


def prompt(record, extra=""):
    """The run's first message: the ask, the meeting, what the user added in
    the composer (``extra``), and the invite, each quoted under its label.
    Chat shows a user's text as typed, so this is plain text; Chat lays a
    flashcard run's first message out as the meeting (run-presentation.js)."""
    rows = [("Meeting", record["title"]), ("When", when_text(record))]
    if record.get("organizer"):
        rows.append(("Organizer", record["organizer"]))
    if record.get("attendees") is not None:
        rows.append(("Guests", str(record["attendees"])))
    lines = [ASK, ""] + ["%s: %s" % row for row in rows]
    if extra:
        lines += _quoted(NOTE_LABEL, extra)
    invite = record.get("description") or ""
    if invite:
        if len(invite) > INVITE_CHARS:
            invite = invite[:INVITE_CHARS].rstrip() + "…"
        lines += _quoted(INVITE_LABEL, "\n".join(line.strip() for line in invite.split("\n")))
    return "\n".join(lines)
