#!/usr/bin/env python3
"""Orc's release version: the VERSION file and CHANGELOG.md at the repo root.

Both files travel with the code, so a checkout or packaged release always
reports the version of the commit it actually holds. orc-merge-main writes the
next version and its changelog entry inside each merge commit; the git hooks in
hooks/git and the merge drivers installed by install.sh keep two machines from
publishing different code under one number.

Every new number is claimed from the Worker in cloud/project-memory when this
machine is set up for it, so two machines releasing from the same version get
different numbers. A machine that cannot reach the Worker numbers locally.

Subcommands, for git to call:
  merge-version   <base> <ours> <theirs>  merge driver for VERSION
  merge-changelog <base> <ours> <theirs>  merge driver for CHANGELOG.md
  reconcile-merge                         pre-commit: a hand-finished merge's bump
  reconcile-merged                        post-merge: a release commit after a merge
  pre-push <remote> [<url>]               hold a main push that doesn't bump and
                                          add its release commit
  bump [--since <rev>]                    write the next version by hand
  claims                                  list the numbers the Worker handed out
"""

from __future__ import annotations

import datetime
import os
import re
import subprocess
import sys
import urllib.parse

VERSION_FILE = "VERSION"
CHANGELOG_FILE = "CHANGELOG.md"
DEFAULT_BRANCH_REF = "refs/heads/main"
ZERO_SHA = re.compile(r"^0+$")
SEMVER_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")
HEADING_RE = re.compile(r"^## (v\d+\.\d+\.\d+)(?: \((\d{4}-\d{2}-\d{2})\))?\s*$")
RUN_LINE_RE = re.compile(r"^Run:\s+(\S+)\s*$")
CHANGELOG_HEADER = (
    "# Changelog\n\n"
    "Orc's releases, newest first. orc-merge-main adds an entry and bumps\n"
    "VERSION inside each merge commit.\n"
)

PATCH, MINOR, MAJOR = 0, 1, 2
LEVEL_NAMES = {PATCH: "patch", MINOR: "minor", MAJOR: "major"}
CLAIM_TIMEOUT = 5  # seconds a release waits on the Worker before numbering locally


def parse(text):
    """(major, minor, patch) from VERSION file text or a v-label, else None."""
    match = SEMVER_RE.match((text or "").strip())
    return tuple(int(part) for part in match.groups()) if match else None


def label(version):
    return "v%d.%d.%d" % version


def file_text(version):
    return "%d.%d.%d\n" % version


def bump(version, level):
    major, minor, patch = version
    if level == MAJOR:
        return (major + 1, 0, 0)
    if level == MINOR:
        return (major, minor + 1, 0)
    return (major, minor, patch + 1)


def _worker(repo):
    """(sync client, Worker URL, token, project key, config dir) for this
    checkout's claims, or None when it numbers locally: no GitHub origin, no
    Worker set up, or a run store other than the real one, so a test or
    preview never takes one of the project's numbers."""
    config_dir = os.path.expanduser(os.environ.get("ORC_HOME", "~/.orc"))
    runs = os.environ.get("ORC_RUNS_DIR")
    if runs and os.path.realpath(runs) != os.path.realpath(os.path.join(config_dir, "runs")):
        return None
    try:
        import cloud_worker as worker
        import review_context
    except ImportError:
        return None  # a checkout that holds this file without the rest of ui/
    try:
        slug = review_context.repository(repo)
    except (ValueError, OSError):
        return None
    if slug.startswith("local/"):
        return None
    base, token = worker.credentials(config_dir)
    return (worker, base, token, "github:" + slug, config_dir) if base else None


def _claim(repo, current, level):
    worker = _worker(repo)
    if not worker:
        return None
    cloud, base, token, project, config_dir = worker
    answer = cloud.request(base, token, "POST", "/v1/versions/claim", {
        "project": project, "level": LEVEL_NAMES[level], "floor": file_text(current).strip(),
        "machine": cloud.machine_id(config_dir),
    }, timeout=CLAIM_TIMEOUT)
    return parse(answer.get("version"))


def next_version(repo, current, level):
    """The version after `current`: the Worker's claim when there is one, so no
    other machine gets the same number, else the local bump."""
    try:
        claimed = _claim(repo, current, level)
    except Exception as exc:  # noqa: BLE001 — a failed claim must never stop a release
        print("orc: version not claimed (%s); numbered locally" % exc, file=sys.stderr)
        claimed = None
    return claimed if claimed and claimed > current else bump(current, level)


