"""Read-only delivery observations, refreshed off the run-list request thread."""

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time
from urllib.parse import urlsplit
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import integrations
from linked_pr import linked_pr_url, query_open_pr

SHA = re.compile(r"[0-9a-fA-F]{7,64}")
REFRESH_SECONDS = 60
POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="delivery-status")
CACHE = {}
LOCK = threading.Lock()
_SIG_CACHE = {}
_REPO_SIG_MEMO = {}
# Resolve once: switching runtime/current cannot change this process's code.
RUNTIME_ROOT = Path(__file__).resolve().parent.parent
RUNTIME_COMMIT = (RUNTIME_ROOT.name if RUNTIME_ROOT.parent.name == "releases"
                  and re.fullmatch(r"[0-9a-f]{40,64}", RUNTIME_ROOT.name) else None)


def command(args, cwd, timeout=8):
    env = dict(os.environ, GH_PROMPT_DISABLED="1", GIT_TERMINAL_PROMPT="0")
    for key in ("GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE",
                "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"):
        env.pop(key, None)
    try:
        result = subprocess.run(args, cwd=cwd, env=env, capture_output=True,
                                text=True, timeout=timeout)
        return result.stdout.strip() if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def git(repo, *args):
    return command(["git", *args], repo)


def api(repo, endpoint):
    integrations.note("run-prs")
    raw = command(["gh", "api", endpoint], repo)
    try:
        return json.loads(raw) if raw is not None else None
    except ValueError:
        return None


def web_url(value):
    if not isinstance(value, str) or any(ord(c) < 32 for c in value):
        return None
    try:
        parsed = urlsplit(value)
        return value if parsed.scheme in ("https", "http") and parsed.hostname \
            and not parsed.username and not parsed.password else None
    except ValueError:
        return None


def github_repo(remote):
    match = re.fullmatch(r"(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([\w.-]+/[\w.-]+?)(?:\.git)?/?", remote or "")
    return match[1] if match else None


def deployment_online(url):
    if not web_url(url):
        return False
    try:
        with urlopen(Request(url, headers={"User-Agent": "Orc-delivery-status"}), timeout=3) as response:
            return 200 <= response.status < 300
    except HTTPError as error:
        error.close()
        return False
    except (OSError, ValueError):
        return False


def deployments(repo, slug):
    """Newest successful deployment per environment; failed builds keep the last live one."""
    rows = api(repo, f"repos/{slug}/deployments?per_page=20")
    if not isinstance(rows, list):
        return []
    live, seen = [], set()
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("id"), int):
            continue
        environment = row.get("environment")
        if not isinstance(environment, str):
            continue
        production = row.get("production_environment") is True or bool(re.match(r"^production(?:$|\s*[-–:])", environment, re.I))
        key = (environment, None if production else row.get("ref"))
        if key in seen:
            continue
        sha = row.get("sha")
        if not isinstance(sha, str) or not SHA.fullmatch(sha):
            continue
        statuses = api(repo, f"repos/{slug}/deployments/{row['id']}/statuses?per_page=1")
        if not isinstance(statuses, list) or not statuses or not isinstance(statuses[0], dict):
            # Do not resurrect an older deployment when the current state is unknown.
            seen.add(key)
            continue
        status = statuses[0]
        if status.get("state") == "inactive":
            seen.add(key)
        if status.get("state") != "success":
            continue
        seen.add(key)
        live.append({"commit": sha, "url": web_url(status.get("environment_url")),
                     "label": environment, "production": production, "ref": row.get("ref")})
    return sorted(live, key=lambda row: not row["production"])


def ancestors(repo, *refs):
    output = git(repo, "rev-list", *refs, "--")
    return set(output.splitlines()) if output else set()


def build_base(meta):
    return meta.get("buildBaseCommit") or next(
        (p.get("buildBaseCommit") for p in meta.get("repositories", []) if p.get("primary")), None)


def resolve_head(repo, meta, branches, run_dir):
    merged = meta.get("status") in ("merged", "merged-to-parent")
    head = meta.get("mergeCommit") if merged else branches.get(meta.get("branch"))
    if not head and not merged:
        try:
            authority = json.loads((Path(run_dir) / "delivery-authority.json").read_text())
            primary = next((p.get("id") for p in meta.get("repositories", []) if p.get("primary")), "main")
            head = next((p.get("head") for p in authority.get("participants", [])
                         if p.get("participantId") == primary), None)
        except (OSError, ValueError, TypeError, AttributeError):
            pass
    head = full_sha(repo, head)
    base = full_sha(repo, build_base(meta))
    if not merged and not base:
        return None
    if head and base and not merged and (
            head == base or git(repo, "merge-base", "--is-ancestor", head, base) is not None):
        return None
    return head


