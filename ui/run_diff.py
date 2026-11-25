"""Scoped diffs for the side panel: the last code change, or the whole branch.

The last code change is everything the most recent user turn that changed code
edited. A turn is what the user starts by sending a message; a turn Orc starts
on its own (a reminder, a notice, a rescue) carries on the user's last one.
Before a user's turn starts on a live checkout, ``capture_turn_base`` and
``commit_turn_base`` record the checkout's git tree (tracked, staged, unstaged,
and untracked non-ignored files) under ``<run_dir>/.turn-diff/base.json``, and
the change shown until then under ``previous.patch``.

``read_diff`` with ``scope="turn"`` diffs that baseline against the current
checkout tree, and keeps showing ``previous.patch`` while the turn has edited
nothing. Commits the turn brought in from the branch it builds on are not its
edits. ``scope="branch"`` diffs ``buildBaseCommit`` against the current
checkout tree. When a headless turn finishes, and at Ship, ``record_turn_diff``
saves what the panel shows as ``last.patch``, so settled and merged runs retain
it after their worktree is removed.
"""
from __future__ import annotations

import collections
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading

import collision_radar
import session_identity

STATE_DIR = ".turn-diff"
BASE_FILE = "base.json"
LAST_PATCH_FILE = "last.patch"
PREVIOUS_PATCH_FILE = "previous.patch"
HEX_OID = re.compile(r"[0-9a-fA-F]{7,64}\Z")
SAFE_REF = re.compile(r"[^A-Za-z0-9._-]+")
TERMINAL_NO_LIVE_STATUSES = {"merged", "merged-to-parent", "cancelled"}
EMPTY_SHA1 = hashlib.sha1(b"").hexdigest()

REPO_INFO_CACHE_MAX = 64
COMMIT_TREE_CACHE_MAX = 256
BASE_SYNC_CACHE_MAX = 256
TREE_CACHE_MAX = 64
DIFF_CACHE_MAX = 16
DIFF_CACHE_MAX_ENTRY_BYTES = 16 * 1024 * 1024
DIFF_CACHE_MAX_TOTAL_BYTES = 64 * 1024 * 1024

GIT_IDENTITY_ENV = {
    "GIT_AUTHOR_NAME": "Orc",
    "GIT_AUTHOR_EMAIL": "orc@localhost",
    "GIT_COMMITTER_NAME": "Orc",
    "GIT_COMMITTER_EMAIL": "orc@localhost",
}


@dataclass(frozen=True)
class DiffSnapshot:
    patch: bytes
    etag: str


@dataclass(frozen=True)
class TurnBase:
    """A new turn's baseline, and the change the panel showed before it."""
    record: dict
    shown: bytes


@dataclass(frozen=True)
class _RepoInfo:
    repo_id: tuple[str, int, int]
    common_id: tuple[str, int, int]
    common_dir: str
    index_path: str


@dataclass(frozen=True)
class _LiveProbe:
    cwd: str
    info: _RepoInfo
    branch: str | None
    head: str | None
    clean: bool
    sig: tuple[object, ...] | None


_CACHE_LOCK = threading.Lock()
_REPO_INFO_CACHE: collections.OrderedDict[tuple[str, int, int], _RepoInfo | None] = collections.OrderedDict()
_COMMIT_TREE_CACHE: collections.OrderedDict[tuple[object, ...], tuple[str, str]] = collections.OrderedDict()
_TREE_CACHE: collections.OrderedDict[tuple[str, int, int], tuple[object, str]] = collections.OrderedDict()
# What a head took in from the branches it builds on, and baselines with that
# merged in. Both are keyed by the commits and trees they were read from.
_BASE_SYNC_CACHE: collections.OrderedDict[tuple[object, ...], object] = collections.OrderedDict()
_DIFF_CACHE: collections.OrderedDict[tuple[object, ...], tuple[bytes, str]] = collections.OrderedDict()
_DIFF_CACHE_BYTES = 0


def _cached(cache: collections.OrderedDict, key):
    with _CACHE_LOCK:
        if key not in cache:
            return None
        cache.move_to_end(key)
        return cache[key]


def _remember(cache: collections.OrderedDict, limit: int, key, value) -> None:
    with _CACHE_LOCK:
        cache[key] = value
        cache.move_to_end(key)
        while len(cache) > limit:
            cache.popitem(last=False)


def _path_id(path: str) -> tuple[str, int, int] | None:
    try:
        st = os.stat(path)
    except OSError:
        return None
    return (path, st.st_dev, st.st_ino)


