"""Project registration, canonical git root resolution, and grandfathering."""

from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
import subprocess
import tempfile
from typing import Any, Callable

import config_guard
import project_settings

SETUP_VERSION = 1


def git_env() -> dict[str, str]:
    env = dict(os.environ)
    for name in (
        "GIT_DIR",
        "GIT_COMMON_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ):
        env.pop(name, None)
    return env


def canonical_repo(raw: str | os.PathLike[str], *, expanduser: Callable[[str], str] = os.path.expanduser) -> Path:
    candidate = Path(expanduser(os.fspath(raw))).resolve()
    try:
        common = subprocess.check_output(
            ["git", "-C", str(candidate), "rev-parse", "--git-common-dir"],
            stderr=subprocess.DEVNULL,
            text=True,
            env=git_env(),
        ).strip()
        common_path = Path(common)
        common_path = (candidate / common_path).resolve() if not common_path.is_absolute() else common_path.resolve()
        if common_path.name == ".git":
            return common_path.parent
        top = subprocess.check_output(
            ["git", "-C", str(candidate), "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL,
            text=True,
            env=git_env(),
        ).strip()
        if top:
            return Path(top).resolve()
    except (OSError, subprocess.SubprocessError):
        pass
    return candidate


def portable_key(repo: Path, home: Path) -> str:
    resolved = repo.resolve()
    home_resolved = home.resolve()
    if resolved == home_resolved:
        return "~"
    prefix = str(home_resolved) + os.sep
    raw = str(resolved)
    return "~/" + raw[len(prefix):] if raw.startswith(prefix) else raw


def matches_repo(key: str, target: Path, home: Path) -> bool:
    if not isinstance(key, str) or not key.strip():
        return False
    expanded = (
        str(home) + key[1:]
        if key == "~" or key.startswith("~/")
        else os.path.expanduser(key)
    )
    try:
        return Path(expanded).resolve() == target.resolve()
    except OSError:
        return False


def has_prior_non_cancelled_run(
    runs_dir: Path | str | None,
    target: Path,
    current_run_id: str | None,
    home: Path,
) -> bool:
    if not runs_dir:
        return False
    root = Path(runs_dir)
    if not root.is_dir():
        return False
    for meta_path in root.glob("*/meta.json"):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        if not isinstance(meta, dict):
            continue
        run_id = meta.get("runId") or meta_path.parent.name
        if current_run_id and run_id == current_run_id:
            continue
        if meta.get("status") == "cancelled":
            continue
        candidates: list[str] = []
        if isinstance(meta.get("mainRepoPath"), str):
            candidates.append(meta["mainRepoPath"])
        repositories = meta.get("repositories")
        if isinstance(repositories, list):
            for item in repositories:
                if isinstance(item, dict) and isinstance(item.get("mainRepoPath"), str):
                    candidates.append(item["mainRepoPath"])
        if any(matches_repo(raw_repo, target, home) for raw_repo in candidates):
            return True
    return False


def legacy_worktree_setting(config: dict[str, Any], repo: Path, home: Path, preferred_key: str) -> bool | None:
    wt = config.get("worktree")
    legacy_repos = wt.get("repos") if isinstance(wt, dict) and isinstance(wt.get("repos"), dict) else {}
    found: bool | None = None
    for legacy_key, legacy_val in legacy_repos.items():
        if isinstance(legacy_val, bool) and matches_repo(legacy_key, repo, home):
            found = legacy_val
            if legacy_key == preferred_key:
                break
    return found


def initial_repo_entry(
    config: dict[str, Any],
    runs_dir: Path | str | None,
    repo: Path,
    *,
    home: Path,
    current_run_id: str | None = None,
) -> tuple[dict[str, Any], str]:
    """Build (entry, action) for a newly registered or grandfathered repo.

    A detected dev server is never saved here: the project's settings offer it
    and the user turns it on."""
    key = portable_key(repo, home)
    legacy_wt = legacy_worktree_setting(config, repo, home, key)
    if legacy_wt is not None or has_prior_non_cancelled_run(runs_dir, repo, current_run_id, home):
        entry: dict[str, Any] = {"setupVersion": SETUP_VERSION}
        if legacy_wt is not None:
            entry["worktree"] = legacy_wt
        return entry, "grandfathered"
    return {
        "setupVersion": SETUP_VERSION,
        "worktree": True,
        "a11y": False,
    }, "registered"


def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    refusal = config_guard.test_refusal(path)
    if refusal:
        raise ValueError(refusal)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_raw = tempfile.mkstemp(prefix=".config.", suffix=".tmp", dir=path.parent)
    tmp = Path(tmp_raw)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def ensure_projects(
    raw_targets: list[str | os.PathLike[str]],
    *,
    config_path: Path | None = None,
    runs_dir: Path | None = None,
    current_run_id: str | None = None,
    home: Path | None = None,
) -> list[dict[str, Any]]:
    """Idempotently register or grandfather target repositories in config.json."""
    resolved_home = (home or Path(os.path.expanduser("~"))).resolve()
    cfg_path = (
        config_path.expanduser().resolve()
        if config_path is not None
        else Path(os.environ.get("ORC_CONFIG_PATH") or (resolved_home / ".orc" / "config.json")).expanduser().resolve()
    )
    resolved_runs = (
        runs_dir.expanduser().resolve()
        if runs_dir is not None
        else Path(os.environ.get("ORC_RUNS_DIR") or (cfg_path.parent / "runs")).expanduser().resolve()
    )
    targets: list[Path] = []
    seen: set[Path] = set()
    for raw in raw_targets:
        repo = canonical_repo(raw)
        if repo not in seen:
            seen.add(repo)
            targets.append(repo)
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = cfg_path.parent / ".config.lock"
    with open(lock_path, "a+", encoding="utf-8") as lock_handle:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
        try:
            if cfg_path.exists():
                loaded = json.loads(cfg_path.read_text(encoding="utf-8"))
                if not isinstance(loaded, dict):
                    raise ValueError(f"{cfg_path} must contain a JSON object")
                config: dict[str, Any] = loaded
            else:
                config = {}
            raw_repos = config.get("repos")
            if raw_repos is None:
                repos: dict[str, Any] = {}
            elif isinstance(raw_repos, dict):
                repos = dict(raw_repos)
            else:
                raise ValueError("config.json repos field must be an object")

            dirty = False
            summaries: list[dict[str, Any]] = []
            for repo in targets:
                key = portable_key(repo, resolved_home)
                matching_keys = [
                    existing_key
                    for existing_key in list(repos.keys())
                    if isinstance(repos.get(existing_key), dict)
                    and matches_repo(existing_key, repo, resolved_home)
                ]
                merged: dict[str, Any] = {}
                for existing_key in matching_keys:
                    if existing_key != key:
                        merged.update(repos[existing_key])
                if key in matching_keys:
                    merged.update(repos[key])

                version = merged.get("setupVersion")
                if isinstance(version, int) and not isinstance(version, bool) and version >= SETUP_VERSION:
                    for existing_key in matching_keys:
                        if existing_key != key:
                            repos.pop(existing_key, None)
                            dirty = True
                    if repos.get(key) != merged:
                        repos[key] = merged
                        dirty = True
                    summaries.append({"key": key, "mainRepoPath": str(repo), "action": "configured", "entry": merged})
                    continue

                if matching_keys:
                    legacy_wt = legacy_worktree_setting(config, repo, resolved_home, key)
                    for existing_key in matching_keys:
                        if existing_key != key:
                            repos.pop(existing_key, None)
                    if legacy_wt is not None and "worktree" not in merged:
                        merged["worktree"] = legacy_wt
                    merged["setupVersion"] = SETUP_VERSION
                    repos[key] = merged
                    dirty = True
                    summaries.append({"key": key, "mainRepoPath": str(repo), "action": "grandfathered", "entry": merged})
                    continue

                entry, action = initial_repo_entry(
                    config,
                    resolved_runs,
                    repo,
                    home=resolved_home,
                    current_run_id=current_run_id,
                )
                repos[key] = entry
                dirty = True
                summaries.append({"key": key, "mainRepoPath": str(repo), "action": action, "entry": entry})

            if dirty:
                project_settings.pin_default_ship_action(config)
                config["repos"] = repos
                _atomic_write_json(cfg_path, config)
        finally:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
    return summaries
