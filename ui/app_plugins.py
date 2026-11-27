"""Trusted application packages, distinct from Claude/Codex harness plugins."""

import contextlib
import fcntl
import hashlib
import importlib.util
import base64
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import stat
import subprocess
import tarfile
import tempfile
import threading
import time
import sys
import zipfile
from urllib.parse import urlsplit

from install_home import configured_target
from review_context import github_origin


ROOT = Path(__file__).resolve().parents[1]
IDENTIFIER = re.compile(r'[a-z][a-z0-9-]{0,63}\Z')
# Lower case, as github_origin() reports a checkout's origin.
GITHUB_REPOSITORY = re.compile(r'[a-z0-9-]+/[a-z0-9_.-]+\Z')
# worktreeServers is still accepted so a package an older Orc installed keeps
# loading, but core runs its own dev servers and never loads one from a package.
KINDS = {'theme', 'frontend', 'backend', 'commands', 'railsHelpers', 'skills', 'externalService', 'harness', 'worktreeServers', 'sendOffs', 'repositoryRules',
         'verificationGuides', 'qaBrowser', 'qaSetupFixes', 'pullRequestReviewer'}
# A QA browser host pattern: host labels, where `*` stands for one or more
# characters of a single label (ui/js/qa-plugins.js matches them).
QA_HOST = re.compile(r'(?:[a-z0-9*](?:[a-z0-9*-]{0,61}[a-z0-9*])?\.)+[a-z0-9*](?:[a-z0-9*-]{0,61}[a-z0-9*])?\Z')
# Agents core launches itself; a harness package adds others beside them.
CORE_AGENTS = ('claude', 'codex')
# Agents built into core (ui/<agent>/) that it offers only while their CLI is
# signed in. No package may claim their ids.
BUILTIN_AGENTS = ('gemini',)
HOST_THEME_IDS = {'theme', 'fun-mode', 'orc-embedded', 'orc-questions-only', 'orc-actions-loading', 'pwa-offline'}
# The package contract's version. It is also the theme surface's
# (app-plugins/theme-surface.json, which must match it) and rises when that
# surface drops a promise. Older packages still load, marked as made for an
# older Orc.
API_VERSION = 2
# Bundled packages retired or moved by a release, by their old manifest names.
RETIRED_THEMES = {'forest': 'Forest', 'hive': 'Hive'}
RETIRED_BUNDLED = {
    'msn': 'MSN Messenger',
    'usage': 'Subscription usage',
    'christmas': 'Christmas',
    'rapids': 'Rapids',
    'spooky': 'Spooky',
    'sprinkles': 'Sprinkles',
    'uwu': 'Uwu',
    'gemini': 'Gemini',
    'worktree-servers': 'Worktree servers',
    'instructions': 'Instructions',
}
# Bundled packages renamed in a later release: old id -> new id.
RENAMED_BUNDLED = {
    'hawkins': 'upside-down',
    'leonida': 'grand-theft-orc',
}


def saved_theme(theme):
    """Resolve a theme saved by an earlier release, preserving its colour scheme."""
    name = theme["funMode"]
    return {**theme, "funMode": "swamp" if name in RETIRED_THEMES else RENAMED_BUNDLED.get(name, name)}


# Packages whose core support was removed: a pinned or linked copy could no
# longer run, so its record goes on upgrade too. Its files stay on disk.
REMOVED_PACKAGES = {
    **RETIRED_THEMES,
    'mcp': 'MCP server',
    'memory-bank': 'Memory bank',
    # Part of core now: a pinned or linked copy would offer a second set of
    # presets and its orc-routes would shadow core's bin/orc-routes.
    'orchestrate': 'Orchestrate',
    # Built into Orc again (ui/js/send-offs.js, Settings -> Appearance): a
    # private copy would sit in the Plugins list switching nothing.
    'send-offs': 'Send-offs',
    # Built into Orc again (ui/js/secrets.js, bin/orc-secret, Settings -> Account):
    # a pinned or linked copy would shadow core's bin/orc-secret and duplicate cards.
    'secrets': 'Secrets',
    # Built into core (ui/ship_when_done.py, ui/js/ship-when-done.js, Settings -> Projects):
    # a pinned or linked copy would run a second watch loop and show a duplicate toggle.
    'auto-merge': 'Auto merge',
}
# What a linked package may contribute: the browser reloads these from the
# folder as it changes, while code core imports would keep a stale copy.
LINKABLE = {'theme', 'frontend'}


class PluginError(ValueError):
    pass


class Conflict(PluginError):
    pass


_IMPORT_LOCK = threading.Lock()
_import_depth = 0
_saved_dont_write_bytecode = False


@contextlib.contextmanager
def no_bytecode():
    """Keep bytecode off across overlapping plugin imports on request threads."""
    global _import_depth, _saved_dont_write_bytecode
    with _IMPORT_LOCK:
        if _import_depth == 0:
            _saved_dont_write_bytecode = sys.dont_write_bytecode
            sys.dont_write_bytecode = True
        _import_depth += 1
    try:
        yield
    finally:
        with _IMPORT_LOCK:
            _import_depth -= 1
            if _import_depth == 0:
                sys.dont_write_bytecode = _saved_dont_write_bytecode


