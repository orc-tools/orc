"""Single-pass read-only PR review records for /orc:review and Review in Orc."""

import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
from datetime import datetime, timezone

import integrations
import run_lifecycle
import review_context

ROUTE = "local-review"
PHASE = "local-review"
TAB = "review/recap.html"
SOURCE = "review/recap.mdx"
RESULT = "review/result.json"
TERMINAL = {"complete", "merged", "merged-to-parent", "cancelled"}
QA_ROUTE = "qa"


class ReviewError(ValueError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def is_review(meta):
    return isinstance(meta, dict) and meta.get("route") == ROUTE


def untouched_launch_stub(run_dir, meta):
    """A launch stub nothing has advanced yet."""
    clarification = path_at(run_dir, "grilling.mdx")
    return (not meta.get("route") and meta.get("phase") == "grilling"
            and meta.get("status") == "running"
            and not any(meta.get(key) for key in ("branch", "outcome", "repositories"))
            and not (clarification.exists() and clarification.stat().st_size))


def path_at(run_dir, name):
    root = Path(run_dir).resolve()
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ReviewError("review artifact escapes the run directory")
    return path


def read(run_dir, name):
    path = path_at(run_dir, name)
    try:
        with path.open() as handle:
            value = json.load(handle)
    except (OSError, ValueError) as exc:
        raise ReviewError("missing or malformed " + name) from exc
    if not isinstance(value, dict):
        raise ReviewError(name + " must be an object")
    return run_lifecycle.Snapshot(value) if name == "meta.json" else value


def write(run_dir, name, value, immutable=False):
    path = path_at(run_dir, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    if name == "meta.json":
        try:
            return run_lifecycle.write_meta(path, value, caller="local review")
        except run_lifecycle.RefusedTransition as exc:
            raise ReviewError(str(exc)) from exc
    payload = value if isinstance(value, bytes) else encoded(value)
    if immutable:
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            if path.read_bytes() == payload:
                return
            raise ReviewError(name + " is already frozen")
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        return
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix="." + path.name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


@contextlib.contextmanager
def locked(run_dir):
    path = path_at(run_dir, ".local-review.lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "r+") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def git(repo, *args):
    env = {k: v for k, v in os.environ.items() if k not in review_context.HOOK_GIT_ENV}
    proc = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True,
        env={**env, "GIT_OPTIONAL_LOCKS": "0"}, timeout=30)
    if proc.returncode:
        raise ReviewError("git " + args[0] + " failed: " +
                          proc.stderr.decode(errors="replace").strip()[:240])
    return proc.stdout


def git_text(repo, *args):
    return git(repo, *args).decode(errors="replace").strip()


def main_checkout(repo):
    common = Path(git_text(repo, "rev-parse", "--path-format=absolute", "--git-common-dir"))
    return common.parent if common.name == ".git" else repo


def choose_base(repo, supplied=None):
    if supplied:
        if supplied.startswith("-") or "\n" in supplied:
            raise ReviewError("base must be a Git reference or commit")
        git(repo, "rev-parse", "--verify", supplied + "^{commit}")
        return supplied
    try:
        return git_text(repo, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD")
    except ReviewError:
        for ref in ("origin/main", "main", "origin/master", "master"):
            try:
                git(repo, "rev-parse", "--verify", ref + "^{commit}")
                return ref
            except ReviewError:
                continue
    raise ReviewError("no default branch found; supply --base <ref>")


def _scope_once(repo, base_ref):
    repo = Path(repo).resolve()
    head = git_text(repo, "rev-parse", "HEAD")
    branch = git_text(repo, "rev-parse", "--abbrev-ref", "HEAD")
    base = git_text(repo, "merge-base", head, base_ref)
    patches = {
        "branch": git(repo, "diff", "--no-ext-diff", "--no-textconv", "--no-color",
                      "--binary", "--full-index", base + ".." + head),
        "staged": git(repo, "diff", "--no-ext-diff", "--no-textconv", "--no-color",
                      "--binary", "--full-index", "--cached"),
        "unstaged": git(repo, "diff", "--no-ext-diff", "--no-textconv", "--no-color",
                        "--binary", "--full-index"),
    }
    ranges = ((base + ".." + head,), ("--cached",), ())
    paths = set()
    for selection in ranges:
        paths.update(os.fsdecode(p) for p in git(
            repo, "diff", "--name-only", "-z", *selection).split(b"\0") if p)
    new_paths = {os.fsdecode(p) for p in git(
        repo, "ls-files", "--others", "--exclude-standard", "-z").split(b"\0") if p}
    paths.update(new_paths)
    files, new_contents = [], {}
    for name in sorted(paths):
        if Path(name).is_absolute() or ".." in Path(name).parts:
            raise ReviewError("unsafe Git path")
        path = repo / name
        if not path.parent.resolve().is_relative_to(repo):
            raise ReviewError("changed file has a symlinked parent outside the checkout")
        try:
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode):
                payload = os.fsencode(os.readlink(path))
                kind = "symlink"
            elif stat.S_ISREG(info.st_mode):
                payload = path.read_bytes()
                kind = "file"
            else:
                raise ReviewError("changed path is not a regular file: " + name)
            file_digest = digest(payload)
            mode = stat.S_IMODE(info.st_mode)
        except FileNotFoundError:
            payload, kind, file_digest, mode = b"", "deleted", None, None
        files.append({"path": name, "kind": kind, "sha256": file_digest, "mode": mode})
        if name in new_paths:
            try:
                new_contents[name] = (payload.decode("utf-8") if kind == "file"
                                      and b"\0" not in payload else None)
            except UnicodeDecodeError:
                new_contents[name] = None
    value = {"schemaVersion": 1, "repoPath": str(repo), "baseRef": base_ref,
             "baseCommit": base, "head": head, "branch": branch, "files": files,
             "patchDigests": {k: digest(v) for k, v in patches.items()}}
    value["digest"] = digest(encoded(value))
    if git_text(repo, "rev-parse", "HEAD") != head:
        raise ReviewError("HEAD changed while capturing review scope")
    return value, patches, new_contents


def scope(repo, base_ref):
    first = _scope_once(repo, base_ref)
    second = _scope_once(repo, base_ref)
    if first[0]["digest"] != second[0]["digest"]:
        raise ReviewError("checkout changed while capturing scope; retry with current files")
    return second


def capture_scope(run_dir, meta):
    value, patches, new_contents = scope(meta["repoPath"], meta["review"]["baseRef"])
    for key, payload in patches.items():
        write(run_dir, "review/input-" + key + ".patch", payload, immutable=True)
    write(run_dir, "review/input-new-files.json", new_contents, immutable=True)
    write(run_dir, "review/scope.json", value, immutable=True)
    return value


def active_meta(run_dir):
    meta = read(run_dir, "meta.json")
    if not is_review(meta) or meta.get("status") in TERMINAL:
        raise ReviewError("run is not an active review session")
    if not isinstance(meta.get("review"), dict):
        raise ReviewError("review session has not been initialized")
    return meta


def gh_json(repo, *args):
    env = {k: v for k, v in os.environ.items() if k not in review_context.HOOK_GIT_ENV}
    try:
        integrations.note("actions")
        proc = subprocess.run(["gh", *args], cwd=repo, capture_output=True, env=env, timeout=20)
        return json.loads(proc.stdout) if proc.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None


def named_pull_request(repo, text):
    """The PR URL a request names for this checkout's repository."""
    slug = review_context.repository(repo)
    for found, number in review_context.PR_URL.findall(text or ""):
        if found.lower() == slug:
            return "https://github.com/%s/pull/%s" % (found, number)
    return None


def pull_request_owner(repo, url=None):
    pr = gh_json(repo, "pr", "view", *([url] if url else []), "--json", "number,author,url,title")
    try:
        return pr["number"], pr["author"]["login"], pr.get("url"), pr.get("title")
    except (TypeError, KeyError):
        return None


def review_title(owner, repo):
    if not owner:
        return "Review %s" % repo.name
    title = "Review PR #%s" % owner[0]
    if isinstance(owner[3], str) and owner[3].strip():
        title += ": " + owner[3].strip()
    if len(title) > 60:
        title = title[:59].rsplit(" ", 1)[0] + "…"
    return title


MARKER = re.compile(r"<!--.*?-->", re.S)
BACKGROUND = " (background, not a checklist)"


def review_threads(repo, number):
    """Inline review comments grouped by thread so answered points stay settled."""
    pages = gh_json(repo, "api", "--paginate", "--slurp",
                    "repos/{owner}/{repo}/pulls/%s/comments" % number)
    comments = [comment for page in pages if isinstance(page, list) for comment in page
                if isinstance(comment, dict)] if isinstance(pages, list) else []
    replies = {}
    for comment in comments:
        if comment.get("in_reply_to_id"):
            replies.setdefault(comment["in_reply_to_id"], []).append(comment)
    return "\n\n".join(
        "#### `%s:%s`\n\n%s" % (root.get("path"), root.get("line") or root.get("original_line"),
                                 "\n\n".join("**%s**: %s" % ((c.get("user") or {}).get("login"),
                                                             MARKER.sub("", c.get("body") or "").strip())
                                             for c in [root] + replies.get(root.get("id"), [])))
        for root in comments if not root.get("in_reply_to_id"))


def gathered(repo, base_ref, owner, ticket=None):
    """PR description, background comments/threads, ticket, and commit log."""
    sections = [("Ticket", ticket.strip())] if ticket and ticket.strip() else []
    pr = gh_json(repo, "pr", "view", *([owner[2]] if owner[2] else []),
                 "--json", "number,title,body,comments,reviews") if owner else None
    if isinstance(pr, dict):
        said = sorted(
            [(c.get("createdAt") or "", (c.get("author") or {}).get("login"), None, c.get("body"))
             for c in pr.get("comments") or []]
            + [(r.get("submittedAt") or "", (r.get("author") or {}).get("login"), r.get("state"),
                r.get("body")) for r in pr.get("reviews") or []], key=lambda item: item[0])
        conversation = ["- **%s**%s: %s" % (login, " (%s)" % state if state else "", body.strip())
                        for _at, login, state, body in said if body and body.strip()]
        threads = review_threads(repo, pr.get("number"))
        sections.append(("PR #%s: %s" % (pr.get("number"), pr.get("title") or ""),
                         "\n\n".join([(pr.get("body") or "").strip() or "No description."]
                                     + (["### Earlier comments" + BACKGROUND, "\n".join(conversation)]
                                        if conversation else [])
                                     + (["### Earlier review threads" + BACKGROUND, threads]
                                        if threads else []))))
    base = git_text(repo, "merge-base", "HEAD", base_ref)
    commits = [entry.strip() for entry in
               git_text(repo, "log", "--reverse", "--format=%x00### %s%n%n%b",
                        base + "..HEAD").split("\0") if entry.strip()]
    if commits:
        sections.append(("Commit messages", "\n\n".join(commits)))
    return "".join("\n\n## %s\n\n%s" % section for section in sections)


def initialize(run_dir, repo, harness, base_ref=None, requirements=None, title=None,
               ticket=None, pr=None):
    if harness not in ("claude", "codex"):
        raise ReviewError("PR review supports Claude Code and Codex")
    repo = Path(git_text(repo, "rev-parse", "--show-toplevel")).resolve()
    with locked(run_dir):
        meta_path = path_at(run_dir, "meta.json")
        meta = read(run_dir, "meta.json") if meta_path.exists() else {}
        if is_review(meta) and meta.get("review", {}).get("schemaVersion") == 1:
            return active_meta(run_dir)
        if ((meta and not is_review(meta) and not untouched_launch_stub(run_dir, meta))
                or meta.get("status") in TERMINAL
                or meta.get("lifecycleVersion")
                or path_at(run_dir, "plan.mdx").exists()
                or path_at(run_dir, "inputs/build-spec/authority.json").exists()):
            raise ReviewError("cannot turn another Orc run into a review")
        base_ref = choose_base(repo, base_ref)
        execution = "orchestrated" if meta.get("orchestration") is True else "inline"
        main_path = str(Path(main_checkout(repo)).resolve())
        # Review in Orc names its pull request in the launch stub, so the QA
        # window can walk it before this runs.
        launched = meta.get("review") if isinstance(meta.get("review"), dict) else {}
        meta.update(runId=Path(run_dir).name, route=ROUTE, mode="review",
                    phase=PHASE, status="running", source="local-review",
                    mainRepoPath=main_path, repoPath=str(repo), harness=harness,
                    review={"schemaVersion": 1, "round": 1, "mode": "flag",
                            "state": "reviewing", "baseRef": base_ref,
                            "executionMode": execution})
        if requirements is None:
            original = path_at(run_dir, "inputs/start-prompt.txt")
            requirements = original.read_text() if original.exists() else \
                "Review this pull request."
        named = named_pull_request(repo, pr or requirements)
        owner = pull_request_owner(repo) or (pull_request_owner(repo, named) if named else None)
        slug = review_context.repository(repo)
        meta["review"].update(repository=slug, contextFile=str(review_context.path_for(slug)))
        if owner and isinstance(owner[2], str):
            meta["review"]["prUrl"] = owner[2]
        if owner:
            meta["review"]["prAuthor"] = owner[1]
        for key in ("prUrl", "prAuthor", "prTitle"):
            if isinstance(launched.get(key), str) and not meta["review"].get(key):
                meta["review"][key] = launched[key]
        meta["title"] = (title or review_title(owner, repo))[:60]
        meta.pop("titlePending", None)
        meta.pop("conditional", None)
        captured = capture_scope(run_dir, meta)
        meta["review"]["inputScopeDigest"] = captured["digest"]
        full_requirements = requirements.rstrip() + gathered(repo, base_ref, owner, ticket) + "\n"
        write(run_dir, "review/requirements.md", full_requirements.encode(), immutable=True)
        # Review in Orc's checkout app may have started while the scope was
        # captured, and orc-worktree saved its server under another lock.
        fresh = read(run_dir, "meta.json") if meta_path.exists() else {}
        if isinstance(fresh.get("worktree"), dict):
            meta["worktree"] = fresh["worktree"]
        write(run_dir, "meta.json", meta)
        return meta


def nonempty(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ReviewError(label + " must be non-empty")


def _safe_relpath(value):
    if not isinstance(value, str) or not value.strip():
        return False
    p = Path(value)
    return not p.is_absolute() and ".." not in p.parts


def _scope_digest(candidate):
    if isinstance(candidate.get("scopeDigest"), str):
        return candidate["scopeDigest"]
    initial = candidate.get("inputScopeDigest")
    final = candidate.get("finalScopeDigest")
    if isinstance(initial, str) and (final is None or final == initial):
        return initial
    return None


def _validate_reports(reports, execution, expected_digest):
    if reports is None:
        return []
    if not isinstance(reports, list):
        raise ReviewError("reports must be a list")
    shaped = []
    for report in reports:
        if not isinstance(report, dict):
            raise ReviewError("each report must be an object")
        report = dict(report)
        source = report.setdefault("source", "inline")
        if source not in ("inline", "orchestrator"):
            raise ReviewError("report.source must be inline or orchestrator")
        if source == "orchestrator":
            if execution != "orchestrated":
                raise ReviewError("inline review cannot claim orchestrator reports")
            for field in ("taskId", "workerRunId"):
                nonempty(report.get(field), "report." + field)
        for field in ("role", "model", "summary"):
            nonempty(report.get(field), "report." + field)
        if report.get("scopeDigest") and report["scopeDigest"] != expected_digest:
            raise ReviewError("report read another scope")
        shaped.append(report)
    return shaped


def validate_result(candidate, initial, final, execution):
    if not isinstance(candidate, dict) or candidate.get("schemaVersion") != 1:
        raise ReviewError("review result needs schemaVersion 1")
    if final["digest"] != initial["digest"]:
        raise ReviewError("a read-only review must leave the checkout unchanged")
    if _scope_digest(candidate) != initial["digest"]:
        raise ReviewError("review scope changed; re-review against the current head")
    reports = _validate_reports(candidate.get("reports"), execution, initial["digest"])
    findings = candidate.get("findings")
    if not isinstance(findings, list):
        raise ReviewError("findings must be a list")
    ids = set()
    shaped_findings = []
    for item in findings:
        if not isinstance(item, dict):
            raise ReviewError("each finding must be an object")
        for field in ("id", "title", "evidence"):
            nonempty(item.get(field), "finding." + field)
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", item["id"]) or item["id"] in ids:
            raise ReviewError("finding IDs must be unique and stable")
        ids.add(item["id"])
        status = item.get("status", "open")
        if status not in ("open", "dismissed") or item.get("repair"):
            raise ReviewError("read-only review findings must be open or dismissed")
        if not _safe_relpath(item.get("file")) or not isinstance(item.get("line"), int) \
                or isinstance(item["line"], bool) or item["line"] < 1:
            raise ReviewError("finding needs a relative file path and positive line")
        if status == "open":
            if not isinstance(item.get("blocking"), bool):
                raise ReviewError("finding %s must set blocking to true or false" % item["id"])
            nonempty(item.get("fix"), "finding.fix")
        shaped_findings.append({**item, "status": status})
    checks = candidate.get("checks", [])
    if not isinstance(checks, list):
        raise ReviewError("checks must be a list")
    shaped_checks = []
    for check in checks:
        if not isinstance(check, dict):
            raise ReviewError("each check must be an object")
        nonempty(check.get("command"), "check.command")
        nonempty(check.get("result"), "check.result")
        if check.get("scopeDigest") and check["scopeDigest"] != final["digest"]:
            raise ReviewError("check evidence is stale")
        code = check.get("exitCode")
        if not isinstance(code, int) or isinstance(code, bool):
            raise ReviewError("check.exitCode must be an integer")
        if check.get("status") != ("pass" if code == 0 else "fail"):
            raise ReviewError("check status contradicts exitCode")
        required = check.get("required", False)
        if not isinstance(required, bool):
            raise ReviewError("check.required must be boolean")
        shaped_checks.append({**check, "required": required})
    verdict = candidate.get("verdict")
    if not isinstance(verdict, dict) or not isinstance(verdict.get("ship"), bool):
        raise ReviewError("review result needs a verdict with ship true or false")
    nonempty(verdict.get("summary"), "verdict.summary")
    blocked = any(item["status"] == "open" and item["blocking"] for item in shaped_findings) \
        or any(c["required"] and c["status"] == "fail" for c in shaped_checks)
    if verdict["ship"] == blocked:
        raise ReviewError("verdict contradicts findings: ship only when nothing blocks and no required check fails")
    return {**candidate, "scopeDigest": final["digest"], "inputScopeDigest": initial["digest"],
            "finalScopeDigest": final["digest"], "findings": shaped_findings,
            "checks": shaped_checks, "reports": reports, "executionMode": execution}


def _finding_line(item):
    detail = item.get("evidence") or item.get("decision") or ""
    fix = " Suggested fix: " + item["fix"] if item.get("fix") else ""
    return "%s (`%s:%s`). %s%s" % (item["title"], item["file"], item["line"], detail, fix)


def render_recap(run_dir, meta, result):
    ship = result["verdict"]["ship"]
    found = [f for f in result["findings"] if f["status"] == "open"]
    blocking = [f for f in found if f.get("blocking")]
    notes = [f for f in found if not f.get("blocking")]
    dismissed = [f for f in result["findings"] if f["status"] == "dismissed"]
    if not ship:
        guidance = "Pass the blocking findings to the PR author, then re-run after new commits."
    elif notes:
        guidance = "Nothing here should stop the merge. The notes are optional."
    else:
        guidance = "Nothing here should stop the merge."
    pr_url = meta["review"].get("prUrl")
    pr_line = ""
    if isinstance(pr_url, str):
        match = review_context.PR_URL.fullmatch(pr_url)
        if match:
            pr_line = "Reviewing [PR #%s](%s) read-only." % (match[2], match[0])
    lines = ["# " + meta["title"], "",
             "> **Verdict: %s**" % ("Safe to ship" if ship else "Not safe to ship yet"), "",
             result["verdict"]["summary"].strip(), "", guidance]
    if pr_line:
        lines += ["", pr_line]
    for heading, mark, items in (
            ("Blocks shipping", "🔴", blocking),
            ("Notes, not blocking", "🟡", notes),
            ("Checked and ruled out", "🟢", dismissed)):
        if items:
            lines += ["", "## " + heading, ""] + ["- %s %s" % (mark, _finding_line(f)) for f in items]
    if result["checks"] or result.get("checksNotApplicable"):
        lines += ["", "## Checks", ""]
        for check in result["checks"]:
            lines.append("- %s %s. %s" % (
                "🟢" if check["status"] == "pass" else "🔴" if check["required"] else "🟡",
                check["command"], check["result"]))
        if not result["checks"]:
            lines.append("- Checks not applicable. " + result["checksNotApplicable"])
    lines += ["", "## Evidence", "", "[Review result](result.json). [Reviewed scope](scope.json).", ""]
    write(run_dir, SOURCE, "\n".join(lines).encode())


def _initial_scope(run_dir):
    if path_at(run_dir, "review/scope.json").exists():
        return read(run_dir, "review/scope.json")
    return read(run_dir, "review/rounds/0001/input-scope.json")


def publish(run_dir, candidate):
    with locked(run_dir):
        meta = active_meta(run_dir)
        state = meta["review"]
        if state.get("state") != "reviewing":
            raise ReviewError("review is already published; start a fresh review for new commits")
        initial = _initial_scope(run_dir)
        final, _patches, _new = scope(meta["repoPath"], state["baseRef"])
        execution = state.get("executionMode") or ("orchestrated" if meta.get("orchestration") is True else "inline")
        validated = validate_result(candidate, initial, final, execution)
        open_findings = [f for f in validated["findings"] if f["status"] == "open"]
        outcome = "clean" if validated["verdict"]["ship"] and not open_findings else "flagged"
        result = {**validated, "round": 1, "state": outcome, "publishedAt": now()}
        write(run_dir, RESULT, result)
        render_recap(run_dir, meta, result)
        result_digest = digest(encoded(result))
        state.update(
            state=outcome,
            verdict="ship" if validated["verdict"]["ship"] else "hold",
            finalScopeDigest=final["digest"],
            resultDigest=result_digest,
            executionMode=execution,
        )
        meta["status"] = "awaiting-gate"
        write(run_dir, "meta.json", meta)
        return result


def recap_view(run_dir):
    content = path_at(run_dir, SOURCE).read_bytes()
    try:
        meta = read(run_dir, "meta.json")
    except ReviewError:
        return content
    if meta.get("status") in TERMINAL:
        return content
    try:
        result = read(run_dir, RESULT)
        expected = result.get("finalScopeDigest") or result.get("scopeDigest")
        base_ref = (meta.get("review") or {}).get("baseRef")
        repo_path = meta.get("repoPath")
        if not expected or not base_ref or not repo_path:
            return content
        current, _patches, _new = scope(repo_path, base_ref)
        if current["digest"] == expected:
            return content
    except (ReviewError, KeyError, TypeError):
        return content
    lines = content.decode(errors="replace").splitlines()
    lines.insert(2, "> **Head changed.** Re-run the review against the new commits to refresh this verdict.\n")
    return "\n".join(lines).encode()


def close(run_dir, result_digest=None):
    with locked(run_dir):
        meta = active_meta(run_dir)
        if meta.get("status") != "awaiting-gate":
            raise ReviewError("review is not awaiting close")
        result = None
        if path_at(run_dir, RESULT).exists():
            result = read(run_dir, RESULT)
            actual = digest(path_at(run_dir, RESULT).read_bytes())
            if result_digest is not None and (actual != result_digest
                                              or meta["review"].get("resultDigest") != result_digest):
                raise ReviewError("stale review report; reload before closing")
        elif result_digest is not None:
            raise ReviewError("missing review result")
        state = (result or {}).get("state") or meta["review"].get("state")
        meta["review"]["state"] = state if state in ("clean", "flagged") else "stopped"
        meta.update(outcome="review", phase="done", status="complete")
        write(run_dir, "meta.json", meta)
        return meta
