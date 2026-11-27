"""Back up Orc's settings to the user's own private GitHub repository.

Local is the default: settings live in ~/.orc/config.json and nothing leaves
the Mac. With config.json's settingsBackup set to
{"provider": "github", "repo": "<owner>/<name>"}, orc-settings.json in that
repository holds the allowlisted settings (cloud_account.settings_document),
the saved theme and the enabled bundled plugins. Every call goes through the
gh CLI, so there is no server and no token of Orc's own.

stdlib-only, like the rest of ui/.
"""
import base64
import contextlib
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path

import app_plugins
import integrations
import cloud_account
import cloud_worker

CONFIG_KEY = 'settingsBackup'
STATE_FILE = 'settings-backup.json'
THEME_FILE = 'ui-theme.json'
BACKUP_PATH = 'orc-settings.json'
SCHEMA_VERSION = 1
REPO = re.compile(r'[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}')
THEME_ID = re.compile(r'[a-z][a-z0-9-]{0,31}')
# A GUI-started orc-ui inherits launchd's short PATH, which has none of these.
GH_DIRS = ('/opt/homebrew/bin', '/usr/local/bin', '~/.local/bin')
GH_TIMEOUT = 60
_THREAD_LOCK = threading.Lock()


class BackupError(RuntimeError):
    pass


class NotFound(BackupError):
    pass


def _now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def gh_path():
    dirs = [os.environ.get('PATH', ''), *(os.path.expanduser(path) for path in GH_DIRS)]
    return shutil.which('gh', path=os.pathsep.join(dirs))


def _gh(*args, data=None):
    gh = gh_path()
    if not gh:
        raise BackupError('The gh CLI is not installed. Install it from https://cli.github.com.')
    env = dict(os.environ, GH_PROMPT_DISABLED='1', GH_NO_UPDATE_NOTIFIER='1')
    integrations.note('backup')
    try:
        result = subprocess.run([gh, *args], input=data, capture_output=True, text=True,
                                env=env, timeout=GH_TIMEOUT)
    except subprocess.TimeoutExpired as error:
        raise BackupError('gh did not answer within %d seconds' % GH_TIMEOUT) from error
    if result.returncode:
        detail = (result.stderr.strip() or result.stdout.strip()).splitlines()
        message = detail[-1] if detail else 'gh exited with %d' % result.returncode
        raise (NotFound if 'HTTP 404' in result.stderr else BackupError)(message)
    return result.stdout


def read_config(config_dir):
    try:
        value = json.loads((Path(config_dir) / 'config.json').read_text())
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _update_config(config_dir, transform):
    path = Path(config_dir) / 'config.json'
    try:
        config = json.loads(path.read_text())
    except FileNotFoundError:
        config = {}
    except ValueError as error:
        # A broken file read as {} would be rewritten without the user's keys.
        raise BackupError('config.json is not valid JSON; fix it and try again') from error
    if not isinstance(config, dict):
        raise BackupError('config.json does not hold a JSON object')
    cloud_worker.write_json(path, transform(config))


def repo(config_dir):
    value = read_config(config_dir).get(CONFIG_KEY)
    if (isinstance(value, dict) and value.get('provider') == 'github'
            and isinstance(value.get('repo'), str) and REPO.fullmatch(value['repo'])):
        return value['repo']
    return None


BASICS_ACCENTS = ('green', 'blue', 'magenta', 'teal', 'amber', 'violet', 'graphite')
# A Custom accent is its own lowercase hex; it lands in an inline script and a style.
CUSTOM_ACCENT = re.compile(r'#[0-9a-f]{6}')


def valid_accent(accent):
    return accent in BASICS_ACCENTS or (isinstance(accent, str) and CUSTOM_ACCENT.fullmatch(accent) is not None)


def valid_theme(theme):
    """The rule serve.py applies to ~/.orc/ui-theme.json."""
    return (isinstance(theme, dict) and {'mode', 'funMode'} <= theme.keys() <= {'mode', 'funMode', 'basicsAccent'}
            and valid_accent(theme.get('basicsAccent', 'green'))
            and theme['mode'] in ('system', 'light', 'dark')
            and (theme['funMode'] is None
                 or (isinstance(theme['funMode'], str) and THEME_ID.fullmatch(theme['funMode']) is not None)))


