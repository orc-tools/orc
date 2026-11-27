"""The side panel's Pull request view: one linked PR, read through `gh pr view`
and trimmed to what the panel draws, with Zerohands' review of it
(zerohands_review.py). Read-only; the panel never writes to the
host. A short cache keeps a panel left open from calling `gh` on every poll."""
from __future__ import annotations

from datetime import datetime, timezone
import glob
import json
import os
import re
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

import integrations
import zerohands_review
from stat_cache import keep_recent

CACHE_SECONDS = 30
CACHE_LIMIT = 64
FIELDS = ",".join([
    "number", "title", "state", "isDraft", "url", "author", "baseRefName",
    "headRefName", "additions", "deletions", "changedFiles", "updatedAt",
    "body", "labels", "reviewRequests", "reviews", "comments", "commits",
    "statusCheckRollup",
])
PULL_URL_RE = re.compile(r"https://[^/\s]+/([^/\s]+/[^/\s]+)/pull/(\d+)/?")
# A private repository's image only loads for a signed-in github.com session,
# which Orc's page never has, so the server fetches it with gh's token.
ASSET_URL_RE = re.compile(r"https://github\.com/user-attachments/assets/[0-9a-fA-F-]{36}")
ASSET_MAX_BYTES = 20 * 1024 * 1024
ALLOWED_ASSET_TYPES = {
    "image/png": "image/png",
    "image/jpeg": "image/jpeg",
    "image/jpg": "image/jpeg",
    "image/gif": "image/gif",
    "image/webp": "image/webp",
    "image/avif": "image/avif",
    "image/apng": "image/apng",
    "image/bmp": "image/bmp",
    "video/mp4": "video/mp4",
    "video/webm": "video/webm",
    "video/quicktime": "video/quicktime",
    "video/ogg": "video/ogg",
}
ACTIVE_ASSET_SNIFF_RE = re.compile(
    rb"^\s*(?:\xef\xbb\xbf)?(?:<!doctype\b|<html\b|<svg\b|<script\b|<\?xml\b)", re.I)
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_lock = threading.Lock()


def safe_web_url(url: Any) -> str | None:
    """An http(s) URL safe to open in a browser, else None."""
    if not isinstance(url, str):
        return None
    trimmed = url.strip()
    if not trimmed or any(ord(ch) < 32 or ord(ch) == 127 for ch in trimmed):
        return None
    parts = urllib.parse.urlsplit(trimmed)
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc:
        return None
    return trimmed


class PullRequestError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class PrManagerError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def linked_urls(meta: dict[str, Any], read_start_prompt: Callable[[], str | None] | None = None) -> list[str]:
    """Every PR the run is linked to: grouped delivery first, then the
    recorded prUrl(s), then the PR a `source: "pr"` run was seeded from or a
    local review is reviewing, then the PR a branchless run started from."""
    urls: list[str] = []
    delivery = meta.get("delivery")
    if isinstance(delivery, dict) and isinstance(delivery.get("groups"), list):
        for group in delivery["groups"]:
            pr = group.get("pr") if isinstance(group, dict) else None
            if isinstance(pr, dict) and isinstance(pr.get("url"), str):
                urls.append(pr["url"])
    if not urls:
        recorded = meta.get("prUrls") if isinstance(meta.get("prUrls"), list) \
            else [meta.get("prUrl")]
        urls.extend(url for url in recorded if isinstance(url, str))
    if not urls and meta.get("source") == "pr" and isinstance(meta.get("sourceUrl"), str):
        urls.append(meta["sourceUrl"])
    review = meta.get("review")
    if not urls and meta.get("route") == "local-review" and isinstance(review, dict) \
            and isinstance(review.get("prUrl"), str):
        urls.append(review["prUrl"])
    if not urls:
        source = source_pr_url(meta, read_start_prompt)
        if source:
            urls.append(source)
    return [url for url in urls if PULL_URL_RE.fullmatch(url)]


