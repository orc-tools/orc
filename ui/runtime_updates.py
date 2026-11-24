"""Track and retry primary-checkout desktop promotions independently of Git."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import time


INSTALL_INPUTS = (
    'install.sh', 'bin', 'app', 'app-plugins', 'private', 'hooks', 'ui', 'skills', 'agents',
    'codex/agents', 'assets',
    'config.template.json', '.gitattributes',
)
# The background retry waits RETRY_SECONDS after a failed install, doubling
# with each failure of the same commit up to RETRY_MAX_SECONDS. Every attempt
# restarts the viewer and a failed one restarts it again on the old release,
# so a failure that repeats must not keep doing that every few minutes. A new
# commit starts the count over.
RETRY_SECONDS = 300
RETRY_MAX_SECONDS = 3600
FETCH_SECONDS = 20
# How often a running public install asks its source for a new release.
RELEASE_CHECK_SECONDS = 3600
LOCK_WAIT_SECONDS = 300
INSTALL_TRAILER = re.compile(r'ERROR: \S+ failed at line \d+')


def git_env():
    env = dict(os.environ)
    for key in ('GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE',
                'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'):
        env.pop(key, None)
    return env


def git(repo, *args):
    result = subprocess.run(['git', '-C', str(repo), *args], env=git_env(),
                            capture_output=True, text=True, timeout=10)
    return result.stdout.strip() if result.returncode == 0 else ''


def runtime_home():
    return Path(os.environ.get('ORC_HOME', Path.home() / '.orc')) / 'runtime'


def read_state():
    try:
        value = json.loads((runtime_home() / 'update.json').read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def write_state(value):
    write_json(runtime_home() / 'update.json', value)


def installed_commit():
    current = runtime_home() / 'current'
    return current.resolve().name if current.is_symlink() and current.exists() else ''


def runtime_ref(repo):
    return os.environ.get('ORC_RUNTIME_REF') or git(repo, 'config', '--get', 'orc.runtimeRef') or 'refs/heads/main'


def is_ancestor(repo, old, new):
    return subprocess.run(['git', '-C', str(repo), 'merge-base', '--is-ancestor', old, new],
                          env=git_env(), capture_output=True).returncode == 0


def has_commit(repo, commit):
    return bool(commit and git(repo, 'rev-parse', '--verify', commit + '^{commit}'))


def peer_version_status(repo, ours, theirs):
    if not ours or not theirs:
        return 'unknown'
    if ours == theirs:
        return 'current'
    if has_commit(repo, ours) and has_commit(repo, theirs):
        if is_ancestor(repo, ours, theirs):
            return 'behind'
        if is_ancestor(repo, theirs, ours):
            return 'ahead'
    return 'different'


# (repo, old, new) -> answer. Two commits' trees never change, and each open
# viewer asks orc-ui for the same pair every 15s: four git processes a time.
_INPUTS_DIFFER = {}


def inputs_differ(repo, old, new):
    key = (str(repo), old, new)
    known = _INPUTS_DIFFER.get(key)  # one lookup: another thread may clear()
    if known is not None:
        return known
    if not has_commit(repo, old) or not has_commit(repo, new):
        return True
    before = git(repo, 'ls-tree', old, '--', *INSTALL_INPUTS)
    after = git(repo, 'ls-tree', new, '--', *INSTALL_INPUTS)
    # git() reads a failure as empty output, which must not be remembered
    if before and after:
        if len(_INPUTS_DIFFER) >= 64:
            _INPUTS_DIFFER.clear()
        _INPUTS_DIFFER[key] = before != after
    return before != after


def status(repo):
    repo = Path(repo).expanduser().resolve()
    common = git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    primary = Path(common).parent.resolve() if common else None
    ref = runtime_ref(repo)
    desired = git(repo, 'rev-parse', '--verify', ref + '^{commit}') if primary else ''
    installed = installed_commit()
    prior = read_state()
    if prior.get('repo') != str(repo):
        prior = {}
    result = {'repo': str(repo), 'desiredCommit': desired,
              'installedCommit': installed, 'state': 'unknown', 'reason': '',
              'recovery': shlex.join([str(repo / 'install.sh'), '--skip-health-checks'])}
    if not primary or primary != repo or not desired:
        result['reason'] = 'Updates require the primary checkout and its configured runtime ref.'
        return result
    # A failed installer may already have switched current before rolling back.
    # Only its final success marker settles that attempt, not the pointer alone.
    branch = ref[len('refs/heads/'):] if ref.startswith('refs/heads/') else ''
    upstream = git(repo, 'rev-parse', '--verify', f'{branch}@{{upstream}}') if branch else ''
    if (prior.get('state') == 'refused'
            and prior.get('desiredCommit') in (desired, upstream)
            and prior.get('desiredCommit') != installed):
        result.update(
            state='refused',
            desiredCommit=prior['desiredCommit'],
            reason=prior.get('reason') or 'Update refused: commit signature could not be verified.',
            recovery='',
        )
        if 'attemptedAt' in prior:
            result['attemptedAt'] = prior['attemptedAt']
        return result
    outstanding = prior.get('state') in ('pending', 'installing', 'failed', 'blocked')
    if installed and not inputs_differ(repo, installed, desired) and not outstanding:
        result['state'] = 'current'
    elif installed or outstanding:
        result['state'] = 'pending'
        result['reason'] = 'Committed updates have not finished installing.'
        if prior.get('desiredCommit') == desired and outstanding:
            result.update({key: prior[key] for key in ('state', 'reason', 'attemptedAt', 'failures')
                           if key in prior})
    else:
        result['reason'] = 'No managed desktop release is installed.'
    return result


def uncommitted(repo):
    """The paths ``git status`` lists, untracked folders as one entry."""
    # git() strips the output, and with it the first line's blank status column
    listed = git(repo, 'status', '--porcelain', '--untracked-files=normal')
    return [line.split(None, 1)[1] for line in listed.splitlines() if len(line.split(None, 1)) == 2]


def eligible(repo, desired):
    if git(repo, 'rev-parse', 'HEAD') != desired:
        return 'The primary checkout is not on the configured runtime commit.'
    if uncommitted(repo):
        return 'The primary checkout has uncommitted changes. Commit or stash them to allow the update.'
    return ''


def take_lock(lock, wait):
    """The holder installs only the head it read before taking the lock, so a
    hook that skipped while it ran would leave its own newer head uninstalled
    with nothing left to retry. Hooks wait and then re-read status; the
    background retry still yields to whoever holds the lock."""
    deadline = time.monotonic() + (LOCK_WAIT_SECONDS if wait else 0)
    announced = False
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            if time.monotonic() >= deadline:
                return False
            if not announced:
                print('orc: waiting for another desktop update to finish', flush=True)
                announced = True
            time.sleep(0.2)


def check(repo, old='', retry=False):
    repo = Path(repo).expanduser().resolve()
    common = git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    if not common:
        return 0
    if Path(common).parent.resolve() != repo:
        print('orc: install-relevant worktree changes detected — default runtime unchanged')
        print(f'orc: preview with: orc-ui preview "{repo}"')
        return 0
    home = runtime_home()
    home.mkdir(parents=True, exist_ok=True)
    with (home / 'update.lock').open('a') as lock:
        if not take_lock(lock, wait=not retry):
            if retry:
                return 0
            print(f'orc: another desktop update is still running after {LOCK_WAIT_SECONDS}s; '
                  'retry with: ' + status(repo)['recovery'], file=sys.stderr)
            return 1
        reason = distribution_source_error(repo)
        if reason:
            print('orc: ' + reason, file=sys.stderr)
            return 1
        current = status(repo)
        if current['state'] == 'refused':
            print('orc: ' + current['reason'], file=sys.stderr)
            return 1
        desired = current['desiredCommit']
        if not desired:
            return 0
        sig_error = release_signature_error(repo, desired)
        if sig_error:
            record_refused(repo, desired, sig_error)
            print('orc: ' + sig_error, file=sys.stderr)
            return 1
        if current['state'] == 'current':
            return 0
        needs_update = current['state'] in ('pending', 'installing', 'failed', 'blocked')
        if not needs_update and (retry or not inputs_differ(repo, old, desired)):
            return 0
        reason = eligible(repo, desired)
        if reason:
            # The block lasts until an update gets through, however far main
            # moves meanwhile; the assistant says it once per block.
            prior = read_state()
            since = prior.get('blockedSince') if prior.get('state') == 'blocked' else None
            current.update(state='blocked', reason=reason, paths=uncommitted(repo)[:20],
                           blockedSince=since if isinstance(since, (int, float)) else time.time())
            write_state(current)
            print('orc: desktop update pending: ' + reason, file=sys.stderr)
            return 1
        if retry and not retry_due(current, time.time()):
            return 0
        current.update(state='installing', reason='Installing the committed update.', attemptedAt=time.time())
        write_state(current)
        print('orc: install-relevant primary changes detected — promoting desktop runtime', flush=True)
        # The daemon can restart during installation. A detached retry process
        # and a file-backed log survive its parent server exiting.
        with (home / 'update.log').open('w+b') as log:
            try:
                # A hook's GIT_INDEX_FILE would otherwise reach the restarted daemon.
                # ORC_INSTALL_AUTOMATIC keeps Orc.app running unless its binary changed.
                result = subprocess.run([str(repo / 'install.sh'), '--skip-health-checks'],
                                        cwd=repo, env={**git_env(), 'ORC_INSTALL_AUTOMATIC': '1'},
                                        stdout=log, stderr=subprocess.STDOUT)
                code = result.returncode
            except OSError as error:
                log.write(str(error).encode())
                code = 1
            log.seek(0, os.SEEK_END)
            log.seek(max(0, log.tell() - 8192))
            detail = log.read().decode('utf-8', errors='replace').strip()
        current['installedCommit'] = installed_commit()
        if not code and current['installedCommit'] != desired:
            code = 1
            detail = 'Installer exited successfully without selecting the desired desktop release.'
        if code:
            # install.sh's ERR trap ends every failure with a generic "failed at
            # line" ERROR; the line before it says what actually went wrong.
            errors = [line.strip() for line in detail.splitlines() if 'ERROR:' in line]
            errors = [line for line in errors if not INSTALL_TRAILER.search(line)] or errors
            current.update(state='failed', reason=(errors[-1] if errors else detail[-1200:]) or f'Installer exited {code}.',
                           failures=failures(current) + 1)
            print('orc: merge/commit succeeded, but the desktop update failed: ' + current['reason'], file=sys.stderr)
            print('orc: retry with: ' + current['recovery'], file=sys.stderr)
        else:
            current.update(state='current', reason='')
            current.pop('failures', None)
        write_state(current)
        return code


def failures(state):
    count = state.get('failures')
    return count if type(count) is int and count > 0 else 0


def retry_due(state, now):
    """Whether the background retry may install again, given the status
    of the commit it would install."""
    wait = RETRY_SECONDS
    if state.get('state') == 'failed':
        wait = min(RETRY_SECONDS * 2 ** max(failures(state) - 1, 0), RETRY_MAX_SECONDS)
    return now - state.get('attemptedAt', 0) >= wait


def bare_url(url):
    return url.rstrip('/').removesuffix('.git')


def is_public_distribution(repo):
    return (runtime_home() / 'current/distribution.json').exists() or (Path(repo) / 'distribution.json').exists()


def record_refused(repo, target_commit, reason):
    write_state({
        'repo': str(Path(repo).expanduser().resolve()),
        'desiredCommit': target_commit,
        'installedCommit': installed_commit(),
        'state': 'refused',
        'reason': reason,
        'attemptedAt': time.time(),
        'recovery': '',
    })


def release_signature_error(repo, commit=None):
    """Verify ``commit`` against pinned SSH release keys for public installs.

    Returns '' for private development checkouts or valid signed public
    releases, else a plain-language reason why the update was refused.
    """
    repo = Path(repo).expanduser().resolve()
    if not is_public_distribution(repo):
        return ''
    ui_dir = str(Path(__file__).resolve().parent)
    if ui_dir not in sys.path:
        sys.path.insert(0, ui_dir)
    import release_signing
    target = commit or runtime_ref(repo)
    sha = git(repo, 'rev-parse', '--verify', str(target) + '^{commit}')
    if not sha:
        return 'Refused update: candidate commit could not be resolved.'
    installed_manifest = runtime_home() / 'current/distribution.json'
    try:
        candidate = release_signing.read_committed_manifest(repo, sha)
        if candidate.get('audience') != 'public':
            raise ValueError('candidate is not a public distribution')
        release_signing.manifest_signing_keys(candidate, required=True)
        if installed_manifest.exists():
            installed = json.loads(installed_manifest.read_text())
            if candidate.get('source') != installed.get('source'):
                return 'Candidate differs from the installed public distribution; refusing updates.'
        trusted_keys = release_signing.trusted_keys_for_public_repo(
            repo, installed_manifest if installed_manifest.exists() else None, sha)
    except (OSError, ValueError, KeyError, TypeError) as error:
        return f'Refused update {sha[:12]}: {error}.'
    verify_error = release_signing.verify_commit(repo, sha, trusted_keys)
    if verify_error:
        return f'Refused update {sha[:12]}: {verify_error}.'
    return ''


def distribution_source_error(repo, remote=None):
    installed_manifest = runtime_home() / 'current/distribution.json'
    manifest = Path(repo) / 'distribution.json'
    if not installed_manifest.exists() and not manifest.exists():
        return ''
    try:
        installed_source = json.loads(installed_manifest.read_text())['source'] if installed_manifest.exists() else None
        source = json.loads(manifest.read_text())['source']
        if not isinstance(source, str) or not source:
            raise ValueError('empty source')
        if installed_manifest.exists():
            if not isinstance(installed_source, str) or not installed_source:
                raise ValueError('empty installed source')
            committed = json.loads(git(repo, 'show', runtime_ref(repo) + ':distribution.json'))
            if source != installed_source or committed['source'] != installed_source:
                return 'Candidate differs from the installed public distribution; refusing updates.'
    except (OSError, ValueError, KeyError, TypeError):
        return 'Public distribution source is missing or invalid; refusing updates.'
    if remote is None:
        ref = runtime_ref(repo)
        remote = git(repo, 'config', '--get', f'branch.{ref.removeprefix("refs/heads/")}.remote')
    urls = git(repo, 'remote', 'get-url', '--all', remote).splitlines()
    push_urls = git(repo, 'remote', 'get-url', '--push', '--all', remote).splitlines()
    # GitHub serves the address with and without .git, and its page shows the latter.
    if [bare_url(url) for url in urls + push_urls] != [bare_url(source)] * 2:
        return 'Public distribution remote differs from its approved source; refusing network access.'
    return ''


def pull(repo):
    """Fast-forward the runtime branch to its upstream when no work can be lost.
    Returns why the branch stayed behind, or '' when nothing is left to pull."""
    ref = runtime_ref(repo)
    if not ref.startswith('refs/heads/'):
        return ''
    branch = ref[len('refs/heads/'):]
    remote = git(repo, 'config', '--get', f'branch.{branch}.remote')
    merge = git(repo, 'config', '--get', f'branch.{branch}.merge')
    if not remote or not merge:
        return ''
    source_error = distribution_source_error(repo, remote)
    if source_error:
        return source_error
    # A new session has no terminal to prompt on, so a fetch that needs a
    # password fails within the timeout instead of hanging the open.
    try:
        fetched = subprocess.run(['git', '-C', str(repo), 'fetch', '--quiet', remote, merge],
                                 env={**git_env(), 'GIT_TERMINAL_PROMPT': '0'},
                                 stdin=subprocess.DEVNULL, capture_output=True, text=True,
                                 timeout=FETCH_SECONDS, start_new_session=True)
    except subprocess.TimeoutExpired:
        return f'fetching {remote} took longer than {FETCH_SECONDS}s'
    if fetched.returncode:
        detail = fetched.stderr.strip().splitlines()
        return f'could not fetch {remote}' + (f' ({detail[-1]})' if detail else '')
    local = git(repo, 'rev-parse', '--verify', ref)
    upstream = git(repo, 'rev-parse', '--verify', f'{branch}@{{upstream}}')
    if not local or not upstream or local == upstream or is_ancestor(repo, upstream, local):
        prior = read_state()
        if (prior.get('state') == 'refused' and prior.get('repo') == str(Path(repo).expanduser().resolve())
                and local and installed_commit() == local):
            write_state({
                'repo': str(Path(repo).expanduser().resolve()),
                'desiredCommit': local,
                'installedCommit': local,
                'state': 'current',
                'reason': '',
            })
        return ''
    name = git(repo, 'rev-parse', '--abbrev-ref', f'{branch}@{{upstream}}') or upstream
    if not is_ancestor(repo, local, upstream):
        return f'{branch} has diverged from {name}'
    sig_error = release_signature_error(repo, upstream)
    if sig_error:
        record_refused(repo, upstream, sig_error)
        return sig_error
    if git(repo, 'symbolic-ref', '-q', 'HEAD') != ref:
        return f'{name} has new commits, but {repo} is not on {branch}'
    if git(repo, 'status', '--porcelain', '--untracked-files=normal'):
        return f'{name} has new commits, but {repo} has uncommitted changes'
    # post-merge runs the reinstall hook, which promotes the new head itself.
    merged = subprocess.run(['git', '-C', str(repo), 'merge', '--ff-only', '--quiet', upstream],
                            env=git_env(), stdin=subprocess.DEVNULL)
    return f'could not fast-forward {branch} to {name}' if merged.returncode else ''


def release_check_due(repo, now):
    """Whether a public install should look for a release again. Opening
    Orc.app only starts the viewer, so a copy nobody opens from a terminal
    would otherwise never hear of one. A development checkout pulls by hand."""
    if not (Path(repo) / 'distribution.json').is_file():
        return False
    marker = runtime_home() / 'release-check'
    try:
        if 0 <= now - marker.stat().st_mtime < RELEASE_CHECK_SECONDS:
            return False
    except OSError:
        pass
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.touch()
    return True


# The public repository's GitHub release listing, which the update banner
# offers. Only the helper's minute tick asks GitHub, at most once an hour; the
# viewer reads the answer from release.json and never waits on the network.
GITHUB_SOURCE = re.compile(r'^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$')
RELEASE_TAG = re.compile(r'^v(\d+)\.(\d+)\.(\d+)$')
RELEASE_LISTING_SECONDS = 3600
RELEASE_FETCH_SECONDS = 10
# An install the banner started that has not answered in this long has died.
RELEASE_INSTALL_SECONDS = 1800


def installed_source():
    """The installed public release's approved source, or '' for a private
    development install."""
    try:
        source = json.loads((runtime_home() / 'current/distribution.json').read_text()).get('source')
    except (OSError, ValueError, AttributeError):
        return ''
    return source if isinstance(source, str) else ''


def github_slug(source):
    match = GITHUB_SOURCE.match(source or '')
    return f'{match[1]}/{match[2]}' if match else ''


def release_tuple(tag):
    match = RELEASE_TAG.match(str(tag or '').strip())
    return tuple(int(part) for part in match.groups()) if match else None


def installed_version():
    try:
        return release_tuple('v' + (runtime_home() / 'current/VERSION').read_text().strip().removeprefix('v'))
    except OSError:
        return None


def fetch_latest_tag(slug):
    import urllib.request
    request = urllib.request.Request(f'https://api.github.com/repos/{slug}/releases/latest', headers={
        'Accept': 'application/vnd.github+json', 'User-Agent': 'Orc'})
    with urllib.request.urlopen(request, timeout=RELEASE_FETCH_SECONDS) as response:
        return json.loads(response.read(1_000_000)).get('tag_name')


def read_json(path):
    try:
        value = json.loads(Path(path).read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.stem + '-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(value, handle, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def release_listing_path():
    return runtime_home() / 'release.json'


def release_install_path():
    return runtime_home() / 'release-install.json'


def check_release_listing(now, fetch=fetch_latest_tag):
    """Ask GitHub for the public repository's latest release when the last
    answer is an hour old. A failed ask keeps the release it knew."""
    slug = github_slug(installed_source())
    if not slug:
        return
    prior = read_json(release_listing_path())
    checked = prior.get('checkedAt')
    if prior.get('slug') == slug and isinstance(checked, (int, float)) and 0 <= now - checked < RELEASE_LISTING_SECONDS:
        return
    listing = {'slug': slug, 'checkedAt': now}
    try:
        tag = fetch(slug)
        listing['latest'] = tag if release_tuple(tag) else ''
    except Exception as error:  # offline, rate limited, or GitHub answered nonsense
        listing['error'] = str(error) or type(error).__name__
        if prior.get('slug') == slug and release_tuple(prior.get('latest')):
            listing['latest'] = prior['latest']
    write_json(release_listing_path(), listing)


def release_offer(now=None):
    """What the update banner shows: a release on GitHub newer than the one
    installed, or None. `canInstall` is false for a copy unpacked from an
    archive, which can only be replaced from the release page. The link is
    built from the approved source and a checked tag, never taken from GitHub."""
    slug = github_slug(installed_source())
    listing = read_json(release_listing_path())
    latest = release_tuple(listing.get('latest'))
    ours = installed_version()
    if not slug or listing.get('slug') != slug or not latest or not ours or latest <= ours:
        return None
    tag = 'v%d.%d.%d' % latest
    install = read_json(release_install_path())
    install = install if install.get('version') == tag else {}
    started = install.get('at')
    if install.get('state') == 'running' and (
            not isinstance(started, (int, float)) or (now or time.time()) - started > RELEASE_INSTALL_SECONDS):
        install = {'state': 'failed', 'reason': 'The update stopped before it finished. Try again.'}
    return {'version': tag, 'installed': 'v%d.%d.%d' % ours,
            'url': f'https://github.com/{slug}/releases/tag/{tag}',
            'canInstall': bool(read_state().get('repo')),
            'install': {key: install[key] for key in ('state', 'reason') if isinstance(install.get(key), str)}}


def install_release(repo, version):
    """Fetch and install the public release the banner offered, through the
    same signed fast-forward the hourly check uses. Returns {state, reason}:
    `installed`, or `failed` with why it did not."""
    repo = Path(repo).expanduser().resolve()
    source_error = distribution_source_error(repo)
    if source_error:
        return {'state': 'failed', 'reason': source_error}
    reason = pull(repo)
    code = check(repo)
    target, ours = release_tuple(version), installed_version()
    if target and ours and ours >= target:
        return {'state': 'installed', 'reason': ''}
    if code:
        reason = read_state().get('reason') or reason
    if not reason:
        return {'state': 'failed', 'reason': 'The release has not reached this install’s update branch yet. '
                                             'Try again in a few minutes.'}
    return {'state': 'failed', 'reason': reason[:1].upper() + reason[1:]}


def background(repo):
    """The viewer's once-a-minute tick: look for a release now and then, and
    retry an install that has not gone through."""
    repo = Path(repo).expanduser().resolve()
    check_release_listing(time.time())
    if release_check_due(repo, time.time()):
        reason = pull(repo)
        if reason:
            print(f'orc: {reason}', file=sys.stderr)
    return check(repo, retry=True)


def refresh(repo):
    """Pull, then promote, so `orc-ui open` shows a PR merged on GitHub without
    a manual pull first. Offline fetch failures may still promote an approved
    local revision; source boundary violations block both steps."""
    repo = Path(repo).expanduser().resolve()
    source_error = distribution_source_error(repo)
    if source_error:
        print('orc: ' + source_error, file=sys.stderr)
        return 1
    reason = pull(repo)
    if reason:
        print(f'orc: {reason}; opening the installed release', file=sys.stderr)
    return check(repo)


def catch_up(repo, target, peer='The linked laptop'):
    """Update to a linked laptop's newer Orc. Returns {state, reason}: `newer`
    or `current` when nothing is needed, `updated` after a pull and install,
    `skipped` with why this checkout stayed where it is."""
    repo = Path(repo).expanduser().resolve()
    ours = installed_commit()
    if not target or target == ours:
        return {'state': 'current', 'reason': ''}
    if ours and has_commit(repo, target) and is_ancestor(repo, target, ours):
        return {'state': 'newer', 'reason': ''}
    source_error = distribution_source_error(repo)
    if source_error:
        return {'state': 'skipped', 'reason': source_error}
    reason = pull(repo)
    head = git(repo, 'rev-parse', 'HEAD')
    if not has_commit(repo, target):
        return {'state': 'skipped', 'reason': f"{peer}'s Orc is on a commit GitHub doesn't have yet."}
    if is_ancestor(repo, target, head):
        code = check(repo, ours)
        if code:
            return {'state': 'skipped', 'reason': read_state().get('reason') or 'The install failed.'}
        return {'state': 'updated', 'reason': ''}
    own = git(repo, 'rev-list', '--count', '@{upstream}..HEAD')
    if own and own != '0':
        return {'state': 'skipped', 'reason': (
            f"This laptop's Orc checkout has {own} commit{'s' if own != '1' else ''} of its own, "
            f"so it didn't update to match {peer}.")}
    return {'state': 'skipped', 'reason': (reason[:1].upper() + reason[1:] + '.') if reason
            else f"This laptop's Orc checkout couldn't fast-forward to {peer}'s version."}


def checkout_state(repo):
    """What the per-laptop version badges show: where the primary checkout
    stands against GitHub as of its last fetch, and what is installed."""
    repo = Path(repo).expanduser().resolve()
    ref = runtime_ref(repo)
    branch = ref[len('refs/heads/'):] if ref.startswith('refs/heads/') else ''
    upstream = git(repo, 'rev-parse', '--abbrev-ref', f'{branch}@{{upstream}}') if branch else ''
    counts = git(repo, 'rev-list', '--left-right', '--count', f'{ref}...{upstream}').split() if upstream else []
    ahead, behind = (int(counts[0]), int(counts[1])) if len(counts) == 2 else (None, None)
    update = status(repo)
    return {'branch': branch, 'head': git(repo, 'rev-parse', '--verify', ref + '^{commit}'),
            'onBranch': bool(branch) and git(repo, 'symbolic-ref', '-q', 'HEAD') == ref,
            'dirty': bool(git(repo, 'status', '--porcelain', '--untracked-files=normal')),
            'merging': bool(git(repo, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')),
            'upstream': upstream, 'ahead': ahead, 'behind': behind,
            'installed': installed_commit(), 'update': update['state'], 'updateReason': update['reason']}


MERGE_LOCK_WAIT_SECONDS = 30
PUSH_SECONDS = 60


def merge_lock(repo):
    """The lock orc-merge-main holds, so a sync never merges into main while
    the merge queue lands a run there."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import merge_queue
    runs = Path(os.environ.get('ORC_RUNS_DIR', '~/.orc/runs')).expanduser()
    path = merge_queue.lock_path(runs, repo)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open('a+')
    deadline = time.monotonic() + MERGE_LOCK_WAIT_SECONDS
    while True:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return handle
        except BlockingIOError:
            if time.monotonic() >= deadline:
                handle.close()
                return None
            time.sleep(0.1)


