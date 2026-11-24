"""Canonical store, cross-harness discovery, drift repair and upstream updates for Skills."""
from __future__ import annotations

import contextlib
import fcntl
import hashlib
import io
import ipaddress
import json
import os
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
import re
import secrets
import shlex
import shutil
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

_UI_DIR = Path(__file__).resolve().parents[2] / "ui"
if _UI_DIR.is_dir() and str(_UI_DIR) not in sys.path:
    sys.path.insert(0, str(_UI_DIR))

try:
    import agent_accounts
    import claude_accounts
    ACCOUNT_NAMES_FILE = agent_accounts.NAMES_FILE
    available_claude_accounts = claude_accounts.available
    default_account_label = agent_accounts.label
except ImportError:
    ACCOUNT_NAMES_FILE = "agent-account-names.json"
    _NUMBER_WORDS = {
        "two": 2, "three": 3, "four": 4, "five": 5,
        "six": 6, "seven": 7, "eight": 8, "nine": 9,
    }

    def available_claude_accounts(home=None):
        root = Path(home) if home else Path.home()
        try:
            extra = sorted(
                entry.name for entry in root.glob(".claude-*")
                if (entry / ".claude.json").is_file()
                and not (entry / ".orc-forgotten").exists()
                and not (entry / ".orc-removed").exists()
            )
        except OSError:
            extra = []
        return [".claude", *extra]

    def default_account_label(provider, account):
        if provider == "codex":
            return "Codex"
        if account == ".claude":
            return "Claude"
        suffix = account[len(".claude-"):]
        return f"Claude {_NUMBER_WORDS.get(suffix.lower(), suffix)}"

REMOVAL_TOKEN_RE = re.compile(r"\d{8}T\d{6}Z-[a-z0-9._-]+-removed-[0-9a-f]{8}")
SLUG_RE = re.compile(r"[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?\Z")
SHORTHAND_RE = re.compile(r"([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)(?:/([A-Za-z0-9_./-]+))?(?:@([A-Za-z0-9_.-]+))?\Z")
SCP_GIT_RE = re.compile(r"[\w.-]+@[\w.-]+:[\w./-]+\Z")

SKILL_MD_MAX_BYTES = 256 * 1024
SKILL_FILE_MAX_BYTES = 2 * 1024 * 1024
SKILL_TOTAL_MAX_BYTES = 8 * 1024 * 1024
SKILL_MAX_FILES = 200
GIT_TIMEOUT_SECONDS = 30
HTTP_TIMEOUT_SECONDS = 15

INTERVAL_SECONDS = {
    "6h": 6 * 3600,
    "daily": 24 * 3600,
    "weekly": 7 * 24 * 3600,
    "manual": None,
}

IGNORED_NAMES = frozenset({".DS_Store", "__pycache__", ".git", ".svn", ".hg"})


class SkillsError(ValueError):
    def __init__(self, message: str, status: int = 400, code: str = "invalid_request", **extra):
        super().__init__(message)
        self.status = status
        self.code = code
        self.extra = extra

    def payload(self) -> dict:
        return {"error": str(self), "code": self.code, **self.extra}


def invalid(message: str, **extra) -> SkillsError:
    return SkillsError(message, 400, "invalid_request", **extra)


def not_found(message: str) -> SkillsError:
    return SkillsError(message, 404, "not_found")


def conflict(message: str, **extra) -> SkillsError:
    return SkillsError(message, 409, "conflict", **extra)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(value: str | None) -> float | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9._-]+", "-", (value or "").strip().lower()).strip("._-")
    cleaned = re.sub(r"-{2,}", "-", cleaned)[:64].strip("._-")
    if not cleaned or not SLUG_RE.fullmatch(cleaned):
        raise invalid("Name the skill with letters or numbers.")
    return cleaned


def validate_slug(value: str) -> str:
    if not isinstance(value, str) or not SLUG_RE.fullmatch(value) or ".." in value:
        raise invalid("Invalid skill id.")
    return value


def safe_rel_path(value: str) -> PurePosixPath:
    if not isinstance(value, str) or not value.strip() or "\\" in value or "\x00" in value:
        raise invalid("Use a relative file path inside the skill.")
    rel = PurePosixPath(value.strip().strip("/"))
    if rel.is_absolute() or not rel.parts or any(part in ("", ".", "..") for part in rel.parts):
        raise invalid("File path cannot escape the skill folder.")
    if any(part in IGNORED_NAMES for part in rel.parts):
        raise invalid("Hidden VCS and cache files are not part of a skill.")
    return rel


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    match = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)", text or "", re.S)
    if not match:
        return {}, text or ""
    fields: dict[str, str] = {}
    body = (text or "")[match.end():]
    key = None
    block_mode = None
    block_lines: list[str] = []

    def flush():
        nonlocal key, block_mode, block_lines
        if key and block_mode:
            joiner = "\n" if block_mode.startswith("|") else " "
            fields[key] = joiner.join(block_lines).strip()
        key = None
        block_mode = None
        block_lines = []

    for line in match.group(1).splitlines():
        field = re.match(r"^([\w-]+):\s*(.*)$", line)
        if field and not line.startswith((" ", "\t")):
            flush()
            key, raw = field.groups()
            raw = raw.strip()
            if raw in (">", "|", ">-", "|-", ">+", "|+"):
                block_mode = raw
                fields[key] = ""
            else:
                fields[key] = raw.strip("\"'")
        elif key and (line.startswith((" ", "\t")) or (block_mode and not line.strip())):
            if block_mode:
                block_lines.append(line.strip() if not block_mode.startswith("|") else line.lstrip(" ")[:2000])
            else:
                fields[key] = (fields[key] + " " + line.strip()).strip()
    flush()
    return fields, body


def ensure_skill_markdown(text: str, fallback_slug: str, fallback_description: str = "") -> str:
    if len(text.encode("utf-8")) > SKILL_MD_MAX_BYTES:
        raise invalid("SKILL.md exceeds the 256 KB limit.")
    fields, body = parse_frontmatter(text)
    if fields.get("name") and fields.get("description") is not None:
        return text if text.endswith("\n") else text + "\n"
    heading_match = re.search(r"^#\s+(.+)$", body, re.M)
    name = fields.get("name") or fallback_slug
    description = fields.get("description") or fallback_description
    if not description:
        for line in body.splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and not stripped.startswith("```"):
                description = stripped[:240]
                break
    if not description:
        description = (heading_match.group(1).strip() if heading_match else f"Instructions for {name}.")
    escaped_desc = description.replace('"', '\\"')
    if not body.strip():
        title = name.replace("-", " ").title()
        body = f"# {title}\n\nDescribe when and how agents should apply this skill.\n"
    return f'---\nname: {name}\ndescription: "{escaped_desc}"\n---\n\n{body.lstrip()}'


