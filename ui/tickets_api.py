"""Ticket routes, markdown storage, and idempotent create receipts."""
import contextlib
import fcntl
import json
import math
import os
import re
import sys
import tempfile
import time
import uuid
from urllib.parse import parse_qs



# Ordered: this is also the order the tickets view groups them in.
TICKET_STATUSES = ("backlog", "todo", "in-progress", "done", "cancelled")
TICKET_OPEN_STATUSES = ("backlog", "todo", "in-progress")
TICKET_ID_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
# A ticket's id *is* its identifier: `tkt-1` on disk and in the URL, `TKT-1`
# everywhere it is read. A ticket is plain text with no project, so every new
# one takes the same prefix and the next number after the highest on disk.
# Older tickets filed under a per-project prefix (`orc-12`) keep their ids.
TICKET_KEY_RE = re.compile(r"([a-z][a-z0-9]{1,5})-([1-9][0-9]*)")
TICKET_PREFIX = "TKT"
TICKET_IMAGES_MAX = 20
# Frontmatter is written by us and parsed by us, so it stays a flat block of
# `key: value` lines plus one JSON-encoded list. That avoids a YAML dependency
# serve.py has never had, and rejects anything it did not write rather than
# guessing at it.
TICKET_SCALARS = ("id", "title", "status", "created", "updated",
                  "launchedPane", "rank")
# Frontmatter keys older versions wrote and this one no longer keeps. A ticket
# used to belong to a project and could carry composer settings; each line is
# read past and dropped on the next save, so no file on disk needs migrating.
TICKET_RETIRED_KEYS = ("project", "launch")
# `rank` is the one scalar that is a number rather than free text: written as
# a plain float string (`5.0`) and parsed back into a number by read_ticket,
# so a board drag orders columns without a second, separately-typed store.
# Keep `title` readable so saved tickets are not reported as broken.
TICKET_REQUIRED = ("id", "status", "created", "updated")
# A sticky note's place on project home, written as one JSON line once it has
# been placed. `x` is the share of the board's free width (0 left, 1 right), so
# a layout survives a resized window; `y`, `w` and `h` are pixels and `z` is
# its place in the stack. The optional `c` picks its colour and tilt, chosen
# when the note is made so it does not change look once saved.
TICKET_NOTE_KEYS = ("x", "y", "w", "h", "z")
TICKET_NOTE_BOUNDS = {"x": (0, 1), "y": (0, 100000), "w": (120, 1200),
                      "h": (90, 1200), "z": (0, 1000000), "c": (0, 999)}


def ticket_note(value):
    """A note placement clamped into its bounds, or None when it is not one."""
    if not isinstance(value, dict) \
            or set(value) - {"c"} != set(TICKET_NOTE_KEYS):
        return None
    note = {}
    for key in TICKET_NOTE_KEYS + (("c",) if "c" in value else ()):
        number = value[key]
        if isinstance(number, bool) or not isinstance(number, (int, float)) \
                or not math.isfinite(number):
            return None
        low, high = TICKET_NOTE_BOUNDS[key]
        number = min(high, max(low, number))
        note[key] = round(number, 4) if key == "x" else int(round(number))
    return note


