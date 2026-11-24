"""The Instructions routes. They answer Orc on the host Mac and a signed-in
paired browser, which read and edit the host's files. An MCP client or bot is
an agent and is refused, as is a browser that has not signed in."""
import json
from pathlib import Path
import threading
import urllib.parse

import instructions_store

PREFIX = '/api/instructions'
# JSON escaping can more than double a legal 256 KB text.
BODY_LIMIT = 2 * instructions_store.MAX_BYTES + 32 * 1024
InstructionsError = instructions_store.InstructionsError
FORBIDDEN = 'Manage instructions from Orc on the host or a signed-in paired device.'


def _only(data, *allowed):
    unknown = sorted(set(data) - set(allowed))
    if unknown:
        raise instructions_store.invalid('Unknown fields: %s.' % ', '.join(unknown))


def _is_signed_in(handler):
    checker = getattr(handler, '_signed_in_device', None)
    return bool(checker()) if callable(checker) else True


def _send(handler, status, payload):
    handler._respond(status, json.dumps(payload).encode('utf-8'), 'application/json', {'Cache-Control': 'no-store'})


class Service:
    def __init__(self, home=None, config_dir=None):
        self._home = home if home is not None else Path.home
        self._config_dir = config_dir
        self.busy = threading.Lock()

    def store(self):
        home_value = self._home() if callable(self._home) else self._home
        home = Path(home_value)
        config_value = self._config_dir() if callable(self._config_dir) else self._config_dir
        config = Path(config_value) if config_value else home / '.orc'
        return instructions_store.Store(home, config)

    def handle(self, handler, method, path):
        if not (path == PREFIX or path.startswith(PREFIX + '/')) or method not in ('GET', 'POST'):
            return False
        if not _is_signed_in(handler):
            _send(handler, 403, {'error': FORBIDDEN, 'code': 'forbidden'})
            return True
        try:
            if method == 'GET':
                payload = self.get(handler, path)
            else:
                data = handler.read_json_object(BODY_LIMIT)
                if data is None:
                    raise instructions_store.invalid('Send a JSON object.')
                with self.busy:
                    payload = self.post(path, data)
            status = 200
        except InstructionsError as error:
            status, payload = error.status, error.payload()
        except OSError as error:
            status, payload = 503, {'error': 'Instructions are unavailable: %s' % (error.strerror or error),
                                    'code': 'unavailable'}
        _send(handler, status, payload)
        return True

    def get(self, handler, path):
        store = self.store()
        if path == PREFIX:
            return store.snapshot()
        if path == PREFIX + '/target':
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query)
            identifier = (query.get('id') or [''])[0]
            if not identifier:
                raise instructions_store.invalid('Name an account with ?id=.')
            return store.target_detail(identifier)
        raise instructions_store.not_found('Not found.')

    def post(self, path, data):
        store = self.store()
        if path == PREFIX + '/main':
            _only(data, 'text', 'baseDigest', 'revision')
            if 'baseDigest' not in data:
                raise instructions_store.invalid('Send the baseDigest the editor started from, or null.')
            return store.save_main(data.get('text'), data['baseDigest'], data.get('revision'))
        if path == PREFIX + '/adopt':
            _only(data, 'target', 'revision')
            return store.adopt(data.get('target'), data.get('revision'))
        if path == PREFIX + '/sync':
            _only(data, 'targets', 'overwrite', 'revision', 'expect')
            return store.sync(data.get('targets'), data.get('overwrite', False), data.get('revision'), data.get('expect'))
        if path == PREFIX + '/exclude':
            _only(data, 'target', 'excluded', 'revision')
            return store.exclude(data.get('target'), data.get('excluded'), data.get('revision'))
        raise instructions_store.not_found('Not found.')
