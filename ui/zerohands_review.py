"""Zerohands' review of one pull request, for the Pull request panel's
Zerohands row. An enabled package's `pullRequestReviewer` names the reviewer:
a run of its `workflow` in its `repository` titled `Review <owner>/<repo>#<n>`
reviews that PR, then posts its verdict as a review on the PR by an account
whose login starts with its `login`. This reads both through `gh` and says
which state the newest review is in.

Read-only and best effort: with no reviewer package enabled, without `gh`,
signed out, without access to the reviewer's repository, or with no run for
the PR, `status` returns None and the panel draws no row. One run listing is
shared by every PR for CACHE_SECONDS, and each call has a short timeout
because it sits inside the panel's own read.

A reviewer that names a `requestComment` can also be asked for a fresh
review: `request_review` posts that one line on the PR as the signed-in
person, the PR comments tab's one write of its own (an explicit click). It
waits while a feedback round's fixes are unpushed (`request_hold`)."""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from typing import Any

import integrations
from app_plugins import Registry
from stat_cache import keep_recent

RUN_LIMIT = 100
CACHE_SECONDS = 30
GH_TIMEOUT = 8
POST_TIMEOUT = 20
# A second click this soon after a request posts nothing: the first one is
# still starting the reviewer's run.
REQUEST_COOLDOWN_SECONDS = 60
PASS = "✅ Looks good to merge"
QUEUED = {"queued", "waiting", "pending", "requested"}
DONE = {"success", "neutral", "skipped"}
# "Review with Codex a second time" and "Try to break the change with Claude"
# both read as that reviewer still running.
REVIEWER_RE = re.compile(r"\bwith (Claude|Codex)\b")

_lock = threading.Lock()
_runs_cache: tuple[float, tuple[str, str], list[dict[str, Any]] | None] | None = None
_jobs_cache: dict[int, tuple[float, list[str]]] = {}
_comment_counts: dict[str, int | None] = {}


def reviewer() -> dict[str, str] | None:
    """The enabled package's pull request reviewer, or None without one."""
    try:
        return Registry().pull_request_reviewer()
    except Exception:  # a broken package registry only costs the panel this row
        return None


def _gh(args: list[str], timeout: int = GH_TIMEOUT) -> Any:
    env = dict(os.environ, GH_PROMPT_DISABLED="1", GIT_TERMINAL_PROMPT="0")
    integrations.note("run-pr-panel")
    try:
        result = subprocess.run(["gh", *args], env=env, capture_output=True,
                                text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except ValueError:
        return None


def _runs(repo: str, workflow: str, now: float) -> list[dict[str, Any]] | None:
    """The newest runs of `workflow` in `repo`, or None when gh cannot list
    them. A failure is cached like a listing, so a missing gh or access costs
    one call per window."""
    global _runs_cache
    with _lock:
        if _runs_cache and _runs_cache[1] == (repo, workflow) and now - _runs_cache[0] < CACHE_SECONDS:
            return _runs_cache[2]
    runs = _gh(["run", "list", "-R", repo, "--workflow", workflow, "--limit", str(RUN_LIMIT),
                "--json", "databaseId,displayTitle,status,conclusion,createdAt,startedAt"])
    runs = [run for run in runs if isinstance(run, dict)] if isinstance(runs, list) else None
    with _lock:
        _runs_cache = (now, (repo, workflow), runs)
    return runs


def _running_reviewers(repo: str, run_id: int, now: float) -> list[str]:
    with _lock:
        hit = _jobs_cache.get(run_id)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]
    view = _gh(["run", "view", str(run_id), "-R", repo, "--json", "jobs"])
    jobs = view.get("jobs") if isinstance(view, dict) else None
    names: list[str] = []
    for job in jobs if isinstance(jobs, list) else []:
        if not isinstance(job, dict) or (job.get("status") or "").lower() != "in_progress":
            continue
        name = job.get("name") or ""
        match = REVIEWER_RE.search(name)
        name = match.group(1) if match else name
        if name and name not in names:
            names.append(name)
    with _lock:
        keep_recent(_jobs_cache, run_id, (now, names), RUN_LIMIT)
    return names


def _comment_count(review_id: str) -> int | None:
    """Inline comments on a posted review, reused while it is in the cache."""
    with _lock:
        if review_id in _comment_counts:
            return _comment_counts[review_id]
    data = _gh(["api", "graphql", "-f",
                "query=query($id:ID!){node(id:$id){... on PullRequestReview{comments{totalCount}}}}",
                "-f", f"id={review_id}"])
    try:
        count = int(data["data"]["node"]["comments"]["totalCount"])
    except (KeyError, TypeError, ValueError):
        return None
    with _lock:
        keep_recent(_comment_counts, review_id, count, RUN_LIMIT)
    return count


