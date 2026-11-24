"""Orchestrate's saved rules for the browser and orc-routes, served at
/api/orchestrate/rules for Settings → Orchestrate: read by anyone
who can see the composer, replaced from Orc on the host or a signed-in paired
browser, and the last save wins. A write carries
`presets`, the whole list, or `routes`, one preset's board: the preset
named by `preset`, else the first.

Before routes existed the since-removed /orc:models skill saved one model per
provider and role under `taskModels` in config.json, and before that in
~/.orc/models.md. Starting Orc saves those choices as routes once, when
no routes are saved yet, then takes `taskModels` out of config.json and renames
models.md to models.md.migrated, so nothing reads them again. Orchestrate was
a plugin until it became part of Orc; the server now runs that once at start."""
import json
import re
import sys
from pathlib import Path

import orchestrate_rules as rules

RULES = '/api/orchestrate/rules'
REMOTE = "Change Orchestrate's rules from Orc on the host or a paired computer."
BROKEN = 'config.json has a syntax error on disk — refusing to overwrite; fix it by hand and retry'
OLD_KEY = 'taskModels'
OLD_FILE = 'models.md'
# The old preferences' way of saying "the parent's model", which is what a
# job with no route already gets.
OLD_PARENT = ('inherit-parent', 'auto')
_PROVIDER_HEADING = re.compile(r'^#+\s*Provider:\s*`?([^`\s]+)`?\s*$')


def _old_markdown(text):
    """{provider: {role: {model, effort}}} from a models.md that /orc:models
    wrote: a `## Provider: <id>` heading, then a table whose rows start
    `| <role> |` and end with the model and effort columns."""
    found, provider = {}, None
    for line in text.splitlines():
        heading = _PROVIDER_HEADING.match(line.strip())
        if heading:
            provider = heading.group(1).lower()
            continue
        cells = [cell.strip().strip('`') for cell in line.strip().strip('|').split('|')]
        if provider is None or len(cells) < 3 or cells[0].lower() not in rules.TASK_ROLES:
            continue
        found.setdefault(provider, {})[cells[0].lower()] = {'model': cells[-2], 'effort': cells[-1].lower()}
    return found


def _old_routes(preferences):
    """Routes from the old per-provider preferences. Each role takes the first
    provider that named a model for it, Claude's logins before Codex. A login
    such as `claude-two` is the `claude` agent."""
    preferences = preferences if isinstance(preferences, dict) else {}
    order = sorted((name for name in preferences if isinstance(name, str)),
                   key=lambda name: (not name.startswith('claude'), name != 'codex', name))
    routes = {}
    for role in rules.TASK_ROLES:
        for name in order:
            roles = preferences[name] if isinstance(preferences[name], dict) else {}
            saved = roles.get(role) if isinstance(roles.get(role), dict) else {}
            if saved.get('model') in OLD_PARENT:
                continue
            found = rules.route({'provider': 'claude' if name.startswith('claude') else name,
                                 'model': saved.get('model'), 'effort': saved.get('effort')})
            if found:
                routes[role] = found
                break
    return routes


def migrated(config, old_file):
    """config with the old preferences saved as routes when it has none, and
    without `taskModels`. `taskModels` wins over models.md, as it did when
    both were read."""
    config = dict(config)
    preferences = config.pop(OLD_KEY, None)
    if rules.CONFIG_KEY in config:
        return config
    if preferences is not None:
        routes = _old_routes(preferences)
    else:
        try:
            routes = _old_routes(_old_markdown(Path(old_file).read_text()))
        except (OSError, UnicodeDecodeError):
            routes = {}
    return rules.with_routes(config, routes) if routes or preferences is not None else config


class Service:
    """`read_config` returns (config, broken); `update_config` applies a
    transform under config.json's lock; `config_dir` names ~/.orc."""

    def __init__(self, read_config, update_config, config_dir):
        self.read_config = read_config
        self.update_config = update_config
        self.config_dir = config_dir

    def migrate(self):
        """Saves the old preferences as routes, once. A config.json that
        cannot be read or written is left for the next start to try again."""
        old_file = Path(self.config_dir()) / OLD_FILE
        config, broken = self.read_config()
        if broken or not isinstance(config, dict) or (OLD_KEY not in config and not old_file.exists()):
            return
        try:
            self.update_config(lambda current: migrated(current, old_file))
            if old_file.exists():
                old_file.replace(old_file.with_name(OLD_FILE + '.migrated'))
        except OSError as error:
            print('orchestrate: older model preferences not saved as routes: %s' % error, file=sys.stderr)

    def payload(self):
        config, broken = self.read_config()
        return {**rules.read(config), 'configError': bool(broken)}

    def handle(self, handler, method, path):
        if path != RULES or method not in ('GET', 'POST'):
            return False
        if method == 'GET':
            return self.respond(handler, self.payload())
        if not handler._signed_in_device():
            handler.json_error(403, REMOTE, False)
            return True
        data = handler.read_json_object(262144)
        try:
            change = self.change(data if data is not None else {})
        except ValueError as error:
            handler.json_error(400, str(error))
            return True
        if self.read_config()[1]:
            handler.json_error(409, BROKEN)
            return True
        try:
            self.update_config(change)
        except LookupError as error:
            handler.json_error(409, str(error))
            return True
        except OSError as error:
            handler.json_error(409 if 'syntax error' in str(error) else 500, str(error))
            return True
        return self.respond(handler, self.payload())

    def change(self, data):
        """The config change a write asks for. ValueError says what in it
        cannot be saved."""
        presets, routes = data.get('presets'), data.get('routes')
        if presets is not None:
            if not isinstance(presets, list) or not 0 < len(presets) <= rules.MAX_PRESETS:
                raise ValueError('expected 1 to %d presets' % rules.MAX_PRESETS)
            for entry in presets:
                if rules.preset(entry) is None:
                    raise ValueError('a preset needs an id and a name')
                self.usable(entry.get('routes', {}), ' in ' + rules.preset(entry)['name'])
                if entry.get('icon') is not None and rules.icon(entry['icon']) is None:
                    raise ValueError('an icon is an agent id, or a PNG, JPEG or WebP image of at most 64 KB')
            if len({entry['id'] for entry in presets}) != len(presets):
                raise ValueError('two presets share an id')
            return lambda config: rules.with_presets(config, presets)
        self.usable(routes)
        wanted = data.get('preset')
        if wanted is not None and not isinstance(wanted, str):
            raise ValueError('preset must be a preset id')

        def replace(config):
            if wanted is not None and all(entry['id'] != wanted for entry in rules.read(config)['presets']):
                raise LookupError('That preset no longer exists.')
            return rules.with_routes(config, routes, wanted)
        return replace

    @staticmethod
    def usable(routes, where=''):
        if not isinstance(routes, dict):
            raise ValueError('expected {routes: {job: route}}')
        unusable = sorted(job for job, value in routes.items()
                          if job not in rules.JOBS or rules.route(value) is None)
        if unusable:
            raise ValueError('unusable route for ' + ', '.join(unusable) + where)

    def respond(self, handler, payload):
        handler._respond(200, json.dumps(payload).encode(), 'application/json', {'Cache-Control': 'no-store'})
        return True