def _theme(config_dir):
    try:
        theme = json.loads((Path(config_dir) / THEME_FILE).read_text())
    except (OSError, ValueError):
        return None
    return theme if valid_theme(theme) else None


def _plugins(config_dir):
    try:
        state = json.loads((Path(config_dir) / 'app-plugins.json').read_text())
        bundled = app_plugins.Registry(Path(config_dir).parent).catalog()
    except (OSError, ValueError):
        return []
    installed = state.get('installed') if isinstance(state, dict) else None
    if not isinstance(installed, dict):
        return []
    return sorted(identifier for identifier, record in installed.items()
                  if identifier in bundled and isinstance(record, dict) and record.get('enabled'))


def document(config_dir):
    return {'schemaVersion': SCHEMA_VERSION, 'savedAt': _now(), 'machine': cloud_account.machine_name(),
            'settings': cloud_account.settings_document(read_config(config_dir)),
            'theme': _theme(config_dir), 'plugins': _plugins(config_dir)}


def digest(doc):
    """Saving the same settings from another time or Mac is not a change."""
    kept = {key: value for key, value in doc.items() if key not in ('savedAt', 'machine')}
    return hashlib.sha256(json.dumps(kept, sort_keys=True).encode()).hexdigest()


def _state(config_dir, name):
    try:
        state = json.loads((Path(config_dir) / STATE_FILE).read_text())
    except (OSError, ValueError):
        return {}
    # A state recorded for another repository says nothing about this one.
    return state if isinstance(state, dict) and state.get('repo') == name else {}


def _save_state(config_dir, name, **changes):
    state = {'repo': name, 'digest': None, 'sha': None, 'pushedAt': None, 'error': None, 'errorAt': None}
    state.update({key: value for key, value in _state(config_dir, name).items() if key in state})
    state.update(changes)
    cloud_worker.write_json(Path(config_dir) / STATE_FILE, state)
    return state


@contextlib.contextmanager
def _exclusive(config_dir):
    Path(config_dir).mkdir(parents=True, exist_ok=True)
    with open(Path(config_dir) / '.settings-backup.lock', 'w') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def login():
    name = _gh('api', 'user', '--jq', '.login').strip()
    if not re.fullmatch(r'[A-Za-z0-9-]{1,39}', name):
        raise BackupError('gh is not signed in to GitHub; run gh auth login')
    return name


def remote(name):
    """The backup in the repository and its blob sha, or (None, None)."""
    try:
        data = json.loads(_gh('api', 'repos/%s/contents/%s' % (name, BACKUP_PATH)))
    except NotFound:
        return None, None
    try:
        doc = json.loads(base64.b64decode(data['content']))
    except (KeyError, TypeError, ValueError) as error:
        raise BackupError('%s in %s is not an Orc settings backup' % (BACKUP_PATH, name)) from error
    if not isinstance(doc, dict) or not isinstance(doc.get('schemaVersion'), int):
        raise BackupError('%s in %s is not an Orc settings backup' % (BACKUP_PATH, name))
    if doc['schemaVersion'] > SCHEMA_VERSION:
        raise BackupError('The backup in %s was saved by a newer Orc; update Orc first' % name)
    return doc, data.get('sha')


def summary(doc):
    if doc is None:
        return None
    plugins = doc.get('plugins') if isinstance(doc.get('plugins'), list) else []
    theme = doc.get('theme') if valid_theme(doc.get('theme')) else None
    if theme:
        theme = app_plugins.saved_theme(theme)
    mapped_plugins = []
    for item in plugins:
        if isinstance(item, str) and THEME_ID.fullmatch(item) and item not in app_plugins.RETIRED_THEMES:
            canonical = app_plugins.RENAMED_BUNDLED.get(item, item)
            if canonical not in mapped_plugins:
                mapped_plugins.append(canonical)
    return {'savedAt': doc.get('savedAt'), 'machine': doc.get('machine'),
            'theme': theme, 'plugins': mapped_plugins}