def print_claims(repo):
    """The `claims` subcommand: what the Worker has handed out for this project."""
    try:
        worker = _worker(repo)
        if not worker:
            print("This checkout numbers its releases locally: it has no GitHub "
                  "origin, or this machine has no Worker set up.")
            return 1
        sync, base, token, project, _ = worker
        answer = sync.request(base, token, "GET", "/v1/versions?project="
                              + urllib.parse.quote(project, safe=""), timeout=CLAIM_TIMEOUT)
    except Exception as exc:  # noqa: BLE001 — every failure reads the same to the caller
        print("orc: the Worker's claims could not be read: %s" % exc, file=sys.stderr)
        return 1
    print("%s: newest claim %s" % (project, answer["latest"] or "none yet"))
    for row in answer["claims"]:
        claimed = datetime.datetime.fromtimestamp(row["claimedAt"] / 1000)
        print("  v%s  %s  machine %s" % (
            row["version"], claimed.strftime("%Y-%m-%d %H:%M"), row["machine"] or "unknown"))
    return 0


def release_level(commits):
    """Conventional-commit bump level for (subject, body) pairs."""
    level = PATCH
    for subject, body in commits:
        head_type = subject.split(":", 1)[0] if ":" in subject else ""
        if "!" in head_type or "BREAKING CHANGE" in body or "BREAKING-CHANGE" in body:
            return MAJOR
        if re.match(r"^feat(\(|:)", subject):
            level = MINOR
    return level


def today():
    return datetime.date.today().isoformat()


def render_entry(version_label, date, changes, run_id=None):
    lines = ["## %s (%s)" % (version_label, date)]
    if run_id:
        lines.append("Run: %s" % run_id)
    lines.append("")
    lines.extend("- %s" % change for change in changes or ["(no conventional commits)"])
    return "\n".join(lines) + "\n"


def _split_changelog(text):
    """Header text plus one raw block per `## vX.Y.Z` heading, in file order."""
    header, blocks, current = [], [], None
    for line in (text or "").splitlines(keepends=True):
        if HEADING_RE.match(line.rstrip("\n")):
            current = [line]
            blocks.append(current)
        elif current is None:
            header.append(line)
        else:
            current.append(line)
    return "".join(header), ["".join(block).strip("\n") + "\n" for block in blocks]


def _join_changelog(header, blocks):
    header = header.strip("\n") or CHANGELOG_HEADER.strip("\n")
    return "\n\n".join([header] + [block.strip("\n") for block in blocks]) + "\n"


def add_entry(text, entry):
    """Put one rendered entry above every existing release."""
    header, blocks = _split_changelog(text)
    return _join_changelog(header, [entry] + blocks)


def parse_changelog(text):
    """Releases as the Settings changelog wants them, newest first."""
    releases = []
    for block in _split_changelog(text)[1]:
        lines = block.splitlines()
        match = HEADING_RE.match(lines[0])
        release = {"version": match.group(1), "date": match.group(2) or "",
                   "changes": []}
        for line in lines[1:]:
            stripped = line.strip()
            run = RUN_LINE_RE.match(stripped)
            if run and "runId" not in release:
                release["runId"] = run.group(1)
            elif stripped.startswith("- "):
                release["changes"].append(stripped[2:].strip())
        releases.append(release)
    return releases


def _block_version(block):
    match = HEADING_RE.match(block.splitlines()[0])
    return parse(match.group(1)) if match else (0, 0, 0)


def merge_changelog_text(base, ours, theirs):
    """Union of both sides' releases. The changelog only ever gains entries, so
    a concurrent release on each machine keeps both."""
    header, ours_blocks = _split_changelog(ours)
    base_blocks = set(_split_changelog(base)[1])
    theirs_blocks = _split_changelog(theirs)[1]
    added = [block for block in ours_blocks if block not in base_blocks]
    added += [block for block in theirs_blocks
              if block not in base_blocks and block not in ours_blocks]
    added.sort(key=_block_version, reverse=True)
    kept = [block for block in ours_blocks if block in base_blocks]
    return _join_changelog(header, added + kept)


def git(repo, *args, check=False, timeout=None):
    return subprocess.run(["git", "-C", str(repo), *args], text=True,
                          capture_output=True, check=check, timeout=timeout)


