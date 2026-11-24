"""GitHub repos for Add project: search the repos the gh CLI's account can
reach, and clone one beside the user's other projects. Every call goes through
gh, so Orc holds no GitHub token of its own."""
import collections
import json
import os
import re
import subprocess
import threading
import time

from settings_backup import gh_path

ACCOUNT_TTL = 300
SIGNED_OUT_TTL = 20
REPOS_TTL = 300
ORIGIN_TTL = 60
LIST_TIMEOUT = 60
CLONE_TIMEOUT = 900
SEARCH_LIMIT = 20
# Fewer projects than this under one folder says too little about where the
# user keeps them, so Add project asks instead.
SHARED_PARENT_MIN = 2

_REPO = re.compile(
    r'(?:(?:https?://|ssh://git@)github\.com/|git@github\.com:)?'
    r'([A-Za-z0-9][A-Za-z0-9-]*)/([A-Za-z0-9_.][A-Za-z0-9_.-]*?)(?:\.git)?/?',
    re.IGNORECASE)
_LOCK = threading.Lock()
_ACCOUNT = (0.0, None)
_REPOS = (0.0, None)
_ORIGINS = {}


class GithubError(RuntimeError):
    pass


class NotFound(GithubError):
    pass


def repo_name(text):
    """owner/name from that form or from a GitHub URL, else None."""
    match = _REPO.fullmatch(text.strip()) if isinstance(text, str) else None
    if not match or match.group(2) in ('.', '..'):
        return None
    return '%s/%s' % match.groups()


def _gh(*args, timeout=LIST_TIMEOUT):
    gh = gh_path()
    if not gh:
        raise GithubError('The gh CLI is not installed. Install it from https://cli.github.com.')
    env = dict(os.environ, GH_PROMPT_DISABLED='1', GH_NO_UPDATE_NOTIFIER='1', GIT_TERMINAL_PROMPT='0')
    try:
        result = subprocess.run([gh, *args], capture_output=True, text=True, env=env,
                                stdin=subprocess.DEVNULL, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        raise GithubError('GitHub did not answer within %d seconds' % timeout) from error
    except OSError as error:
        raise GithubError('could not run gh: %s' % error) from error
    if result.returncode:
        detail = (result.stderr.strip() or result.stdout.strip()).splitlines()
        message = detail[-1] if detail else 'gh exited with %d' % result.returncode
        raise (NotFound if 'HTTP 404' in result.stderr else GithubError)(message)
    return result.stdout


def account():
    """The GitHub login gh is signed in as, or None. A sign-in made after the
    last look shows up within SIGNED_OUT_TTL seconds."""
    global _ACCOUNT
    checked, login = _ACCOUNT
    if time.monotonic() - checked < (ACCOUNT_TTL if login else SIGNED_OUT_TTL) and checked:
        return login
    try:
        login = _gh('api', 'user', '--jq', '.login', timeout=15).strip() or None
    except GithubError:
        login = None
    _ACCOUNT = (time.monotonic(), login)
    return login


def _row(line):
    name, description, private = json.loads(line)
    return {'name': name, 'description': description or '', 'private': bool(private)}


_ROW_JQ = '[.full_name, .description, .private] | @json'


def _all_repos():
    """Every repo the account owns, collaborates on or reaches through an
    organisation, most recently pushed first."""
    global _REPOS
    with _LOCK:
        fetched, repos = _REPOS
        if repos is None or time.monotonic() - fetched >= REPOS_TTL:
            out = _gh('api', '--paginate', 'user/repos?per_page=100&sort=pushed', '--jq', '.[] | ' + _ROW_JQ)
            repos = [_row(line) for line in out.splitlines() if line.strip()]
            _REPOS = (time.monotonic(), repos)
        return repos


def warm():
    """Fetch the repo list in the background, so opening Add project does not
    wait on it and the first search finds it ready."""
    def fetch():
        try:
            _all_repos()
        except GithubError:
            pass
    threading.Thread(target=fetch, name='github-repos-warm', daemon=True).start()


def search(query, limit=SEARCH_LIMIT):
    """The account's repos whose name holds every word of query, best match
    first. A full owner/name or GitHub URL also finds a repo outside them."""
    words = query.lower().split()
    named = repo_name(query)
    if named:
        words = [named.lower()]
    found = []
    for index, repo in enumerate(_all_repos()):
        full = repo['name'].lower()
        if all(word in full for word in words):
            short = full.partition('/')[2]
            first = words[0] if words else ''
            rank = 0 if full == first or short == first else 1 if short.startswith(first) else 2
            found.append((rank, index, repo))
    found.sort(key=lambda item: item[:2])
    repos = [dict(repo) for _rank, _index, repo in found[:limit]]
    if named and not any(repo['name'].lower() == named.lower() for repo in repos):
        try:
            repos.insert(0, _row(_gh('api', 'repos/' + named, '--jq', _ROW_JQ, timeout=15)))
        except GithubError:
            pass
    return repos


def clone_dir(projects, saved=None):
    """The ~-form folder new clones go in: the one the user chose before, else
    the folder that holds more of their projects than any other. None when
    neither says, so the caller asks."""
    if isinstance(saved, str) and saved.strip() and os.path.isdir(os.path.expanduser(saved)):
        return saved
    parents = collections.Counter(
        os.path.dirname(project.rstrip('/')) for project in projects
        if os.path.isdir(os.path.expanduser(project)))
    ranked = parents.most_common(2)
    if not ranked or ranked[0][1] < SHARED_PARENT_MIN or not ranked[0][0]:
        return None
    if len(ranked) > 1 and ranked[1][1] == ranked[0][1]:
        return None
    return ranked[0][0]


def origin(path):
    """The lowercased owner/name a folder's origin remote points at on GitHub,
    or None."""
    now = time.monotonic()
    hit = _ORIGINS.get(path)
    if hit and now - hit[0] < ORIGIN_TTL:
        return hit[1]
    try:
        url = subprocess.run(['git', '-C', path, 'config', '--get', 'remote.origin.url'],
                             capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        url = ''
    name = repo_name(url) if 'github.com' in url.lower() else None
    name = name.lower() if name else None
    _ORIGINS[path] = (now, name)
    return name


def local_projects(projects):
    """{lowercased owner/name: project} for the projects cloned from GitHub."""
    local = {}
    for project in projects:
        path = os.path.expanduser(project)
        name = origin(path) if os.path.isdir(path) else None
        if name:
            local.setdefault(name, project)
    return local


def clone(name, directory):
    """Clones owner/name into its own folder under directory. Returns (path,
    cloned); cloned is False when that folder already held a clone of it."""
    path = os.path.join(directory, name.partition('/')[2])
    if os.path.lexists(path):
        _ORIGINS.pop(path, None)
        if origin(path) == name.lower():
            return path, False
        raise GithubError('%s already exists and is not a clone of %s' % (path, name))
    _gh('repo', 'clone', name, path, timeout=CLONE_TIMEOUT)
    return path, True
