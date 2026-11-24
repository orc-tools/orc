"""The theme surface: what Orc promises a theme package it can rely on.

``app-plugins/theme-surface.json`` lists the promised tokens, hooks (host
selectors and attributes), scene-kit modules and host modules. This module
reads it, checks a theme package against it (``orc-app-plugin check``) and
compares one surface with another, so a release that drops a promise has to
say so in its notes.
"""

import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
SURFACE_PATH = ROOT / 'app-plugins' / 'theme-surface.json'
SWAMP_TOKENS = ROOT / 'app-plugins' / 'swamp' / 'tokens.json'
# Selectors that are CSS itself, not Orc's markup.
CSS_ROOT = {'root', 'html', 'body'}


def load(path=SURFACE_PATH):
    return json.loads(Path(path).read_text())


def api_version(surface=None):
    return (surface or load())['apiVersion']


# --- CSS reading ---------------------------------------------------------

def strip_comments(css):
    return re.sub(r'/\*.*?\*/', '', css, flags=re.S)


def split_top_level(selector_list):
    parts, depth, current = [], 0, ''
    for char in selector_list:
        depth += {'(': 1, ')': -1, '[': 1, ']': -1}.get(char, 0)
        if char == ',' and depth == 0:
            parts.append(current.strip())
            current = ''
        else:
            current += char
    parts.append(current.strip())
    return [part for part in parts if part]


def rules(css):
    """Every style rule as ``(selectors, declarations, at_rules)``, skipping
    keyframe stops. ``at_rules`` is the stack of at-rule preludes around it."""
    css = strip_comments(css)
    found, stack, prelude, body_start = [], [], '', None
    for index, char in enumerate(css):
        if char == '{':
            text = ' '.join(prelude.split())
            if text.startswith('@'):
                stack.append(('at', text))
            elif any(kind == 'at' and prelude_text.startswith('@keyframes') for kind, prelude_text in stack):
                stack.append(('stop', text))
            else:
                stack.append(('rule', text))
                body_start = index + 1
            prelude = ''
        elif char == '}':
            if not stack:
                prelude = ''
                continue
            kind, text = stack.pop()
            if kind == 'rule':
                at_rules = tuple(item for kind_, item in stack if kind_ == 'at')
                found.append((split_top_level(text), css[body_start:index], at_rules))
            prelude = ''
        elif char == ';' and (not stack or stack[-1][0] != 'rule'):
            prelude = ''
        elif not stack or stack[-1][0] != 'rule':
            prelude += char
    return found


def declarations(block):
    """Custom properties set in one declaration block, in order."""
    result = {}
    for match in re.finditer(r'(--[\w-]+)\s*:\s*([^;]*)', block):
        result[match.group(1)] = match.group(2).strip()
    return result


# Selector tokens. Attribute values and pseudo-class arguments that hold
# strings are dropped first so a '#' or '.' inside them is not read as a hook.
_STRINGS = re.compile(r'"[^"]*"|\'[^\']*\'')
IDS = re.compile(r'#(-?[_a-zA-Z][\w-]*)')
CLASSES = re.compile(r'\.(-?[_a-zA-Z][\w-]*)')
ATTRIBUTES = re.compile(r'\[\s*([\w-]+)')
DATA_PARTS = re.compile(r'\[\s*data-part\s*[~|^$*]?=\s*(?:"([^"]*)"|\'([^\']*)\'|([\w-]+))\s*\]')
SHADOW_PARTS = re.compile(r'::part\(\s*([^)]+?)\s*\)')


def selector_hooks(selector):
    parts = {m.group(1) or m.group(2) or m.group(3) for m in DATA_PARTS.finditer(selector)}
    shadow_parts = {name for m in SHADOW_PARTS.finditer(selector) for name in m.group(1).split()}
    text = _STRINGS.sub('""', selector)
    return {
        'ids': set(IDS.findall(text)),
        'classes': set(CLASSES.findall(text)),
        'attributes': set(ATTRIBUTES.findall(text)),
        'parts': {part for part in parts if part},
        'shadowParts': shadow_parts,
    }


def owned(name, theme_id):
    """A name the theme made up itself: its id, or anything prefixed with it."""
    return name == theme_id or name.startswith(theme_id + '-')


def host_hooks(css, theme_id, surface=None):
    """Host ids, classes, attributes, parts and shadow parts a theme's CSS
    reaches for, minus its own names and the families the surface hands to
    every theme."""
    surface = surface or load()
    families = [item['prefix'] for item in surface['hooks']['families']]
    found = {'ids': set(), 'classes': set(), 'attributes': set(), 'parts': set(), 'shadowParts': set()}
    for selectors, _, _ in rules(css):
        for selector in selectors:
            for kind, names in selector_hooks(selector).items():
                for name in names:
                    if kind == 'attributes' and not name.startswith('data-'):
                        continue  # aria-*, role, href and the like are HTML's, not Orc's
                    bare = name[len('data-'):] if kind == 'attributes' and name.startswith('data-') else name
                    if owned(bare, theme_id) or (kind in ('ids', 'classes', 'attributes')
                                                 and any(name.startswith(prefix) for prefix in families)):
                        continue
                    found[kind].add(name)
    return found


