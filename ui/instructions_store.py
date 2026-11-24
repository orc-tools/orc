"""The Instructions store: one main copy of the global agent instructions at
~/.orc/instructions/AGENTS.md, every account's own instructions file as a
target, and the state file that remembers what was last written where."""
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

import agent_accounts
import claude_accounts

MAX_BYTES = 256 * 1024
MAIN_NAME = 'AGENTS.md'
KEEP_BACKUPS = 50
STAMP_RE = re.compile(r'\d{8}T\d{6}Z(?:-\d{3})?\Z')
SAFE_RE = re.compile(r'[^A-Za-z0-9._-]')
GEMINI_LABEL = 'Antigravity'
GEMINI_EXTRA = ('.gemini/AGENTS.md', '.gemini/config/GEMINI.md', '.gemini/config/AGENTS.md')

WRITES = ('missing', 'behind')
OVERWRITES = ('edited', 'differs')
REASONS = {
    'in-sync': 'Already matches the main copy.',
    'linked': 'Already matches the main copy.',
    'edited': 'Edited there since the last sync.',
    'differs': 'Has its own text that was never synced.',
    'broken': 'A symlink to a file that is not there.',
    'unreadable': 'Orc could not read it.',
}
EXCLUDED_REASON = 'Kept separate.'
WRITE_FAILED_REASON = 'Orc could not write it.'
MOVED_REASON = 'Changed since you looked; check it again.'


class InstructionsError(Exception):
    def __init__(self, status, code, message, **extra):
        super().__init__(message)
        self.status = status
        self.code = code
        self.extra = extra

    def payload(self):
        return {'error': str(self), 'code': self.code, **self.extra}


def invalid(message):
    return InstructionsError(400, 'invalid_request', message)


def not_found(message):
    return InstructionsError(404, 'not_found', message)


def conflict(message, **extra):
    return InstructionsError(409, 'conflict', message, **extra)


def digest_of(data):
    return hashlib.sha256(data).hexdigest()


def count_lines(text):
    if not text:
        return 0
    return text.count('\n') + (0 if text.endswith('\n') else 1)


def iso(moment):
    return moment.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def safe_id(identifier):
    return SAFE_RE.sub('-', identifier)


def read_file(path):
    """What is at path: whether it exists, is a symlink or a dangling one, and
    its UTF-8 text when it is a readable regular file within the size cap."""
    path = str(path)
    info = {'exists': False, 'symlink': os.path.islink(path), 'broken': False, 'readable': False,
            'data': None, 'text': '', 'digest': None, 'bytes': 0, 'lines': 0, 'modified': None}
    if info['symlink'] and not os.path.exists(path):
        info['broken'] = True
        return info
    try:
        status = os.stat(path)
    except FileNotFoundError:
        return info
    except OSError:
        info['exists'] = True
        return info
    info['exists'] = True
    info['bytes'] = status.st_size
    info['modified'] = datetime.fromtimestamp(status.st_mtime, timezone.utc)
    if not os.path.isfile(path) or status.st_size > MAX_BYTES:
        return info
    try:
        with open(path, 'rb') as handle:
            data = handle.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            return info
        text = data.decode('utf-8')
    except (OSError, UnicodeDecodeError):
        return info
    info.update(readable=True, data=data, text=text, digest=digest_of(data),
                bytes=len(data), lines=count_lines(text))
    return info


def atomic_write(path, data, default_mode=0o644):
    """Replace path's bytes in one step. A symlink is written through to the
    file it points at, so the link stays; the file's permission bits stay."""
    real = Path(os.path.realpath(str(path)))
    try:
        mode = os.stat(real).st_mode & 0o7777
    except FileNotFoundError:
        mode = default_mode
    descriptor, temp = tempfile.mkstemp(dir=str(real.parent), prefix='.%s.' % real.name, suffix='.tmp')
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, mode)
        os.replace(temp, real)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temp)
    return real


def atomic_write_json(path, payload):
    atomic_write(path, (json.dumps(payload, indent=2, sort_keys=True) + '\n').encode('utf-8'), 0o600)