def read_at(repo, rev, path):
    result = git(repo, "show", "%s:%s" % (rev, path))
    return result.stdout if result.returncode == 0 else None


def version_at(repo, rev):
    return parse(read_at(repo, rev, VERSION_FILE) or "")


def _read(path):
    try:
        with open(path) as handle:
            return handle.read()
    except OSError:
        return ""


def _write(path, text):
    with open(path, "w") as handle:
        handle.write(text)


def merge_version_driver(base_path, ours_path, theirs_path):
    """Both sides released: the merge is newer than either, by one patch."""
    ours, theirs = parse(_read(ours_path)), parse(_read(theirs_path))
    if ours is None or theirs is None:
        return 1  # leave an unreadable VERSION as an ordinary conflict
    _write(ours_path, file_text(next_version(".", max(ours, theirs), PATCH)))
    return 0


def merge_changelog_driver(base_path, ours_path, theirs_path):
    _write(ours_path, merge_changelog_text(
        _read(base_path), _read(ours_path), _read(theirs_path)))
    return 0


def _merge_release(repo, ours_rev, merged_rev):
    """(version, changelog text) a merge needs when it brings in another
    machine's release, else None. Every changelog entry the merge has and our
    side lacks came from the other side, since the changelog only grows."""
    ours = version_at(repo, ours_rev)
    ours_blocks = set(_split_changelog(read_at(repo, ours_rev, CHANGELOG_FILE) or "")[1])
    changelog = read_at(repo, merged_rev, CHANGELOG_FILE) or ""
    incoming = [_block_version(block) for block in _split_changelog(changelog)[1]
                if block not in ours_blocks]
    if not incoming or ours is None:
        return None
    newest = max([ours] + incoming)
    merged = parse(read_at(repo, merged_rev, VERSION_FILE) or "")
    target = merged if merged is not None and merged > newest \
        else next_version(repo, newest, PATCH)
    if any(release["version"] == label(target) for release in parse_changelog(changelog)):
        return (None if target == merged else target), changelog
    changes = ["chore: merge release %s into %s" % (label(max(incoming)), label(ours))]
    return target, add_entry(changelog, render_entry(label(target), today(), changes))


def _write_release(repo, target, changelog):
    if target is not None:
        _write(os.path.join(repo, VERSION_FILE), file_text(target))
    _write(os.path.join(repo, CHANGELOG_FILE), changelog)
    git(repo, "add", VERSION_FILE, CHANGELOG_FILE, check=True)


def _on_main(repo):
    return git(repo, "symbolic-ref", "-q", "HEAD").stdout.strip() == DEFAULT_BRANCH_REF


def reconcile_merge(repo):
    """pre-commit for a merge finished by hand: put the bump in the merge
    itself. Only main releases, as in reconcile_merged: a run branch that
    resolves a conflict with main by hand would otherwise carry a release of
    its own into orc-merge-main."""
    if not _on_main(repo) or git(repo, "rev-parse", "-q", "--verify", "MERGE_HEAD").returncode:
        return 0
    release = _merge_release(repo, "HEAD", "")
    if release:
        _write_release(repo, *release)
    return 0


def reconcile_merged(repo):
    """post-merge: git ignores index changes made before an automatic merge
    commit, so a merge that brought in another machine's release gets a
    release commit right after it. Git skips merge drivers when both sides made
    the identical change, so two machines that each released v1.151.0 would
    otherwise merge to v1.151.0 and the push would be refused. Only main
    releases: on a run branch orc-merge-main versions the merge into main, and
    it refuses a branch that gained any commit other than a merge of main."""
    if not _on_main(repo):
        return 0
    if git(repo, "rev-parse", "-q", "--verify", "HEAD^2").returncode:
        return 0  # fast-forward or squash: no second side
    release = _merge_release(repo, "HEAD^1", "HEAD")
    if not release:
        return 0
    _write_release(repo, *release)
    version = release[0] or parse(read_at(repo, "", VERSION_FILE) or "")
    # Hooks off: the caller's post-merge runs the reinstall check for this commit.
    git(repo, "-c", "core.hooksPath=/dev/null", "commit", "--no-verify", "-q",
        "-m", "chore(release): %s" % label(version), check=True)
    return 0


