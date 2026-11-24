"""The side panel's Files view: a run's checkout, listed one directory at a
time, searched by path, and previewed. Every path is relative to the
checkout and resolved inside it, so a symlink or `..` can never reach past it.
The one exception is a file the run's own agent wrote, which read_file shows
wherever it lives.
Git's own ignore rules decide what is listed, the way T3 Code's file tree
hides what the project ignores."""
from __future__ import annotations

import base64
import os
import re
import stat
import subprocess
from typing import Any, BinaryIO
from urllib.parse import quote

MAX_ENTRIES = 2000
MAX_SEARCH_RESULTS = 200
MAX_FILE_BYTES = 1024 * 1024
HIDDEN_NAMES = {".git"}


class FilesError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def resolve(root: str, relative: str) -> str:
    if not isinstance(relative, str) or "\0" in relative or os.path.isabs(relative):
        raise FilesError(400, "invalid path")
    parts = [part for part in relative.replace("\\", "/").split("/") if part not in ("", ".")]
    if any(part == ".." or part in HIDDEN_NAMES for part in parts):
        raise FilesError(400, "invalid path")
    real_root = os.path.realpath(root)
    full = os.path.realpath(os.path.join(real_root, *parts))
    if full != real_root and not full.startswith(real_root + os.sep):
        raise FilesError(400, "path is outside the checkout")
    return full


def existing_target(root: str, path: str) -> str:
    if not isinstance(path, str) or "\0" in path:
        raise FilesError(400, "invalid path")
    if os.path.isabs(path):
        path = os.path.relpath(os.path.realpath(path), os.path.realpath(root))
    target = resolve(root, path)
    if not os.path.exists(target):
        raise FilesError(404, "no such file in this checkout")
    return target


def _git(root: str, args: list[str], stdin: str | None = None) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", root, *args], input=stdin, capture_output=True,
            text=True, timeout=10, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    # check-ignore exits 1 when nothing matched, which is still an answer
    return result.stdout if result.returncode in (0, 1) else None


GITHUB_REMOTE = re.compile(
    r"^(?:https?://(?:[^@/]+@)?|ssh://git@|git@)github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?/?$")


def _git_value(root: str, args: list[str]) -> str:
    return (_git(root, args) or "").strip()


def _has_object(root: str, spec: str) -> bool:
    try:
        result = subprocess.run(
            ["git", "-C", root, "cat-file", "-e", spec], capture_output=True,
            timeout=10, check=False)
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def _pushed_branch(root: str) -> tuple[str, str] | None:
    branch = _git_value(root, ["symbolic-ref", "--short", "-q", "HEAD"])
    if not branch:
        return None
    remote = _git_value(root, ["config", f"branch.{branch}.remote"])
    merge = _git_value(root, ["config", f"branch.{branch}.merge"])
    if remote not in ("", ".") and merge.startswith("refs/heads/"):
        return remote, merge[len("refs/heads/"):]
    # Orc pushes with `git push origin <branch>`, which sets no upstream but
    # does update the remote-tracking ref.
    if _has_object(root, f"refs/remotes/origin/{branch}"):
        return "origin", branch
    return None


def _default_branch(root: str, remote: str) -> str | None:
    head = _git_value(root, ["symbolic-ref", "--short", "-q", f"refs/remotes/{remote}/HEAD"])
    if head.startswith(f"{remote}/"):
        return head[len(remote) + 1:]
    return next((name for name in ("main", "master")
                 if _has_object(root, f"refs/remotes/{remote}/{name}")), None)


def remote_url(root: str, relative: str = "") -> dict[str, str]:
    """The GitHub page for ``relative``. ``state`` says where it points:
    ``branch`` when the checkout's branch is pushed with that path on it,
    ``default`` when only the default branch has it, and ``missing`` (with no
    url) when neither does. Presence is read from the remote-tracking refs, so
    it is as fresh as the last fetch or push."""
    full = resolve(root, relative)
    real_root = os.path.realpath(root)
    pushed = _pushed_branch(root)
    remote = pushed[0] if pushed else "origin"
    match = GITHUB_REMOTE.match(_git_value(root, ["remote", "get-url", remote]))
    if not match:
        raise FilesError(404, "this checkout has no GitHub remote")
    prefix = _git_value(root, ["rev-parse", "--show-prefix"])
    inside = os.path.relpath(full, real_root).replace(os.sep, "/")
    path = (prefix + ("" if inside == "." else inside)).strip("/")
    kind = "blob" if os.path.isfile(full) else "tree"

    def link(ref: str) -> str:
        url = f"https://github.com/{match[1]}/{match[2]}/{kind}/{quote(ref, safe='/')}"
        return url + (f"/{quote(path, safe='/')}" if path else "")

    if pushed and _has_object(root, f"refs/remotes/{remote}/{pushed[1]}:{path}"):
        return {"url": link(pushed[1]), "ref": pushed[1], "state": "branch"}
    default = _default_branch(root, remote)
    if default is None:
        return {"url": link("HEAD"), "ref": "HEAD", "state": "default"}
    if _has_object(root, f"refs/remotes/{remote}/{default}:{path}"):
        return {"url": link(default), "ref": default, "state": "default"}
    return {"url": "", "ref": default, "state": "missing"}


