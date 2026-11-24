"""orc-ui: what a demo instance does differently from a real one.

bin/orc-demo serves Orc against a throwaway home filled with a fictional park's
runs. ORC_UI_INSTANCE_KIND=demo names that server, and ORC_UI_DEMO names the
JSON file its seed wrote:

  id            new for every demo, so a browser starts each one clean
  storage       the localStorage a page starts with, such as the radio left on
  fixtures      {"GET /api/link": {...}}: answers for the services a demo has
                no account for (provider usage, linked laptops, GitHub)
  mergeSeconds  how long a queued merge waits before git merges it, so the
                queue is seen working
  usage         what the usage Worker would answer for GET /api/usage

Everything else is the real server over real files, so a demo merges, settles
and searches exactly as Orc does.
"""
import json
import os

KIND = "demo"
MAX_MERGE_SECONDS = 120


def _read(path):
    try:
        with open(path) as handle:
            state = json.load(handle)
    except (OSError, ValueError, TypeError):
        return {}
    return state if isinstance(state, dict) else {}


class Demo:
    def __init__(self, kind=None, path=None):
        self.active = kind == KIND
        self._state = _read(path) if self.active and path else {}

    def fixture(self, method, path):
        """The JSON body a demo answers this request with, or None to let the
        real handler answer."""
        fixtures = self._state.get("fixtures")
        if not isinstance(fixtures, dict):
            return None
        body = fixtures.get("%s %s" % (method, path))
        return None if body is None else json.dumps(body).encode()

    def browser(self):
        """What the page needs before first paint, or None outside a demo."""
        if not self.active:
            return None
        storage = self._state.get("storage")
        return {
            "id": str(self._state.get("id") or "demo"),
            "storage": {key: value for key, value in (storage if isinstance(storage, dict) else {}).items()
                        if isinstance(key, str) and isinstance(value, str)},
        }

    def usage_answer(self):
        answer = self._state.get("usage")
        return answer if isinstance(answer, dict) else None

    def merge_wait(self):
        seconds = self._state.get("mergeSeconds")
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)):
            return 0.0
        return float(min(max(seconds, 0), MAX_MERGE_SECONDS))


CURRENT = Demo(os.environ.get("ORC_UI_INSTANCE_KIND"), os.environ.get("ORC_UI_DEMO"))
