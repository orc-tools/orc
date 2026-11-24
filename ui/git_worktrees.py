"""The checkouts git lists for a repository, for the Servers page."""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import subprocess
import threading

# A repo's list is kept while its git metadata looks unchanged, so a Servers
# poll across many projects stats files instead of running git per project.
_CACHE = {}
_CACHE_LOCK = threading.Lock()
_CACHE_MAX = 512
_WORKERS = 8


def command(argv):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=3,
                            env={**os.environ, 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0'})
    if result.returncode:
        raise ValueError('%s failed' % Path(argv[0]).name)
    return result.stdout


def checkouts(repo):
    """Every checkout git lists for `repo`, main first, as {path, branch}."""
    try:
        output = command(['git', '-C', repo, 'worktree', 'list', '--porcelain', '-z'])
    except (OSError, ValueError, subprocess.TimeoutExpired):
        # Git before 2.36 has no -z; line output cannot carry newline paths.
        output = command(['git', '-C', repo, 'worktree', 'list', '--porcelain'])
        output = output.replace('\n', '\0')
    rows = []
    for record in output.split('\0\0'):
        fields = record.split('\0')
        path = next((field[9:] for field in fields if field.startswith('worktree ')), None)
        if path:
            branch = next((field[7:] for field in fields if field.startswith('branch ')), '')
            rows.append({'path': path, 'branch': branch.removeprefix('refs/heads/') or 'Detached HEAD'})
    return rows


def _stamp(path):
    try:
        info = os.stat(path)
    except FileNotFoundError:
        return None
    return info.st_mtime_ns, info.st_size, info.st_ino


def fingerprint(repo):
    """What `git worktree list` reads for a main checkout: its HEAD, and each
    linked tree's HEAD and gitdir pointer. Git replaces these files on every
    change (adding, removing, moving a tree or switching its branch), so an
    equal fingerprint means an equal list. None when `repo` has no .git
    folder of its own (a linked worktree or bare repo), which is never kept."""
    git = os.path.join(repo, '.git')
    if not os.path.isdir(git):
        return None
    parts = [_stamp(os.path.join(git, 'HEAD')), _stamp(os.path.join(git, 'worktrees'))]
    try:
        with os.scandir(os.path.join(git, 'worktrees')) as entries:
            names = sorted(entry.name for entry in entries)
    except FileNotFoundError:
        names = []
    for name in names:
        base = os.path.join(git, 'worktrees', name)
        parts.append((name, _stamp(os.path.join(base, 'HEAD')),
                      _stamp(os.path.join(base, 'gitdir'))))
    return tuple(parts)


def cached_checkouts(repo):
    """`checkouts(repo)`, reused while the repo's fingerprint is unchanged.
    Raises what `checkouts` raises; a failure is never kept."""
    try:
        key = fingerprint(repo)
    except OSError:
        key = None
    if key is not None:
        with _CACHE_LOCK:
            hit = _CACHE.get(repo)
        if hit is not None and hit[0] == key:
            return hit[1]
    rows = checkouts(repo)
    if key is not None:
        with _CACHE_LOCK:
            if len(_CACHE) >= _CACHE_MAX:
                _CACHE.clear()
            _CACHE[repo] = (key, rows)
    return rows


def many_checkouts(repos):
    """{repo: rows, or None when git could not list it}, asking git for the
    repos that changed side by side rather than one after another."""
    def one(repo):
        try:
            return cached_checkouts(repo)
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return None

    repos = list(dict.fromkeys(repos))
    if len(repos) < 2:
        return {repo: one(repo) for repo in repos}
    with ThreadPoolExecutor(max_workers=min(_WORKERS, len(repos))) as pool:
        return dict(zip(repos, pool.map(one, repos)))
