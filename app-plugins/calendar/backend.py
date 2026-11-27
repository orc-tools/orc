"""Calendar routes exist only while the application plugin is enabled.

Connecting a calendar, signing in to Google and every change to an event
happen only in Orc on this Mac. Paired devices read the meetings.
"""
import html
import json
import subprocess
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import keychain_secrets
import windows_host
from . import calendar_source, google_calendar

GOOGLE = '/api/calendar/google'
EVENTS = '/api/calendar/events'
MEETINGS = '/api/calendar/meetings'
CALLBACK = GOOGLE + '/callback'
POSTS = frozenset((
    '/api/calendar/connect', '/api/calendar/disconnect', '/api/calendar/open-both',
    GOOGLE + '/login', GOOGLE + '/client', GOOGLE + '/logout', GOOGLE + '/calendars',
    EVENTS + '/create', EVENTS + '/update', EVENTS + '/delete', EVENTS + '/respond',
))
# The client Orc ships with, so signing in needs no setup. Google treats a
# desktop app's secret as public: it identifies the app and guards nothing.
SHIPPED_CLIENT = Path(__file__).with_name('google-client.json')
CALLBACK_PAGE = '''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>%(title)s · Orc</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32em;margin:18vh auto;padding:0 24px;color:#1c1c1c;background:#fafafa}
h1{font-size:24px;margin:0 0 8px}@media (prefers-color-scheme:dark){body{color:#eee;background:#161616}}</style></head>
<body><h1>%(title)s</h1><p>%(text)s</p></body></html>'''


def shipped_client(path=SHIPPED_CLIENT):
    """(client id, secret) from the file Orc ships, or None while it is blank."""
    try:
        saved = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    client, secret = (saved.get('clientId'), saved.get('clientSecret')) if isinstance(saved, dict) else (None, None)
    if not (isinstance(client, str) and google_calendar.CLIENT_ID.fullmatch(client)):
        return None
    return client, secret if isinstance(secret, str) and google_calendar.CLIENT_SECRET.fullmatch(secret) else None


