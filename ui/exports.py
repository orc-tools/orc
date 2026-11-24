import atexit
import base64
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import secrets
import stat
import tempfile
import threading
import time
from typing import Optional
import zipfile


MAX_CHUNK_BYTES = 256 * 1024
MAX_ARCHIVE_BYTES = 2 * 1024 ** 3
MAX_TOTAL_BYTES = 4 * 1024 ** 3
MAX_ARCHIVES = 8
TTL_SECONDS = 15 * 60


class ExportError(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class _LimitedFile:
    def __init__(self, spool, limit):
        self.spool = spool
        self.limit = limit

    def write(self, data):
        if self.spool.tell() + len(data) > self.limit:
            raise ExportError(413, 'archive storage limit exceeded')
        return self.spool.write(data)

    def __getattr__(self, name):
        return getattr(self.spool, name)


def _open_at(directory, name, *, folder=False):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    if folder:
        flags |= os.O_DIRECTORY
    return os.open(name, flags, dir_fd=directory)


def _project(directory):
    try:
        descriptor = _open_at(directory, 'meta.json')
    except OSError:
        return None
    with os.fdopen(descriptor, 'rb') as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            return None
        try:
            meta = json.load(source)
        except (OSError, ValueError):
            return None
    return meta.get('mainRepoPath') if isinstance(meta, dict) else None


def _zip_run(archive, directory, name):
    for root, directories, files, descriptor in os.fwalk('.', dir_fd=directory):
        directories.sort()
        for filename in sorted(files):
            try:
                source_fd = _open_at(descriptor, filename)
            except OSError:
                continue
            with os.fdopen(source_fd, 'rb') as source:
                info = os.fstat(source.fileno())
                if not stat.S_ISREG(info.st_mode):
                    continue
                member = '/'.join((name, *Path(root).parts, filename))
                stamp = time.localtime(info.st_mtime)[:6]
                stamp = max((1980, 1, 1, 0, 0, 0), min(stamp, (2107, 12, 31, 23, 59, 58)))
                entry = zipfile.ZipInfo(member, stamp)
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = info.st_mode << 16
                with archive.open(entry, 'w', force_zip64=True) as target:
                    remaining = info.st_size
                    while remaining:
                        try:
                            data = source.read(min(MAX_CHUNK_BYTES, remaining))
                        except OSError:
                            break
                        if not data:
                            break
                        target.write(data)
                        remaining -= len(data)


def _build(runtime, projects, spool, limit):
    keys = None
    if projects is not None:
        if (not isinstance(projects, list) or len(projects) > 1000
                or any(not isinstance(key, str) or len(key) > 262144 for key in projects)):
            raise ExportError(400, 'invalid projects')
        keys = {runtime['canonical_path'](key.strip()) for key in projects if key.strip()}
        if not keys:
            raise ExportError(400, 'missing projects')
    root = Path(runtime['RUNS']).resolve()
    matched = 0
    try:
        root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except (FileNotFoundError, NotADirectoryError):
        root_fd = None
    try:
        with zipfile.ZipFile(_LimitedFile(spool, limit), 'w', zipfile.ZIP_DEFLATED) as archive:
            for name in sorted(os.listdir(root_fd)) if root_fd is not None else []:
                if name.startswith('.'):
                    continue
                try:
                    directory = _open_at(root_fd, name, folder=True)
                except OSError:
                    continue
                try:
                    if keys is not None:
                        project = _project(directory)
                        if (not isinstance(project, str) or not project
                                or runtime['canonical_path'](project) not in keys):
                            continue
                    matched += 1
                    _zip_run(archive, directory, name)
                finally:
                    os.close(directory)
    finally:
        if root_fd is not None:
            os.close(root_fd)
    if not matched:
        raise ExportError(404, 'no runs to back up' if projects is None
                          else 'no runs for selected projects')
    return matched


@dataclass
class _Archive:
    spool: object
    size: int
    expires: Optional[float]


class ArchiveStore:
    def __init__(self, *, max_archive_bytes=MAX_ARCHIVE_BYTES,
                 max_total_bytes=MAX_TOTAL_BYTES, max_archives=MAX_ARCHIVES,
                 ttl_seconds=TTL_SECONDS, clock=time.monotonic):
        self.max_archive_bytes = max_archive_bytes
        self.max_total_bytes = max_total_bytes
        self.max_archives = max_archives
        self.ttl_seconds = ttl_seconds
        self.clock = clock
        self._archives = {}
        self._lock = threading.RLock()
        self._timer = None

    def _purge(self):
        now = self.clock()
        for handle, archive in list(self._archives.items()):
            if archive.expires is not None and archive.expires <= now:
                archive.spool.close()
                del self._archives[handle]

    def _schedule(self):
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        deadlines = [item.expires for item in self._archives.values() if item.expires is not None]
        if deadlines:
            delay = max(0.01, min(deadlines) - self.clock())
            self._timer = threading.Timer(delay, self._expire)
            self._timer.daemon = True
            self._timer.start()

    def _expire(self):
        with self._lock:
            self._purge()
            self._schedule()

    def create(self, runtime, projects=None, *, http_owned=False):
        with self._lock:
            self._purge()
            if len(self._archives) >= self.max_archives:
                raise ExportError(429, 'too many archives; release an archive or wait for expiry')
            available = self.max_total_bytes - sum(item.size for item in self._archives.values())
            try:
                spool = tempfile.TemporaryFile(prefix='orc-archive-')
            except OSError:
                raise ExportError(500, 'could not create run archive') from None
            try:
                count = _build(runtime, projects, spool, min(self.max_archive_bytes, available))
                size = spool.seek(0, os.SEEK_END)
            except ExportError:
                spool.close()
                raise
            except (OSError, ValueError, zipfile.BadZipFile):
                spool.close()
                raise ExportError(500, 'could not create run archive') from None
            except BaseException:
                spool.close()
                raise
            handle = secrets.token_urlsafe(32)
            expires = None if http_owned else self.clock() + self.ttl_seconds
            self._archives[handle] = _Archive(spool, size, expires)
            self._schedule()
            prefix = 'orc-runs-backup' if projects is None else 'orc-export'
            return {'handle': handle, 'filename': prefix + time.strftime('-%Y%m%d-%H%M.zip'),
                    'size': size, 'runCount': count,
                    'expiresAt': None if http_owned else time.time() + self.ttl_seconds,
                    'maxChunkBytes': MAX_CHUNK_BYTES}

    def _lookup(self, handle):
        if not isinstance(handle, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', handle):
            raise ExportError(404, 'archive not found or expired')
        self._purge()
        archive = self._archives.get(handle)
        if archive is None:
            raise ExportError(404, 'archive not found or expired')
        return archive

    def read(self, handle, offset=0, length=MAX_CHUNK_BYTES):
        if (type(offset) is not int or offset < 0 or type(length) is not int
                or not 1 <= length <= MAX_CHUNK_BYTES):
            raise ExportError(400, 'invalid archive offset or chunk length')
        with self._lock:
            archive = self._lookup(handle)
            if offset > archive.size:
                raise ExportError(400, 'archive offset exceeds size')
            try:
                archive.spool.seek(offset)
                data = archive.spool.read(length)
            except OSError:
                archive.spool.close()
                del self._archives[handle]
                self._schedule()
                raise ExportError(500, 'could not read run archive') from None
            next_offset = offset + len(data)
            return {'data': base64.b64encode(data).decode('ascii'), 'encoding': 'base64',
                    'offset': offset, 'nextOffset': next_offset,
                    'eof': next_offset == archive.size}

    def release(self, handle):
        with self._lock:
            archive = self._lookup(handle)
            archive.spool.close()
            del self._archives[handle]
            self._schedule()
            return {'released': True}

    def close(self):
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            for archive in self._archives.values():
                archive.spool.close()
            self._archives.clear()


_DEFAULT = ArchiveStore()
atexit.register(_DEFAULT.close)
create = _DEFAULT.create
read = _DEFAULT.read
release = _DEFAULT.release
