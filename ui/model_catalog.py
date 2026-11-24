"""Read-only model discovery from the CLIs Orc launches."""
import concurrent.futures
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import time

import codex_rpc

MODEL_ID = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9._:/+\[\]-]{0,199}\Z')
_locks = {agent: threading.Lock() for agent in ('claude', 'codex', 'gemini')}
_cache = {}
_expires = {}


def _run(argv, payload=None, env=None, cwd=None):
    result = subprocess.run(argv, input=payload, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, timeout=12,
                            cwd=cwd or tempfile.gettempdir(),
                            env=env or {k: v for k, v in os.environ.items() if k != 'CLAUDECODE'})
    if result.returncode or len(result.stdout) > 2 * 1024 * 1024:
        raise ValueError('model discovery failed')
    return result.stdout


# Claude Code answers an initialize control request in this mode without a model turn.
CLAUDE_CATALOG_ARGS = ('-p', '--input-format', 'stream-json', '--output-format',
                       'stream-json', '--verbose', '--no-session-persistence',
                       '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
                       '--settings', '{"disableAllHooks":true}', '--setting-sources', 'user')


def _claude(binary='claude', env=None, cwd=None):
    payload = json.dumps({'type': 'control_request', 'request_id': 'catalog',
                          'request': {'subtype': 'initialize'}}) + '\n'
    output = _run([binary, *CLAUDE_CATALOG_ARGS], payload, env, cwd)
    models = []
    for line in output.splitlines():
        message = json.loads(line)
        response = message.get('response', {})
        if message.get('type') == 'control_response' and response.get('request_id') == 'catalog':
            for row in response.get('response', {}).get('models', []):
                model = row.get('resolvedModel') or row.get('value')
                if row.get('value') == 'default':
                    continue
                models.append({'id': model, 'label': row.get('displayName', model),
                               'description': row.get('description', ''),
                               'effortLevels': row.get('supportedEffortLevels', [])})
    return models


def _codex():
    for connect in (codex_rpc.Client, lambda: codex_rpc.StdioClient(tempfile.gettempdir())):
        try:
            models, cursor = [], None
            with connect() as client:
                for _ in range(20):
                    page = client.call('model/list', {'limit': 100, 'cursor': cursor})
                    models.extend(page['data'])
                    cursor = page.get('nextCursor')
                    if not cursor:
                        return [{'id': row.get('model') or row['id'],
                                 'label': row.get('displayName', row.get('model', row['id'])),
                                 'description': row.get('description', ''),
                                 'effortLevels': [item['reasoningEffort'] for item in row.get('supportedReasoningEfforts', [])]}
                                for row in models if not row.get('hidden')]
        except (OSError, codex_rpc.RpcError, ValueError, KeyError, TypeError):
            continue
    return codex_cache_rows()


def codex_cache():
    """Every model in Codex's own models_cache.json, hidden ones included,
    in the order Codex ranks them, or [] when it cannot be read."""
    home = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex')))
    try:
        models = json.loads((home / 'models_cache.json').read_text(encoding='utf-8')).get('models')
    except (OSError, ValueError, AttributeError):
        return []
    if not isinstance(models, list):
        return []
    models = [row for row in models if isinstance(row, dict) and isinstance(row.get('slug'), str)
              and MODEL_ID.fullmatch(row['slug'])]
    return sorted(models, key=lambda row: row['priority'] if isinstance(row.get('priority'), int) else 1 << 30)


def codex_cache_rows():
    """The models Codex lists in its picker, from its cache."""
    return [{'id': row['slug'], 'label': row.get('display_name', row['slug']),
             'description': row.get('description', ''),
             'effortLevels': [item['effort'] for item in row.get('supported_reasoning_levels', [])]}
            for row in codex_cache() if row.get('visibility', 'list') == 'list']


def _gemini():
    models, variants = {}, {}
    for line in _run(['agy', 'models']).splitlines():
        model, sep, label = line.partition('\t')
        if not sep or not MODEL_ID.fullmatch(model):
            continue
        models[model] = {'id': model, 'label': label, 'effortLevels': []}
        match = re.fullmatch(r'(.+)-(low|medium|high|xhigh|max|ultra)', model)
        if match and re.search(r' \((Low|Medium|High|XHigh|Max|Ultra)\)$', label):
            variants.setdefault(match[1], []).append((model, match[2], label))
    order = list(models)
    replacements = {}
    for base, rows in variants.items():
        if len(rows) < 2:
            continue
        for model, _, _ in rows:
            replacements[model] = base
            del models[model]
        models[base] = {'id': base, 'label': re.sub(r' \([^()]+\)$', '', rows[0][2]),
                        'effortLevels': [level for level in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
                                         if any(row[1] == level for row in rows)]}
    models = {key: models[key] for key in dict.fromkeys(replacements.get(key, key) for key in order)}
    if models:
        models['default'] = {'id': 'default', 'label': 'Gemini (CLI default)', 'effortLevels': []}
    return list(models.values())


_loaders = {'claude': _claude, 'codex': _codex, 'gemini': _gemini}


def models_for(agent, *, discover=True):
    if not discover:
        return [dict(row) for row in _cache.get(agent, [])]
    with _locks[agent]:
        if time.monotonic() < _expires.get(agent, 0):
            return [dict(row) for row in _cache.get(agent, [])]
        try:
            rows = _loaders[agent]()
            seen = set()
            valid = []
            for row in rows:
                model = row.get('id')
                if isinstance(model, str) and MODEL_ID.fullmatch(model) and model not in seen:
                    seen.add(model)
                    valid.append(row)
            if not valid:
                raise ValueError('empty model catalog')
            _cache[agent] = valid
            _expires[agent] = time.monotonic() + 300
        except (OSError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError):
            _expires[agent] = time.monotonic() + 30
        return [dict(row) for row in _cache.get(agent, [])]


def snapshot(agents):
    available = [agent for agent in agents if agent in _loaders]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        return dict(zip(available, pool.map(models_for, available)))
