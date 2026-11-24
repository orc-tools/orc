"""The user's Cloudflare Worker in cloud/project-memory: where it is, how to
reach it, and this machine's identity there.

Usage stats, release version claims, vault sync, settings backup and the
assistant all talk to the same Worker through this module. Two setups name
it: a GitHub sign-in (``cloudAccount`` in config.json with its machine token,
see ui/cloud_account.py) or the user's own token (``projectMemorySync`` with
``ORC_PROJECT_MEMORY_SYNC_TOKEN``, set by ``orc-cloud configure``). The
stored names keep their original spelling so existing setups keep working.
"""
import contextlib
import json
import os
import re
import secrets
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

import keychain_secrets

SECRET = 'ORC_PROJECT_MEMORY_SYNC_TOKEN'
# The GitHub sign-in's own token and config key (ui/cloud_account.py).
MACHINE_SECRET = 'ORC_CLOUD_MACHINE_TOKEN'
ACCOUNT_KEY = 'cloudAccount'
CONFIG_KEY = 'projectMemorySync'
URL = re.compile(r'https://[A-Za-z0-9.-]+(?::\d+)?/?|http://127\.0\.0\.1:\d+/?')
NOT_CONFIGURED = 'Deploy cloud/project-memory and run orc-cloud configure --url <Worker URL>.'


class WorkerError(RuntimeError):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


def read_config(config_dir):
    try:
        value = json.loads((Path(config_dir) / 'config.json').read_text())
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def write_json(path, value):
    """Replace ``path`` with ``value`` as indented JSON, atomically."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name + '.', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(value, handle, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temporary)
        raise


def machine_id(config_dir):
    try:
        value = (Path(config_dir) / 'machine-id').read_text().strip()
    except OSError:
        return None
    return value if re.fullmatch(r'[0-9a-f]{32}', value) else None


def _section_url(value):
    found = value.get('url') if isinstance(value, dict) else None
    return found.rstrip('/') if isinstance(found, str) and URL.fullmatch(found) else None


def url(config_dir):
    """The Worker this machine talks to: the GitHub sign-in's while it names
    one, else the user's own setup's."""
    config = read_config(config_dir)
    return _section_url(config.get(ACCOUNT_KEY)) or _section_url(config.get(CONFIG_KEY))


def credentials(config_dir, keychain=keychain_secrets):
    """(url, token) for the Worker: the GitHub sign-in's Worker and machine
    token while cloudAccount names a Worker and the Keychain holds that
    token, else the own setup's URL and the user's own token. (None, None)
    when neither is set up; WorkerError names a missing Keychain item."""
    config = read_config(config_dir)
    signed_in, own = _section_url(config.get(ACCOUNT_KEY)), _section_url(config.get(CONFIG_KEY))
    if signed_in:
        token = keychain.read(MACHINE_SECRET)
        if token:
            return signed_in, token
        if not own:
            raise WorkerError('The Keychain has no %s.' % MACHINE_SECRET)
    if not own:
        return None, None
    token = keychain.read(SECRET)
    if not token:
        raise WorkerError('The Keychain has no %s.' % SECRET)
    return own, token


def configured(config_dir):
    return url(config_dir) is not None


def configure(config_dir, worker_url, *, keychain=keychain_secrets):
    """Point this machine at a deployed Worker. Reuses the Keychain token when
    one exists, so a second machine set up with the same token joins."""
    if not isinstance(worker_url, str) or not URL.fullmatch(worker_url):
        raise WorkerError('Use the Worker\'s https:// URL.')
    created = keychain.read(SECRET) is None
    if created:
        keychain.save(SECRET, secrets.token_urlsafe(32))
    keychain.remember(str(config_dir), SECRET)
    config = read_config(config_dir)
    config[CONFIG_KEY] = dict(config.get(CONFIG_KEY) or {}, url=worker_url.rstrip('/'))
    write_json(Path(config_dir) / 'config.json', config)
    return {'url': worker_url.rstrip('/'), 'secret': SECRET, 'tokenCreated': created}


def request(base, token, method, path, payload=None, timeout=20):
    data = None if payload is None else json.dumps(payload).encode()
    outgoing = urllib.request.Request(base + path, data=data, method=method, headers={
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        # Cloudflare refuses urllib's default agent string.
        'User-Agent': 'orc-cloud/1',
    })
    try:
        with urllib.request.urlopen(outgoing, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            message = json.load(exc).get('error')
        except (ValueError, AttributeError):
            message = None
        raise WorkerError('Worker answered HTTP %d%s' % (exc.code, ': ' + message if message else ''),
                          exc.code) from exc
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise WorkerError('Worker unreachable: %s' % getattr(exc, 'reason', exc)) from exc
