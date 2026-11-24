"""GitHub's emoji names, so `:tada:` in a PR review card shows what GitHub
will post. The list comes from GitHub's emoji API through gh, once, and is
kept on this machine. Until that works, a snapshot of GitHub's Unicode names
(github_emoji_unicode.json) stands in, and GitHub-only pictures such as
`:shipit:` stay as text."""
import json
import os
import re
import subprocess
import threading
import time

from settings_backup import gh_path

FALLBACK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "github_emoji_unicode.json")
FETCH_TIMEOUT = 15
# A cached list older than this is fetched again; a failed fetch keeps it.
REFRESH_AFTER = 30 * 24 * 3600
# After a failed fetch, wait this long before running gh again.
RETRY_AFTER = 600

_NAME = re.compile(r"[A-Za-z0-9_+-]{1,64}")
_IMAGE = re.compile(r"https://github\.githubassets\.com/images/icons/emoji/([A-Za-z0-9_+-]+|unicode/[0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*)\.png(?:\?v\d+)?")
_LOCK = threading.Lock()
_STATE = {"path": None, "table": None, "failedAt": 0.0}


def char(codepoints):
    """The emoji for GitHub's unicode file name, such as 1f389 or 0031-20e3.
    GitHub's names leave out the emoji-style selector, so a lone code point
    from the older text-symbol ranges (❤ 2764, © 00a9) and a keycap get it
    back, or they draw as plain text glyphs."""
    points = [int(part, 16) for part in codepoints.split("-")]
    if len(points) == 1 and points[0] < 0x1F000:
        points.append(0xFE0F)
    elif len(points) == 2 and points[1] == 0x20E3:
        points.insert(1, 0xFE0F)
    return "".join(map(chr, points))


def parse(raw):
    """Splits GitHub's {name: image URL} into Unicode emoji and GitHub's own
    pictures. Anything that is not a GitHub emoji image is dropped, so the
    page only ever loads pictures from GitHub's asset host."""
    unicode, custom = {}, {}
    if not isinstance(raw, dict):
        return unicode, custom
    for name, url in raw.items():
        if not isinstance(name, str) or not isinstance(url, str) or not _NAME.fullmatch(name):
            continue
        match = _IMAGE.fullmatch(url)
        if not match:
            continue
        if match.group(1).startswith("unicode/"):
            unicode[name] = char(match.group(1)[len("unicode/"):])
        else:
            custom[name] = url
    return unicode, custom


def fallback():
    with open(FALLBACK_PATH, encoding="utf-8") as handle:
        return {name: char(points) for name, points in json.load(handle).items()}


def _fetch():
    gh = gh_path()
    if not gh:
        return None
    env = dict(os.environ, GH_PROMPT_DISABLED="1", GH_NO_UPDATE_NOTIFIER="1")
    try:
        result = subprocess.run([gh, "api", "emojis"], capture_output=True, text=True, env=env,
                                stdin=subprocess.DEVNULL, timeout=FETCH_TIMEOUT)
        raw = json.loads(result.stdout) if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None
    return raw if parse(raw)[0] else None


def _read_cache(path):
    try:
        with open(path, encoding="utf-8") as handle:
            raw = json.load(handle)
        return raw, os.path.getmtime(path)
    except (OSError, ValueError):
        return None, 0.0


def _write_cache(path, raw):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp = "%s.%d.tmp" % (path, os.getpid())
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(raw, handle, separators=(",", ":"), sort_keys=True)
    os.replace(temp, path)


def table(cache_path, fetch=_fetch, now=time.time):
    """{"unicode": {name: emoji}, "custom": {name: image URL}, "source":
    "github" or "fallback"} for the emoji suggestions and saved text."""
    with _LOCK:
        if _STATE["path"] != cache_path:
            _STATE.update(path=cache_path, table=None, failedAt=0.0)
        cached = _STATE["table"]
        fresh = cached and cached["source"] == "github" and now() - cached["fetchedAt"] < REFRESH_AFTER
        if cached and (fresh or now() - _STATE["failedAt"] < RETRY_AFTER):
            return cached
        raw, fetched_at = _read_cache(cache_path)
        unicode, custom = parse(raw)
        fresh = bool(unicode) and now() - fetched_at < REFRESH_AFTER
        if not fresh and now() - _STATE["failedAt"] >= RETRY_AFTER:
            got = fetch()
            if got:
                try:
                    _write_cache(cache_path, got)
                except OSError:
                    pass
                unicode, custom = parse(got)
                fetched_at = now()
            else:
                _STATE["failedAt"] = now()
        if unicode:
            result = {"unicode": unicode, "custom": custom, "source": "github", "fetchedAt": fetched_at}
        else:
            result = {"unicode": fallback(), "custom": {}, "source": "fallback", "fetchedAt": 0.0}
        _STATE["table"] = result
        return result
