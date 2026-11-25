"""Per-key locks shared by the callers currently using or waiting for them."""
import threading
import weakref


class KeyedLocks:
    def __init__(self, factory=threading.Lock):
        self._factory = factory
        self._guard = threading.Lock()
        self._locks = weakref.WeakValueDictionary()

    def __call__(self, key):
        with self._guard:
            lock = self._locks.get(key)
            if lock is None:
                lock = self._locks[key] = self._factory()
            return lock
