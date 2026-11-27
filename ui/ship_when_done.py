"""Ship when done: a run whose Chat turned it on starts its build automatically
once its plan completes (carrying Ship when done onto the launched build run),
and takes its project's Ship action the moment it reaches its Ship stop. Core's
watch loop calls `watch_tick`; `start_plan_at_plan_stop` and
`ship_at_landing_stop` do the work, so this service keeps each run's choice,
the outcome of the last attempt, and each time the choice was turned on or off,
which Chat shows as badges."""
import glob
import json
import os
import re
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone

# Kept names on purpose so in-flight runs keep their choice, attempt and flip
# history across the move from the Auto merge plugin; legacy `auto-merge.json`
# is still ignored.
CHOICE_FILE = 'auto-merge-choice.json'
ATTEMPT_FILE = 'auto-merge-attempt.json'
CHANGES_FILE = 'auto-merge-changes.json'
CHANGES_MAX = 200
CHANGE_ID = re.compile(r'[a-f0-9]{32}\Z')
ROUTE = re.compile(r'^/api/(?:ship-when-done|auto-merge)/runs/([A-Za-z0-9][A-Za-z0-9._-]{0,199})$')


def _now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def _moment():
    """Now, to the millisecond: Chat places a change between transcript items by it."""
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def _read(path):
    try:
        with open(path) as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write(path, data):
    descriptor, temporary = tempfile.mkstemp(dir=os.path.dirname(path), prefix='.ship-when-done-')
    try:
        with os.fdopen(descriptor, 'w') as handle:
            json.dump(data, handle)
        os.replace(temporary, path)
    except OSError:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _remove(path):
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def migrate_plugin_choice(plugin_state_path, read_config, update_config):
    """Carry over an older Auto merge plugin opt-out once before the plugin
    record is pruned: if the plugin was installed and disabled, set
    `offerShipWhenDone: false` unless `offerShipWhenDone` is already in config."""
    state = _read(plugin_state_path)
    installed = state.get('installed')
    if not isinstance(installed, dict):
        return False
    record = installed.get('auto-merge')
    if not isinstance(record, dict) or record.get('enabled') is not False:
        return False
    config, _, broken = read_config()
    if broken or not isinstance(config, dict) or 'offerShipWhenDone' in config:
        return False
    update_config(lambda current: {**current, 'offerShipWhenDone': False}
                  if isinstance(current, dict) and 'offerShipWhenDone' not in current else current)
    return True