def full_sha(repo, value):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        return None
    return value.lower() if len(value) == 40 else git(repo, "rev-parse", "--verify", value + "^{commit}")


def branch_pr(repo, meta, slug):
    """The open PR a pushed run branch already has when the run records none.

    A run working on a branch that already has a PR only records it once Ship
    publishes, so a run that pushes but never reaches Ship would show no PR."""
    branch = meta.get("branch")
    if meta.get("status") in ("merged", "merged-to-parent") or not isinstance(branch, str) \
            or not branch.strip() or linked_pr_url(meta) or meta.get("delivery") is not None \
            or len(meta.get("repositories") or []) > 1:
        return None
    try:
        return query_open_pr(repo, branch.strip(), slug)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def observe(repo, entries, runtime_commit=None, github=True):
    """Each run's delivery state from git, and from GitHub (its deployments
    and the open PR on its branch) unless `github` is False: the GitHub switch
    on Settings' Integrations page. Pushed and the commit link are git's."""
    refs = git(repo, "for-each-ref", "--format=%(refname:strip=2) %(objectname)", "refs/heads/") or ""
    branches = dict(line.split(" ", 1) for line in refs.splitlines() if " " in line)
    upstream = ancestors(repo, "--remotes")
    running = ancestors(repo, runtime_commit) if runtime_commit else set()
    slug = github_repo(git(repo, "remote", "get-url", "origin"))
    deployed = deployments(repo, slug) if github and slug and not runtime_commit else []
    deployment_heads = [(row, ancestors(repo, row["commit"])) for row in deployed]
    online = {}
    result = {}
    for run_id, meta, run_dir in entries:
        head = resolve_head(repo, meta, branches, run_dir)
        if not head:
            continue
        state = {"pushed": head in upstream}
        if head in running:
            state["live"] = {"commit": runtime_commit, "label": "Running Orc app", "url": None}
        else:
            merged = meta.get("status") in ("merged", "merged-to-parent")
            for row, contains in deployment_heads:
                if head in contains and (row["production"] or not merged and
                                         (row["ref"] == meta.get("branch") or row["ref"] == row["commit"])):
                    url = row["url"]
                    if url not in online:
                        online[url] = deployment_online(url)
                    if not online[url]:
                        continue
                    state["live"] = {key: row[key] for key in ("commit", "url", "label")}
                    state["pushed"] = True
                    break
        # An unpushed head would be a 404 on GitHub.
        if state["pushed"] and slug:
            state["commitUrl"] = f"https://github.com/{slug}/commit/{head}"
            if "live" in state:
                state["live"]["commitUrl"] = state["commitUrl"]
            pr = branch_pr(repo, meta, slug) if github else None
            if pr:
                state["prUrl"] = pr
        result[run_id] = state
    return result