def promised_hooks(surface=None):
    surface = surface or load()
    hooks = surface['hooks']
    return {
        'ids': {item['name'] for item in hooks['ids']},
        'classes': {item['name'] for item in hooks['classes']},
        'attributes': {item['name'] for item in hooks['attributes']},
        'parts': {item['name'] for item in hooks.get('parts', [])},
        'shadowParts': {item['name'] for item in hooks.get('shadowParts', [])},
    }


def promised_tokens(surface=None):
    surface = surface or load()
    return {item['name'] for group in surface['tokens'].values() for item in group}


def set_tokens(css, theme_id):
    """Custom properties the theme sets, other than its own ``--<id>-*``."""
    names = set()
    for _, block, _ in rules(css):
        names.update(name for name in declarations(block) if not owned(name[2:], theme_id))
    return names


# --- Colour and contrast -------------------------------------------------

def parse_colour(value):
    """(r, g, b) for a plain hex or rgb() colour, else None."""
    value = value.strip().lower()
    match = re.fullmatch(r'#([0-9a-f]{3}|[0-9a-f]{6})', value)
    if match:
        digits = match.group(1)
        if len(digits) == 3:
            digits = ''.join(char * 2 for char in digits)
        return tuple(int(digits[index:index + 2], 16) for index in (0, 2, 4))
    match = re.fullmatch(r'rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*1(?:\.0*)?\s*)?\)', value)
    if match:
        return tuple(min(255, int(part)) for part in match.groups())
    return None


def resolve(palette, value, depth=0, mode=None):
    """A token's value with var(), light-dark() and two-colour srgb
    color-mix() worked out, as (r, g, b), or None when it is not a plain
    colour."""
    if depth > 8 or value is None:
        return None
    value = value.strip()
    match = re.fullmatch(r'var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)', value)
    if match:
        if match.group(1) in palette:
            return resolve(palette, palette[match.group(1)], depth + 1, mode=mode)
        return resolve(palette, match.group(2), depth + 1, mode=mode)
    match = re.fullmatch(r'color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+(\d+(?:\.\d+)?)%\s*,\s*(.+?)(?:\s+(\d+(?:\.\d+)?)%)?\s*\)', value)
    if match:
        first = resolve(palette, match.group(1), depth + 1, mode=mode)
        second = resolve(palette, match.group(3), depth + 1, mode=mode)
        if first is None or second is None:
            return None
        return mix(first, second, float(match.group(2)) / 100)
    if value.startswith('light-dark(') and value.endswith(')'):
        paren_depth = 0
        matched_end = False
        for index in range(len('light-dark'), len(value)):
            paren_depth += {'(': 1, ')': -1}.get(value[index], 0)
            if paren_depth == 0:
                matched_end = index == len(value) - 1
                break
        if matched_end:
            parts = split_top_level(value[len('light-dark('):-1])
            if len(parts) == 2 and mode in ('day', 'night'):
                return resolve(palette, parts[0 if mode == 'day' else 1], depth + 1, mode=mode)
        return None
    return parse_colour(value)


def mix(foreground, background, share):
    return tuple(round(a * share + b * (1 - share)) for a, b in zip(foreground, background))


def luminance(colour):
    channels = [value / 255 for value in colour]
    linear = [value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4 for value in channels]
    return sum(value * weight for value, weight in zip(linear, (.2126, .7152, .0722)))


def contrast(first, second):
    lighter, darker = sorted((luminance(first), luminance(second)), reverse=True)
    return (lighter + .05) / (darker + .05)


# The floors every bundled palette clears (tests/test_theme_contract.py and
# each theme's own test): (label, foreground, minimum). A foreground is a
# token, or (token, share) for the documented mix of it with --heading.
TEXT_FLOORS = (
    ('body text', '--text', 4.5),
    ('headings', '--heading', 4.5),
    ('links and small accent text', '--accent', 4.5),
    ('cyan text', '--cyan', 4.5),
    ('control borders', ('--border', .65), 3),
    ('placeholders', ('--muted', .45), 4.5),
)
# Status tones print raw by night and mixed with --heading by day.
STATUS_FLOORS = (('--green', .7), ('--yellow', .7), ('--red', .6), ('--purple', .65), ('--orange', .6))