class Service:
    def __init__(self, context):
        self.context = context

    def _runs(self):
        return str(self.context['runs_dir']())

    def _run_dir(self, run_id):
        return os.path.join(self._runs(), run_id)

    def enabled(self, run_id):
        return _read(os.path.join(self._run_dir(run_id), CHOICE_FILE)).get('enabled') is True

    def changes(self, run_id):
        """Each time this run's Ship when done was turned on or off, oldest
        first: `{id, at, enabled}`. Chat receives them as `autoMergeChanges`."""
        saved = _read(os.path.join(self._run_dir(run_id), CHANGES_FILE)).get('changes')
        return [entry for entry in saved if isinstance(entry, dict)] if isinstance(saved, list) else []

    def _record_change(self, run_id, enabled, change_id):
        """Keep one flip. The choice is already saved, so a failure here is
        only printed."""
        changes = self.changes(run_id)
        if not change_id or any(entry.get('id') == change_id for entry in changes):
            change_id = uuid.uuid4().hex
        change = {'id': change_id, 'at': _moment(), 'enabled': enabled}
        try:
            _write(os.path.join(self._run_dir(run_id), CHANGES_FILE),
                   {'schemaVersion': 1, 'changes': [*changes, change][-CHANGES_MAX:]})
        except OSError as error:
            print('Ship when done %s: could not record the change: %s' % (run_id, error), file=sys.stderr)
            return None
        return change

    def set_enabled(self, run_id, enabled):
        """Turning it on again clears a stopped attempt, so the next tick
        tries the Ship action once more."""
        self.change(run_id, enabled)
        return True

    def change(self, run_id, enabled, change_id=None):
        """Save the choice and return the flip it recorded for Chat, under the
        id the page drew its badge with, or None when nothing changed."""
        run_dir = self._run_dir(run_id)
        changed = self.enabled(run_id) is not enabled
        _remove(os.path.join(run_dir, ATTEMPT_FILE))
        if enabled:
            _write(os.path.join(run_dir, CHOICE_FILE),
                   {'schemaVersion': 1, 'runId': run_id, 'enabled': True, 'updatedAt': _now()})
        else:
            _remove(os.path.join(run_dir, CHOICE_FILE))
        return self._record_change(run_id, enabled, change_id) if changed else None

    def available(self, meta):
        """A review run never reaches Ship, so its Chat offers no Ship when done."""
        return not self.context['is_review_run'](meta)

    def view(self, run_id):
        """What Chat's button shows: whether it is offered and on, which Ship
        action it will take, and why the last attempt stopped."""
        attempt = _read(os.path.join(self._run_dir(run_id), ATTEMPT_FILE))
        meta = self.context['run_meta'](run_id) or {}
        is_queued = self.context.get('run_is_merge_queued')
        queued = bool(is_queued(run_id, meta)) if is_queued else False
        error = attempt.get('error') if attempt.get('state') == 'blocked' else None
        if queued or error == 'run is already queued':
            error = None
        return {'available': self.available(meta), 'enabled': self.enabled(run_id),
                'action': self.context['ship_action'](meta),
                'error': error}

    def watch_tick(self):
        """Start the build for any completed plan that has Ship when done on, and
        ship every run waiting at its Ship stop, once per digest."""
        if not self.context['is_enabled']():
            return
        for path in glob.glob(os.path.join(self._runs(), '*', CHOICE_FILE)):
            run_id = os.path.basename(os.path.dirname(path))
            attempt_path = os.path.join(self._run_dir(run_id), ATTEMPT_FILE)
            skip_digest = _read(attempt_path).get('digest')
            wanted = lambda run_id=run_id: self.enabled(run_id)
            result = self.context['ship_at_landing_stop'](
                run_id, skip_digest=skip_digest, wanted=wanted)
            if result is None and self.context.get('start_plan_at_plan_stop'):
                result = self.context['start_plan_at_plan_stop'](
                    run_id, skip_digest=skip_digest, wanted=wanted)
            if result is None:
                continue
            try:
                _write(attempt_path, {**result, 'updatedAt': _now()})
            except OSError as error:
                print('Ship when done %s: could not record the attempt: %s' % (run_id, error), file=sys.stderr)
            if result.get('error'):
                print('Ship when done %s: %s' % (run_id, result['error']), file=sys.stderr)

    def handle(self, handler, method, path):
        match = ROUTE.match(path.split('?', 1)[0])
        if not match or method not in ('GET', 'POST'):
            return False
        run_id = match.group(1)
        answer = {}
        if not os.path.isdir(self._run_dir(run_id)):
            handler.json_error(404, 'no such run', False)
            return True
        if method == 'POST':
            # Turning it on consents to delivery, so only Orc's own pages may,
            # never a cross-site page or an MCP/bot request.
            if (not self.context['origin_may_mutate'](handler.headers)
                    or self.context['is_app_request'](handler)):
                handler.json_error(403, 'Turn Ship when done on or off from the run’s Chat in Orc.', False)
                return True
            options = handler.read_json_object(4096)
            if options is None or not isinstance(options.get('enabled'), bool):
                handler.json_error(400, 'expected {enabled: true|false}', False)
                return True
            change_id = options.get('changeId')
            if change_id is not None and not (isinstance(change_id, str) and CHANGE_ID.match(change_id)):
                handler.json_error(400, 'changeId must be 32 hex characters', False)
                return True
            if options['enabled'] and not self.context['is_enabled']():
                handler.json_error(400, 'Ship when done is turned off. Enable Offer Ship when done in Settings → Projects.', False)
                return True
            with self.context['run_mutation_lock'](run_id):
                if not self.context['run_is_live'](run_id):
                    handler.json_error(409, 'this run has already finished', False)
                    return True
                if options['enabled'] and not self.available(self.context['run_meta'](run_id) or {}):
                    handler.json_error(400, 'A review run never ships, so it has no Ship when done.', False)
                    return True
                try:
                    recorded = self.change(run_id, options['enabled'], change_id)
                except OSError:
                    handler.json_error(500, 'could not save Ship when done')
                    return True
            answer['change'] = recorded
        handler._respond(200, json.dumps({**self.view(run_id), **answer}).encode(), 'application/json',
                         {'Cache-Control': 'no-store'})
        return True
