"""Disk-backed cache of pre-closing-pass settled finished run rows.

Every server restart used to walk every run directory (~4,700 folders) before
building the first run list. Keeping settled, finished runs in SQLite lets a
restarted server hydrate those rows from one sequential read and rebuild only
live runs and finished runs whose files or external inputs changed.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
from pathlib import Path
import sqlite3
import threading

SCHEMA_VERSION = 1

_WRITE_LOCK = threading.Lock()
_DELETE_CHUNK = 500


def row_digest(row_bytes: bytes) -> bytes:
    """Compact digest of serialized row JSON for change detection."""
    return hashlib.blake2b(row_bytes, digest_size=16).digest()


def _unlink_corrupt(path: str) -> None:
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(path + suffix)
        except OSError:
            pass


def _connect_readonly(path: str) -> sqlite3.Connection | None:
    if not os.path.exists(path):
        return None
    uri = Path(os.path.abspath(path)).as_uri() + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=1.0)
    conn.execute("PRAGMA busy_timeout=1000")
    return conn


def _connect_writable(path: str) -> sqlite3.Connection:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, mode=0o700, exist_ok=True)
    existed = os.path.exists(path)
    conn = sqlite3.connect(path, timeout=1.0)
    try:
        if not existed:
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
        conn.execute("PRAGMA busy_timeout=1000")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA temp_store=MEMORY")
        with conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS cache_meta ("
                "key TEXT PRIMARY KEY, "
                "value TEXT NOT NULL)"
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS settled_rows ("
                "run_id TEXT PRIMARY KEY, "
                "key_hash TEXT NOT NULL, "
                "row_json BLOB NOT NULL)"
            )
            row = conn.execute(
                "SELECT value FROM cache_meta WHERE key = 'schema_version'"
            ).fetchone()
            if row is None or row[0] != str(SCHEMA_VERSION):
                conn.execute("DELETE FROM settled_rows")
                conn.execute(
                    "INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schema_version', ?)",
                    (str(SCHEMA_VERSION),),
                )
    except BaseException:
        conn.close()
        raise
    return conn


def load(path: str, *, repair: bool = False) -> dict[str, tuple[str, bytes]]:
    """Return {run_id: (key_hash, row_json_bytes)} from `path`, or {}."""
    try:
        conn = _connect_readonly(path)
    except sqlite3.DatabaseError:
        if repair:
            _unlink_corrupt(path)
        return {}
    except (OSError, sqlite3.Error):
        return {}
    if conn is None:
        return {}
    try:
        with contextlib.closing(conn):
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' "
                    "AND name IN ('cache_meta', 'settled_rows')"
                )
            }
            if tables != {"cache_meta", "settled_rows"}:
                return {}
            version_row = conn.execute(
                "SELECT value FROM cache_meta WHERE key = 'schema_version'"
            ).fetchone()
            if version_row is None or version_row[0] != str(SCHEMA_VERSION):
                return {}
            return {
                run_id: (key_hash, bytes(row_json))
                for run_id, key_hash, row_json in conn.execute(
                    "SELECT run_id, key_hash, row_json FROM settled_rows"
                )
            }
    except sqlite3.DatabaseError:
        if repair:
            _unlink_corrupt(path)
        return {}
    except (OSError, sqlite3.Error):
        return {}


def _write_batch(
    path: str,
    upserts: list[tuple[str, str, bytes]],
    deletes: list[str],
) -> None:
    conn = _connect_writable(path)
    with contextlib.closing(conn), conn:
        if upserts:
            conn.executemany(
                "INSERT OR REPLACE INTO settled_rows (run_id, key_hash, row_json) "
                "VALUES (?, ?, ?)",
                upserts,
            )
        for index in range(0, len(deletes), _DELETE_CHUNK):
            batch = deletes[index:index + _DELETE_CHUNK]
            placeholders = ",".join("?" for _ in batch)
            conn.execute(
                f"DELETE FROM settled_rows WHERE run_id IN ({placeholders})",
                batch,
            )


def sync(
    path: str,
    upserts: list[tuple[str, str, bytes]],
    deletes: list[str],
) -> bool:
    """Persist upserts and deletes in one transaction; return True on success."""
    if not upserts and not deletes:
        return True
    with _WRITE_LOCK:
        for attempt in range(2):
            try:
                _write_batch(path, upserts, deletes)
                return True
            except sqlite3.DatabaseError:
                if attempt == 0:
                    _unlink_corrupt(path)
                    continue
                return False
            except (OSError, sqlite3.Error):
                return False
    return False
