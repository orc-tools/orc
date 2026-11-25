"""Collision radar: launch overlap prediction, Build-time main sync, queue trial
merges (`git merge-tree`), and per-project generated-file regeneration rules.

stdlib-only, shared by `ui/serve.py` and `bin/` helpers.
"""
from __future__ import annotations

from collections import OrderedDict
from collections.abc import Set
import contextlib
from datetime import datetime, timezone
import fcntl
import functools
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import time

import project_settings
import run_relationships

TERMINAL_STATUSES = frozenset({"complete", "merged", "merged-to-parent", "cancelled"})
NON_BUILD_ROUTES = frozenset(run_relationships.NON_BUILD_ROUTES)
SHA_RE = re.compile(r"^[0-9a-fA-F]{40}$")
DIFF_HEADER_RE = re.compile(r"^diff --git a/(.+?) b/(.+)$")
PATH_TOKEN_RE = re.compile(
    r"(?<![A-Za-z0-9_@])(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,10}"
    r"|(?<![A-Za-z0-9_@/.-])[A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:py|js|mjs|cjs|ts|tsx|jsx|css|html|json|md|mdx|sh|toml|yaml|yml|sql|go|rs|rb|swift)\b"
)
ROUTE_TOKEN_RE = re.compile(r"/(?:api|runs)/[A-Za-z0-9_{}/-]+")
CUSTOM_ELEMENT_RE = re.compile(r"\borc-[a-z0-9-]+\b")
IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_-]{2,}")
CAMEL_SPLIT_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[_\-/]+")
SYMBOL_DEF_RE = re.compile(
    r"(?:^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]{2,})"
    r"|^\s*class\s+([A-Za-z_][A-Za-z0-9_]{2,})"
    r"|^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]{2,})"
    r"|^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]{2,})"
    r"|(/(?:api|runs)/[A-Za-z0-9_{}/-]+)"
    r"|\b(orc-[a-z0-9-]{3,})\b"
    r"|(?:id|class)=[\"']([A-Za-z0-9_-]{4,})[\"'])",
    re.M,
)

GENERIC_BASENAMES = frozenset({
    "index.js", "index.ts", "index.tsx", "main.js", "main.py", "app.js", "app.py",
    "readme.md", "package.json", "tsconfig.json", "__init__.py", "utils.py", "utils.js",
    "types.ts", "styles.css", "config.json", "setup.py",
})

STOPWORDS = frozenset({
    "about", "above", "across", "after", "again", "against", "all", "already", "also",
    "always", "and", "another", "any", "are", "around", "back", "base", "because", "been",
    "before", "being", "below", "between", "both", "branch", "build", "button", "buttons",
    "call", "calls", "can", "cannot", "change", "changed", "changes", "check", "checks",
    "clean", "click", "code", "command", "commands", "commit", "commits", "component",
    "conflict", "conflicts", "context", "copy", "core", "could", "create", "current",
    "data", "default", "delete", "diff", "diffs", "directly", "does", "done", "dont",
    "down", "during", "each", "edit", "edits", "empty", "end", "ensure", "error", "errors",
    "every", "existing", "fail", "fails", "false", "feat", "feature", "field", "file",
    "files", "find", "first", "fix", "fixes", "fixed", "follow", "for", "from", "full",
    "function", "get", "gets", "git", "give", "handle", "has", "have", "head", "help",
    "helper", "here", "hit", "how", "html", "into", "its", "json", "just", "keep", "keeps",
    "key", "keys", "land", "lands", "last", "later", "launch", "lead", "left", "let",
    "lets", "like", "likely", "line", "lines", "link", "list", "live", "load", "local",
    "look", "mac", "made", "main", "make", "makes", "many", "match", "matches", "may",
    "merge", "merged", "merges", "message", "mode", "more", "most", "move", "moved",
    "moves", "must", "name", "named", "names", "need", "needs", "never", "new", "next",
    "none", "not", "note", "nothing", "now", "null", "off", "offer", "once", "one", "only",
    "open", "opens", "option", "options", "orc", "order", "other", "our", "out", "over",
    "own", "page", "pages", "panel", "part", "pass", "passes", "path", "paths", "per",
    "pick", "place", "plan", "project", "projects", "prompt", "pull", "push", "put",
    "read", "reads", "ready", "real", "record", "recorded", "ref", "remove", "render",
    "repo", "repository", "request", "reset", "resets", "resolve", "result", "return",
    "returns", "right", "row", "rows", "rule", "rules", "run", "running", "runs", "same",
    "save", "saved", "screen", "script", "section", "see", "select", "send", "server",
    "session", "set", "sets", "settle", "settles", "ship", "should", "show", "shows",
    "side", "single", "skip", "some", "sort", "source", "split", "start", "started",
    "starts", "state", "status", "stay", "stays", "step", "steps", "still", "stop",
    "store", "string", "style", "such", "support", "supports", "sure", "switch", "sync",
    "system", "tab", "table", "take", "takes", "target", "task", "test", "tests", "text",
    "than", "that", "the", "their", "them", "then", "there", "these", "they", "thing",
    "this", "those", "three", "through", "time", "title", "today", "toggle", "tool",
    "top", "touch", "touched", "touches", "tree", "true", "turn", "turns", "two", "type",
    "under", "until", "update", "updated", "updates", "use", "used", "user", "uses",
    "using", "valid", "validate", "value", "values", "view", "views", "wait", "waiting",
    "waits", "want", "way", "when", "whenever", "where", "which", "while", "who", "whose",
    "why", "will", "with", "without", "work", "working", "works", "worktree", "worktrees",
    "would", "write", "writes", "wrote", "you", "your",
})

_CACHE_LOCK = threading.Lock()
_TRIAL_MERGE_CACHE: OrderedDict[tuple, dict] = OrderedDict()
_REPO_INDEX_CACHE: OrderedDict[tuple, dict] = OrderedDict()
_RUN_DIFF_CACHE: OrderedDict[str, tuple[float, tuple, list[str], dict[str, set[str]]]] = OrderedDict()

TRIAL_CACHE_LIMIT = 512
REPO_INDEX_LIMIT = 16
RUN_DIFF_CACHE_LIMIT = 128
LIVE_WORKTREE_TTL_SECONDS = 2.0
REGENERATE_TIMEOUT_SECONDS = 120


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def git_env(*, readonly: bool = False) -> dict[str, str]:
    env = dict(os.environ, ORC_DEFER_RUNTIME_CHECK="1")
    for name in ("GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE",
                 "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"):
        env.pop(name, None)
    if readonly:
        env["GIT_OPTIONAL_LOCKS"] = "0"
    return env