def _quiet(repo, *args, timeout=FETCH_SECONDS):
    # Hooks still run: post-merge reconciles VERSION and pre-push guards it.
    # The runtime check is deferred until the merge lock is released.
    try:
        return subprocess.run(['git', '-C', str(repo), *args],
                              env={**git_env(), 'GIT_TERMINAL_PROMPT': '0', 'ORC_DEFER_RUNTIME_CHECK': '1'},
                              stdin=subprocess.DEVNULL, capture_output=True, text=True,
                              timeout=timeout, start_new_session=True)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args, 124, '', f'took longer than {timeout}s')


def _last_line(result):
    lines = (result.stderr or result.stdout or '').strip().splitlines()
    return lines[-1] if lines else f'exit {result.returncode}'


def sync(repo):
    """Bring the runtime branch level with GitHub by the push-and-pull skill's
    rules: merge, never rebase; push without force; when GitHub moved during
    the push, integrate and push once more. Conflicts abort the merge and are
    left to an agent running that skill. Returns {state, reason, received,
    pushed}: `synced`, `current`, `skipped` (nothing changed) or `failed`."""
    repo = Path(repo).expanduser().resolve()
    result = {'state': 'skipped', 'reason': '', 'received': 0, 'pushed': 0}
    ref = runtime_ref(repo)
    branch = ref[len('refs/heads/'):] if ref.startswith('refs/heads/') else ''
    remote = git(repo, 'config', '--get', f'branch.{branch}.remote') if branch else ''
    merge = git(repo, 'config', '--get', f'branch.{branch}.merge') if branch else ''
    common = git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    if not remote or not merge or not common:
        return {**result, 'reason': f'{branch or ref} has no GitHub branch to sync with.'}
    source_error = distribution_source_error(repo, remote)
    if source_error:
        return {**result, 'reason': source_error}
    if Path(common).parent.resolve() != repo:
        return {**result, 'reason': 'Only the primary Orc checkout can sync.'}
    if git(repo, 'symbolic-ref', '-q', 'HEAD') != ref:
        return {**result, 'reason': f'{repo} is not on {branch}. Switch it back to {branch}, then sync.'}
    if git(repo, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'):
        return {**result, 'reason': f'{repo} is in the middle of a merge. Finish or abort it, then sync.'}
    if git(repo, 'status', '--porcelain', '--untracked-files=normal'):
        return {**result, 'reason': f'{repo} has uncommitted changes. Commit or stash them, then sync.'}
    old = installed_commit()
    start = git(repo, 'rev-parse', 'HEAD')
    lock = merge_lock(repo)
    if not lock:
        return {**result, 'reason': 'A merge to main is running. Try again in a minute.'}
    with lock:
        for attempt in (1, 2):
            fetched = _quiet(repo, 'fetch', '--quiet', remote, merge)
            if fetched.returncode:
                return {**result, 'reason': f'Could not fetch {remote}: {_last_line(fetched)}'}
            upstream = git(repo, 'rev-parse', '--verify', f'{branch}@{{upstream}}')
            if not is_ancestor(repo, upstream, 'HEAD'):
                sig_error = release_signature_error(repo, upstream)
                if sig_error:
                    record_refused(repo, upstream, sig_error)
                    return {**result, 'state': 'failed', 'reason': sig_error}
                merged = _quiet(repo, 'merge', '--no-edit', upstream, timeout=600)
                if merged.returncode:
                    conflicts = git(repo, 'diff', '--name-only', '--diff-filter=U').split()
                    _quiet(repo, 'merge', '--abort')
                    if not conflicts:
                        return {**result, 'reason': f'Merging GitHub’s {branch} failed: {_last_line(merged)}'}
                    shown = ', '.join(conflicts[:3]) + (f' and {len(conflicts) - 3} more' if len(conflicts) > 3 else '')
                    return {**result, 'reason': (
                        f'Merging GitHub’s {branch} hit conflicts in {shown}. Nothing changed. '
                        'Run /push-and-pull in the Orc project to resolve them.')}
            result['received'] = int(git(repo, 'rev-list', '--count', f'{start}..{upstream}') or 0)
            result['pushed'] = int(git(repo, 'rev-list', '--count', '--no-merges', f'{upstream}..HEAD') or 0)
            if is_ancestor(repo, 'HEAD', upstream):
                break
            pushed = _quiet(repo, 'push', remote, f'HEAD:{merge}', timeout=PUSH_SECONDS)
            if not pushed.returncode:
                break
            if attempt == 2 or 'rejected' not in (pushed.stderr or ''):
                return {**result, 'state': 'failed', 'reason': f'Pushing to {remote} failed: {_last_line(pushed)}'}
    if check(repo, old):
        return {**result, 'state': 'failed', 'reason': read_state().get('reason') or 'The install failed.'}
    result['state'] = 'current' if git(repo, 'rev-parse', 'HEAD') == start == upstream else 'synced'
    return result


ARTIFACT_REASON = ('This copy has no Git checkout, so it cannot update itself. Install it once more with '
                   'the latest Orc Installer to get automatic updates.')


def installed(repo, commit, artifact=False):
    """Publish provenance before a reconciled viewer can schedule a retry."""
    write_state({'repo': '' if artifact else str(Path(repo).resolve()),
                 'desiredCommit': '' if artifact else commit, 'installedCommit': commit,
                 'state': 'current', 'reason': ARTIFACT_REASON if artifact else ''})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'retry', 'refresh', 'status', 'installed', 'catch-up', 'sync',
                                           'install-release'])
    parser.add_argument('--version', default='')
    parser.add_argument('--repo', required=True)
    parser.add_argument('--old', default='')
    parser.add_argument('--commit', default='')
    parser.add_argument('--artifact', action='store_true')
    parser.add_argument('--peer', default='The linked laptop')
    parser.add_argument('--result', default='')
    args = parser.parse_args()
    if args.action == 'catch-up':
        result = {**catch_up(args.repo, args.commit, args.peer), 'peerCommit': args.commit, 'at': time.time()}
        if args.result:
            Path(args.result).parent.mkdir(parents=True, exist_ok=True)
            Path(args.result).write_text(json.dumps(result) + '\n')
        print(json.dumps(result))
        return 0
    if args.action == 'sync':
        try:
            result = sync(args.repo)
        except Exception as error:  # the result file must never stay at running
            result = {'state': 'failed', 'reason': str(error) or type(error).__name__}
        result['at'] = time.time()
        if args.result:
            Path(args.result).parent.mkdir(parents=True, exist_ok=True)
            Path(args.result).write_text(json.dumps(result) + '\n')
        print(json.dumps(result))
        return 0 if result['state'] in ('synced', 'current') else 1
    if args.action == 'install-release':
        try:
            result = install_release(args.repo, args.version)
        except Exception as error:  # the result file must never stay at running
            result = {'state': 'failed', 'reason': str(error) or type(error).__name__}
        result.update(version=args.version, at=time.time())
        if args.result:
            write_json(args.result, result)
        print(json.dumps(result))
        return 0 if result['state'] == 'installed' else 1
    if args.action == 'status':
        print(json.dumps(status(args.repo)))
        return 0
    if args.action == 'installed':
        installed(args.repo, args.commit, artifact=args.artifact)
        return 0
    if args.action == 'refresh':
        return refresh(args.repo)
    if args.action == 'retry':
        return background(args.repo)
    return check(args.repo, args.old)


if __name__ == '__main__':
    sys.exit(main())