def load_package_module(name, root, entry):
    root = Path(root).resolve()
    spec = importlib.util.spec_from_file_location(name, root / entry, submodule_search_locations=[str(root)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        with no_bytecode():
            spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return module


_CACHED_LOCK = threading.RLock()
_cached = {}


def cached_module(prefix, root, entry):
    """``root/entry`` imported once per package directory, which differs for
    every revision. It is a package rooted at ``root``, so it imports its
    siblings relatively."""
    root = Path(root).resolve()
    name = prefix + hashlib.sha256(str(root).encode()).hexdigest()[:24]
    with _CACHED_LOCK:
        if name not in _cached:
            _cached[name] = load_package_module(name, root, entry)
        return _cached[name]


def enabled_module(registry, identifier, entry):
    """``entry`` of package ``identifier`` while that package is enabled, else
    None. Core reads a package this way outside the server's plugin runtime,
    such as the Vaults store from the run hook."""
    root = registry.enabled_root(identifier)
    return cached_module('orc_%s_' % identifier.replace('-', '_'), root, entry) if root else None


def _validate_qa_browser(root, spec):
    """Toolbar buttons and a page script for the QA window's browser, on the
    hosts the plugin names."""
    if not isinstance(spec, dict) or spec.keys() != {'hosts', 'script', 'buttons'}:
        raise PluginError('QA browser requires hosts, script and buttons')
    hosts = spec['hosts']
    if not isinstance(hosts, list) or not hosts or not all(isinstance(host, str) and QA_HOST.fullmatch(host) for host in hosts):
        raise PluginError('QA browser hosts must be host names, where * stands for part of one label')
    if not str(spec['script']).endswith('.js'):
        raise PluginError('QA browser script must be a .js file')
    package_file(root, spec['script'])
    buttons = spec['buttons']
    if not isinstance(buttons, list) or not buttons or not all(
            isinstance(button, dict) and button.keys() == {'id', 'label'}
            and isinstance(button['id'], str) and IDENTIFIER.fullmatch(button['id'])
            and isinstance(button['label'], str) and button['label'].strip() and len(button['label']) <= 40
            for button in buttons):
        raise PluginError('QA browser buttons need an id and a label of at most 40 characters')
    if len({button['id'] for button in buttons}) != len(buttons):
        raise PluginError('QA browser button ids must be unique')


QA_FIX_KEYS = {'id', 'match', 'reason', 'explain', 'command'}


def _validate_qa_setup_fixes(spec):
    """Known app-setup failures the QA window explains: a pattern over the
    end of a stopped process's log, the reason in words, and the one command
    that fixes it, which runs only when the person presses Run it."""
    if not isinstance(spec, list) or not spec:
        raise PluginError('QA setup fixes must be a non-empty list')
    for fix in spec:
        if not isinstance(fix, dict) or fix.keys() != QA_FIX_KEYS:
            raise PluginError('Each QA setup fix needs id, match, reason, explain and command')
        if not isinstance(fix['id'], str) or not IDENTIFIER.fullmatch(fix['id']):
            raise PluginError('QA setup fix ids must be lowercase identifiers')
        for key, limit in (('match', 400), ('reason', 120), ('explain', 400), ('command', 200)):
            if not isinstance(fix[key], str) or not fix[key].strip() or len(fix[key]) > limit:
                raise PluginError('QA setup fix %s must be text of at most %d characters' % (key, limit))
        if '\n' in fix['command']:
            raise PluginError('A QA setup fix command must be one line')
        try:
            re.compile(fix['match'])
        except re.error as error:
            raise PluginError('QA setup fix %s has a bad pattern: %s' % (fix['id'], error)) from None
    if len({fix['id'] for fix in spec}) != len(spec):
        raise PluginError('QA setup fix ids must be unique')


def relative_path(value):
    if not isinstance(value, str) or not value or '\\' in value:
        raise PluginError('Package paths must be relative POSIX paths')
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ('', '.', '..') for part in value.split('/')):
        raise PluginError('Package path escapes its root: ' + value)
    return path


def package_file(root, value):
    path = root / relative_path(value)
    if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise PluginError('Missing or unsafe package file: ' + value)
    return path


def _nonempty_str_list(value, label):
    if not isinstance(value, list) or not value or not all(isinstance(item, str) and item.strip() for item in value):
        raise PluginError(label)


def _validate_theme_declarative(root, theme):
    if 'favicon' in theme:
        fav = theme['favicon']
        if not isinstance(fav, str) or not fav.strip():
            raise PluginError('Theme favicon must be a package image path or data:image/ URL')
        if fav.startswith('data:'):
            if not fav.startswith('data:image/'):
                raise PluginError('Inline theme favicon must be a data:image/ URL')
        else:
            if Path(fav).suffix.lower() not in ('.svg', '.png', '.ico'):
                raise PluginError('Theme favicon file must be .svg, .png or .ico')
            package_file(root, fav)
    if 'announce' in theme:
        ann = theme['announce']
        if isinstance(ann, str):
            if not ann.strip():
                raise PluginError('Theme announce must not be empty')
        elif isinstance(ann, dict):
            if not ann or set(ann) - {'on', 'off'} or 'on' not in ann or not all(
                    isinstance(val, str) and val.strip() for val in ann.values()):
                raise PluginError('Theme announce object requires non-empty "on" (and optional "off") strings')
        else:
            raise PluginError('Theme announce must be a string or {"on", "off"}')
    if 'backdrop' in theme:
        backdrop = theme['backdrop']
        if not isinstance(backdrop, dict) or set(backdrop) - {'id', 'className', 'count'}:
            raise PluginError('Theme backdrop accepts only id, className and count')
        cls = backdrop.get('className')
        count = backdrop.get('count')
        if not isinstance(cls, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_ -]*', cls.strip()):
            raise PluginError('Theme backdrop requires a valid CSS className')
        if type(count) is not int or not (1 <= count <= 64):
            raise PluginError('Theme backdrop count must be an integer between 1 and 64')
        if 'id' in backdrop and (not isinstance(backdrop['id'], str) or not IDENTIFIER.fullmatch(backdrop['id'])):
            raise PluginError('Theme backdrop id must be a valid identifier')
    if 'radio' in theme:
        spec = theme['radio']
        allowed = {'style', 'leads', 'scenes', 'textures', 'words', 'moods', 'kinds'}
        if not isinstance(spec, dict) or set(spec) - allowed:
            raise PluginError('Theme radio station has unknown fields')
        if not isinstance(spec.get('style'), str) or not spec['style'].strip():
            raise PluginError('Theme radio station requires a style description')
        for field in ('leads', 'scenes', 'textures'):
            _nonempty_str_list(spec.get(field), 'Theme radio station requires non-empty %s list' % field)
        if 'words' in spec:
            words = spec['words']
            if not isinstance(words, dict) or set(words) != {'first', 'second', 'places'}:
                raise PluginError('Theme radio words requires first, second and places lists')
            for field in ('first', 'second', 'places'):
                _nonempty_str_list(words.get(field), 'Theme radio words.%s must be a non-empty string list' % field)
        if 'kinds' in spec:
            _nonempty_str_list(spec.get('kinds'), 'Theme radio kinds must be a non-empty string list')
        if 'moods' in spec:
            moods = spec['moods']
            if not isinstance(moods, list) or not moods or not all(
                    isinstance(m, dict) and isinstance(m.get('sky'), list) and len(m['sky']) == 2
                    and isinstance(m.get('land'), list) and len(m['land']) == 2
                    and isinstance(m.get('glow'), str) and isinstance(m.get('sun'), str)
                    for m in moods):
                raise PluginError('Theme radio moods must list {sky:[a,b], glow, sun, land:[a,b]} palettes')


def trust(data):
    """'no-code' when a package adds only styles and pictures, 'runs-code'
    when any part of it runs as a program with the person's permissions."""
    contributes = data.get('contributes', {})
    theme = contributes.get('theme') or {}
    if set(contributes) - {'theme'} or any(key in theme for key in ('scene', 'components')):
        return 'runs-code'
    return 'no-code'


def catalog_policy(root=ROOT):
    """Optional checkout-local catalog policy module, if one is present."""
    for base in (Path(root).resolve(), ROOT):
        for path in sorted(base.glob('*/catalog_policy.py')):
            if path.is_file():
                return cached_module('orc_catalog_policy_', path.parent, path.name)
    return None


def manifest(root):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise PluginError('Package must be a real directory')
    for path in root.rglob('*'):
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise PluginError('Packages cannot contain symlinks or special files: ' + str(path))
        if path.name in ('.git', '.env', 'node_modules', '__pycache__'):
            raise PluginError('Package contains local state: ' + str(path))
    try:
        value = json.loads(package_file(root, 'orc-plugin.json').read_text())
    except (OSError, ValueError) as error:
        raise PluginError('Invalid orc-plugin.json: ' + str(error)) from error
    if not isinstance(value, dict) or type(value.get('apiVersion')) is not int or value['apiVersion'] < 1:
        raise PluginError('Unsupported application plugin API version')
    if value['apiVersion'] > API_VERSION:
        raise PluginError('This package needs a newer Orc (plugin API %d; this Orc has %d)'
                          % (value['apiVersion'], API_VERSION))
    if not isinstance(value.get('id'), str) or not IDENTIFIER.fullmatch(value['id']):
        raise PluginError('Invalid plugin id')
    if not all(isinstance(value.get(key), str) and value[key].strip() for key in ('name', 'description', 'version')):
        raise PluginError('Plugin requires name, description and version')
    for key in ('required', 'adoptOnUpgrade', 'onByDefault', 'pairedSwitch'):
        if key in value and not isinstance(value[key], bool):
            raise PluginError(key + ' must be a boolean')
    if value.get('onByDefault') and value.get('required'):
        raise PluginError('onByDefault is for an optional plugin; a required one is always on')
    policy = catalog_policy()
    if policy is not None and hasattr(policy, 'validate_manifest'):
        policy.validate_manifest(value, PluginError)
    if 'postInstall' in value:
        post = value['postInstall']
        if not isinstance(post, list) or not post or not all(isinstance(item, str) and item for item in post):
            raise PluginError('postInstall must be a nonempty list of command arguments')
    if 'adoptOnUpgradeIf' in value:
        if value.get('adoptOnUpgrade'):
            raise PluginError('adoptOnUpgradeIf replaces adoptOnUpgrade; set one')
        marker = relative_path(value['adoptOnUpgradeIf'])
        if marker.parts[0] != '.orc':
            raise PluginError('adoptOnUpgradeIf must name a file under .orc/')
    requires = value.get('requires', [])
    if (not isinstance(requires, list) or not all(isinstance(item, str) and IDENTIFIER.fullmatch(item) for item in requires)
            or value['id'] in requires or len(set(requires)) != len(requires)):
        raise PluginError('requires must list other plugin ids')
    if 'icon' in value:
        if not isinstance(value['icon'], str) or not value['icon'].lower().endswith('.png'):
            raise PluginError('Plugin icon must be a PNG')
        package_file(root, value['icon'])
    contributions = value.get('contributes', {})
    if not isinstance(contributions, dict) or contributions.keys() - KINDS:
        raise PluginError('Unknown contribution kind')
    for key in ('frontend', 'backend', 'railsHelpers', 'worktreeServers', 'sendOffs'):
        if key in contributions:
            package_file(root, contributions[key])
    commands = contributions.get('commands', {})
    if not isinstance(commands, dict):
        raise PluginError('Commands must map names to package paths')
    for name, target in commands.items():
        if not IDENTIFIER.fullmatch(name):
            raise PluginError('Invalid command name')
        if not os.access(package_file(root, target), os.X_OK):
            raise PluginError('Command must be executable: ' + name)
    rules = contributions.get('repositoryRules', {})
    if not isinstance(rules, dict):
        raise PluginError('Repository rules must map GitHub owners to package paths')
    for owner, target in rules.items():
        if not IDENTIFIER.fullmatch(owner):
            raise PluginError('Invalid GitHub owner for repository rules: ' + owner)
        package_file(root, target)
    guides = contributions.get('verificationGuides', {})
    if not isinstance(guides, dict):
        raise PluginError('Verification guides must map GitHub owner/repo names to package paths')
    for slug, target in guides.items():
        if not isinstance(slug, str) or not GITHUB_REPOSITORY.fullmatch(slug):
            raise PluginError('Invalid GitHub owner/repo for a verification guide: %s' % slug)
        package_file(root, target)
    if 'pullRequestReviewer' in contributions:
        _validate_pull_request_reviewer(contributions['pullRequestReviewer'])
    skills = contributions.get('skills', [])
    if not isinstance(skills, list):
        raise PluginError('Skills must be a list of package directories')
    for target in skills:
        package_file(root, str(relative_path(target) / 'SKILL.md'))
    external = contributions.get('externalService')
    if external is not None:
        required = {'files', 'pidFiles', 'stopCommand'}
        if not isinstance(external, dict) or not required <= external.keys() <= required | {'startCommand'}:
            raise PluginError('External service requires files, pidFiles and stopCommand, and may add startCommand')
        for key in ('files', 'pidFiles'):
            if not isinstance(external[key], list):
                raise PluginError('External service markers must be lists')
            for path in external[key]:
                relative_path(path)
        # startCommand is optional: an upgrade that stopped the service runs it to start the new copy.
        for key in ('stopCommand', 'startCommand'):
            if key not in external:
                continue
            command = external[key]
            if not isinstance(command, list) or not command or not all(isinstance(arg, str) and arg for arg in command):
                raise PluginError('External service requires an explicit ' + ('stop' if key == 'stopCommand' else 'start')
                                  + ' command')
            package_file(root, command[0])
    if 'qaBrowser' in contributions:
        _validate_qa_browser(root, contributions['qaBrowser'])
    if 'qaSetupFixes' in contributions:
        _validate_qa_setup_fixes(contributions['qaSetupFixes'])
    harness = contributions.get('harness')
    if harness is not None:
        if (not isinstance(harness, dict) or not isinstance(harness.get('id'), str)
                or not IDENTIFIER.fullmatch(harness['id']) or harness['id'] in (*CORE_AGENTS, *BUILTIN_AGENTS)):
            raise PluginError('Harness requires an id that is not a built-in agent')
        if not isinstance(harness.get('label'), str) or not harness['label'].strip():
            raise PluginError('Harness requires a label')
        package_file(root, harness.get('module'))
    theme = contributions.get('theme')
    if theme is not None:
        if not isinstance(theme, dict) or not isinstance(theme.get('id'), str) or not IDENTIFIER.fullmatch(theme['id']):
            raise PluginError('Theme requires an id')
        if theme['id'] in HOST_THEME_IDS:
            raise PluginError('Theme id is reserved by the host: ' + theme['id'])
        if not isinstance(theme.get('label'), str):
            raise PluginError('Theme requires a label')
        # `terminal` named a stage scene module, which Orc no longer loads;
        # packages made for it still install.
        for key in ('css', 'icon', 'gary', 'sheila', 'scene', 'terminal', 'components', 'tokens'):
            if key in theme:
                package_file(root, theme[key])
        # The assistant's in-app faces: character cutouts, unlike icon.png,
        # which keeps its tile for the Dock.
        for key in ('gary', 'sheila'):
            if key in theme and not theme[key].lower().endswith('.png'):
                raise PluginError('Theme %s must be a PNG' % key)
        if 'css' not in theme:
            raise PluginError('Theme requires CSS')
        _validate_theme_declarative(root, theme)
    return value


# The PR comment that asks the reviewer for a fresh review, such as
# "/zerohands review": one short line, posted as the person.
REVIEW_REQUEST_MAX = 200


def _validate_pull_request_reviewer(value):
    required = {'repository', 'workflow', 'login'}
    if (not isinstance(value, dict) or not required <= value.keys() <= required | {'requestComment'}
            or not isinstance(value['repository'], str) or not GITHUB_REPOSITORY.fullmatch(value['repository'])
            or not all(isinstance(value[key], str) and value[key].strip() for key in ('workflow', 'login'))):
        raise PluginError('Pull request reviewer requires a GitHub owner/repo, a workflow and a reviewer login')
    request = value.get('requestComment')
    if request is not None and (not isinstance(request, str) or not request.strip()
                                or '\n' in request or len(request) > REVIEW_REQUEST_MAX):
        raise PluginError('Pull request reviewer requestComment must be one line of at most %d characters'
                          % REVIEW_REQUEST_MAX)


# A plugin zip dropped on Settings -> Plugins. The cap on the zip is the one
# the hub promises; the others stop a small zip unpacking into a huge tree.
ZIP_MAX_BYTES = 50 * 1024 * 1024
ZIP_MAX_UNPACKED = 200 * 1024 * 1024
ZIP_MAX_ENTRIES = 5000
ZIP_ICON_MAX_BYTES = 512 * 1024


def _zip_junk(name):
    """Finder's resource forks and folder settings, which a zip made with
    Compress carries and no package means."""
    parts = name.rstrip('/').split('/')
    return parts[0] == '__MACOSX' or parts[-1] == '.DS_Store'


def unpack_zip(archive, destination):
    """Unpacks a plugin zip into ``destination`` and returns the package
    folder: the zip's top level, or the one folder it holds, as each plugin's
    download button writes it. Member by member, refusing links, special
    files and any path that would land outside ``destination``. A file keeps
    only whether it runs: 0o755 or 0o644."""
    destination = Path(destination)
    try:
        if os.path.getsize(archive) > ZIP_MAX_BYTES:
            raise PluginError('the zip is over 50 MB')
        handle = zipfile.ZipFile(archive)
    except (OSError, zipfile.BadZipFile) as error:
        raise PluginError('this is not a zip file') from error
    with handle:
        members = [member for member in handle.infolist() if not _zip_junk(member.filename)]
        if len(members) > ZIP_MAX_ENTRIES:
            raise PluginError('the zip holds more than %d files' % ZIP_MAX_ENTRIES)
        total = 0
        for member in members:
            kind = stat.S_IFMT(member.external_attr >> 16)
            if kind not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise PluginError('the zip contains a link or special file: ' + member.filename)
            if member.flag_bits & 0x1:
                raise PluginError('the zip is encrypted')
            try:
                relative_path(member.filename.rstrip('/'))
            except PluginError:
                raise PluginError('the zip has a path that points outside it: ' + member.filename) from None
            total += member.file_size
            if total > ZIP_MAX_UNPACKED:
                raise PluginError('the zip unpacks to more than 200 MB')
        try:
            for member in members:
                target = destination / relative_path(member.filename.rstrip('/'))
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with handle.open(member) as source, target.open('xb') as copy:
                    shutil.copyfileobj(source, copy)
                target.chmod(0o755 if (member.external_attr >> 16) & 0o111 else 0o644)
        except (OSError, zipfile.BadZipFile, EOFError) as error:
            raise PluginError('the zip could not be unpacked: ' + str(error)) from error
    if (destination / 'orc-plugin.json').is_file():
        return destination
    top = list(destination.iterdir())
    if len(top) == 1 and top[0].is_dir() and (top[0] / 'orc-plugin.json').is_file():
        return top[0]
    raise PluginError('the zip has no orc-plugin.json, at its top or in its one folder')


_PLAIN_OPENERS = {'This', 'The', 'Only', 'Package', 'Packages', 'Plugin', 'Invalid', 'Unknown', 'Unsupported',
                  'Missing', 'External', 'Command', 'Commands', 'Theme', 'Harness', 'Disable', 'Stop', 'Skills',
                  'Repository', 'Verification', 'Refusing', 'Owned', 'Required', 'Cannot'}


def _zip_refusal(error):
    """The confirm screen's one sentence for a zip Orc will not install."""
    text = str(error)
    # Lower-case a sentence the registry starts with a plain word, never one
    # that starts with a plugin's name.
    if text.split(' ', 1)[0] in _PLAIN_OPENERS:
        text = text[0].lower() + text[1:]
    sentence = "This zip can't be installed: " + text.rstrip('.') + '.'
    if 'needs a newer Orc' in text:
        sentence += ' Update Orc, then drop it again.'
    return sentence


def zip_adds(data):
    """What a package adds, in the words the confirm screen lists. Each row
    is ``{'text', 'code'}``; ``code`` names commands or skills to show as code."""
    contributes = data.get('contributes', {})
    rows = []
    theme = contributes.get('theme')
    if isinstance(theme, dict):
        extra = ' with its own scene' if theme.get('scene') else ''
        rows.append({'text': 'A theme%s: %s, under Appearance' % (extra, theme.get('label') or theme.get('id')), 'code': []})
    if contributes.get('frontend'):
        rows.append({'text': "Code that runs in Orc's window", 'code': []})
    if contributes.get('backend'):
        rows.append({'text': 'A background service on this Mac', 'code': []})
    if contributes.get('externalService'):
        rows.append({'text': 'A service that keeps running outside Orc', 'code': []})
    harness = contributes.get('harness')
    if isinstance(harness, dict):
        rows.append({'text': 'An agent to start runs with: ' + str(harness.get('label') or harness.get('id')), 'code': []})
    commands = sorted(contributes.get('commands') or {})
    if commands:
        rows.append({'text': 'Commands for agents:', 'code': commands})
    skills = [PurePosixPath(str(item)).name for item in contributes.get('skills') or []]
    if skills:
        rows.append({'text': 'One skill:' if len(skills) == 1 else '%d skills:' % len(skills), 'code': skills})
    if contributes.get('railsHelpers'):
        rows.append({'text': 'Rails helpers for worktrees', 'code': []})
    if contributes.get('repositoryRules'):
        rows.append({'text': 'Review rules for repositories owned by:', 'code': sorted(contributes['repositoryRules'])})
    if contributes.get('verificationGuides'):
        rows.append({'text': 'Verification guides for:', 'code': sorted(contributes['verificationGuides'])})
    if contributes.get('qaBrowser'):
        rows.append({'text': 'Browser settings for QA runs', 'code': []})
    if contributes.get('qaSetupFixes'):
        rows.append({'text': 'Fixes for app setup failures in QA:', 'code': [fix['id'] for fix in contributes['qaSetupFixes']]})
    if contributes.get('pullRequestReviewer'):
        rows.append({'text': 'Pull request reviews from:', 'code': [contributes['pullRequestReviewer']['repository']]})
    if contributes.get('sendOffs'):
        rows.append({'text': 'Send-off scenes', 'code': []})
    return rows


def tree_key(root):
    """One lstat per entry under ``root``: equal keys mean manifest() would
    read the same tree. None when the tree cannot be walked."""
    try:
        top = os.lstat(root).st_mode
        entries, pending = [], [str(root)]
        while pending:
            with os.scandir(pending.pop()) as found:
                for entry in found:
                    info = entry.stat(follow_symlinks=False)
                    entries.append((entry.path, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns))
                    if stat.S_ISDIR(info.st_mode):
                        pending.append(entry.path)
    except OSError:
        return None
    return top, tuple(sorted(entries))


def digest(root):
    result = hashlib.sha256()
    for path in sorted(root.rglob('*')):
        if path.is_file():
            result.update(str(path.relative_to(root)).encode() + b'\0')
            result.update(str(path.stat().st_mode & 0o777).encode() + b'\0')
            result.update(path.read_bytes())
    return result.hexdigest()


def atomic_json(path, value):
    fd, name = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(value, handle, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


class Registry:
    def __init__(self, home=None, root=ROOT):
        self.home = Path(home or Path.home()).resolve()
        try:
            self.data_boundary = configured_target(self.home) or self.home
        except ValueError:
            self.data_boundary = self.home
        self.root = Path(root).resolve()
        self.store = self.home / '.orc/app-plugins'
        self.state_path = self.home / '.orc/app-plugins.json'
        self.bin = self.home / '.local/bin'
        self._scans = {}
        self._catalog_cache = None
        self._digests = {}
        self._linked_digests = {}
        self._manifests = {}
        self._policy = catalog_policy(self.root)

    @staticmethod
    def _unvalidated_manifest(path):
        """The manifest of a package that failed validation, when it still
        names a valid id; None otherwise."""
        try:
            value = json.loads(path.read_text())
        except (OSError, ValueError):
            return None
        if isinstance(value, dict) and isinstance(value.get('id'), str) and IDENTIFIER.fullmatch(value['id']):
            return value
        return None

    def _scan(self, folder):
        if folder not in self._scans:
            found = {}
            for path in sorted((self.root / folder).glob('*/orc-plugin.json')):
                try:
                    value = manifest(path.parent)
                except PluginError:
                    # A package that fails validation (a stray __pycache__
                    # from running its tests, say) stays in the catalog:
                    # list() validates it again and reports the error on its
                    # own row, instead of one bad package taking down every
                    # caller of the registry.
                    value = self._unvalidated_manifest(path)
                    if value is None:
                        continue
                if value['id'] in found:
                    raise PluginError('Duplicate bundled plugin id')
                found[value['id']] = (path.parent, value)
            self._scans[folder] = found
        return self._scans[folder]

    def allows_feature(self, feature):
        """Whether an optional catalog policy enables a checkout-local feature."""
        return bool(self._policy and hasattr(self._policy, 'allows_feature')
                    and self._policy.allows_feature(self, feature))

    def _always_on(self, identifier, catalog):
        return bool(self._policy and hasattr(self._policy, 'is_always_on')
                    and self._policy.is_always_on(self, identifier, catalog))

    def _blocked_by_policy(self, identifier, catalog):
        return bool(self._policy and hasattr(self._policy, 'is_blocked')
                    and self._policy.is_blocked(self, identifier, catalog))

    def catalog(self):
        """Packages that ship with Orc in ``app-plugins/``, plus any entries
        an optional catalog policy supplies."""
        policy_key = (self._policy.catalog_key(self)
                      if self._policy and hasattr(self._policy, 'catalog_key') else None)
        key = (policy_key, self.state_key())
        if self._catalog_cache is not None and self._catalog_cache[0] == key:
            return self._catalog_cache[1]
        catalog = dict(self._scan('app-plugins'))
        try:
            installed = self._state()['installed']
        except PluginError:
            installed = {}
        if self._policy and hasattr(self._policy, 'extra_catalog'):
            catalog.update(self._policy.extra_catalog(self, catalog, installed, PluginError))
        self._catalog_cache = (key, catalog)
        return catalog

    def _manifest(self, root):
        """manifest(root), validated again only when an entry under it
        changed: every listing and plugin asset request reads it again."""
        key = tree_key(root)
        cached = self._manifests.get(str(root))
        if key is None or cached is None or cached[0] != key:
            try:
                result = manifest(root)
            except PluginError as error:
                result = error
            cached = (key, result)
            if key is not None:
                self._manifests[str(root)] = cached
        if isinstance(cached[1], PluginError):
            raise PluginError(str(cached[1]))
        return cached[1]

    def state_key(self):
        """Changes whenever the registry state is replaced, in this process
        or another."""
        try:
            info = self.state_path.stat()
        except OSError:
            return None
        return info.st_mtime_ns, info.st_size, info.st_ino

    def _state(self):
        if not self.state_path.exists():
            return {'revision': 0, 'setupComplete': False, 'installed': {}}
        try:
            value = json.loads(self.state_path.read_text())
            if not isinstance(value['revision'], int) or not isinstance(value['installed'], dict):
                raise ValueError('Invalid registry state')
            return value
        except (OSError, ValueError, KeyError) as error:
            raise PluginError('Cannot read application plugin state: ' + str(error)) from error

    @contextlib.contextmanager
    def _lock(self, expected_revision):
        for path in (self.state_path, self.store, self.bin, self.state_path.parent / 'app-plugins.lock'):
            boundary = self.home if path == self.bin else self.data_boundary
            if path.is_symlink() or not path.resolve().is_relative_to(boundary):
                raise PluginError('Plugin state cannot escape its home: ' + str(path))
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        with (self.state_path.parent / 'app-plugins.lock').open('a') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            state = self._state()
            if expected_revision is not None and state['revision'] != expected_revision:
                raise Conflict('Plugins changed elsewhere; reload and try again')
            yield state

    def _root(self, record, *, pinned=False, catalog=None):
        if record.get('linked'):
            return Path(record['linked'])
        if not pinned:
            catalog = self.catalog() if catalog is None else catalog
            if record['id'] in catalog:
                return catalog[record['id']][0]
        path = self.store / record['id'] / record['digest']
        if not path.resolve().is_relative_to(self.store.resolve()):
            raise PluginError('Invalid installed package path')
        return path

    def _with_catalog_icon(self, identifier, data):
        if data.get('icon') or data.get('contributes', {}).get('theme', {}).get('icon'):
            return data
        scanned = self._scan('private').get(identifier) or self._scan('app-plugins').get(identifier)
        if not scanned:
            return data
        _, catalog_data = scanned
        if catalog_data.get('icon'):
            return {**data, 'icon': catalog_data['icon']}
        theme_icon = catalog_data.get('contributes', {}).get('theme', {}).get('icon')
        if theme_icon and isinstance(data.get('contributes', {}).get('theme'), dict):
            return {**data, 'contributes': {
                **data['contributes'],
                'theme': {**data['contributes']['theme'], 'icon': theme_icon},
            }}
        return data

    def list(self):
        state = self._state()
        catalog = self.catalog()
        rows = [row for identifier in sorted(catalog.keys() | state['installed'].keys())
                if (row := self._row(identifier, state, catalog))]
        by_id = {row['id']: row for row in rows}
        for identifier in state.get('retired', {}):
            row = self._retired_row(identifier, state)
            if not row:
                continue
            # A removed copy of a catalog package shows on that package's own
            # card, so Settings has one card per id.
            if identifier in by_id:
                by_id[identifier].update(state='stopping', message=row['message'])
            else:
                rows.append(row)
        return {'revision': state['revision'], 'setupComplete': state.get('setupComplete', False), 'plugins': rows}

    def _row_extras(self, identifier, data, always_on):
        if self._policy and hasattr(self._policy, 'row_extras'):
            return self._policy.row_extras(self, identifier, data, always_on)
        return {'private': False, 'hidden': False}

    def _row(self, identifier, state, catalog):
        """list()'s row for a catalog or installed package, reading only that
        package's files. None when ``identifier`` is neither."""
        record = state['installed'].get(identifier)
        bundled = catalog.get(identifier)
        always_on = self._always_on(identifier, catalog)
        if always_on:
            record = None
        elif self._blocked_by_policy(identifier, catalog):
            return None
        if not record and not bundled:
            return None
        required = bool(bundled and bundled[1].get('required'))
        root = self._root(record, catalog=catalog) if record else bundled[0]
        error = None
        try:
            data = self._manifest(root)
        except PluginError as exc:
            error = str(exc)
            data = record['manifest'] if record else bundled[1]
        data = self._with_catalog_icon(identifier, data)
        # A required package is part of Orc: a record left disabled by an
        # older Orc, when it was still a plugin you could switch off, does not
        # turn it off.
        enabled = bool(required or always_on or (record and record['enabled']))
        linked = bool(record and record.get('linked'))
        if linked:
            revision = self._linked_digest(root)
        else:
            if str(root) not in self._digests:
                self._digests[str(root)] = digest(root)
            revision = record['digest'] if record and not bundled else self._digests[str(root)]
        row = {**data, 'installed': bool(record) or required or always_on,
               'enabled': enabled, 'required': required, 'bundled': bool(bundled),
               **self._row_extras(identifier, data, always_on),
               'digest': revision, 'root': str(root), 'error': error,
               'trust': trust(data), 'linked': str(root) if linked else None,
               'olderApi': type(data.get('apiVersion')) is int and data['apiVersion'] < API_VERSION,
               'state': 'error' if error else 'enabled' if enabled else 'disabled' if record else 'available'}
        if record and record.get('gitSource'):
            row['gitSource'] = self._git_row(identifier, record)
        if record and not enabled and self.external_service_pending(record):
            row.update(state='stopping', message=self.recovery_message(record))
        return row

    def _retired_row(self, identifier, state):
        """list()'s row for a removed package whose external service is still
        stopping, else None."""
        record = state.get('retired', {}).get(identifier)
        if not record or identifier in state['installed'] or not self.external_service_pending(record):
            return None
        retired_data = self._with_catalog_icon(identifier, record['manifest'])
        return {**retired_data, 'installed': False, 'enabled': False, 'required': False,
                'bundled': False, **self._row_extras(identifier, retired_data, False),
                'digest': record['digest'], 'root': str(self._root(record, pinned=True)),
                'error': None, 'state': 'stopping', 'message': self.recovery_message(record)}

    def _linked_digest(self, root):
        """A linked folder's digest, worked out again only when an entry
        under it changed, so an edit gets a new asset URL on the next list."""
        key = tree_key(root)
        cached = self._linked_digests.get(str(root))
        if key is None:
            return 'missing'
        if cached is None or cached[0] != key:
            try:
                cached = (key, digest(root))
            except OSError:
                return 'missing'
            self._linked_digests[str(root)] = cached
        return cached[1]

    def enabled_root(self, identifier):
        """Where package ``identifier`` runs from while it is enabled and sound,
        else None. Unlike list(), it reads no other package."""
        catalog = self.catalog()
        package = self._enabled_package(identifier, self._state()['installed'], catalog)
        return package[0] if package else None

    def _enabled_package(self, identifier, installed, catalog):
        record = installed.get(identifier)
        if self._always_on(identifier, catalog):
            root = catalog[identifier][0]
        elif self._blocked_by_policy(identifier, catalog):
            root = None
        elif record is None:
            bundled = catalog.get(identifier)
            root = bundled[0] if bundled and bundled[1].get('required') else None
        else:
            required = identifier in catalog and catalog[identifier][1].get('required')
            root = self._root(record, catalog=catalog) if record.get('enabled') or required else None
        if root is None:
            return None
        try:
            return root, self._manifest(root)
        except PluginError:
            return None

    def external_service_pending(self, record):
        external = record['manifest'].get('contributes', {}).get('externalService', {})
        if any((self.home / name).exists() or (self.home / name).is_symlink() for name in external.get('files', [])):
            return True
        for name in external.get('pidFiles', []):
            try:
                pid = json.loads((self.home / name).read_text())['pid']
                if type(pid) is not int or pid <= 0:
                    return True
                os.kill(pid, 0)
                return True
            except (FileNotFoundError, ProcessLookupError):
                continue
            except (OSError, ValueError, KeyError, TypeError):
                return True
        return False

    def recovery_message(self, record):
        command = record['manifest']['contributes']['externalService']['stopCommand']
        stop = shlex.join([str(self._root(record, pinned=True) / command[0]), *command[1:]])
        return ('New Orc requests are blocked. Close existing browser panes. Stop the independently started service with '
                + stop + ', or exit its terminal if started manually. Then choose Apply again. Data and worktrees remain.')

    def contributions(self, kind):
        installed = self._state()['installed']
        catalog = self.catalog()
        providers = []
        for identifier in sorted(catalog.keys() | installed.keys()):
            package = self._enabled_package(identifier, installed, catalog)
            if package is None:
                continue
            root, data = package
            if kind in data.get('contributes', {}):
                data = self._with_catalog_icon(identifier, data)
                providers.append((root, data['contributes'][kind]))
        return providers

    def repository_rules(self, repo):
        slug = github_origin(repo)
        if slug is None:
            return []
        owner = slug.split('/', 1)[0]
        return [package_file(root, rules[owner])
                for root, rules in self.contributions('repositoryRules') if owner in rules]

    def verification_guides(self, repo):
        """The enabled packages' guides to verifying changes in this checkout,
        matched on its GitHub origin, as ``{'plugin', 'path'}`` rows."""
        slug = github_origin(repo)
        if slug is None:
            return []
        return [{'plugin': row['name'], 'path': package_file(Path(row['root']), row['contributes']['verificationGuides'][slug])}
                for row in self.list()['plugins']
                if row['enabled'] and not row['error']
                and slug in row.get('contributes', {}).get('verificationGuides', {})]

    def pull_request_reviewer(self):
        """The first enabled package's reviewer that reviews pull requests in a
        GitHub Actions workflow, as ``{'repository', 'workflow', 'login'}``
        plus the optional ``'requestComment'`` that asks it for a review, or
        None while no enabled package provides one."""
        providers = self.contributions('pullRequestReviewer')
        return dict(providers[0][1]) if providers else None

    def qa_setup_fixes(self):
        """Every enabled package's known setup failures, in package order, as
        ``{'plugin', 'id', 'match', 'reason', 'explain', 'command'}`` rows."""
        return [{'plugin': row['id'], **fix} for row in self.list()['plugins']
                if row['enabled'] and not row['error']
                for fix in row.get('contributes', {}).get('qaSetupFixes') or []]

    def command(self, name):
        """Where an enabled package's command runs from, or None while no
        enabled package provides it. The owned link in ``~/.local/bin`` comes
        first: it survives upgrades, so a client that saves the path keeps working."""
        for root, commands in self.contributions('commands'):
            if name in commands:
                target = package_file(root, commands[name])
                link = self.bin / name
                return link if link.is_symlink() and link.resolve() == target.resolve() else target
        return None

    def post_install_commands(self):
        """Resolved argv lists for enabled packages declaring ``postInstall``."""
        found = []
        for row in self.list()['plugins']:
            if not row['enabled'] or row['error']:
                continue
            spec = row.get('postInstall')
            if not isinstance(spec, list) or not spec:
                continue
            cmd = self.command(spec[0])
            if cmd is not None:
                found.append([str(cmd), *spec[1:]])
        return found

    def browser_state(self):
        state = self.list()
        for row in state['plugins']:
            row.pop('root')
            row['base'] = '/app-plugin-assets/' + row['id'] + '/' + row['digest'] + '/'
        # The required theme paints first, then the packages that are part
        # of Orc (Skills), then private and public plugins.
        state['plugins'].sort(key=lambda row: (
            not (row['required'] and row.get('contributes', {}).get('theme')),
            not row['required'],
            not (row.get('private') or not row['bundled']),
            row['name'].lower(),
        ))
        return state

    def asset(self, path):
        parts = path.split('/', 2)
        if len(parts) != 3:
            raise PluginError('Invalid plugin asset')
        identifier, revision, name = parts
        if Path(name).suffix not in ('.js', '.css', '.svg', '.png', '.ico', '.mp3', '.wav', '.webp'):
            raise PluginError('Not a browser asset')
        # Only this package's row: listing every package walks every tree,
        # and a theme gallery asks for dozens of files at once.
        state = self._state()
        rows = (self._row(identifier, state, self.catalog()),
                self._retired_row(identifier, state))
        row = next((item for item in rows if item and item['digest'] == revision
                    and not item['error']
                    and (item['enabled'] or self._hub_icon(item, name) or self._theme_preview(item, name))), None)
        if not row:
            raise PluginError('Plugin is not enabled')
        root = Path(row['root'])
        if self._hub_icon(row, name) and not (root / name).is_file():
            extra_root = (self._policy.extra_asset_root(self, identifier)
                          if self._policy and hasattr(self._policy, 'extra_asset_root') else None)
            if extra_root:
                root = extra_root
            else:
                scanned = self._scan('app-plugins').get(identifier)
                if scanned:
                    root = scanned[0]
        return package_file(root, name)

    # The plugin hub shows a listed package's icon while it is available,
    # disabled or stopping; its other files stay closed until it is enabled.
    @staticmethod
    def _hub_icon(row, name):
        return name in (row.get('icon'), row.get('contributes', {}).get('theme', {}).get('icon'))

    # Settings paints a model of Orc with each of Orc's own themes before it
    # is installed. That takes the theme's styles and pictures, never its code.
    @staticmethod
    def _theme_preview(row, name):
        return bool(row['bundled'] and row.get('contributes', {}).get('theme')) and Path(name).suffix != '.js'

    def theme_css(self):
        rows = sorted(self.list()['plugins'], key=lambda row: not row['required'])
        return '\n'.join(package_file(Path(row['root']), row['contributes']['theme']['css']).read_text()
                         for row in rows if row['enabled'] and not row['error'] and row.get('contributes', {}).get('theme'))

    def _skill_homes(self):
        homes = [self.home / '.agents', self.home / '.claude']
        homes.extend(path for path in sorted(self.home.glob('.claude-*')) if (path / '.claude.json').is_file())
        configured = os.environ.get('CLAUDE_CONFIG_DIR')
        if configured:
            homes.append(self.home / configured[2:] if configured.startswith('~/') else Path(configured))
        # Owned links refuse a symlinked parent, so each home is linked at its
        # real place: a config dir under macOS's /var, or a ~/.claude kept in dotfiles.
        return list(dict.fromkeys(str(path.resolve()) for path in homes))

    def _links(self, state, *, legacy=False):
        links = {}
        for record in state['installed'].values():
            if not record['enabled']:
                continue
            root = self._root(record, pinned=legacy)
            if not legacy and not root.is_dir():
                continue
            data = manifest(root) if not legacy and record['id'] in self.catalog() else record['manifest']
            for name, target in data.get('contributes', {}).get('commands', {}).items():
                path = self.bin / name
                if path in links:
                    raise PluginError('Command collision: ' + name)
                links[path] = root / target
            for target in data.get('contributes', {}).get('skills', []):
                for host in record.get('skillHomes', [str(self.home / name) for name in ('.agents', '.claude')]):
                    path = Path(host) / 'skills' / Path(target).name
                    if path in links:
                        raise PluginError('Skill collision: ' + str(path))
                    links[path] = root / target
        return links

    def _validate_links(self, before, after, adopted=None):
        old = ({Path(name): Path(target) for name, target in before['ownedLinks'].items()}
               if 'ownedLinks' in before else self._links(before, legacy=True))
        new = self._links(after)
        old.update(adopted or {})
        changed = {name for name in old.keys() | new.keys() if old.get(name) != new.get(name)}
        for name in changed:
            path = name
            if path.parent.resolve() != path.parent:
                raise PluginError('Owned links cannot traverse symlinks: ' + str(path))
            if path.exists() or path.is_symlink():
                if not path.is_symlink() or name not in old or os.readlink(path) != str(old[name]):
                    raise PluginError('Refusing to replace unowned command: ' + str(path))
        return old, new, changed

    def _commit(self, before, after, adopted=None):
        old, new, changed = self._validate_links(before, after, adopted)
        self.bin.mkdir(parents=True, exist_ok=True)
        rollback = {}
        try:
            for name in changed:
                path = name
                path.parent.mkdir(parents=True, exist_ok=True)
                rollback[name] = os.readlink(path) if path.is_symlink() else None
                path.unlink(missing_ok=True)
                if name in new:
                    path.symlink_to(new[name])
            after['revision'] = before['revision'] + 1
            after['ownedLinks'] = {str(path): str(target) for path, target in new.items()}
            atomic_json(self.state_path, after)
        except BaseException:
            for name, target in rollback.items():
                path = name
                path.unlink(missing_ok=True)
                if target is not None:
                    path.symlink_to(target)
            raise

    def reconcile_links(self):
        with self._lock(None) as before:
            for row in self.list()['plugins']:
                if row['enabled']:
                    self._validate_collisions(row['id'], row, before)
            _, _, changed = self._validate_links(before, before)
            if changed:
                self._commit(before, json.loads(json.dumps(before)))

    def _validate_collisions(self, identifier, data, state):
        for name in data.get('contributes', {}).get('commands', {}):
            if (self.root / 'bin' / name).exists():
                raise PluginError('Command shadows a core command: ' + name)
        theme = data.get('contributes', {}).get('theme', {}).get('id')
        for row in self.list()['plugins']:
            if row['id'] != identifier and theme and row.get('contributes', {}).get('theme', {}).get('id') == theme:
                raise PluginError('Theme id collision: ' + theme)
        harness = data.get('contributes', {}).get('harness', {}).get('id')
        if harness and any(key != identifier and item['manifest'].get('contributes', {}).get('harness', {}).get('id') == harness
                           for key, item in state['installed'].items()):
            raise PluginError('Harness id collision: ' + harness)
        helpers = data.get('contributes', {}).get('railsHelpers')
        if helpers and any(key != identifier and item['enabled'] and
                           item['manifest'].get('contributes', {}).get('railsHelpers')
                           for key, item in state['installed'].items()):
            raise PluginError('Only one Rails helper provider can be enabled')

    def _requirements_met(self, state, changed):
        """Every enabled package's ``requires`` are installed and enabled, so a
        package never activates without what it builds on. The refusal names
        the step that fixes it from the side of the package being changed."""
        def data(identifier):
            record = state['installed'].get(identifier)
            if record and identifier in self.catalog():
                return self.catalog()[identifier][1]
            if record:
                return record['manifest']
            return self.catalog().get(identifier, (None, {'name': identifier}))[1]
        for identifier, record in state['installed'].items():
            if not record['enabled']:
                continue
            for need in data(identifier).get('requires', []):
                other = state['installed'].get(need)
                if other and other['enabled']:
                    continue
                name, needed = data(identifier).get('name', identifier), data(need).get('name', need)
                if changed == need:
                    raise PluginError('%s needs the %s plugin. Disable %s first.' % (name, needed, name))
                raise PluginError('%s needs the %s plugin. %s %s first.' % (
                    name, needed, 'Enable' if other else 'Add', needed))

    def _install_source(self, source, data, bundled):
        """Whether ``source`` is the bundled copy of its id, refusing a package
        that would stand in for one of Orc's own."""
        identifier = data['id']
        if self._policy and hasattr(self._policy, 'allow_install'):
            self._policy.allow_install(self, identifier, data, PluginError)
        catalog = self.catalog()
        if identifier in catalog and source.resolve() == catalog[identifier][0].resolve():
            bundled = True
        elif identifier in catalog:
            raise PluginError('External packages cannot shadow bundled ids; run orc-app-plugin add ' + identifier)
        if bundled and identifier not in catalog:
            raise PluginError('Unknown bundled package')
        return bundled

    def _install_plan(self, source, data, before, *, enable, bundled, adopt_legacy=None, source_revision=None,
                      replace_running=False, git_source=None, service_stops=False):
        """(record, state after, adopted links) for installing ``source``, or
        the refusal. It writes nothing, so checking a zip runs exactly what
        installing it would. ``replace_running`` replaces an enabled package
        that runs code in place: the runtime stops the old revision and starts
        the new one, as it does for a bundled package Orc updates.
        ``service_stops`` checks a plan whose caller stops an enabled copy's
        running external service first (install_over)."""
        identifier = data['id']
        if data.get('required') and not bundled:
            raise PluginError('Only bundled policy can require a package')
        self._validate_collisions(identifier, data, before)
        adopted = self._adopt(source, data, adopt_legacy) if adopt_legacy else {}
        content_digest = digest(source)
        previous = before['installed'].get(identifier)
        retained = previous or before.get('retired', {}).get(identifier)
        stopped_first = service_stops and previous and previous['enabled'] and not previous.get('linked')
        if (retained and retained['digest'] != content_digest and not stopped_first
                and self.external_service_pending(retained)):
            raise PluginError('Stop the previous external service before replacing its package. ' + self.recovery_message(retained))
        if (not bundled and not replace_running and previous and previous['enabled'] and not previous.get('linked')
                and previous['digest'] != content_digest
                and any(key in value.get('contributes', {})
                        for value in (previous['manifest'], data) for key in ('backend', 'frontend'))):
            raise PluginError('Disable this executable package before updating it; the working revision was retained')
        record = {'id': identifier, 'digest': content_digest, 'enabled': bool(enable or data.get('required')),
                  'manifest': data, 'sourceRevision': source_revision, 'skillHomes': self._skill_homes()}
        if git_source:
            record['gitSource'] = git_source
        if adopted:
            record['adoptedCommands'] = {str(path): str(target) for path, target in adopted.items()}
        after = json.loads(json.dumps(before))
        after['installed'][identifier] = record
        if bundled:
            self._settle_adoption(after, identifier, data)
        after.get('retired', {}).pop(identifier, None)
        self._requirements_met(after, identifier)
        self._validate_links(before, after, adopted)
        return record, after, adopted

    def install_over(self, source, *, expected_revision=None, run=subprocess.run, sleep=time.sleep, **kwargs):
        """A manual install (a path, a zip or Install from Git) of ``source``.
        It replaces the copy of its id you have in place, even while it runs:
        a running external service is stopped with the old copy's stopCommand
        and started again with the new copy's, so installing a newer copy
        never needs a manual stop. What install() would refuse is refused
        before the service stops. A copy being turned off or removed is left
        alone: install() refuses it with the manual step. The result carries
        ``message`` when the service restarted or stayed stopped."""
        source = Path(source).absolute()
        data = manifest(source)
        bundled = self._install_source(source, data, False)
        with self._lock(expected_revision) as before:
            record, _after, _adopted = self._install_plan(
                source, data, before, enable=kwargs.get('enable', True), bundled=bundled,
                adopt_legacy=kwargs.get('adopt_legacy'), source_revision=kwargs.get('source_revision'),
                replace_running=True, git_source=kwargs.get('git_source'), service_stops=True)
            previous = before['installed'].get(data['id'])
        results = []

        def install():
            results.append(self.install(source, expected_revision=expected_revision, replace_running=True, **kwargs))
        done = ''
        if previous and not previous.get('linked') and previous['digest'] != record['digest']:
            done = self._replace_running(previous, install, run, sleep)
        if not results:
            install()
        if not done:
            return results[0]
        return {**results[0], 'message': '%s installed%s.' % (data.get('name') or data['id'], done)}

    def install(self, source, enable=True, expected_revision=None, *, bundled=False, adopt_legacy=None, source_revision=None,
                replace_running=False, git_source=None):
        source = Path(source).absolute()
        data = manifest(source)
        identifier = data['id']
        bundled = self._install_source(source, data, bundled)
        with self._lock(expected_revision) as before:
            record, after, adopted = self._install_plan(
                source, data, before, enable=enable, bundled=bundled, adopt_legacy=adopt_legacy,
                source_revision=source_revision, replace_running=replace_running, git_source=git_source)
            content_digest = record['digest']
            destination = self._root(record)
            created = not bundled and not destination.exists()
            if created:
                destination.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.TemporaryDirectory(prefix='.stage-', dir=destination.parent) as staging:
                    staged = Path(staging) / 'package'
                    shutil.copytree(source, staged)
                    manifest(staged)
                    if digest(staged) != content_digest:
                        raise PluginError('Package changed while installing')
                    # Moving a directory between parents requires write access on
                    # the directory itself; immutable runtime packages lack it.
                    staged.chmod(staged.stat().st_mode | 0o200)
                    staged.rename(destination)
            try:
                self._commit(before, after, adopted)
            except BaseException:
                if created:
                    shutil.rmtree(destination)
                raise
        return {**self.list(), 'installedId': identifier}

    def _refuse_zip(self, root, data, state):
        """Refusals for a zip that installing would otherwise accept or word
        for the terminal: one of Orc's own packages, or this very version."""
        identifier = data['id']
        if identifier in self.catalog():
            raise PluginError('this Orc already ships %s. Turn it on in the plugin list instead' % data['name'])
        record = state['installed'].get(identifier)
        if record and record['enabled'] and not record.get('linked') and record['digest'] == digest(root):
            raise PluginError('this version of %s is already installed and on' % data['name'])

    def check_zip(self, archive, filename=None):
        """What the confirm screen shows for a dropped plugin zip, installing
        nothing: its name, version, what it adds and needs, whether it runs
        code, the version it replaces, and ``error`` when installing it would
        be refused. ``canInstall`` is true only without one."""
        result = {'filename': filename or 'plugin.zip', 'size': os.path.getsize(archive), 'canInstall': False}
        with tempfile.TemporaryDirectory(prefix='orc-plugin-zip-') as tmp:
            try:
                root = unpack_zip(archive, Path(tmp) / 'zip')
            except PluginError as error:
                return {**result, 'error': _zip_refusal(error)}
            try:
                raw = json.loads((root / 'orc-plugin.json').read_text())
            except (OSError, ValueError):
                raw = {}
            raw = raw if isinstance(raw, dict) else {}
            for key in ('id', 'name', 'version', 'description'):
                if isinstance(raw.get(key), str) and raw[key].strip():
                    result[key] = raw[key].strip()
            icon = raw.get('icon')
            try:
                path = package_file(root, icon) if isinstance(icon, str) and icon.lower().endswith('.png') else None
                if path and path.stat().st_size <= ZIP_ICON_MAX_BYTES:
                    result['icon'] = 'data:image/png;base64,' + base64.b64encode(path.read_bytes()).decode()
            except (PluginError, OSError):
                pass
            try:
                state = self._state()
                previous = state['installed'].get(result.get('id'))
                if previous and not previous.get('linked'):
                    result['previousVersion'] = previous['manifest'].get('version')
                data = manifest(root)
                result.update(adds=zip_adds(data), trust=trust(data), theme=bool(data.get('contributes', {}).get('theme')),
                              requires=[self._requirement_row(need, state) for need in data.get('requires', [])])
                self._refuse_zip(root, data, state)
                self._install_source(root, data, False)
                with self._lock(None) as before:
                    self._install_plan(root, data, before, enable=True, bundled=False, replace_running=True,
                                       service_stops=True)
            except PluginError as error:
                result['error'] = _zip_refusal(error)
                return result
        result['canInstall'] = True
        return result

    def _requirement_row(self, identifier, state):
        catalog = self.catalog()
        record = state['installed'].get(identifier)
        name = (record['manifest'].get('name') if record else None) or (
            catalog[identifier][1].get('name') if identifier in catalog else identifier)
        return {'id': identifier, 'name': name, 'on': bool(record and record['enabled']), 'installed': bool(record)}

    def install_zip(self, archive, expected_revision=None):
        """Installs a dropped plugin zip, turned on. A newer version of an
        installed package replaces it in place, even while it runs: the
        runtime stops the old revision and starts the new one."""
        with tempfile.TemporaryDirectory(prefix='orc-plugin-zip-') as tmp:
            try:
                root = unpack_zip(archive, Path(tmp) / 'zip')
                data = manifest(root)
                self._refuse_zip(root, data, self._state())
                return self.install_over(root, enable=True, expected_revision=expected_revision)
            except Conflict:
                raise
            except PluginError as error:
                raise PluginError(_zip_refusal(error)) from error

    def link(self, source, enable=True, expected_revision=None):
        """Use a theme folder in place, for working on it: Orc reads the
        folder itself, and an edit reaches open windows on their next
        plugin refresh (within a few seconds). ``install`` pins a copy instead."""
        source = Path(source).absolute()
        data = manifest(source)
        identifier = data['id']
        if set(data.get('contributes', {})) - LINKABLE:
            raise PluginError('Only themes, with an optional frontend, can be linked; install this package instead')
        if identifier in self.catalog():
            raise PluginError('External packages cannot shadow bundled ids; pick another id')
        if data.get('required'):
            raise PluginError('Only bundled policy can require a package')
        if self._policy and hasattr(self._policy, 'allow_link'):
            self._policy.allow_link(self, identifier, data, PluginError)
        with self._lock(expected_revision) as before:
            self._validate_collisions(identifier, data, before)
            previous = before['installed'].get(identifier)
            if (previous and previous['enabled'] and not previous.get('linked')
                    and 'frontend' in previous['manifest'].get('contributes', {})):
                raise PluginError('Disable this executable package before linking over it; the working revision was retained')
            after = json.loads(json.dumps(before))
            after['installed'][identifier] = {
                'id': identifier, 'digest': digest(source), 'enabled': bool(enable), 'manifest': data,
                'linked': str(source.resolve()), 'skillHomes': self._skill_homes()}
            after.get('retired', {}).pop(identifier, None)
            self._requirements_met(after, identifier)
            self._validate_links(before, after)
            self._commit(before, after)
        return {**self.list(), 'installedId': identifier}

    def _adopt(self, source, data, legacy):
        legacy = Path(legacy).absolute()
        if legacy.is_symlink() or legacy.resolve() != legacy:
            raise PluginError('Legacy source cannot contain symlinks')
        commands = data.get('contributes', {}).get('commands', {})
        checkout = all((legacy / item).is_file() for item in ('install.sh', 'bin/orc-ui', 'ui/serve.py'))
        if not checkout:
            if legacy != (self.home / '.orc/plugins' / data['id']).resolve():
                raise PluginError('Adoption requires an old checkout or the installed package directory')
            if not legacy.is_dir() or legacy.is_symlink():
                raise PluginError('Missing legacy package')
            for name, target in commands.items():
                if os.path.lexists(self.bin / name) and not (legacy / target).is_file():
                    raise PluginError('Incomplete legacy package: ' + name)
        adopted = {}
        for name, target in commands.items():
            expected = legacy / ('bin/' + name if checkout else target)
            path = self.bin / name
            if not os.path.lexists(path):
                continue
            if not path.is_symlink() or Path(os.path.abspath(path.parent / os.readlink(path))) != expected:
                raise PluginError('Legacy command ownership could not be verified: ' + name)
            adopted[path] = Path(os.readlink(path))
        if commands and not adopted:
            raise PluginError('Legacy command ownership could not be verified: ' + next(iter(commands)))
        return adopted

    def set_enabled(self, identifier, enabled, expected_revision=None):
        if not isinstance(enabled, bool):
            raise PluginError('Enabled must be a boolean')
        with self._lock(expected_revision) as before:
            catalog = self.catalog()
            if self._policy and hasattr(self._policy, 'allow_switch'):
                self._policy.allow_switch(self, identifier, PluginError)
            if identifier in catalog and catalog[identifier][1].get('required') and not enabled:
                raise PluginError('Required package cannot be disabled')
            if identifier not in before['installed']:
                raise PluginError('Install the package first')
            after = json.loads(json.dumps(before))
            record = after['installed'][identifier]
            data = manifest(self._root(record))
            if enabled:
                self._validate_collisions(identifier, data, before)
                record['skillHomes'] = list(dict.fromkeys([*record.get('skillHomes', []), *self._skill_homes()]))
            record['enabled'] = enabled
            self._requirements_met(after, identifier)
            self._commit(before, after)
        return self.list()

    def uninstall(self, identifier, expected_revision=None):
        with self._lock(expected_revision) as before:
            catalog = self.catalog()
            if self._policy and hasattr(self._policy, 'allow_uninstall'):
                self._policy.allow_uninstall(self, identifier, PluginError)
            if identifier in catalog and catalog[identifier][1].get('required'):
                raise PluginError('Required package cannot be removed')
            if identifier not in before['installed']:
                raise PluginError('Package is not installed')
            after = json.loads(json.dumps(before))
            if after['installed'][identifier]['manifest'].get('contributes', {}).get('externalService'):
                after.setdefault('retired', {})[identifier] = after['installed'][identifier]
            del after['installed'][identifier]
            self._requirements_met(after, identifier)
            self._commit(before, after)
        # In-flight requests can still own code from this revision; data and pinned
        # revisions survive removal rather than invalidating those requests.
        return self.list()

    def _pending_adoptions(self, state, catalog):
        excluded = (self._policy.exclude_from_adoptions
                    if self._policy and hasattr(self._policy, 'exclude_from_adoptions') else lambda _r, _d: False)
        tools = {identifier: data for identifier, (_, data) in catalog.items()
                 if 'theme' not in data.get('contributes', {}) and not excluded(self, data)}
        upgrade = {identifier for identifier, data in tools.items()
                   if data.get('adoptOnUpgrade') or self._adopt_marker(data)}
        # A package that adopts only where its marker is is off for everyone
        # else, so being new to the catalog does not install it.
        unseen_excluded = (self._policy.exclude_unseen(self)
                           if self._policy and hasattr(self._policy, 'exclude_unseen') else set())
        unseen = {identifier for identifier in tools.keys() - set(state.get('catalogSeen', catalog))
                  if 'adoptOnUpgradeIf' not in tools[identifier]} - unseen_excluded
        return sorted((upgrade - set(state.get('upgradeAdopted', []))) | unseen)

    @staticmethod
    def _settle_adoption(state, identifier, data):
        """Once a package that adopts by marker is installed, by hand or by
        adoption, its marker no longer decides: removing it later must stick
        though the marker file remains."""
        if 'adoptOnUpgradeIf' in data and identifier not in state.setdefault('upgradeAdopted', []):
            state['upgradeAdopted'].append(identifier)

    def _adopt_marker(self, data):
        """Whether ``adoptOnUpgradeIf`` names a file this home has: core used
        to keep that state, so this machine already uses what the package now
        holds (Tailscale's saved routes)."""
        marker = data.get('adoptOnUpgradeIf')
        if not marker:
            return False
        try:
            return (self.home / marker).stat().st_size > 2
        except OSError:
            return False

    def _bundled_requirements(self, choices, catalog):
        choices = list(choices)
        for identifier in choices:
            choices.extend(need for need in catalog[identifier][1].get('requires', [])
                           if need in catalog and need not in choices)
        return choices

    def setup(self, choices, expected_revision=None):
        catalog = self.catalog()
        if not isinstance(choices, list) or any(not isinstance(item, str) or item not in catalog for item in choices):
            raise PluginError('Setup accepts bundled plugin ids only')
        if self._policy and hasattr(self._policy, 'filter_setup_choices'):
            choices = self._policy.filter_setup_choices(self, choices, catalog)
        adoptable = sorted(identifier for identifier, (_, data) in catalog.items()
                           if data.get('adoptOnUpgrade') or 'adoptOnUpgradeIf' in data)
        choices = self._bundled_requirements(choices, catalog)
        with self._lock(expected_revision) as before:
            if before.get('setupComplete'):
                # An explicit rerun keeps earlier choices, and it also answers
                # any adoption still pending: only the packages it names.
                pending = self._pending_adoptions(before, catalog)
                unseen = catalog.keys() - set(before.get('catalogSeen', catalog))
                selected = [identifier for identifier in choices if identifier in pending or identifier in unseen]
                if not pending and not selected and 'catalogSeen' in before:
                    return self.list()
                after = json.loads(json.dumps(before))
                for identifier in pending:
                    if identifier not in after.setdefault('upgradeAdopted', []):
                        after['upgradeAdopted'].append(identifier)
                for identifier in self._bundled_requirements(selected, catalog):
                    if identifier not in after['installed']:
                        self._add_bundled(after, identifier)
                self._requirements_met(after, None)
                after['catalogSeen'] = sorted(set(before.get('catalogSeen', [])) | catalog.keys())
                self._commit(before, after)
                return self.list()
            after = json.loads(json.dumps(before))
            for identifier, (source, data) in catalog.items():
                if identifier in after['installed'] or not (data.get('required') or identifier in choices):
                    continue
                self._add_bundled(after, identifier)
            after['catalogSeen'] = sorted(catalog)
            after['upgradeAdopted'] = adoptable
            after['setupComplete'] = True
            self._commit(before, after)
        return self.list()

    def _add_bundled(self, state, identifier):
        source, data = self.catalog()[identifier]
        self._validate_collisions(identifier, data, state)
        self._settle_adoption(state, identifier, data)
        state['installed'][identifier] = {'id': identifier, 'digest': digest(source), 'enabled': True,
                                          'manifest': data, 'skillHomes': self._skill_homes()}

    def _retired_bundled(self, state, catalog):
        """Installed records of RETIRED_BUNDLED packages that came from an old
        release. A pinned or linked copy still has its files and stays,
        except for REMOVED_PACKAGES, which nothing could run any more."""
        retired = []
        extra_retired = (self._policy.retired_bundled()
                         if self._policy and hasattr(self._policy, 'retired_bundled') else {})
        extra_removed = (self._policy.removed_packages()
                         if self._policy and hasattr(self._policy, 'removed_packages') else {})
        removed = {**REMOVED_PACKAGES, **extra_removed}
        for identifier, name in {**RETIRED_BUNDLED, **extra_retired, **removed}.items():
            record = state['installed'].get(identifier)
            if not record or identifier in catalog or record['manifest'].get('name') != name:
                continue
            if identifier in removed or (
                    not record.get('linked') and not self._root(record, pinned=True).exists()):
                retired.append(identifier)
        return retired

    @staticmethod
    def _without_replaced_links(state):
        """state without the owned links something else has since replaced,
        such as install.sh linking a command that moved into core's bin/
        over a retired package's link. Orc no longer owns those, so retiring
        the package leaves them be instead of refusing them."""
        owned = state.get('ownedLinks')
        if not owned:
            return state
        kept = {path: target for path, target in owned.items()
                if not os.path.lexists(path) or (os.path.islink(path) and os.readlink(path) == target)}
        return state if len(kept) == len(owned) else {**state, 'ownedLinks': kept}

    def _required_missing(self, state, catalog):
        """Required packages this home has no enabled record for: a package
        that became part of Orc after setup, or one an older Orc let you
        switch off. Its commands and agent skills are linked only from an
        enabled record."""
        return sorted(identifier for identifier, (_, data) in catalog.items()
                      if data.get('required') and not (state['installed'].get(identifier) or {}).get('enabled'))

    def ensure_required(self):
        """Install or switch on every required package, so its commands and
        skills are linked on a home whose setup came before it was required."""
        catalog = self.catalog()
        state = self._state()
        if not state.get('setupComplete') or not self._required_missing(state, catalog):
            return
        with self._lock(None) as before:
            missing = self._required_missing(before, catalog)
            if not missing:
                return
            after = json.loads(json.dumps(before))
            for identifier in missing:
                if identifier in after['installed']:
                    after['installed'][identifier]['enabled'] = True
                else:
                    self._add_bundled(after, identifier)
            self._requirements_met(after, None)
            self._commit(before, after)

    def _renamed_bundled(self, state, catalog):
        """Installed records of RENAMED_BUNDLED packages whose new id is in the
        catalog, skipping linked or pinned copies whose files still exist."""
        renamed = []
        for old_id, new_id in RENAMED_BUNDLED.items():
            record = state['installed'].get(old_id)
            if not record or old_id in catalog or new_id not in catalog:
                continue
            if not record.get('linked') and not self._root(record, pinned=True).exists():
                renamed.append((old_id, new_id))
        return renamed

    def adopt_upgrades(self):
        """Remember old catalogs without overriding their optional choices."""
        catalog = self.catalog()
        state = self._state()
        if self._renamed_bundled(state, catalog):
            with self._lock(None) as before:
                renamed = self._renamed_bundled(before, self.catalog())
                if renamed:
                    after = json.loads(json.dumps(before))
                    for old_id, new_id in renamed:
                        old_record = after['installed'].pop(old_id)
                        if new_id not in after['installed']:
                            self._add_bundled(after, new_id)
                            after['installed'][new_id]['enabled'] = bool(old_record.get('enabled'))
                        for key in ('catalogSeen', 'upgradeAdopted'):
                            if key in after and old_id in after[key]:
                                after[key] = sorted({new_id if item == old_id else item for item in after[key]})
                    self._commit(self._without_replaced_links(before), after)
            state = self._state()
        if self._retired_bundled(state, catalog):
            with self._lock(None) as before:
                retired = self._retired_bundled(before, self.catalog())
                if retired:
                    after = json.loads(json.dumps(before))
                    for identifier in retired:
                        del after['installed'][identifier]
                    self._commit(self._without_replaced_links(before), after)
            state = self._state()
        if not state.get('setupComplete'):
            return self.list()
        try:
            self.ensure_required()
        except PluginError as error:
            # A collision on one required package must not hold back the
            # optional adoptions below; list() still shows it enabled.
            print('application plugins: required package: %s' % error, file=sys.stderr)
        state = self._state()
        if 'catalogSeen' in state and not self._pending_adoptions(state, catalog):
            return self.list()
        with self._lock(None) as before:
            pending = self._pending_adoptions(before, catalog)
            if 'catalogSeen' in before and not pending:
                return self.list()
            after = json.loads(json.dumps(before))
            adopted = after.setdefault('upgradeAdopted', [])
            retired = {}
            for identifier in self._bundled_requirements(pending, catalog):
                if identifier not in adopted:
                    adopted.append(identifier)
                if identifier not in after['installed']:
                    self._add_bundled(after, identifier)
                    retired.update(self._retired_core_links(self.catalog()[identifier][1]))
            self._requirements_met(after, None)
            after['catalogSeen'] = sorted(set(before.get('catalogSeen', [])) | catalog.keys())
            self._commit(before, after, retired)
        return self.list()

    def _retired_core_links(self, data):
        """Links an older Orc made for the package's commands while core still
        had them, as install.sh does: ``~/.local/bin/<name>`` to some
        ``bin/<name>``. Adoption replaces them; any other file stays refused."""
        found = {}
        for name in data.get('contributes', {}).get('commands', {}):
            path = self.bin / name
            if path.is_symlink() and PurePosixPath(os.readlink(path)).parts[-2:] == ('bin', name):
                found[path] = Path(os.readlink(path))
        return found

    SERVICE_STOP_SECONDS = 30

    def refresh_from_release(self, run=subprocess.run, sleep=time.sleep):
        """Updates each pinned package the catalog policy says follows this
        release to the release's own copy, so upgrading Orc carries its fixes.
        A running external service is stopped with the old copy's stopCommand
        and started again with the new copy's startCommand. Git and linked
        installs keep their source. Returns one line per package it touched."""
        sources = self._policy.release_sources(self) if self._policy and hasattr(self._policy, 'release_sources') else {}
        lines = []
        for identifier, source in sorted(sources.items()):
            try:
                line = self._refresh_package(identifier, Path(source), run, sleep)
            except (PluginError, OSError, subprocess.SubprocessError) as error:
                line = '%s did not update: %s' % (identifier, error)
            if line:
                lines.append(line)
        return lines

    def _refresh_package(self, identifier, source, run, sleep):
        record = self._state()['installed'].get(identifier)
        if not record or record.get('linked') or record.get('sourceRevision') or digest(source) == record['digest']:
            return None
        name = manifest(source).get('name') or identifier
        done = self._replace_running(record, lambda: self.install(source, enable=record['enabled'], replace_running=True),
                                     run, sleep)
        return None if done is None else name + ' updated to this release' + done

    def _replace_running(self, record, install, run, sleep):
        """Runs ``install`` in place of ``record``'s copy. A running external
        service is stopped with the old copy's stopCommand and started again
        with the new copy's. Returns what happened to the service, appended to
        the line that names the update ('' when none ran), or None when the
        package is mid-disable and nothing was replaced."""
        identifier = record['id']
        running = self.external_service_pending(record)
        if running and not record['enabled']:
            return None  # Mid-disable: Settings is waiting on the user to stop it.
        if running:
            self._service_command(record, 'stopCommand', run)
            deadline = time.monotonic() + self.SERVICE_STOP_SECONDS
            while self.external_service_pending(record):
                if time.monotonic() >= deadline:
                    raise PluginError('its service did not stop. ' + self.recovery_message(record))
                sleep(0.25)
        try:
            install()
        except BaseException:
            if running:  # The old copy is still installed: start its service again.
                try:
                    self._service_command(record, 'startCommand', run)
                except (PluginError, OSError, subprocess.SubprocessError):
                    pass
            raise
        if not running:
            return ''
        if self._service_command(self._state()['installed'][identifier], 'startCommand', run):
            return '; its service restarted'
        return '; its service is stopped, so start it again'

    def _service_command(self, record, key, run):
        """Runs the record's externalService ``key`` command from its pinned copy;
        False when the package declares none."""
        command = record['manifest'].get('contributes', {}).get('externalService', {}).get(key)
        if not command:
            return False
        root = self._root(record, pinned=True)
        done = run([str(root / command[0]), *command[1:]], cwd=root, capture_output=True, text=True, timeout=120)
        if done.returncode:
            last = [line for line in (done.stderr or done.stdout or '').splitlines() if line.strip()][-1:]
            raise PluginError('%s exited %d%s' % (shlex.join(command), done.returncode, ': ' + last[0] if last else ''))
        return True

    @staticmethod
    def _validate_git_source(source):
        parsed = urlsplit(source)
        if source.startswith('-') or '\n' in source or '\r' in source or parsed.query or parsed.fragment:
            raise PluginError('Invalid Git source')
        if parsed.scheme and parsed.scheme not in ('https', 'ssh', 'file'):
            raise PluginError('Use HTTPS, SSH or a local Git source')
        if parsed.password or (parsed.scheme == 'https' and parsed.username):
            raise PluginError('Credential-bearing Git URLs are not accepted; use your Git credential helper')
        if not parsed.scheme and not (source.startswith('/') or re.fullmatch(r'[\w.-]+@[\w.-]+:[\w./-]+', source)):
            raise PluginError('Use an explicit Git URL or absolute local path')

    @staticmethod
    def _validate_branch(branch):
        if (not isinstance(branch, str) or not branch or branch.startswith('-') or '..' in branch
                or not re.fullmatch(r'[\w./-]+', branch) or branch.endswith(('/', '.lock')) or '//' in branch):
            raise PluginError('Invalid Git branch name')

    @staticmethod
    def _git(*args, check=True):
        """Git with the machine's own sign-in, never a prompt, hooks or the
        ext transport. The system config stays on: Homebrew's and Apple's Git
        keep the keychain sign-in for HTTPS there."""
        env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0'}
        env.pop('GIT_CONFIG_NOSYSTEM', None)
        result = subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never', *args],
                                env=env, capture_output=True, timeout=300)
        if result.returncode and check:
            raise PluginError('Git could not read the source/revision; check access with your existing credentials')
        return result

    def _clone(self, source, tmp, branch=None):
        clone = Path(tmp) / 'source'
        narrow = ['--single-branch', '--branch', branch] if branch else []
        self._git('clone', '--no-checkout', '--no-local', *narrow, '--', source, str(clone))
        return clone

    def _package_at(self, clone, commit, subdir, tmp):
        """The package folder ``subdir`` at ``commit``, without .git or the
        rest of the repository. An empty ``subdir`` is the repository root."""
        archive = Path(tmp) / 'package.tar'
        archive.write_bytes(self._git('-C', str(clone), 'archive', commit + (':' + subdir if subdir else '')).stdout)
        package = Path(tmp) / 'package'
        package.mkdir()
        with tarfile.open(archive) as handle:
            for member in handle.getmembers():
                if member.name.rstrip('/') in ('', '.'):
                    continue
                target = package / relative_path(member.name.rstrip('/'))
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                elif member.isfile():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(handle.extractfile(member).read())
                    target.chmod(member.mode & 0o777)
                else:
                    raise PluginError('Git package contains links or special files')
        return package

    def install_git(self, source, subdir='', ref=None, *, branch=None, follow=False, **kwargs):
        """Installs the package at ``subdir`` of a Git repository. With
        ``branch`` it installs that branch's current commit and remembers the
        branch: pinned there, or following it when ``follow`` is true. Without
        one it installs ``ref`` (HEAD by default) and remembers nothing."""
        self._validate_git_source(source)
        subdir = (subdir or '').strip('/')
        if subdir:
            relative_path(subdir)
        if branch is not None:
            self._validate_branch(branch)
            if ref is not None:
                raise PluginError('Choose a branch or a revision, not both')
        ref = ref or 'HEAD'
        if ref.startswith('-') or any(c.isspace() for c in ref):
            raise PluginError('Invalid Git revision')
        with tempfile.TemporaryDirectory(prefix='orc-app-plugin-') as tmp:
            clone = self._clone(source, tmp, branch)
            commit = self._git('-C', str(clone), 'rev-parse', '--verify',
                               ('refs/heads/' + branch if branch else ref) + '^{commit}').stdout.decode().strip()
            package = self._package_at(clone, commit, subdir, tmp)
            git_source = {'url': source, 'subdir': subdir, 'branch': branch, 'follow': bool(follow)} if branch else None
            result = self.install_over(package, source_revision=commit, git_source=git_source, **kwargs)
        if branch:
            self._note_git_check(result['installedId'], latest=commit, behind=0)
            result = {**self.list(), **{key: result[key] for key in ('installedId', 'message') if key in result}}
        result['sourceRevision'] = commit
        return result

    # Results of the last check of each Git package's branch. They change on
    # every check, so they live beside the registry state, not in it: a check
    # must not move the revision a Settings page holds.
    GIT_CHECK_LOCK = threading.Lock()

    @property
    def git_checks_path(self):
        return self.home / '.orc/app-plugins-git.json'

    def _git_checks(self):
        try:
            value = json.loads(self.git_checks_path.read_text())
        except (OSError, ValueError):
            return {}
        return value if isinstance(value, dict) else {}

    def _note_git_check(self, identifier, **fields):
        path = self.git_checks_path
        if path.is_symlink() or not path.parent.resolve().is_relative_to(self.data_boundary):
            raise PluginError('Plugin state cannot escape its home: ' + str(path))
        with self.GIT_CHECK_LOCK:
            checks = self._git_checks()
            checks[identifier] = {'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                                  'latest': None, 'behind': None, 'error': None, **fields}
            path.parent.mkdir(parents=True, exist_ok=True)
            atomic_json(path, checks)

    @staticmethod
    def _github_slug(url):
        match = re.fullmatch(r'(?:https://github\.com/|ssh://git@github\.com/|git@github\.com:)'
                             r'([A-Za-z0-9-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?', url)
        return match[1] if match else None

    def _git_row(self, identifier, record):
        """What Settings shows of a Git package's source: its branch, the
        commit installed, and what the last check of the branch found."""
        source = record['gitSource']
        commit = record.get('sourceRevision')
        check = self._git_checks().get(identifier) or {}
        latest = check.get('latest')
        slug = self._github_slug(source['url'])
        behind = check.get('behind')
        return {**source, 'repo': slug, 'commit': commit,
                'checkedAt': check.get('checkedAt'), 'latest': latest, 'behind': behind,
                'error': check.get('error'),
                'compareUrl': ('https://github.com/%s/compare/%s...%s' % (slug, commit[:12], latest[:12])
                               if slug and commit and latest and latest != commit else None)}

    def _git_record(self, identifier):
        record = self._state()['installed'].get(identifier)
        if not record or not record.get('gitSource'):
            raise PluginError('This plugin was not installed from a Git branch')
        return record

    def set_git_follow(self, identifier, follow, expected_revision=None, run=subprocess.run, sleep=time.sleep):
        """Pins a Git package at the commit it has, or makes it follow its
        branch; following updates to the branch's tip at once."""
        self._git_record(identifier)
        with self._lock(expected_revision) as before:
            after = json.loads(json.dumps(before))
            after['installed'][identifier]['gitSource']['follow'] = bool(follow)
            self._commit(before, after)
        if follow:
            self.check_git(identifier, run=run, sleep=sleep)
        return self.list()

    def update_git(self, identifier, expected_revision=None, run=subprocess.run, sleep=time.sleep):
        """Installs the newest commit on a Git package's branch, whether it
        follows the branch or is pinned. A failure keeps the working copy."""
        record = self._git_record(identifier)
        if expected_revision is not None and self._state()['revision'] != expected_revision:
            raise Conflict('Plugins changed elsewhere; reload and try again')
        line = self._check_one(identifier, record, run, sleep, update=True)
        error = (self._git_checks().get(identifier) or {}).get('error')
        if error:
            raise PluginError(error)
        return {**self.list(), 'message': line}

    def check_git(self, identifier=None, run=subprocess.run, sleep=time.sleep):
        """Checks each Git package's branch (or only ``identifier``'s): a
        following package updates to a newer commit; a pinned one notes how
        many commits it is behind. Returns one line per package checked. A
        failure keeps the working copy and is shown on its card."""
        installed = self._state()['installed']
        lines = []
        for name, record in sorted(installed.items()):
            if record.get('gitSource') and identifier in (None, name):
                lines.append(self._check_one(name, record, run, sleep, update=record['gitSource'].get('follow')))
        if identifier is not None and not lines:
            raise PluginError('This plugin was not installed from a Git branch')
        return lines

    def _check_one(self, identifier, record, run, sleep, *, update):
        source = record['gitSource']
        commit = record.get('sourceRevision')
        name = record['manifest'].get('name') or identifier
        try:
            with tempfile.TemporaryDirectory(prefix='orc-app-plugin-') as tmp:
                clone = self._clone(source['url'], tmp, source['branch'])
                latest = self._git('-C', str(clone), 'rev-parse', '--verify',
                                   'refs/heads/%s^{commit}' % source['branch']).stdout.decode().strip()
                counted = self._git('-C', str(clone), 'rev-list', '--count', '%s..%s' % (commit, latest), check=False)
                behind = int(counted.stdout) if not counted.returncode else None
                if latest == commit or not update:
                    self._note_git_check(identifier, latest=latest, behind=0 if latest == commit else behind)
                    return '%s is at %s' % (name, commit[:7]) if latest == commit else (
                        '%s is pinned at %s; the branch is at %s' % (name, commit[:7], latest[:7]))
                package = self._package_at(clone, latest, source['subdir'], tmp)
                current = self._state()['installed'].get(identifier)
                if not current or current.get('sourceRevision') != commit:
                    raise PluginError('the plugin changed while Orc checked its branch')
                done = self._replace_running(current, lambda: self.install(
                    package, enable=current['enabled'], source_revision=latest, git_source=current['gitSource'],
                    replace_running=True), run, sleep)
                if done is None:
                    raise PluginError('turn it on again first: it is being turned off')
            self._note_git_check(identifier, latest=latest, behind=0)
            return '%s updated to %s%s' % (name, latest[:7], done)
        except (PluginError, OSError, subprocess.SubprocessError, ValueError) as error:
            previous = self._git_checks().get(identifier) or {}
            self._note_git_check(identifier, latest=previous.get('latest'), behind=previous.get('behind'),
                                 error='%s did not update: %s' % (name, error) if update
                                 else 'Orc could not check the branch: %s' % error)
            return '%s did not update: %s' % (name, error)


class Runtime:
    # How long requests route from the last sync before the packages on disk
    # are read again. A registry change is seen by the next request.
    RESYNC_SECONDS = 1.0
    clock = staticmethod(time.monotonic)

    def __init__(self, registry, context):
        self.registry = registry
        self.context = context
        self.active = {}
        self.stopping = {}
        self.errors = {}
        self.inflight = {}
        self.routes = {}
        self.synced = None
        self.lock = threading.RLock()

    def sync(self):
        with self.lock:
            # Read before the listing: a change during it must sync again.
            key = self.registry.state_key()
            state = self.registry.list()
            desired = {row['id']: row for row in state['plugins'] if row['enabled'] and not row['error']}
            for identifier, (revision, service) in list(self.active.items()):
                if (identifier in self.stopping and identifier in desired and desired[identifier]['digest'] == revision
                        and getattr(service, 'resume', lambda: False)()):
                    del self.stopping[identifier]
                if identifier in self.stopping or identifier not in desired or desired[identifier]['digest'] != revision:
                    if identifier not in self.stopping:
                        self.stopping[identifier] = next((row for row in state['plugins'] if row['id'] == identifier),
                            {'id': identifier, 'name': identifier, 'description': '', 'enabled': False, 'installed': False,
                             'contributes': {}, 'digest': revision, 'required': False, 'bundled': False, 'error': None})
                    if not self.inflight.get(identifier) and service.deactivate():
                        del self.active[identifier]
                        del self.stopping[identifier]
            for identifier, row in desired.items():
                entry = row.get('contributes', {}).get('backend')
                if not entry or identifier in self.active or identifier in self.errors:
                    continue
                try:
                    root = Path(row['root'])
                    with no_bytecode():
                        module = load_package_module('orc_app_' + row['digest'], root, entry)
                        service = module.activate({**self.context, 'root': root,
                            'external_service_pending': lambda record={'id': identifier, 'digest': row['digest'], 'manifest': row}:
                                self.registry.external_service_pending(record),
                            'recovery_message': self.registry.recovery_message({'id': identifier, 'digest': row['digest'], 'manifest': row})
                                if row['contributes'].get('externalService') else '',
                            'themes': lambda: [theme['id'] for _root, theme in self.registry.contributions('theme')],
                            'theme_manifests': lambda: [theme for _root, theme in self.registry.contributions('theme')],
                            'is_enabled': lambda key=identifier, revision=row['digest']: any(
                                item['id'] == key and item['digest'] == revision and item['enabled'] and not item['error']
                                for item in self.registry.list()['plugins'])})
                    self.active[identifier] = (row['digest'], service)
                    self.errors.pop(identifier, None)
                except Exception as error:
                    self.errors[identifier] = str(error)
            for identifier, row in self.stopping.items():
                if not any(item['id'] == identifier for item in state['plugins']):
                    state['plugins'].append({**row, 'installed': False, 'enabled': False})
            for row in state['plugins']:
                row['active'] = row['id'] in self.active
                if row['id'] in self.errors:
                    row.update(state='error', error=self.errors[row['id']])
                elif row['id'] in self.stopping:
                    service = self.active[row['id']][1]
                    row.update(state='stopping', message=getattr(service, 'message',
                        'Finishing existing work. New requests are blocked; retry Apply when it finishes.'))
            self.routes = {row['id']: self.active[row['id']][1] for row in state['plugins']
                           if row['active'] and row['enabled'] and row['state'] == 'enabled'}
            self.synced = (key, self.clock())
            return state

    def apply(self, expected_revision):
        with self.lock, self.registry._lock(expected_revision):
            self.errors.clear()
            return self.sync()

    def _routes(self):
        """{id: service} for the services taking requests. Every request to
        the server asks, so this syncs only when it has to: the registry
        changed, a service is still stopping, or the last sync is old."""
        with self.lock:
            if (self.stopping or self.synced is None or self.synced[0] != self.registry.state_key()
                    or self.clock() - self.synced[1] >= self.RESYNC_SECONDS):
                self.sync()
            return self.routes

    def invoke(self, identifier, operation, *args):
        return self._invoke(identifier, lambda service: getattr(service, operation)(*args))

    def _invoke(self, identifier, call):
        with self.lock:
            service = self._routes().get(identifier)
            if service is None:
                return False
            self.inflight[identifier] = self.inflight.get(identifier, 0) + 1
        try:
            return call(service)
        finally:
            with self.lock:
                self.inflight[identifier] -= 1

    def broadcast(self, operation, *args):
        """Call `operation` on every service taking requests that has it, such
        as `watch_tick` on the server's watch loop. One package's failure is
        printed and never stops the others or the caller."""
        self.collect(operation, *args)

    def collect(self, operation, *args):
        """What `operation` returns from every service taking requests that
        has it, such as `usage` for Subscription usage. A failing package is
        printed and left out."""
        results = []
        for identifier, service in list(self._routes().items()):
            if not callable(getattr(service, operation, None)):
                continue
            try:
                results.append(self._invoke(identifier, lambda service: getattr(service, operation)(*args)))
            except Exception as error:
                print('Plugin %s %s: %s' % (identifier, operation, error), file=sys.stderr)
        return results

    def dispatch(self, handler, method, path):
        for identifier in list(self._routes()):
            if self._invoke(identifier, lambda service: service.handle(handler, method, path)):
                return True
        return False
