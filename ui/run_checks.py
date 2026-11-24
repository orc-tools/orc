"""The checks a run's agent ran on its own work, as the agent reports them.

The agent records each one with ``bin/orc-check``: targeted tests, a type
check, a flow it drove in the running app, an edge case, a check it skipped
and why. They are kept in the run's ``checks.json``. The Pull request panel
lists them under Self-verification at every stage, while Chat shows a
failed-checks card above the chat box only once the run reaches Ship (and after
delivery), never during Build, Verify, or a Ship hold.

The list is the agent's own report. Orc reruns nothing and never holds Ship
for a check, so a failed or missing check stops nothing. A check the agent ran
through ``orc-check run`` also keeps its command, exit code and, when it ran
in one of the run's checkouts, that checkout's commit (``proof``); Ship's
template fills its build proof from the ones that passed at the current commit
(``proven_commands``). A hand-reported pass carries none of that. A failed check the agent found failing on main too carries
``onMain``, so Orc can say the run did not break it. A failed check Fix it in
a new run started a run for carries that run under ``fixRuns``, so Chat can
show it being fixed until that run merges. When an ``onMain`` failure has no
standing fix run of its own, ``match_related_fix_run`` checks other fix builds
in the same repository so Orc can flag one that already looks like it is fixing
the same failure. A run that reported none shows the commands and flows it
recorded at Ship instead (``ship_proof``).
"""
from __future__ import annotations

import json
import os
import posixpath
import re
import subprocess
from datetime import datetime, timezone

from keychain_secrets import _locked, _write_json

CHECKS_FILE = "checks.json"
LOCK_FILE = ".checks.lock"
AUTHORITY_FILE = "delivery-authority.json"
LOG_DIR = "checks"
STATUSES = ("running", "pass", "fail", "skip")
ID_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,39}")
LABEL_MAX = 60
DETAIL_MAX = 200
COMMAND_MAX = 300
ARTIFACT_MAX = 200
CHECKS_MAX = 20
RUN_COMMAND_MAX = 1000
PROOF_KEYS = ("command", "exitCode", "participantId", "head")
_SHA_RE = re.compile(r"[0-9a-f]{40}")
PICTURES_MAX = 50
FIX_RUNS_MAX = 3
PICTURE_RE = re.compile(r"\.(?:png|jpe?g|gif|webp|avif|svg)$", re.I)

_RUN_ID_RE = re.compile(r"\b[a-z0-9][a-z0-9-]*-\d{8}-\d{4}\b", re.I)
_FIX_BRANCH_RE = re.compile(r"^(?:fix|bugfix|hotfix)/", re.I)
_FIX_INTENT_RE = re.compile(
    r"\b(?:fix(?:es|ed|ing)?|repair(?:s|ed|ing)?|unbreak(?:s|ing)?|broken|"
    r"fail(?:s|ed|ing|ure|ures)?|flak(?:y|e|es)|regression|restore(?:s|d|ing)?|"
    r"not defined|undefined|crash(?:es|ed|ing)?)\b",
    re.I,
)
_CAMEL_RE = re.compile(r"\b(?:[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*)\b")
_SNAKE_RE = re.compile(r"\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b")
_KEBAB_OR_FILE_RE = re.compile(
    r"(?<![A-Za-z0-9_])(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_*]+(?:-[A-Za-z0-9_*]+)+(?:\.[A-Za-z0-9*]+)*"
    r"|(?<![A-Za-z0-9_/.-])[A-Za-z0-9_][A-Za-z0-9_.*-]*\.(?:spec\.[jt]s|test\.[jt]s|py|js|mjs|cjs|ts|tsx|jsx|rb|go|rs|swift)\b"
)
_EXT_RE = re.compile(
    r"(?:\.(?:spec|test))?\.(?:py|js|mjs|cjs|ts|tsx|jsx|rb|go|rs|swift|json|html|css|md|mdx|sh|txt)$",
    re.I,
)
_WORD_SPLIT_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[^A-Za-z0-9]+")