def ticket_now():
    """UTC, so a ticket written either side of a clock change still sorts right."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def ticket_key(ticket_id):
    """How an id reads: `orc-1` is written down, `ORC-1` is what you call it."""
    return (ticket_id or "").upper()


def parse_ticket(text, image_path):
    """`(meta, body)` from a ticket file, or `(None, None)` when it is not one.

    Malformed frontmatter is a rejection, not a repair: a half-parsed ticket
    that silently loses its status is worse than one that refuses to load and
    says so. A retired key is the one exception: it is known, and dropped.
    """
    if not isinstance(text, str) or not text.startswith("---\n"):
        return None, None
    end = text.find("\n---", 3)
    if end == -1:
        return None, None
    block = text[4:end + 1]
    # `end` sits on the newline before the closing `---`, so the body starts
    # after that delimiter and the single newline that ends its line. Exactly
    # one newline, matching exactly what format_ticket writes, so a body that
    # deliberately opens with a blank line keeps it.
    body = text[end + 4:]
    if body.startswith("\n"):
        body = body[1:]
    elif body:
        return None, None
    meta = {}
    for line in block.splitlines():
        if not line.strip():
            continue
        key, separator, value = line.partition(":")
        key, value = key.strip(), value.strip()
        if not separator or not key:
            return None, None
        if key in TICKET_SCALARS:
            meta[key] = value
        elif key in TICKET_RETIRED_KEYS:
            continue
        elif key == "runIds":
            try:
                parsed = json.loads(value or "[]")
            except ValueError:
                return None, None
            if not isinstance(parsed, list) or any(
                    not isinstance(item, str) for item in parsed):
                return None, None
            meta["runIds"] = parsed
        elif key == "images":
            try:
                parsed = json.loads(value or "[]")
            except ValueError:
                return None, None
            if not isinstance(parsed, list) or any(
                    image_path(item) is None for item in parsed):
                return None, None
            if parsed:
                meta["images"] = parsed
        elif key == "note":
            # Losing a placement costs a re-placement, so a damaged one is
            # dropped rather than refusing the ticket and hiding its text.
            try:
                note = ticket_note(json.loads(value))
            except ValueError:
                note = None
            if note:
                meta["note"] = note
        else:
            return None, None
    if not meta.get("id") or meta.get("status") not in TICKET_STATUSES:
        return None, None
    meta.setdefault("runIds", [])
    return meta, body


def format_ticket(meta, body):
    lines = ["---"]
    for key in (key for key in TICKET_SCALARS if key != "title"):
        value = meta.get(key, "")
        # A newline or a stray `---` in a value would forge a second document.
        value = re.sub(r"\s+", " ", str(value)).strip()
        # An empty optional key is written as absent, so reading a ticket back
        # returns what was written rather than a dictionary grown by one blank
        # field per optional column.
        if value or key in TICKET_REQUIRED:
            lines.append("%s: %s" % (key, value))
    lines.append("runIds: " + json.dumps(list(meta.get("runIds") or [])))
    if meta.get("images"):
        lines.append("images: " + json.dumps(list(meta["images"])))
    note = ticket_note(meta.get("note"))
    if note:
        lines.append("note: " + json.dumps(note))
    lines.append("---")
    text = "\n".join(lines) + "\n" + (body or "")
    return text if text.endswith("\n") else text + "\n"


def ticket_excerpt(body):
    """One plain line saying what a ticket is about, or "" when it says nothing.

    The list already costs a full parse of every body, so the line the reader
    wants is free here and would otherwise mean shipping whole bodies to the
    browser. Headings are skipped because "## Background" describes the shape
    of the ticket, not the ticket.
    """
    for line in (body or "").splitlines():
        line = line.strip()
        # Fences and their contents are not prose; the first fence ends the
        # search rather than leaking ``` or code into the list.
        if line.startswith("```"):
            break
        if not line or line.startswith("#"):
            continue
        # Just enough markdown to read as prose: this is a preview, not a
        # renderer. Only the doubled markers and backticks are unwrapped. A
        # bare * or _ is left alone, because a line is far more likely to hold
        # "2 * 3 and 4 * 5" or foo_bar_baz than one italic word, and pairing
        # the two halves of an unrelated pair eats the text between them.
        line = re.sub(r"^(?:[-*+]|\d+\.|>)\s+", "", line)
        line = re.sub(r"!?\[([^\]]+)\]\([^)]*\)", r"\1", line)
        line = re.sub(r"(\*\*|__|`)(.+?)\1", r"\2", line).strip()
        if not line:
            continue
        if len(line) <= 140:
            return line
        # Cut on a space so the tail is a word, not half of one.
        head = line[:137]
        if " " in head:
            head = head[:head.rfind(" ")]
        return head.rstrip() + "…"
    return ""


class Service:
    def __init__(self, *, root, run_meta, copy_images, read_json, write_json, launch):
        self.root = root
        self.run_meta = run_meta
        self.copy_images = copy_images
        self.read_json = read_json
        self.write_json = write_json
        self.launch = launch

    def ticket_path(self, ticket_id):
        """Absolute path for a ticket id, or None when the id is not one of ours."""
        if not isinstance(ticket_id, str) or not TICKET_ID_RE.fullmatch(ticket_id):
            return None
        # The regex already excludes separators and dots, so this cannot escape
        # TICKETS; the realpath check is the belt to that braces.
        full = os.path.realpath(os.path.join(self.root(), ticket_id + ".md"))
        root = os.path.realpath(self.root())
        return full if full.startswith(root + os.sep) else None

    def ticket_image_dir(self, create=False):
        """Images filed with tickets. Inside TICKETS so they travel with it; the
        listing only reads `*.md`, so the folder is never mistaken for a ticket."""
        base = os.path.join(self.root(), "images")
        if create:
            os.makedirs(base, mode=0o700, exist_ok=True)
        return base

    def ticket_image_path(self, name):
        """One file in the ticket image folder, or None when the name would escape."""
        if not isinstance(name, str) or not name or name != os.path.basename(name) \
                or name.startswith("."):
            return None
        base = os.path.realpath(self.ticket_image_dir())
        full = os.path.join(base, name)
        return full if os.path.realpath(full) == full else None

    def store_ticket_images(self, references):
        """Copy composer uploads into the ticket store. Returns `(names, error)`."""
        return self.copy_images(references, lambda: self.ticket_image_dir(create=True),
                                   TICKET_IMAGES_MAX)

    def ticket_image_references(self, prompt, tickets):
        """The prompt with each ticket's images appended the way the composer
        appends its own uploads, so a run sees them as attachments."""
        for ticket in tickets:
            for name in ticket.get("images") or []:
                line = "[Image attachment: %s]" % os.path.join(self.ticket_image_dir(), name)
                if line in prompt:
                    continue
                prompt += ("\n" if prompt and not prompt.endswith("\n") else "") + line
        return prompt

    def next_ticket_number(self, prefix):
        """One past the highest number this prefix has used, read from the files.

        No counter file: the directory is the record, so a ticket deleted by hand
        is a number handed back rather than a gap the store has to remember.
        """
        highest, wanted = 0, prefix.lower()
        try:
            names = os.listdir(self.root())
        except OSError:
            names = []
        for name in names:
            match = TICKET_KEY_RE.fullmatch(name[:-3]) if name.endswith(".md") else None
            if match and match.group(1) == wanted:
                highest = max(highest, int(match.group(2)))
        return highest + 1

    def new_ticket_id(self, prefix=TICKET_PREFIX):
        prefix = prefix.lower()
        number = self.next_ticket_number(prefix)
        # The number came from the listing, so the first candidate is normally
        # free; the loop is for two tickets filed in the same instant.
        reserved = set()
        receipt_dir = os.path.join(self.root(), ".create-requests")
        if os.path.isdir(receipt_dir):
            for name in os.listdir(receipt_dir):
                if name.endswith(".json"):
                    receipt = self.read_json(os.path.join(receipt_dir, name))
                    if not receipt or not isinstance(receipt.get("ticket"), dict):
                        return None
                    reserved.add(receipt["ticket"].get("id"))
        for reserved_id in reserved:
            match = TICKET_KEY_RE.fullmatch(reserved_id or "")
            if match and match.group(1) == prefix:
                number = max(number, int(match.group(2)) + 1)
        for offset in range(100):
            candidate = "%s-%d" % (prefix, number + offset)
            path = self.ticket_path(candidate)
            if path and candidate not in reserved and not os.path.exists(path):
                return candidate
        return None

    def read_ticket(self, ticket_id):
        path = self.ticket_path(ticket_id)
        if not path or not os.path.isfile(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as handle:
                text = handle.read()
        except OSError:
            return None
        meta, body = parse_ticket(text, self.ticket_image_path)
        if meta is None or meta.get("id") != ticket_id:
            return None
        if "rank" in meta:
            # Frontmatter only holds strings; a board sort needs a number, so it is
            # coerced here rather than in every caller. A value that fails to
            # parse is dropped instead of handed to the client broken.
            try:
                meta["rank"] = float(meta["rank"])
            except ValueError:
                del meta["rank"]
        return dict(meta, body=body)

    def write_ticket(self, ticket):
        """Atomically publish one ticket. Returns False rather than raising."""
        path = self.ticket_path(ticket.get("id"))
        if not path:
            return False
        body = ticket.get("body") or ""
        encoded = format_ticket(ticket, body).encode()
        try:
            os.makedirs(self.root(), mode=0o700, exist_ok=True)
            fd, temporary = tempfile.mkstemp(dir=self.root(), prefix=".ticket-", suffix=".tmp")
            with os.fdopen(fd, "wb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, path)
            return True
        except OSError:
            try:
                os.unlink(temporary)
            except (OSError, UnboundLocalError):
                pass
            return False

    def list_tickets(self):
        """Every readable ticket, newest first. Unreadable files are reported, not hidden."""
        tickets, broken = [], []
        try:
            names = sorted(os.listdir(self.root()))
        except OSError:
            return [], []
        for name in names:
            if name.startswith(".") or not name.endswith(".md"):
                continue
            ticket = self.read_ticket(name[:-3])
            if ticket is None:
                broken.append(name)
            else:
                tickets.append(ticket)
        tickets.sort(key=lambda item: item.get("created") or "", reverse=True)
        return tickets, broken

    def ticket_summary(self, ticket):
        """A ticket without its body, for the list — bodies can be long."""
        summary = {key: ticket[key] for key in TICKET_SCALARS + ("runIds", "note", "images")
                   if key in ticket and key != "title"}
        run_ids = ticket.get("runIds") or []
        if (ticket.get("status") == "in-progress" and run_ids
                and all(self.run_meta(run_id).get("status") in ("merged", "merged-to-parent")
                        for run_id in run_ids)):
            summary["status"] = "done"
        excerpt = ticket_excerpt(ticket.get("body"))
        if excerpt:
            summary["excerpt"] = excerpt
        return summary

    def tickets_listing(self, full=False):
        """The /api/tickets payload. `full` adds bodies, which the sticky notes
        show whole; every other reader only needs the summary line."""
        tickets, broken = self.list_tickets()
        return {
            "tickets": [dict(self.ticket_summary(ticket), body=ticket.get("body") or "")
                        if full else self.ticket_summary(ticket) for ticket in tickets],
            # Reported rather than swallowed: a ticket whose file will not parse is
            # text the user wrote, and the view says so instead of quietly showing
            # a shorter list.
            "unreadable": broken,
            "statuses": list(TICKET_STATUSES),
        }

    def consume_tickets(self, ticket_ids):
        deleted = []
        failed = []
        for ticket_id in ticket_ids:
            path = self.ticket_path(ticket_id)
            try:
                if not path:
                    raise OSError("invalid ticket path")
                os.unlink(path)
            except FileNotFoundError:
                pass
            except OSError as error:
                failed.append(ticket_id)
                print("ticket consumption failed for %s: %s" % (ticket_id, error),
                      file=sys.stderr)
                continue
            deleted.append(ticket_id)
        return {"deletedTickets": deleted, "ticketDeletionFailed": failed}

    def _ticket_fields(self, data, ticket=None):
        """Validate the writable fields. Returns `(patch, error-message)`."""
        patch = {}
        # `project` and `launch` are no longer ticket fields. Older clients and
        # queued offline saves still send them, so they are ignored rather than
        # refused: a 400 here would lose the note they are carrying.
        if "status" in data:
            if data.get("status") not in TICKET_STATUSES:
                return None, "unknown status"
            patch["status"] = data["status"]
        if "body" in data:
            body = data.get("body")
            if not isinstance(body, str):
                return None, "body must be a string"
            patch["body"] = body
        if "rank" in data:
            rank = data.get("rank")
            if rank is None:
                # Clearing stores an empty scalar, which format_ticket writes
                # as no frontmatter line, and the board falls
                # back to sorting this ticket by when it was last touched.
                patch["rank"] = ""
            elif isinstance(rank, bool) or not isinstance(rank, (int, float)) \
                    or not math.isfinite(rank):
                return None, "rank must be a finite number"
            else:
                patch["rank"] = float(rank)
        if "note" in data:
            # Null takes the ticket off the saved layout; the board places it
            # again on its next render.
            note = data.get("note")
            if note is not None:
                note = ticket_note(note)
                if note is None:
                    return None, "note must give x, y, w, h and z as numbers"
            patch["note"] = note
        if "runId" in data and "unlinkRunId" in data:
            return None, "link and unlink cannot be asked for at once"
        if "runId" in data:
            run_id = data.get("runId")
            # An id, not a path: this is written straight into the ticket file
            # and turned into a link in the view.
            if not isinstance(run_id, str) or not run_id or run_id.startswith(".") \
                    or os.sep in run_id:
                return None, "invalid run id"
            existing = list((ticket or {}).get("runIds") or [])
            patch["runIds"] = existing if run_id in existing else existing + [run_id]
            patch["launchedPane"] = ""
        if "unlinkRunId" in data:
            # Undoing a link, so the id only has to match one already stored —
            # an unknown id is a mistake worth saying out loud rather than a
            # silent no-op that reads as a successful removal.
            run_id = data.get("unlinkRunId")
            existing = list((ticket or {}).get("runIds") or [])
            if not isinstance(run_id, str) or run_id not in existing:
                return None, "run is not linked to this ticket"
            patch["runIds"] = [entry for entry in existing if entry != run_id]
        if "addImages" in data or "removeImages" in data:
            if ticket is None:
                return None, "addImages and removeImages apply to an existing ticket"
            existing_images = list(ticket.get("images") or [])
            remove_refs = data.get("removeImages", [])
            add_refs = data.get("addImages", [])
            if not isinstance(remove_refs, list) or not all(isinstance(item, str) for item in remove_refs):
                return None, "removeImages must be a list of image names"
            if not isinstance(add_refs, list) or not all(isinstance(item, str) for item in add_refs):
                return None, "addImages must be a list of attached images"
            for name in remove_refs:
                if name not in existing_images:
                    return None, "image is not on this ticket"
            remove_set = set(remove_refs)
            kept = [name for name in existing_images if name not in remove_set]
            unique_add = list(dict.fromkeys(add_refs))
            if len(kept) + len(unique_add) > TICKET_IMAGES_MAX:
                return None, "a ticket holds at most %d images" % TICKET_IMAGES_MAX
            added = []
            if unique_add:
                added, message = self.store_ticket_images(unique_add)
                if message:
                    return None, message
            if remove_set or added:
                patch["images"] = kept + added
        return patch, None

    def post_ticket_create(self, handler):
        data = handler.read_mutation_body()
        if data is None:
            return
        request_id = data.get("clientRequestId")
        if request_id is not None:
            try:
                if not isinstance(request_id, str) or str(uuid.UUID(request_id)) != request_id:
                    raise ValueError()
            except ValueError:
                return handler.json_error(400, "invalid ticket request id")
        try:
            os.makedirs(self.root(), mode=0o700, exist_ok=True)
            with open(os.path.join(self.root(), ".create.lock"), "a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                receipt_path = (os.path.join(self.root(), ".create-requests", request_id + ".json")
                                if request_id else None)
                if receipt_path and os.path.exists(receipt_path):
                    receipt = self.read_json(receipt_path)
                    if not receipt or not isinstance(receipt.get("ticket"), dict):
                        return handler.json_error(500, "ticket receipt could not be read")
                    # A receipt from before tickets dropped projects may still
                    # name one; it is not part of the ticket any more.
                    ticket = {key: value for key, value in receipt["ticket"].items()
                              if key not in TICKET_RETIRED_KEYS}
                    existing = self.read_ticket(ticket.get("id"))
                    if existing:
                        if not receipt.get("complete") and not self.write_json(
                                receipt_path, {"ticket": ticket, "complete": True}):
                            return handler.json_error(500, "ticket receipt could not be completed; retry is safe")
                        return handler.send_body(json.dumps(existing).encode(), "application/json")
                    if receipt.get("complete"):
                        return handler.json_error(410, "this ticket was deleted after it was saved")
                else:
                    patch, message = self._ticket_fields(data)
                    if message:
                        return handler.json_error(400, message)
                    images = []
                    if "images" in data:
                        images, message = self.store_ticket_images(data.get("images"))
                        if message:
                            return handler.json_error(400, message)
                    ticket_id = self.new_ticket_id()
                    if not ticket_id:
                        return handler.json_error(409, "could not allocate a ticket id")
                    now = ticket_now()
                    ticket = {"id": ticket_id,
                              "status": patch.get("status", "backlog"),
                              "created": now, "updated": now, "runIds": [],
                              "body": patch.get("body", "")}
                    if patch.get("note"):
                        ticket["note"] = patch["note"]
                    if images:
                        ticket["images"] = images
                    # Reserve the exact id before writing, so an interrupted save can resume.
                    if receipt_path and not self.write_json(receipt_path, {"ticket": ticket, "complete": False}):
                        return handler.json_error(500, "ticket receipt could not be written")
                if not self.write_ticket(ticket):
                    return handler.json_error(500, "ticket could not be written")
                if receipt_path and not self.write_json(receipt_path, {"ticket": ticket, "complete": True}):
                    return handler.json_error(500, "ticket receipt could not be completed; retry is safe")
                return handler.send_body(json.dumps(ticket).encode(), "application/json")
        except OSError:
            return handler.json_error(500, "ticket store is unavailable")

    def post_ticket_update(self, handler, ticket_id):
        data = handler.read_mutation_body()
        if data is None:
            return
        ticket = self.read_ticket(ticket_id)
        if ticket is None:
            return handler.json_error(404, "ticket not found", False)
        before_images = list(ticket.get("images") or [])
        patch, message = self._ticket_fields(data, ticket)
        if message:
            return handler.json_error(400, message)
        if not patch:
            return handler.json_error(400, "nothing to update")
        ticket.update(patch)
        if not ticket.get("images"):
            ticket.pop("images", None)
        ticket["updated"] = ticket_now()
        after_images = list(ticket.get("images") or [])
        added_images = [name for name in after_images if name not in before_images]
        removed_images = [name for name in before_images if name not in after_images]
        # An id never changes: it is a URL someone may have written down.
        if not self.write_ticket(ticket):
            for name in added_images:
                with contextlib.suppress(OSError, TypeError):
                    os.unlink(self.ticket_image_path(name))
            return handler.json_error(500, "ticket could not be written")
        if removed_images:
            still_referenced = {
                name for other in self.list_tickets()[0]
                if other["id"] != ticket["id"]
                for name in (other.get("images") or [])
            }
            for name in removed_images:
                if name not in still_referenced:
                    with contextlib.suppress(OSError, TypeError):
                        os.unlink(self.ticket_image_path(name))
        return handler.send_body(json.dumps(ticket).encode(), "application/json")

    def post_ticket_delete(self, handler, ticket_id):
        data = handler.read_mutation_body(limit=1024)
        if data is None:
            return
        path = self.ticket_path(ticket_id)
        if not path or not os.path.isfile(path):
            return handler.json_error(404, "ticket not found", False)
        images = (self.read_ticket(ticket_id) or {}).get("images") or []
        try:
            os.unlink(path)
        except OSError:
            return handler.json_error(500, "ticket could not be deleted")
        for name in images:
            with contextlib.suppress(OSError, TypeError):
                os.unlink(self.ticket_image_path(name))
        return handler.send_body(b'{"ok": true}', "application/json")

    def post_ticket_run(self, handler, ticket_id):
        data = handler.read_mutation_body(limit=64 * 1024)
        if data is None:
            return
        ticket = self.read_ticket(ticket_id)
        if ticket is None:
            return handler.json_error(404, "ticket not found", False)
        result, error = self.launch(data, ticket)
        if error:
            return handler.json_error(*error)
        consumption = self.consume_tickets([ticket_id])
        return handler.send_body(
            json.dumps(dict(result or {}, **consumption)).encode(),
            "application/json")

    def get(self, handler, path):
        if path.startswith("/api/ticket-images/"):
            full = self.ticket_image_path(path[len("/api/ticket-images/"):])
            if full and os.path.isfile(full):
                handler.send_file(full)
            else:
                handler.send_error(404)
        elif path == "/api/tickets":
            query = parse_qs(handler.path.partition("?")[2])
            full = query.get("full", [""])[0] == "1"
            handler.send_body(json.dumps(self.tickets_listing(full=full)).encode(), "application/json")
        elif path.startswith("/api/tickets/"):
            ticket = self.read_ticket(path[len("/api/tickets/"):])
            if ticket is None:
                handler.json_error(404, "ticket not found", False)
            else:
                handler.send_body(json.dumps(ticket).encode(), "application/json")
        else:
            return False
        return True

    def post(self, handler, path):
        if path == "/api/tickets":
            self.post_ticket_create(handler)
        elif path.startswith("/api/tickets/"):
            ticket_id, _, action = path[len("/api/tickets/"):].partition("/")
            if action == "delete":
                self.post_ticket_delete(handler, ticket_id)
            elif action == "run":
                self.post_ticket_run(handler, ticket_id)
            elif action:
                handler.send_error(404)
            else:
                self.post_ticket_update(handler, ticket_id)
        else:
            return False
        return True