def contrast_failures(palette, mode):
    """Floors a resolved palette misses, one readable line per role, at its
    worse canvas."""
    failures = []
    heading = resolve(palette, palette.get('--heading'), mode=mode)
    canvases = {name: resolve(palette, palette.get(name), mode=mode) for name in ('--bg', '--panel')}
    unreadable = [name for name, colour in canvases.items() if colour is None]
    if heading is None:
        unreadable.append('--heading')
    if unreadable:
        return ['%s: %s is not a plain colour, so contrast cannot be checked' % (mode, ' and '.join(unreadable))]
    checks = list(TEXT_FLOORS) + [
        ('%s status' % token[2:], token if mode == 'night' else (token, share), 4.5)
        for token, share in STATUS_FLOORS]
    for label, foreground, floor in checks:
        token, share = foreground if isinstance(foreground, tuple) else (foreground, None)
        colour = resolve(palette, palette.get(token), mode=mode)
        if colour is None:
            failures.append('%s: %s is not a plain colour, so %s cannot be checked' % (mode, token, label))
            continue
        if share is not None:
            colour = mix(colour, heading, share)
        ratio, canvas = min((contrast(colour, value), name) for name, value in canvases.items())
        if ratio < floor:
            failures.append('%s: %s (%s) is %.2f:1 on %s; it needs %g:1' % (mode, label, token, ratio, canvas, floor))
    return failures


# --- Checking a theme ----------------------------------------------------

def swamp_palettes():
    tokens = json.loads(SWAMP_TOKENS.read_text())
    return {mode: {'--' + name: value for name, value in values.items()} for mode, values in tokens.items()}


def _scope(selector, theme_id, fallback=False):
    """'day', 'auto' or 'night' for a selector that sets the theme's root
    tokens, else None. 'auto' is the night block under the system's dark
    preference, which applies while the person leaves the mode on Auto;
    'night' is an explicit [data-theme="dark"]. The fallback theme (Swamp)
    sets bare :root, under every other theme."""
    compact = re.sub(r'\s+', '', selector).replace("'", '"').replace('[data-theme=dark]', '[data-theme="dark"]')
    if not compact.startswith(':root') or not (fallback or re.search(r'\[data-%s\]' % re.escape(theme_id), compact)):
        return None
    rest = re.sub(r':root|\[data-%s\]' % re.escape(theme_id), '', compact)
    if rest == '':
        return 'day'
    if rest == ':not([data-theme="light"])':
        return 'auto'
    if rest == '[data-theme="dark"]':
        return 'night'
    return None


DARK_MEDIA = '@media (prefers-color-scheme: dark)'


def theme_blocks(css, theme_id, fallback=False):
    """The theme's own root tokens: ``{'day': {...}, 'auto': {...}, 'night': {...}}``."""
    blocks = {'day': {}, 'auto': {}, 'night': {}}
    for selectors, block, at_rules in rules(css):
        if any(' '.join(rule.split()) != DARK_MEDIA for rule in at_rules):
            continue
        values = declarations(block)
        for selector in selectors:
            scope = _scope(selector, theme_id, fallback)
            if scope == 'auto' and not at_rules:
                scope = None
            if scope == 'day' and at_rules:
                scope = 'auto'
            if scope:
                blocks[scope].update(values)
    return blocks


def theme_palettes(css, theme_id, fallback=False):
    """The theme's day and night tokens, night layered on day as the cascade
    does (the day block also matches at night)."""
    blocks = theme_blocks(css, theme_id, fallback)
    return blocks['day'], {**blocks['day'], **blocks['auto'], **blocks['night']}