def attach(runs, runs_dir, orc_repo, owns_native_app, row_versions=None, github=True):
    """Write each run's last known delivery state into its row, and start a
    background recheck of any repository whose answer is stale. With `github`
    False (the GitHub switch on Settings' Integrations page) the recheck reads
    git alone and keeps GitHub's last answers."""
    groups = {}
    latest = {}
    resolved = {}
    by_id = {run["id"]: run for run in runs}
    runs_prefix = runs_dir.rstrip(os.sep) + os.sep
    sig_updates = {}
    with LOCK:
        sig_cache = _SIG_CACHE if row_versions is not None else None
    for run in runs:
        rid = run["id"]
        meta = run["meta"]
        meta.pop("deliveryStatus", None)
        ver = row_versions.get(id(run)) if row_versions is not None else None
        cached_sig = sig_cache.get(rid) if sig_cache is not None and ver is not None else None
        if cached_sig is not None and cached_sig[0] == ver:
            repo_raw, sig_entry = cached_sig[1], cached_sig[2]
            if repo_raw is None:
                continue
        else:
            repo_raw = meta.get("mainRepoPath") or meta.get("repoPath")
            if meta.get("remote") or meta.get("outcome") == "question" or meta.get("status") == "cancelled" \
                    or not isinstance(repo_raw, str) or not (meta.get("branch") or meta.get("mergeCommit")):
                if ver is not None:
                    sig_updates[rid] = (ver, None, None)
                continue
            sig_entry = (
                rid, str(meta.get("branch", "")), str(meta.get("mergeCommit", "")),
                str(meta.get("status", "")), str(build_base(meta) or ""),
                str(meta.get("sessionIdleAt", "")) if meta.get("sessionIdleAt") and linked_pr_url(meta) else "",
            )
            if ver is not None:
                sig_updates[rid] = (ver, repo_raw, sig_entry)
        if repo_raw not in resolved:
            resolved[repo_raw] = os.path.realpath(os.path.expanduser(repo_raw))
        repo = resolved[repo_raw]
        groups.setdefault(repo, []).append((rid, meta, runs_prefix + rid, sig_entry))
        latest[repo] = max(latest.get(repo, 0), run.get("mtime", 0))
    if sig_updates or (sig_cache is not None and len(sig_cache) > len(runs) + 64):
        with LOCK:
            _SIG_CACHE.update(sig_updates)
            if len(_SIG_CACHE) > len(runs) + 64:
                for gone in _SIG_CACHE.keys() - by_id.keys():
                    del _SIG_CACHE[gone]
    now = time.monotonic()
    orc_root = (os.path.realpath(os.path.expanduser(orc_repo))
                if owns_native_app and isinstance(orc_repo, str) and orc_repo else None)
    for repo in sorted(groups, key=lambda item: latest[item], reverse=True):
        entries = groups[repo]
        runtime = RUNTIME_COMMIT if orc_root is not None and repo == orc_root else None
        key = (repo, runtime)
        sig_by_rid = {rid: sig_entry for rid, _, _, sig_entry in entries}
        with LOCK:
            memo = _REPO_SIG_MEMO.get(key)
            signature = memo["signature"] if memo is not None and memo["by_rid"] == sig_by_rid else None
        if signature is None:
            signature = tuple(sorted(sig_by_rid.values()))
            with LOCK:
                _REPO_SIG_MEMO[key] = {"by_rid": sig_by_rid, "signature": signature}
        with LOCK:
            cached = CACHE.setdefault(key, {"at": 0, "signature": None, "result": {}, "pending": False})
            exact = cached["signature"] == signature
            fresh = exact and now - cached["at"] < REFRESH_SECONDS
            # A repository refresh must not blink every badge or hide unrelated runs.
            same_runs = None if exact else (set(cached["signature"] or ()) & set(signature))
            result = cached["result"] if now - cached["at"] < 2 * REFRESH_SECONDS else {}
            if not fresh and not cached["pending"]:
                cached["pending"] = True
                # The refresh outlives this scan, whose rows the caller goes
                # on to write into, so it reads copies taken here.
                POOL.submit(refresh, key, [(rid, dict(meta), run_dir) for rid, meta, run_dir, _ in entries], signature,
                            github)
        if exact:
            if result:
                for rid, _, _, _ in entries:
                    if rid in result:
                        by_id[rid]["meta"]["deliveryStatus"] = result[rid]
            continue
        for rid, *_ in same_runs:
            if rid in result:
                by_id[rid]["meta"]["deliveryStatus"] = result[rid]
        # A run on the same branch, merge commit and base whose turn just
        # ended keeps its last answer marked `checking`, so Chat waits for the
        # recheck instead of calling new commits pushed. Its status may have
        # flipped to running and back meanwhile; another branch, merge commit
        # or base is another head, so its old answer never shows.
        same_head = lambda entry: entry[:3] + entry[4:5]
        before = {same_head(entry) for entry in cached["signature"] or ()}
        for entry in set(signature) - same_runs:
            if entry[0] in result and same_head(entry) in before:
                by_id[entry[0]]["meta"]["deliveryStatus"] = {**result[entry[0]], "checking": True}


def refresh(key, entries, signature, github=True):
    try:
        result = observe(key[0], entries, key[1], github)
    except Exception:
        result = {}
    with LOCK:
        if not github:
            # Unread from GitHub, a run keeps the deployment and PR it last had.
            before = CACHE[key]["result"]
            for run_id, state in result.items():
                kept = {name: before[run_id][name] for name in ("live", "prUrl")
                        if name not in state and name in before.get(run_id, {})}
                state.update(kept, **({"pushed": True} if "live" in kept else {}))
        CACHE[key].update(at=time.monotonic(), signature=signature, result=result, pending=False)