class Change:
    """One mutating request: its state, and the backups it makes, all in one
    UTC-stamped folder that is created only when the first file is copied."""

    def __init__(self, store):
        self.store = store
        self.folder = None
        self.made = []
        self.state = None
        self.snapshot = None

    def copy(self, source, name):
        if self.folder is None:
            root = self.store.backups_dir
            root.mkdir(parents=True, exist_ok=True)
            stamp = self.store.now().astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            # A later request in the same second sorts after every earlier one,
            # even after pruning freed the plain stamp.
            taken = [entry.name[len(stamp):] for entry in root.iterdir() if entry.name.startswith(stamp)]
            number = max([1 if not rest else int(rest[1:]) for rest in taken
                          if not rest or re.fullmatch(r'-\d{3}', rest)], default=0)
            while True:
                number += 1
                folder = root / (stamp if number == 1 else '%s-%03d' % (stamp, number))
                try:
                    folder.mkdir()
                    break
                except FileExistsError:
                    continue
            self.folder = folder
        # Two folders can share a safe id (".claude-a b", ".claude-a-b").
        destination, number = self.folder / name, 1
        while destination.exists():
            number += 1
            destination = self.folder / ('%d-%s' % (number, name))
        shutil.copy2(os.path.realpath(str(source)), destination)
        self.made.append(self.store.display(destination))
        self.store.prune_backups(keep=self.folder)
        return destination


