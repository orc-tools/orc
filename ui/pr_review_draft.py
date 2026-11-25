"""Your review of a colleague's PR, drafted in Orc and posted as one GitHub review.

A flag-mode `/orc-review` of someone else's PR (skills/orc-review,
"Drafted review") writes `pr-review-draft.json` beside its recap:

    {"schemaVersion": 1, "round": 1,
     "pr": "https://github.com/<owner>/<repo>/pull/<n>",
     "author": "tyrell", "authorName": "Tyrell Wellick",
     "commit": "<reviewed head sha>",
     "verdict": "Not safe to merge.",
     "recommended": "REQUEST_CHANGES" | "COMMENT" | "APPROVE",
     "suggestedNote": "Couple of things, see comments",
     "comments": [{"id": "limit-reset", "header": "Limit resets on deploy",
                   "finding": "The bucket lives in process memory ...",
                   "path": "app/limits/ecoin.rb", "line": 42,
                   "diffHunk": "...", "url": "https://github.com/...",
                   "body": "Orc's drafted line comment",
                   "recommended": "keep" | "drop"}]}

While the draft has comments nobody has looked at (`state` absent or
"drafting"), Answer mode walks them one step each: the code, what Orc found,
the drafted comment in a box the user can edit, and Keep it / Drop it. Those
answers land here directly (`apply_answers`), with no agent turn, and the
draft becomes "ready". A clean review skips straight to "ready".

Chat then shows the Your review card from `card_model`: the note and each kept
comment with Edit, dropped ones with Put back, and Request changes, Comment
and Approve. Nothing reaches GitHub until one of those is pressed, which runs
`bin/orc-pr-review post` (`post`): one review, as the user, from `gh`. A
failed post leaves the draft as it was.

The overall `note` is the user's own and starts empty, so a review posts
without one unless they add it. Orc's drafted note is `suggestedNote`: the card
offers it under the empty note with Use it, which copies it into `note`. Older
drafts that wrote `note` directly keep it.

The note and each comment can carry images (`noteImages`, and `images` on a
comment): files in the run's `attachments/` folder, pasted into the card's
editor. They stay on this machine until the review posts. `post` then uploads
each one to GitHub (`upload_asset`, the same endpoint `gh pr comment --attach`
uses) and adds it to its comment as markdown. GitHub cannot delete an upload,
so the URLs are kept in `uploads` and a retry after a failed post reuses them.
"""

from __future__ import annotations

import contextlib
import datetime
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

import staged_images

DRAFT_FILE = "pr-review-draft.json"
EVENTS = ("REQUEST_CHANGES", "COMMENT", "APPROVE")
EVENT_LABELS = {"REQUEST_CHANGES": "Request changes", "COMMENT": "Comment", "APPROVE": "Approve"}
KEEP = "Keep it in the review"
DROP = "Drop it"
PR_URL = re.compile(r"https://github\.com/([^/]+)/([^/]+)/pull/(\d+)/?")
MAX_BODY = 65536
HUNK_LINES = 8
HUNK_HEADER = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")
IMAGE_REF = re.compile(r"attachments/[A-Za-z0-9][A-Za-z0-9._-]{0,159}")
MAX_IMAGES = 10
# A comment the QA window added from a step you failed (`add_comments`), not
# one Orc drafted from the code.
QA_SOURCE = "qa"
# What GitHub's upload endpoint takes, out of the types Orc's image tray accepts.
GITHUB_IMAGE_TYPES = ("image/png", "image/jpeg", "image/gif", "image/webp")
UPLOAD_URL = "https://uploads.github.com/user-attachments/assets"


class DraftError(Exception):
    """A draft that cannot be read, changed or posted; the message says why."""

    def __init__(self, message, status=409):
        super().__init__(message)
        self.status = status


def _text(value):
    return value.strip() if isinstance(value, str) else ""


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(
        timespec="seconds").replace("+00:00", "Z")


