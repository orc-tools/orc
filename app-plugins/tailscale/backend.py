"""The Tailscale plugin's routes: setup checks, phone access and shared plans.

Only Orc on this Mac, on the instance behind Orc.app, may read or change
them (``handler._host_owner()``); a paired phone or a preview sees nothing.
The routes come back on their own when that instance starts, as they did
when this lived in core.
"""
import json
import re
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from . import share_server
from . import tailscale_access as access

RUN_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,200}')
HOST_ONLY = 'Manage Tailscale in Orc on the host machine.'


class Service:
    def __init__(self, context):
        self.context = context
        config_dir = Path(context['config_dir']())
        self.shares = share_server.Store(config_dir / 'shares')
        self.manager = access.Manager(config_dir, access.Backends(
            context['make_server'], lambda address: share_server.make_server(self.shares, address)))
        if context.get('owns_native_app') is True:
            threading.Thread(target=self.restore, name='tailscale-restore', daemon=True).start()

    def restore(self):
        try:
            self.shares.prune()
        except OSError:
            pass
        self.manager.restore()

    # Core reaches these through APP_PLUGIN_RUNTIME.invoke.
    def phone_url(self):
        return self.manager.phone_url()

    def private_phone_url(self, value):
        return access.private_phone_url(value)

    def close(self):
        self.manager.backends.close()
        return True

    def deactivate(self):
        self.manager.backends.close()
        self.manager.suspend_public()
        return True

    # ------------------------------------------------------------------ HTTP
    def handle(self, handler, method, path):
        if path != '/api/tailscale' and not path.startswith('/api/tailscale/'):
            return False
        action = path[len('/api/tailscale/'):] if path.startswith('/api/tailscale/') else ''
        if not handler._host_owner():
            if method == 'GET' and action == '':
                self.respond(handler, {'eligible': False, 'error': HOST_ONLY})
            else:
                handler.json_error(403, 'manage Tailscale in Orc on the host machine', False)
            return True
        try:
            if method == 'GET':
                if action == '':
                    return self.respond(handler, self.status())
                if action == 'setup':
                    return self.respond(handler, {'steps': access.setup_steps(), **self.status()})
                if action == 'share':
                    return self.respond(handler, self.share_state(self.query_run(handler)))
                handler.send_error(404)
                return True
            if method != 'POST':
                handler.send_error(405)
                return True
            if action == 'pairing-code':
                if Path(self.context['pairing_code_path']()).exists():
                    return self.respond(handler, {'customCodeSet': True})
                return self.respond(handler, self.context['new_pairing_code']())
            if action == 'share':
                return self.respond(handler, self.share(self.body_run(handler)))
            if action == 'share-stop':
                run_id = self.body_run(handler)
                self.shares.stop(run_id)
                return self.respond(handler, self.share_state(run_id))
            if action == 'sign-out-all':
                self.context['sign_out_all_devices']()
            elif action in ('phone-enable', 'phone-disable',
                            'share-enable', 'share-disable'):
                channel, operation = action.split('-')
                self.manager.change(channel, operation == 'enable')
            else:
                handler.send_error(404)
                return True
            return self.respond(handler, self.status())
        except ValueError as exc:  # AccessError and ShareError are both ValueErrors
            handler.json_error(409, str(exc), False)
            return True
        except OSError as exc:
            handler.json_error(409, str(exc), False)
            return True

    def status(self):
        status = self.manager.status()
        status['customCodeSet'] = Path(self.context['pairing_code_path']()).exists()
        return status

    @staticmethod
    def respond(handler, value):
        handler.send_body(json.dumps(value).encode(), 'application/json')
        return True

    @staticmethod
    def query_run(handler):
        values = parse_qs(urlsplit(handler.path).query).get('run') or ['']
        if not RUN_ID.fullmatch(values[0]):
            raise access.AccessError('Choose a run.')
        return values[0]

    @staticmethod
    def body_run(handler):
        data = handler.read_json_object(4096) or {}
        run_id = data.get('runId')
        if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
            raise access.AccessError('Choose a run.')
        return run_id

    # --------------------------------------------------------------- sharing
    def share_state(self, run_id):
        status = self.manager.status()
        entry = status.get('share') or {}
        found = self.shares.get(run_id)
        origin = entry.get('url', '').rstrip('/') if entry.get('running') and entry.get('url') else None
        return {
            'available': bool(origin),
            'enabled': bool(entry.get('enabled')),
            'error': entry.get('error'),
            'share': {**found, 'url': origin + found['path']} if found and origin else None,
        }

    def share(self, run_id):
        state = self.share_state(run_id)
        if not state['available']:
            raise access.AccessError('Turn on Share plans by link in Tailscale settings first.')
        run_dir = Path(self.context['runs_dir']()) / run_id
        if not run_dir.is_dir():
            raise access.AccessError('That run is gone.')
        meta = self.context['run_meta'](run_id) or {}
        title = meta.get('title') if isinstance(meta.get('title'), str) else run_id
        self.shares.share(run_id, run_dir, title)
        return self.share_state(run_id)


def activate(context):
    return Service(context)