# A request that is nothing but one PR link, such as "Review PR 8904" pasted as
# its URL. A tab of the PR (/files) or a query still names the same PR.
SINGLE_PR_LINK_RE = re.compile(
    r"https://github\.com/([\w.-]+)/([\w.-]+)/pull/(\d+)(?:/[\w/-]*)?(?:[?#]\S*)?")


def single_pr_link(text: str | None) -> str | None:
    """The PR a prompt consists of, as its canonical URL, or None when the
    prompt says anything more than one GitHub PR link."""
    match = SINGLE_PR_LINK_RE.fullmatch((text or "").strip())
    return "https://github.com/%s/%s/pull/%s" % match.groups() if match else None


def source_pr_url(meta: dict[str, Any], read_start_prompt: Callable[[], str | None] | None = None) -> str | None:
    """The PR a branchless run started from: the link Orc recorded at launch,
    else, for runs launched before it recorded one, the start prompt when that
    prompt is a single PR link. A run with a branch opens its own PR, so the PR
    it started from is never its badge or its Open PR state."""
    if meta.get("branch"):
        return None
    recorded = meta.get("sourceUrl")
    if isinstance(recorded, str):
        return single_pr_link(recorded)
    return single_pr_link(read_start_prompt()) if read_start_prompt else None


def _login(actor: Any) -> str | None:
    return actor.get("login") if isinstance(actor, dict) else None


def _check(item: dict[str, Any]) -> dict[str, Any]:
    # CheckRun reports status + conclusion; a legacy StatusContext reports state
    if item.get("__typename") == "StatusContext":
        state = (item.get("state") or "").upper()
        outcome = {"SUCCESS": "pass", "FAILURE": "fail", "ERROR": "fail"}.get(state, "pending")
        return {"name": item.get("context") or "Status", "outcome": outcome,
                "url": safe_web_url(item.get("targetUrl"))}
    conclusion = (item.get("conclusion") or "").upper()
    if (item.get("status") or "").upper() != "COMPLETED":
        outcome = "pending"
    elif conclusion in ("SUCCESS", "NEUTRAL"):
        outcome = "pass"
    elif conclusion == "SKIPPED":
        outcome = "skipped"
    else:
        outcome = "fail"
    return {"name": item.get("name") or item.get("workflowName") or "Check",
            "outcome": outcome, "url": safe_web_url(item.get("detailsUrl"))}


def normalize(raw: dict[str, Any], url: str) -> dict[str, Any]:
    match = PULL_URL_RE.fullmatch(url)
    state = (raw.get("state") or "").lower()
    timeline = []
    for comment in raw.get("comments") or []:
        timeline.append({"kind": "comment", "author": _login(comment.get("author")),
                         "at": comment.get("createdAt"), "body": comment.get("body") or ""})
    for review in raw.get("reviews") or []:
        timeline.append({"kind": "review", "author": _login(review.get("author")),
                         "at": review.get("submittedAt"),
                         "state": (review.get("state") or "").lower(),
                         "body": review.get("body") or ""})
    for commit in raw.get("commits") or []:
        authors = commit.get("authors") or []
        timeline.append({"kind": "commit", "author": _login(authors[0]) if authors else None,
                         "at": commit.get("committedDate"),
                         "oid": (commit.get("oid") or "")[:7],
                         "body": commit.get("messageHeadline") or ""})
    requested = [_login(r) or (r.get("name") if isinstance(r, dict) else None)
                 for r in raw.get("reviewRequests") or []]
    reviewed = {}
    for review in raw.get("reviews") or []:
        login = _login(review.get("author"))
        if login and review.get("state") in ("APPROVED", "CHANGES_REQUESTED", "COMMENTED"):
            reviewed[login] = review["state"].lower()
    reviewers = [{"login": login, "outcome": outcome} for login, outcome in reviewed.items()]
    reviewers += [{"login": login, "outcome": None}
                  for login in requested if login and login not in reviewed]
    return {
        "url": raw.get("url") or url,
        "repository": match.group(1) if match else "",
        "number": raw.get("number"),
        "title": raw.get("title") or "",
        "state": "draft" if state == "open" and raw.get("isDraft") else state,
        "author": _login(raw.get("author")),
        "baseBranch": raw.get("baseRefName") or "",
        "headBranch": raw.get("headRefName") or "",
        "additions": raw.get("additions") or 0,
        "deletions": raw.get("deletions") or 0,
        "changedFiles": raw.get("changedFiles") or 0,
        "updatedAt": raw.get("updatedAt"),
        "body": raw.get("body") or "",
        "labels": [label.get("name") for label in raw.get("labels") or []
                   if isinstance(label, dict) and label.get("name")],
        "reviewers": reviewers,
        "checks": [_check(item) for item in raw.get("statusCheckRollup") or []
                   if isinstance(item, dict)],
        "timeline": sorted((item for item in timeline if item["at"]),
                           key=lambda item: item["at"]),
    }