_GENERIC_STRONG = frozenset({
    "changed-file", "pre-existing", "on-main", "base-commit", "build-base",
    "self-verification", "type-check", "unit-test", "unit-tests", "e2e-test",
    "e2e-tests", "bin-test", "orc-check", "orc-shot", "run-checks", "test-suite",
    "main-branch", "new-run", "fix-it", "no-emit", "dry-run", "follow-up",
    "right-click", "left-click", "read-only", "in-place", "non-empty",
    "one-line", "end-to-end", "cross-site", "up-to-date", "built-in", "no-op",
    "index", "main", "app", "utils", "config", "package", "readme", "meta",
    "checks", "check", "tests", "test", "spec", "specs", "changed", "targeted",
    "selected", "javascript", "python", "typescript",
})

_MATCH_STOPWORDS = frozenset({
    "about", "above", "after", "again", "against", "already", "also", "another",
    "apart", "around", "base", "because", "been", "before", "being", "below",
    "between", "both", "branch", "broken", "build", "builds", "case", "cases",
    "change", "changed", "changes", "check", "checks", "clean", "code", "command",
    "commands", "commit", "commits", "could", "crash", "crashes", "crashing",
    "current", "data", "default", "defined", "detail", "diff", "does", "done",
    "dont", "down", "during", "each", "edge", "edges", "empty", "error", "errors",
    "every", "existing", "fail", "failed", "failing", "fails", "failure",
    "failures", "false", "feat", "file", "files", "find", "first", "five", "fix",
    "fixed", "fixes", "fixing", "flake", "flakes", "flaky", "flow", "flows",
    "follow", "four", "from", "full", "green", "have", "head", "here", "identically",
    "into", "item", "items", "javascript", "just", "keep", "known", "label",
    "last", "later", "layer", "left", "like", "line", "lines", "list", "live",
    "local", "main", "make", "many", "merge", "merged", "merging", "message",
    "more", "most", "must", "name", "named", "names", "need", "needs", "never",
    "next", "nine", "none", "note", "nothing", "null", "once", "only", "open",
    "other", "over", "page", "part", "pass", "passed", "passes", "passing",
    "path", "paths", "plan", "project", "prompt", "pull", "push", "python",
    "ready", "real", "record", "recorded", "regression", "repair", "report",
    "reported", "repo", "rest", "restore", "result", "right", "rows", "rule",
    "rules", "running", "runs", "same", "save", "saved", "screen", "second",
    "selected", "self", "send", "seven", "ship", "should", "show", "shows",
    "side", "single", "skip", "skipped", "some", "source", "spec", "specs",
    "start", "started", "state", "status", "stay", "step", "steps", "still",
    "stop", "stopped", "suite", "targeted", "test", "testing", "tests", "text",
    "than", "that", "their", "them", "then", "there", "these", "they", "thing",
    "this", "those", "three", "through", "time", "title", "true", "turn", "turns",
    "type", "typescript", "unbreak", "undefined", "under", "unit", "until",
    "update", "updated", "used", "user", "using", "valid", "value", "verify",
    "verification", "view", "wait", "waits", "waiting", "want", "were", "what",
    "when", "where", "which", "while", "with", "without", "work", "working",
    "works", "worktree", "would", "zero",
})


class CheckError(ValueError):
    pass


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _line(value, label, limit):
    if not isinstance(value, str):
        raise CheckError("%s must be text." % label)
    value = " ".join(value.split())
    if len(value) > limit:
        raise CheckError("Keep the %s under %d characters." % (label.lower(), limit))
    return value


def _safe_artifact(path):
    """A path inside the run folder, or None. It is checked again on every
    read, because the file is the agent's to write."""
    if not isinstance(path, str) or not path or len(path) > ARTIFACT_MAX:
        return None
    if path.startswith(("/", "~")) or "\\" in path or "\0" in path:
        return None
    parts = path.split("/")
    if any(part in ("", ".", "..") or part.startswith(".") for part in parts):
        return None
    return path


def _items(run_dir):
    """The saved checks, in the order they were first reported. A file Orc
    cannot read as checks lists none: the card is a convenience, and Chat
    must not fail over it."""
    try:
        with open(os.path.join(run_dir, CHECKS_FILE)) as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return []
    items = data.get("items") if isinstance(data, dict) else None
    found = []
    for item in items if isinstance(items, list) else []:
        if (isinstance(item, dict) and isinstance(item.get("id"), str)
                and ID_RE.fullmatch(item["id"]) and isinstance(item.get("label"), str)
                and item["label"].strip() and item.get("status") in STATUSES
                and all(entry["id"] != item["id"] for entry in found)):
            found.append(item)
    return found[:CHECKS_MAX]