def _verdict(reviews: Any, login: str, since: str) -> dict[str, Any]:
    """What the reviewer's newest review posted since `since` says."""
    mine = [review for review in (reviews if isinstance(reviews, list) else [])
            if isinstance(review, dict) and isinstance(review.get("author"), dict)
            and str(review["author"].get("login") or "").lower().startswith(login.lower())
            and (review.get("submittedAt") or "") >= since]
    if not mine:
        return {"state": "done"}
    review = max(mine, key=lambda item: item.get("submittedAt") or "")
    if (review.get("body") or "").lstrip().startswith(PASS):
        return {"state": "passed"}
    count = _comment_count(review["id"]) if review.get("id") else None
    return {"state": "commented", "comments": count}


def status(owner_repo: str, number: int | str, reviews: Any = None,
           now: float | None = None, config: dict[str, str] | None = None) -> dict[str, Any] | None:
    """The reviewer's newest review of `owner_repo#number`, or None when there
    is none to show. `reviews` is the PR's `reviews` as `gh pr view` gives them;
    `config` is the reviewer (default: the enabled package's)."""
    if not owner_repo or not number:
        return None
    config = reviewer() if config is None else config
    if not config:
        return None
    repo = config["repository"]
    now = time.time() if now is None else now
    runs = _runs(repo, config["workflow"], now)
    title = f"review {owner_repo}#{number}".lower()
    matches = [run for run in runs or [] if str(run.get("displayTitle") or "").strip().lower() == title]
    if not matches:
        return None
    run = max(matches, key=lambda item: str(item.get("createdAt") or ""))
    run_id = run.get("databaseId")
    if not isinstance(run_id, int):
        return None
    # A re-run keeps its createdAt; startedAt is when this attempt began.
    started = str(run.get("startedAt") or run.get("createdAt") or "")
    out = {"url": f"https://github.com/{repo}/actions/runs/{run_id}", "startedAt": started or None}
    state = (run.get("status") or "").lower()
    if state in QUEUED:
        return {**out, "state": "queued"}
    if state != "completed":
        return {**out, "state": "reviewing", "running": _running_reviewers(repo, run_id, now)}
    if (run.get("conclusion") or "").lower() not in DONE:
        return {**out, "state": "failed"}
    return {**out, **_verdict(reviews, config["login"], started)}


def request_model(meta: dict[str, Any], pr_url: str,
                  config: dict[str, str] | None = None) -> dict[str, Any] | None:
    """What the PR comments tab's Request review button shows for this PR, or
    None when there is no PR or the reviewer takes no request comment."""
    config = reviewer() if config is None else config
    comment = str((config or {}).get("requestComment") or "").strip()
    if not pr_url or not comment:
        return None
    login = str(config.get("login") or "").strip()
    name = login[:1].upper() + login[1:] if login else "the reviewer"
    last = meta.get("reviewRequest")
    requested = (last.get("at") if isinstance(last, dict) and last.get("pr") == pr_url
                 and isinstance(last.get("at"), str) else None)
    return {"name": name, "label": "Request %s review" % name, "comment": comment,
            "requestedAt": requested, "hold": request_hold(meta, name)}


def request_hold(meta: dict[str, Any], name: str) -> str | None:
    """Why a review request waits, or None while it may go out. An open
    feedback round's fixes are not on GitHub until its push, so a request
    before then has the reviewer read the code it already reviewed."""
    feedback = meta.get("prFeedback")
    state = feedback.get("state") if isinstance(feedback, dict) else None
    if state == "awaiting-answers":
        return "Start the fixes first. %s can review again once they are pushed." % name
    if state == "awaiting-push":
        return "Push the fixes first, so %s reviews them." % name
    return None


def recently_requested(meta: dict[str, Any], pr_url: str, now: float) -> bool:
    last = meta.get("reviewRequest")
    stamp = last.get("epoch") if isinstance(last, dict) and last.get("pr") == pr_url else None
    return (isinstance(stamp, (int, float)) and not isinstance(stamp, bool)
            and 0 <= now - stamp < REQUEST_COOLDOWN_SECONDS)


def request_review(pr_url: str, config: dict[str, str] | None = None) -> str | None:
    """Post the reviewer's request comment on `pr_url` as the signed-in
    person. Returns None once it posted, else why it did not."""
    config = reviewer() if config is None else config
    comment = str((config or {}).get("requestComment") or "").strip()
    if not comment:
        return "No reviewer that takes a review request is enabled."
    if not pr_url.startswith("https://"):
        return "This run has no pull request."
    env = dict(os.environ, GH_PROMPT_DISABLED="1", GIT_TERMINAL_PROMPT="0")
    integrations.note("actions")
    try:
        result = subprocess.run(["gh", "pr", "comment", pr_url, "--body", comment], env=env,
                                capture_output=True, text=True, timeout=POST_TIMEOUT, check=False)
    except FileNotFoundError:
        return "The GitHub CLI (gh) is not installed."
    except (OSError, subprocess.SubprocessError):
        return "GitHub did not answer in time. Try again."
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip().splitlines()
        return "GitHub refused the comment" + (": " + detail[-1] if detail else ".")
    return None