class Store:
    def __init__(self, home, config_dir=None, now=None):
        self.home = Path(home).resolve()
        self.config_dir = Path(config_dir).resolve() if config_dir else self.home / '.orc'
        self.root = self.config_dir / 'instructions'
        self.main_path = self.root / MAIN_NAME
        self.state_path = self.root / 'state.json'
        self.lock_path = self.root / '.lock'
        self.backups_dir = self.root / 'backups'
        self.now = now or (lambda: datetime.now(timezone.utc))

    def display(self, path):
        path = Path(path)
        try:
            relative = path.relative_to(self.home)
        except ValueError:
            return str(path)
        return '~/%s' % relative if str(relative) != '.' else '~'

    # state file

    def read_state(self):
        try:
            data = json.loads(self.state_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            data = {}
        if not isinstance(data, dict):
            data = {}
        revision = data.get('revision')
        targets = data.get('targets')
        clean = {}
        for key, record in (targets.items() if isinstance(targets, dict) else ()):
            if isinstance(key, str) and isinstance(record, dict):
                clean[key] = {
                    'syncedDigest': record.get('syncedDigest') if isinstance(record.get('syncedDigest'), str) else None,
                    'syncedAt': record.get('syncedAt') if isinstance(record.get('syncedAt'), str) else None,
                    'excluded': record.get('excluded') is True,
                }
        saved = data.get('savedAt')
        return {
            'revision': revision if isinstance(revision, int) and not isinstance(revision, bool) else 0,
            'savedAt': saved if isinstance(saved, str) else None,
            'targets': clean,
        }

    @contextlib.contextmanager
    def mutation(self, revision=None):
        """Hold the store's lock for one change: check the caller's revision,
        hand over the change (its state and this request's backups), then save
        the state with its revision bumped and take the answer's snapshot
        before letting go. An error inside saves nothing."""
        if revision is not None and (not isinstance(revision, int) or isinstance(revision, bool)):
            raise invalid('revision must be a whole number.')
        self.root.mkdir(parents=True, exist_ok=True)
        with open(self.lock_path, 'a+') as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            state = self.read_state()
            if revision is not None and revision != state['revision']:
                raise InstructionsError(409, 'stale', 'Instructions changed in another tab; reload and try again.',
                                        revision=state['revision'])
            change = Change(self)
            change.state = state
            yield change
            state['revision'] += 1
            atomic_write_json(self.state_path, state)
            change.snapshot = self.snapshot(state)

    def prune_backups(self, keep=None):
        """Keep the newest 50 folders holding an account's file, and apart from
        them the newest 50 holding only the main copy, so saving the main copy
        often never pushes out the one copy of an account's own text."""
        try:
            stamps = sorted(entry for entry in self.backups_dir.iterdir()
                            if entry.is_dir() and not entry.is_symlink() and STAMP_RE.match(entry.name))
        except OSError:
            return
        def main_only(folder):
            try:
                return all(item.name.startswith('main-') for item in folder.iterdir())
            except OSError:
                return False
        for group in ([folder for folder in stamps if main_only(folder)],
                      [folder for folder in stamps if not main_only(folder)]):
            others = [folder for folder in group if folder != keep]
            for old in others[:max(0, len(group) - KEEP_BACKUPS)]:
                shutil.rmtree(old, ignore_errors=True)

    # discovery

    def account_names(self):
        try:
            data = json.loads((self.config_dir / agent_accounts.NAMES_FILE).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return {}
        if not isinstance(data, dict):
            return {}
        return {key: value.strip() for key, value in data.items()
                if isinstance(key, str) and isinstance(value, str) and value.strip()}

    def claude_folders(self):
        folders = list(claude_accounts.available(self.home))
        # CLAUDE_CONFIG_DIR only counts against the real home, never a fixture.
        if self.home == Path.home().resolve():
            configured = os.environ.get('CLAUDE_CONFIG_DIR', '').strip()
            if configured:
                where = self.home / configured[2:] if configured.startswith('~/') else Path(configured)
                try:
                    if where.resolve().parent == self.home and where.name not in folders:
                        folders.append(where.name)
                except OSError:
                    pass
        return [folder for folder in folders if (self.home / folder).is_dir()]

    def discover(self):
        """Every target in order: Claude logins (the default first), Codex,
        Antigravity. Only harnesses whose folder exists are listed."""
        names = self.account_names()
        found = []
        for folder in self.claude_folders():
            default = agent_accounts.label('claude', folder)
            found.append({'id': 'claude:%s' % folder, 'kind': 'claude', 'label': names.get('claude:%s' % folder) or default,
                          'defaultLabel': default, 'folderName': folder, 'fileName': 'CLAUDE.md'})
        if (self.home / '.codex').is_dir():
            default = agent_accounts.label('codex', '.codex')
            found.append({'id': 'codex', 'kind': 'codex', 'label': names.get('codex:.codex') or default,
                          'defaultLabel': default, 'folderName': '.codex', 'fileName': 'AGENTS.md'})
        if (self.home / '.gemini').is_dir():
            found.append({'id': 'gemini', 'kind': 'gemini', 'label': GEMINI_LABEL, 'defaultLabel': GEMINI_LABEL,
                          'folderName': '.gemini', 'fileName': 'GEMINI.md'})
        targets, seen = [], set()
        for target in found:
            folder = self.home / target['folderName']
            # Dedupe aliased folders, not files: two accounts that both link to
            # the main copy are still two targets.
            key = str(folder.resolve() / target['fileName'])
            if key in seen:
                continue
            seen.add(key)
            target['path'] = folder / target['fileName']
            targets.append(target)
        return targets

    def find(self, identifier, targets=None):
        for target in targets if targets is not None else self.discover():
            if target['id'] == identifier:
                return target
        raise not_found('No account with that id.')

    # states

    def main_info(self):
        return read_file(self.main_path)

    def state_of(self, target, info, main):
        if info['broken']:
            return 'broken'
        if info['symlink'] and os.path.realpath(str(target['path'])) == os.path.realpath(str(self.main_path)):
            return 'linked'
        if not info['exists']:
            return 'missing'
        if not info['readable']:
            return 'unreadable'
        if main['digest'] is None:
            return 'differs'
        if info['digest'] == main['digest']:
            return 'in-sync'
        synced = target.get('record', {}).get('syncedDigest')
        if synced and info['digest'] == synced:
            return 'behind'
        return 'edited' if synced else 'differs'

    def notes(self, target, info):
        notes = []
        if info['symlink'] and not info['broken']:
            real = os.path.realpath(str(target['path']))
            if real != os.path.realpath(str(self.main_path)):
                notes.append('A symlink to %s; syncing writes that file.' % self.display(real))
        if target['kind'] == 'codex' and (self.home / '.codex/AGENTS.override.md').exists():
            notes.append('~/.codex/AGENTS.override.md takes precedence over this file.')
        if target['kind'] == 'gemini':
            for extra in GEMINI_EXTRA:
                if (self.home / extra).exists():
                    notes.append('Antigravity also reads ~/%s.' % extra)
        return notes

    def evaluate(self, target, state, main):
        record = state['targets'].get(target['id'], {})
        target['record'] = record
        info = read_file(target['path'])
        target['info'] = info
        target['state'] = self.state_of(target, info, main)
        return target

    def row(self, target):
        info, record = target['info'], target['record']
        return {
            'id': target['id'],
            'kind': target['kind'],
            'label': target['label'],
            'defaultLabel': target['defaultLabel'],
            'folder': self.display(self.home / target['folderName']),
            'fileName': target['fileName'],
            'path': str(target['path']),
            'displayPath': self.display(target['path']),
            'state': target['state'],
            'excluded': record.get('excluded') is True,
            'exists': info['exists'],
            'symlink': info['symlink'],
            'digest': info['digest'],
            'bytes': info['bytes'],
            'lines': info['lines'],
            'modifiedAt': iso(info['modified']) if info['modified'] else None,
            'syncedAt': record.get('syncedAt'),
            'notes': self.notes(target, info),
        }

    def snapshot(self, state=None):
        state = state if state is not None else self.read_state()
        main = self.main_info()
        rows = [self.row(self.evaluate(target, state, main)) for target in self.discover()]
        counts = {'total': len(rows), 'inSync': 0, 'needsSync': 0, 'edited': 0, 'excluded': 0, 'blocked': 0}
        buckets = {'in-sync': 'inSync', 'linked': 'inSync', 'missing': 'needsSync', 'behind': 'needsSync',
                   'edited': 'edited', 'differs': 'edited', 'broken': 'blocked', 'unreadable': 'blocked'}
        for row in rows:
            counts['excluded' if row['excluded'] else buckets[row['state']]] += 1
        return {
            'revision': state['revision'],
            'main': {
                'exists': main['exists'],
                'readable': main['readable'] or not main['exists'],
                'path': str(self.main_path),
                'displayPath': self.display(self.main_path),
                'text': main['text'],
                'digest': main['digest'],
                'bytes': main['bytes'] if main['exists'] else 0,
                'lines': main['lines'],
                'savedAt': state['savedAt'] if main['exists'] else None,
            },
            'targets': rows,
            'counts': counts,
            'backupsDir': self.display(self.backups_dir),
            'canManage': True,
        }

    def target_detail(self, identifier):
        state = self.read_state()
        main = self.main_info()
        target = self.evaluate(self.find(identifier), state, main)
        return {'target': {**self.row(target), 'text': target['info']['text']}}

    # changes

    def _record(self, state, identifier):
        return state['targets'].setdefault(identifier, {'syncedDigest': None, 'syncedAt': None, 'excluded': False})

    def _mark_synced(self, state, identifier, digest):
        record = self._record(state, identifier)
        record['syncedDigest'] = digest
        record['syncedAt'] = iso(self.now())

    def _record_matches(self, state, main):
        """Remember every account that already holds main's text, synced or
        not, so a later change to the main copy finds it behind rather than
        holding text of its own."""
        if not main['digest']:
            return
        for target in self.discover():
            self.evaluate(target, state, main)
            if target['state'] == 'in-sync' and target['record'].get('syncedDigest') != main['digest']:
                self._mark_synced(state, target['id'], main['digest'])

    def _write_main(self, data, state, backups):
        current = self.main_info()
        if current['broken']:
            raise conflict('%s is a symlink to a file that is not there.' % self.display(self.main_path))
        self._record_matches(state, current)
        if current['exists'] and current['data'] == data:
            return
        if current['exists']:
            backups.copy(self.main_path, 'main-%s' % MAIN_NAME)
        atomic_write(self.main_path, data)
        self._record_matches(state, self.main_info())

    def save_main(self, text, base_digest, revision=None):
        if not isinstance(text, str):
            raise invalid('text must be a string.')
        if base_digest is not None and not isinstance(base_digest, str):
            raise invalid('baseDigest must be a digest or null.')
        try:
            data = text.encode('utf-8')
        except UnicodeEncodeError:
            raise invalid('text must be valid UTF-8.') from None
        if len(data) > MAX_BYTES:
            raise invalid('The main copy can be at most 256 KB.')
        with self.mutation(revision) as backups:
            state = backups.state
            current = self.main_info()['digest']
            if base_digest != current:
                raise conflict('The main copy changed since you started editing.', digest=current)
            self._write_main(data, state, backups)
            state['savedAt'] = iso(self.now())
        return backups.snapshot

    def adopt(self, identifier, revision=None):
        if not isinstance(identifier, str):
            raise invalid('target must be an account id.')
        with self.mutation(revision) as backups:
            state = backups.state
            main = self.main_info()
            target = self.evaluate(self.find(identifier), state, main)
            if target['state'] in ('missing', 'broken', 'unreadable'):
                raise conflict('That account has no readable text to use.')
            data = target['info']['data']
            self._write_main(data, state, backups)
            state['savedAt'] = iso(self.now())
            self._mark_synced(state, identifier, digest_of(data))
        return backups.snapshot

    def exclude(self, identifier, excluded, revision=None):
        if not isinstance(identifier, str):
            raise invalid('target must be an account id.')
        if not isinstance(excluded, bool):
            raise invalid('excluded must be true or false.')
        with self.mutation(revision) as change:
            state = change.state
            self.find(identifier)
            self._record(state, identifier)['excluded'] = excluded
        return change.snapshot

    def sync(self, identifiers=None, overwrite=False, revision=None, expect=None):
        """expect maps account ids to the digest the caller saw. An account
        whose file has changed since is skipped, so a confirm only ever
        replaces the text it described."""
        if expect is not None and (not isinstance(expect, dict) or not all(
                isinstance(key, str) and (value is None or isinstance(value, str)) for key, value in expect.items())):
            raise invalid('expect must map account ids to digests.')
        if identifiers is not None and (not isinstance(identifiers, list)
                                        or not all(isinstance(item, str) for item in identifiers)):
            raise invalid('targets must be a list of account ids.')
        if not isinstance(overwrite, bool):
            raise invalid('overwrite must be true or false.')
        with self.mutation(revision) as backups:
            state = backups.state
            main = self.main_info()
            if not main['exists']:
                raise conflict('Save a main copy before syncing.')
            if not main['readable']:
                raise conflict('The main copy is not readable UTF-8 text under 256 KB.')
            targets = self.discover()
            skipped, written = [], []
            if identifiers is None:
                considered = []
                for target in targets:
                    if state['targets'].get(target['id'], {}).get('excluded'):
                        self.evaluate(target, state, main)
                        skipped.append({'id': target['id'], 'state': target['state'], 'reason': EXCLUDED_REASON})
                    else:
                        considered.append(target)
            else:
                considered = []
                for identifier in dict.fromkeys(identifiers):
                    considered.append(self.find(identifier, targets))
            for target in considered:
                # Evaluated one at a time: an earlier write may have changed
                # this file too, when two targets link to the same one.
                self.evaluate(target, state, main)
                current = target['state']
                if expect is not None and target['id'] in expect and expect[target['id']] != target['info']['digest']:
                    skipped.append({'id': target['id'], 'state': current, 'reason': MOVED_REASON})
                    continue
                if current in WRITES or (overwrite and current in OVERWRITES):
                    try:
                        if os.path.exists(target['path']):
                            backups.copy(target['path'], '%s-%s' % (safe_id(target['id']), target['fileName']))
                        atomic_write(target['path'], main['data'])
                    except OSError:
                        skipped.append({'id': target['id'], 'state': current, 'reason': WRITE_FAILED_REASON})
                        continue
                    self._mark_synced(state, target['id'], main['digest'])
                    written.append(target['id'])
                    continue
                if current == 'in-sync' and target['record'].get('syncedDigest') != main['digest']:
                    self._mark_synced(state, target['id'], main['digest'])
                skipped.append({'id': target['id'], 'state': current, 'reason': REASONS[current]})
        snapshot = backups.snapshot
        snapshot['result'] = {'written': written, 'skipped': skipped, 'backups': backups.made}
        return snapshot