def check_theme(manifest_data, css, surface=None):
    """Findings for a theme package: ``errors`` stop it from being right,
    ``warnings`` are things that work today but are not promised or are
    left to Swamp."""
    surface = surface or load()
    theme_id = manifest_data['contributes']['theme']['id']
    errors, warnings = [], []
    swamp = swamp_palettes()
    palette_names = [item['name'] for item in surface['tokens']['palette']]
    fallback = bool(manifest_data.get('required'))
    day, night = theme_palettes(css, theme_id, fallback)
    if not day:
        errors.append('theme.css sets no tokens under :root[data-%s]; nothing would change when it is picked' % theme_id)
    for mode, values in (('day', day), ('night', night)):
        missing = [name for name in palette_names if name not in values]
        if missing and values:
            warnings.append('%s: %d of %d palette tokens left to Swamp: %s'
                            % (mode, len(missing), len(palette_names), ' '.join(missing)))
    blocks = theme_blocks(css, theme_id, fallback)
    if day and not any(name in night and night[name] != day[name] for name in palette_names):
        warnings.append('night: no palette token differs from day; add a :root[data-%s][data-theme="dark"] block'
                        % theme_id)
    elif blocks['night'] and not blocks['auto']:
        warnings.append('night: Auto at night still shows day; repeat the dark block as'
                        ' :root[data-%s]:not([data-theme="light"]) inside %s' % (theme_id, DARK_MEDIA))
    elif blocks['auto'] and not blocks['night']:
        warnings.append('night: picking Dark still shows day; repeat the dark block as'
                        ' :root[data-%s][data-theme="dark"]' % theme_id)
    for mode, values, base in (('day', day, swamp['day']), ('night', night, swamp['night'])):
        if values:
            errors.extend(contrast_failures({**base, **values}, mode))
    promised = promised_tokens(surface)
    unknown = sorted(set_tokens(css, theme_id) - promised)
    if unknown:
        warnings.append('tokens Orc does not promise to read (prefix your own with --%s-): %s'
                        % (theme_id, ' '.join(unknown)))
    found, allowed = host_hooks(css, theme_id, surface), promised_hooks(surface)
    hook_labels = (
        ('ids', 'ids', lambda name: '#' + name),
        ('classes', 'classes', lambda name: '.' + name),
        ('attributes', 'attributes', lambda name: '[' + name),
        ('parts', 'parts', lambda name: '[data-part="%s"]' % name),
        ('shadowParts', 'shadow parts', lambda name: '::part(%s)' % name),
    )
    for kind, label, fmt in hook_labels:
        extra = sorted(found[kind] - allowed[kind])
        if extra:
            warnings.append('%s Orc does not promise, so they may change without notice: %s'
                            % (label, ' '.join(fmt(name) for name in extra)))
    return {'errors': errors, 'warnings': warnings}


# --- Comparing surfaces --------------------------------------------------

def names(surface):
    """Every promised name, as 'kind name' strings."""
    result = {'token ' + name for name in promised_tokens(surface)}
    singular = {'ids': 'id', 'classes': 'class', 'attributes': 'attribute', 'parts': 'part', 'shadowParts': 'shadowPart'}
    for kind, values in promised_hooks(surface).items():
        result.update('%s %s' % (singular[kind], name) for name in values)
    result.update('family %s' % item['prefix'] for item in surface['hooks']['families'])
    for module, spec in surface['sceneKit']['modules'].items():
        result.update('kit %s %s' % (module, export) for export in spec['exports'])
    for module, spec in surface['hostModules']['modules'].items():
        result.update('host %s %s' % (module, export) for export in spec['exports'])
    return result


def removed(before, after):
    """Promises ``before`` made that ``after`` no longer makes."""
    return sorted(names(before) - names(after))


def changelog_records(changelog_text):
    """The text of every "Theme changes" section in the public notes."""
    sections, current = [], None
    for line in changelog_text.splitlines():
        heading = re.match(r'(#+)\s+(.*)', line)
        if heading:
            current = [] if heading.group(2).strip().lower() == 'theme changes' else None
            if current is not None:
                sections.append(current)
            continue
        if current is not None:
            current.append(line)
    return '\n'.join('\n'.join(section) for section in sections)


def unrecorded(before, after, changelog_text):
    """Removed promises the public notes do not name under "Theme changes",
    plus a note when a removal came without a newer apiVersion."""
    gone = removed(before, after)
    records = changelog_records(changelog_text)
    missing = [entry for entry in gone if entry.split(' ')[-1] not in records]
    problems = ['%s was removed or renamed; record it under "## Theme changes" in distribution/CHANGELOG.md'
                ' with its old name, new name and what a theme should edit' % entry for entry in missing]
    if gone and after['apiVersion'] <= before['apiVersion']:
        problems.append('the surface dropped promises, so raise apiVersion in app-plugins/theme-surface.json'
                        ' above %d' % before['apiVersion'])
    return problems


# --- Checking a package --------------------------------------------------

IMPORT = re.compile(r'''(?:\bimport\s*(?:[\w*{}\s,]+?\s*from\s*)?|\bexport\s*[\w*{}\s,]*?\s*from\s*|\bimport\s*\(\s*)(["'])([^"']+)\1''')
NAMED = re.compile(r'''\bimport\s*\{([^}]*)\}\s*from\s*(["'])([^"']+)\2''')
KIT_URL = re.compile(r'/theme-kit/(\d+)/([\w.-]+)$')


def module_files(root, entries):
    """``entries`` and every package file they import by a relative path."""
    seen, pending = [], [entry for entry in entries if entry]
    while pending:
        name = pending.pop()
        if name in seen:
            continue
        path = (Path(root) / name)
        if not path.is_file() or not path.resolve().is_relative_to(Path(root).resolve()):
            continue
        seen.append(name)
        for match in IMPORT.finditer(path.read_text(errors='replace')):
            spec = match.group(2)
            if spec.startswith('./') or spec.startswith('../'):
                target = (path.parent / spec).resolve()
                if target.is_relative_to(Path(root).resolve()):
                    pending.append(target.relative_to(Path(root).resolve()).as_posix())
    return seen


