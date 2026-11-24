"""MCP client routes, which exist only while the plugin is enabled.

The screen at #mcp-client lists projects (projects.py) and throwaway
environments (environments.py). A project's servers are the ones Claude and
Codex have for it (agents.py). An environment is a temporary folder with the
servers pasted into it (servers.py), the servers picked for it from a
project, and the agent chats started in it (chats.py): a chat's agent gets
those servers with what Orc sends each, and no others. Every server is
inspected with the same actions as a run's MCP tab (ui/mcp_inspect.py),
sending it its headers and, once signed in, Orc's own OAuth access token.

Adding, editing, removing and syncing an agent's servers change that agent's
own config (changes.py). Those, opening, renaming and closing an environment,
changing its servers, and signing in or out, happen only in Orc on this Mac,
because they handle secrets and open a browser sign-in. Inspecting a server,
chatting in an environment, and choosing which projects show, also answer
paired devices.

The screen's tabs each hold their own connection to a server: an action and
a read of the servers name their tab, and closing a tab ends its connections.
Closing an environment deletes all of it, and so do 7 days without use.
"""
import json
import re
import threading
import time
from urllib.parse import parse_qs, quote, urlsplit

import keychain_secrets
import mcp_inspect
import mcp_oauth
from . import agents as agents_module
from . import changes as changes_module
from . import chats as chats_module
from . import environments as environments_module
from . import projects as projects_module
from . import servers as store_module

ROOT = '/api/mcp-client'
SERVER = re.compile(r'/api/mcp-client/servers/([a-z0-9]{10})(?:/(remove|sign-in|sign-out))?')
AGENT_SERVER = re.compile(r'/api/mcp-client/agent-servers(?:/([a-z0-9]{10})(?:/(remove|sync))?)?')
TAB = re.compile(r'[a-z0-9]{1,16}')
TAB_CLOSE = re.compile(r'/api/mcp-client/tabs/([a-z0-9]{1,16})/close')
ENVIRONMENT = re.compile(r'/api/mcp-client/environments/([a-z0-9]{8})(?:/(close|chats|picks|candidates))?')
CHAT = re.compile(r'/api/mcp-client/environments/([a-z0-9]{8})/chats/([a-z0-9]{8})(?:/(send|stop))?')
LOGIN_TTL = mcp_oauth.PENDING_TTL
CLIENT_INFO = {'name': 'orc', 'title': 'Orc', 'version': '1.0'}
SCOPE = 'mcp-client'
# A throwaway environment as a request's `project`: this, then its id.
ENVIRONMENT_KEY = 'env:'
# How often Orc looks for environments nobody has used for 7 days while the
# screen is closed. Opening the screen looks too.
TIDY_SECONDS = 6 * 3600


class Missing(store_module.StoreError):
    """A request named a server its project no longer has."""