def _read_meta(run_dir: str) -> dict:
    try:
        with open(os.path.join(run_dir, "meta.json"), encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return session_identity.restore_launch_identity(raw, run_dir)


def _git_bytes(cwd: str, args: list[str], *, extra_env: dict[str, str] | None = None,
               optional_locks: bool = False, timeout: int = 15,
               ok_codes: tuple[int, ...] = (0,)) -> bytes | None:
    env = dict(os.environ)
    if not optional_locks:
        env["GIT_OPTIONAL_LOCKS"] = "0"
    if extra_env:
        env.update(extra_env)
    try:
        result = subprocess.run(
            ["git", "-C", cwd, *args],
            capture_output=True,
            env=env,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout if result.returncode in ok_codes else None


def _git_text(cwd: str, args: list[str], *, extra_env: dict[str, str] | None = None,
              optional_locks: bool = False, ok_codes: tuple[int, ...] = (0,)) -> str | None:
    out = _git_bytes(cwd, args, extra_env=extra_env, optional_locks=optional_locks, ok_codes=ok_codes)
    if out is None:
        return None
    return out.decode("utf-8", "replace").strip()


def _object_exists(cwd: str, spec: str) -> bool:
    return _git_bytes(cwd, ["rev-parse", "--verify", "--quiet", spec]) is not None


def _repo_info(real_cwd: str) -> _RepoInfo | None:
    repo_id = _path_id(os.path.join(real_cwd, ".git"))
    if repo_id is None:
        return None
    with _CACHE_LOCK:
        if repo_id in _REPO_INFO_CACHE:
            cached = _REPO_INFO_CACHE[repo_id]
            _REPO_INFO_CACHE.move_to_end(repo_id)
            if cached is None or _path_id(cached.common_dir) == cached.common_id:
                return cached

    out = _git_text(real_cwd, ["rev-parse", "--show-toplevel", "--git-common-dir", "--git-path", "index"])
    lines = out.splitlines() if out else []
    info: _RepoInfo | None = None
    if len(lines) == 3 and os.path.realpath(lines[0]) == real_cwd:
        raw_common, raw_index = lines[1], lines[2]
        common_dir = os.path.realpath(
            raw_common if os.path.isabs(raw_common) else os.path.join(real_cwd, raw_common)
        )
        index_path = (
            raw_index if os.path.isabs(raw_index) else os.path.normpath(os.path.join(real_cwd, raw_index))
        )
        common_id = _path_id(common_dir) or repo_id
        info = _RepoInfo(
            repo_id=repo_id,
            common_id=common_id,
            common_dir=common_dir,
            index_path=index_path,
        )

    _remember(_REPO_INFO_CACHE, REPO_INFO_CACHE_MAX, repo_id, info)
    return info


def _tree_exists(cwd: str, info: _RepoInfo | None, tree_oid: str) -> bool:
    if not isinstance(tree_oid, str) or not HEX_OID.fullmatch(tree_oid):
        return False
    # git write-tree stores uncommitted working-tree snapshots as loose objects in
    # <common_dir>/objects/xx/yyyy..., so statting the file avoids a rev-parse subprocess
    # on steady polls; packed trees fall back to rev-parse below.
    if info is not None and len(tree_oid) >= 40 and not os.environ.get("GIT_OBJECT_DIRECTORY"):
        loose = os.path.join(info.common_dir, "objects", tree_oid[:2], tree_oid[2:])
        if os.path.isfile(loose):
            return True
    return _object_exists(cwd, f"{tree_oid}^{{tree}}")


def _resolve_commit_tree(cwd: str, info: _RepoInfo | None, spec: str) -> tuple[str, str] | None:
    if not isinstance(spec, str) or not HEX_OID.fullmatch(spec):
        return None
    scope_id: tuple[object, ...] = info.common_id if info is not None else (cwd,)
    key = (*scope_id, spec.lower())
    cached = _cached(_COMMIT_TREE_CACHE, key)
    if cached is not None:
        return cached

    # Calling rev-parse without --verify resolves both ^{commit} and ^{tree} in one
    # subprocess (--verify rejects multiple revisions); HEX_OID guards spec above.
    out = _git_text(cwd, ["rev-parse", f"{spec}^{{commit}}", f"{spec}^{{tree}}"])
    lines = out.splitlines() if out else []
    if len(lines) != 2 or not (HEX_OID.fullmatch(lines[0]) and HEX_OID.fullmatch(lines[1])):
        return None
    pair = (lines[0], lines[1])
    _remember(_COMMIT_TREE_CACHE, COMMIT_TREE_CACHE_MAX, key, pair)
    _remember(_COMMIT_TREE_CACHE, COMMIT_TREE_CACHE_MAX, (*scope_id, lines[0].lower()), pair)
    return pair


def _parse_porcelain_v2(cwd: str, porcelain: bytes) -> tuple[str | None, str | None, bool, tuple[object, ...]]:
    entries = porcelain.split(b"\0")
    branch: str | None = None
    head: str | None = None
    sig_items: list[object] = []
    has_changes = False
    idx = 0
    total = len(entries)
    while idx < total:
        raw = entries[idx]
        idx += 1
        if not raw:
            continue
        if raw.startswith(b"# "):
            if raw.startswith(b"# branch.oid "):
                oid = raw[13:].decode("ascii", "replace")
                head = oid if HEX_OID.fullmatch(oid) else None
            elif raw.startswith(b"# branch.head "):
                bname = raw[14:].decode("utf-8", "replace")
                branch = None if (not bname or bname == "(detached)") else bname
            continue
        if raw.startswith(b"! "):
            continue
        has_changes = True
        kind = raw[:2]
        paths: list[str] = []
        if kind == b"1 ":
            parts = raw.split(b" ", 8)
            if len(parts) == 9:
                paths.append(parts[8].decode("utf-8", "surrogateescape"))
        elif kind == b"2 ":
            parts = raw.split(b" ", 9)
            if len(parts) == 10:
                paths.append(parts[9].decode("utf-8", "surrogateescape"))
            orig_raw = b""
            if idx < total:
                orig_raw = entries[idx]
                idx += 1
                if orig_raw:
                    paths.append(orig_raw.decode("utf-8", "surrogateescape"))
            raw = raw + b"\0" + orig_raw
        elif kind == b"u ":
            parts = raw.split(b" ", 10)
            if len(parts) == 11:
                paths.append(parts[10].decode("utf-8", "surrogateescape"))
        elif kind == b"? ":
            paths.append(raw[2:].decode("utf-8", "surrogateescape"))

        sig_items.append(raw)
        for rel in paths:
            try:
                st = os.lstat(os.path.join(cwd, rel))
                sig_items.append((rel, st.st_mtime_ns, st.st_size))
            except OSError:
                sig_items.append((rel, None, None))
    return branch, head, (not has_changes), tuple(sig_items)


def _probe_live_checkout(meta: dict) -> _LiveProbe | None:
    if not isinstance(meta, dict) or meta.get("status") in TERMINAL_NO_LIVE_STATUSES:
        return None
    wt = meta.get("worktree") if isinstance(meta.get("worktree"), dict) else {}
    wt_path = wt.get("path") if wt.get("enabled") else None
    dedicated = bool(isinstance(wt_path, str) and wt_path and os.path.isdir(os.path.expanduser(wt_path)))
    candidate = wt_path if dedicated else (meta.get("repoPath") or meta.get("mainRepoPath"))
    if not isinstance(candidate, str) or not candidate:
        return None
    expanded = os.path.expanduser(candidate)
    if not os.path.isdir(expanded):
        return None
    real_cwd = os.path.realpath(expanded)
    info = _repo_info(real_cwd)
    if info is None:
        return None

    # --porcelain=v2 --branch --untracked-files=all folds branch verification,
    # HEAD resolution, and per-file untracked fingerprinting (including files
    # inside newly created untracked directories) into a single git subprocess.
    porcelain = _git_bytes(real_cwd, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"])
    if porcelain is None:
        return None
    current, head, clean, sig_items = _parse_porcelain_v2(real_cwd, porcelain)
    wanted = meta.get("branch") if isinstance(meta.get("branch"), str) and meta.get("branch") else None
    if dedicated:
        if wanted and current and current != wanted:
            return None
    elif not (wanted and current == wanted):
        return None
    return _LiveProbe(
        cwd=real_cwd,
        info=info,
        branch=current,
        head=head,
        clean=clean,
        sig=(head, sig_items) if head else None,
    )


def _live_checkout(meta: dict) -> tuple[str, str | None] | None:
    """Return ``(real_cwd, current_branch)`` when the run owns a live git
    working tree for its branch, or ``None`` when its working tree is absent or
    shared with another checked-out branch."""
    probe = _probe_live_checkout(meta)
    return (probe.cwd, probe.branch) if probe is not None else None


def _repo_branch_tip(meta: dict) -> tuple[str, _RepoInfo, str] | None:
    """Return ``(real_repo, repo_info, tip_commit)`` when the run's branch or
    merge commit exists in its repository even without a live worktree."""
    if not isinstance(meta, dict):
        return None
    for candidate in (meta.get("mainRepoPath"), meta.get("repoPath")):
        if not isinstance(candidate, str) or not candidate:
            continue
        expanded = os.path.expanduser(candidate)
        if not os.path.isdir(expanded):
            continue
        real_repo = os.path.realpath(expanded)
        info = _repo_info(real_repo)
        if info is None:
            continue
        branch = meta.get("branch")
        if isinstance(branch, str) and branch:
            tip = _git_text(real_repo, ["rev-parse", "--verify", "--quiet", f"refs/heads/{branch}^{{commit}}"])
            if tip:
                return real_repo, info, tip
        merge_commit = meta.get("mergeCommit")
        if isinstance(merge_commit, str) and HEX_OID.fullmatch(merge_commit):
            resolved = _resolve_commit_tree(real_repo, info, merge_commit)
            if resolved:
                return real_repo, info, resolved[0]
    return None


def _configured_base_commit(meta: dict) -> str | None:
    direct = meta.get("buildBaseCommit")
    if isinstance(direct, str) and HEX_OID.fullmatch(direct):
        return direct
    repos = meta.get("repositories")
    if isinstance(repos, list):
        for entry in repos:
            if isinstance(entry, dict) and entry.get("primary"):
                cand = entry.get("buildBaseCommit")
                if isinstance(cand, str) and HEX_OID.fullmatch(cand):
                    return cand
    return None


def _branch_base(cwd: str, meta: dict, tip: str = "HEAD", *, info: _RepoInfo | None = None) -> tuple[str, str] | None:
    configured = _configured_base_commit(meta)
    if configured:
        resolved = _resolve_commit_tree(cwd, info, configured)
        if resolved:
            return resolved
    for default_ref in ("refs/remotes/origin/HEAD", "refs/heads/main", "refs/heads/master",
                        "refs/remotes/origin/main", "refs/remotes/origin/master"):
        if not _object_exists(cwd, f"{default_ref}^{{commit}}"):
            continue
        merged = _git_text(cwd, ["merge-base", tip, default_ref])
        if merged:
            resolved = _resolve_commit_tree(cwd, info, merged)
            if resolved:
                return resolved
    return None


def _working_tree_from_probe(probe: _LiveProbe, *, pin_ref: str | None = None) -> tuple[str, str] | None:
    """Return ``(head_commit, tree_oid)`` representing the checkout's current
    state, including staged, unstaged, and untracked non-ignored files."""
    if not probe.head:
        return None
    head = probe.head
    cwd = probe.cwd
    info = probe.info
    if probe.clean:
        resolved = _resolve_commit_tree(cwd, info, head)
        return (head, resolved[1]) if resolved else None

    sig = probe.sig
    cache_key = info.repo_id
    if pin_ref is None and sig is not None:
        cached = _cached(_TREE_CACHE, cache_key)
        if cached is not None and cached[0] == sig and _tree_exists(cwd, info, cached[1]):
            return head, cached[1]

    src_index = info.index_path
    with tempfile.TemporaryDirectory(prefix="orc-turn-diff-") as tmpdir:
        tmp_index = os.path.join(tmpdir, "index")
        if src_index and os.path.isfile(src_index):
            try:
                shutil.copy2(src_index, tmp_index)
            except OSError:
                pass
        env = {"GIT_INDEX_FILE": tmp_index}
        if not os.path.isfile(tmp_index):
            if _git_bytes(cwd, ["read-tree", head], extra_env=env, optional_locks=True) is None:
                return None
        if _git_bytes(cwd, ["add", "-A"], extra_env=env, optional_locks=True, timeout=30) is None:
            resolved = _resolve_commit_tree(cwd, info, head)
            return (head, resolved[1]) if resolved else None
        tree = _git_text(cwd, ["write-tree"], extra_env=env, optional_locks=True)
        if not tree:
            return None

    if pin_ref:
        safe = SAFE_REF.sub("-", pin_ref).strip("-") or "run"
        commit = _git_text(
            cwd,
            ["commit-tree", tree, "-p", head, "-m", "orc turn baseline"],
            extra_env=GIT_IDENTITY_ENV,
            optional_locks=True,
        )
        if commit:
            _git_bytes(cwd, ["update-ref", f"refs/orc/turn-base/{safe}", commit], optional_locks=True)

    if sig is not None:
        _remember(_TREE_CACHE, TREE_CACHE_MAX, cache_key, (sig, tree))
    return head, tree


def _working_tree(cwd: str, *, pin_ref: str | None = None) -> tuple[str, str] | None:
    real_cwd = os.path.realpath(cwd)
    info = _repo_info(real_cwd)
    if info is None:
        return None
    porcelain = _git_bytes(real_cwd, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"])
    if porcelain is None:
        return None
    branch, head, clean, sig_items = _parse_porcelain_v2(real_cwd, porcelain)
    probe = _LiveProbe(
        cwd=real_cwd,
        info=info,
        branch=branch,
        head=head,
        clean=clean,
        sig=(head, sig_items) if head else None,
    )
    return _working_tree_from_probe(probe, pin_ref=pin_ref)


def _git_diff_trees(cwd: str, base_tree: str, target_tree: str) -> bytes:
    if base_tree == target_tree:
        return b""
    out = _git_bytes(
        cwd,
        ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--binary", "--full-index", base_tree, target_tree],
        timeout=30,
    )
    return out or b""


def _snapshot(patch: bytes, digest: str | None = None) -> DiffSnapshot:
    digest = digest or hashlib.sha1(patch).hexdigest()
    return DiffSnapshot(patch=patch, etag=f'"{digest}"')


def _diff_trees_snapshot(cwd: str, info: _RepoInfo, base_tree: str, target_tree: str) -> DiffSnapshot:
    global _DIFF_CACHE_BYTES
    if base_tree == target_tree:
        return _snapshot(b"", EMPTY_SHA1)

    cache_key = (*info.common_id, base_tree, target_tree)
    cached = _cached(_DIFF_CACHE, cache_key)
    if cached is not None:
        return _snapshot(*cached)

    patch = _git_diff_trees(cwd, base_tree, target_tree)
    digest = hashlib.sha1(patch).hexdigest()
    if len(patch) <= DIFF_CACHE_MAX_ENTRY_BYTES:
        with _CACHE_LOCK:
            old = _DIFF_CACHE.pop(cache_key, None)
            if old is not None:
                _DIFF_CACHE_BYTES -= len(old[0])
            _DIFF_CACHE[cache_key] = (patch, digest)
            _DIFF_CACHE_BYTES += len(patch)
            while len(_DIFF_CACHE) > DIFF_CACHE_MAX or _DIFF_CACHE_BYTES > DIFF_CACHE_MAX_TOTAL_BYTES:
                _, evicted = _DIFF_CACHE.popitem(last=False)
                _DIFF_CACHE_BYTES -= len(evicted[0])
    return _snapshot(patch, digest)


def _synced_heads(probe: _LiveProbe, meta: dict, since: str) -> tuple[str, ...]:
    """The commits of the branches this run builds on (the default branch, a
    parent run's branch, ``buildBaseCommit``) that the checkout has and
    ``since`` does not: what a merge or rebase brought in. A merge still being
    resolved counts. Only the first-parent line of such a branch counts, so it
    merging this run's own commits does not make them foreign."""
    cwd, info, head = probe.cwd, probe.info, probe.head
    merging = _read_patch_file(os.path.join(os.path.dirname(info.index_path), "MERGE_HEAD")) or b""
    heads = [head, *(oid for oid in merging.decode("ascii", "replace").split() if HEX_OID.fullmatch(oid))]
    if heads == [since]:
        return ()
    parent = meta.get("parentBranch")
    names = ["main", "master", *([parent] if isinstance(parent, str) and parent else [])]
    # Its own branch, where the run works on the default branch directly.
    own = probe.branch or meta.get("branch")
    if own in ("main", "master"):
        return ()
    listed = _git_text(cwd, [
        "for-each-ref", "--format=%(objectname)", "refs/remotes/origin/HEAD",
        *(f"refs/{kind}/{name}" for name in names if name != own for kind in ("heads", "remotes/origin")),
    ])
    tips = set((listed or "").split())
    configured = _configured_base_commit(meta)
    if configured:
        tips.add(configured)
    key = (*info.common_id, "synced", since, *heads, *sorted(tips))
    cached = _cached(_BASE_SYNC_CACHE, key)
    if cached is not None:
        return cached

    synced = set()
    for tip in tips:
        # The oldest commit of the line the checkout lacks; its parent is the
        # newest one it has.
        lacking = _git_text(cwd, ["rev-list", "--first-parent", "--parents", tip, *(f"^{oid}" for oid in heads)])
        if lacking is None:
            continue
        oldest = lacking.splitlines()[-1].split() if lacking else []
        newest = tip if not lacking else oldest[1] if len(oldest) > 1 else None
        if newest and _git_bytes(cwd, ["merge-base", "--is-ancestor", newest, since]) is None:
            synced.add(newest)
    result = tuple(sorted(synced))
    _remember(_BASE_SYNC_CACHE, BASE_SYNC_CACHE_MAX, key, result)
    return result


def _tree_with_synced(probe: _LiveProbe, base_head: str, base_tree: str, synced: tuple[str, ...]) -> str:
    """``base_tree`` as it would be had ``synced`` been merged into it. Where
    the two conflict, its own side is kept, so a conflict resolved by hand
    still shows. Returns ``base_tree`` when git cannot merge them."""
    key = (*probe.info.common_id, "merged", base_head, base_tree, *synced)
    cached = _cached(_BASE_SYNC_CACHE, key)
    if cached is not None and _tree_exists(probe.cwd, probe.info, cached):
        return cached
    # Fixed dates, so reading the same diff twice writes the same objects.
    env = {**GIT_IDENTITY_ENV, "GIT_AUTHOR_DATE": "@0 +0000", "GIT_COMMITTER_DATE": "@0 +0000"}
    tree, parents = base_tree, [base_head]
    for commit in synced:
        ours = _git_text(probe.cwd, [
            "commit-tree", tree, *(arg for parent in parents for arg in ("-p", parent)), "-m", "orc turn baseline",
        ], extra_env=env, optional_locks=True)
        # Exit 1 is a merge with conflicts, which still names its tree first.
        merged = _git_text(probe.cwd, ["merge-tree", "--write-tree", "--no-messages", "-X", "ours", ours, commit],
                           optional_locks=True, ok_codes=(0, 1)) if ours else None
        tree = merged.split()[0] if merged else ""
        if not HEX_OID.fullmatch(tree):
            return base_tree
        parents = [ours, commit]
    _remember(_BASE_SYNC_CACHE, BASE_SYNC_CACHE_MAX, key, tree)
    return tree


def _edits_since(probe: _LiveProbe, meta: dict, base_head: object, base_tree: str, tree: str) -> DiffSnapshot:
    """What changed in the checkout since a baseline, without what it brought
    in from the branches it builds on."""
    synced = (_synced_heads(probe, meta, base_head)
              if base_tree != tree and isinstance(base_head, str) and HEX_OID.fullmatch(base_head) else ())
    if not synced:
        return _diff_trees_snapshot(probe.cwd, probe.info, base_tree, tree)
    merged_tree = _tree_with_synced(probe, base_head, base_tree, synced)
    edits = _diff_trees_snapshot(probe.cwd, probe.info, merged_tree, tree)
    rules = collision_radar.repo_generated_rules(
        meta.get("mainRepoPath"), config_dir=os.environ.get("ORC_CONFIG_DIR")) if edits.patch else []
    if rules:
        changed = _git_bytes(probe.cwd, ["diff", "--name-only", "--no-renames", "-z", merged_tree, tree]) or b""
        paths = [path for path in changed.decode("utf-8", "surrogateescape").split("\0") if path]
        # A sync regenerates these files itself.
        if paths and not collision_radar.partition_generated_paths(paths, rules)[1]:
            return _snapshot(b"", EMPTY_SHA1)
    return edits


def _atomic_write_bytes(path: str, payload: bytes) -> bool:
    directory = os.path.dirname(path)
    try:
        os.makedirs(directory, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=directory, prefix=".tmp-")
    except OSError:
        return False
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
        os.replace(tmp_path, path)
        return True
    except OSError:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        return False


def capture_turn_base(run_dir: str, meta: dict | None = None) -> TurnBase | None:
    """Snapshot the live checkout's current git tree and the change shown for
    it before starting a new turn, without writing into ``run_dir`` until
    ``commit_turn_base`` confirms the turn started."""
    resolved = _read_meta(run_dir) if meta is None else meta
    probe = _probe_live_checkout(resolved)
    if probe is None:
        return None
    shown = _read_diff_resolved(run_dir, resolved, scope="turn", live_probe=probe).patch
    run_id = resolved.get("runId") or os.path.basename(os.path.normpath(run_dir))
    snap = _working_tree_from_probe(probe, pin_ref=str(run_id))
    if snap is None:
        return None
    head, tree = snap
    return TurnBase({
        "schemaVersion": 1,
        "repoRoot": probe.cwd,
        "branch": probe.branch,
        "head": head,
        "tree": tree,
        "recordedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }, shown)


def commit_turn_base(run_dir: str, base: TurnBase | None) -> bool:
    if not isinstance(base, TurnBase):
        return False
    state_dir = os.path.join(run_dir, STATE_DIR)
    payload = (json.dumps(base.record, indent=2) + "\n").encode("utf-8")
    return (_atomic_write_bytes(os.path.join(state_dir, PREVIOUS_PATCH_FILE), base.shown)
            and _atomic_write_bytes(os.path.join(state_dir, BASE_FILE), payload))


def record_turn_base(run_dir: str, meta: dict | None = None) -> bool:
    return commit_turn_base(run_dir, capture_turn_base(run_dir, meta))


def _read_turn_base(run_dir: str) -> dict | None:
    path = os.path.join(run_dir, STATE_DIR, BASE_FILE)
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("schemaVersion") != 1:
        return None
    if not isinstance(data.get("repoRoot"), str) or not isinstance(data.get("tree"), str):
        return None
    return data


def _parse_iso_epoch(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


# Some transcripts stamp a prompt to the whole second, which can fall just
# before the turn's spawn time.
ORC_TURN_SLACK_SECONDS = 1.0


@dataclass(frozen=True)
class _HeadlessTurns:
    """The user's latest headless turn and when it started, and the epoch
    windows of the turns Orc started on its own since then."""
    turn: int = 0
    at: float | None = None
    orc_windows: tuple[tuple[float, float | None], ...] = ()

    def by_orc(self, at: float | None) -> bool:
        return at is not None and any(
            start - ORC_TURN_SLACK_SECONDS <= at and (end is None or at <= end)
            for start, end in self.orc_windows)


def _headless_turns(run_dir: str) -> _HeadlessTurns:
    path = os.path.join(run_dir, ".headless", "state.json")
    try:
        with open(path, encoding="utf-8") as handle:
            state = json.load(handle)
    except (OSError, ValueError):
        return _HeadlessTurns()
    if not isinstance(state, dict):
        return _HeadlessTurns()
    if isinstance(state.get("userTurn"), int):
        turn, at = state["userTurn"], state.get("userTurnAt")
        at = float(at) if isinstance(at, (int, float)) else None
    else:
        turn = state.get("turn") if isinstance(state.get("turn"), int) else 0
        spawned = state.get("spawnedAt")
        at = float(spawned) if isinstance(spawned, (int, float)) else _parse_iso_epoch(state.get("startedAt"))
    windows = []
    for window in state.get("orcTurns") or []:
        if (isinstance(window, list) and len(window) == 2
                and isinstance(window[0], (int, float))
                and (window[1] is None or isinstance(window[1], (int, float)))):
            windows.append((float(window[0]), None if window[1] is None else float(window[1])))
    if windows and windows[-1][1] is None and state.get("status") != "running":
        ended = _parse_iso_epoch(state.get("endedAt"))
        if ended is not None:
            windows[-1] = (windows[-1][0], ended)
    return _HeadlessTurns(max(0, turn), at, tuple(windows))


@dataclass(frozen=True)
class _UserTurns:
    """How many turns the user started, when each known one started (oldest
    first), and whether the latest edited files."""
    count: int
    starts: tuple[float | None, ...]
    last_edited: bool = False


def _user_turns(run_dir: str, meta: dict) -> _UserTurns:
    """The user's turns from the transcript, or just the latest from headless
    state when that has counted more. A prompt Orc sent on its own is not a
    turn."""
    headless = _headless_turns(run_dir)
    latest_only = _UserTurns(headless.turn, (headless.at,))
    try:
        import run_chat
        data = run_chat.timeline(meta, cursor=None, harness_run_dir=run_dir)
        items = data.get("items") if isinstance(data, dict) else None
    except Exception:
        items = None

    if not isinstance(items, list) or not items:
        return latest_only

    prompt_indices = [
        idx for idx, item in enumerate(items)
        if isinstance(item, dict) and item.get("kind") == "user" and not item.get("steer")
        and not headless.by_orc(_parse_iso_epoch(item.get("at")))
    ]
    count = len(prompt_indices)
    if headless.turn > count or count == 0:
        return latest_only

    starts = [_parse_iso_epoch(items[idx].get("at")) for idx in prompt_indices]
    if starts[-1] is None and headless.turn == count:
        starts[-1] = headless.at
    last_edited = any(
        isinstance(item, dict)
        and item.get("kind") == "tool"
        and (item.get("category") == "edit" or bool(item.get("files")))
        for item in items[prompt_indices[-1] + 1:]
    )
    return _UserTurns(count, tuple(starts), last_edited)


def _commits_before_turns(cwd: str, base_commit: str, tip_commit: str, turns: _UserTurns) -> list[str]:
    """For each turn, latest first, the newest commit in
    ``base_commit..tip_commit`` created strictly before it started, or
    ``base_commit`` when there is none. Stops at ``base_commit``: no earlier
    turn can reach further back."""
    out = _git_text(cwd, ["log", "--first-parent", "--format=%H:%ct", f"{base_commit}..{tip_commit}"])
    commits: list[tuple[str, int]] = []
    for line in (out or "").splitlines():
        sha, _sep, stamp = line.partition(":")
        if HEX_OID.fullmatch(sha) and stamp.isdigit():
            commits.append((sha, int(stamp)))
    found: list[str] = []
    for started_at in reversed(turns.starts):
        before = base_commit if started_at is None else next(
            (sha for sha, stamp in commits if stamp < started_at), base_commit)
        if before not in found:
            found.append(before)
        if before == base_commit:
            break
    return found


def _read_patch_file(path: str) -> bytes | None:
    try:
        with open(path, "rb") as handle:
            return handle.read()
    except OSError:
        return None


def record_turn_diff(run_dir: str, meta: dict | None = None) -> bool:
    """Persist the change the panel shows when a turn settles, so merging and
    removing the worktree does not erase it."""
    resolved = _read_meta(run_dir) if meta is None else meta
    probe = _probe_live_checkout(resolved)
    if probe is None:
        return False
    snap = _read_diff_resolved(run_dir, resolved, scope="turn", live_probe=probe)
    return _atomic_write_bytes(os.path.join(run_dir, STATE_DIR, LAST_PATCH_FILE), snap.patch)


def _saved_change(run_dir: str, *names: str) -> DiffSnapshot | None:
    """The first non-empty saved patch among ``names``."""
    for name in names:
        patch = _read_patch_file(os.path.join(run_dir, STATE_DIR, name))
        if patch and patch.strip():
            return _snapshot(patch)
    return None


def _live_last_change(run_dir: str, meta: dict, probe: _LiveProbe, head: str, tree: str,
                      base: tuple[str, str]) -> DiffSnapshot:
    cwd, info = probe.cwd, probe.info
    base_commit, base_tree = base
    saved_base = _read_turn_base(run_dir)
    if (saved_base
            and os.path.realpath(saved_base["repoRoot"]) == cwd
            and (not saved_base.get("branch") or saved_base.get("branch") == probe.branch)
            and _tree_exists(cwd, info, saved_base["tree"])):
        edits = _edits_since(probe, meta, saved_base.get("head"), saved_base["tree"], tree)
        if edits.patch:
            return edits
        # Until previous.patch existed, last.patch held the turn before.
        has_previous = os.path.exists(os.path.join(run_dir, STATE_DIR, PREVIOUS_PATCH_FILE))
        kept = _saved_change(run_dir, PREVIOUS_PATCH_FILE if has_previous else LAST_PATCH_FILE)
        return kept or _diff_trees_snapshot(cwd, info, base_tree, tree)

    # When HEAD is still at buildBaseCommit, base_commit..HEAD has no commits to
    # split by turn timestamp, so skip parsing the run transcript on live polls.
    turns = _user_turns(run_dir, meta) if head != base_commit else None
    if turns and turns.count > 1:
        for prior in _commits_before_turns(cwd, base_commit, head, turns):
            resolved = _resolve_commit_tree(cwd, info, prior)
            edits = _edits_since(probe, meta, prior, resolved[1], tree) if resolved else None
            if edits and edits.patch:
                return edits
    return _diff_trees_snapshot(cwd, info, base_tree, tree)


def _settled_branch(run_dir: str, meta: dict, repo_tip: tuple[str, _RepoInfo, str] | None) -> DiffSnapshot:
    patch = _read_patch_file(os.path.join(run_dir, "diff.patch"))
    if patch is not None:
        return _snapshot(patch)
    if repo_tip is not None:
        repo, info, tip_commit = repo_tip
        tip = _resolve_commit_tree(repo, info, tip_commit)
        base = _branch_base(repo, meta, tip_commit, info=info) if tip else None
        if tip and base:
            return _diff_trees_snapshot(repo, info, base[1], tip[1])
    return _snapshot(b"", EMPTY_SHA1)


def _settled_turn_change(run_dir: str, meta: dict, repo_tip: tuple[str, _RepoInfo, str],
                         branch: DiffSnapshot) -> DiffSnapshot | None:
    """The last change the transcript and commit times show, for a run whose
    turns saved no patch."""
    repo, info, tip_commit = repo_tip
    turns = _user_turns(run_dir, meta)
    tip = _resolve_commit_tree(repo, info, tip_commit)
    base = _branch_base(repo, meta, tip_commit, info=info) if tip else None
    if turns.count <= 1 or not tip or not base:
        return None
    priors = _commits_before_turns(repo, base[0], tip_commit, turns)
    if turns.last_edited and priors and priors[0] == tip_commit:
        # Squash-merged or pre-dated single commit where the transcript proves
        # the final turn edited files.
        return branch
    for prior in priors:
        resolved = _resolve_commit_tree(repo, info, prior)
        change = _diff_trees_snapshot(repo, info, resolved[1], tip[1]) if resolved else None
        if change and change.patch:
            return change
    return None


def _settled_last_change(run_dir: str, meta: dict) -> DiffSnapshot:
    kept = _saved_change(run_dir, LAST_PATCH_FILE)
    if kept:
        return kept
    repo_tip = _repo_branch_tip(meta)
    branch = _settled_branch(run_dir, meta, repo_tip)
    # A patch saved empty means the latest turns edited nothing; one never
    # saved leaves previous.patch a turn behind what they did.
    found = None
    if repo_tip is not None and not os.path.exists(os.path.join(run_dir, STATE_DIR, LAST_PATCH_FILE)):
        found = _settled_turn_change(run_dir, meta, repo_tip, branch)
    return found or _saved_change(run_dir, PREVIOUS_PATCH_FILE) or branch


def _read_diff_resolved(run_dir: str, resolved: dict, *, scope: str,
                        live_probe: _LiveProbe | None = None) -> DiffSnapshot:
    probe = live_probe if live_probe is not None else _probe_live_checkout(resolved)
    if probe is not None:
        working = _working_tree_from_probe(probe)
        base = _branch_base(probe.cwd, resolved, working[0], info=probe.info) if working else None
        if working and base:
            head, tree = working
            if scope == "branch":
                return _diff_trees_snapshot(probe.cwd, probe.info, base[1], tree)
            return _live_last_change(run_dir, resolved, probe, head, tree, base)
    if scope == "branch":
        return _settled_branch(run_dir, resolved, _repo_branch_tip(resolved))
    return _settled_last_change(run_dir, resolved)


# What the side panel reads of a patch: DIFF_PREVIEW_BYTES in
# ui/js/text-preview.js. A patch over it is cut there, mid-file.
PANEL_BYTES = 8 * 1024 * 1024
PANEL_OMITTED = b"Orc-Omitted: "


def _panel_sections(patch: bytes) -> list[bytes]:
    """``patch`` split before each ``diff --git`` line, with any text ahead
    of the first file as the first piece. Only a header starts a line that
    way: every hunk line starts with a space, ``+``, ``-`` or a backslash."""
    if patch.startswith(b"diff --git "):
        start = 0
    else:
        found = patch.find(b"\ndiff --git ")
        start = len(patch) if found == -1 else found + 1
    sections = [patch[:start]]
    while start < len(patch):
        found = patch.find(b"\ndiff --git ", start)
        end = len(patch) if found == -1 else found + 1
        sections.append(patch[start:end])
        start = end
    return sections


def _without_binary(section: bytes) -> bytes:
    binary = section.find(b"\nGIT binary patch\n")
    hunk = section.find(b"\n@@ ")
    if binary == -1 or (hunk != -1 and hunk < binary):
        return section
    return section[:binary + 1] + b"Binary files differ\n"


def _without_hunks(section: bytes) -> bytes | None:
    hunk = section.find(b"\n@@ ")
    if hunk == -1:
        return None
    body = section[hunk:]
    return section[:hunk + 1] + PANEL_OMITTED + b"bytes=%d additions=%d deletions=%d\n" % (
        len(body) - 1, body.count(b"\n+"), body.count(b"\n-"))


def panel_etag(snapshot: DiffSnapshot) -> str:
    return snapshot.etag[:-1] + ':panel"'


def panel_patch(snapshot: DiffSnapshot) -> DiffSnapshot:
    """``snapshot`` as the side panel draws it: every changed file listed
    inside the bytes the panel reads. A binary file keeps its header and one
    ``Binary files differ`` line in place of its encoded content. If the patch
    is still over ``PANEL_BYTES``, the files with the most changed text give
    up their hunks, largest first, until it fits: each keeps its header and an
    ``Orc-Omitted:`` line carrying the size and line counts left out. The
    download keeps the whole patch."""
    sections = [_without_binary(section) for section in _panel_sections(snapshot.patch)]
    total = sum(map(len, sections))
    for index in sorted(range(1, len(sections)), key=lambda at: len(sections[at]), reverse=True):
        if total <= PANEL_BYTES:
            break
        omitted = _without_hunks(sections[index])
        if omitted is not None:
            total -= len(sections[index]) - len(omitted)
            sections[index] = omitted
    return DiffSnapshot(patch=b"".join(sections), etag=panel_etag(snapshot))


def read_diff(run_dir: str, meta: dict | None = None, *, scope: str = "turn") -> DiffSnapshot:
    """Resolve ``scope`` (``"turn"`` or ``"branch"``) for ``run_dir`` without
    mutating ``run_dir``."""
    resolved = _read_meta(run_dir) if meta is None else meta
    return _read_diff_resolved(run_dir, resolved, scope=scope)


def branch_has_changes(run_dir: str, meta: dict | None = None) -> bool | None:
    """Whether the run's whole branch differs from where it started, counting
    staged, unstaged and untracked files in a live checkout. ``False`` also
    covers a run that never got a branch or worktree. ``None`` means Orc cannot
    tell: git failed, the run spans other repositories, or a checkout is gone
    with no saved ``diff.patch`` and no commits on its branch."""
    resolved = meta if meta is not None else _read_meta(run_dir)
    if not isinstance(resolved, dict) or not resolved:
        return None
    repos = resolved.get("repositories")
    if isinstance(repos, list) and any(isinstance(entry, dict) and not entry.get("primary") for entry in repos):
        return None
    wt = resolved.get("worktree") if isinstance(resolved.get("worktree"), dict) else {}
    wt_path = wt.get("path") if wt.get("enabled") and isinstance(wt.get("path"), str) and wt.get("path") else None
    branch = resolved.get("branch") if isinstance(resolved.get("branch"), str) and resolved.get("branch") else None
    if not branch and not wt_path:
        return False

    probe = _probe_live_checkout(resolved)
    if probe is not None:
        working = _working_tree_from_probe(probe)
        base = _branch_base(probe.cwd, resolved, working[0], info=probe.info) if working else None
        return base[1] != working[1] if working and base else None
    # A checkout that is still there but could not be read may hold edits.
    if wt_path and os.path.isdir(os.path.expanduser(wt_path)):
        return None

    saved = _read_patch_file(os.path.join(run_dir, "diff.patch"))
    if saved is not None:
        return bool(saved.strip())
    # Without the checkout, a branch matching its base cannot rule out edits
    # that never made it into a commit, so only changes count.
    repo_tip = _repo_branch_tip(resolved) if branch else None
    if repo_tip is not None:
        repo, info, tip_commit = repo_tip
        tip = _resolve_commit_tree(repo, info, tip_commit)
        base = _branch_base(repo, resolved, tip_commit, info=info) if tip else None
        if tip and base and base[1] != tip[1]:
            return True
    return None
