"""Incremental JSON delta history and patch helper for /api/runs parts.

Tracks per-row encoded JSON chunks across recent ETags for each run-list part
("live" and "settled") so polling clients can download only added/changed rows
and removed run IDs instead of re-fetching the entire list on every change.

stdlib-only, like the rest of ui/.
"""

from collections import OrderedDict
import json
import threading

DELTA_BASE_HEADER = "X-Orc-Runs-Delta-Base"
DELTA_RESPONSE_HEADER = "X-Orc-Runs-Delta"
DEFAULT_MAX_ETAGS = 128


class PartDeltaHistory:
    """Bounded per-part revision log mapping recent ETags to row-level diffs."""

    def __init__(self, max_etags=DEFAULT_MAX_ETAGS):
        self._lock = threading.Lock()
        self._max_etags = max(1, int(max_etags))
        self._rev = 0
        self._current_etag = None
        self._rows = {}
        self._etag_to_rev = OrderedDict()
        self._removed = {}

    def clear(self):
        with self._lock:
            self._rev = 0
            self._current_etag = None
            self._rows.clear()
            self._etag_to_rev.clear()
            self._removed.clear()

    def record(self, etag, row_chunks):
        """Record a snapshot of `(run_id, json_chunk_bytes)` pairs for `etag`."""
        with self._lock:
            if etag == self._current_etag:
                return
            self._rev += 1
            rev = self._rev
            seen = set()
            for run_id, chunk in row_chunks:
                seen.add(run_id)
                prev = self._rows.get(run_id)
                if prev is not None and (prev[1] is chunk or prev[1] == chunk):
                    continue
                self._rows[run_id] = (rev, chunk)
                self._removed.pop(run_id, None)
            for rid in [rid for rid in self._rows if rid not in seen]:
                del self._rows[rid]
                self._removed[rid] = rev
            self._current_etag = etag
            self._etag_to_rev[etag] = rev
            self._etag_to_rev.move_to_end(etag)
            while len(self._etag_to_rev) > self._max_etags:
                self._etag_to_rev.popitem(last=False)
            if self._etag_to_rev:
                min_rev = next(iter(self._etag_to_rev.values()))
                self._removed = {
                    rid: rem_rev for rid, rem_rev in self._removed.items()
                    if rem_rev > min_rev
                }

    def delta_for(self, base_etag, current_etag, full_len=None):
        """Return compact JSON delta bytes from `base_etag` to `current_etag`,
        or None when the base ETag is unknown, stale, or not smaller than `full_len`."""
        if not base_etag:
            return None
        with self._lock:
            if self._current_etag != current_etag:
                return None
            base_rev = self._etag_to_rev.get(base_etag)
            if base_rev is None:
                return None
            upserted = [
                chunk for row_rev, chunk in self._rows.values()
                if row_rev > base_rev
            ]
            removed = [
                rid for rid, rem_rev in self._removed.items()
                if rem_rev > base_rev
            ]
        body = (
            b'{"base":' + json.dumps(base_etag, separators=(",", ":")).encode()
            + b',"upserted":[' + b",".join(upserted) + b']'
            + b',"removed":' + json.dumps(removed, separators=(",", ":")).encode()
            + b"}"
        )
        if full_len is not None and len(body) >= full_len:
            return None
        return body


def apply_delta_bytes(base_body, delta_body, base_etag):
    """Apply a JSON delta payload onto a cached full-part JSON array.

    Returns compact JSON bytes for the merged list sorted newest-first, or None
    if either payload is malformed or `delta["base"]` does not match `base_etag`.
    """
    try:
        base_rows = json.loads(base_body)
        delta = json.loads(delta_body)
    except (ValueError, TypeError):
        return None
    if (not isinstance(base_rows, list)
            or not isinstance(delta, dict)
            or not base_etag
            or delta.get("base") != base_etag
            or not isinstance(delta.get("upserted"), list)
            or not isinstance(delta.get("removed"), list)):
        return None
    by_id = {}
    for row in base_rows:
        if isinstance(row, dict) and isinstance(row.get("id"), str):
            by_id[row["id"]] = row
    for rid in delta["removed"]:
        if isinstance(rid, str):
            by_id.pop(rid, None)
    for row in delta["upserted"]:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str):
            return None
        by_id[row["id"]] = row
    merged = sorted(by_id.values(), key=lambda r: r.get("mtime") or 0, reverse=True)
    return json.dumps(merged, separators=(",", ":")).encode()