def _path(run_dir):
    return os.path.join(run_dir, DRAFT_FILE)


def _write_atomic(path, text):
    fd, temp = tempfile.mkstemp(prefix=".%s." % os.path.basename(path), suffix=".tmp",
                                dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temp)
        raise


@contextlib.contextmanager
def _locked(run_dir, wait=True):
    with open(os.path.join(run_dir, ".pr-review-draft.lock"), "a+") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | (0 if wait else fcntl.LOCK_NB))
        except BlockingIOError as exc:
            raise DraftError("this review is already being posted") from exc
        yield


def _images(value):
    """The well-formed image references of a note or comment, in order."""
    if not isinstance(value, list):
        return []
    return list(dict.fromkeys(item for item in value
                              if isinstance(item, str) and IMAGE_REF.fullmatch(item)))[:MAX_IMAGES]


def _finding(value, cid):
    """What Orc found, as a sentence. Some drafts wrote the comment's id here;
    that reads as nothing, so the walk shows the header in its place."""
    finding = _text(value)
    return "" if finding == cid else finding


def _comment(raw, index):
    if not isinstance(raw, dict):
        raise DraftError("comment %d is not an object" % (index + 1))
    cid = raw.get("id")
    if not isinstance(cid, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", cid):
        raise DraftError("comment %d needs an id of letters, digits, '.', '_' or '-'" % (index + 1))
    line = raw.get("line")
    line = line if isinstance(line, int) and not isinstance(line, bool) and line > 0 else None
    url = _text(raw.get("url"))
    kept = raw.get("kept")
    recommended = raw.get("recommended") if raw.get("recommended") in ("keep", "drop") else "keep"
    return {
        "id": cid,
        "source": QA_SOURCE if raw.get("source") == QA_SOURCE else "orc",
        "header": _text(raw.get("header")) or "Finding %d" % (index + 1),
        "finding": _finding(raw.get("finding"), cid),
        "path": _text(raw.get("path")),
        "line": line,
        "diffHunk": "\n".join(str(raw.get("diffHunk") or "").rstrip().splitlines()[-HUNK_LINES:]),
        "url": url if url.startswith("https://") else "",
        "body": _text(raw.get("body")),
        "images": _images(raw.get("images")),
        "recommended": recommended,
        "kept": kept if isinstance(kept, bool) else recommended == "keep",
    }


def load(run_dir):
    """The draft, validated and shaped, or None when the run has none."""
    try:
        with open(_path(run_dir), "rb") as handle:
            raw_bytes = handle.read()
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise DraftError("cannot read the draft review: %s" % exc) from exc
    try:
        raw = json.loads(raw_bytes)
    except ValueError as exc:
        raise DraftError("the draft review is not valid JSON") from exc
    if not isinstance(raw, dict):
        raise DraftError("the draft review must be a JSON object")
    pr = _text(raw.get("pr"))
    if not PR_URL.fullmatch(pr):
        raise DraftError("the draft review names no GitHub PR")
    comments = raw.get("comments") if isinstance(raw.get("comments"), list) else []
    shaped = [_comment(item, index) for index, item in enumerate(comments)]
    if len({item["id"] for item in shaped}) != len(shaped):
        raise DraftError("the draft review repeats a comment id")
    recommended = raw.get("recommended") if raw.get("recommended") in EVENTS else (
        "APPROVE" if not shaped else "COMMENT")
    state = raw.get("state") if raw.get("state") in ("drafting", "ready") else (
        "drafting" if shaped else "ready")
    posted = raw.get("posted") if isinstance(raw.get("posted"), dict) else None
    return {
        "raw": raw,
        "digest": hashlib.sha256(raw_bytes).hexdigest(),
        "pr": pr.rstrip("/"),
        "round": raw.get("round"),
        "author": _text(raw.get("author")),
        "authorName": _text(raw.get("authorName")),
        "commit": _text(raw.get("commit")),
        "verdict": _text(raw.get("verdict")),
        "recommended": recommended,
        "note": _text(raw.get("note")),
        "suggestedNote": _text(raw.get("suggestedNote")),
        "noteImages": _images(raw.get("noteImages")),
        "uploads": {key: value for key, value in (raw.get("uploads") or {}).items()
                    if isinstance(key, str) and isinstance(value, str)}
        if isinstance(raw.get("uploads"), dict) else {},
        "comments": shaped,
        "state": "posted" if posted else state,
        "posted": posted,
        "lastError": raw.get("lastError") if isinstance(raw.get("lastError"), dict) else None,
    }


def applies(meta):
    """A drafted review belongs only to a flag-mode review of someone else's PR:
    GitHub will not let anyone approve their own."""
    review = meta.get("review") if isinstance(meta, dict) else None
    return isinstance(review, dict) and review.get("mode") == "flag"


def _bound(draft, meta):
    pr = (meta.get("review") or {}).get("prUrl")
    return isinstance(pr, str) and pr.rstrip("/") == draft["pr"]


def answers_pending(run_dir, meta):
    """True while Answer mode should walk the drafted comments."""
    if not applies(meta) or meta.get("status") != "awaiting-gate":
        return False
    try:
        draft = load(run_dir)
    except DraftError:
        return False
    return bool(draft and _bound(draft, meta) and draft["state"] == "drafting")


def generation(draft):
    """Answer mode's identity for the walk. Not the file's digest: an Ask
    that redrafts one comment must not make the other answers stale."""
    return "draft-%s-%s-%s" % (draft["round"] if draft["round"] is not None else "",
                               draft["commit"][:12],
                               hashlib.sha256(",".join(c["id"] for c in draft["comments"])
                                              .encode()).hexdigest()[:12])


def question_schema(draft):
    """The drafted comments as a shared-schema questions file
    (skills/_shared/question-form.md), one step each."""
    questions = []
    for comment in draft["comments"]:
        keep = comment["recommended"] == "keep"
        qa = comment["source"] == QA_SOURCE
        questions.append({
            "id": comment["id"],
            "header": comment["header"],
            "prompt": "What should happen to it",
            "comment": {"author": "Your QA" if qa else "Orc", "path": comment["path"], "line": comment["line"],
                        "url": comment["url"], "body": comment["finding"] or comment["header"],
                        "diffHunk": comment["diffHunk"]},
            "draft": {"label": "Comment on this line" if comment["line"] else "Comment",
                      "body": comment["body"],
                      "hint": ("From a step you failed in QA" if qa else "Orc drafted this")
                      + ". Edit it here; nothing posts until you send the review."},
            "options": [
                {"label": KEEP, "recommended": keep,
                 "description": "Posts as a line comment when you send the review."
                 if comment["line"] else "Posts in the review when you send it."},
                {"label": DROP, "recommended": not keep,
                 "description": "Not worth raising. It stays in the recap only."},
            ],
        })
    return {"prefix": "PR review", "questions": questions}


def _save(run_dir, raw):
    _write_atomic(_path(run_dir), json.dumps(raw, indent=2) + "\n")


def _editable(run_dir, meta):
    draft = load(run_dir)
    if draft is None or not applies(meta) or not _bound(draft, meta):
        raise DraftError("this run has no review to draft", 404)
    if draft["posted"]:
        raise DraftError("this review is already on GitHub")
    return draft


def _body(value, field="comment"):
    if not isinstance(value, str):
        raise DraftError("the %s must be text" % field, 400)
    body = value.strip()
    if len(body.encode("utf-8")) > MAX_BODY:
        raise DraftError("the %s is too long" % field, 400)
    return body


def _checked_images(run_dir, value):
    """Images for the note or a comment: each a picture already saved in the
    run's attachments folder, of a type GitHub will take."""
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise DraftError("images must be a list of attached images", 400)
    images = list(dict.fromkeys(value))
    if len(images) > MAX_IMAGES:
        raise DraftError("a comment holds at most %d images" % MAX_IMAGES, 400)
    folder = os.path.realpath(os.path.join(run_dir, "attachments"))
    for image in images:
        full = os.path.realpath(os.path.join(run_dir, image))
        if not IMAGE_REF.fullmatch(image) or os.path.dirname(full) != folder \
                or not os.path.isfile(full):
            raise DraftError("%s is not an image attached to this review" % image, 400)
        with open(full, "rb") as handle:
            kind = staged_images.image_type(handle.read(64))
        if kind not in GITHUB_IMAGE_TYPES:
            raise DraftError("GitHub takes PNG, JPEG, GIF or WebP images, not %s"
                             % os.path.basename(image), 400)
    return images


def apply_answers(run_dir, meta, gen, answers):
    """Answer mode's walk, saved into the draft: kept or dropped, and the
    comment as the user left it. Returns the draft now "ready"."""
    with _locked(run_dir):
        draft = _editable(run_dir, meta)
        if draft["state"] != "drafting" or generation(draft) != gen:
            raise DraftError("these comments changed — open them again to answer the latest")
        if not isinstance(answers, dict):
            raise DraftError("answers are malformed", 400)
        raw = draft["raw"]
        by_id = {item.get("id"): item for item in raw["comments"] if isinstance(item, dict)}
        updates = {}
        for comment in draft["comments"]:
            answer = answers.get(comment["id"])
            if not isinstance(answer, dict):
                raise DraftError("%s needs an answer" % comment["header"], 400)
            picked = answer.get("picked")
            if picked not in ([KEEP], [DROP]):
                raise DraftError("%s needs Keep it or Drop it" % comment["header"], 400)
            body = _body(answer.get("draft", comment["body"]))
            if picked == [KEEP] and not body:
                raise DraftError("%s is kept but its comment is empty" % comment["header"], 400)
            updates[comment["id"]] = (picked == [KEEP], body)
        for cid, (kept, body) in updates.items():
            by_id[cid]["kept"] = kept
            by_id[cid]["body"] = body
        raw["state"] = "ready"
        raw.pop("lastError", None)
        _save(run_dir, raw)
        return load(run_dir)


def edit(run_dir, meta, target, *, body=None, kept=None, images=None, digest=None):
    """One change from the card (or the agent): `target` is "note" or a comment
    id; `body` rewrites it, `images` replaces its pictures, and `kept` drops it
    or puts it back."""
    with _locked(run_dir):
        draft = _editable(run_dir, meta)
        if digest is not None and digest != draft["digest"]:
            raise DraftError("the review changed since you opened it — reload to see the latest")
        raw = draft["raw"]
        checked = _checked_images(run_dir, images) if images is not None else None
        if target == "note":
            if body is None or kept is not None:
                raise DraftError("the note takes only text and images", 400)
            raw["note"] = _body(body, "note")
            if checked is not None:
                raw["noteImages"] = checked
        else:
            item = next((item for item in raw.get("comments") or []
                         if isinstance(item, dict) and item.get("id") == target), None)
            if item is None:
                raise DraftError("the review has no comment %r" % target, 404)
            if body is not None:
                text = _body(body)
                pictures = checked if checked is not None else _images(item.get("images"))
                if not text and not pictures:
                    raise DraftError("a comment cannot be empty; drop it instead", 400)
                item["body"] = text
            if checked is not None:
                item["images"] = checked
            if kept is not None:
                if not isinstance(kept, bool):
                    raise DraftError("kept must be true or false", 400)
                item["kept"] = kept
        raw.pop("lastError", None)
        _save(run_dir, raw)
        return load(run_dir)


def qa_status(run_dir, meta):
    """Whether failed QA steps can go into this run's drafted review: "open",
    "posted" once the review is on GitHub, or "none" while there is no draft
    to add to (the review is still reading the change, or its draft cannot
    be read)."""
    if not applies(meta):
        return "none"
    try:
        draft = load(run_dir)
    except DraftError:
        return "none"
    if draft is None or not _bound(draft, meta):
        return "none"
    return "posted" if draft["posted"] else "open"


def add_comments(run_dir, meta, comments):
    """Adds the comments the QA window wrote from failed steps, each kept and
    posted in the review's body, since a failure has no line in the code.

    A comment with the id of one already in the draft replaces it: a repeated
    id would make the draft unreadable. The draft keeps the state it had, so a
    ready review stays ready, with the new comments in the card to edit or
    drop, and one still being walked in Answer mode walks them too. Returns
    the draft."""
    with _locked(run_dir):
        draft = _editable(run_dir, meta)
        raw = draft["raw"]
        existing = raw["comments"] = raw.get("comments") if isinstance(raw.get("comments"), list) else []
        # A clean draft reads "ready" only because it has no comments.
        raw["state"] = draft["state"]
        for comment in comments:
            cid = comment.get("id")
            if not isinstance(cid, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", cid):
                raise DraftError("a QA comment needs an id of letters, digits, '.', '_' or '-'", 400)
            body = _body(comment.get("body"))
            if not body:
                raise DraftError("a QA comment cannot be empty", 400)
            item = {"id": cid, "source": QA_SOURCE, "header": _text(comment.get("header")) or "QA step failed",
                    "finding": _text(comment.get("finding")), "path": "", "line": None, "body": body,
                    "images": _checked_images(run_dir, comment.get("images") or []),
                    "recommended": "keep", "kept": True}
            index = next((index for index, old in enumerate(existing)
                          if isinstance(old, dict) and old.get("id") == cid), None)
            if index is None:
                existing.append(item)
            else:
                existing[index] = item
        raw.pop("lastError", None)
        _save(run_dir, raw)
        return load(run_dir)


def card_model(run_dir, meta):
    """What Chat's Your review card draws, or None when there is no draft."""
    if not applies(meta):
        return None
    draft = load(run_dir)
    if draft is None or not _bound(draft, meta):
        return None
    return {
        "digest": draft["digest"], "pr": draft["pr"],
        "number": int(PR_URL.fullmatch(draft["pr"]).group(3)),
        "author": draft["author"], "authorName": draft["authorName"],
        "verdict": draft["verdict"], "recommended": draft["recommended"],
        "note": draft["note"], "noteImages": draft["noteImages"],
        "suggestedNote": draft["suggestedNote"], "state": draft["state"], "posted": draft["posted"],
        "lastError": draft["lastError"],
        "comments": [{key: comment[key] for key in
                      ("id", "header", "finding", "path", "line", "url", "body", "images", "kept")}
                     for comment in draft["comments"]],
    }


# ---------- posting ----------

def gh(args, stdin=""):
    executable = shutil.which("gh")
    if not executable:
        raise DraftError("gh is not installed")
    result = subprocess.run([executable, *args], input=stdin, capture_output=True, text=True)
    if result.returncode != 0:
        lines = (result.stderr or result.stdout).strip().splitlines()
        raise DraftError("GitHub refused the review: %s" % (
            lines[-1] if lines else "gh exited %d" % result.returncode))
    return result.stdout


def _json(out, what):
    try:
        return json.loads(out)
    except ValueError as exc:
        raise DraftError("gh returned no JSON for %s" % what) from exc


def commentable_lines(patch):
    """The new-side line numbers a review comment can land on in one file's
    patch: added and context lines, as GitHub's RIGHT side counts them."""
    lines, current = set(), None
    for row in (patch or "").splitlines():
        header = HUNK_HEADER.match(row)
        if header:
            current = int(header.group(1))
            continue
        if current is None or row.startswith("\\"):
            continue
        if row.startswith("-"):
            continue
        lines.add(current)
        current += 1
    return lines


def _pr_files(owner, repo, number, run):
    pages = run(["api", "--paginate", "--slurp",
                 "repos/%s/%s/pulls/%s/files?per_page=100" % (owner, repo, number)])
    value = _json(pages, "the PR's files")
    files = [item for page in value for item in (page if isinstance(page, list) else [page])] \
        if isinstance(value, list) else []
    return {item.get("filename"): commentable_lines(item.get("patch"))
            for item in files if isinstance(item, dict)}


def kept_comments(draft):
    return [comment for comment in draft["comments"]
            if comment["kept"] and (comment["body"] or comment["images"])]


def with_images(text, images, assets):
    """Text with its images after it, as GitHub markdown."""
    pictures = ["![Image %d](%s)" % (index + 1, assets[image])
                for index, image in enumerate(images) if assets.get(image)]
    return "\n\n".join(part for part in [text, "\n".join(pictures)] if part)


def review_payload(draft, event, head, files, assets=None):
    """The one GitHub review: line comments that still land on the PR's diff,
    and the rest folded into the body as general comments, never dropped.
    `assets` maps each image to its uploaded GitHub URL."""
    assets = assets or {}
    line_comments, general = [], []
    for comment in kept_comments(draft):
        body = with_images(comment["body"], comment["images"], assets)
        if comment["path"] and comment["line"] and comment["line"] in files.get(comment["path"], ()):
            line_comments.append({"path": comment["path"], "line": comment["line"],
                                  "side": "RIGHT", "body": body})
        else:
            general.append((comment, body))
    note = with_images(draft["note"], draft["noteImages"], assets)
    parts = [note] if note else []
    for comment, body in general:
        where = ("On `%s` line %d:" % (comment["path"], comment["line"]) if comment["path"] and comment["line"]
                 else "On `%s`:" % comment["path"] if comment["path"] else "")
        parts.append(("**%s** %s\n\n%s" % (comment["header"], where, body)).replace(" \n", "\n"))
    body = "\n\n".join(parts)
    if event != "APPROVE" and not body and not line_comments:
        raise DraftError("%s needs a note or a kept comment" % EVENT_LABELS[event], 400)
    if event == "REQUEST_CHANGES" and not body:
        # GitHub asks for a review body before it records changes requested.
        body = "Requesting changes; see the comments on the lines."
    payload = {"commit_id": head, "event": event, "body": body, "comments": line_comments}
    return payload, [comment["id"] for comment, _body in general]


def upload_asset(token, repository_id, path, content_type):
    """Upload one image to GitHub and return its URL. This is the endpoint
    `gh pr comment --attach` uses (cli/cli internal/attachments): the raw
    bytes, named and typed in the query, tied to the PR's repository."""
    query = urllib.parse.urlencode({"name": os.path.basename(path), "content_type": content_type,
                                    "repository_id": repository_id})
    with open(path, "rb") as handle:
        body = handle.read()
    request = urllib.request.Request("%s?%s" % (UPLOAD_URL, query), data=body, method="POST", headers={
        "Authorization": "token %s" % token, "Accept": "application/vnd.github+json",
        "Content-Type": "application/octet-stream"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            asset = json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        reason = {404: "attaching images needs write access to the repository",
                  429: "GitHub is rate limiting uploads; try again shortly"}.get(exc.code)
        if reason is None:
            detail = exc.read().decode("utf-8", "replace").strip()
            reason = "HTTP %d%s" % (exc.code, ": " + detail[:200] if detail else "")
        raise DraftError("GitHub refused the image %s: %s" % (os.path.basename(path), reason)) from exc
    except (OSError, ValueError) as exc:
        raise DraftError("could not upload the image %s: %s" % (os.path.basename(path), exc)) from exc
    url = asset.get("url") if isinstance(asset, dict) else None
    if not isinstance(url, str) or not url.startswith("https://"):
        raise DraftError("GitHub returned no URL for the image %s" % os.path.basename(path))
    return url


def _review_images(draft):
    """Every image the review posts: the note's and each kept comment's."""
    return list(dict.fromkeys(draft["noteImages"] + [
        image for comment in kept_comments(draft) for image in comment["images"]]))


def _upload_images(run_dir, draft, owner, repo, run, upload):
    """Every image the review will post, uploaded once. Each URL is saved as
    soon as GitHub returns it, so a post that fails later never uploads it
    again (GitHub has no way to delete one)."""
    images = _review_images(draft)
    assets = dict(draft["uploads"])
    missing = [image for image in images if image not in assets]
    if not missing:
        return assets
    checked = _checked_images(run_dir, missing)
    repository_id = run(["api", "repos/%s/%s" % (owner, repo), "--jq", ".id"]).strip()
    token = run(["auth", "token", "--hostname", "github.com"]).strip()
    if not repository_id.isdigit() or not token:
        raise DraftError("gh could not name the repository or your token for the image upload")
    raw = draft["raw"]
    for image in checked:
        full = os.path.join(run_dir, image)
        with open(full, "rb") as handle:
            kind = staged_images.image_type(handle.read(64))
        assets[image] = upload(token, int(repository_id), full, kind)
        raw.setdefault("uploads", {})[image] = assets[image]
        _save(run_dir, raw)
    return assets


def post(run_dir, meta_path, event, digest, run: Callable[..., str] = gh,
         upload: Callable[..., str] = upload_asset):
    """Post the draft as one GitHub review and record it. Returns the record."""
    if event not in EVENTS:
        raise DraftError("the review must be Request changes, Comment or Approve", 400)
    with _locked(run_dir, wait=False):
        with open(meta_path) as handle:
            meta = json.load(handle)
        draft = load(run_dir)
        if draft is None or not applies(meta) or not _bound(draft, meta):
            raise DraftError("this run has no drafted review of someone else's PR", 404)
        if draft["posted"]:
            return draft["posted"]
        if draft["state"] != "ready":
            raise DraftError("go through the drafted comments in Answer mode first")
        if digest != draft["digest"]:
            raise DraftError("the review changed since you opened it — reload to see the latest")
        owner, repo, number = PR_URL.fullmatch(draft["pr"]).groups()
        try:
            pr = _json(run(["pr", "view", draft["pr"], "--json", "author,headRefOid,state"]), "the PR")
            viewer = run(["api", "user", "--jq", ".login"]).strip()
            if str((pr.get("author") or {}).get("login") or "").lower() == viewer.lower():
                raise DraftError("this is your own PR; GitHub won't let you review it")
            if pr.get("state") != "OPEN":
                raise DraftError("PR #%s is %s, so it takes no review"
                                 % (number, str(pr.get("state") or "closed").lower()))
            files = _pr_files(owner, repo, number, run)
            # Checked before any upload, since an upload cannot be taken back.
            review_payload(draft, event, pr.get("headRefOid"), files,
                           {image: image for image in _review_images(draft)})
            assets = _upload_images(run_dir, draft, owner, repo, run, upload)
            payload, folded = review_payload(draft, event, pr.get("headRefOid"), files, assets)
            result = _json(run(["api", "--method", "POST",
                                "repos/%s/%s/pulls/%s/reviews" % (owner, repo, number),
                                "--input", "-"], json.dumps(payload)), "the posted review")
        except DraftError as exc:
            raw = draft["raw"]
            raw["lastError"] = {"event": event, "message": str(exc), "at": _now()}
            _save(run_dir, raw)
            raise
        record = {"event": event, "id": result.get("id"), "url": result.get("html_url"),
                  "at": _now(), "commit": pr.get("headRefOid"), "folded": folded}
        raw = draft["raw"]
        raw["posted"] = record
        raw.pop("lastError", None)
        _save(run_dir, raw)
        with open(meta_path) as handle:
            meta = json.load(handle)
        meta.setdefault("review", {})["posted"] = {key: record[key] for key in ("event", "url", "at")}
        _write_atomic(meta_path, json.dumps(meta, indent=2) + "\n")
        return record