def check_imports(source, surface=None, *, api=None):
    """Warnings for imports of Orc's own modules that the surface does not
    promise: a /js/ module or export outside hostModules, or a kit module
    or export outside sceneKit."""
    surface = surface or load()
    api = api or surface['apiVersion']
    host = surface['hostModules']['modules']
    kit = surface['sceneKit']['modules']
    warnings = []
    named = {}
    for match in NAMED.finditer(source):
        exports = [part.strip().split(' as ')[0].strip() for part in match.group(1).split(',') if part.strip()]
        named.setdefault(match.group(3), set()).update(exports)
    for match in IMPORT.finditer(source):
        spec = match.group(2)
        if spec.startswith('/js/'):
            if spec not in host:
                warnings.append('imports %s, which Orc does not promise to keep' % spec)
                continue
            extra = sorted(named.get(spec, set()) - set(host[spec]['exports']))
            if extra:
                warnings.append('imports %s from %s, which Orc does not promise to keep' % (', '.join(extra), spec))
        kit_match = KIT_URL.search(spec)
        if kit_match:
            if int(kit_match.group(1)) > api:
                warnings.append('imports %s, from a newer Orc than this one' % spec)
            module = kit_match.group(2)
            if module not in kit:
                warnings.append('imports %s; the scene kit has %s' % (spec, ', '.join(sorted(kit))))
            elif '*' not in kit[module]['exports']:
                extra = sorted(named.get(spec, set()) - set(kit[module]['exports']))
                if extra:
                    warnings.append('imports %s from %s, which the kit does not promise' % (', '.join(extra), spec))
        elif spec == 'three' or spec.startswith('three/') or 'ui/yeet/' in spec:
            warnings.append('imports %s, which the browser cannot load; import /theme-kit/%d/%s instead'
                            % (spec, api, 'three.js' if spec.startswith('three') else spec.rsplit('/', 1)[-1]))
    return warnings


def check_package(root, surface=None):
    """Everything ``orc-app-plugin check`` reports for the package at ``root``."""
    from app_plugins import API_VERSION, PluginError, manifest, trust
    surface = surface or load()
    root = Path(root).absolute()
    report = {'path': str(root), 'errors': [], 'warnings': [], 'trust': None, 'id': None, 'name': None}
    try:
        data = manifest(root)
    except PluginError as error:
        report['errors'].append(str(error))
        return report
    report.update(id=data['id'], name=data['name'], version=data['version'], trust=trust(data),
                  apiVersion=data['apiVersion'])
    if data['apiVersion'] < API_VERSION:
        report['warnings'].append('made for plugin API %d; this Orc has %d. Read "Theme changes" in the release'
                                  ' notes for what to edit, then raise apiVersion' % (data['apiVersion'], API_VERSION))
    contributes = data.get('contributes', {})
    theme = contributes.get('theme')
    if theme:
        found = check_theme(data, (root / theme['css']).read_text(errors='replace'), surface)
        report['errors'].extend(found['errors'])
        report['warnings'].extend(found['warnings'])
    if not theme:
        report['warnings'].append('not a theme: Orc promises a surface to themes only, so this package relies on'
                                  ' internals that can change in any release')
        return report
    entries = [contributes.get('frontend'), theme.get('scene'), theme.get('components')]
    for name in module_files(root, entries):
        for warning in check_imports((root / name).read_text(errors='replace'), surface, api=data['apiVersion']):
            report['warnings'].append('%s %s' % (name, warning))
    return report


# --- The written reference -----------------------------------------------

REFERENCE_PATH = ROOT / 'app-plugins' / 'THEMING.md'


def _table(header, rows):
    lines = ['| ' + ' | '.join(header) + ' |', '|' + '---|' * len(header)]
    lines.extend('| ' + ' | '.join(cell.replace('|', '\\|') for cell in row) + ' |' for row in rows)
    return '\n'.join(lines)