def atomic_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def atomic_write_bytes(path: Path, payload: bytes, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def atomic_symlink(target: Path | str, link_path: Path) -> None:
    link_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = link_path.parent / f".orc-skill-link-{secrets.token_hex(6)}"
    try:
        os.symlink(str(target), str(tmp))
        os.replace(str(tmp), str(link_path))
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(str(tmp))
        raise


def iter_skill_files(root: Path) -> list[tuple[str, Path, os.stat_result]]:
    root = root.resolve()
    entries: list[tuple[str, Path, os.stat_result]] = []
    if not root.is_dir():
        return entries
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = sorted(
            name for name in dirnames
            if name not in IGNORED_NAMES and not name.startswith(".") and not (Path(dirpath) / name).is_symlink()
        )
        for filename in sorted(filenames):
            if filename in IGNORED_NAMES or filename == ".DS_Store":
                continue
            full = Path(dirpath) / filename
            try:
                st = full.lstat()
            except OSError:
                continue
            if not stat.S_ISREG(st.st_mode):
                continue
            rel = full.relative_to(root).as_posix()
            entries.append((rel, full, st))
    entries.sort(key=lambda item: item[0])
    return entries


def inspect_skill_dir(path: Path) -> dict | None:
    try:
        resolved = path.resolve()
    except OSError:
        return None
    skill_md = resolved / "SKILL.md"
    if not resolved.is_dir() or not skill_md.is_file() or skill_md.is_symlink():
        return None
    hasher = hashlib.sha256()
    total_bytes = 0
    latest_mtime = 0.0
    files = []
    for rel, full, st in iter_skill_files(resolved):
        try:
            data = full.read_bytes()
        except OSError:
            continue
        exec_bit = 1 if (st.st_mode & 0o111) else 0
        hasher.update(f"{rel}\0{exec_bit}\0".encode("utf-8"))
        hasher.update(data)
        hasher.update(b"\0")
        total_bytes += len(data)
        latest_mtime = max(latest_mtime, st.st_mtime)
        files.append({"path": rel, "size": len(data), "executable": bool(exec_bit), "mtime": st.st_mtime})
    try:
        raw_md = skill_md.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    fields, _body = parse_frontmatter(raw_md)
    return {
        "digest": hasher.hexdigest(),
        "totalBytes": total_bytes,
        "fileCount": len(files),
        "files": files,
        "mtime": latest_mtime,
        "name": (fields.get("name") or path.name).strip(),
        "description": (fields.get("description") or "").strip(),
        "argumentHint": (fields.get("argument-hint") or "").strip() or None,
        "userInvocable": fields.get("user-invocable", "true").lower() != "false",
    }


def copy_skill_tree(source: Path, dest: Path) -> None:
    source = source.resolve()
    if not (source / "SKILL.md").is_file():
        raise invalid("Skill folder is missing SKILL.md.")
    entries = iter_skill_files(source)
    if len(entries) > SKILL_MAX_FILES:
        raise invalid(f"Skill has too many files ({len(entries)} > {SKILL_MAX_FILES}).")
    total = 0
    dest.mkdir(parents=True, exist_ok=True)
    for rel, full, st in entries:
        if st.st_size > SKILL_FILE_MAX_BYTES:
            raise invalid(f"{rel} exceeds the 2 MB per-file limit.")
        total += st.st_size
        if total > SKILL_TOTAL_MAX_BYTES:
            raise invalid("Skill exceeds the 8 MB package size limit.")
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        data = full.read_bytes()
        target.write_bytes(data)
        target.chmod(0o755 if (st.st_mode & 0o111) else 0o644)


def detect_local_git(path: Path) -> dict:
    """Record git remote/commit when adopting a skill that already lives in a git checkout."""
    try:
        resolved = path.resolve()
    except OSError:
        return {}
    if not shutil.which("git"):
        return {}
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(GIT_TERMINAL_PROMPT="0", GIT_CONFIG_NOSYSTEM="1")
    try:
        top = subprocess.run(
            ["git", "-C", str(resolved), "rev-parse", "--show-toplevel"],
            env=env, capture_output=True, text=True, timeout=5, stdin=subprocess.DEVNULL,
        )
        if top.returncode != 0:
            return {}
        repo_root = Path(top.stdout.strip()).resolve()
        subdir = resolved.relative_to(repo_root).as_posix() if resolved != repo_root else ""
        head = subprocess.run(
            ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
            env=env, capture_output=True, text=True, timeout=5, stdin=subprocess.DEVNULL,
        )
        remote = subprocess.run(
            ["git", "-C", str(repo_root), "config", "--get", "remote.origin.url"],
            env=env, capture_output=True, text=True, timeout=5, stdin=subprocess.DEVNULL,
        )
        branch = subprocess.run(
            ["git", "-C", str(repo_root), "symbolic-ref", "--short", "HEAD"],
            env=env, capture_output=True, text=True, timeout=5, stdin=subprocess.DEVNULL,
        )
        out: dict = {"localPath": str(resolved)}
        if head.returncode == 0 and head.stdout.strip():
            out["installedCommit"] = head.stdout.strip()
        if remote.returncode == 0 and remote.stdout.strip():
            out["gitUrl"] = remote.stdout.strip()
            out["subdir"] = subdir
            out["ref"] = branch.stdout.strip() if branch.returncode == 0 and branch.stdout.strip() else "HEAD"
        return out
    except (OSError, ValueError, subprocess.SubprocessError):
        return {}


def parse_source_input(raw_input: str, home: Path | None = None) -> dict:
    """Parse pasted links, CLI install snippets, repo shorthands, git URLs or local paths."""
    if not isinstance(raw_input, str):
        raise invalid("Paste a skill link, repository shorthand, or local path.")
    cleaned = raw_input.strip().strip("`").strip()
    if not cleaned or "\n" in cleaned or "\r" in cleaned or "\x00" in cleaned:
        raise invalid("Paste a single skill link, repository, or local folder path.")

    skill_hint = None
    # Strip common CLI wrappers people copy from skill directories (`npx skills add ...`, `git clone ...`).
    if re.match(r"^(?:npx|pnpx|bunx|yarn\s+dlx)\s+(?:-y\s+)?skills(?:@[^\s]+)?\s+(?:add|install|i)\s+", cleaned):
        try:
            tokens = shlex.split(cleaned)
        except ValueError as exc:
            raise invalid(f"Could not parse pasted command: {exc}") from exc
        idx = next((i for i, tok in enumerate(tokens) if tok in ("add", "install", "i")), -1)
        rest = tokens[idx + 1:] if idx >= 0 else []
        source_tok = None
        i = 0
        while i < len(rest):
            tok = rest[i]
            if tok in ("-s", "--skill") and i + 1 < len(rest):
                skill_hint = rest[i + 1]
                i += 2
                continue
            if tok.startswith("--skill="):
                skill_hint = tok.split("=", 1)[1]
                i += 1
                continue
            if tok.startswith("-"):
                i += 1
                continue
            if source_tok is None:
                source_tok = tok
            i += 1
        if not source_tok:
            raise invalid("Could not find a repository or URL in that command.")
        cleaned = source_tok
    elif cleaned.startswith("git clone "):
        try:
            tokens = [tok for tok in shlex.split(cleaned)[2:] if not tok.startswith("-")]
        except ValueError as exc:
            raise invalid(f"Could not parse git clone command: {exc}") from exc
        if not tokens:
            raise invalid("Could not find a Git URL in that command.")
        cleaned = tokens[0]

    cleaned = cleaned.strip("\"'")
    if not cleaned or cleaned.startswith("-"):
        raise invalid("Invalid skill link or path.")

    home_dir = (home or Path.home()).resolve()
    if cleaned.startswith("~/") or cleaned.startswith("/"):
        expanded = (home_dir / cleaned[2:]) if cleaned.startswith("~/") else Path(cleaned)
        return {"kind": "local", "input": raw_input.strip(), "localPath": str(expanded), "skillHint": skill_hint}

    if SCP_GIT_RE.fullmatch(cleaned):
        return {
            "kind": "git",
            "input": raw_input.strip(),
            "gitUrl": cleaned,
            "ref": "HEAD",
            "subdir": "",
            "skillHint": skill_hint,
        }

    parsed = urllib.parse.urlsplit(cleaned)
    if parsed.scheme:
        if parsed.username or parsed.password:
            raise invalid("Credential-bearing URLs are not accepted; use your Git credential helper.")
        if parsed.scheme == "file":
            file_path = urllib.parse.unquote(parsed.path or "")
            if not file_path.startswith("/"):
                raise invalid("file:// URLs must use an absolute path.")
            return {
                "kind": "git",
                "input": raw_input.strip(),
                "gitUrl": f"file://{file_path}",
                "ref": "HEAD",
                "subdir": "",
                "skillHint": skill_hint,
            }
        if parsed.scheme not in ("https", "ssh"):
            raise invalid("Use an https:// link, SSH Git URL, owner/repo shorthand, or local path.")
        host = (parsed.hostname or "").lower()
        path_parts = [urllib.parse.unquote(part) for part in parsed.path.split("/") if part]

        if host in ("skills.sh", "www.skills.sh") and len(path_parts) >= 2:
            owner, repo = path_parts[0], path_parts[1]
            hint = path_parts[2] if len(path_parts) >= 3 else skill_hint
            return {
                "kind": "github",
                "input": raw_input.strip(),
                "gitUrl": f"https://github.com/{owner}/{repo}.git",
                "owner": owner,
                "repo": repo,
                "ref": "HEAD",
                "subdir": "",
                "skillHint": hint,
            }

        if host == "raw.githubusercontent.com" or (
            parsed.scheme == "https"
            and host not in ("github.com", "www.github.com")
            and parsed.path.lower().endswith(".md")
        ):
            clean_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
            return {
                "kind": "url",
                "input": raw_input.strip(),
                "rawUrl": clean_url,
                "skillHint": skill_hint,
            }

        if host in ("github.com", "www.github.com") and len(path_parts) >= 2:
            owner = path_parts[0]
            repo = path_parts[1].removesuffix(".git")
            git_url = f"https://github.com/{owner}/{repo}.git"
            if len(path_parts) == 2:
                return {
                    "kind": "github",
                    "input": raw_input.strip(),
                    "gitUrl": git_url,
                    "owner": owner,
                    "repo": repo,
                    "ref": "HEAD",
                    "subdir": "",
                    "skillHint": skill_hint,
                }
            if len(path_parts) >= 4 and path_parts[2] in ("tree", "blob"):
                mode = path_parts[2]
                tail = path_parts[3:]
                return {
                    "kind": "github",
                    "input": raw_input.strip(),
                    "gitUrl": git_url,
                    "owner": owner,
                    "repo": repo,
                    "ref": tail[0],
                    "subdir": "/".join(tail[1:]),
                    "refAndPath": tail,
                    "githubMode": mode,
                    "skillHint": skill_hint,
                }

        clean_git = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
        return {
            "kind": "git",
            "input": raw_input.strip(),
            "gitUrl": clean_git,
            "ref": "HEAD",
            "subdir": "",
            "skillHint": skill_hint,
        }

    shorthand = SHORTHAND_RE.fullmatch(cleaned)
    if shorthand:
        owner, repo, subpath, at_skill = shorthand.groups()
        repo = repo.removesuffix(".git")
        return {
            "kind": "github",
            "input": raw_input.strip(),
            "gitUrl": f"https://github.com/{owner}/{repo}.git",
            "owner": owner,
            "repo": repo,
            "ref": "HEAD",
            "subdir": (subpath or "").strip("/"),
            "skillHint": at_skill or skill_hint,
        }

    raise invalid("Paste a GitHub URL, raw SKILL.md URL, owner/repo shorthand, or local folder path.")


def _check_public_https(url: str) -> None:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise invalid("Direct markdown downloads must use https://.")
    host = parsed.hostname
    try:
        infos = socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise SkillsError(f"Could not resolve {host}: {exc}", 502, "network_error") from exc
    for info in infos:
        addr = ipaddress.ip_address(info[4][0])
        if addr.is_loopback or addr.is_private or addr.is_link_local or addr.is_multicast or addr.is_reserved:
            raise invalid("Direct URL downloads cannot target private or local network addresses.")


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_public_https(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def default_fetch_url(url: str) -> bytes:
    _check_public_https(url)
    req = urllib.request.Request(url, headers={"User-Agent": "orc-skills-manager/1.0"})
    opener = urllib.request.build_opener(_SafeRedirectHandler)
    try:
        with opener.open(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:
            if resp.url:
                _check_public_https(resp.url)
            body = resp.read(SKILL_MD_MAX_BYTES + 1)
    except SkillsError:
        raise
    except urllib.error.HTTPError as exc:
        raise SkillsError(f"Download answered HTTP {exc.code}.", 502, "upstream_error") from exc
    except (urllib.error.URLError, OSError) as exc:
        raise SkillsError(f"Could not download URL: {getattr(exc, 'reason', exc)}", 502, "network_error") from exc
    if len(body) > SKILL_MD_MAX_BYTES:
        raise invalid("Downloaded SKILL.md exceeds the 256 KB limit.")
    return body


class Store:
    def __init__(
        self,
        config_dir: Path,
        home: Path | None = None,
        *,
        read_config=None,
        fetch_url=None,
    ):
        self.config_dir = Path(config_dir).resolve()
        self.home = Path(home or Path.home()).resolve()
        self.root = self.config_dir / "skills-manager"
        self.store_dir = self.root / "store"
        self.trash_dir = self.root / ".trash"
        self.registry_path = self.root / "registry.json"
        self.lock_path = self.root / ".registry.lock"
        self._read_config = read_config
        self._fetch_url = fetch_url or default_fetch_url

    def _default_state(self, targets: list[dict] | None = None) -> dict:
        target_ids = [item["id"] for item in (targets if targets is not None else self.discover_targets())]
        return {
            "schemaVersion": 1,
            "revision": 0,
            "settings": {
                "defaultTargets": target_ids,
                "knownTargets": list(target_ids),
                "autoSyncNewAccounts": True,
                "updateCheckInterval": "daily",
                "lastUpdateCheckAt": None,
                "lastUpdateCheckError": None,
            },
            "skills": {},
        }

    def _read_state_unlocked(self) -> dict:
        targets = self.discover_targets()
        if not self.registry_path.exists():
            return self._default_state(targets)
        try:
            data = json.loads(self.registry_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise SkillsError(f"Skills registry is unreadable: {exc}", 503, "corrupt_registry") from exc
        if not isinstance(data, dict) or not isinstance(data.get("skills"), dict):
            raise SkillsError("Skills registry has an invalid format.", 503, "corrupt_registry")
        base = self._default_state(targets)
        settings = dict(base["settings"], **(data.get("settings") or {}))
        if settings.get("updateCheckInterval") not in INTERVAL_SECONDS:
            settings["updateCheckInterval"] = "daily"
        current_ids = [t["id"] for t in targets]
        known = list(dict.fromkeys(settings.get("knownTargets") or []))
        default_targets = [tid for tid in (settings.get("defaultTargets") or []) if isinstance(tid, str)]
        if not known and not default_targets:
            default_targets = list(current_ids)
            known = list(current_ids)
        elif settings.get("autoSyncNewAccounts", True):
            for tid in current_ids:
                if tid not in known:
                    known.append(tid)
                    if tid not in default_targets:
                        default_targets.append(tid)
        settings["knownTargets"] = known
        settings["defaultTargets"] = default_targets
        return {
            "schemaVersion": 1,
            "revision": int(data.get("revision") or 0),
            "settings": settings,
            "skills": data["skills"],
        }

    @contextlib.contextmanager
    def _lock(self, expected_revision: int | None = None):
        self.root.mkdir(parents=True, exist_ok=True)
        with self.lock_path.open("a+", encoding="utf-8") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            state = self._read_state_unlocked()
            if expected_revision is not None and state["revision"] != expected_revision:
                raise conflict("Skills changed in another tab or command; reload and try again.", revision=state["revision"])
            yield state

    def _save_state_unlocked(self, state: dict) -> dict:
        state["revision"] = int(state.get("revision") or 0) + 1
        atomic_write_json(self.registry_path, state)
        return state

    def _account_names(self) -> dict[str, str]:
        try:
            data = json.loads((self.config_dir / ACCOUNT_NAMES_FILE).read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, str) and v.strip()}
        except (OSError, ValueError):
            pass
        return {}

    def discover_targets(self) -> list[dict]:
        names = self._account_names()
        targets = [
            {
                "id": "carbon",
                "provider": "carbon",
                "label": "Carbon (Gemini)",
                "shortLabel": "Carbon",
                "skillsDir": str(self.home / ".gemini/config/skills"),
                "displayPath": "~/.gemini/config/skills",
                "present": (self.home / ".gemini").exists() or bool(shutil.which("agy")),
            },
            {
                "id": "codex",
                "provider": "codex",
                "label": names.get("codex:.codex") or "Codex",
                "shortLabel": names.get("codex:.codex") or "Codex",
                "skillsDir": str(self.home / ".codex/skills"),
                "displayPath": "~/.codex/skills",
                "present": (self.home / ".codex").exists() or bool(shutil.which("codex")),
            },
            {
                "id": "agents",
                "provider": "agents",
                "label": "Shared (.agents)",
                "shortLabel": ".agents",
                "skillsDir": str(self.home / ".agents/skills"),
                "displayPath": "~/.agents/skills",
                "present": (self.home / ".agents").exists(),
            },
        ]
        claude_folders = list(available_claude_accounts(self.home))
        # Only honor CLAUDE_CONFIG_DIR when running against the real home, never an isolated fixture.
        if self.home == Path.home().resolve():
            env_claude = os.environ.get("CLAUDE_CONFIG_DIR", "").strip()
            if env_claude:
                env_path = (self.home / env_claude[2:]) if env_claude.startswith("~/") else Path(env_claude)
                try:
                    if env_path.resolve().parent == self.home and env_path.name not in claude_folders:
                        claude_folders.append(env_path.name)
                except OSError:
                    pass
        for folder in claude_folders:
            key = f"claude:{folder}"
            default_label = default_account_label("claude", folder)
            custom = names.get(key)
            targets.append({
                "id": key,
                "provider": "claude",
                "account": folder,
                "label": custom or default_label,
                "shortLabel": custom or default_label,
                "defaultLabel": default_label,
                "skillsDir": str(self.home / folder / "skills"),
                "displayPath": f"~/{folder}/skills",
                "present": (self.home / folder).exists() or (folder == ".claude" and (self.home / ".claude.json").exists()),
            })
        deduped: list[dict] = []
        seen_dirs: set[str] = set()
        for item in targets:
            try:
                key_dir = str(Path(item["skillsDir"]).resolve())
            except OSError:
                key_dir = item["skillsDir"]
            if key_dir in seen_dirs:
                continue
            seen_dirs.add(key_dir)
            deduped.append(item)
        return deduped

    def _config_dict(self) -> dict:
        if self._read_config is not None:
            try:
                cfg, _broken = self._read_config()
                if isinstance(cfg, dict):
                    return cfg
            except Exception:
                pass
        try:
            cfg = json.loads((self.config_dir / "config.json").read_text(encoding="utf-8"))
            return cfg if isinstance(cfg, dict) else {}
        except (OSError, ValueError):
            return {}

    def discover_projects(self) -> list[dict]:
        repos = self._config_dict().get("repos")
        if not isinstance(repos, dict):
            return []
        seen: set[str] = set()
        projects: list[dict] = []
        for raw_key in sorted(repos):
            if not isinstance(raw_key, str) or not raw_key.strip():
                continue
            expanded = (self.home / raw_key[2:]) if raw_key.startswith("~/") else Path(raw_key).expanduser()
            try:
                resolved = expanded.resolve()
            except OSError:
                continue
            if str(resolved) in seen or not resolved.is_dir():
                continue
            seen.add(str(resolved))
            display = f"~/{resolved.relative_to(self.home).as_posix()}" if resolved.is_relative_to(self.home) else str(resolved)
            projects.append({
                "id": display,
                "name": resolved.name,
                "repoPath": str(resolved),
                "displayPath": display,
                "agentsSkillsDir": str(resolved / ".agents/skills"),
                "claudeSkillsDir": str(resolved / ".claude/skills"),
            })
        projects.sort(key=lambda item: item["name"].lower())
        return projects

    def _plugin_owned_links(self) -> dict[str, dict]:
        """Map symlink paths owned by Orc's application plugin registry to their plugin metadata."""
        app_state_path = self.config_dir / "app-plugins.json"
        try:
            data = json.loads(app_state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        if not isinstance(data, dict):
            return {}
        installed = data.get("installed") if isinstance(data.get("installed"), dict) else {}
        target_to_plugin: dict[str, dict] = {}
        for pid, rec in installed.items():
            if not isinstance(rec, dict):
                continue
            manifest = rec.get("manifest") if isinstance(rec.get("manifest"), dict) else {}
            pname = manifest.get("name") or pid
            for skill_rel in (manifest.get("contributes") or {}).get("skills") or []:
                skill_slug = PurePosixPath(skill_rel).name
                target_to_plugin[skill_slug] = {"id": pid, "name": pname}
        owned_map: dict[str, dict] = {}
        owned_links = data.get("ownedLinks")
        if isinstance(owned_links, dict):
            for link_str, dest_str in owned_links.items():
                slug = Path(link_str).name
                info = target_to_plugin.get(slug) or {"id": "app-plugin", "name": "Orc plugin"}
                owned_map[str(Path(link_str))] = {**info, "target": dest_str}
        return owned_map

    def _plugin_owner_for(self, link_path: Path, owned_links: dict[str, dict]) -> dict | None:
        direct = owned_links.get(str(link_path))
        if direct:
            return direct
        if link_path.is_symlink():
            try:
                raw_link = os.readlink(link_path)
                resolved_target = str((link_path.parent / raw_link).resolve())
            except OSError:
                resolved_target = ""
            if resolved_target and "/app-plugins/" in resolved_target.replace("\\", "/"):
                parts = PurePosixPath(resolved_target).parts
                idx = parts.index("app-plugins") if "app-plugins" in parts else -1
                pid = parts[idx + 1] if idx >= 0 and idx + 1 < len(parts) else "app-plugin"
                return {"id": pid, "name": pid.replace("-", " ").title(), "target": resolved_target}
        return None

    def _scan_skills_dir(self, skills_dir: Path, owned_links: dict[str, dict]) -> dict[str, dict]:
        found: dict[str, dict] = {}
        if not skills_dir.is_dir():
            return found
        try:
            children = sorted(skills_dir.iterdir(), key=lambda p: p.name)
        except OSError:
            return found
        for entry in children:
            name = entry.name
            if name.startswith(".") or not SLUG_RE.fullmatch(name):
                continue
            is_link = entry.is_symlink()
            link_target = None
            if is_link:
                try:
                    raw_link = os.readlink(entry)
                    link_target = str((entry.parent / raw_link).resolve())
                except OSError:
                    link_target = None
                if not entry.exists():
                    found[name] = {
                        "present": False,
                        "broken": True,
                        "isSymlink": True,
                        "linkTarget": link_target,
                        "path": str(entry),
                        "pluginOwner": self._plugin_owner_for(entry, owned_links),
                    }
                    continue
            if not entry.is_dir():
                continue
            inspected = inspect_skill_dir(entry)
            if inspected is None:
                # Ignore internal folders without SKILL.md (such as Claude's synced/ bucket cache).
                continue
            plugin_owner = self._plugin_owner_for(entry, owned_links)
            found[name] = {
                "present": True,
                "broken": False,
                "isSymlink": is_link,
                "linkTarget": link_target,
                "path": str(entry),
                "pluginOwner": plugin_owner,
                **inspected,
            }
        return found

    def _desired_targets_for(self, record: dict | None, default_targets: list[str], valid_ids: set[str]) -> list[str]:
        if record is not None and record.get("enabled") is False:
            return []
        if record is not None and record.get("scope") == "project":
            return []
        if record is not None and record.get("targetMode") == "custom":
            return [tid for tid in (record.get("targets") or []) if tid in valid_ids]
        excluded = set((record or {}).get("excludedTargets") or [])
        return [tid for tid in default_targets if tid in valid_ids and tid not in excluded]

    def snapshot(self) -> dict:
        state = self._read_state_unlocked()
        targets = self.discover_targets()
        projects = self.discover_projects()
        owned_links = self._plugin_owned_links()
        valid_target_ids = {t["id"] for t in targets}
        default_targets = [tid for tid in state["settings"]["defaultTargets"] if tid in valid_target_ids]

        target_scans: dict[str, dict[str, dict]] = {
            t["id"]: self._scan_skills_dir(Path(t["skillsDir"]), owned_links)
            for t in targets
        }
        project_scans: dict[str, dict[str, dict[str, dict]]] = {}
        for proj in projects:
            project_scans[proj["id"]] = {
                "agents": self._scan_skills_dir(Path(proj["agentsSkillsDir"]), owned_links),
                "claude": self._scan_skills_dir(Path(proj["claudeSkillsDir"]), owned_links),
            }

        store_scans: dict[str, dict] = {}
        if self.store_dir.is_dir():
            for child in sorted(self.store_dir.iterdir(), key=lambda p: p.name):
                if child.is_dir() and not child.name.startswith(".") and SLUG_RE.fullmatch(child.name):
                    inspected = inspect_skill_dir(child)
                    if inspected is not None:
                        store_scans[child.name] = {"path": str(child), **inspected}

        all_slugs: set[str] = set(state["skills"].keys()) | set(store_scans.keys())
        for scan in target_scans.values():
            all_slugs.update(scan.keys())
        for pscan in project_scans.values():
            all_slugs.update(pscan["agents"].keys())
            all_slugs.update(pscan["claude"].keys())

        target_health = {
            t["id"]: {"synced": 0, "missing": 0, "diverged": 0, "broken": 0, "totalPresent": 0}
            for t in targets
        }
        skills_out: list[dict] = []

        for slug in sorted(all_slugs):
            record = state["skills"].get(slug)
            store_info = store_scans.get(slug)
            canonical_path = (self.store_dir / slug).resolve() if store_info else None

            per_target_raw = {t["id"]: target_scans[t["id"]].get(slug) for t in targets}
            plugin_owners = [
                info["pluginOwner"]
                for info in per_target_raw.values()
                if info and info.get("pluginOwner")
            ]
            is_orc_plugin = bool(plugin_owners) and record is None and store_info is None

            present_copies = [info for info in per_target_raw.values() if info and info.get("present")]
            for pscan in project_scans.values():
                for sub in ("agents", "claude"):
                    if pscan[sub].get(slug) and pscan[sub][slug].get("present"):
                        present_copies.append(pscan[sub][slug])

            reference = store_info
            if reference is None and present_copies:
                reference = max(present_copies, key=lambda item: (item.get("mtime") or 0.0, item.get("totalBytes") or 0))
            if reference is None:
                reference = {
                    "digest": None,
                    "totalBytes": 0,
                    "fileCount": 0,
                    "files": [],
                    "mtime": 0.0,
                    "name": slug,
                    "description": "",
                    "argumentHint": None,
                    "userInvocable": True,
                }

            canonical_digest = reference["digest"]
            distinct_digests = {info["digest"] for info in present_copies if info.get("digest")}
            if store_info and store_info.get("digest"):
                distinct_digests.add(store_info["digest"])

            configured_projects = [
                pid for pid in ((record or {}).get("projects") or [])
                if any(p["id"] == pid for p in projects)
            ]
            discovered_projects: list[str] = []
            project_statuses: list[dict] = []
            for proj in projects:
                pid = proj["id"]
                a_info = project_scans[pid]["agents"].get(slug)
                c_info = project_scans[pid]["claude"].get(slug)
                wanted_in_proj = pid in configured_projects or bool(a_info or c_info)
                if not wanted_in_proj:
                    continue
                discovered_projects.append(pid)
                a_ok = bool(a_info and a_info.get("present") and (canonical_digest is None or a_info["digest"] == canonical_digest))
                c_ok = bool(c_info and c_info.get("present") and (canonical_digest is None or c_info["digest"] == canonical_digest))
                if a_ok and c_ok:
                    p_state = "synced"
                elif (a_info and a_info.get("broken")) or (c_info and c_info.get("broken")):
                    p_state = "broken"
                elif (a_info and a_info.get("present") and a_info["digest"] != canonical_digest) or (
                    c_info and c_info.get("present") and c_info["digest"] != canonical_digest
                ):
                    p_state = "diverged"
                else:
                    p_state = "missing"
                project_statuses.append({
                    "projectId": pid,
                    "name": proj["name"],
                    "displayPath": proj["displayPath"],
                    "configured": pid in configured_projects,
                    "state": p_state,
                    "agentsState": "synced" if a_ok else ("diverged" if a_info and a_info.get("present") else ("broken" if a_info and a_info.get("broken") else "missing")),
                    "claudeState": "synced" if c_ok else ("diverged" if c_info and c_info.get("present") else ("broken" if c_info and c_info.get("broken") else "missing")),
                })

            has_any_global_presence = bool(store_info or any(per_target_raw.values()) or (record and record.get("scope") != "project"))
            scope = (record or {}).get("scope") or ("global" if has_any_global_presence else "project")
            enabled = False if (record and record.get("enabled") is False) else True

            if is_orc_plugin:
                desired_ids = [t["id"] for t in targets if per_target_raw[t["id"]] is not None]
            elif scope == "project" and not (record and record.get("targets")):
                desired_ids = []
            else:
                desired_ids = self._desired_targets_for(record, default_targets, valid_target_ids)
            desired_set = set(desired_ids)

            instance_rows: list[dict] = []
            missing_count = 0
            diverged_count = 0
            broken_count = 0
            extra_count = 0
            synced_count = 0

            for t in targets:
                tid = t["id"]
                info = per_target_raw[tid]
                wanted = tid in desired_set
                if info and info.get("present"):
                    target_health[tid]["totalPresent"] += 1
                if info and info.get("broken"):
                    row_state = "broken"
                    broken_count += 1
                    if not is_orc_plugin:
                        target_health[tid]["broken"] += 1
                elif wanted:
                    if not info or not info.get("present"):
                        row_state = "missing"
                        missing_count += 1
                        if not is_orc_plugin:
                            target_health[tid]["missing"] += 1
                    elif canonical_digest and info["digest"] != canonical_digest:
                        row_state = "diverged"
                        diverged_count += 1
                        if not is_orc_plugin:
                            target_health[tid]["diverged"] += 1
                    else:
                        row_state = "synced"
                        synced_count += 1
                        if not is_orc_plugin:
                            target_health[tid]["synced"] += 1
                else:
                    if info and info.get("present"):
                        row_state = "extra" if enabled else "extra"
                        extra_count += 1
                    else:
                        row_state = "disabled" if not enabled else "excluded"

                points_to_store = bool(
                    canonical_path and info and info.get("isSymlink") and info.get("linkTarget") == str(canonical_path)
                )
                instance_rows.append({
                    "targetId": tid,
                    "label": t["label"],
                    "shortLabel": t["shortLabel"],
                    "provider": t["provider"],
                    "wanted": wanted,
                    "state": row_state,
                    "present": bool(info and info.get("present")),
                    "isSymlink": bool(info and info.get("isSymlink")),
                    "pointsToStore": points_to_store,
                    "linkTarget": info.get("linkTarget") if info else None,
                    "path": info.get("path") if info else str(Path(t["skillsDir"]) / slug),
                    "digest": info.get("digest") if info else None,
                    "totalBytes": info.get("totalBytes") if info else 0,
                    "fileCount": info.get("fileCount") if info else 0,
                    "mtime": info.get("mtime") if info else None,
                })

            proj_drift = any(p["state"] != "synced" for p in project_statuses)
            proj_diverged = any(p["state"] in ("diverged", "broken") for p in project_statuses)

            if is_orc_plugin:
                sync_status = "plugin"
            elif not enabled and extra_count == 0 and broken_count == 0:
                sync_status = "paused"
            elif broken_count > 0 or diverged_count > 0 or proj_diverged or (not store_info and len(distinct_digests) > 1):
                sync_status = "conflict"
            elif missing_count > 0 or extra_count > 0 or proj_drift:
                sync_status = "drifted"
            else:
                sync_status = "synced"

            source_meta = dict((record or {}).get("source") or {})
            if not source_meta:
                first_link = next((info.get("linkTarget") for info in present_copies if info.get("isSymlink") and info.get("linkTarget")), None)
                source_meta = {
                    "kind": "orc-plugin" if is_orc_plugin else "discovered",
                    "localPath": first_link,
                    "updateAvailable": False,
                }

            skills_out.append({
                "slug": slug,
                "name": reference["name"] or slug,
                "description": reference["description"],
                "argumentHint": reference["argumentHint"],
                "userInvocable": reference["userInvocable"],
                "invocation": f"/{slug}",
                "kind": "orc-plugin" if is_orc_plugin else "skill",
                "pluginOwner": plugin_owners[0] if plugin_owners else None,
                "managed": bool(record is not None or store_info is not None),
                "inStore": bool(store_info is not None),
                "enabled": enabled,
                "scope": scope,
                "targetMode": (record or {}).get("targetMode") or "global",
                "desiredTargets": desired_ids,
                "excludedTargets": list((record or {}).get("excludedTargets") or []),
                "syncStatus": sync_status,
                "syncedCount": synced_count,
                "desiredCount": len(desired_ids),
                "missingCount": missing_count,
                "divergedCount": diverged_count,
                "brokenCount": broken_count,
                "extraCount": extra_count,
                "distinctDigests": len(distinct_digests),
                "digest": canonical_digest,
                "totalBytes": reference["totalBytes"],
                "fileCount": reference["fileCount"],
                "mtime": reference["mtime"],
                "instances": instance_rows,
                "projects": project_statuses,
                "source": {
                    "kind": source_meta.get("kind") or "discovered",
                    "input": source_meta.get("input"),
                    "gitUrl": source_meta.get("gitUrl"),
                    "ref": source_meta.get("ref"),
                    "subdir": source_meta.get("subdir"),
                    "rawUrl": source_meta.get("rawUrl"),
                    "localPath": source_meta.get("localPath"),
                    "installedCommit": source_meta.get("installedCommit"),
                    "remoteCommit": source_meta.get("remoteCommit"),
                    "remoteSummary": source_meta.get("remoteSummary"),
                    "updateAvailable": bool(source_meta.get("updateAvailable")),
                    "locallyModified": bool(
                        record is not None
                        and store_info
                        and source_meta.get("installedDigest")
                        and (source_meta.get("gitUrl") or source_meta.get("rawUrl") or source_meta.get("localPath"))
                        and store_info["digest"] != source_meta.get("installedDigest")
                    ),
                    "canCheckUpdates": bool(
                        record is not None
                        and not source_meta.get("pinnedRef")
                        and (source_meta.get("gitUrl") or source_meta.get("rawUrl") or source_meta.get("localPath"))
                    ),
                    "lastCheckedAt": source_meta.get("lastCheckedAt"),
                    "lastUpdatedAt": source_meta.get("lastUpdatedAt"),
                    "checkError": source_meta.get("checkError"),
                },
                "updatedAt": (record or {}).get("updatedAt"),
            })

        priority = {"conflict": 0, "drifted": 1, "synced": 2, "paused": 3, "plugin": 4}
        skills_out.sort(key=lambda item: (
            1 if item["kind"] == "orc-plugin" else 0,
            0 if item["source"]["updateAvailable"] else 1,
            priority.get(item["syncStatus"], 5),
            item["name"].lower(),
        ))

        user_skills = [item for item in skills_out if item["kind"] != "orc-plugin"]
        summary = {
            "total": len(user_skills),
            "pluginSkills": len(skills_out) - len(user_skills),
            "synced": sum(1 for item in user_skills if item["syncStatus"] == "synced"),
            "drifted": sum(1 for item in user_skills if item["syncStatus"] == "drifted"),
            "conflicts": sum(1 for item in user_skills if item["syncStatus"] == "conflict"),
            "paused": sum(1 for item in user_skills if item["syncStatus"] == "paused"),
            "needsAttention": sum(1 for item in user_skills if item["syncStatus"] in ("drifted", "conflict")),
            "updatesAvailable": sum(1 for item in user_skills if item["source"]["updateAvailable"]),
        }

        enriched_targets = [
            {
                **t,
                "defaultEnabled": t["id"] in default_targets,
                "health": target_health[t["id"]],
            }
            for t in targets
        ]

        return {
            "revision": state["revision"],
            "settings": {
                **state["settings"],
                "defaultTargets": default_targets,
            },
            "targets": enriched_targets,
            "projects": projects,
            "summary": summary,
            "skills": skills_out,
            "storePath": str(self.store_dir),
            "trashPath": "~/.orc/skills-manager/.trash",
        }

    def detail(self, slug: str) -> dict:
        slug = validate_slug(slug)
        snap = self.snapshot()
        skill = next((item for item in snap["skills"] if item["slug"] == slug), None)
        if skill is None:
            raise not_found(f"There is no skill called {slug}.")

        variants = self._collect_variants(slug, skill)
        primary_dir = self._resolve_primary_dir(slug, skill)
        skill_md_text = ""
        files_meta: list[dict] = []
        if primary_dir and (primary_dir / "SKILL.md").is_file():
            skill_md_text = (primary_dir / "SKILL.md").read_text(encoding="utf-8", errors="replace")
            inspected = inspect_skill_dir(primary_dir)
            if inspected:
                files_meta = inspected["files"]

        return {
            "revision": snap["revision"],
            "skill": skill,
            "skillMd": skill_md_text,
            "files": files_meta,
            "variants": variants,
            "targets": snap["targets"],
            "projects": snap["projects"],
        }

    def _resolve_primary_dir(self, slug: str, skill: dict) -> Path | None:
        store_candidate = self.store_dir / slug
        if (store_candidate / "SKILL.md").is_file():
            return store_candidate.resolve()
        target_digest = skill.get("digest")
        fallback: Path | None = None
        for inst in skill.get("instances") or []:
            if inst.get("present") and inst.get("path"):
                candidate = Path(inst["path"])
                if (candidate / "SKILL.md").is_file():
                    resolved = candidate.resolve()
                    if target_digest and inst.get("digest") == target_digest:
                        return resolved
                    if fallback is None:
                        fallback = resolved
        for proj in self.discover_projects():
            for key in ("agentsSkillsDir", "claudeSkillsDir"):
                candidate = Path(proj[key]) / slug
                if (candidate / "SKILL.md").is_file():
                    resolved = candidate.resolve()
                    if target_digest:
                        insp = inspect_skill_dir(resolved)
                        if insp and insp["digest"] == target_digest:
                            return resolved
                    if fallback is None:
                        fallback = resolved
        return fallback

    def _collect_variants(self, slug: str, skill: dict) -> list[dict]:
        by_digest: dict[str, dict] = {}
        store_candidate = self.store_dir / slug
        if (store_candidate / "SKILL.md").is_file():
            insp = inspect_skill_dir(store_candidate)
            if insp:
                by_digest[insp["digest"]] = {
                    "digest": insp["digest"],
                    "holders": [{"id": "store", "label": "Orc canonical store"}],
                    "totalBytes": insp["totalBytes"],
                    "fileCount": insp["fileCount"],
                    "mtime": insp["mtime"],
                    "preview": (store_candidate / "SKILL.md").read_text(encoding="utf-8", errors="replace")[:4000],
                }
        for inst in skill.get("instances") or []:
            if not inst.get("present") or not inst.get("digest"):
                continue
            digest = inst["digest"]
            if digest not in by_digest:
                p = Path(inst["path"])
                preview = (p / "SKILL.md").read_text(encoding="utf-8", errors="replace")[:4000] if (p / "SKILL.md").is_file() else ""
                by_digest[digest] = {
                    "digest": digest,
                    "holders": [],
                    "totalBytes": inst["totalBytes"],
                    "fileCount": inst["fileCount"],
                    "mtime": inst["mtime"] or 0.0,
                    "preview": preview,
                }
            by_digest[digest]["holders"].append({"id": inst["targetId"], "label": inst["label"]})
        variants = list(by_digest.values())
        variants.sort(key=lambda item: (any(h["id"] == "store" for h in item["holders"]), item["mtime"]), reverse=True)
        return variants

    def read_file(self, slug: str, rel_path: str) -> dict:
        slug = validate_slug(slug)
        rel = safe_rel_path(rel_path)
        snap = self.snapshot()
        skill = next((item for item in snap["skills"] if item["slug"] == slug), None)
        if skill is None:
            raise not_found(f"There is no skill called {slug}.")
        primary = self._resolve_primary_dir(slug, skill)
        if primary is None:
            raise not_found("Skill files are unavailable on disk.")
        target = (primary / rel).resolve()
        if not target.is_relative_to(primary) or not target.is_file() or target.is_symlink():
            raise not_found(f"{rel.as_posix()} does not exist in {slug}.")
        raw = target.read_bytes()
        try:
            text = raw.decode("utf-8")
            binary = False
        except UnicodeDecodeError:
            text = ""
            binary = True
        return {
            "path": rel.as_posix(),
            "size": len(raw),
            "binary": binary,
            "text": text[:SKILL_MD_MAX_BYTES] if not binary else None,
        }

    def _backup_path(self, path: Path, slug: str, label: str) -> None:
        if not path.exists() and not path.is_symlink():
            return
        if path.is_symlink():
            return
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        safe_label = re.sub(r"[^a-zA-Z0-9._-]+", "-", label).strip("-") or "backup"
        dest = self.trash_dir / f"{stamp}-{slug}-{safe_label}-{secrets.token_hex(3)}"
        dest.parent.mkdir(parents=True, exist_ok=True)
        if path.is_dir():
            shutil.copytree(path, dest, symlinks=True)
        else:
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest / path.name)

    def _replace_with_store_link(self, link_path: Path, canonical: Path, slug: str, label: str, owned_links: dict[str, dict]) -> None:
        if self._plugin_owner_for(link_path, owned_links):
            raise conflict(f"{link_path} is owned by an Orc application plugin.")
        parent = link_path.parent
        parent.mkdir(parents=True, exist_ok=True)
        if link_path.is_symlink():
            try:
                if link_path.resolve() == canonical.resolve():
                    return
            except OSError:
                pass
            atomic_symlink(canonical, link_path)
            return
        if link_path.exists():
            self._backup_path(link_path, slug, label)
            if link_path.is_dir():
                shutil.rmtree(link_path)
            else:
                link_path.unlink()
        atomic_symlink(canonical, link_path)

    def _remove_managed_entry(self, link_path: Path, canonical: Path | None, slug: str, label: str, owned_links: dict[str, dict], *, remove_copies: bool = False) -> None:
        if self._plugin_owner_for(link_path, owned_links):
            return
        if link_path.is_symlink():
            if canonical is None or not link_path.exists():
                link_path.unlink(missing_ok=True)
                return
            try:
                if link_path.resolve() == canonical.resolve() or remove_copies:
                    link_path.unlink(missing_ok=True)
            except OSError:
                link_path.unlink(missing_ok=True)
            return
        if remove_copies and link_path.exists():
            self._backup_path(link_path, slug, label)
            if link_path.is_dir():
                shutil.rmtree(link_path)
            else:
                link_path.unlink()

    def _stage_into_store(self, slug: str, source_dir: Path, *, backup_existing: bool = True) -> dict:
        canonical = self.store_dir / slug
        self.store_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=f".stage-{slug}-", dir=self.store_dir) as tmp:
            staged = Path(tmp) / "skill"
            copy_skill_tree(source_dir, staged)
            skill_md = staged / "SKILL.md"
            normalized = ensure_skill_markdown(skill_md.read_text(encoding="utf-8", errors="replace"), slug)
            skill_md.write_text(normalized, encoding="utf-8")
            inspected = inspect_skill_dir(staged)
            if inspected is None:
                raise invalid("Staged skill failed SKILL.md validation.")
            if canonical.exists() or canonical.is_symlink():
                if backup_existing and canonical.is_dir() and not canonical.is_symlink():
                    old_insp = inspect_skill_dir(canonical)
                    if not old_insp or old_insp["digest"] != inspected["digest"]:
                        self._backup_path(canonical, slug, "store")
                if canonical.is_symlink() or canonical.is_file():
                    canonical.unlink()
                else:
                    shutil.rmtree(canonical)
            shutil.move(str(staged), str(canonical))
        return inspect_skill_dir(canonical)

    def _materialize_skill_links(self, slug: str, record: dict, state: dict, *, remove_unwanted_copies: bool = False) -> None:
        canonical = (self.store_dir / slug).resolve()
        if not (canonical / "SKILL.md").is_file():
            raise not_found(f"Canonical store copy for {slug} is missing.")
        targets = self.discover_targets()
        projects = {p["id"]: p for p in self.discover_projects()}
        owned_links = self._plugin_owned_links()
        valid_ids = {t["id"] for t in targets}
        default_targets = [tid for tid in state["settings"]["defaultTargets"] if tid in valid_ids]
        desired_set = set(self._desired_targets_for(record, default_targets, valid_ids))

        for t in targets:
            tid = t["id"]
            link_path = Path(t["skillsDir"]) / slug
            if tid in desired_set:
                self._replace_with_store_link(link_path, canonical, slug, tid, owned_links)
            else:
                self._remove_managed_entry(link_path, canonical, slug, tid, owned_links, remove_copies=remove_unwanted_copies)

        wanted_projects = set(record.get("projects") or []) if record.get("enabled", True) else set()
        for pid, proj in projects.items():
            for kind, key in (("agents", "agentsSkillsDir"), ("claude", "claudeSkillsDir")):
                link_path = Path(proj[key]) / slug
                if pid in wanted_projects:
                    self._replace_with_store_link(link_path, canonical, slug, f"proj-{proj['name']}-{kind}", owned_links)
                else:
                    self._remove_managed_entry(link_path, canonical, slug, f"proj-{proj['name']}-{kind}", owned_links, remove_copies=False)

    def _infer_unmanaged_scope(self, slug: str, targets: list[dict], projects: list[dict]) -> tuple[str, list[str]]:
        has_global = any(inspect_skill_dir(Path(t["skillsDir"]) / slug) is not None for t in targets)
        found_projects = [
            proj["id"]
            for proj in projects
            if inspect_skill_dir(Path(proj["agentsSkillsDir"]) / slug) is not None
            or inspect_skill_dir(Path(proj["claudeSkillsDir"]) / slug) is not None
        ]
        inferred_scope = "project" if (found_projects and not has_global) else "global"
        return inferred_scope, found_projects

    def sync_skill(
        self,
        slug: str,
        *,
        preferred_source: str | None = None,
        expected_revision: int | None = None,
    ) -> dict:
        slug = validate_slug(slug)
        with self._lock(expected_revision) as state:
            target_list = self.discover_targets()
            project_list = self.discover_projects()
            targets = {t["id"]: t for t in target_list}
            projects = {p["id"]: p for p in project_list}
            owned_links = self._plugin_owned_links()

            for t in targets.values():
                link = Path(t["skillsDir"]) / slug
                if self._plugin_owner_for(link, owned_links) and slug not in state["skills"]:
                    raise conflict(f"{slug} is managed by an Orc application plugin in Settings → Plugins.")

            inferred_scope, inferred_projects = self._infer_unmanaged_scope(slug, target_list, project_list)

            canonical = self.store_dir / slug
            chosen_dir: Path | None = None
            chosen_git: dict = {}

            if preferred_source == "store":
                if not (canonical / "SKILL.md").is_file():
                    raise invalid("Canonical store has no copy of this skill.")
                chosen_dir = canonical
            elif preferred_source and preferred_source in targets:
                candidate = Path(targets[preferred_source]["skillsDir"]) / slug
                if not (candidate / "SKILL.md").is_file():
                    raise invalid(f"{targets[preferred_source]['label']} has no valid copy of {slug}.")
                if candidate.is_symlink():
                    chosen_git = detect_local_git(candidate)
                chosen_dir = candidate
            elif (canonical / "SKILL.md").is_file():
                chosen_dir = canonical
            else:
                candidates: list[tuple[float, str, Path]] = []
                for tid, t in targets.items():
                    cpath = Path(t["skillsDir"]) / slug
                    insp = inspect_skill_dir(cpath)
                    if insp:
                        candidates.append((insp["mtime"], tid, cpath))
                for pid, proj in projects.items():
                    for key in ("agentsSkillsDir", "claudeSkillsDir"):
                        cpath = Path(proj[key]) / slug
                        insp = inspect_skill_dir(cpath)
                        if insp:
                            candidates.append((insp["mtime"], pid, cpath))
                if not candidates:
                    raise not_found(f"Could not find a valid SKILL.md for {slug} to sync.")
                digests = {inspect_skill_dir(item[2])["digest"] for item in candidates}
                if len(digests) > 1 and preferred_source != "newest":
                    raise conflict(
                        f"{slug} has diverged copies across instances. Pick which copy should win.",
                        needsResolution=True,
                        slug=slug,
                    )
                candidates.sort(key=lambda item: item[0], reverse=True)
                chosen_dir = candidates[0][2]
                chosen_git = detect_local_git(chosen_dir)

            replaced_store = chosen_dir.resolve() != canonical.resolve()
            if replaced_store:
                inspected = self._stage_into_store(slug, chosen_dir)
            else:
                inspected = inspect_skill_dir(canonical)

            now = utc_now()
            record = dict(state["skills"].get(slug) or {
                "slug": slug,
                "scope": inferred_scope,
                "projects": inferred_projects,
                "enabled": True,
                "targetMode": "global",
                "targets": [],
                "excludedTargets": [],
                "createdAt": now,
            })
            source_meta = dict(record.get("source") or {})
            if not source_meta:
                source_meta = {"kind": "git" if chosen_git.get("gitUrl") else "adopted", **chosen_git}
            if replaced_store or not source_meta.get("installedDigest"):
                source_meta["installedDigest"] = inspected["digest"]
            record["source"] = source_meta
            record["enabled"] = record.get("enabled", True)
            record["updatedAt"] = now
            state["skills"][slug] = record

            self._materialize_skill_links(slug, record, state, remove_unwanted_copies=True)
            self._save_state_unlocked(state)
        return self.snapshot()

    def sync_all(self, *, strategy: str = "safe", expected_revision: int | None = None) -> dict:
        if strategy not in ("safe", "newest"):
            raise invalid("Sync strategy must be 'safe' or 'newest'.")
        snap = self.snapshot()
        synced_slugs: list[str] = []
        skipped_conflicts: list[str] = []
        for item in snap["skills"]:
            if item["kind"] == "orc-plugin" or item["syncStatus"] in ("synced", "paused"):
                continue
            if item["syncStatus"] == "conflict" and strategy == "safe" and not item["inStore"]:
                skipped_conflicts.append(item["slug"])
                continue
            pref = "store" if item["inStore"] else ("newest" if strategy == "newest" else None)
            try:
                self.sync_skill(item["slug"], preferred_source=pref, expected_revision=expected_revision)
                expected_revision = None
                synced_slugs.append(item["slug"])
            except SkillsError as exc:
                if exc.code == "conflict":
                    skipped_conflicts.append(item["slug"])
                else:
                    raise
        result = self.snapshot()
        result["syncReport"] = {"synced": synced_slugs, "skippedConflicts": skipped_conflicts}
        return result

    def configure_skill(
        self,
        slug: str,
        *,
        enabled: bool | None = None,
        scope: str | None = None,
        target_mode: str | None = None,
        targets: list[str] | None = None,
        excluded_targets: list[str] | None = None,
        projects: list[str] | None = None,
        source_url: str | None = None,
        expected_revision: int | None = None,
    ) -> dict:
        slug = validate_slug(slug)
        if scope is not None and scope not in ("global", "project"):
            raise invalid("Scope must be 'global' or 'project'.")
        if target_mode is not None and target_mode not in ("global", "custom"):
            raise invalid("Target mode must be 'global' or 'custom'.")

        with self._lock(expected_revision) as state:
            target_list = self.discover_targets()
            project_list = self.discover_projects()
            valid_targets = {t["id"] for t in target_list}
            valid_projects = {p["id"] for p in project_list}
            inferred_scope, inferred_projects = self._infer_unmanaged_scope(slug, target_list, project_list)

            canonical = self.store_dir / slug
            if not (canonical / "SKILL.md").is_file():
                snap = self.snapshot()
                existing = next((s for s in snap["skills"] if s["slug"] == slug and s["kind"] != "orc-plugin"), None)
                if existing is None:
                    raise not_found(f"There is no manageable skill called {slug}.")
                primary = self._resolve_primary_dir(slug, existing)
                if primary is None:
                    raise invalid(f"Cannot configure {slug} without a valid SKILL.md.")
                insp = self._stage_into_store(slug, primary)
            else:
                insp = inspect_skill_dir(canonical)

            now = utc_now()
            record = dict(state["skills"].get(slug) or {
                "slug": slug,
                "scope": inferred_scope,
                "projects": inferred_projects,
                "enabled": True,
                "targetMode": "global",
                "targets": [],
                "excludedTargets": [],
                "source": {"kind": "adopted", "installedDigest": insp["digest"]},
                "createdAt": now,
            })

            if enabled is not None:
                if not isinstance(enabled, bool):
                    raise invalid("enabled must be true or false.")
                record["enabled"] = enabled
            if scope is not None:
                record["scope"] = scope
            if target_mode is not None:
                record["targetMode"] = target_mode
            if targets is not None:
                if not isinstance(targets, list) or any(not isinstance(t, str) or t not in valid_targets for t in targets):
                    raise invalid("Unknown target instance in targets.")
                record["targets"] = list(dict.fromkeys(targets))
            if excluded_targets is not None:
                if not isinstance(excluded_targets, list) or any(not isinstance(t, str) or t not in valid_targets for t in excluded_targets):
                    raise invalid("Unknown target instance in excludedTargets.")
                record["excludedTargets"] = list(dict.fromkeys(excluded_targets))
            if projects is not None:
                if not isinstance(projects, list) or any(not isinstance(p, str) or p not in valid_projects for p in projects):
                    raise invalid("Unknown Orc project in projects.")
                record["projects"] = list(dict.fromkeys(projects))
            if source_url is not None:
                clean_src = source_url.strip()
                if not clean_src:
                    record["source"] = {"kind": "created", "installedDigest": insp["digest"]}
                else:
                    parsed = parse_source_input(clean_src, self.home)
                    record["source"] = {
                        **parsed,
                        "installedDigest": insp["digest"],
                        "updateAvailable": False,
                        "checkError": None,
                    }

            record["updatedAt"] = now
            state["skills"][slug] = record
            self._materialize_skill_links(slug, record, state, remove_unwanted_copies=True)
            self._save_state_unlocked(state)
        return self.detail(slug)

    def save_skill_markdown(
        self,
        slug: str,
        text: str,
        *,
        base_digest: str | None = None,
        expected_revision: int | None = None,
    ) -> dict:
        slug = validate_slug(slug)
        if not isinstance(text, str) or not text.strip():
            raise invalid("SKILL.md cannot be empty.")
        normalized = ensure_skill_markdown(text, slug)

        with self._lock(expected_revision) as state:
            target_list = self.discover_targets()
            project_list = self.discover_projects()
            inferred_scope, inferred_projects = self._infer_unmanaged_scope(slug, target_list, project_list)
            canonical = self.store_dir / slug
            if not (canonical / "SKILL.md").is_file():
                snap = self.snapshot()
                existing = next((s for s in snap["skills"] if s["slug"] == slug and s["kind"] != "orc-plugin"), None)
                if existing is None:
                    raise not_found(f"There is no manageable skill called {slug}.")
                primary = self._resolve_primary_dir(slug, existing)
                if primary is None:
                    raise not_found(f"{slug} has no files on disk.")
                before_raw = inspect_skill_dir(primary)
                if base_digest and before_raw and before_raw["digest"] != base_digest:
                    raise conflict("This skill changed on disk while you were editing. Reload before saving.", currentDigest=before_raw["digest"])
                staged_before = self._stage_into_store(slug, primary)
            else:
                before = inspect_skill_dir(canonical)
                if base_digest and before and before["digest"] != base_digest:
                    raise conflict("This skill changed on disk while you were editing. Reload before saving.", currentDigest=before["digest"])
                staged_before = before

            self._backup_path(canonical, slug, "edit")
            atomic_write_bytes(canonical / "SKILL.md", normalized.encode("utf-8"), 0o644)
            after = inspect_skill_dir(canonical)

            now = utc_now()
            record = dict(state["skills"].get(slug) or {
                "slug": slug,
                "scope": inferred_scope,
                "projects": inferred_projects,
                "enabled": True,
                "targetMode": "global",
                "targets": [],
                "excludedTargets": [],
                "source": {"kind": "adopted"},
                "createdAt": now,
            })
            source_meta = dict(record.get("source") or {})
            has_upstream = bool(source_meta.get("gitUrl") or source_meta.get("rawUrl") or source_meta.get("localPath"))
            if not has_upstream:
                source_meta["installedDigest"] = after["digest"]
            elif not source_meta.get("installedDigest") and staged_before:
                source_meta["installedDigest"] = staged_before["digest"]
            record["source"] = source_meta
            record["updatedAt"] = now
            state["skills"][slug] = record
            self._materialize_skill_links(slug, record, state, remove_unwanted_copies=False)
            self._save_state_unlocked(state)
        return self.detail(slug)

    def create_skill(
        self,
        *,
        name: str,
        description: str = "",
        body: str = "",
        scope: str = "global",
        targets: list[str] | None = None,
        projects: list[str] | None = None,
        expected_revision: int | None = None,
    ) -> dict:
        if not isinstance(name, str) or not name.strip():
            raise invalid("Give the new skill a name.")
        slug = slugify(name)
        if scope not in ("global", "project"):
            raise invalid("Scope must be 'global' or 'project'.")
        desc = (description or "").strip() or f"Workflow instructions for {name.strip()}."
        content = body.strip() if isinstance(body, str) and body.strip() else f"# {name.strip()}\n\nAdd instructions for when and how to run `{slug}`.\n"
        full_md = ensure_skill_markdown(
            f'---\nname: {slug}\ndescription: "{desc.replace(chr(34), "")}"\n---\n\n{content}\n',
            slug,
            desc,
        )

        with self._lock(expected_revision) as state:
            if slug in state["skills"] or (self.store_dir / slug).exists():
                raise conflict(f"A skill called {slug} already exists.")
            valid_targets = {t["id"] for t in self.discover_targets()}
            valid_projects = {p["id"] for p in self.discover_projects()}
            if targets is not None and any(t not in valid_targets for t in targets):
                raise invalid("Unknown target instance.")
            if projects is not None and any(p not in valid_projects for p in projects):
                raise invalid("Unknown project.")
            if scope == "project" and not projects:
                raise invalid("Pick at least one project for a project-scoped skill.")

            with tempfile.TemporaryDirectory(prefix=".new-skill-") as tmp:
                stage = Path(tmp)
                (stage / "SKILL.md").write_text(full_md, encoding="utf-8")
                insp = self._stage_into_store(slug, stage, backup_existing=False)

            now = utc_now()
            record = {
                "slug": slug,
                "scope": scope,
                "projects": list(dict.fromkeys(projects or [])),
                "enabled": True,
                "targetMode": "custom" if targets is not None else "global",
                "targets": list(dict.fromkeys(targets or [])),
                "excludedTargets": [],
                "source": {"kind": "created", "installedDigest": insp["digest"]},
                "createdAt": now,
                "updatedAt": now,
            }
            state["skills"][slug] = record
            self._materialize_skill_links(slug, record, state)
            self._save_state_unlocked(state)
        return {**self.snapshot(), "installedSlugs": [slug]}

    def delete_skill(self, slug: str, *, confirm: bool = False, expected_revision: int | None = None) -> dict:
        slug = validate_slug(slug)
        if confirm is not True:
            raise invalid("Removing a skill requires confirm: true.")
        with self._lock(expected_revision) as state:
            owned_links = self._plugin_owned_links()
            targets = self.discover_targets()
            projects = self.discover_projects()
            for t in targets:
                if self._plugin_owner_for(Path(t["skillsDir"]) / slug, owned_links) and slug not in state["skills"]:
                    raise conflict(f"{slug} comes with an Orc plugin and goes with it, so Skills cannot remove it.")

            store_entry = self.store_dir / slug
            link_paths = [Path(t["skillsDir"]) / slug for t in targets]
            for proj in projects:
                for key in ("agentsSkillsDir", "claudeSkillsDir"):
                    link_paths.append(Path(proj[key]) / slug)
            link_paths = [p for p in dict.fromkeys(link_paths) if p.exists() or p.is_symlink()]
            found_any = slug in state["skills"] or store_entry.exists() or bool(link_paths)
            if not found_any:
                raise not_found(f"There is no skill called {slug}.")

            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            token = f"{stamp}-{slug}-removed-{secrets.token_hex(4)}"
            removal_dir = self.trash_dir / token
            removal_dir.mkdir(parents=True)

            # Back everything up and write the manifest before removing anything.
            removable: list[Path] = []
            entries: list[dict] = []
            for link_path in link_paths:
                if self._plugin_owner_for(link_path, owned_links):
                    continue
                if link_path.is_symlink():
                    entries.append({"path": str(link_path), "kind": "symlink", "target": os.readlink(link_path)})
                else:
                    backup = f"copies/{len(entries)}"
                    dest = removal_dir / backup
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    if link_path.is_dir():
                        shutil.copytree(link_path, dest, symlinks=True)
                    else:
                        shutil.copy2(link_path, dest)
                    entries.append({"path": str(link_path), "kind": "copy", "backup": backup})
                removable.append(link_path)

            store_backed_up = store_entry.is_dir() and not store_entry.is_symlink()
            if store_backed_up:
                shutil.copytree(store_entry, removal_dir / "store", symlinks=True)
            record = state["skills"].get(slug)
            atomic_write_json(removal_dir / "removal.json", {
                "version": 1,
                "slug": slug,
                "removedAt": utc_now(),
                "record": json.loads(json.dumps(record)) if isinstance(record, dict) else None,
                "store": store_backed_up,
                "entries": entries,
            })

            for link_path in removable:
                if link_path.is_symlink() or not link_path.is_dir():
                    link_path.unlink(missing_ok=True)
                else:
                    shutil.rmtree(link_path)
            if store_entry.exists() or store_entry.is_symlink():
                if store_entry.is_symlink() or store_entry.is_file():
                    store_entry.unlink()
                else:
                    shutil.rmtree(store_entry)

            state["skills"].pop(slug, None)
            self._save_state_unlocked(state)
        return {**self.snapshot(), "removal": {"token": token, "slug": slug}}

    def restore_skill(self, slug: str, token: str, *, expected_revision: int | None = None) -> dict:
        slug = validate_slug(slug)
        if not isinstance(token, str) or not REMOVAL_TOKEN_RE.fullmatch(token):
            raise invalid("That removal token is not valid.")
        trash_root = self.trash_dir.resolve() if self.trash_dir.exists() else None
        removal_dir = self.trash_dir / token
        if trash_root is None or removal_dir.is_symlink() or not removal_dir.is_dir():
            raise not_found("That removal can no longer be undone.")
        if removal_dir.resolve().parent != trash_root:
            raise invalid("That removal token is not valid.")
        try:
            manifest = json.loads((removal_dir / "removal.json").read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise not_found("That removal can no longer be undone.") from None
        except (OSError, ValueError):
            raise invalid("That removal record is unreadable.") from None
        if not isinstance(manifest, dict) or manifest.get("version") != 1:
            raise invalid("That removal record is unreadable.")
        if manifest.get("slug") != slug:
            raise invalid(f"That removal is not for {slug}.")
        record = manifest.get("record")
        if record is not None and not isinstance(record, dict):
            raise invalid("That removal record is unreadable.")
        entries = manifest.get("entries")
        if not isinstance(entries, list):
            raise invalid("That removal record is unreadable.")
        for entry in entries:
            path = entry.get("path") if isinstance(entry, dict) else None
            if not isinstance(path, str) or not os.path.isabs(path) or Path(path).name != slug:
                raise invalid("That removal record is unreadable.")
            if entry.get("kind") == "symlink":
                if not isinstance(entry.get("target"), str) or not entry["target"]:
                    raise invalid("That removal record is unreadable.")
            elif entry.get("kind") == "copy":
                backup = entry.get("backup")
                if not isinstance(backup, str) or not re.fullmatch(r"copies/\d+", backup) or not (removal_dir / backup).exists():
                    raise invalid("That removal record is unreadable.")
            else:
                raise invalid("That removal record is unreadable.")
        store_backup = removal_dir / "store"
        if manifest.get("store") and not store_backup.is_dir():
            raise invalid("That removal record is unreadable.")

        with self._lock(expected_revision) as state:
            store_entry = self.store_dir / slug
            blocked = []
            if slug in state["skills"]:
                blocked.append(f"{slug} is already managed")
            if store_entry.exists() or store_entry.is_symlink():
                blocked.append(str(store_entry))
            for entry in entries:
                path = Path(entry["path"])
                if path.exists() or path.is_symlink():
                    blocked.append(str(path))
            if blocked:
                raise conflict(f"Cannot undo removing {slug}; something is already in its place.", paths=blocked)

            if manifest.get("store"):
                store_entry.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(store_backup, store_entry, symlinks=True)
            for entry in entries:
                path = Path(entry["path"])
                if entry["kind"] == "symlink":
                    atomic_symlink(entry["target"], path)
                    continue
                source = removal_dir / entry["backup"]
                path.parent.mkdir(parents=True, exist_ok=True)
                if source.is_dir() and not source.is_symlink():
                    shutil.copytree(source, path, symlinks=True)
                else:
                    shutil.copy2(source, path, follow_symlinks=False)
            if record is not None:
                state["skills"][slug] = record
            self._save_state_unlocked(state)
        return self.snapshot()

    def update_settings(
        self,
        *,
        default_targets: list[str] | None = None,
        auto_sync_new_accounts: bool | None = None,
        update_check_interval: str | None = None,
        apply_to_global_skills: bool = False,
        expected_revision: int | None = None,
    ) -> dict:
        with self._lock(expected_revision) as state:
            valid_ids = {t["id"] for t in self.discover_targets()}
            if default_targets is not None:
                if not isinstance(default_targets, list) or any(not isinstance(t, str) or t not in valid_ids for t in default_targets):
                    raise invalid("Unknown target instance in defaultTargets.")
                state["settings"]["defaultTargets"] = list(dict.fromkeys(default_targets))
                state["settings"]["knownTargets"] = sorted(set(state["settings"].get("knownTargets") or []) | valid_ids)
            if auto_sync_new_accounts is not None:
                if not isinstance(auto_sync_new_accounts, bool):
                    raise invalid("autoSyncNewAccounts must be true or false.")
                state["settings"]["autoSyncNewAccounts"] = auto_sync_new_accounts
            if update_check_interval is not None:
                if update_check_interval not in INTERVAL_SECONDS:
                    raise invalid("Interval must be '6h', 'daily', 'weekly', or 'manual'.")
                state["settings"]["updateCheckInterval"] = update_check_interval

            if apply_to_global_skills and default_targets is not None:
                for slug, record in state["skills"].items():
                    if record.get("targetMode", "global") == "global" and (self.store_dir / slug / "SKILL.md").is_file():
                        self._materialize_skill_links(slug, record, state, remove_unwanted_copies=True)

            self._save_state_unlocked(state)
        return self.snapshot()

    def _run_git(self, *args: str) -> bytes:
        if not shutil.which("git"):
            raise SkillsError("Git is not installed on this Mac.", 503, "git_missing")
        env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        env.update(GIT_TERMINAL_PROMPT="0", GIT_CONFIG_NOSYSTEM="1")
        try:
            proc = subprocess.run(
                ["git", "-c", "core.hooksPath=/dev/null", "-c", "protocol.ext.allow=never", *args],
                env=env, capture_output=True, stdin=subprocess.DEVNULL, timeout=GIT_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired as exc:
            raise SkillsError("Git timed out while reading the skill repository.", 504, "git_timeout") from exc
        if proc.returncode != 0:
            err = (proc.stderr.decode("utf-8", errors="replace").strip().splitlines() or ["Git command failed"])[-1]
            raise SkillsError(f"Git could not read that source: {err[:220]}", 400, "git_error")
        return proc.stdout

    def _extract_git_archive(self, repo_dir: Path, tree_spec: str, dest: Path) -> None:
        raw_tar = self._run_git("-C", str(repo_dir), "archive", "--format=tar", tree_spec)
        dest.mkdir(parents=True, exist_ok=True)
        total = 0
        count = 0
        with tarfile.open(fileobj=io.BytesIO(raw_tar), mode="r:") as archive:
            for member in archive.getmembers():
                clean_name = member.name.rstrip("/")
                if not clean_name or clean_name == ".":
                    continue
                rel = safe_rel_path(clean_name)
                target = (dest / rel).resolve()
                if not target.is_relative_to(dest.resolve()):
                    raise invalid("Archive entry escapes destination.")
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                elif member.isfile():
                    count += 1
                    if count > SKILL_MAX_FILES:
                        raise invalid(f"Repository skill exceeds {SKILL_MAX_FILES} files.")
                    if member.size > SKILL_FILE_MAX_BYTES:
                        raise invalid(f"{rel.as_posix()} exceeds 2 MB.")
                    total += member.size
                    if total > SKILL_TOTAL_MAX_BYTES:
                        raise invalid("Repository skill exceeds 8 MB.")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    extracted = archive.extractfile(member)
                    data = extracted.read() if extracted else b""
                    target.write_bytes(data)
                    target.chmod(0o755 if (member.mode & 0o111) else 0o644)
                else:
                    raise invalid("Git skill package cannot contain symlinks or special files.")

    def _discover_skills_in_tree(self, root: Path) -> list[dict]:
        """Find every directory containing SKILL.md inside a cloned/local tree."""
        candidates: list[dict] = []
        if (root / "SKILL.md").is_file() and not (root / "SKILL.md").is_symlink():
            insp = inspect_skill_dir(root)
            if insp:
                candidates.append({"subdir": "", "slug": slugify(insp["name"] or root.name), **insp})
        for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
            dirnames[:] = sorted(
                d for d in dirnames
                if d not in IGNORED_NAMES and not d.startswith(".") and not (Path(dirpath) / d).is_symlink()
            )
            current = Path(dirpath)
            if current == root:
                continue
            if "SKILL.md" in filenames and not (current / "SKILL.md").is_symlink():
                rel = current.relative_to(root).as_posix()
                insp = inspect_skill_dir(current)
                if insp:
                    candidates.append({
                        "subdir": rel,
                        "slug": slugify(current.name if current.name != "skills" else (insp["name"] or "skill")),
                        **insp,
                    })
                # A skill's own subdirectories (examples/, references/) are part of that skill, not nested skills.
                dirnames[:] = []
        return candidates

    def _resolve_github_ref_and_path(self, git_url: str, ref_and_path: list[str], github_mode: str | None) -> tuple[str, str, bool]:
        """Split a GitHub /tree/<ref>/<subdir> URL accurately even when branch names contain slashes."""
        refs_raw = self._run_git("ls-remote", "--heads", "--tags", git_url).decode("utf-8", errors="replace").splitlines()
        known_refs: set[str] = set()
        for line in refs_raw:
            parts = line.split("\t", 1)
            if len(parts) != 2:
                continue
            ref_name = parts[1].strip().removesuffix("^{}")
            for prefix in ("refs/heads/", "refs/tags/"):
                if ref_name.startswith(prefix):
                    known_refs.add(ref_name[len(prefix):])
        ordered_refs = sorted(known_refs, key=lambda item: len(item.split("/")), reverse=True)
        joined = "/".join(ref_and_path)
        chosen_ref = ref_and_path[0]
        rest = "/".join(ref_and_path[1:])
        matched_named_ref = False
        for candidate in ordered_refs:
            if joined == candidate:
                chosen_ref, rest, matched_named_ref = candidate, "", True
                break
            if joined.startswith(candidate + "/"):
                chosen_ref = candidate
                rest = joined[len(candidate) + 1:]
                matched_named_ref = True
                break
        if github_mode == "blob" and rest.lower().endswith(".md"):
            parent = PurePosixPath(rest).parent.as_posix()
            rest = "" if parent == "." else parent
        return chosen_ref, rest.strip("/"), matched_named_ref

    def install_from_input(
        self,
        raw_input: str,
        *,
        selected_subdirs: list[str] | None = None,
        slug_override: str | None = None,
        scope: str = "global",
        targets: list[str] | None = None,
        projects: list[str] | None = None,
        overwrite: bool = True,
        allow_network: bool = True,
        expected_revision: int | None = None,
    ) -> dict:
        if scope not in ("global", "project"):
            raise invalid("Scope must be 'global' or 'project'.")
        parsed = parse_source_input(raw_input, self.home)
        kind = parsed["kind"]

        if kind in ("github", "git", "url") and not allow_network and not str(parsed.get("gitUrl") or "").startswith("file://"):
            raise SkillsError("Network installs are disabled in this preview.", 403, "network_disabled")

        staged_items: list[tuple[str, Path, dict]] = []
        with tempfile.TemporaryDirectory(prefix="orc-skill-install-") as tmp_str:
            tmp = Path(tmp_str)

            if kind == "url":
                raw_url = parsed["rawUrl"]
                body = self._fetch_url(raw_url)
                text = body.decode("utf-8", errors="replace")
                fields, _ = parse_frontmatter(text)
                url_name = PurePosixPath(urllib.parse.urlsplit(raw_url).path).stem
                if url_name.upper() == "SKILL":
                    parts = [p for p in PurePosixPath(urllib.parse.urlsplit(raw_url).path).parts if p not in ("/", "")]
                    url_name = parts[-2] if len(parts) >= 2 else "downloaded-skill"
                derived_slug = slugify(slug_override or parsed.get("skillHint") or fields.get("name") or url_name)
                stage_dir = tmp / derived_slug
                stage_dir.mkdir(parents=True, exist_ok=True)
                (stage_dir / "SKILL.md").write_text(ensure_skill_markdown(text, derived_slug), encoding="utf-8")
                staged_items.append((derived_slug, stage_dir, {
                    "kind": "url",
                    "input": parsed["input"],
                    "rawUrl": raw_url,
                }))

            elif kind == "local":
                local_path = Path(parsed["localPath"]).expanduser()
                if not local_path.exists():
                    raise not_found(f"Local path does not exist: {local_path}")
                resolved = local_path.resolve()
                if resolved.is_file():
                    if resolved.suffix.lower() != ".md":
                        raise invalid("Local file must be a SKILL.md or markdown file.")
                    text = resolved.read_text(encoding="utf-8", errors="replace")
                    fields, _ = parse_frontmatter(text)
                    base_name = resolved.parent.name if resolved.name.upper() == "SKILL.MD" else resolved.stem
                    derived_slug = slugify(slug_override or parsed.get("skillHint") or fields.get("name") or base_name)
                    stage_dir = tmp / derived_slug
                    stage_dir.mkdir(parents=True, exist_ok=True)
                    (stage_dir / "SKILL.md").write_text(ensure_skill_markdown(text, derived_slug), encoding="utf-8")
                    git_meta = detect_local_git(resolved.parent)
                    staged_items.append((derived_slug, stage_dir, {
                        "kind": "local",
                        "input": parsed["input"],
                        "localPath": str(resolved),
                        **git_meta,
                    }))
                else:
                    found = self._discover_skills_in_tree(resolved)
                    if not found:
                        raise invalid(f"No SKILL.md found inside {local_path}.")
                    chosen = self._select_discovered_skills(found, parsed.get("skillHint"), selected_subdirs)
                    if chosen is None:
                        return {
                            "status": "choose_skills",
                            "source": parsed["input"],
                            "availableSkills": [
                                {"slug": c["slug"], "name": c["name"], "description": c["description"], "subdir": c["subdir"]}
                                for c in found
                            ],
                        }
                    for item in chosen:
                        sub_path = (resolved / item["subdir"]).resolve() if item["subdir"] else resolved
                        derived_slug = slugify(slug_override if (slug_override and len(chosen) == 1) else item["slug"])
                        git_meta = detect_local_git(sub_path)
                        staged_items.append((derived_slug, sub_path, {
                            "kind": "local",
                            "input": parsed["input"],
                            "localPath": str(sub_path),
                            **git_meta,
                        }))

            else:
                git_url = parsed["gitUrl"]
                ref = parsed.get("ref") or "HEAD"
                subdir = (parsed.get("subdir") or "").strip("/")
                matched_named_ref = ref != "HEAD"
                if parsed.get("refAndPath"):
                    ref, subdir, matched_named_ref = self._resolve_github_ref_and_path(
                        git_url, parsed["refAndPath"], parsed.get("githubMode")
                    )
                pinned_ref = bool(ref != "HEAD" and not matched_named_ref)

                clone_dir = tmp / "repo"
                clone_args = ["clone", "--no-checkout"]
                if not git_url.startswith("file://"):
                    clone_args.append("--filter=blob:none")
                    if ref == "HEAD" or matched_named_ref:
                        clone_args.extend(["--depth", "1"])
                if ref != "HEAD" and matched_named_ref:
                    clone_args.extend(["--branch", ref])
                clone_args.extend(["--", git_url, str(clone_dir)])
                self._run_git(*clone_args)

                commit_ref = f"origin/{ref}" if ref != "HEAD" else "HEAD"
                try:
                    commit = self._run_git("-C", str(clone_dir), "rev-parse", "--verify", f"{commit_ref}^{{commit}}").decode().strip()
                except SkillsError:
                    commit = self._run_git("-C", str(clone_dir), "rev-parse", "--verify", f"{ref}^{{commit}}").decode().strip()

                extracted_root = tmp / "extracted"
                if subdir:
                    safe_sub = safe_rel_path(subdir).as_posix()
                    self._extract_git_archive(clone_dir, f"{commit}:{safe_sub}", extracted_root)
                    if (extracted_root / "SKILL.md").is_file():
                        insp = inspect_skill_dir(extracted_root)
                        default_name = PurePosixPath(safe_sub).name
                        derived_slug = slugify(slug_override or parsed.get("skillHint") or (insp["name"] if insp else default_name) or default_name)
                        staged_items.append((derived_slug, extracted_root, {
                            "kind": kind,
                            "input": parsed["input"],
                            "gitUrl": git_url,
                            "ref": ref,
                            "pinnedRef": pinned_ref,
                            "subdir": safe_sub,
                            "installedCommit": commit,
                            "lastCheckedRepoCommit": commit,
                        }))
                    else:
                        found = self._discover_skills_in_tree(extracted_root)
                        if not found:
                            raise invalid(f"No SKILL.md found at {safe_sub} in {git_url}.")
                        chosen = self._select_discovered_skills(found, parsed.get("skillHint"), selected_subdirs)
                        if chosen is None:
                            return {
                                "status": "choose_skills",
                                "source": parsed["input"],
                                "availableSkills": [
                                    {
                                        "slug": c["slug"],
                                        "name": c["name"],
                                        "description": c["description"],
                                        "subdir": f"{safe_sub}/{c['subdir']}".strip("/"),
                                    }
                                    for c in found
                                ],
                            }
                        for item in chosen:
                            rel_from_repo = f"{safe_sub}/{item['subdir']}".strip("/")
                            sub_dir = (extracted_root / item["subdir"]) if item["subdir"] else extracted_root
                            derived_slug = slugify(slug_override if (slug_override and len(chosen) == 1) else item["slug"])
                            staged_items.append((derived_slug, sub_dir, {
                                "kind": kind,
                                "input": parsed["input"],
                                "gitUrl": git_url,
                                "ref": ref,
                                "pinnedRef": pinned_ref,
                                "subdir": rel_from_repo,
                                "installedCommit": commit,
                                "lastCheckedRepoCommit": commit,
                            }))
                else:
                    self._extract_git_archive(clone_dir, commit, extracted_root)
                    found = self._discover_skills_in_tree(extracted_root)
                    if not found:
                        raise invalid(f"No SKILL.md found in {git_url}.")
                    chosen = self._select_discovered_skills(found, parsed.get("skillHint"), selected_subdirs)
                    if chosen is None:
                        return {
                            "status": "choose_skills",
                            "source": parsed["input"],
                            "availableSkills": [
                                {"slug": c["slug"], "name": c["name"], "description": c["description"], "subdir": c["subdir"]}
                                for c in found
                            ],
                        }
                    repo_fallback = parsed.get("repo") or PurePosixPath(urllib.parse.urlsplit(git_url).path).stem or "skill"
                    for item in chosen:
                        sub_dir = (extracted_root / item["subdir"]) if item["subdir"] else extracted_root
                        fallback_slug = item["slug"] if item["subdir"] else slugify(item["name"] or repo_fallback)
                        derived_slug = slugify(slug_override if (slug_override and len(chosen) == 1) else fallback_slug)
                        staged_items.append((derived_slug, sub_dir, {
                            "kind": kind,
                            "input": parsed["input"],
                            "gitUrl": git_url,
                            "ref": ref,
                            "pinnedRef": pinned_ref,
                            "subdir": item["subdir"],
                            "installedCommit": commit,
                            "lastCheckedRepoCommit": commit,
                        }))

            with self._lock(expected_revision) as state:
                valid_targets = {t["id"] for t in self.discover_targets()}
                valid_projects = {p["id"] for p in self.discover_projects()}
                if targets is not None and any(t not in valid_targets for t in targets):
                    raise invalid("Unknown target instance.")
                if projects is not None and any(p not in valid_projects for p in projects):
                    raise invalid("Unknown project.")
                if scope == "project" and not projects:
                    raise invalid("Pick at least one project when installing a project-scoped skill.")

                owned_links = self._plugin_owned_links()
                installed_slugs: list[str] = []
                now = utc_now()

                for slug, src_dir, src_meta in staged_items:
                    for t in self.discover_targets():
                        if self._plugin_owner_for(Path(t["skillsDir"]) / slug, owned_links) and slug not in state["skills"]:
                            raise conflict(f"{slug} collides with an Orc plugin skill.")
                    if not overwrite and (slug in state["skills"] or (self.store_dir / slug).exists()):
                        raise conflict(f"Skill {slug} is already installed.")
                    insp = self._stage_into_store(slug, src_dir)
                    existing = state["skills"].get(slug) or {}
                    record = {
                        "slug": slug,
                        "scope": scope,
                        "projects": list(dict.fromkeys(projects if projects is not None else (existing.get("projects") or []))),
                        "enabled": True,
                        "targetMode": "custom" if targets is not None else (existing.get("targetMode") or "global"),
                        "targets": list(dict.fromkeys(targets if targets is not None else (existing.get("targets") or []))),
                        "excludedTargets": list(existing.get("excludedTargets") or []) if targets is None else [],
                        "source": {
                            **src_meta,
                            "installedDigest": insp["digest"],
                            "remoteCommit": src_meta.get("installedCommit"),
                            "remoteDigest": insp["digest"],
                            "remoteSummary": None,
                            "updateAvailable": False,
                            "lastCheckedAt": now,
                            "lastUpdatedAt": now,
                            "checkError": None,
                        },
                        "createdAt": existing.get("createdAt") or now,
                        "updatedAt": now,
                    }
                    state["skills"][slug] = record
                    self._materialize_skill_links(slug, record, state, remove_unwanted_copies=True)
                    installed_slugs.append(slug)

                self._save_state_unlocked(state)

        return {"status": "installed", **self.snapshot(), "installedSlugs": installed_slugs}

    @staticmethod
    def _select_discovered_skills(found: list[dict], skill_hint: str | None, selected_subdirs: list[str] | None) -> list[dict] | None:
        if selected_subdirs is not None:
            wanted = {s.strip("/") for s in selected_subdirs if isinstance(s, str)}
            picked = [item for item in found if item["subdir"].strip("/") in wanted or item["slug"] in wanted]
            if not picked:
                raise invalid("None of the selected skills matched that repository.")
            return picked
        if skill_hint:
            hint_slug = slugify(skill_hint)
            picked = [
                item for item in found
                if item["slug"] == hint_slug
                or slugify(item["name"]) == hint_slug
                or PurePosixPath(item["subdir"]).name.lower() == skill_hint.lower()
            ]
            if picked:
                return [picked[0]]
            raise not_found(f"Could not find a skill matching '{skill_hint}' in that repository.")
        if len(found) == 1:
            return found
        return None

    def update_due(self, now_ts: float | None = None) -> bool:
        state = self._read_state_unlocked()
        interval_key = state["settings"].get("updateCheckInterval") or "daily"
        seconds = INTERVAL_SECONDS.get(interval_key)
        if seconds is None:
            return False
        last_ts = parse_iso(state["settings"].get("lastUpdateCheckAt"))
        if last_ts is None:
            return True
        current = time.time() if now_ts is None else now_ts
        return (current - last_ts) >= seconds

    def _probe_single_source(
        self,
        slug: str,
        source: dict,
        baseline_digest: str | None,
        *,
        current_store_digest: str | None = None,
        allow_network: bool,
    ) -> dict:
        now = utc_now()
        updated = dict(source, lastCheckedAt=now, checkError=None)
        kind = source.get("kind")

        if source.get("gitUrl"):
            git_url = source["gitUrl"]
            if not allow_network and not git_url.startswith("file://"):
                return source
            ref = source.get("ref") or "HEAD"
            if source.get("pinnedRef") or (ref != "HEAD" and re.fullmatch(r"[0-9a-fA-F]{40}", ref)):
                updated.update(updateAvailable=False, remoteSummary=None)
                return updated
            ls_out = self._run_git("ls-remote", git_url, ref).decode("utf-8", errors="replace").splitlines()
            if not ls_out and ref != "HEAD":
                ls_out = self._run_git("ls-remote", git_url, f"refs/heads/{ref}", f"refs/tags/{ref}").decode("utf-8", errors="replace").splitlines()
            if not ls_out:
                raise SkillsError(f"Ref {ref} was not found on {git_url}.", 400, "missing_ref")
            remote_commit = ls_out[0].split()[0].strip()
            subdir = (source.get("subdir") or "").strip("/")

            if remote_commit == source.get("installedCommit") and not source.get("updateAvailable"):
                updated.update(remoteCommit=remote_commit, lastCheckedRepoCommit=remote_commit, updateAvailable=False, remoteSummary=None)
                return updated

            if subdir and remote_commit == source.get("lastCheckedRepoCommit") and "updateAvailable" in source:
                return updated

            with tempfile.TemporaryDirectory(prefix="orc-skill-check-") as tmp_str:
                clone_dir = Path(tmp_str) / "repo"
                clone_args = ["clone", "--no-checkout"]
                if not git_url.startswith("file://"):
                    clone_args.extend(["--filter=blob:none", "--depth", "5"])
                if ref != "HEAD":
                    clone_args.extend(["--branch", ref])
                clone_args.extend(["--", git_url, str(clone_dir)])
                self._run_git(*clone_args)

                stage_dir = Path(tmp_str) / "extracted"
                tree_spec = f"{remote_commit}:{safe_rel_path(subdir).as_posix()}" if subdir else remote_commit
                self._extract_git_archive(clone_dir, tree_spec, stage_dir)
                if not (stage_dir / "SKILL.md").is_file():
                    raise SkillsError("Upstream skill no longer contains SKILL.md.", 400, "upstream_missing_skill")
                normalized = ensure_skill_markdown((stage_dir / "SKILL.md").read_text(encoding="utf-8", errors="replace"), slug)
                (stage_dir / "SKILL.md").write_text(normalized, encoding="utf-8")
                remote_insp = inspect_skill_dir(stage_dir)
                remote_digest = remote_insp["digest"] if remote_insp else None

                log_cmd = ["-C", str(clone_dir), "log", "-1", "--format=%s", remote_commit]
                if subdir:
                    log_cmd.extend(["--", subdir])
                try:
                    summary_line = self._run_git(*log_cmd).decode("utf-8", errors="replace").strip() or None
                except SkillsError:
                    summary_line = None

                has_update = bool(
                    remote_digest
                    and baseline_digest
                    and remote_digest != baseline_digest
                    and remote_digest != current_store_digest
                )
                updated.update(
                    remoteCommit=remote_commit,
                    remoteDigest=remote_digest,
                    lastCheckedRepoCommit=remote_commit,
                    updateAvailable=has_update,
                    remoteSummary=summary_line if has_update else None,
                    installedCommit=remote_commit if not has_update else source.get("installedCommit"),
                )
                return updated

        if kind == "url" and source.get("rawUrl"):
            if not allow_network:
                return source
            body = self._fetch_url(source["rawUrl"])
            normalized = ensure_skill_markdown(body.decode("utf-8", errors="replace"), slug)
            with tempfile.TemporaryDirectory(prefix="orc-skill-urlcheck-") as tmp_str:
                stage = Path(tmp_str)
                (stage / "SKILL.md").write_text(normalized, encoding="utf-8")
                insp = inspect_skill_dir(stage)
                remote_digest = insp["digest"] if insp else None
            has_update = bool(
                remote_digest
                and baseline_digest
                and remote_digest != baseline_digest
                and remote_digest != current_store_digest
            )
            updated.update(
                remoteDigest=remote_digest,
                updateAvailable=has_update,
                remoteSummary="Upstream markdown changed" if has_update else None,
            )
            return updated

        if source.get("localPath"):
            local_p = Path(source["localPath"])
            if local_p.is_file() and local_p.suffix.lower() == ".md":
                text = ensure_skill_markdown(local_p.read_text(encoding="utf-8", errors="replace"), slug)
                with tempfile.TemporaryDirectory(prefix="orc-skill-loccheck-") as tmp_str:
                    stage = Path(tmp_str)
                    (stage / "SKILL.md").write_text(text, encoding="utf-8")
                    insp = inspect_skill_dir(stage)
                    remote_digest = insp["digest"] if insp else None
            elif local_p.is_dir():
                with tempfile.TemporaryDirectory(prefix="orc-skill-loccheck-") as tmp_str:
                    stage = Path(tmp_str) / "skill"
                    copy_skill_tree(local_p, stage)
                    (stage / "SKILL.md").write_text(
                        ensure_skill_markdown((stage / "SKILL.md").read_text(encoding="utf-8", errors="replace"), slug),
                        encoding="utf-8",
                    )
                    insp = inspect_skill_dir(stage)
                    remote_digest = insp["digest"] if insp else None
            else:
                return updated
            has_update = bool(
                remote_digest
                and baseline_digest
                and remote_digest != baseline_digest
                and remote_digest != current_store_digest
            )
            updated.update(
                remoteDigest=remote_digest,
                updateAvailable=has_update,
                remoteSummary="Source folder on disk has newer edits" if has_update else None,
            )
            return updated

        return updated

    def check_updates(self, *, slug: str | None = None, allow_network: bool = True) -> dict:
        if slug is not None:
            slug = validate_slug(slug)
        state = self._read_state_unlocked()
        candidates: list[tuple[str, dict, str | None, str | None]] = []
        for s_slug, record in state["skills"].items():
            if slug is not None and s_slug != slug:
                continue
            src = record.get("source") or {}
            if not (src.get("gitUrl") or src.get("rawUrl") or src.get("localPath")):
                continue
            store_insp = inspect_skill_dir(self.store_dir / s_slug)
            store_digest = store_insp["digest"] if store_insp else None
            baseline_digest = src.get("installedDigest") or store_digest
            candidates.append((s_slug, dict(src), baseline_digest, store_digest))

        probed_results: dict[str, tuple[dict, dict]] = {}
        errors: list[str] = []
        for s_slug, src, baseline_digest, store_digest in candidates:
            try:
                updated_src = self._probe_single_source(
                    s_slug,
                    src,
                    baseline_digest,
                    current_store_digest=store_digest,
                    allow_network=allow_network,
                )
                probed_results[s_slug] = (src, updated_src)
            except (SkillsError, OSError) as exc:
                errors.append(f"{s_slug}: {exc}")
                probed_results[s_slug] = (src, dict(src, lastCheckedAt=utc_now(), checkError=str(exc)))

        with self._lock() as locked:
            now = utc_now()
            if slug is None:
                locked["settings"]["lastUpdateCheckAt"] = now
                locked["settings"]["lastUpdateCheckError"] = "; ".join(errors)[:300] if errors else None
            for s_slug, (orig_src, updated_src) in probed_results.items():
                if s_slug not in locked["skills"]:
                    continue
                cur_src = locked["skills"][s_slug].get("source") or {}
                if cur_src.get("installedDigest") == orig_src.get("installedDigest") and cur_src.get("input") == orig_src.get("input"):
                    locked["skills"][s_slug]["source"] = updated_src
            self._save_state_unlocked(locked)

        snap = self.snapshot()
        snap["checkedCount"] = len(probed_results)
        return snap

    def _commit_updated_skill(
        self,
        slug: str,
        stage_dir: Path,
        src: dict,
        *,
        commit: str | None = None,
        expected_revision: int | None = None,
    ) -> dict:
        with self._lock(expected_revision) as locked:
            if slug not in locked["skills"]:
                raise not_found(f"Skill {slug} was removed while updating.")
            insp = self._stage_into_store(slug, stage_dir)
            now = utc_now()
            rec = locked["skills"][slug]
            base_src = dict(rec.get("source") or src)
            updated_source = {
                **base_src,
                "installedDigest": insp["digest"],
                "remoteDigest": insp["digest"],
                "remoteSummary": None,
                "updateAvailable": False,
                "lastCheckedAt": now,
                "lastUpdatedAt": now,
                "checkError": None,
            }
            if commit is not None:
                updated_source.update(
                    installedCommit=commit,
                    remoteCommit=commit,
                    lastCheckedRepoCommit=commit,
                )
            rec["source"] = updated_source
            rec["updatedAt"] = now
            self._materialize_skill_links(slug, rec, locked)
            self._save_state_unlocked(locked)
        return self.snapshot()

    def update_skill(self, slug: str, *, allow_network: bool = True, expected_revision: int | None = None) -> dict:
        slug = validate_slug(slug)
        state = self._read_state_unlocked()
        record = state["skills"].get(slug)
        if record is None:
            raise not_found(f"Skill {slug} is not registered for updates; sync or attach a source link first.")
        src = record.get("source") or {}

        if src.get("gitUrl"):
            git_url = src["gitUrl"]
            if not allow_network and not git_url.startswith("file://"):
                raise SkillsError("Network updates are disabled in this preview.", 403, "network_disabled")
            ref = src.get("ref") or "HEAD"
            is_pinned = bool(src.get("pinnedRef") or (ref != "HEAD" and re.fullmatch(r"[0-9a-fA-F]{40}", ref)))
            subdir = (src.get("subdir") or "").strip("/")
            with tempfile.TemporaryDirectory(prefix="orc-skill-update-") as tmp_str:
                tmp = Path(tmp_str)
                clone_dir = tmp / "repo"
                clone_args = ["clone", "--no-checkout"]
                if not git_url.startswith("file://"):
                    clone_args.append("--filter=blob:none")
                    if not is_pinned:
                        clone_args.extend(["--depth", "1"])
                if ref != "HEAD" and not is_pinned:
                    clone_args.extend(["--branch", ref])
                clone_args.extend(["--", git_url, str(clone_dir)])
                self._run_git(*clone_args)
                commit_ref = f"origin/{ref}" if (ref != "HEAD" and not is_pinned) else ref
                try:
                    commit = self._run_git("-C", str(clone_dir), "rev-parse", "--verify", f"{commit_ref}^{{commit}}").decode().strip()
                except SkillsError:
                    commit = self._run_git("-C", str(clone_dir), "rev-parse", "--verify", f"{ref}^{{commit}}").decode().strip()
                extracted = tmp / "extracted"
                tree_spec = f"{commit}:{safe_rel_path(subdir).as_posix()}" if subdir else commit
                self._extract_git_archive(clone_dir, tree_spec, extracted)
                if not (extracted / "SKILL.md").is_file():
                    raise SkillsError("Upstream skill no longer contains SKILL.md.", 400, "upstream_missing_skill")
                return self._commit_updated_skill(slug, extracted, src, commit=commit, expected_revision=expected_revision)

        if src.get("rawUrl"):
            if not allow_network:
                raise SkillsError("Network updates are disabled in this preview.", 403, "network_disabled")
            body = self._fetch_url(src["rawUrl"])
            text = body.decode("utf-8", errors="replace")
            with tempfile.TemporaryDirectory(prefix="orc-skill-urlupd-") as tmp_str:
                stage = Path(tmp_str)
                (stage / "SKILL.md").write_text(ensure_skill_markdown(text, slug), encoding="utf-8")
                return self._commit_updated_skill(slug, stage, src, expected_revision=expected_revision)

        if src.get("localPath"):
            local_p = Path(src["localPath"])
            if not local_p.exists():
                raise not_found(f"Source path no longer exists: {local_p}")
            with tempfile.TemporaryDirectory(prefix="orc-skill-locupd-") as tmp_str:
                stage = Path(tmp_str) / "skill"
                if local_p.is_file():
                    stage.mkdir(parents=True, exist_ok=True)
                    text = local_p.read_text(encoding="utf-8", errors="replace")
                    (stage / "SKILL.md").write_text(ensure_skill_markdown(text, slug), encoding="utf-8")
                else:
                    copy_skill_tree(local_p, stage)
                return self._commit_updated_skill(slug, stage, src, expected_revision=expected_revision)

        raise invalid(f"{slug} does not have an upstream Git or URL source to update from.")

    def update_all(self, *, allow_network: bool = True) -> dict:
        snap = self.check_updates(allow_network=allow_network)
        updated_slugs: list[str] = []
        skipped_local: list[str] = []
        errors: dict[str, str] = {}
        for item in snap["skills"]:
            if item["kind"] == "orc-plugin" or not item["source"].get("updateAvailable"):
                continue
            if item["source"].get("locallyModified"):
                skipped_local.append(item["slug"])
                continue
            try:
                self.update_skill(item["slug"], allow_network=allow_network)
                updated_slugs.append(item["slug"])
            except SkillsError as exc:
                errors[item["slug"]] = str(exc)
        out = self.snapshot()
        out["updateReport"] = {
            "updated": updated_slugs,
            "skippedLocallyModified": skipped_local,
            "errors": errors,
        }
        return out