def release_for_push(repo, local_sha, remote_sha):
    """Commit the bump an unbumped push of main lacks, on top of HEAD. Returns
    the new version, or None when the pushed commit isn't HEAD or VERSION and
    CHANGELOG.md hold edits of their own. Git has already chosen what this push
    sends, so the release commit goes out with the next push."""
    if git(repo, "rev-parse", "HEAD").stdout.strip() != local_sha:
        return None
    if git(repo, "status", "--porcelain", "--", VERSION_FILE, CHANGELOG_FILE).stdout.strip():
        return None
    target = bump_worktree(repo, remote_sha)
    # --only keeps anything already staged out of the release commit. Hooks off,
    # as in reconcile_merged: neither file is an install input.
    git(repo, "-c", "core.hooksPath=/dev/null", "commit", "--no-verify", "-q",
        "-m", "chore(release): %s" % label(target),
        "--only", "--", VERSION_FILE, CHANGELOG_FILE, check=True)
    return target


def check_push(repo, updates, branch_ref=DEFAULT_BRANCH_REF, release=False):
    """None when every push of main raises VERSION, else why not. With release,
    an unbumped push of HEAD gets its release commit added for the next push."""
    for line in updates.splitlines():
        fields = line.split()
        if len(fields) != 4 or fields[2] != branch_ref:
            continue
        local_sha, remote_sha = fields[1], fields[3]
        if ZERO_SHA.match(local_sha) or ZERO_SHA.match(remote_sha) \
                or local_sha == remote_sha:
            continue
        if git(repo, "cat-file", "-e", remote_sha + "^{commit}").returncode:
            return ("the remote main has commits this checkout hasn't fetched. "
                    "Pull main, then push again.")
        remote = version_at(repo, remote_sha)
        if remote is None:
            continue
        local = version_at(repo, local_sha)
        if local is None or local <= remote:
            released = release_for_push(repo, local_sha, remote_sha) if release else None
            if released:
                return ("main's VERSION wasn't bumped, so this push sent nothing and "
                        "added release commit %s on top. Push again to send it."
                        % label(released))
            return ("main's VERSION (%s) must be newer than the remote's (%s). "
                    "Pull main, run `python3 ui/release_version.py bump`, "
                    "commit VERSION and CHANGELOG.md, then push again."
                    % (label(local) if local else "missing", label(remote)))
    return None


def bump_worktree(repo, since):
    """Write the next version for the commits after `since` into the work tree."""
    log = git(repo, "log", "--no-merges", "--format=%s%x00%b%x1e",
              "%s..HEAD" % since, check=True).stdout
    commits = []
    for entry in log.split("\x1e"):
        subject, _, body = entry.strip("\n").partition("\x00")
        if subject.strip():
            commits.append((subject.strip(), body))
    current = max([v for v in (version_at(repo, "HEAD"), version_at(repo, since)) if v],
                  default=(0, 0, 0))
    target = next_version(repo, current, release_level(commits))
    _write(os.path.join(repo, VERSION_FILE), file_text(target))
    path = os.path.join(repo, CHANGELOG_FILE)
    _write(path, add_entry(_read(path), render_entry(
        label(target), today(), [subject for subject, _ in commits])))
    return target


def main(argv):
    command, args = (argv[1], argv[2:]) if len(argv) > 1 else ("", [])
    if command == "merge-version" and len(args) == 3:
        return merge_version_driver(*args)
    if command == "merge-changelog" and len(args) == 3:
        return merge_changelog_driver(*args)
    repo = git(".", "rev-parse", "--show-toplevel").stdout.strip() or "."
    if command == "reconcile-merge" and not args:
        return reconcile_merge(repo)
    if command == "reconcile-merged" and not args:
        return reconcile_merged(repo)
    if command == "pre-push" and 1 <= len(args) <= 2:
        problem = check_push(repo, sys.stdin.read(), release=True)
        if problem:
            print("orc: push rejected: %s" % problem, file=sys.stderr)
            return 1
        return 0
    if command == "claims" and not args:
        return print_claims(repo)
    if command == "bump" and (not args or (len(args) == 2 and args[0] == "--since")):
        since = args[1] if args else (
            git(repo, "rev-parse", "--abbrev-ref", "@{upstream}").stdout.strip()
            or "origin/main")
        print("VERSION is now %s; commit VERSION and %s."
              % (label(bump_worktree(repo, since)), CHANGELOG_FILE))
        return 0
    print(__doc__.strip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
