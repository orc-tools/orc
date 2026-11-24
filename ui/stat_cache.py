"""Text of small files that hot loops reread, revalidated by one stat."""
import os
import threading


def file_key(path):
    """Changes whenever the file is written, replaced or removed. Taken before
    a read, so a write that lands during the read leaves a key that no longer
    matches. ctime is in it because a writer can restore mtime (cp -p,
    rsync -t) but not ctime. Raises OSError when the file cannot be stat'ed."""
    st = os.stat(path)
    return st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns


class TextCache:
    """A hit costs one stat instead of an open, a read and a close."""

    def __init__(self, limit=16384):
        self._limit = limit
        self._entries = {}
        self._lock = threading.Lock()

    def read(self, path):
        """What ``open(path).read()`` returns, raising what it raises."""
        key = file_key(path)
        with self._lock:
            hit = self._entries.get(path)
        if hit is not None and hit[0] == key:
            return hit[1]
        with open(path) as handle:
            text = handle.read()
        with self._lock:
            if len(self._entries) >= self._limit:
                self._entries.clear()  # unbounded input, bounded memory
            self._entries[path] = (key, text)
        return text


# Run metadata and launch identities: every run-list scan and watcher tick
# reads one of each per run, and nearly all of them are unchanged since the
# last read.
RUN_FILES = TextCache()