def fetch(url: str, cwd: str | None = None, now: float | None = None) -> dict[str, Any]:
    if not PULL_URL_RE.fullmatch(url or ""):
        raise PullRequestError(400, "not a pull request URL")
    now = time.time() if now is None else now
    with _lock:
        hit = _cache.get(url)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]
    env = dict(os.environ, GH_PROMPT_DISABLED="1", GIT_TERMINAL_PROMPT="0")
    integrations.note("run-pr-panel")
    try:
        result = subprocess.run(
            ["gh", "pr", "view", url, "--json", FIELDS],
            cwd=cwd if cwd and os.path.isdir(cwd) else None, env=env,
            capture_output=True, text=True, timeout=15, check=False)
    except (OSError, subprocess.SubprocessError):
        raise PullRequestError(502, "couldn't run gh") from None
    if result.returncode != 0:
        lines = (result.stderr or "").strip().splitlines()
        raise PullRequestError(502, lines[-1] if lines else "gh pr view failed")
    try:
        raw = json.loads(result.stdout)
        detail = normalize(raw, url)
    except (ValueError, AttributeError, TypeError):
        raise PullRequestError(502, "gh returned an unreadable pull request") from None
    try:
        detail["zerohands"] = zerohands_review.status(detail["repository"], detail["number"],
                                                      raw.get("reviews"), now)
    except Exception:  # the Zerohands row is extra: never let it cost the panel its PR
        detail["zerohands"] = None
    with _lock:
        keep_recent(_cache, url, (now, detail), CACHE_LIMIT)
    return detail


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def _gh_token() -> str:
    env = dict(os.environ, GH_PROMPT_DISABLED="1")
    integrations.note("run-pr-panel")
    try:
        result = subprocess.run(["gh", "auth", "token", "--hostname", "github.com"],
                                env=env, capture_output=True, text=True, timeout=10, check=False)
    except (OSError, subprocess.SubprocessError):
        raise PullRequestError(502, "couldn't run gh") from None
    token = result.stdout.strip()
    if result.returncode != 0 or not token:
        raise PullRequestError(502, "gh is not signed in to github.com")
    return token


