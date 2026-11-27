"""Whether a run's open PR shows its pr-body.md and screenshots as they are now.

The PR's body on GitHub never matches pr-body.md byte for byte: attaching a
screenshot rewrites its path to an asset URL. So Orc keeps the digest of what
it last put on the PR, in the run's ``.pr-body-published.json``, and compares
the run's files with that. The digest covers the body text and the bytes of
every local screenshot it references, so retaking a screenshot under the same
name counts as a change.

The baseline is written when Orc opens the PR or updates its body, and the
first time Orc sees an open PR with none, so a PR opened before this existed
counts as up to date until its body changes again.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

import stat_cache
from keychain_secrets import _locked, _write_json
from linked_pr import cli_delivery_supported, linked_pr_url
from pr_body_images import local_paths

BODY_FILE = "pr-body.md"
# Dot-files stay out of the run's file list and its last-activity time.
PUBLISHED_FILE = ".pr-body-published.json"
LOCK_FILE = ".pr-body-published.lock"
# A screenshot's bytes hash once per (size, mtime), not on every run-list scan.
_FILE_DIGESTS: dict[tuple[str, int, int], str] = {}
_DIGEST_CACHE: dict[str, tuple[tuple, list[tuple[Path, tuple[int, int] | None]], str]] = {}
_PUBLISHED_CACHE: dict[str, tuple[str, str | None]] = {}
_CACHE_LOCK = threading.Lock()


def _image_stamp(path: Path) -> tuple[int, int] | None:
    try:
        st = path.stat()
    except OSError:
        return None
    return (st.st_size, st.st_mtime_ns)


def _file_digest(path: Path) -> str:
    try:
        stat = path.stat()
    except OSError:
        return "missing"
    key = (str(path), stat.st_size, stat.st_mtime_ns)
    with _CACHE_LOCK:
        cached = _FILE_DIGESTS.get(key)
    if cached is None:
        hasher = hashlib.sha256()
        try:
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1 << 20), b""):
                    hasher.update(chunk)
        except OSError:
            return "missing"
        cached = hasher.hexdigest()
        with _CACHE_LOCK:
            _FILE_DIGESTS[key] = cached
    return cached


def digest(run_dir) -> str | None:
    """The digest of pr-body.md and the screenshots it shows, or None."""
    folder = str(run_dir)
    body = Path(folder) / BODY_FILE
    try:
        if body.is_symlink():
            return None
        body_key = stat_cache.file_key(body)
        if not body.is_file():
            return None
    except OSError:
        return None
    with _CACHE_LOCK:
        cached = _DIGEST_CACHE.get(folder)
    if cached is not None and cached[0] == body_key:
        if all(_image_stamp(image) == stamp for image, stamp in cached[1]):
            return cached[2]
    try:
        raw = body.read_bytes()
    except OSError:
        return None
    hasher = hashlib.sha256(b"pr-body.md\0" + raw)
    # Name each screenshot from the run's folder, so the digest is the same
    # however the runs folder is spelled (a symlink, or orc-pr's resolved path).
    root = Path(folder).resolve()
    image_stamps = []
    for image in sorted(local_paths(raw.decode("utf-8", "replace"), body), key=str):
        resolved = image.resolve()
        name = resolved.relative_to(root) if resolved.is_relative_to(root) else resolved
        image_stamps.append((image, _image_stamp(image)))
        hasher.update(b"\0%s\0%s" % (str(name).encode(), _file_digest(image).encode()))
    hex_digest = hasher.hexdigest()
    with _CACHE_LOCK:
        if len(_DIGEST_CACHE) >= 4096:
            _DIGEST_CACHE.clear()
        _DIGEST_CACHE[folder] = (body_key, image_stamps, hex_digest)
    return hex_digest


def published(run_dir) -> str | None:
    folder = str(run_dir)
    try:
        text = stat_cache.RUN_FILES.read(os.path.join(folder, PUBLISHED_FILE))
    except OSError:
        return None
    with _CACHE_LOCK:
        cached = _PUBLISHED_CACHE.get(folder)
    if cached is not None and cached[0] is text:
        return cached[1]
    try:
        data = json.loads(text)
        value = data.get("digest") if isinstance(data, dict) else None
    except ValueError:
        value = None
    result = value if isinstance(value, str) else None
    with _CACHE_LOCK:
        if len(_PUBLISHED_CACHE) >= 4096:
            _PUBLISHED_CACHE.clear()
        _PUBLISHED_CACHE[folder] = (text, result)
    return result


def record(run_dir, value: str, *, only_if_missing: bool = False) -> bool:
    """Save `value` as what the PR shows. Returns whether it was written.

    The first-look baseline (`only_if_missing`) is Orc's own bookkeeping, so
    the run's folder keeps its modified time and the run keeps its place in
    the sidebar."""
    folder = str(run_dir)
    kept = os.stat(folder) if only_if_missing else None
    try:
        with _locked(folder, LOCK_FILE):
            if only_if_missing and published(run_dir) is not None:
                return False
            _write_json(os.path.join(folder, PUBLISHED_FILE),
                        {"digest": value,
                         "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
            return True
    finally:
        if kept is not None:
            os.utime(folder, ns=(kept.st_atime_ns, kept.st_mtime_ns))


def offers_update(meta) -> bool:
    """A finished single-repository run with one open PR Orc can update."""
    return (meta.get("status") == "complete" and meta.get("prState") != "closed"
            and not meta.get("remote") and cli_delivery_supported(meta)
            and bool(linked_pr_url(meta)))


def state(run_dir, meta):
    """{"pending": True, "digest": ...} when the PR lacks the run's current
    body or screenshots, else None. Sets the baseline when there is none."""
    if not offers_update(meta):
        return None
    current = digest(run_dir)
    if current is None:
        return None
    saved = published(run_dir)
    if saved is None:
        try:
            record(run_dir, current, only_if_missing=True)
        except OSError:
            pass
        return None
    return {"pending": True, "digest": current} if saved != current else None


def attach(runs, runs_dir):
    """Mark each run row whose open PR lacks its current body as `prBody`."""
    for run in runs:
        meta = run.get("meta") or {}
        meta.pop("prBody", None)
        try:
            found = state(os.path.join(runs_dir, run["id"]), meta)
        except (OSError, ValueError, KeyError):
            found = None
        if found:
            meta["prBody"] = found