def render_reference(surface=None):
    """app-plugins/THEMING.md, written from the surface and Swamp's tokens."""
    surface = surface or load()
    api = surface['apiVersion']
    swamp = swamp_palettes()
    tokens, hooks = surface['tokens'], surface['hooks']
    out = [
        '# Theme reference',
        '',
        '<!-- Written by bin/orc-theme-surface --write from app-plugins/theme-surface.json. Edit that file, not this one. -->',
        '',
        'Everything Orc promises a theme, for plugin API %d. A theme that uses only what' % api,
        'this page lists keeps working across releases. When a release removes or renames',
        'something here, its notes say so under **Theme changes**, with the old name, the new',
        'name and what to edit, and the plugin API version goes up. A theme made for an older',
        'version still loads. Run `orc-app-plugin check <folder>` for compatibility guidance.',
        '',
        'Your own names start with your theme\'s id: `--paper-ink`, `.paper-cloud`,',
        '`#paper-sky`. Orc never uses those.',
        '',
        '## Make a theme',
        '',
        '1. Run `orc-app-plugin new <folder> --id <id> --name "<Label>"` to scaffold a',
        '   `check`-clean `orc-plugin.json`, `theme.css` and `favicon.svg` (or write them by hand;',
        '   see the Paper example in [README.md](README.md#package-contract-api-%d)).' % api,
        '2. Set the palette under `:root[data-<id>]`. Give night twice: as',
        '   `:root[data-<id>][data-theme="dark"]`, and as `:root[data-<id>]:not([data-theme="light"])`',
        '   inside `@media (prefers-color-scheme: dark)` for people who leave the mode on Auto.',
        '3. Run `orc-app-plugin check <folder>`. It names missing tokens, colours that miss',
        '   the contrast floors below, and anything you use that Orc does not promise.',
        '4. Run `orc-app-plugin link <folder>` and pick the theme in Settings → Visuals, or',
        '   photograph it directly against the showcase world with `orc-shot agent --theme <folder>`.',
        '   Orc reads linked folders directly, so a saved edit shows in open windows within a few',
        '   seconds. `orc-app-plugin remove <id>` unlinks it.',
        '5. Share it as a folder or a Git subdirectory; others run `orc-app-plugin install`.',
        '',
        '## Code or no code',
        '',
        'A theme that is only `theme.css`, pictures and declarative manifest fields (`favicon`,',
        '`announce`, `backdrop`, `radio`) is **no code**: installing it cannot run anything.',
        'A theme with a `scene`, `terminal`, `components` or `frontend` module **runs code**',
        'with the person\'s permissions (use `defineFunMode` from `/js/fun-modes.js` to wire an',
        'animated `frontend.js` without controller boilerplate), as does any package with other',
        'contributions. `orc-app-plugin install` and Settings → Plugins say which a package is.',
        '',
        '## Palette',
        '',
        'Every theme should set these, by day and by night. Any you leave out come from',
        'Swamp, which can clash with yours. `check` holds them to these floors on both `--bg`',
        'and `--panel`: 4.5:1 for `--text`, `--heading`, `--accent` and `--cyan`; 3:1 for',
        '`--border` mixed 65% with `--heading`; 4.5:1 for `--muted` mixed 45% with `--heading`;',
        'and 4.5:1 for each status colour, mixed with `--heading` by day.',
        '',
        _table(['Token', 'What it colours', 'Swamp day', 'Swamp night'],
               [['`%s`' % item['name'], item['what'], '`%s`' % swamp['day'].get(item['name'], ''),
                 '`%s`' % swamp['night'].get(item['name'], '')] for item in tokens['palette']]),
    ]
    sections = (
        ('derived', 'Derived tokens', 'Swamp works these out from the palette. Set them when your palette needs a different mix.'),
        ('shell', 'Shape and type', 'Fonts, corners and the few effects Orc leaves to the theme.'),
        ('component', 'Component chrome', 'Shape, borders, backgrounds and shadows for individual parts of the shell. Any you leave unset fall back to Orc\'s stock geometry.'),
        ('answerMode', 'Answer mode', 'The full-screen question card.'),
        ('newRun', 'New-run screen', 'Swamp\'s fireflies and mist on the new-run screen.'),
        ('notes', 'Sticky notes', 'What a sticky note on project home is made of. Set these in a rule on `.nc-note`, where `--note-tint` holds the colour the note was handed. Any you leave unset give Orc\'s stock paper.'),
        ('hostSet', 'Set by Orc', 'Orc sets these; read them, do not set them.'),
    )
    for key, title, about in sections:
        if key not in tokens:
            continue
        out += ['', '### ' + title, '', about, '', _table(['Token', 'What it does'],
                [['`%s`' % item['name'], item['what']] for item in tokens[key]])]
    out += [
        '', '## Hooks', '',
        'Parts of the page a theme may style beyond tokens. Scope every rule under',
        '`:root[data-<id>]`, so it applies only while your theme is on.',
        '', '### Named parts', '',
        'Stable `data-part` hooks on the main regions of the shell. Prefer these over ids and classes when styling layout chrome.',
        '', _table(['Selector', 'What it is'], [['`[data-part="%s"]`' % item['name'], item['what']] for item in hooks.get('parts', [])]),
        '', '### Shadow parts', '',
        'Shadow-DOM `part` names exposed on `<orc-*>` design-system and composer controls, styled with `::part(...)`.',
        '', _table(['Part', 'What it is'], [['`::part(%s)`' % item['name'], item['what']] for item in hooks.get('shadowParts', [])]),
        '', '### Ids', '', _table(['Selector', 'What it is'], [['`#%s`' % item['name'], item['what']] for item in hooks['ids']]),
        '', '### Classes', '', _table(['Selector', 'What it is'], [['`.%s`' % item['name'], item['what']] for item in hooks['classes']]),
        '', '### Attributes', '', _table(['Attribute', 'What it means'], [['`[%s]`' % item['name'], item['what']] for item in hooks['attributes']]),
        '', '### Shared names', '', _table(['Prefix', 'What it is for'], [['`.%s…`' % item['prefix'], item['what']] for item in hooks['families']]),
        '', '## Replaceable components', '',
        'A theme may set `"components": "components.js"` under `contributes.theme` in `orc-plugin.json`',
        'to replace the presentation of up to five shell slots while Orc keeps ownership of state, focus,',
        'selection, keyboard navigation and accessibility. Only the currently painted theme\'s renderers',
        'run, previewing another theme swaps and reverts mounted slots live, and any slot that returns',
        '`null` or throws falls back to Orc\'s stock markup.',
        '',
        _table(['Slot', 'Input data', 'Responsibility'], [
            ['`runRow(data)`', '`{ id, title, state, stateLabel, active, settled, project, questions, attention, unread, stale, agent, href }`', 'Custom inner content for a sidebar run row while Orc keeps `.run-actions` and `.run-link` navigation'],
            ['`statusLamp(data)`', '`{ state, running, pulse, color, label }`', 'Custom SVG or DOM indicator for live run dots and working lamps'],
            ['`tabBar(data)`', '`{ tabs: [{ key, label, active }], activeKey }`', 'Custom tab strip; must include one `<button data-key="...">` per tab or Orc falls back to stock tabs'],
            ['`sidebarHead(data)`', '`{ themeId, runCount, lowPower }`', 'Optional telemetry or banner strip inside `#sidebar-head`'],
            ['`emptyState(data)`', '`{ themeId, kind, message, hasDiff, runId }`', 'Custom empty-state presentation when no run or artifact is open'],
        ]),
        '', '## Scene kit', '',
        surface['sceneKit']['about'].replace('<apiVersion>', str(api)) + ' For example:',
        '',
        '```js',
        "import { Mesh, MeshStandardMaterial, SphereGeometry } from '/theme-kit/%d/three.js';" % api,
        "import { createStage, smooth } from '/theme-kit/%d/stage.js';" % api,
        '```',
        '',
        'README.md describes what a scene module exports and what a Factory skin receives.',
        '',
        _table(['Module', 'What it is', 'Promised exports'],
               [['`/theme-kit/%d/%s`' % (api, name), spec['what'], 'all of three.js' if spec['exports'] == ['*']
                 else ', '.join('`%s`' % export for export in spec['exports'])]
                for name, spec in surface['sceneKit']['modules'].items()]),
        '', '## Page modules', '', surface['hostModules']['about'], '',
        _table(['Module', 'What it is', 'Promised exports'],
               [['`%s`' % name, spec['what'], ', '.join('`%s`' % export for export in spec['exports'])]
                for name, spec in surface['hostModules']['modules'].items()]),
        '',
    ]
    return '\n'.join(out)


