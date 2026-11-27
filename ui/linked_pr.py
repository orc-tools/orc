"""The pull request a single-repository run already has."""

import json
import os
import re
import subprocess

import integrations

GITHUB_PULL_URL_RE = re.compile(r"https://github\.com/[^/]+/[^/]+/pull/\d+")
GH_TIMEOUT = 20


def linked_pr_url(meta):
    """The PR a single-repository run already has, or None.

    Two ways to have one: a step recorded it (`prUrl`/`prUrls`), or the run was
    *seeded from* it (`source: "pr"` — the route that fixes an open PR's review
    comments and works on that PR's own branch). The second kind never reaches
    `prUrl`, and offering to create a PR there pushes and then dies in
    `gh pr create`, because the branch already has one.

    Grouped/manifest delivery reconciles its own per-repository PRs and is never
    this."""
    if meta.get("delivery") is not None:
        return None
    repositories = meta.get("repositories")
    if isinstance(repositories, list) and len(repositories) > 1:
        return None
    urls = meta.get("prUrls") if isinstance(meta.get("prUrls"), list) \
        else [meta.get("prUrl")]
    for url in urls:
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            return url
    source = meta.get("sourceUrl")
    return source if meta.get("source") == "pr" and isinstance(source, str) \
        and GITHUB_PULL_URL_RE.fullmatch(source) else None


def open_pr_for_branch(repo, branch):
    """The open same-repository PR whose head is `branch`, or None.

    A branch Orc created for the run has no remote-tracking ref until its first
    push, and a branch with no remote ref has no PR, so that case never reaches
    GitHub. Any gh failure reads as no PR: the caller then offers Open PR, which
    is what it offered before this lookup existed."""
    if not isinstance(repo, str) or not isinstance(branch, str) or not branch.strip():
        return None
    repo, branch = os.path.expanduser(repo), branch.strip()
    try:
        tracked = subprocess.run(
            ["git", "-C", repo, "rev-parse", "--verify", "--quiet",
             "refs/remotes/origin/%s^{commit}" % branch],
            capture_output=True, timeout=5, check=False)
        if tracked.returncode != 0:
            return None
        return query_open_pr(repo, branch)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def query_open_pr(repo, branch, slug=None):
    command = ["gh", "pr", "list", "--head", branch, "--state", "open",
               "--json", "url,headRefName,isCrossRepository"]
    if slug:
        command.extend(["--repo", slug])
    integrations.note("run-prs")
    result = subprocess.run(command, cwd=repo, env=dict(os.environ, GH_PROMPT_DISABLED="1"),
                            capture_output=True, text=True, timeout=GH_TIMEOUT, check=True)
    rows = json.loads(result.stdout)
    if not isinstance(rows, list):
        raise ValueError("GitHub returned an invalid PR list")
    matches = []
    for row in rows:
        if (isinstance(row, dict) and row.get("headRefName") == branch
                and row.get("isCrossRepository") is False
                and isinstance(row.get("url"), str)
                and GITHUB_PULL_URL_RE.fullmatch(row["url"])):
            matches.append(row["url"])
    if len(matches) > 1:
        raise ValueError("multiple open PRs use the run branch")
    return next(iter(matches), None)


def branch_pr_to_link(meta):
    """The open PR to record on a run that has none linked yet, or None."""
    if meta.get("delivery") is not None or linked_pr_url(meta):
        return None
    repositories = meta.get("repositories")
    if isinstance(repositories, list) and len(repositories) > 1:
        return None
    return open_pr_for_branch(meta.get("repoPath"), meta.get("branch"))


def cli_delivery_supported(meta):
    return (meta.get("lifecycleVersion") == 4 and len(meta.get("prUrls") or []) <= 1
            and meta.get("delivery") is None and len(meta.get("repositories") or []) <= 1
            and meta.get("route") not in {"orchestration-worker", "local-review",
                                          "meeting-prep", "evals", "planning-session"})