def checks(run_dir):
    return _items(run_dir)


def _entry(check_id, status, label="", detail="", artifact="", on_main=False, proof=None):
    """One report, checked before anything is written."""
    if not isinstance(check_id, str) or not ID_RE.fullmatch(check_id):
        raise CheckError("Name the check with a short id of lowercase letters, digits and hyphens, "
                         "such as tests or edge-cases.")
    if status not in STATUSES:
        raise CheckError("A check is running, pass, fail or skip.")
    if on_main and status != "fail":
        raise CheckError("Only a failed check can fail on main too.")
    if artifact and _safe_artifact(artifact) is None:
        raise CheckError("Name the file by its path inside the run folder, such as shots/after/sign-in.jpg.")
    return {"id": check_id, "status": status, "label": _line(label, "Label", LABEL_MAX),
            "detail": _line(detail, "Detail", DETAIL_MAX), "artifact": artifact,
            "onMain": bool(on_main), "proof": _proof(proof)}


def _proof(proof):
    """The command fields `orc-check run` keeps, only those it can stand
    behind: a command and its exit code, and a commit only with the
    participant whose checkout it was."""
    if not isinstance(proof, dict):
        return {}
    kept = {}
    command = proof.get("command")
    if isinstance(command, str) and command.strip() and len(command) <= RUN_COMMAND_MAX:
        kept["command"] = command
    if isinstance(proof.get("exitCode"), int) and not isinstance(proof["exitCode"], bool):
        kept["exitCode"] = proof["exitCode"]
    if (isinstance(proof.get("participantId"), str) and proof["participantId"]
            and isinstance(proof.get("head"), str) and _SHA_RE.fullmatch(proof["head"])):
        kept["participantId"] = proof["participantId"]
        kept["head"] = proof["head"]
    return kept


def check_log_path(check_id):
    return "%s/%s.log" % (LOG_DIR, check_id)


def _apply(items, entry, run_dir=None):
    item = next((known for known in items if known["id"] == entry["id"]), None)
    if item is None:
        if not entry["label"]:
            raise CheckError("Give a new check a --label that says what it checks.")
        if len(items) >= CHECKS_MAX:
            raise CheckError("A run holds at most %d checks. Group related ones, such as "
                             "\"Edge cases (2)\"." % CHECKS_MAX)
        item = {"id": entry["id"], "label": entry["label"]}
        items.append(item)
    elif entry["label"]:
        item["label"] = entry["label"]
    # Keep a saved failure log linked when the agent re-reports the same failed
    # check (for example with --on-main and a shorter --detail) without naming
    # another artifact.
    artifact = entry["artifact"]
    if not artifact and entry["status"] == "fail":
        existing = item.get("artifact")
        if existing == check_log_path(entry["id"]) and run_dir and os.path.isfile(os.path.join(run_dir, existing)):
            artifact = existing
    item.update(status=entry["status"], detail=entry["detail"], updatedAt=_now())
    item.pop("fixRuns", None)
    for key, value in (("artifact", artifact), ("onMain", entry["onMain"])):
        if value:
            item[key] = value
        else:
            item.pop(key, None)
    for key in PROOF_KEYS:
        if key in entry["proof"]:
            item[key] = entry["proof"][key]
        else:
            item.pop(key, None)
    return item


def report(run_dir, check_id, status, label="", detail="", artifact="", on_main=False, proof=None):
    """Record one check, or the new state of one already reported. The label
    is kept when a later report leaves it out. The detail, the file, whether
    a failure happens on main too and the command proof are what this report
    says, so a stale "running" line never outlives it and a hand-reported
    pass never inherits an earlier run's command. The runs started to fix the
    last report go with it, since a new report is not the failure they fix."""
    entry = _entry(check_id, status, label, detail, artifact, on_main, proof)
    with _locked(run_dir, LOCK_FILE):
        items = _items(run_dir)
        item = _apply(items, entry, run_dir=run_dir)
        _write_json(os.path.join(run_dir, CHECKS_FILE), {"items": items})
        return item


