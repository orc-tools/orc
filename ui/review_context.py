"""Identify repositories and locate their review guidance."""

import os
from pathlib import Path
import re
import subprocess

PR_URL = re.compile(r"https://github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)")
# A server started from a git hook inherits GIT_INDEX_FILE=.git/index, which
# breaks `git -C <worktree>` because a worktree's .git is a file.
HOOK_GIT_ENV = ("GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE",
                "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES")


def orc_home():
    return Path(os.environ.get("ORC_HOME", "~/.orc")).expanduser()


def github_slug(remote):
    match = re.search(r"github\.com[:/]([\w.-]+/[\w.-]+?)(?:\.git)?/?$", remote or "")
    return match.group(1).lower() if match else None


def _git(repo, *args):
    env = {k: v for k, v in os.environ.items() if k not in HOOK_GIT_ENV}
    done = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True,
                          env=env)
    return done.stdout.strip() if done.returncode == 0 else None


def github_origin(repo):
    remote = _git(repo, "config", "--get-all", "remote.origin.url")
    match = re.fullmatch(
        r"(?:(?:https?|ssh|git)://(?:[^/@:\s]+@)?github\.com/|(?:[^/@:\s]+@)?github\.com:)"
        r"([a-z0-9-]+/[a-z0-9_.-]+?)(?:\.git)?/?",
        remote or "",
        re.IGNORECASE | re.ASCII,
    )
    return match.group(1).lower() if match else None


def repository(repo):
    """The checkout's GitHub owner/repo. A clone without a GitHub origin files
    under local/<main checkout name>, so its worktrees still share one file."""
    common = _git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if common is None:
        raise ValueError("%s is not a Git checkout" % repo)
    slug = github_slug(_git(repo, "remote", "get-url", "origin"))
    if slug:
        return slug
    main = Path(common).parent if Path(common).name == ".git" else Path(repo)
    return "local/" + main.resolve().name.lower()


def path_for(slug):
    return orc_home() / "review" / "projects" / (slug + ".md")