# --- Holding the repository to the surface -------------------------------

PUBLISHED_PATH = ROOT / 'distribution' / 'theme-surface.published.json'
CHANGELOG_PATH = ROOT / 'distribution' / 'CHANGELOG.md'


def _host_source():
    """The page Orc serves and the bundled packages that build it, where a
    promised name has to keep turning up."""
    files = [ROOT / 'ui' / 'index.html', ROOT / 'ui' / 'serve.py', *sorted((ROOT / 'ui').glob('*.css')),
             *sorted((ROOT / 'ui' / 'js').glob('*.js')), ROOT / 'ui' / 'vendor' / 'orc-ds.tokens.css',
             ROOT / 'ui' / 'vendor' / 'orc-ds.min.js', ROOT / 'docs' / 'showcase' / 'server.js']
    for folder in sorted((ROOT / 'app-plugins').iterdir()):
        data_path = folder / 'orc-plugin.json'
        if data_path.is_file() and 'theme' not in json.loads(data_path.read_text()).get('contributes', {}):
            files.extend(sorted(folder.glob('*.js')) + sorted(folder.glob('*.css')))
    return '\n'.join(path.read_text(errors='replace') for path in files if path.is_file())


def _exports(path):
    source = Path(path).read_text()
    found = set(re.findall(r'\bexport\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([\w$]+)', source))
    for group in re.findall(r'\bexport\s+(?:const|let)\s+\{([^}]*)\}', source):
        found.update(part.strip().split(':')[-1].strip() for part in group.split(',') if part.strip())
    for group in re.findall(r'\bexport\s*\{([^}]*)\}', source):
        found.update(part.strip().split(' as ')[-1].strip() for part in group.split(',') if part.strip())
    if re.search(r'\bexport\s+default\b', source):
        found.add('default')
    return found