def report_many(run_dir, reports, status):
    """Record several checks in one write, all or none: the skips a verify
    script decides together. Each report is a dict with id, label and detail."""
    if not isinstance(reports, list) or not reports:
        raise CheckError("List at least one check, each with an id, a label and a detail.")
    entries = []
    for index, given in enumerate(reports):
        if not isinstance(given, dict):
            raise CheckError("Check %d must be an object with an id, a label and a detail." % (index + 1))
        entries.append(_entry(given.get("id"), status, given.get("label") or "",
                              given.get("detail") or ""))
    if len({entry["id"] for entry in entries}) != len(entries):
        raise CheckError("Name each check once.")
    with _locked(run_dir, LOCK_FILE):
        items = _items(run_dir)
        recorded = [_apply(items, entry, run_dir=run_dir) for entry in entries]
        _write_json(os.path.join(run_dir, CHECKS_FILE), {"items": items})
        return recorded


def unresolved_failures(run_dir):
    """Failed checks in `checks.json` that are neither marked `onMain` nor
    tracked by a fix run, so `ship-template` can remind the agent before Ship."""
    found = []
    for item in _items(run_dir):
        if item["status"] != "fail" or item.get("onMain") is True or fix_runs(item):
            continue
        found.append({
            "id": item["id"],
            "label": item["label"],
            "detail": item.get("detail") if isinstance(item.get("detail"), str) else "",
            "head": item.get("head") if isinstance(item.get("head"), str) else None,
        })
    return found


def proven_commands(run_dir, heads):
    """Ship's build proof from `orc-check run`: per participant, the checks
    that passed at its current commit (`heads` maps participant to commit),
    and the passing checks left out because they ran at an older commit, or
    at none: outside the run's checkouts or over uncommitted edits."""
    filled = {participant: [] for participant in heads}
    stale = []
    for item in _items(run_dir):
        if item["status"] != "pass" or item.get("exitCode") != 0 or not isinstance(item.get("command"), str):
            continue
        if item.get("participantId") not in heads or item.get("head") != heads[item["participantId"]]:
            # head None: it ran outside the checkouts or over uncommitted edits.
            stale.append({"id": item["id"], "label": item["label"], "head": item.get("head")})
            continue
        detail = item.get("detail") if isinstance(item.get("detail"), str) else ""
        filled[item["participantId"]].append({
            "command": item["command"], "status": "pass", "exitCode": 0,
            "result": detail.strip() or "exit 0"})
    return filled, stale


def _devd_id(state):
    worktree = state.get("worktree") if isinstance(state, dict) else None
    devd = worktree.get("devd") if isinstance(worktree, dict) else None
    value = devd.get("id") if isinstance(devd, dict) else None
    return value if isinstance(value, str) and value else None


def _participants(meta):
    """Each of the run's checkouts as (participant id, path, orc-devd id),
    under the ids Ship's delivery authority uses."""
    root_devd = _devd_id(meta)
    repositories = meta.get("repositories") if meta.get("repositoriesVersion") == 1 else None
    if isinstance(repositories, list) and repositories:
        primary = meta.get("primaryRepositoryId")
        found = []
        for entry in repositories:
            if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
                continue
            path = entry.get("repoPath") or entry.get("path")
            if isinstance(path, str) and path:
                is_primary = entry.get("primary") is True or entry["id"] == primary
                found.append((entry["id"], path, _devd_id(entry) or (root_devd if is_primary else None)))
        return found
    participant = meta.get("primaryRepositoryId") or "primary"
    path = meta.get("repoPath")
    if not isinstance(participant, str) or not isinstance(path, str) or not path:
        return []
    return [(participant, path, root_devd)]