class Service:
    def __init__(self, context):
        self.context = context
        self.store = store_module.Store(context)
        home = context.get('home') or agents_module.Path.home()
        config_dir = context.get('config_dir')
        self.reader = agents_module.Reader(home, config_dir() if config_dir else None)
        self.projects = projects_module.Projects(context, self.reader)
        self.changes = changes_module.Changes(self.reader, config_dir() if config_dir else home / '.orc')
        self.environments = environments_module.Environments(context, self.store)
        self.chats = chats_module.Chats(context, self.environments, self.chat_servers)
        self.lock = threading.Lock()
        self.tidying = threading.Lock()
        self.timer = None
        self.active = True
        self.logins = {}
        self.challenges = {}
        self.notices = {}
        # The project and address of each server a tab has acted on, by the
        # id its connections are kept under.
        self.live = {}

    @staticmethod
    def redirect_uri(handler):
        # Authorization servers accept plain HTTP for a loopback IP literal.
        return 'http://127.0.0.1:%d%s/callback' % (handler.server.server_address[1], ROOT)

    @staticmethod
    def key(server_id, tab=''):
        return (SCOPE, server_id, tab)

    @staticmethod
    def tab(value):
        """The tab a request names, or '' for a caller that has none."""
        if value is None or value == '':
            return ''
        if not isinstance(value, str) or not TAB.fullmatch(value):
            raise store_module.StoreError('That is not a tab of the MCP client.')
        return value

    def close(self, target):
        """Ends every tab's connection to the server, under whichever
        project it is open: one sign-in serves an address everywhere."""
        address = store_module.address(target['url'])
        with self.lock:
            ids = {server_id for server_id, (_project, at) in self.live.items() if at == address}
        ids.add(target['id'])
        mcp_inspect.close_where(lambda key: key[0] == SCOPE and key[1] in ids)

    def forget(self, target, *, challenge=True):
        """Ends the server's connection and any sign-in it has under way, and
        its last challenge, which described the server as it was."""
        self.close(target)
        with self.lock:
            self.logins = {state: login for state, login in self.logins.items() if login['server'] != target['id']}
            if challenge:
                self.challenges.pop(target['id'], None)

    # -- what a request names --

    def saved_target(self, entry):
        return {'id': entry['id'], 'name': entry['name'], 'url': entry['url'], 'transport': 'http',
                'entry': entry, 'values': {}, 'row': None}

    def row_target(self, row):
        """An agent's server, with the entry that holds Orc's sign-in for
        its address when there is one."""
        http = row['transport'] == 'http'
        return {'id': row['id'], 'name': row['name'], 'url': row['url'] or '', 'transport': row['transport'],
                'entry': self.store.by_url(row['url']) if http else None, 'values': row['values'], 'row': row}

    @staticmethod
    def environment_of(project):
        """The environment a request's project names, or None for a project."""
        if isinstance(project, str) and project.startswith(ENVIRONMENT_KEY):
            return project[len(ENVIRONMENT_KEY):]
        return None

    def project(self, key):
        """The project or throwaway environment a request names."""
        environment = self.environment_of(key)
        if environment is None:
            return self.projects.require(key)
        return ENVIRONMENT_KEY + self.environments.require(environment)['id']

    def targets(self, project):
        """A project's servers as its agents have them. An environment's are
        the ones pasted into it, then the ones picked for it that an agent
        still has."""
        environment = self.environment_of(project)
        if environment is None:
            return [self.row_target(row) for row in self.reader.rows(project)]
        found = [self.saved_target(entry) for entry in self.environments.servers(environment)]
        for pick in self.environments.require(environment)['picks']:
            row = next((row for row in self.reader.rows(pick['project']) if row['id'] == pick['id']), None)
            if row is not None:
                found.append({**self.row_target(row), 'picked': True})
        return found

    def target(self, project, server_id):
        found = next((item for item in self.targets(project) if item['id'] == server_id), None)
        if found is None:
            raise Missing('That MCP server is no longer in this environment.' if self.environment_of(project)
                          else 'That MCP server is no longer in this project.')
        return found

    def callable_target(self, project, server_id):
        """A server Orc itself can connect to, at the address Orc uses for it."""
        target = self.target(project, server_id)
        if target['transport'] != 'http':
            raise store_module.StoreError('Orc calls tools on Streamable HTTP servers only.')
        return {**target, 'url': store_module.clean_url(target['url'])}

    def request_headers(self, target, *, rejected=None):
        """The agent's own headers for the server, under what Orc holds for
        its address: saved headers and the sign-in's access token."""
        entry = target['entry']
        own = self.store.request_headers(entry['id'], entry, rejected=rejected) if entry else {}
        sent = {name.lower() for name in own}
        return {**{name: value for name, value in target['values'].items() if name.lower() not in sent}, **own}

    # -- views --

    def public(self, target, tab=''):
        entry, row = target['entry'] or {}, target['row']
        oauth = entry.get('oauth') if isinstance(entry.get('oauth'), dict) else {}
        tokens = self.store.tokens(entry['id'], entry) if entry else None
        discovery = oauth.get('discovery') if isinstance(oauth.get('discovery'), dict) else {}
        http = target['transport'] == 'http'
        found = {
            'id': target['id'], 'name': target['name'], 'url': target['url'], 'source': 'agents' if row else 'saved',
            'transport': target['transport'],
            'headers': list(entry.get('headers') or []), 'auto': http, 'changed': entry.get('revision', 0),
            'clientId': entry.get('clientId'),
            'signIn': {'signedIn': tokens is not None, 'issuer': discovery.get('issuer') or discovery.get('authorizationServer'),
                       'scope': oauth.get('scope') if tokens else None, 'at': oauth.get('signedInAt') if tokens else None},
            'notice': self.notices.pop(target['id'], None),
            'connection': mcp_inspect.connection_for(self.key(target['id'], tab)) if http else None,
        }
        if row:
            found.update(command=row['command'], env=row['env'], agents=row['agents'], readOnly=row['readOnly'],
                         agentHeaders=row['headers'], picked=target.get('picked') is True)
        return found

    def query(self, handler):
        """The tab and project a request's address names."""
        query = parse_qs(urlsplit(handler.path).query)
        return self.tab((query.get('tab') or [''])[0]), self.project((query.get('project') or [''])[0])

    def public_environment(self, entry):
        """An environment as the screen lists it. ``title`` names a tab
        nobody named: the environment's first server. ``pasted`` counts the
        servers that closing it deletes."""
        used = float(entry.get('usedAt') or 0)
        servers = self.targets(ENVIRONMENT_KEY + entry['id'])
        return {'id': entry['id'], 'key': ENVIRONMENT_KEY + entry['id'], 'name': entry.get('name') or '',
                'title': servers[0]['name'] if servers else '',
                'folder': str(self.environments.folder(entry['id'])),
                'servers': [server['id'] for server in servers],
                'pasted': sum(server['row'] is None for server in servers),
                'chats': [self.chats.public(chat) for chat in entry['chats']],
                'usedAt': used, 'expiresAt': used + environments_module.UNUSED_SECONDS}

    def describe(self, project):
        environment = self.environment_of(project)
        if environment is None:
            return self.projects.describe(project)
        found = self.public_environment(self.environments.require(environment))
        return {'key': project, 'kind': 'environment', 'name': found['name'] or found['title'] or 'New environment',
                'path': None, 'servers': len(found['servers']), 'agents': []}

    def agents(self):
        """Every agent a server can be added to."""
        return [{'id': agent['id'], 'label': agent['label']} for agent in self.reader.agents()]

    def listing(self, handler):
        """The Projects page: the projects, then the environments open now."""
        self.tidy()
        return {**self.projects.listing(), 'agents': self.agents(), 'canManage': handler._secret_entry_local(),
                'environments': [self.public_environment(entry) for entry in self.environments.all()]}

    def view(self, handler):
        """A tab's servers. Reading an environment's counts as using it."""
        tab, project = self.query(handler)
        mcp_inspect.SESSIONS.sweep()
        self.tidy()
        environment = self.environment_of(project)
        if environment is not None:
            self.environments.touch(environment)
        targets = self.targets(project)
        ids = {target['id'] for target in targets}
        with self.lock:
            gone = {server_id for server_id, (owner, _address) in self.live.items()
                    if owner == project and server_id not in ids}
            for server_id in gone:
                del self.live[server_id]
        if gone:
            mcp_inspect.close_where(lambda key: key[0] == SCOPE and key[1] in gone)
        # Sync is for a project's own servers: an environment gives none to an agent.
        lacking = self.changes.lacking(project, [target['row'] for target in targets]) if environment is None else {}
        servers = [{**self.public(target, tab),
                    **({'lacks': [agent['label'] for agent in lacking[target['id']]]} if target['id'] in lacking else {})}
                   for target in targets]
        reply = {'servers': servers, 'setups': [], 'more': False,
                 'project': self.describe(project), 'agents': self.agents(),
                 'canManage': handler._secret_entry_local(), 'redirectUri': self.redirect_uri(handler)}
        if environment is not None:
            reply.update(environment=self.public_environment(self.environments.require(environment)),
                         chatAgents=self.chats.agents())
        return reply

    def change_projects(self, handler):
        data = handler.read_json_object(64 * 1024)
        if data is None:
            handler.json_error(400, 'expected a JSON object')
            return True
        action, added = data.get('action'), None
        if action == 'add':
            added = self.projects.add(data.get('path'))
        elif action == 'archive':
            self.projects.archive(data.get('key'))
        elif action == 'restore':
            self.projects.restore(data.get('key'))
        else:
            raise store_module.StoreError('action must be one of: add, archive, restore')
        return self.respond(handler, {**self.listing(handler), **({'added': added} if added else {})})

    def change_agents(self, handler, server_id, verb):
        """Adds a server to the ticked agents, edits or removes it on them,
        or syncs one server or the whole project to the agents that lack it."""
        project = self.query(handler)[1]
        if self.environment_of(project) is not None:
            raise store_module.StoreError('A throwaway environment gives no agent a server. Change one from its project.')
        data = handler.read_json_object(64 * 1024)
        if data is None:
            handler.json_error(400, 'expected a JSON object')
            return True
        ticked = [agent for agent in data.get('agents') or [] if isinstance(agent, str)] \
            if isinstance(data.get('agents'), list) else []
        was = self.target(project, server_id) if server_id and verb != 'sync' else None
        try:
            if verb == 'sync':
                result = self.changes.sync(project, server_id)
            elif verb == 'remove':
                result = self.changes.remove(project, server_id, ticked)
            elif server_id:
                result = self.changes.edit(project, server_id, data, ticked)
            else:
                result = self.changes.add(project, data, ticked)
        except OSError:
            handler.json_error(503, 'Orc could not write an agent\'s config file. Try again.', True)
            return True
        if was and was['transport'] == 'http':
            self.forget_unused(was)
        return self.respond(handler, {**self.view(handler), 'result': result, 'saved': result.get('row')})

    def forget_unused(self, target):
        """Drops Orc's own sign-in for an address once no agent has a
        server there in any project, so a removed server leaves no token."""
        entry = target['entry']
        if not entry or not entry.get('linked'):
            return
        address = store_module.address(target['url'])
        for project in [agents_module.GLOBAL, *self.projects.folders()]:
            if any(row['url'] and store_module.address(row['url']) == address for row in self.reader.rows(project)):
                return
        self.store.remove(entry['id'])
        self.forget(target)

    # -- environments --

    def chat_servers(self, environment_id):
        """What a chat's agent gets for each of the environment's servers
        Orc can reach: its address and the headers Orc sends it, with a
        token refreshed now when the saved one has expired. A server Orc is
        not signed in to goes without one, and the agent says it cannot
        reach it."""
        found = []
        for target in self.targets(ENVIRONMENT_KEY + environment_id):
            if target['transport'] != 'http':
                continue
            try:
                url, headers = store_module.clean_url(target['url']), self.request_headers(target)
            except store_module.StoreError:
                continue
            except (mcp_oauth.OAuthError, keychain_secrets.SecretError, OSError):
                headers = {}
            found.append({'id': target['id'], 'name': target['name'], 'url': url, 'headers': headers})
        return found

    def candidates(self, environment_id):
        """The servers on the Projects page that an environment can pick:
        each listed project's servers with a URL that it does not have yet."""
        entry = self.environments.require(environment_id)
        taken = {(pick['project'], pick['id']) for pick in entry['picks']}
        found = []
        for project in self.projects.listing()['projects']:
            for row in self.reader.rows(project['key']):
                if row['transport'] == 'http' and (project['key'], row['id']) not in taken:
                    found.append({'project': project['key'], 'projectName': project['name'], 'id': row['id'],
                                  'name': row['name'], 'url': row['url'],
                                  'agents': [member['label'] for member in row['agents']]})
        return found

    def tidy(self):
        """Moves servers saved before environments existed into one, and
        deletes every environment nobody has used for 7 days. One caller at a
        time: the screen's tabs all read at once."""
        if not self.tidying.acquire(blocking=False):
            return
        try:
            self.environments.adopt_saved()
            for environment_id in self.environments.expired():
                self.close_environment(environment_id)
            for environment_id in self.environments.orphans():
                self.environments.remove_folder(environment_id)
        except (store_module.StoreError, keychain_secrets.SecretError, OSError):
            pass  # the next read tries again
        finally:
            self.tidying.release()

    def tidy_later(self):
        if not self.active:
            return
        self.timer = threading.Timer(TIDY_SECONDS, self.tidy_now)
        self.timer.daemon = True
        self.timer.start()

    def tidy_now(self):
        if self.active and self.context['is_enabled']() and self.context.get('allow_network', False):
            self.tidy()
        self.tidy_later()

    def close_environment(self, environment_id):
        """Deletes an environment: its chats, the servers pasted into it with
        Orc's sign-in for each, and its folder. A server picked from a
        project stays where it was picked from."""
        entry = self.environments.get(environment_id)
        if entry is None:
            return False
        for chat in entry['chats']:
            self.chats.end(environment_id, chat)
        for server in self.environments.servers(environment_id):
            self.forget(self.saved_target(server))
        self.environments.delete(environment_id)
        return True

    def environment_route(self, handler, environment_id, verb):
        if verb == 'chats':
            data = handler.read_json_object(256 * 1024)
            if data is None:
                handler.json_error(400, 'expected a JSON object')
                return True
            self.environments.require(environment_id)
            chat = self.chats.start(environment_id, data)
            return self.respond(handler, {
                'chat': chat['id'], 'environment': self.public_environment(self.environments.require(environment_id))})
        if not handler._secret_entry_allowed():
            return True
        if verb == 'close':
            self.close_environment(environment_id)
            return self.respond(handler, self.listing(handler))
        data = handler.read_json_object(64 * 1024)
        if data is None:
            handler.json_error(400, 'expected a JSON object')
            return True
        if verb == 'picks':
            project = self.projects.require(data.get('project'))
            if not any(row['id'] == data.get('id') and row['transport'] == 'http' for row in self.reader.rows(project)):
                raise Missing('That MCP server is no longer in its project.')
            self.environments.pick(environment_id, project, data['id'])
            return self.respond(handler, self.listing(handler))
        if environment_id is None:
            environment_id = self.environments.create(data.get('name'))['id']
            if data.get('url'):
                try:
                    self.store.save(None, {'url': data['url']}, environment=environment_id)
                except store_module.StoreError:
                    self.close_environment(environment_id)
                    raise
            return self.respond(handler, {**self.listing(handler), 'created': ENVIRONMENT_KEY + environment_id})
        self.environments.rename(environment_id, data.get('name'))
        return self.respond(handler, self.listing(handler))

    def chat_route(self, handler, method, environment_id, chat_id, verb):
        """A chat's conversation (GET), its next message (send) and Stop."""
        if method == 'GET' and verb is None:
            cursor = (parse_qs(urlsplit(handler.path).query).get('cursor') or [None])[0]
            self.environments.touch(environment_id)
            return self.respond(handler, self.chats.view(environment_id, chat_id, cursor))
        if method != 'POST' or verb is None:
            handler.json_error(404, 'Orc has no such MCP client route.', False)
            return True
        if verb == 'stop':
            return self.respond(handler, {'ok': self.chats.stop(environment_id, chat_id)})
        data = handler.read_json_object(256 * 1024)
        if data is None:
            handler.json_error(400, 'expected a JSON object')
            return True
        self.chats.send(environment_id, chat_id, data)
        return self.respond(handler, {'ok': True})

    # -- routes --

    def handle(self, handler, method, path):
        if path != ROOT and not path.startswith(ROOT + '/'):
            return False
        if not self.context['is_enabled']():
            handler.json_error(404, 'The MCP client is turned off.', False)
            return True
        if not self.context.get('allow_network', False):
            handler.json_error(403, 'The MCP client is unavailable in this preview.', False)
            return True
        try:
            if method == 'GET' and path == ROOT:
                return self.respond(handler, self.view(handler))
            if method == 'GET' and path == ROOT + '/projects':
                return self.respond(handler, self.listing(handler))
            if method == 'GET' and path == ROOT + '/callback':
                return self.callback(handler, parse_qs(urlsplit(handler.path).query))
            chat = CHAT.fullmatch(path)
            if chat:
                return self.chat_route(handler, method, *chat.groups())
            environment = ENVIRONMENT.fullmatch(path)
            if method == 'GET' and environment and environment.group(2) == 'candidates':
                return self.respond(handler, {'candidates': self.candidates(environment.group(1))})
            if method != 'POST':
                handler.json_error(404, 'Orc has no such MCP client route.', False)
                return True
            if path == ROOT + '/act':
                return self.act(handler)
            if path == ROOT + '/projects':
                return self.change_projects(handler)
            closing = TAB_CLOSE.fullmatch(path)
            if closing:
                closed = mcp_inspect.close_where(lambda key: key[0] == SCOPE and key[2] == closing.group(1))
                return self.respond(handler, {'ok': True, 'closed': closed})
            if path == ROOT + '/environments' or (environment and environment.group(2) != 'candidates'):
                return self.environment_route(handler, *(environment.groups() if environment else (None, None)))
            match = SERVER.fullmatch(path)
            changing = AGENT_SERVER.fullmatch(path)
            if path not in (ROOT + '/servers', ROOT + '/sync') and not match and not changing:
                handler.json_error(404, 'Orc has no such MCP client route.', False)
                return True
            if not handler._secret_entry_allowed():
                return True
            if changing or path == ROOT + '/sync':
                return self.change_agents(handler, *(changing.groups() if changing else (None, 'sync')))
            server_id, verb = (match.group(1), match.group(2)) if match else (None, None)
            project = self.query(handler)[1]
            if verb == 'sign-in':
                return self.respond(handler, self.sign_in(handler, self.callable_target(project, server_id)))
            if verb == 'sign-out':
                target = self.target(project, server_id)
                if target['entry']:
                    self.store.forget_sign_in(target['entry']['id'])
                self.forget(target, challenge=False)
            elif verb == 'remove':
                self.remove(project, server_id)
            else:
                data = handler.read_json_object(64 * 1024)
                if data is None:
                    handler.json_error(400, 'expected a JSON object')
                    return True
                saved = self.save(project, server_id, data)
                return self.respond(handler, {**self.view(handler), 'saved': saved})
            return self.respond(handler, self.view(handler))
        except chats_module.ChatBusy as error:
            handler.json_error(409, str(error), True)
        except (store_module.StoreError, changes_module.EditError) as error:
            handler.json_error(400, str(error), False)
        except mcp_oauth.OAuthError as error:
            handler.json_error(502, str(error), True)
        except (keychain_secrets.SecretError, OSError):
            handler.json_error(503, 'The Keychain or config.json is unavailable. Try again.', True)
        return True

    def respond(self, handler, payload, status=200):
        handler._respond(status, json.dumps(payload).encode(), 'application/json', {'Cache-Control': 'no-store'})
        return True

    def remove(self, project, server_id):
        """Takes a server out of an environment: one pasted there is deleted
        with Orc's sign-in for it, and one picked from a project only leaves."""
        environment = self.environment_of(project)
        if environment is None:
            raise store_module.StoreError('Change a server an agent has from its project.')
        target = self.target(project, server_id)
        if target['row'] is None:
            self.store.remove(server_id)
            self.forget(target)
        else:
            self.environments.unpick(environment, server_id)
            mcp_inspect.close_where(lambda key: key[0] == SCOPE and key[1] == server_id)

    def save(self, project, server_id, data):
        """Adds a server to an environment, or edits one there. For an
        agent's server, saves only what Orc itself sends it: headers and a
        typed OAuth client. Answers the id the screen knows the server by."""
        if server_id is None:
            environment = self.environment_of(project)
            if environment is None:
                raise store_module.StoreError('Add a server to an agent from its project.')
            entry = self.store.save(None, data, environment=environment)
            self.forget(self.saved_target(entry))
            return entry['id']
        target = self.target(project, server_id)
        if target['row'] is None:
            entry = self.store.save(server_id, data)
        else:
            target, held = self.callable_target(project, server_id), target['entry']
            entry = self.store.save(held['id'] if held else None,
                                    {**data, 'url': (held or target)['url'], 'name': (held or target)['name']},
                                    linked=True)
        self.forget({**target, 'url': entry['url']})
        return target['id']

    def act(self, handler):
        """One inspector action on a saved server. A server that answers 401
        is retried once with refreshed tokens; after that the screen offers
        Sign in, and the server's challenge is kept for it."""
        data = handler.read_json_object(1024 * 1024)
        if data is None:
            handler.json_error(400, 'expected a JSON object')
            return True
        project = self.project(data.get('project'))
        try:
            target = self.callable_target(project, data.get('server'))
        except store_module.StoreError as error:
            return self.respond(handler, {'error': str(error)}, 404 if isinstance(error, Missing) else 400)
        self.environments.touch(self.environment_of(project))
        server_id, entry = target['id'], target['entry']
        server = {'name': target['name'], 'url': target['url']}
        key = self.key(server_id, self.tab(data.get('tab')))
        with self.lock:
            self.live[server_id] = (project, store_module.address(target['url']))
        if data.get('action') in ('disconnect', 'suggest'):
            # Neither reaches the server, so neither needs a token, or a refresh.
            status, body = mcp_inspect.act(key, {**server, 'headers': {}}, data,
                                           client_info=CLIENT_INFO, context=[])
            return self.respond(handler, body, status)
        status, body, rejected = None, None, None
        for attempt in (0, 1):
            headers = self.request_headers(target, rejected=rejected)
            # Only a token from Orc's own sign-in can be refreshed.
            sent = (headers.get('Authorization', '').removeprefix('Bearer ') or None) if entry else None
            if attempt == 1 and sent is None:
                break
            status, body = mcp_inspect.act(key, {**server, 'headers': headers}, data,
                                           client_info=CLIENT_INFO, context=[])
            if not (status == 502 and body.get('auth')):
                break
            with self.lock:
                self.challenges[server_id] = body.get('challenge')
            if sent is None:
                break
            rejected = sent
        if status == 502 and body.get('auth'):
            body['signIn'] = True
        body.pop('challenge', None)
        return self.respond(handler, body, status)

    def sign_in(self, handler, target):
        """Starts a browser sign-in and answers the page to send the person
        to. An agent's server gets its entry here only once the sign-in
        comes back, so one that is abandoned leaves nothing saved."""
        server_id, entry = target['id'], target['entry'] or {}
        redirect = self.redirect_uri(handler)
        with self.lock:
            challenge = self.challenges.get(server_id)
        discovery = mcp_oauth.discover(target['url'], www_authenticate=challenge)
        client = self.store.client(entry['id'], entry, redirect_uri=redirect,
                                   issuer=discovery.get('issuer') or discovery.get('authorizationServer')) if entry else None
        known = (entry.get('oauth') or {}).get('discovery') or {}
        if client is None or (not client.get('typed') and (
                client.get('redirect_uri') != redirect
                or known.get('authorizationServer') != discovery.get('authorizationServer'))):
            client = mcp_oauth.register(discovery, redirect_uri=redirect)
        url, pending = mcp_oauth.start(discovery, client, redirect_uri=redirect)
        now = time.time()
        with self.lock:
            self.logins = {state: login for state, login in self.logins.items() if now - login['at'] < LOGIN_TTL}
            self.logins[pending['state']] = {'server': server_id, 'url': target['url'], 'name': target['name'],
                                             'saved': target['row'] is None, 'pending': pending,
                                             'discovery': discovery, 'client': client, 'at': now}
        return {'url': url}

    def callback(self, handler, query):
        if not handler._secret_entry_local():
            handler.json_error(403, 'Sign in to MCP servers from Orc on this Mac.', False)
            return True
        state = (query.get('state') or [''])[0]
        with self.lock:
            login = self.logins.pop(state, None)
        if login is None:
            handler._respond(302, b'', None, {'Location': '/#mcp-client', 'Cache-Control': 'no-store'})
            return True
        server_id = login['server']
        error = (query.get('error') or [''])[0]
        if error:
            text = ('You did not let Orc sign in.' if error == 'access_denied'
                    else 'The server did not sign you in (%s).' % error[:80])
            self.notices[server_id] = {'ok': False, 'text': text}
        else:
            try:
                tokens = mcp_oauth.finish(login['discovery'], login['client'], login['pending'],
                                          code=(query.get('code') or [''])[0], state=state,
                                          iss=(query.get('iss') or [None])[0])
                if not login['saved']:
                    current = self.store.link(login['url'], login['name'])
                else:
                    current = self.store.get(server_id)
                    if current is None or current['url'] != login['url']:
                        raise store_module.StoreError('That MCP server changed while you signed in. Sign in again.')
                self.store.save_sign_in(current['id'], login['discovery'], login['client'], tokens)
                self.close({'id': server_id, 'url': login['url']})
                self.notices[server_id] = {'ok': True, 'text': 'Signed in.'}
            except (mcp_oauth.OAuthError, store_module.StoreError) as exc:
                self.notices[server_id] = {'ok': False, 'text': str(exc)}
            except (keychain_secrets.SecretError, OSError):
                self.notices[server_id] = {'ok': False, 'text': 'Orc could not save the sign-in. Try again.'}
        handler._respond(302, b'', None, {'Location': '/#mcp-client/%s' % quote(server_id),
                                          'Cache-Control': 'no-store'})
        return True

    def deactivate(self):
        self.active = False
        if self.timer is not None:
            self.timer.cancel()
        mcp_inspect.close_where(lambda key: key[0] == SCOPE)
        for entry in self.environments.all():
            for chat in entry['chats']:
                self.chats.stop_quietly(entry['id'], chat['id'])
        return True


def activate(context):
    service = Service(context)
    service.tidy_later()
    return service