def run_git(repo: str | Path, *args: str, timeout: float = 30, readonly: bool = False):
    try:
        return subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=timeout,
            env=git_env(readonly=readonly),
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


def canonical_repo(path: str | Path | None) -> str | None:
    if not isinstance(path, (str, Path)) or not str(path).strip():
        return None
    expanded = os.path.expanduser(str(path).strip())
    if not os.path.isdir(expanded):
        return None
    res = run_git(expanded, "rev-parse", "--show-toplevel", readonly=True)
    if res is not None and res.returncode == 0 and res.stdout.strip():
        return os.path.realpath(res.stdout.strip())
    return os.path.realpath(expanded)


def default_branch(repo: str | Path) -> str | None:
    res = run_git(repo, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD", readonly=True)
    if res is not None and res.returncode == 0 and "/" in res.stdout:
        return res.stdout.strip().split("/", 1)[1]
    for candidate in ("main", "master"):
        verify = run_git(repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{candidate}", readonly=True)
        if verify is not None and verify.returncode == 0:
            return candidate
    return None


def ref_sha(repo: str | Path, ref: str | None) -> str | None:
    if not isinstance(ref, str) or not ref.strip():
        return None
    res = run_git(repo, "rev-parse", "--verify", "--quiet", f"{ref.strip()}^{{commit}}", readonly=True)
    if res is None or res.returncode != 0:
        return None
    sha = res.stdout.strip()
    return sha if SHA_RE.fullmatch(sha) else None


def default_branch_head(repo: str | Path) -> tuple[str | None, str | None]:
    branch = default_branch(repo)
    if not branch:
        return None, None
    return branch, ref_sha(repo, f"refs/heads/{branch}")


def is_ancestor(repo: str | Path, older: str | None, newer: str | None) -> bool:
    if not older or not newer:
        return False
    if older == newer:
        return True
    res = run_git(repo, "merge-base", "--is-ancestor", older, newer, readonly=True)
    return bool(res is not None and res.returncode == 0)


def unmerged_paths(repo: str | Path) -> list[str]:
    res = run_git(repo, "diff", "--name-only", "--diff-filter=U", readonly=True)
    if res is None or res.returncode != 0:
        return []
    return [line for line in res.stdout.splitlines() if line]


@functools.lru_cache(maxsize=512)
def glob_regex(pattern: str) -> re.Pattern[str]:
    """Compile a repo-relative glob. A bare filename with no `/` matches at any
    depth (like `.gitignore`), while a pattern containing `/` is root-anchored."""
    pattern = pattern.strip().replace("\\", "/")
    while pattern.startswith("./"):
        pattern = pattern[2:]
    out: list[str] = []
    if "/" not in pattern and not pattern.startswith("**"):
        out.append("(?:.*/)?")
    i = 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        elif pattern[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    return re.compile("".join(out) + r"\Z")


def repo_generated_rules(repo: str | Path | None, config_dir: str | None = None) -> list[dict]:
    if not repo:
        return []
    return project_settings.generated_files(project_settings.entry(str(repo), config_dir=config_dir))


def rules_digest(rules: list[dict]) -> str:
    if not rules:
        return ""
    payload = json.dumps(rules, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()[:16]


def partition_generated_paths(paths: list[str], rules: list[dict]) -> tuple[list[str], list[str], list[dict]]:
    """Split `paths` into `(generated_paths, code_paths, matched_rules)`."""
    if not paths or not rules:
        return [], list(paths), []
    compiled = [(rule, glob_regex(rule["pattern"])) for rule in rules]
    generated: list[str] = []
    code: list[str] = []
    triggered_indices: list[int] = []
    for path in paths:
        matched = False
        for idx, (_rule, rx) in enumerate(compiled):
            if rx.match(path):
                matched = True
                if idx not in triggered_indices:
                    triggered_indices.append(idx)
        if matched:
            generated.append(path)
        else:
            code.append(path)
    return generated, code, [rules[idx] for idx in triggered_indices]


def both_sides_changed_files(repo: str | Path, ours: str, theirs: str) -> list[str]:
    mb_res = run_git(repo, "merge-base", ours, theirs, readonly=True)
    if mb_res is None or mb_res.returncode != 0 or not mb_res.stdout.strip():
        return []
    mb = mb_res.stdout.strip()
    ours_res = run_git(repo, "diff", "--name-only", f"{mb}..{ours}", readonly=True)
    theirs_res = run_git(repo, "diff", "--name-only", f"{mb}..{theirs}", readonly=True)
    if ours_res is None or theirs_res is None or ours_res.returncode != 0 or theirs_res.returncode != 0:
        return []
    ours_files = {line for line in ours_res.stdout.splitlines() if line}
    theirs_files = {line for line in theirs_res.stdout.splitlines() if line}
    return sorted(ours_files & theirs_files)


def _clear_generated_conflict(checkout: str | Path, path: str) -> None:
    """Replace conflict markers in `path` with a clean single-side blob before
    running its generator command, so generators that read the existing file
    never fail on `<<<<<<<` conflict markers."""
    ours_exists = run_git(checkout, "cat-file", "-e", f"HEAD:{path}", readonly=True)
    if ours_exists is not None and ours_exists.returncode == 0:
        run_git(checkout, "checkout", "--ours", "--", path)
        run_git(checkout, "add", "--", path)
        return
    theirs_exists = run_git(checkout, "cat-file", "-e", f"MERGE_HEAD:{path}", readonly=True)
    if theirs_exists is not None and theirs_exists.returncode == 0:
        run_git(checkout, "checkout", "--theirs", "--", path)
        run_git(checkout, "add", "--", path)
        return
    run_git(checkout, "rm", "-f", "--ignore-unmatch", "--", path)


def _dirty_and_untracked(checkout: str | Path) -> list[str]:
    changed: set[str] = set()
    for args in (
        ("diff", "--name-only"),
        ("diff", "--name-only", "--cached"),
        ("ls-files", "--others", "--exclude-standard"),
    ):
        res = run_git(checkout, *args, readonly=True)
        if res is not None and res.returncode == 0:
            changed.update(line for line in res.stdout.splitlines() if line)
    return sorted(changed)


def regenerate_in_checkout(
    checkout: str | Path,
    rules_to_run: list[dict],
    unmerged_generated: list[str],
    *,
    env: dict[str, str] | None = None,
    timeout: float = REGENERATE_TIMEOUT_SECONDS,
) -> tuple[bool, list[str], str | None]:
    """Run triggered generated-file commands in `checkout` and stage outputs."""
    if not rules_to_run:
        return True, [], None
    for path in unmerged_generated:
        _clear_generated_conflict(checkout, path)
    run_env = dict(env or git_env())
    shell = run_env.get("SHELL") or "/bin/sh"
    for rule in rules_to_run:
        try:
            proc = subprocess.run(
                [shell, "-c", rule["command"]],
                cwd=str(checkout),
                env=run_env,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                errors="replace",
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return False, [], f"generated file command timed out for {rule['pattern']}: {rule['command']}"
        except OSError as exc:
            return False, [], f"generated file command could not run for {rule['pattern']}: {exc}"
        if proc.returncode != 0:
            lines = [ln.strip() for ln in (proc.stderr or proc.stdout or "").splitlines() if ln.strip()]
            detail = lines[-1] if lines else f"exit {proc.returncode}"
            return False, [], f"generated file command failed for {rule['pattern']}: {detail}"

    patterns = [glob_regex(rule["pattern"]) for rule in rules_to_run]
    to_stage = set(unmerged_generated)
    for path in _dirty_and_untracked(checkout):
        if any(rx.match(path) for rx in patterns):
            to_stage.add(path)
    staged = sorted(to_stage)
    if staged:
        add_res = run_git(checkout, "add", "-A", "--", *staged)
        if add_res is None or add_res.returncode != 0:
            detail = (add_res.stderr or add_res.stdout).strip() if add_res else "git add failed"
            return False, [], f"could not stage regenerated files: {detail}"
    remaining = [p for p in unmerged_paths(checkout) if any(rx.match(p) for rx in patterns)]
    if remaining:
        return False, [], f"generated files remain unmerged: {', '.join(remaining[:5])}"
    return True, staged, None


def trial_merge(
    repo: str | Path | None,
    source_head: str | None,
    *,
    target_branch: str | None = None,
    config_dir: str | None = None,
) -> dict:
    """Non-mutating `git merge-tree` check of `source_head` into `main`."""
    empty = {
        "conflictsWithMain": False,
        "conflictFiles": [],
        "regeneratedFiles": [],
        "targetBranch": target_branch,
        "targetHead": None,
    }
    real_repo = canonical_repo(repo)
    if not real_repo or not source_head:
        return empty
    branch = target_branch or default_branch(real_repo)
    if not branch:
        return empty
    target_head = ref_sha(real_repo, f"refs/heads/{branch}")
    resolved_source = ref_sha(real_repo, source_head)
    if not target_head or not resolved_source:
        return {**empty, "targetBranch": branch, "targetHead": target_head}
    if is_ancestor(real_repo, resolved_source, target_head):
        return {
            "conflictsWithMain": False,
            "conflictFiles": [],
            "regeneratedFiles": [],
            "targetBranch": branch,
            "targetHead": target_head,
            "contained": True,
        }
    rules = repo_generated_rules(real_repo, config_dir=config_dir)
    cache_key = (real_repo, target_head, resolved_source, rules_digest(rules))
    with _CACHE_LOCK:
        cached = _TRIAL_MERGE_CACHE.get(cache_key)
        if cached is not None:
            _TRIAL_MERGE_CACHE.move_to_end(cache_key)
            return dict(cached)

    res = run_git(
        real_repo,
        "merge-tree",
        "--write-tree",
        "--name-only",
        "--no-messages",
        target_head,
        resolved_source,
        readonly=True,
    )
    if res is None or res.returncode not in (0, 1):
        return {**empty, "targetBranch": branch, "targetHead": target_head}
    raw_conflicts = [line for line in res.stdout.splitlines()[1:] if line] if res.returncode == 1 else []
    regenerated, blocking, _ = partition_generated_paths(raw_conflicts, rules)
    verdict = {
        "conflictsWithMain": bool(blocking),
        "conflictFiles": blocking,
        "regeneratedFiles": regenerated,
        "targetBranch": branch,
        "targetHead": target_head,
    }
    with _CACHE_LOCK:
        _TRIAL_MERGE_CACHE[cache_key] = dict(verdict)
        while len(_TRIAL_MERGE_CACHE) > TRIAL_CACHE_LIMIT:
            _TRIAL_MERGE_CACHE.popitem(last=False)
    return verdict


def _split_words(token: str) -> list[str]:
    parts = [p.lower() for p in CAMEL_SPLIT_RE.split(token) if p]
    return [p for p in parts if len(p) >= 3 and p not in STOPWORDS and not p.isdigit()]


def _extract_prompt_signals(prompt: str) -> dict:
    paths: set[str] = set()
    for match in PATH_TOKEN_RE.finditer(prompt):
        cleaned = match.group(0).strip("`'\".,:;()[]{}").lstrip("./")
        if cleaned:
            paths.add(cleaned)
    routes = {m.group(0).rstrip(".,:;)'\"") for m in ROUTE_TOKEN_RE.finditer(prompt)}
    elements = {m.group(0).lower() for m in CUSTOM_ELEMENT_RE.finditer(prompt)}
    compounds: set[str] = set()
    words: set[str] = set()
    for match in IDENT_RE.finditer(prompt):
        raw = match.group(0)
        norm = re.sub(r"[-\s]+", "_", raw).lower().strip("_")
        if ("_" in norm or "-" in raw or any(ch.isupper() for ch in raw[1:])) and len(norm) >= 4:
            if norm not in STOPWORDS:
                compounds.add(norm)
        for word in _split_words(raw):
            words.add(word)
    return {
        "paths": paths,
        "routes": routes,
        "elements": elements,
        "compounds": compounds,
        "words": words,
    }


def _repo_index(real_repo: str) -> dict:
    _branch, main_head = default_branch_head(real_repo)
    key = (real_repo, main_head or "HEAD")
    with _CACHE_LOCK:
        cached = _REPO_INDEX_CACHE.get(key)
        if cached is not None:
            _REPO_INDEX_CACHE.move_to_end(key)
            return cached

    ls_res = run_git(real_repo, "ls-files", "-z", readonly=True)
    tracked = [p for p in (ls_res.stdout.split("\0") if ls_res and ls_res.returncode == 0 else []) if p]
    by_basename: dict[str, list[str]] = {}
    stem_words: dict[str, set[str]] = {}
    stem_compounds: dict[str, set[str]] = {}
    word_df: dict[str, int] = {}
    for path in tracked:
        base = os.path.basename(path)
        by_basename.setdefault(base.lower(), []).append(path)
        stem, _ext = os.path.splitext(base)
        s_norm = re.sub(r"[-\s]+", "_", stem).lower().strip("_")
        if len(s_norm) >= 4 and s_norm not in STOPWORDS:
            stem_compounds.setdefault(path, set()).add(s_norm)
        wset = set(_split_words(stem))
        parent = os.path.basename(os.path.dirname(path))
        if parent and parent.lower() not in ("src", "lib", "app", "ui", "js", "bin", "docs", "tests", "test"):
            wset.update(_split_words(parent))
        if wset:
            stem_words[path] = wset
            for word in wset:
                word_df[word] = word_df.get(word, 0) + 1

    cochange: dict[str, list[tuple[str, float]]] = {}
    log_res = run_git(
        real_repo, "log", "-n", "160", "--no-merges", "--name-only", "--pretty=format:__COMMIT__",
        readonly=True,
    )
    if log_res is not None and log_res.returncode == 0:
        counts: dict[str, int] = {}
        pairs: dict[str, dict[str, int]] = {}
        current: set[str] = set()
        for raw_line in log_res.stdout.splitlines() + ["__COMMIT__"]:
            line = raw_line.strip()
            if line == "__COMMIT__":
                if 1 < len(current) <= 25:
                    items = sorted(current)
                    for a in items:
                        counts[a] = counts.get(a, 0) + 1
                        row = pairs.setdefault(a, {})
                        for b in items:
                            if a != b:
                                row[b] = row.get(b, 0) + 1
                current = set()
            elif line:
                current.add(line)
        for a, row in pairs.items():
            denom = counts.get(a, 0)
            if denom < 2:
                continue
            related = [
                (b, together / denom)
                for b, together in row.items()
                if together >= 2 and (together / denom) >= 0.35
            ]
            if related:
                related.sort(key=lambda item: (-item[1], item[0]))
                cochange[a] = related[:8]

    index = {
        "tracked": set(tracked),
        "trackedList": tracked,
        "byBasename": by_basename,
        "stemWords": stem_words,
        "stemCompounds": stem_compounds,
        "wordDf": word_df,
        "cochange": cochange,
    }
    with _CACHE_LOCK:
        _REPO_INDEX_CACHE[key] = index
        while len(_REPO_INDEX_CACHE) > REPO_INDEX_LIMIT:
            _REPO_INDEX_CACHE.popitem(last=False)
    return index


def _parse_patch_files_and_tokens(patch_path: str) -> tuple[list[str], dict[str, set[str]]]:
    files: list[str] = []
    tokens_by_file: dict[str, set[str]] = {}
    current_file: str | None = None
    try:
        with open(patch_path, errors="replace") as handle:
            for line in handle:
                header = DIFF_HEADER_RE.match(line)
                if header:
                    current_file = header.group(2)
                    if current_file not in tokens_by_file:
                        files.append(current_file)
                        tokens_by_file[current_file] = set()
                    continue
                if current_file is None:
                    continue
                if line.startswith(("@@", "+", "-")) and not line.startswith(("+++", "---")):
                    bucket = tokens_by_file[current_file]
                    if len(bucket) < 160:
                        for m in IDENT_RE.finditer(line):
                            raw = m.group(0)
                            norm = re.sub(r"[-\s]+", "_", raw).lower().strip("_")
                            if len(norm) >= 4 and norm not in STOPWORDS:
                                bucket.add(norm)
                            bucket.update(_split_words(raw))
                        for m in ROUTE_TOKEN_RE.finditer(line):
                            bucket.add(m.group(0))
                        for m in CUSTOM_ELEMENT_RE.finditer(line):
                            bucket.add(m.group(0).lower())
    except OSError:
        return [], {}
    return files, tokens_by_file


def _file_symbol_tokens(checkout: str, rel_path: str, limit_bytes: int = 300_000) -> set[str]:
    full = os.path.join(checkout, rel_path)
    out: set[str] = set()
    try:
        with open(full, "rb") as handle:
            chunk = handle.read(limit_bytes).decode("utf-8", errors="replace")
    except OSError:
        return out
    for match in SYMBOL_DEF_RE.finditer(chunk):
        sym = next((g for g in match.groups() if g), None)
        if not sym:
            continue
        if sym.startswith("/"):
            out.add(sym)
        elif sym.startswith("orc-"):
            out.add(sym.lower())
        else:
            norm = re.sub(r"[-\s]+", "_", sym).lower().strip("_")
            if len(norm) >= 4 and norm not in STOPWORDS:
                out.add(norm)
            out.update(_split_words(sym))
        if len(out) >= 400:
            break
    return out


def _live_run_candidate(meta: dict) -> bool:
    if not isinstance(meta, dict):
        return False
    status = meta.get("status")
    if status in TERMINAL_STATUSES or meta.get("phase") == "done":
        return False
    if meta.get("outcome") == "question" or meta.get("route") in NON_BUILD_ROUTES:
        return False
    if run_relationships.retired_lifecycle(meta):
        return False
    start_after = meta.get("startAfter")
    if isinstance(start_after, dict) and start_after.get("waiting") is True:
        return False
    return True


def _run_touched_files(runs_dir: str, run_id: str, meta: dict, real_repo: str) -> tuple[list[str], dict[str, set[str]]]:
    run_dir = os.path.join(runs_dir, run_id)
    patch_path = os.path.join(run_dir, "diff.patch")
    now = time.monotonic()

    if meta.get("phase") in ("ship", "present", "recap") and os.path.isfile(patch_path):
        try:
            sig = ("patch", os.path.getmtime(patch_path), os.path.getsize(patch_path))
        except OSError:
            sig = None
        if sig is not None:
            with _CACHE_LOCK:
                cached = _RUN_DIFF_CACHE.get(run_id)
                if cached and cached[1] == sig:
                    return list(cached[2]), cached[3]
            files, tokens = _parse_patch_files_and_tokens(patch_path)
            with _CACHE_LOCK:
                _RUN_DIFF_CACHE[run_id] = (now, sig, files, tokens)
                while len(_RUN_DIFF_CACHE) > RUN_DIFF_CACHE_LIMIT:
                    _RUN_DIFF_CACHE.popitem(last=False)
            return files, tokens

    checkout = os.path.expanduser(str(meta.get("repoPath") or ""))
    branch = meta.get("branch")
    separate_worktree = bool(checkout and os.path.isdir(checkout) and os.path.realpath(checkout) != real_repo)
    target_repo = checkout if separate_worktree else real_repo
    tip_ref = "HEAD" if separate_worktree else (f"refs/heads/{branch}" if isinstance(branch, str) and branch else None)
    if not tip_ref:
        return [], {}

    with _CACHE_LOCK:
        cached = _RUN_DIFF_CACHE.get(run_id)
        if cached and (now - cached[0]) < LIVE_WORKTREE_TTL_SECONDS:
            return list(cached[2]), cached[3]

    tip_sha = ref_sha(target_repo, tip_ref)
    if not tip_sha:
        return [], {}
    base = meta.get("buildBaseCommit")
    if not (isinstance(base, str) and SHA_RE.fullmatch(base)):
        def_branch = default_branch(real_repo)
        mb = run_git(target_repo, "merge-base", tip_sha, f"refs/heads/{def_branch}", readonly=True) if def_branch else None
        base = mb.stdout.strip() if mb and mb.returncode == 0 and mb.stdout.strip() else None
    if not base:
        return [], {}

    index_mtime = 0.0
    if separate_worktree:
        git_dir_res = run_git(target_repo, "rev-parse", "--git-path", "index", readonly=True)
        if git_dir_res and git_dir_res.returncode == 0:
            idx_path = git_dir_res.stdout.strip()
            if not os.path.isabs(idx_path):
                idx_path = os.path.join(target_repo, idx_path)
            with contextlib.suppress(OSError):
                index_mtime = os.path.getmtime(idx_path)

    sig = ("git", base, tip_sha, index_mtime)
    with _CACHE_LOCK:
        cached = _RUN_DIFF_CACHE.get(run_id)
        if cached and cached[1] == sig and (not separate_worktree or (now - cached[0]) < LIVE_WORKTREE_TTL_SECONDS):
            return list(cached[2]), cached[3]

    touched: set[str] = set()
    res = run_git(target_repo, "diff", "--name-only", f"{base}..{tip_sha}", readonly=True)
    if res is not None and res.returncode == 0:
        touched.update(line for line in res.stdout.splitlines() if line)
    if separate_worktree:
        for extra_args in (("diff", "--name-only", "HEAD"), ("ls-files", "--others", "--exclude-standard")):
            extra = run_git(target_repo, *extra_args, readonly=True)
            if extra is not None and extra.returncode == 0:
                touched.update(line for line in extra.stdout.splitlines() if line)

    files = sorted(touched)
    tokens_by_file: dict[str, set[str]] = {}
    if files:
        diff_res = run_git(target_repo, "diff", "-U0", f"{base}..{tip_sha}", readonly=True)
        current_file: str | None = None
        if diff_res is not None and diff_res.returncode == 0:
            for line in diff_res.stdout.splitlines():
                header = DIFF_HEADER_RE.match(line)
                if header:
                    current_file = header.group(2)
                    tokens_by_file.setdefault(current_file, set())
                    continue
                if current_file and line.startswith(("@@", "+", "-")) and not line.startswith(("+++", "---")):
                    bucket = tokens_by_file[current_file]
                    if len(bucket) < 160:
                        for m in IDENT_RE.finditer(line):
                            raw = m.group(0)
                            norm = re.sub(r"[-\s]+", "_", raw).lower().strip("_")
                            if len(norm) >= 4 and norm not in STOPWORDS:
                                bucket.add(norm)
                            bucket.update(_split_words(raw))
                        for m in ROUTE_TOKEN_RE.finditer(line):
                            bucket.add(m.group(0))
                        for m in CUSTOM_ELEMENT_RE.finditer(line):
                            bucket.add(m.group(0).lower())
        for path in files[:25]:
            tokens_by_file.setdefault(path, set()).update(_file_symbol_tokens(target_repo, path))

    with _CACHE_LOCK:
        _RUN_DIFF_CACHE[run_id] = (now, sig, files, tokens_by_file)
        while len(_RUN_DIFF_CACHE) > RUN_DIFF_CACHE_LIMIT:
            _RUN_DIFF_CACHE.popitem(last=False)
    return files, tokens_by_file


def predict_collisions(
    runs_dir: str | Path,
    repo_path: str | Path | None,
    prompt_text: str,
    *,
    metas: dict[str, dict] | None = None,
    settled_run_ids: Set[str] = frozenset(),
) -> list[dict]:
    """Return live runs in `repo_path` whose diffs already touch files that
    `prompt_text` is likely to touch."""
    prompt = (prompt_text or "").strip()
    if len(prompt) < 3:
        return []
    real_repo = canonical_repo(repo_path)
    if not real_repo:
        return []
    runs_root = str(Path(runs_dir).expanduser())
    if metas is None:
        metas = {}
        with contextlib.suppress(OSError):
            with os.scandir(runs_root) as entries:
                for entry in entries:
                    if entry.name.startswith(".") or not entry.is_dir():
                        continue
                    try:
                        with open(os.path.join(entry.path, "meta.json")) as handle:
                            data = json.load(handle)
                        if isinstance(data, dict):
                            metas[entry.name] = data
                    except (OSError, ValueError):
                        continue

    live_runs: list[tuple[str, dict, list[str], dict[str, set[str]]]] = []
    all_live_files: set[str] = set()
    for run_id, meta in metas.items():
        if run_id in settled_run_ids or not _live_run_candidate(meta):
            continue
        run_repo = canonical_repo(meta.get("mainRepoPath") or meta.get("repoPath"))
        if run_repo != real_repo:
            continue
        files, file_tokens = _run_touched_files(runs_root, run_id, meta, real_repo)
        if not files:
            continue
        live_runs.append((run_id, meta, files, file_tokens))
        all_live_files.update(files)

    if not live_runs:
        return []

    signals = _extract_prompt_signals(prompt)
    if not any(signals.values()):
        return []

    index = _repo_index(real_repo)
    scores: dict[str, float] = {}
    direct: set[str] = set()

    def bump(path: str, score: float, is_direct: bool = False) -> None:
        if score > scores.get(path, 0.0):
            scores[path] = score
        if is_direct:
            direct.add(path)

    all_known_files = index["tracked"] | all_live_files
    for raw_path in signals["paths"]:
        lower_raw = raw_path.lower()
        if raw_path in all_known_files:
            bump(raw_path, 1.0, True)
            continue
        if "/" in raw_path:
            suffix = "/" + raw_path
            for candidate in all_known_files:
                if candidate.lower().endswith(suffix.lower()):
                    bump(candidate, 0.98, True)
        else:
            matches = list(index["byBasename"].get(lower_raw, []))
            for live_path in all_live_files:
                if os.path.basename(live_path).lower() == lower_raw and live_path not in matches:
                    matches.append(live_path)
            if matches and (lower_raw not in GENERIC_BASENAMES or len(matches) == 1):
                weight = 0.95 if len(matches) == 1 else 0.82
                for candidate in matches[:6]:
                    bump(candidate, weight, True)

    prompt_words = signals["words"]
    prompt_compounds = signals["compounds"]
    word_df = index["wordDf"]
    for path, compounds in index["stemCompounds"].items():
        if compounds & prompt_compounds:
            bump(path, 0.88, True)
    for path, fwords in index["stemWords"].items():
        shared = fwords & prompt_words
        if not shared:
            continue
        if len(fwords) >= 2 and shared == fwords:
            bump(path, 0.86, True)
        elif len(shared) >= 2:
            bump(path, 0.78, True)
        else:
            word = next(iter(shared))
            df = word_df.get(word, 999)
            if len(word) >= 5 and df <= 4:
                bump(path, 0.74, True)

    for _run_id, _meta, files, file_tokens in live_runs:
        for path in files:
            tokens = file_tokens.get(path) or set()
            if not tokens:
                continue
            if signals["routes"] and (signals["routes"] & tokens):
                bump(path, 0.90, True)
            if signals["elements"] and (signals["elements"] & tokens):
                bump(path, 0.88, True)
            compound_hits = signals["compounds"] & tokens
            if compound_hits:
                bump(path, 0.82, True)
            word_hits = {
                w for w in (prompt_words & tokens)
                if len(w) >= 4 and word_df.get(w, 0) <= 12
            }
            if len(word_hits) >= 2:
                bump(path, 0.72, True)

    # Expand from high-confidence matches so hub files (such as ui/serve.py or
    # ui/index.html) still surface when a prompt only names a companion module.
    seed_items = [(path, sc) for path, sc in list(scores.items()) if sc >= 0.72]
    cochange = index["cochange"]
    for seed_path, seed_score in seed_items:
        for neighbor, prob in cochange.get(seed_path, ()):
            expanded = round(seed_score * prob, 4)
            if expanded >= 0.30:
                bump(neighbor, expanded, False)

    predicted = {path: sc for path, sc in scores.items() if sc >= 0.30}
    if not predicted:
        return []

    results: list[dict] = []
    for run_id, meta, files, _tokens in live_runs:
        overlaps = [f for f in files if f in predicted]
        if not overlaps:
            continue
        overlaps.sort(key=lambda f: (f not in direct, -predicted[f], f))
        branch = meta.get("branch") if isinstance(meta.get("branch"), str) and meta.get("branch").strip() else None
        can_build_on = bool(branch and ref_sha(real_repo, f"refs/heads/{branch}"))
        top_score = max(predicted[f] for f in overlaps)
        direct_hits = [f for f in overlaps if f in direct]
        results.append({
            "runId": run_id,
            "title": meta.get("title") or run_id,
            "branch": branch,
            "phase": meta.get("phase") or "build",
            "status": meta.get("status") or "running",
            "canBuildOnBranch": can_build_on,
            "overlappingFiles": overlaps[:6],
            "moreFiles": max(0, len(overlaps) - 6),
            "directFiles": direct_hits[:6],
            "totalTouched": len(files),
            "_rank": (bool(direct_hits), round(top_score, 3), len(overlaps)),
        })

    results.sort(key=lambda row: row["_rank"], reverse=True)
    for row in results:
        row.pop("_rank", None)
    return results


def _read_json_dict(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _write_json_atomic(path: Path, data: dict) -> None:
    fd, raw = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    tmp = Path(raw)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


@contextlib.contextmanager
def run_repo_lock(runs_dir: Path, main_repo: str | None, timeout: float = 30.0):
    identity = canonical_repo(main_repo) or "unknown"
    digest = hashlib.sha256(identity.encode()).hexdigest()[:16]
    lock_file = runs_dir / f".merge-parent-{digest}.lock"
    runs_dir.mkdir(parents=True, exist_ok=True)
    with lock_file.open("a+") as handle:
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError as exc:
                if time.monotonic() >= deadline:
                    raise RuntimeError("another repository operation is holding the lock") from exc
                time.sleep(0.1)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _update_meta_base(meta: dict, new_base: str, main_repo: str) -> None:
    meta["buildBaseCommit"] = new_base
    meta.pop("buildMergeConflict", None)
    meta.pop("buildSyncNotifiedCommit", None)
    if meta.get("parentBranch"):
        # The run stops building on its parent once the parent lands on main,
        # not when it merges the parent's own new commits.
        parent_sha = ref_sha(main_repo, f"refs/heads/{meta['parentBranch']}")
        _main_branch, main_head = default_branch_head(main_repo)
        if not parent_sha or (main_head and is_ancestor(main_repo, parent_sha, main_head)
                              and is_ancestor(main_repo, parent_sha, new_base)):
            meta.pop("parentBranch", None)
    repos = meta.get("repositories")
    if isinstance(repos, list):
        for entry in repos:
            if not isinstance(entry, dict):
                continue
            entry_main = canonical_repo(entry.get("mainRepoPath") or entry.get("repoPath"))
            if (entry.get("primary") is True or entry_main == main_repo) and entry.get("buildBaseCommit"):
                entry["buildBaseCommit"] = new_base


def _git_op_in_progress(checkout: str) -> str | None:
    res = run_git(checkout, "rev-parse", "--git-dir", readonly=True)
    if res is None or res.returncode != 0:
        return "git-unavailable"
    git_dir = res.stdout.strip()
    if not os.path.isabs(git_dir):
        git_dir = os.path.join(checkout, git_dir)
    if os.path.exists(os.path.join(git_dir, "index.lock")):
        return "index-locked"
    if os.path.exists(os.path.join(git_dir, "MERGE_HEAD")):
        return "merge-in-progress"
    for marker in ("rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD"):
        if os.path.exists(os.path.join(git_dir, marker)):
            return marker
    return None


LANDED_RUN_STATUSES = ("merged", "merged-to-parent", "complete")


def stack_parents(runs_dir: Path, meta: dict, main_repo: str, main_head: str) -> list[dict]:
    """The runs a stacked run builds on, as `stackedOn` (a plan step stacked
    on the steps it waits on) or `basedOnRun` (Build on) records them, each
    with its branch tip and whether that has landed on main."""
    rows = meta.get("stackedOn")
    based_on = meta.get("basedOnRun")
    if not isinstance(rows, list) or not rows:
        rows = [based_on] if isinstance(based_on, dict) else []
    parents = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("branch"), str) or not row["branch"].strip():
            continue
        tip = ref_sha(main_repo, f"refs/heads/{row['branch'].strip()}")
        run_id = row.get("runId")
        parent = _read_json_dict(runs_dir / run_id / "meta.json") if (
            isinstance(run_id, str) and run_relationships.valid_run_id(run_id)) else None
        # A parent squash-merged on GitHub, or whose branch was deleted once it
        # merged, has landed too.
        merged = bool(parent) and (parent.get("status") in ("merged", "merged-to-parent")
                                   or parent.get("prState") == "merged")
        if tip:
            landed = merged or is_ancestor(main_repo, tip, main_head)
        else:
            # One deleted unmerged has nothing more to bring in either.
            landed = not parent or merged or parent.get("status") in LANDED_RUN_STATUSES
        parents.append({"runId": row.get("runId"), "branch": row["branch"].strip(),
                        "tip": tip, "landed": landed})
    return parents


def _stack_base_commit(worktree: str, build_base: str, tip: str, branch: str) -> str | None:
    """The base a stacked run takes when it brings in a parent's new commits:
    the parent's tip when the run's base is behind it, else a merge of the two
    made without a checkout (a run stacked on two steps starts from one)."""
    if is_ancestor(worktree, build_base, tip):
        return tip
    tree = run_git(worktree, "merge-tree", "--write-tree", build_base, tip, readonly=True)
    if tree is None or tree.returncode != 0 or not tree.stdout.split():
        return None
    commit = run_git(worktree, "commit-tree", tree.stdout.split()[0], "-p", build_base, "-p", tip,
                     "-m", f"chore: bring {branch} ({tip[:7]}) into the stack base")
    sha = commit.stdout.strip().lower() if commit is not None and commit.returncode == 0 else ""
    return sha if SHA_RE.fullmatch(sha) else None


def sync_worktree_with_main(
    run_dir: str | Path,
    *,
    leave_conflicts: bool = True,
    config_dir: str | None = None,
    use_lock: bool = True,
) -> dict:
    """Merge the default branch into a live Build worktree when `main` has moved,
    regenerate configured generated files, and reset `buildBaseCommit`."""
    run_path = Path(run_dir).expanduser().resolve()
    meta_path = run_path / "meta.json"
    meta = _read_json_dict(meta_path)
    if not meta:
        return {"state": "skipped", "reason": "run metadata unavailable"}

    lock_cm = run_repo_lock(run_path.parent, meta.get("mainRepoPath")) if use_lock else contextlib.nullcontext()
    with lock_cm:
        meta = _read_json_dict(meta_path)
        if not meta:
            return {"state": "skipped", "reason": "run metadata unavailable"}
        if meta.get("phase") != "build" or meta.get("status") not in ("running", "escalated"):
            return {"state": "skipped", "reason": "run is not in Build"}
        main_repo = canonical_repo(meta.get("mainRepoPath"))
        worktree = canonical_repo(meta.get("repoPath"))
        branch = meta.get("branch")
        if not main_repo or not worktree or main_repo == worktree:
            return {"state": "skipped", "reason": "run has no separate Build worktree"}
        if not isinstance(branch, str) or not branch.strip():
            return {"state": "skipped", "reason": "run has no branch"}

        cur_branch_res = run_git(worktree, "symbolic-ref", "--quiet", "--short", "HEAD", readonly=True)
        if cur_branch_res is None or cur_branch_res.returncode != 0 or cur_branch_res.stdout.strip() != branch:
            return {"state": "skipped", "reason": "worktree is not on recorded branch"}

        main_branch, main_head = default_branch_head(main_repo)
        worktree_head = ref_sha(worktree, "HEAD")
        build_base = meta.get("buildBaseCommit")
        if not main_branch or not main_head or not worktree_head or not (isinstance(build_base, str) and SHA_RE.fullmatch(build_base)):
            return {"state": "skipped", "reason": "git heads unavailable"}

        git_op = _git_op_in_progress(worktree)
        if git_op == "index-locked":
            return {"state": "busy", "reason": "git index is locked"}
        if git_op == "merge-in-progress":
            conflict_files = unmerged_paths(worktree)
            rules = repo_generated_rules(main_repo, config_dir=config_dir)
            unmerged_gen, unmerged_code, unmerged_rules = partition_generated_paths(conflict_files, rules)
            merge_head = ref_sha(worktree, "MERGE_HEAD")
            if not unmerged_code and merge_head and is_ancestor(worktree, build_base, merge_head):
                both = both_sides_changed_files(worktree, "HEAD", merge_head)
                _both_gen, _both_code, both_rules = partition_generated_paths(both, rules)
                triggered = list(unmerged_rules)
                for rule in both_rules:
                    if rule not in triggered:
                        triggered.append(rule)
                regenerated: list[str] = []
                if triggered:
                    ok, regenerated, err = regenerate_in_checkout(worktree, triggered, unmerged_gen)
                    if not ok:
                        return {"state": "error", "error": err}
                msg = f"chore: merge {main_branch} ({merge_head[:7]}) into {branch}"
                commit_res = run_git(worktree, "commit", "-m", msg, "--no-verify")
                if commit_res is None or commit_res.returncode != 0:
                    commit_res = run_git(worktree, "commit", "--allow-empty", "-m", msg, "--no-verify")
                if commit_res is None or commit_res.returncode != 0:
                    detail = (commit_res.stderr or commit_res.stdout).strip() if commit_res else "git commit failed"
                    return {"state": "error", "error": detail}
                new_base = main_head if merge_head == main_head else merge_head
                old_base = build_base
                _update_meta_base(meta, new_base, main_repo)
                _write_json_atomic(meta_path, meta)
                return {
                    "state": "synced",
                    "fastForward": False,
                    "targetBranch": main_branch,
                    "oldBase": old_base,
                    "newBase": new_base,
                    "head": ref_sha(worktree, "HEAD") or worktree_head,
                    "sharedFiles": [],
                    "regeneratedFiles": regenerated,
                }
            return {
                "state": "conflict-in-progress",
                "targetBranch": main_branch,
                "targetHead": merge_head or main_head,
                "files": unmerged_code,
                "regenerableFiles": unmerged_gen,
            }
        if git_op:
            return {"state": "busy", "reason": f"git operation in progress ({git_op})"}

        if build_base == main_head:
            changed = False
            if meta.pop("buildMergeConflict", None) is not None:
                changed = True
            if meta.pop("buildSyncNotifiedCommit", None) is not None:
                changed = True
            if changed:
                _write_json_atomic(meta_path, meta)
            return {"state": "up-to-date", "base": build_base, "head": worktree_head}

        # Stacked runs (Build on, or a plan step stacked on the step it waits
        # on) bring in their parent's new commits until the parent lands on
        # `main`, then merge `main` like any other run.
        target_branch, target_head, new_base = main_branch, main_head, main_head
        if not is_ancestor(worktree, build_base, main_head):
            parents = stack_parents(run_path.parent, meta, main_repo, main_head)
            if not parents or not all(parent["landed"] for parent in parents):
                moved = next((parent for parent in parents
                              if not parent["landed"] and parent["tip"]
                              and not is_ancestor(worktree, parent["tip"], worktree_head)), None)
                stack_base = moved and _stack_base_commit(
                    worktree, build_base, moved["tip"], moved["branch"])
                if not stack_base:
                    return {"state": "waiting-parent-branch", "base": build_base, "mainHead": main_head}
                target_branch, target_head, new_base = moved["branch"], moved["tip"], stack_base

        # Settling a Build merge conflict manually commits the merge before re-running sync.
        if (new_base == main_head and is_ancestor(worktree, main_head, worktree_head)
                and worktree_head != build_base):
            old_base = build_base
            _update_meta_base(meta, main_head, main_repo)
            _write_json_atomic(meta_path, meta)
            return {
                "state": "reset-base",
                "targetBranch": main_branch,
                "oldBase": old_base,
                "newBase": main_head,
                "head": worktree_head,
                "sharedFiles": [],
                "regeneratedFiles": [],
            }

        main_changed_res = run_git(worktree, "diff", "--name-only", f"{build_base}..{new_base}", readonly=True)
        main_changed = {line for line in (main_changed_res.stdout.splitlines() if main_changed_res and main_changed_res.returncode == 0 else []) if line}
        run_changed_res = run_git(worktree, "diff", "--name-only", f"{build_base}..{worktree_head}", readonly=True)
        run_changed = {line for line in (run_changed_res.stdout.splitlines() if run_changed_res and run_changed_res.returncode == 0 else []) if line}
        shared_files = sorted(main_changed & run_changed)

        dirty = set(_dirty_and_untracked(worktree))
        dirty_overlap = sorted(dirty & main_changed)
        if dirty_overlap:
            return {
                "state": "dirty-overlap",
                "targetBranch": target_branch,
                "targetHead": target_head,
                "files": dirty_overlap,
            }

        old_base = build_base
        old_head = worktree_head
        if worktree_head == build_base:
            ff = run_git(worktree, "merge", "--ff-only", "--quiet", new_base)
            if ff is None or ff.returncode != 0:
                detail = (ff.stderr or ff.stdout).strip() if ff else "fast-forward failed"
                return {"state": "error", "error": detail}
            _update_meta_base(meta, new_base, main_repo)
            _write_json_atomic(meta_path, meta)
            return {
                "state": "synced",
                "fastForward": True,
                "targetBranch": target_branch,
                "oldBase": old_base,
                "newBase": new_base,
                "oldHead": old_head,
                "head": new_base,
                "sharedFiles": [],
                "regeneratedFiles": [],
            }

        merge_res = run_git(worktree, "merge", "--no-ff", "--no-commit", new_base)
        unmerged = unmerged_paths(worktree)
        rules = repo_generated_rules(main_repo, config_dir=config_dir)
        unmerged_gen, unmerged_code, unmerged_rules = partition_generated_paths(unmerged, rules)
        both_gen, _both_code, both_rules = partition_generated_paths(shared_files, rules)
        triggered_rules = list(unmerged_rules)
        for rule in both_rules:
            if rule not in triggered_rules:
                triggered_rules.append(rule)

        if merge_res is None:
            run_git(worktree, "merge", "--abort")
            return {"state": "error", "error": "git merge could not run"}

        if merge_res.returncode != 0 and not unmerged:
            # Untracked file collisions fail git merge before writing MERGE_HEAD or unmerged entries.
            run_git(worktree, "merge", "--abort")
            detail = (merge_res.stderr or merge_res.stdout).strip()
            return {"state": "error", "error": detail}

        if not unmerged_code:
            regenerated: list[str] = []
            if triggered_rules:
                ok, regenerated, err = regenerate_in_checkout(worktree, triggered_rules, unmerged_gen)
                if not ok:
                    run_git(worktree, "merge", "--abort")
                    return {"state": "error", "error": err}
            msg = f"chore: merge {target_branch} ({target_head[:7]}) into {branch}"
            commit_res = run_git(worktree, "commit", "-m", msg, "--no-verify")
            if commit_res is None or commit_res.returncode != 0:
                # Merging main into an identical tree rejects plain commit without --allow-empty,
                # which is still needed so main_head becomes an ancestor of HEAD.
                commit_res = run_git(worktree, "commit", "--allow-empty", "-m", msg, "--no-verify")
            if commit_res is None or commit_res.returncode != 0:
                detail = (commit_res.stderr or commit_res.stdout).strip() if commit_res else "git commit failed"
                run_git(worktree, "merge", "--abort")
                return {"state": "error", "error": detail}
            new_head = ref_sha(worktree, "HEAD") or worktree_head
            _update_meta_base(meta, new_base, main_repo)
            _write_json_atomic(meta_path, meta)
            non_gen_shared = [f for f in shared_files if f not in set(both_gen)]
            return {
                "state": "synced",
                "fastForward": False,
                "targetBranch": target_branch,
                "oldBase": old_base,
                "newBase": new_base,
                "oldHead": old_head,
                "head": new_head,
                "sharedFiles": non_gen_shared,
                "regeneratedFiles": regenerated,
            }

        if not leave_conflicts:
            run_git(worktree, "merge", "--abort")
            return {
                "state": "conflicted",
                "aborted": True,
                "targetBranch": target_branch,
                "targetHead": target_head,
                "files": unmerged_code,
                "regenerableFiles": unmerged_gen,
            }

        conflict_record = {
            "target": target_branch,
            "targetHead": target_head,
            "files": unmerged_code,
            "regenerableFiles": unmerged_gen,
            "detectedAt": now_iso(),
        }
        meta["buildMergeConflict"] = conflict_record
        _write_json_atomic(meta_path, meta)
        return {
            "state": "conflicted",
            "aborted": False,
            "targetBranch": target_branch,
            "targetHead": target_head,
            "files": unmerged_code,
            "regenerableFiles": unmerged_gen,
        }