def connect(config_dir, name=None):
    name = name or login() + '/orc-settings'
    if not REPO.fullmatch(name):
        raise BackupError('Name the repository as owner/name')
    try:
        info = json.loads(_gh('api', 'repos/' + name))
        created = False
    except NotFound:
        _gh('repo', 'create', name, '--private', '--description', 'Orc settings backup')
        info, created = {'private': True}, True
    if not info.get('private'):
        raise BackupError('%s is public. Settings belong in a private repository.' % name)
    doc, sha = (None, None) if created else remote(name)
    _update_config(config_dir, lambda config: {**config, CONFIG_KEY: {'provider': 'github', 'repo': name}})
    _save_state(config_dir, name, sha=sha, digest=digest(doc) if doc else None, error=None, errorAt=None)
    return {'provider': 'github', 'repo': name, 'created': created, 'backup': summary(doc)}


def push(config_dir, force=False):
    """Save this Mac's settings when they changed since the last save. The
    PUT names the blob this Mac last saw, so a backup another Mac saved since
    is reported instead of overwritten; force replaces it."""
    name = repo(config_dir)
    if not name:
        raise BackupError('Settings backup is not connected; run orc-settings-backup connect')
    with _exclusive(config_dir):
        try:
            doc = document(config_dir)
            value = digest(doc)
            state = _state(config_dir, name)
            if not force and state.get('digest') == value:
                return {'repo': name, 'pushed': False}
            sha = remote(name)[1] if force else state.get('sha')
            body = {'message': 'Back up Orc settings from ' + doc['machine'],
                    'content': base64.b64encode((json.dumps(doc, indent=2) + '\n').encode()).decode()}
            if sha:
                body['sha'] = sha
            try:
                answer = json.loads(_gh('api', '--method', 'PUT', 'repos/%s/contents/%s' % (name, BACKUP_PATH),
                                        '--input', '-', data=json.dumps(body)))
            except BackupError as error:
                if re.search(r'HTTP (409|422)', str(error)):
                    raise BackupError('The backup in %s changed since this Mac last saved it. Restore it, '
                                      'or replace it with orc-settings-backup push --force.' % name) from error
                raise
            saved = _save_state(config_dir, name, digest=value, sha=answer['content']['sha'],
                                pushedAt=_now(), error=None, errorAt=None)
        except Exception as error:
            _save_state(config_dir, name, error=str(error) or type(error).__name__, errorAt=_now())
            raise
    return {'repo': name, 'pushed': True, 'pushedAt': saved['pushedAt']}


def restore(config_dir):
    """Plugins change through orc-app-plugin, so their ids are returned for
    the caller to apply."""
    name = repo(config_dir)
    if not name:
        raise BackupError('Settings backup is not connected; run orc-settings-backup connect')
    doc, sha = remote(name)
    if doc is None:
        raise BackupError('%s has no %s yet' % (name, BACKUP_PATH))
    settings = doc.get('settings') if isinstance(doc.get('settings'), dict) else {}
    _update_config(config_dir, lambda config: cloud_account.apply_document(config, settings))
    restored = summary(doc)
    if restored['theme']:
        cloud_worker.write_json(Path(config_dir) / THEME_FILE, restored['theme'])
    _save_state(config_dir, name, sha=sha, digest=digest(doc))
    return {'repo': name, 'settings': sorted(cloud_account.settings_document(settings)), **restored}


def disconnect(config_dir):
    if CONFIG_KEY in read_config(config_dir):
        _update_config(config_dir, lambda config: {k: v for k, v in config.items() if k != CONFIG_KEY})
    with contextlib.suppress(FileNotFoundError):
        (Path(config_dir) / STATE_FILE).unlink()
    return {'provider': 'local'}


def status(config_dir):
    name = repo(config_dir)
    state = _state(config_dir, name) if name else {}
    return {'provider': 'github' if name else 'local', 'repo': name, 'gh': gh_path(),
            'pushedAt': state.get('pushedAt'), 'error': state.get('error'), 'errorAt': state.get('errorAt')}


def start(config_dir):
    """One push on a daemon thread unless one is in flight or none is set up."""
    if not repo(config_dir) or not _THREAD_LOCK.acquire(blocking=False):
        return False

    def work():
        try:
            # push records its failure in the state file for status to show.
            with contextlib.suppress(Exception):
                push(config_dir)
        finally:
            _THREAD_LOCK.release()

    threading.Thread(target=work, name='orc-settings-backup', daemon=True).start()
    return True