class Service:
    def __init__(self, context, *, opener=None, shipped=None):
        self.context = context
        self.config = context['home'] / '.orc'
        self.read_secret = context.get('read_secret', keychain_secrets.read)
        self.source = calendar_source.CalendarSource(
            read_secret=self.read_secret,
            save_secret=self.save, delete_secret=self.delete,
            list_names=lambda: [entry['name'] for entry in keychain_secrets.saved(self.config)],
            store=self.config / 'calendar-cache', is_enabled=context['is_enabled'])
        self.shipped = shipped_client() if shipped is None else shipped
        self.login_error = None
        # Counts finished sign-ins, so the page that started one sees it land.
        self.sign_ins = 0
        self.own_secret = None
        kwargs = {'opener': opener} if opener else {}
        self.google = google_calendar.Google(
            client=self.client, read_settings=self.settings, update_settings=self.update_settings,
            read_secret=self.read_secret,
            save_secret=context.get('save_secret', keychain_secrets.save),
            delete_secret=context.get('delete_secret', keychain_secrets.delete),
            is_enabled=context['is_enabled'], **kwargs)

    def save(self, name, value):
        keychain_secrets.save(name, value)
        keychain_secrets.remember(self.config, name)

    def delete(self, name):
        keychain_secrets.delete(name)
        keychain_secrets.forget(self.config, name)

    # --- Google settings: config.json's calendar.google ---------------------

    def settings(self):
        read = self.context.get('read_config')
        config = read()[0] if read else {}
        section = config.get('calendar') if isinstance(config, dict) else None
        google = section.get('google') if isinstance(section, dict) else None
        return google if isinstance(google, dict) else {}

    def update_settings(self, transform):
        def change(config):
            section = dict(config['calendar']) if isinstance(config.get('calendar'), dict) else {}
            google = transform(dict(section['google']) if isinstance(section.get('google'), dict) else {})
            if google:
                section['google'] = google
            else:
                section.pop('google', None)
            if section:
                config['calendar'] = section
            else:
                config.pop('calendar', None)
            return config
        self.context['update_config'](change)

    def own_client_id(self):
        value = self.settings().get('clientId')
        return value if isinstance(value, str) and google_calendar.CLIENT_ID.fullmatch(value) else None

    def client(self):
        """The sign-in app in use: the person's own when they pasted one, else the one Orc ships."""
        own = self.own_client_id()
        if not own:
            return self.shipped
        if self.own_secret is None:
            self.own_secret = self.read_secret(google_calendar.CLIENT_SECRET_NAME) or ''
        return own, self.own_secret or None

    def save_client(self, data):
        client = data.get('clientId')
        secret = data.get('clientSecret')
        client = client.strip() if isinstance(client, str) else ''
        secret = secret.strip() if isinstance(secret, str) else ''
        if client and not google_calendar.CLIENT_ID.fullmatch(client):
            raise google_calendar.GoogleError(400, 'A Google client ID ends in .apps.googleusercontent.com. Copy it from your client in Google Cloud.')
        if client and not google_calendar.CLIENT_SECRET.fullmatch(secret):
            raise google_calendar.GoogleError(400, 'Paste the client secret from the same client in Google Cloud.')
        # Tokens belong to the app that issued them.
        self.google.sign_out_all()
        save = self.context.get('save_secret', keychain_secrets.save)
        delete = self.context.get('delete_secret', keychain_secrets.delete)
        if client:
            save(google_calendar.CLIENT_SECRET_NAME, secret)
        else:
            delete(google_calendar.CLIENT_SECRET_NAME)
        self.own_secret = None

        def change(settings):
            if client:
                settings['clientId'] = client
            else:
                settings.pop('clientId', None)
            return settings
        self.update_settings(change)

    @staticmethod
    def redirect_uri(handler):
        # Google accepts plain HTTP only for a loopback address.
        return 'http://127.0.0.1:%d%s' % (handler.server.server_address[1], CALLBACK)

    # --- routes -------------------------------------------------------------

    def handle(self, handler, method, path):
        if not ((method == 'GET' and path in ('/api/calendar', MEETINGS, CALLBACK)) or (method == 'POST' and path in POSTS)):
            return False
        if not self.context['is_enabled']():
            handler.json_error(404, 'Calendar is disabled.', False)
            return True
        if not self.context.get('allow_network', False):
            handler.json_error(403, 'Calendar connections are unavailable in this preview.', False)
            return True
        if method == 'POST' and not handler._secret_entry_allowed():
            return True
        try:
            if path == CALLBACK:
                return self.callback(handler)
            if path == MEETINGS:
                payload = self.meetings()
            elif method == 'GET':
                payload = self.read(handler)
            else:
                data = handler.read_json_object(32 * 1024)
                if data is None:
                    raise calendar_source.CalendarError('Expected an object.')
                payload = self.post(handler, path, data)
                if payload is None:
                    return True
        except calendar_source.CalendarError as error:
            handler.json_error(400, str(error), False)
            return True
        except google_calendar.GoogleError as error:
            body = {'error': str(error), 'code': error.code}
            handler._respond(error.status, json.dumps(body).encode(), 'application/json', {'Cache-Control': 'no-store'})
            return True
        except (keychain_secrets.SecretError, OSError, subprocess.SubprocessError):
            handler.json_error(503, 'The Keychain is unavailable.', True)
            return True
        handler._respond(200, json.dumps(payload).encode(), 'application/json', {'Cache-Control': 'no-store'})
        return True

    def read(self, handler):
        query = parse_qs(urlsplit(handler.path).query)
        start = calendar_source.parse_instant((query.get('from') or [''])[0])
        end = calendar_source.parse_instant((query.get('to') or [''])[0])
        payload = self.source.events(start, end)
        local = handler._secret_entry_local()
        accounts, calendars, events = self.google.snapshot(start, end)
        if accounts:
            payload['connected'] = True
            payload['calendars'] = payload.get('calendars', []) + calendars
            payload['events'] = sorted(payload['events'] + events,
                                       key=lambda item: (not item['allDay'], item['start'], item['title'], item['id']))
        payload['canConnect'] = local
        payload['canEdit'] = local
        payload['granola'] = local and calendar_source.granola_installed()
        own = self.own_client_id()
        payload['google'] = {
            'configured': bool(own or self.shipped), 'shipped': bool(self.shipped), 'ownClient': bool(own),
            'clientId': own if local else None, 'redirectUri': self.redirect_uri(handler) if local else None,
            'accounts': accounts, 'maxAccounts': google_calendar.MAX_ACCOUNTS, 'error': self.login_error,
            'signIns': self.sign_ins,
        }
        return payload

    def meetings(self):
        """The day's meetings on every calendar shown, iCal feeds and Google accounts alike."""
        start, end = self.source.meeting_window()
        found = self.source.events(start, end)
        accounts, _calendars, events = self.google.snapshot(start, end)
        return {'connected': found['connected'] or bool(accounts),
                'meetings': calendar_source.meetings(found['events'] + events)}

    def upcoming(self):
        """The day's meetings with their titles, guests and descriptions, for
        Orc's own use on this Mac, such as a vault page that preps for them.
        None while no calendar can be read here. No route serves this."""
        if not self.context['is_enabled']() or not self.context.get('allow_network', False):
            return None
        start, end = self.source.meeting_window()
        found = self.source.events(start, end)
        accounts, calendars, events = self.google.snapshot(start, end)
        if not (found['connected'] or accounts):
            return None
        names = {calendar['id']: calendar['name'] for calendar in found.get('calendars', []) + calendars}
        return calendar_source.upcoming(found['events'] + events, names)

    def post(self, handler, path, data):
        if path.endswith('/connect'):
            return {'ok': True, 'id': self.source.connect(data.get('url'))}
        if path.endswith('/disconnect'):
            self.source.disconnect(data.get('id'))
            return {'ok': True}
        if path.endswith('/open-both'):
            for link in calendar_source.meeting_links(data):
                if not self.open(link):
                    handler.json_error(500, 'Could not open the meeting. Try its Join link.', False)
                    return None
            return {'ok': True}
        if path == GOOGLE + '/login':
            self.login_error = None
            url = self.google.login_url(self.redirect_uri(handler))
            # Google refuses to sign in inside an app's own web view, so the
            # system browser takes it and comes back to the callback route.
            return {'ok': True, 'opened': self.open(url), 'url': url}
        if path == GOOGLE + '/client':
            self.save_client(data)
            self.login_error = None
            return {'ok': True}
        if path == GOOGLE + '/logout':
            self.google.sign_out(self.account(data))
            return {'ok': True}
        if path == GOOGLE + '/calendars':
            match = google_calendar.REFERENCE.fullmatch(data.get('id')) if isinstance(data.get('id'), str) else None
            if not match:
                raise google_calendar.GoogleError(400, 'That is not a calendar of a signed-in account.')
            self.google.show(int(match.group(1)), match.group(2), data.get('shown'))
            return {'ok': True}
        calendar, event = data.get('calendarId'), data.get('eventId')
        scope = data.get('scope', 'this')
        if path == EVENTS + '/create':
            return {'ok': True, 'event': self.google.create(calendar, data)}
        if path == EVENTS + '/update':
            return {'ok': True, 'event': self.google.update(calendar, event, data, scope)}
        if path == EVENTS + '/respond':
            return {'ok': True, 'event': self.google.respond(calendar, event, data.get('response'), scope)}
        self.google.delete(calendar, event, scope, data.get('notify') is True)
        return {'ok': True}

    @staticmethod
    def account(data):
        value = data.get('account')
        if not (isinstance(value, str) and len(value) == 1 and value in '12345'):
            raise google_calendar.GoogleError(400, 'That is not a signed-in Google account.')
        return int(value)

    @staticmethod
    def open(link):
        try:
            opened = windows_host.open_link(link)
        except (OSError, subprocess.SubprocessError):
            return False
        return not opened.returncode

    def callback(self, handler):
        if not handler._secret_entry_local():
            handler.json_error(403, 'Sign in to Google from Orc on this Mac.', False)
            return True
        query = parse_qs(urlsplit(handler.path).query)
        email = None
        if query.get('error'):
            self.login_error = ('You did not allow Orc to use Google Calendar.' if query['error'][0] == 'access_denied'
                                else 'Google did not sign you in.')
        else:
            try:
                email = self.google.finish_login((query.get('state') or [''])[0], (query.get('code') or [''])[0])
                self.login_error = None
                self.sign_ins += 1
            except google_calendar.GoogleError as error:
                self.login_error = str(error)
        page = CALLBACK_PAGE % ({'title': 'Google Calendar is connected',
                                 'text': '%s is signed in. Close this tab and go back to Orc.' % html.escape(email)}
                                if email else {'title': 'Google Calendar was not connected',
                                               'text': '%s Go back to Orc to try again.' % html.escape(self.login_error)})
        handler._respond(200 if email else 400, page.encode(), 'text/html; charset=utf-8', {
            'Cache-Control': 'no-store',
            'Content-Security-Policy': "frame-ancestors 'none'",
            'X-Frame-Options': 'DENY',
        })
        return True

    def deactivate(self):
        return self.source.stop()


def activate(context):
    return Service(context)