def _git(path, *args):
    try:
        result = subprocess.run(["git", "-C", path, *args], text=True, capture_output=True,
                                timeout=30, env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"})
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def _devd_target(argv):
    """The orc-devd worktree id a command runs in, from `orc-devd exec <id> -- ...`."""
    if len(argv) >= 3 and os.path.basename(argv[0]) == "orc-devd" and argv[1] == "exec":
        return argv[2]
    return None


def checkout(run_dir, cwd, argv):
    """The run's checkout a command runs against, as (participant id, path),
    or None when it runs anywhere else. `orc-devd exec <id>` runs in the
    checkout registered under that id; any other command in the checkout
    that holds its folder. Orc's main checkout and other runs' worktrees are
    elsewhere."""
    try:
        with open(os.path.join(run_dir, "meta.json")) as handle:
            meta = json.load(handle)
    except (OSError, ValueError):
        return None
    participants = _participants(meta) if isinstance(meta, dict) else []
    target = _devd_target(argv)
    if target:
        return next(((pid, path) for pid, path, devd in participants if devd == target), None)
    top = _git(cwd, "rev-parse", "--show-toplevel")
    if not top:
        return None
    top = os.path.realpath(top)
    for pid, path, _devd in participants:
        if os.path.realpath(os.path.expanduser(path)) == top:
            return pid, path
    return None


def commit(path):
    """The checkout's commit when it holds no uncommitted change to a tracked
    file, else None: a command run over edits did not run at that commit."""
    head = _git(path, "rev-parse", "--verify", "HEAD")
    if not head or not _SHA_RE.fullmatch(head):
        return None
    dirty = _git(path, "status", "--porcelain", "--untracked-files=no")
    return head if dirty == "" else None


def fix_runs(item):
    runs = item.get("fixRuns")
    return [run for run in runs if isinstance(run, str)] if isinstance(runs, list) else []


def _extract_signals(text):
    """High-signal identifiers, test globs and domain words in a check or run
    description. Run ids are stripped first so mentioning a parent run never
    creates a false match."""
    cleaned = _RUN_ID_RE.sub(" ", text or "")
    strong = set()
    globs = set()
    words = set()
    for match in _CAMEL_RE.finditer(cleaned):
        token = match.group(0).lower()
        if len(token) >= 5 and token not in _GENERIC_STRONG:
            strong.add(token)
    for match in _SNAKE_RE.finditer(cleaned):
        token = match.group(0).lower().strip("_")
        if len(token) >= 5 and token not in _GENERIC_STRONG:
            strong.add(token)
        if token.startswith("test_") and len(token) > 9 and token[5:] not in _GENERIC_STRONG:
            strong.add(token[5:])
    for match in _KEBAB_OR_FILE_RE.finditer(cleaned):
        base = match.group(0).rsplit("/", 1)[-1]
        has_glob = "*" in base
        stem = _EXT_RE.sub("", base).lower()
        if has_glob:
            prefix = stem.split("*", 1)[0].rstrip("-_.")
            if len(prefix) >= 5 and prefix not in _GENERIC_STRONG:
                strong.add(prefix)
                globs.add(prefix + "-")
            continue
        stem = stem.strip("-_.")
        if len(stem) >= 5 and stem not in _GENERIC_STRONG and not stem.isdigit():
            strong.add(stem)
            for prefix in ("test-", "spec-"):
                if stem.startswith(prefix):
                    short = stem[len(prefix):]
                    if ("-" in short or "_" in short) and len(short) >= 5 and short not in _GENERIC_STRONG:
                        strong.add(short)
    for part in _WORD_SPLIT_RE.split(cleaned):
        word = part.lower()
        if len(word) >= 4 and not word.isdigit() and word not in _MATCH_STOPWORDS:
            words.add(word)
    return strong, globs, words


def has_fix_intent(candidate):
    """Whether a candidate build looks like a fix rather than unrelated feature
    work in the same area."""
    if not isinstance(candidate, dict):
        return False
    if candidate.get("explicitFix"):
        return True
    branch = candidate.get("branch") or ""
    if isinstance(branch, str) and _FIX_BRANCH_RE.match(branch):
        return True
    text = "%s\n%s" % (candidate.get("title") or "", candidate.get("prompt") or "")
    return bool(_FIX_INTENT_RE.search(text))


def _glob_hits(globs, tokens):
    return sum(1 for prefix in globs if any(tok == prefix[:-1] or tok.startswith(prefix) for tok in tokens))


def match_related_fix_run(row, candidates):
    """The best candidate fix build in the same repository that looks like it
    already addresses an unfixed ``onMain`` failure, as ``{id, title, state}``,
    or None when no candidate matches strongly enough."""
    if not isinstance(row, dict) or row.get("status") != "fail" or row.get("onMain") is not True or row.get("fix"):
        return None
    check_text = "%s\n%s" % (row.get("label") or "", row.get("detail") or "")
    check_strong, check_globs, check_words = _extract_signals(check_text)
    if not check_strong and not check_globs and len(check_words) < 2:
        return None
    best_score = None
    best = None
    for cand in candidates or ():
        if not has_fix_intent(cand) or not isinstance(cand.get("id"), str):
            continue
        cand_text = "%s\n%s\n%s" % (cand.get("title") or "", cand.get("branch") or "", cand.get("prompt") or "")
        cand_strong, cand_globs, cand_words = _extract_signals(cand_text)
        exact_strong = len(check_strong & cand_strong)
        glob_strong = _glob_hits(check_globs, cand_strong - check_strong) + _glob_hits(cand_globs, check_strong - cand_strong)
        strong_hits = exact_strong + glob_strong
        word_hits = len(check_words & cand_words)
        if not strong_hits and not (word_hits >= 2 and (word_hits >= 3 or word_hits * 100 >= len(check_words) * 35)):
            continue
        score = (strong_hits * 4 + word_hits, 1 if cand.get("explicitFix") else 0, cand.get("recency") or 0)
        if best_score is None or score > best_score:
            best_score = score
            best = cand
    if not best:
        return None
    return {
        "id": best["id"],
        "title": best.get("title") or best["id"],
        "state": "merged" if best.get("state") == "merged" else "working",
    }


def note_fix_run(run_dir, check_ids, run_id):
    """Note `run_id` as started to fix each of `check_ids` that still failed.
    Returns the ids it was noted on."""
    with _locked(run_dir, LOCK_FILE):
        items = _items(run_dir)
        noted = []
        for item in items:
            if item["id"] in check_ids and item["status"] == "fail":
                item["fixRuns"] = ([known for known in fix_runs(item) if known != run_id] + [run_id])[-FIX_RUNS_MAX:]
                noted.append(item["id"])
        if noted:
            _write_json(os.path.join(run_dir, CHECKS_FILE), {"items": items})
        return noted


def remove(run_dir, check_id):
    with _locked(run_dir, LOCK_FILE):
        items = _items(run_dir)
        item = next((entry for entry in items if entry["id"] == check_id), None)
        if item is None:
            raise CheckError("This run has no check named %s." % check_id)
        _write_json(os.path.join(run_dir, CHECKS_FILE),
                    {"items": [entry for entry in items if entry is not item]})
        if item.get("artifact") == check_log_path(check_id):
            try:
                os.unlink(os.path.join(run_dir, item["artifact"]))
            except OSError:
                pass
        return item


def _row(run_dir, item):
    row = {"id": item["id"], "label": " ".join(item["label"].split())[:LABEL_MAX],
           "status": item["status"],
           "detail": " ".join(item["detail"].split())[:DETAIL_MAX]
           if isinstance(item.get("detail"), str) else ""}
    if row["status"] == "fail" and item.get("onMain") is True:
        row["onMain"] = True
    if row["status"] == "fail" and fix_runs(item):
        row["fixRuns"] = fix_runs(item)
    artifact = _safe_artifact(item.get("artifact"))
    if artifact and os.path.isfile(os.path.join(run_dir, artifact)):
        row["artifact"] = artifact
        pictures = _pictures(run_dir, artifact)
        if pictures:
            row["pictures"] = pictures
    return row


def view(run_dir):
    """The reported checks as Chat and the Pull request panel draw them."""
    return [_row(run_dir, item) for item in _items(run_dir)]


def summary(rows):
    """One line such as "3 passed, 1 fails on main, 1 running", for the helper's reply."""
    def kind(row):
        return "main" if row["status"] == "fail" and row.get("onMain") is True else row["status"]
    words = (("pass", "passed"), ("fail", "failed"), ("main", "fails on main"), ("skip", "skipped"),
             ("running", "running"))
    parts = ["%d %s" % (count, word if status != "main" or count == 1 else "fail on main")
             for status, word in words for count in [sum(kind(row) == status for row in rows)] if count]
    return ", ".join(parts) or "no checks"


def _list(value):
    return value if isinstance(value, list) else []


def _manifest_shots(run_dir, path):
    """The entries a shots manifest lists, or None when it cannot be read. A
    manifest is a list of entries or an object holding them under "shots"."""
    try:
        with open(os.path.join(run_dir, path)) as handle:
            listed = json.load(handle)
    except (OSError, ValueError):
        return None
    return [shot for shot in _list(listed.get("shots") if isinstance(listed, dict) else listed)
            if isinstance(shot, dict)]


def _pictures(run_dir, artifact, shots=None):
    """The pictures a check's file stands for, so its Open link shows them in
    the lightbox instead of a bare browser tab: the file itself when it is a
    picture, or each "after" picture a shots manifest names, labelled with its
    flow. A manifest names a picture from its own folder or from the run
    folder."""
    if PICTURE_RE.search(artifact):
        return [{"path": artifact, "label": ""}]
    if not artifact.endswith(".json"):
        return []
    if shots is None:
        shots = _manifest_shots(run_dir, artifact) or []
    folder = posixpath.dirname(artifact)
    pictures = []
    for shot in shots:
        after = shot.get("after")
        if not isinstance(after, str) or not PICTURE_RE.search(after):
            continue
        for candidate in (posixpath.join(folder, after) if folder else after, after):
            if _safe_artifact(candidate) and os.path.isfile(os.path.join(run_dir, candidate)):
                label = next((shot[key] for key in ("flow", "label") if isinstance(shot.get(key), str)), "")
                pictures.append({"path": candidate, "label": " ".join(label.split())[:LABEL_MAX * 2]})
                break
    return pictures[:PICTURES_MAX]


def _shots(run_dir, hands_on):
    """The screenshots row, linking the first picture the manifest names and
    carrying every one for the lightbox."""
    shots = hands_on.get("shots")
    path = _safe_artifact(shots.get("path")) if isinstance(shots, dict) else None
    if not path:
        return None
    listed = _manifest_shots(run_dir, path)
    if not listed:
        return None
    pictures = _pictures(run_dir, path, listed)
    row = {"id": "ship-shots", "label": "Screenshots", "status": "pass",
           "detail": "%d state%s captured" % (len(listed), "" if len(listed) == 1 else "s"),
           "artifact": pictures[0]["path"] if pictures else path}
    if pictures:
        row["pictures"] = pictures
    return row


def ship_proof(run_dir):
    """What a run recorded at Ship, as check rows: each command of its build
    proof, each test it listed as failing before the change too, each flow it
    exercised by hand and its screenshots. This stands in for a run that
    reported no checks, and is read from the delivery authority file without
    changing how Ship writes or validates it. That file is validated when it
    is written, but a damaged one must still not fail the panel."""
    try:
        with open(os.path.join(run_dir, AUTHORITY_FILE)) as handle:
            authority = json.load(handle)
    except (OSError, ValueError):
        return []
    if not isinstance(authority, dict):
        return []
    rows = []
    for proof in _list(authority.get("buildProof")):
        if not isinstance(proof, dict):
            continue
        for command in _list(proof.get("commands")):
            if isinstance(command, dict) and isinstance(command.get("command"), str):
                rows.append({"label": command["command"], "kind": "command",
                             "status": "pass" if command.get("status") == "pass" else "fail",
                             "detail": command.get("result")})
        for known in _list(proof.get("knownFailures")):
            if isinstance(known, dict) and isinstance(known.get("spec"), str):
                rows.append({"label": known["spec"], "kind": "command", "status": "skip",
                             "detail": "Known failure: %s" % known["reason"]
                             if isinstance(known.get("reason"), str) else "Known failure"})
    hands_on = authority.get("handsOn")
    if isinstance(hands_on, dict) and hands_on.get("applicable"):
        ready = hands_on.get("state") == "ready"
        for flow in _list(hands_on.get("flows")):
            if isinstance(flow, str):
                rows.append({"label": flow, "kind": "flow", "status": "pass" if ready else "skip",
                             "detail": "" if ready else "Recorded at Ship without a capture"})
        shots = _shots(run_dir, hands_on) if ready else None
        if shots:
            rows.append(shots)
    shown = []
    for index, row in enumerate(rows[:CHECKS_MAX * 2]):
        label = " ".join(row["label"].split())[:COMMAND_MAX]
        detail = " ".join(row["detail"].split())[:DETAIL_MAX] if isinstance(row["detail"], str) else ""
        if label:
            shown.append({"id": "ship-%d" % index, **row, "label": label, "detail": detail})
    return shown


def panel(run_dir):
    """GET /api/runs/<id>/checks: the rows of the Pull request panel's
    Self-verification section, and where they came from."""
    reported = view(run_dir)
    if reported:
        return {"source": "reported", "checks": reported}
    recorded = ship_proof(run_dir)
    return {"source": "ship" if recorded else None, "checks": recorded}
