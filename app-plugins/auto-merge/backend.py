"""Auto merge: a run whose Chat turned it on takes its project's Ship action
the moment it reaches its Ship stop. Core's watch loop calls `watch_tick`;
core's `ship_at_landing_stop` does the delivery, so this package only keeps
each run's choice and the outcome of the last attempt."""
import glob
import json
import os
import re
import sys
import tempfile
import time

# New names on purpose: the toggle core used to have left `auto-merge.json`
# in some runs, and those must not ship the moment this package is enabled.
CHOICE_FILE = 'auto-merge-choice.json'
ATTEMPT_FILE = 'auto-merge-attempt.json'
ROUTE = re.compile(r'^/api/auto-merge/runs/([A-Za-z0-9][A-Za-z0-9._-]{0,199})$')


def _now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def _read(path):
    try:
        with open(path) as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write(path, data):
    descriptor, temporary = tempfile.mkstemp(dir=os.path.dirname(path), prefix='.auto-merge-')
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


class Service:
    def __init__(self, context):
        self.context = context

    def _runs(self):
        return str(self.context['runs_dir']())

    def _run_dir(self, run_id):
        return os.path.join(self._runs(), run_id)

    def enabled(self, run_id):
        return _read(os.path.join(self._run_dir(run_id), CHOICE_FILE)).get('enabled') is True

    def set_enabled(self, run_id, enabled):
        """Turning it on again clears a stopped attempt, so the next tick
        tries the Ship action once more. Core also calls this when the
        composer starts a run with Auto merge on; it returns True so core can
        tell a saved choice from a package that is off."""
        run_dir = self._run_dir(run_id)
        _remove(os.path.join(run_dir, ATTEMPT_FILE))
        if enabled:
            _write(os.path.join(run_dir, CHOICE_FILE),
                   {'schemaVersion': 1, 'runId': run_id, 'enabled': True, 'updatedAt': _now()})
        else:
            _remove(os.path.join(run_dir, CHOICE_FILE))
        return True

    def available(self, meta):
        """A review run never reaches Ship, so its Chat offers no Auto merge."""
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
        """Ship every run that has Auto merge on and is waiting at its Ship
        stop, once per delivery authority."""
        if not self.context['is_enabled']():
            return
        for path in glob.glob(os.path.join(self._runs(), '*', CHOICE_FILE)):
            run_id = os.path.basename(os.path.dirname(path))
            attempt_path = os.path.join(self._run_dir(run_id), ATTEMPT_FILE)
            result = self.context['ship_at_landing_stop'](
                run_id, skip_digest=_read(attempt_path).get('digest'),
                wanted=lambda run_id=run_id: self.enabled(run_id))
            if result is None:
                continue
            try:
                _write(attempt_path, {**result, 'updatedAt': _now()})
            except OSError as error:
                print('Auto merge %s: could not record the attempt: %s' % (run_id, error), file=sys.stderr)
            if result.get('error'):
                print('Auto merge %s: %s' % (run_id, result['error']), file=sys.stderr)

    def handle(self, handler, method, path):
        match = ROUTE.match(path.split('?', 1)[0])
        if not match or method not in ('GET', 'POST'):
            return False
        run_id = match.group(1)
        if not os.path.isdir(self._run_dir(run_id)):
            handler.json_error(404, 'no such run', False)
            return True
        if method == 'POST':
            # Turning it on consents to delivery, so only Orc's own pages may,
            # never a cross-site page or an MCP/bot request.
            if (not self.context['origin_may_mutate'](handler.headers)
                    or self.context['is_app_request'](handler)):
                handler.json_error(403, 'Turn Auto merge on or off from the run’s Chat in Orc.', False)
                return True
            options = handler.read_json_object(4096)
            if options is None or not isinstance(options.get('enabled'), bool):
                handler.json_error(400, 'expected {enabled: true|false}', False)
                return True
            with self.context['run_mutation_lock'](run_id):
                if not self.context['run_is_live'](run_id):
                    handler.json_error(409, 'this run has already finished', False)
                    return True
                if options['enabled'] and not self.available(self.context['run_meta'](run_id) or {}):
                    handler.json_error(400, 'A review run never ships, so it has no Auto merge.', False)
                    return True
                try:
                    self.set_enabled(run_id, options['enabled'])
                except OSError:
                    handler.json_error(500, 'could not save Auto merge')
                    return True
        handler._respond(200, json.dumps(self.view(run_id)).encode(), 'application/json',
                         {'Cache-Control': 'no-store'})
        return True

    def deactivate(self):
        return True

    def resume(self):
        return True


def activate(context):
    return Service(context)