def _ignored(root: str, relatives: list[str]) -> set[str]:
    if not relatives:
        return set()
    out = _git(root, ["check-ignore", "-z", "--stdin"], "\0".join(relatives) + "\0")
    return set(filter(None, (out or "").split("\0")))


def list_directory(root: str, relative: str = "") -> dict[str, Any]:
    full = resolve(root, relative)
    if not os.path.isdir(full):
        raise FilesError(404, "no such directory")
    base = os.path.relpath(full, os.path.realpath(root))
    base = "" if base == "." else base.replace(os.sep, "/")
    try:
        names = sorted(os.listdir(full), key=lambda name: name.lower())
    except OSError:
        raise FilesError(403, "directory can't be read") from None
    names = [name for name in names if name not in HIDDEN_NAMES]
    paths = {name: f"{base}/{name}" if base else name for name in names}
    ignored = _ignored(root, list(paths.values()))
    entries = []
    for name in names:
        path = paths[name]
        if path in ignored:
            continue
        kind = "directory" if os.path.isdir(os.path.join(full, name)) else "file"
        entries.append({"name": name, "path": path, "kind": kind})
    entries.sort(key=lambda entry: (entry["kind"] != "directory", entry["name"].lower()))
    return {"path": base, "entries": entries[:MAX_ENTRIES],
            "truncated": len(entries) > MAX_ENTRIES}


def search(root: str, query: str) -> dict[str, Any]:
    words = query.lower().split()
    if not words:
        return {"query": query, "entries": [], "truncated": False}
    out = _git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    if out is not None:
        candidates = filter(None, out.split("\0"))
    else:
        candidates = _walk(root)
    matches = []
    truncated = False
    for path in candidates:
        lower = path.lower()
        if not all(word in lower for word in words):
            continue
        if len(matches) == MAX_SEARCH_RESULTS:
            truncated = True
            break
        matches.append({"name": path.rsplit("/", 1)[-1], "path": path, "kind": "file"})
    matches.sort(key=lambda entry: (len(entry["path"]), entry["path"].lower()))
    return {"query": query, "entries": matches, "truncated": truncated}


def _walk(root: str):
    real_root = os.path.realpath(root)
    for directory, dirs, files in os.walk(real_root):
        dirs[:] = [name for name in dirs if name not in HIDDEN_NAMES]
        for name in files:
            yield os.path.relpath(os.path.join(directory, name), real_root).replace(os.sep, "/")


def read_file(root: str | None, relative: str, outside_ok=None) -> dict[str, Any]:
    """An absolute ``relative`` inside the checkout reads
    as its checkout path; one outside it, or any file of a run with no
    checkout, reads only when ``outside_ok`` vouches for it."""
    outside = False
    if isinstance(relative, str) and os.path.isabs(relative) and "\0" not in relative:
        real_root = os.path.realpath(root) if root else None
        full = os.path.realpath(relative)
        if real_root and full.startswith(real_root + os.sep):
            relative = os.path.relpath(full, real_root)
        elif outside_ok is not None and outside_ok(full):
            outside = True
        else:
            raise FilesError(400, "path is outside the checkout")
    if not outside:
        if not root:
            raise FilesError(404, "this run has no checkout on disk")
        full = resolve(root, relative)
    if not os.path.isfile(full):
        raise FilesError(404, "no such file")
    size = os.path.getsize(full)
    path = full if outside else os.path.relpath(full, os.path.realpath(root)).replace(os.sep, "/")
    result: dict[str, Any] = {"path": path, "size": size, "binary": False, "outside": outside,
                              "truncated": size > MAX_FILE_BYTES, "text": ""}
    content_type = IMAGE_TYPES.get(os.path.splitext(full)[1].lower())
    if content_type and size > MAX_IMAGE_BYTES:
        raise FilesError(413, "image exceeds the 12 MB preview limit")
    try:
        with open(full, "rb") as handle:
            data = handle.read(MAX_IMAGE_BYTES + 1 if content_type else MAX_FILE_BYTES)
    except OSError:
        raise FilesError(403, "file can't be read") from None
    if content_type:
        if len(data) > MAX_IMAGE_BYTES:
            raise FilesError(413, "image exceeds the 12 MB preview limit")
        result.update(binary=True, truncated=False,
                      image=f"data:{content_type};base64,{base64.b64encode(data).decode('ascii')}")
        return result
    if b"\0" in data[:8192]:
        result["binary"] = True
        return result
    result["text"] = data.decode("utf-8", errors="replace")
    return result


IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
               ".avif": "image/avif"}
MAX_IMAGE_BYTES = 12 * 1024 * 1024


AUDIO_TYPES = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
               ".oga": "audio/ogg", ".opus": "audio/ogg", ".m4a": "audio/mp4",
               ".aac": "audio/aac", ".flac": "audio/flac"}
VIDEO_TYPES = {".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
               ".mov": "video/quicktime", ".ogv": "video/ogg"}
# What the Assets tab and the chat's clip player can show from a run.
MEDIA_TYPES = {**IMAGE_TYPES, **AUDIO_TYPES, **VIDEO_TYPES}


def read_image(roots: list[str], path: str, outside_ok=None) -> tuple[bytes, str]:
    handle, content_type = _open_media(roots, path, IMAGE_TYPES, "image", outside_ok)
    with handle:
        try:
            data = handle.read(MAX_IMAGE_BYTES + 1)
        except OSError:
            raise FilesError(404, "image unavailable in this run") from None
    if len(data) > MAX_IMAGE_BYTES:
        raise FilesError(413, "image too large")
    return data, content_type


def open_media(roots: list[str], path: str) -> tuple[BinaryIO, str]:
    """An image, audio or video file inside a root, opened for a ranged
    response. It has no size cap: the caller reads only the bytes asked for."""
    return _open_media(roots, path, MEDIA_TYPES, "media", None)


BLOB_OID = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")


class BlobStream:
    """One git blob read forwards through ``git cat-file``, so a long video
    is never held whole. ``seek`` only skips ahead from the start."""

    def __init__(self, root: str, oid: str):
        self._process = subprocess.Popen(
            ["git", "-C", root, "cat-file", "blob", oid],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    def read(self, size: int) -> bytes:
        return self._process.stdout.read(size)

    def seek(self, offset: int) -> None:
        while offset > 0 and (chunk := self.read(min(offset, 65536))):
            offset -= len(chunk)

    def __enter__(self) -> "BlobStream":
        return self

    def __exit__(self, *exc) -> None:
        self._process.kill()
        self._process.stdout.close()
        self._process.wait()


def open_media_blob(roots: list[str], path: str, oid: str) -> tuple[BlobStream, str, int]:
    """The image, audio or video a diff names by blob id, read from git: the
    side of a change the checkout no longer holds, such as a deleted clip.
    ``path`` only gives its type. Returns the stream, type and size."""
    if not isinstance(path, str) or not path or "\0" in path:
        raise FilesError(400, "invalid media path")
    content_type = MEDIA_TYPES.get(os.path.splitext(path)[1].lower())
    if not content_type:
        raise FilesError(415, "unsupported media type")
    if not isinstance(oid, str) or not BLOB_OID.match(oid):
        raise FilesError(400, "invalid blob id")
    for root in roots:
        if not os.path.isdir(root):
            continue
        found = (_git(root, ["cat-file", "--batch-check"], oid + "\n") or "").split()
        if len(found) == 3 and found[1] == "blob" and found[2].isdigit():
            try:
                return BlobStream(root, oid), content_type, int(found[2])
            except OSError:
                continue
    raise FilesError(404, "media unavailable in this run")


def confined(roots: list[str], path: str, outside_ok=None) -> list[str]:
    """Real paths `path` names inside any root, or the path itself when it is
    absolute, outside every root, and `outside_ok` allows it."""
    candidates = []
    for root in roots:
        relative = os.path.relpath(os.path.realpath(path), os.path.realpath(root)) if os.path.isabs(path) else path
        try:
            full = resolve(root, relative)
        except FilesError:
            continue
        candidates.append(full)
    if not candidates and os.path.isabs(path) and outside_ok is not None:
        full = os.path.realpath(path)
        if outside_ok(full):
            candidates.append(full)
    return candidates


def _open_media(roots: list[str], path: str, types: dict[str, str], noun: str,
                outside_ok) -> tuple[BinaryIO, str]:
    if not isinstance(path, str) or not path or "\0" in path:
        raise FilesError(400, f"invalid {noun} path")
    for full in confined(roots, path, outside_ok):
        content_type = types.get(os.path.splitext(full)[1].lower())
        if not content_type:
            raise FilesError(415, f"unsupported {noun} type")
        try:
            if not stat.S_ISREG(os.stat(full).st_mode):
                raise FilesError(404, f"{noun} unavailable")
            descriptor = os.open(full, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except OSError:
            continue
        handle = os.fdopen(descriptor, "rb")
        if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
            handle.close()
            raise FilesError(404, f"{noun} unavailable")
        return handle, content_type
    raise FilesError(404, f"{noun} unavailable in this run")
