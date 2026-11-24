import json
import os
from urllib.parse import parse_qs

import run_files
from . import actions


class Service:
    def __init__(self, context):
        self.context = context

    def respond(self, handler, body):
        handler._respond(200, json.dumps(body).encode(), 'application/json', {'Cache-Control': 'no-store'})
        return True

    def handle(self, handler, method, path):
        if path != '/api/files-browser/actions' or method not in ('GET', 'POST'):
            return False
        can_manage = handler._secret_entry_local()
        try:
            if method == 'POST':
                if not can_manage:
                    handler.json_error(403, 'Configure file actions on this computer.')
                    return True
                value = handler.read_json_object(512 * 1024)
                if value is None:
                    return True
                settings = actions.validate(value)

                def update(config):
                    ui = config.get('ui') if isinstance(config.get('ui'), dict) else {}
                    config['ui'] = {**ui, 'filesBrowser': settings}
                    return config

                self.context['update_config'](update)
            config, error = self.context['read_config']()
            if error:
                raise ValueError('config.json has a syntax error. Fix it and retry.')
            return self.respond(handler, {**actions.read(config), 'presets': actions.PRESETS, 'canManage': can_manage})
        except (ValueError, OSError) as error:
            handler.json_error(400 if isinstance(error, ValueError) else 409, str(error))
            return True

    def read_files(self, handler, run_id, suffix):
        meta = self.context['run_meta'](run_id)
        root = self.context['terminal_cwd'](meta)
        if not root and suffix != '/file':
            handler.json_error(404, 'this run has no checkout on disk', False)
            return True
        query = parse_qs(handler.path.partition('?')[2])
        path = (query.get('path') or [''])[0]
        try:
            if suffix == '/remote-url':
                body = run_files.remote_url(root, path)
            elif suffix == '/file':
                body = run_files.read_file(root, path, lambda full: self.context['changed_by_session'](meta, full))
            elif 'q' in query:
                body = run_files.search(root, query['q'][0])
            else:
                body = run_files.list_directory(root, path)
            body['root'] = os.path.basename(os.path.realpath(root)) if root else ''
            return self.respond(handler, body)
        except run_files.FilesError as error:
            handler.json_error(error.status, error.message, False)
            return True

    def open_file(self, handler, run_id, options):
        try:
            config, error = self.context['read_config']()
            if error:
                raise ValueError('config.json has a syntax error. Fix it and retry.')
            settings = actions.read(config)
            identifier = options.get('action', options.get('editor', settings['defaultAction']))
            action = next((item for item in settings['actions'] if item['id'] == identifier), None)
            if not action:
                raise ValueError('This file action is no longer configured. Choose another action.')
            root = self.context['run_cwd'](run_id, self.context['run_meta'](run_id))
            if not root:
                handler.json_error(409, 'no checkout directory for this run')
                return True
            target = run_files.existing_target(root, options.get('path', ''))
            tab = self.context['launch_terminal_tab'](run_id, root, actions.command(action, target),
                                                       action['name'] + ' ' + os.path.basename(target))
            return self.respond(handler, dict(tab, ok=True, editor=action['id']))
        except run_files.FilesError as error:
            handler.json_error(error.status, error.message, False)
        except ValueError as error:
            handler.json_error(400, str(error), False)
        except OSError as error:
            handler.json_error(500, str(error))
        return True

    def deactivate(self):
        return True


def activate(context):
    return Service(context)