KIT_SOURCES = {
    'three.js': None,
    'stage.js': ROOT / 'ui' / 'yeet' / 'stage.js',
    'party.js': ROOT / 'ui' / 'yeet' / 'party.js',
    'factory.js': ROOT / 'ui' / 'yeet' / 'factory.js',
    'factory-layout.js': ROOT / 'ui' / 'yeet' / 'factory-layout.js',
    'swamp.js': ROOT / 'app-plugins' / 'swamp' / 'scene.js',
}


def repository_problems(surface=None, *, published=None, changelog=None):
    """Every way this checkout breaks its own promise: a name the surface
    lists that Orc no longer has, a bundled theme that reaches past the
    surface, a stale reference page, or a dropped promise the public notes
    do not record."""
    from app_plugins import API_VERSION
    surface = surface or load()
    problems = []
    if surface['apiVersion'] != API_VERSION:
        problems.append('theme-surface.json apiVersion %s differs from app_plugins.API_VERSION %s'
                        % (surface['apiVersion'], API_VERSION))
    host = _host_source()
    for item in surface['hooks']['ids']:
        if not re.search(r'''(?:id=|getElementById\(|\.id\s*=\s*|#)["'`]?%s(?![\w-])''' % re.escape(item['name']), host):
            problems.append('promised id #%s is gone from the page' % item['name'])
    for item in surface['hooks']['classes']:
        if not re.search(r'(?<![\w-])%s(?![\w-])' % re.escape(item['name']), host):
            problems.append('promised class .%s is gone from the page' % item['name'])
    for item in surface['hooks']['attributes']:
        if item['name'] not in host and item['name'][len('data-'):] not in host:
            problems.append('promised attribute [%s] is gone from the page' % item['name'])
    for item in surface['hooks'].get('parts', []):
        if not re.search(r'''data-part\s*=\s*\\?["']%s\\?["']''' % re.escape(item['name']), host):
            problems.append('promised part [data-part="%s"] is gone from the page' % item['name'])
    shadow_parts_in_host = {
        word
        for match in re.finditer(
            r'''(?:(?<![\w-])part\s*=\s*|setAttribute\(\s*["']part["']\s*,\s*)\\?["']([^"'\\]+)\\?["']''',
            host,
        )
        for word in match.group(1).split()
    }
    for item in surface['hooks'].get('shadowParts', []):
        if item['name'] not in shadow_parts_in_host:
            problems.append('promised shadow part ::part(%s) is gone from the page' % item['name'])
    for group, items in surface['tokens'].items():
        for item in items:
            if not re.search(r'%s(?![\w-])' % re.escape(item['name']), host):
                problems.append('promised token %s is no longer read by the page' % item['name'])
    if set(surface['sceneKit']['modules']) != set(KIT_SOURCES):
        problems.append('sceneKit.modules must be exactly ' + ', '.join(sorted(KIT_SOURCES)))
    for name, spec in surface['sceneKit']['modules'].items():
        source = KIT_SOURCES.get(name)
        if source is None:
            continue
        missing = sorted(set(spec['exports']) - _exports(source))
        if missing:
            problems.append('kit %s no longer exports %s' % (name, ', '.join(missing)))
        if not (ROOT / 'ui' / 'vendor' / 'theme-kit' / name).is_file():
            problems.append('kit %s is not built; run node app-plugins/build.mjs' % name)
    for name, spec in surface['hostModules']['modules'].items():
        path = ROOT / 'ui' / name.lstrip('/')
        missing = sorted(set(spec['exports']) - (_exports(path) if path.is_file() else set()))
        if missing:
            problems.append('%s no longer exports %s' % (name, ', '.join(missing)))
    for folder in sorted((ROOT / 'app-plugins').iterdir()):
        data_path = folder / 'orc-plugin.json'
        if not data_path.is_file() or 'theme' not in json.loads(data_path.read_text()).get('contributes', {}):
            continue
        report = check_package(folder, surface)
        problems.extend('bundled theme %s: %s' % (folder.name, line) for line in report['errors'] + report['warnings'])
    if not REFERENCE_PATH.is_file() or REFERENCE_PATH.read_text() != render_reference(surface):
        problems.append('app-plugins/THEMING.md is stale; run bin/orc-theme-surface --write')
    if published is None and PUBLISHED_PATH.is_file():
        published = json.loads(PUBLISHED_PATH.read_text())
    if published is not None:
        if changelog is None:
            changelog = CHANGELOG_PATH.read_text() if CHANGELOG_PATH.is_file() else ''
        problems.extend(unrecorded(published, surface, changelog))
    return problems
