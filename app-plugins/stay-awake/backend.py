"""Stay awake routes and the caffeinate they hold, while the plugin is enabled.

Only the instance that owns Orc.app holds the Mac awake, so a preview or test
server never keeps a caffeinate running. A watch thread re-applies the saved
setting every few seconds: it picks up a Settings save and replaces a
caffeinate that died.
"""
import json
import threading

from . import keeper

WATCH_SECONDS = 5


class Service:
    def __init__(self, context, holder=None):
        self.context = context
        self.owns = context.get('owns_native_app') is True
        self.keeper = holder or keeper.Keeper()
        self.stopped = threading.Event()
        self.lock = threading.Lock()
        self.thread = None
        if self.owns:
            self.apply()
            self.thread = threading.Thread(target=self.watch, name='stay-awake', daemon=True)
            self.thread.start()

    def watch(self):
        while not self.stopped.wait(WATCH_SECONDS):
            self.apply()

    def apply(self, config=None):
        if config is None:
            config = self.context['read_config']()[0]
        wanted = self.owns and keeper.enabled(config) and self.context['is_enabled']()
        with self.lock:
            self.keeper.sync(wanted and not self.stopped.is_set())

    def status(self, config):
        return {'enabled': keeper.enabled(config), 'available': self.owns,
                'active': self.keeper.active, 'error': self.keeper.error}

    def handle(self, handler, method, path):
        if path != '/api/stay-awake' or method not in ('GET', 'POST'):
            return False
        if method == 'GET':
            config = self.context['read_config']()[0]
            self.apply(config)
            return self.respond(handler, self.status(config))
        # A preview or second instance would save the answer without the
        # default instance ever applying it.
        if not self.owns:
            handler.json_error(409, 'Stay awake runs only in the main Orc app')
            return True
        data = handler.read_json_object(1024)
        if data is None or not isinstance(data.get('enabled'), bool):
            handler.json_error(400, 'expected {enabled: boolean}')
            return True
        if self.context['read_config']()[1]:
            handler.json_error(409, 'config.json has a syntax error on disk — refusing to overwrite; fix it by hand and retry')
            return True

        def turn(config):
            ui = config.get('ui') if isinstance(config.get('ui'), dict) else {}
            if data['enabled']:
                ui['stayAwake'] = True
            else:
                ui.pop('stayAwake', None)
            config['ui'] = ui
            return config

        try:
            self.context['update_config'](turn)
        except OSError as error:
            handler.json_error(409 if 'syntax error' in str(error) else 500, str(error))
            return True
        config = self.context['read_config']()[0]
        self.apply(config)
        return self.respond(handler, self.status(config))

    def respond(self, handler, payload):
        handler._respond(200, json.dumps(payload).encode(), 'application/json', {'Cache-Control': 'no-store'})
        return True

    def deactivate(self):
        with self.lock:
            self.stopped.set()
            self.keeper.sync(False)
        return True


def activate(context):
    return Service(context)