def fetch_asset(src: str, opener: Any = None) -> tuple[bytes, str]:
    """One image or video attached to a PR body, read as the gh user. GitHub
    answers with a short-lived signed storage URL, which must be fetched
    without the token: the storage host refuses a request carrying both."""
    if not ASSET_URL_RE.fullmatch(src or ""):
        raise PullRequestError(400, "not a GitHub attachment URL")
    opener = opener or urllib.request.build_opener(_NoRedirect)
    request = urllib.request.Request(src, headers={"Authorization": f"token {_gh_token()}"})
    try:
        response = opener.open(request, timeout=15)
    except urllib.error.HTTPError as error:
        location = error.headers.get("Location") if error.headers else None
        if error.code not in (301, 302, 303, 307, 308) or not location:
            raise PullRequestError(404 if error.code == 404 else 502,
                                   f"GitHub answered {error.code}") from None
        redirect = urllib.parse.urlsplit(location)
        if redirect.scheme.lower() != "https" or not redirect.netloc:
            raise PullRequestError(502, "GitHub redirected to an unsupported URL") from None
        try:
            response = opener.open(urllib.request.Request(location), timeout=15)
        except (urllib.error.URLError, OSError):
            raise PullRequestError(502, "couldn't download the attachment") from None
    except (urllib.error.URLError, OSError):
        raise PullRequestError(502, "couldn't reach GitHub") from None
    with response:
        content_type = (response.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        body = response.read(ASSET_MAX_BYTES + 1)
    canonical = ALLOWED_ASSET_TYPES.get(content_type)
    if not canonical:
        raise PullRequestError(415, "the attachment type is not allowed")
    if len(body) > ASSET_MAX_BYTES:
        raise PullRequestError(413, "the attachment is too large")
    if ACTIVE_ASSET_SNIFF_RE.match(body[:512]):
        raise PullRequestError(415, "the attachment contains active content")
    return body, canonical


PR_LINK_RE = re.compile(r"https://github\.com/([\w.-]+)/([\w.-]+)/pull/(\d+)")
LINEAR_LINK_RE = re.compile(r"https://linear\.app/([\w-]+)/issue/([A-Za-z]{2,10}-\d{1,6})\b")
LINEAR_REF_RE = re.compile(r"^[a-z]{2,10}-\d{1,6}$", re.I)


def iso(epoch: float | None) -> str | None:
    if epoch is None:
        return None
    return datetime.fromtimestamp(float(epoch), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def pr_key(owner_repo: str, number: int | str) -> str:
    return "%s#%s" % (owner_repo.lower(), int(number))


def key_for_url(url: str | None) -> str | None:
    match = PR_LINK_RE.search(url or "")
    return pr_key(match[1] + "/" + match[2], match[3]) if match else None


def runs_linear_workspace(config: Any, metas: Any) -> str | None:
    """The configured workspace, else the one a Linear-launched run recorded."""
    raw = config.get("prManager") if isinstance(config, dict) else None
    configured = raw.get("linearWorkspace") if isinstance(raw, dict) else None
    if isinstance(configured, str) and configured.strip():
        return configured.strip()
    for meta in metas:
        url = meta.get("sourceUrl") if isinstance(meta, dict) else None
        match = LINEAR_LINK_RE.match(url) if isinstance(url, str) else None
        if match:
            return match[1]
    return None


def run_ticket(meta: dict[str, Any], read_start_prompt: Callable[[], str | None], workspace: str | None) -> dict[str, Any] | None:
    """The run's Linear ticket as {ref, url}: its recorded source link, else a
    Linear source key or the branch's `<author>/<ref>/...` slot. Runs launched
    before sourceUrl was recorded keep the link in their start prompt."""
    source_url = meta.get("sourceUrl")
    linked = LINEAR_LINK_RE.match(source_url) if isinstance(source_url, str) else None
    if linked:
        return {"ref": linked[2].upper(), "url": "https://linear.app/%s/issue/%s" % (linked[1], linked[2].upper())}
    source_ref = meta.get("sourceRef")
    segment = meta.get("branch").split("/") if isinstance(meta.get("branch"), str) else []
    if meta.get("source") == "linear" and isinstance(source_ref, str) and LINEAR_REF_RE.match(source_ref):
        ref = source_ref.upper()
    elif len(segment) > 2 and LINEAR_REF_RE.match(segment[1]):
        ref = segment[1].upper()
    else:
        return None
    for match in LINEAR_LINK_RE.finditer(read_start_prompt() or ""):
        if match[2].upper() == ref:
            workspace = match[1]
            break
    return {"ref": ref, "url": "https://linear.app/%s/issue/%s" % (workspace, ref) if workspace else None}


def run_review_posts(urls: list[str], posts: dict[str, Any]) -> list[dict[str, Any]]:
    """The Slack review post of each PR a run links, in link order. PRs with
    no post in the channel are left out."""
    result = []
    for url in urls:
        post = posts.get(key_for_url(url) or "")
        if post and post.get("permalink"):
            item = {"prUrl": url, "channel": post["channel"],
                    "permalink": post["permalink"], "state": post["state"]}
            if post.get("by"):
                item["by"] = post["by"]
            result.append(item)
    return result


def review_approved(meta: dict[str, Any], approved: set[str]) -> bool:
    """Whether a local review run's PR is one you have approved on GitHub."""
    review = meta.get("review") if meta.get("route") == "local-review" else None
    url = review.get("prUrl") if isinstance(review, dict) else None
    return isinstance(url, str) and key_for_url(url) in approved


def runs_ready_to_open(runs_dir: str | os.PathLike[str],
                       accept_project: Callable[[str], bool] | None = None) -> list[dict[str, Any]]:
    """Orc runs here waiting at the Ship gate with a PR body written and no
    PR opened yet, newest first."""
    rows = []
    try:
        entries = list(os.scandir(runs_dir))
    except OSError:
        return rows
    for entry in entries:
        if entry.name.startswith("."):
            continue
        path = os.path.join(entry.path, "meta.json")
        try:
            mtime = os.stat(path).st_mtime
            with open(path) as handle:
                meta = json.load(handle)
        except (OSError, ValueError):
            continue
        if (not isinstance(meta, dict) or meta.get("phase") != "ship" or meta.get("status") != "awaiting-gate"
                or meta.get("route") == "local-review" or linked_urls(meta)):
            continue
        bodies = [os.path.join(entry.path, "pr-body.md")] + glob.glob(os.path.join(entry.path, "pr-body-*.md")) \
            + glob.glob(os.path.join(entry.path, "delivery", "*", "pr-body.md"))
        gate = next((body for body in bodies if os.path.isfile(body)), None)
        if gate is None:
            continue
        project = meta.get("mainRepoPath") or meta.get("repoPath") or ""
        project_str = project if isinstance(project, str) else ""
        if accept_project is not None and not accept_project(project_str):
            continue
        rows.append({"runId": entry.name, "title": meta.get("title") or entry.name,
                     "project": os.path.basename(project_str.rstrip("/")),
                     "branch": meta.get("branch") if isinstance(meta.get("branch"), str) else None,
                     "gate": os.path.relpath(gate, entry.path).replace(os.sep, "/"),
                     "updatedAt": iso(mtime)})
    return sorted(rows, key=lambda row: row["updatedAt"], reverse=True)


def review_branch(number: int | str) -> str:
    return "orc-review/pr-%d" % int(number)


# A run nested under the run that built a PR reads that run first. Feedback
# cards and the Pull requests page's Resolve the conflict button send
# it, and a launch whose parent run is gone strips it again.
BUILT_RUN_FOLLOW_UP = ("This follows up run %s, which built the pull request: read ~/.orc/runs/%s first for "
                       "its context. ")


def conflict_prompt(pr: dict[str, Any]) -> str:
    """What a run resolving `pr`'s merge conflict with its base is told.
    Conflict cards and the PR page's Resolve the conflict button send
    the same words, so both routes behave the same."""
    base = pr.get("baseRef") or "the base branch"
    return ("Resolve the merge conflict between %s and %s on pull request %s (\"%s\"): merge origin/%s "
            "into the branch, resolve each conflict keeping both sides' intent, run the repository's "
            "checks and stop before pushing." % (pr.get("headRef") or "the branch", base, pr["url"],
                                                 pr["title"], base))


def review_where(number: int | str, base_ref: str) -> str:
    """Where a PR review finds the PR: without the base, init falls
    back to origin/HEAD, the wrong diff for a stacked PR."""
    return "It is checked out here on branch %s; compare it against origin/%s." % (review_branch(number), base_ref)
