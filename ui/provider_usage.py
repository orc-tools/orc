"""Subscription usage and reset redemption through signed-in CLIs, without a model
turn, plus the usage rows enabled plugins report."""
import base64
import concurrent.futures
import hashlib
import json
import math
import os
import re
import selectors
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

import app_plugins
import claude_accounts
import harnesses
import headless_session
from keyed_locks import KeyedLocks

CACHE_SECONDS = 60
REFRESH_SECONDS = 30
PROBE_SECONDS = 20
_provider_lock = KeyedLocks()
_CACHE = {}
_LAST_GOOD = {}
# Claude reset grants come from Anthropic's usage endpoint, which rate limits
# outside callers hard, so each sign-in is asked at most this often.
RESET_GRANTS_SECONDS = 15 * 60
_RESET_GRANTS = {}
# Claude Code answers a get_usage control request in this mode without a model turn.
CLAUDE_USAGE_ARGS = ('-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
                     '--no-session-persistence', '--settings', '{"disableAllHooks":true}',
                     '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}')
AGY_USAGE_ARGS = ('-p', '/usage', '--output-format', 'json')
CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1'


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _date(value):
    try:
        if _number(value) and value > 0:
            return datetime.fromtimestamp(value, timezone.utc).isoformat()
        if isinstance(value, str):
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if parsed.tzinfo:
                return parsed.astimezone(timezone.utc).isoformat()
    except (ValueError, OverflowError, OSError):
        pass
    return None


def _window(label, used, reset):
    if not _number(used):
        return None
    return {'label': label, 'remainingPercent': max(0, min(100, 100 - used)),
            'resetsAt': _date(reset)}


def _duration(minutes, fallback):
    if not _number(minutes) or minutes <= 0:
        return fallback
    if minutes == 10080:
        return 'Weekly'
    if minutes % 1440 == 0:
        return f'{minutes / 1440:g}-day'
    if minutes % 60 == 0:
        return f'{minutes / 60:g}-hour'
    return f'{minutes:g}-minute'


def _agy_window_label(bucket):
    window = bucket.get('window')
    if isinstance(window, str):
        text = window.strip().lower()
        if text in ('weekly', '7d'):
            return 'Weekly'
        if text in ('daily', '1d'):
            return '1-day'
        match = re.fullmatch(r'(\d+)([hdm])', text)
        if match:
            amount, unit = int(match.group(1)), match.group(2)
            if unit == 'h' and amount > 0:
                return f'{amount}-hour'
            if unit == 'd' and amount > 0:
                return 'Weekly' if amount == 7 else f'{amount}-day'
            if unit == 'm':
                return _duration(amount, 'Allowance')
    fallback = bucket.get('name') or bucket.get('id') or 'Allowance'
    return str(fallback).strip()[:100] or 'Allowance'


def normalize(provider, data):
    windows = []
    if provider == 'claude':
        limits = data.get('rate_limits')
        if data.get('rate_limits_available') is not True or not isinstance(limits, dict):
            return windows
        for key, label in [('five_hour', '5-hour'), ('seven_day', 'Weekly')]:
            raw = limits.get(key)
            if isinstance(raw, dict):
                windows.append(_window(label, raw.get('utilization'), raw.get('resets_at')))
        scoped = limits.get('model_scoped')
        for raw in scoped if isinstance(scoped, list) else []:
            if isinstance(raw, dict) and isinstance(raw.get('display_name'), str):
                windows.append(_window('Weekly · ' + raw['display_name'][:100],
                                       raw.get('utilization'), raw.get('resets_at')))
    elif provider == 'agy':
        groups = [group for group in (data.get('groups') if isinstance(data.get('groups'), list) else [])
                  if isinstance(group, dict)]
        for group in groups:
            name = group.get('name')
            prefix = f'{name.strip()[:100]} · ' if len(groups) > 1 and isinstance(name, str) and name.strip() else ''
            buckets = group.get('buckets')
            for bucket in buckets if isinstance(buckets, list) else []:
                if not isinstance(bucket, dict) or bucket.get('disabled') is True:
                    continue
                fraction = bucket.get('remaining_fraction')
                if not _number(fraction):
                    continue
                windows.append({'label': prefix + _agy_window_label(bucket),
                                'remainingPercent': max(0, min(100, fraction * 100)),
                                'resetsAt': _date(bucket.get('reset_time'))})
    else:
        buckets = _codex_buckets(data)
        for key, bucket in buckets.items():
            if not isinstance(bucket, dict):
                continue
            name = bucket.get('limitName') or key
            prefix = f'{str(name)[:100]} · ' if len(buckets) > 1 else ''
            for field, fallback in [('primary', 'Primary window'), ('secondary', 'Secondary window')]:
                raw = bucket.get(field)
                if isinstance(raw, dict):
                    label = prefix + _duration(raw.get('windowDurationMins'), fallback)
                    windows.append(_window(label, raw.get('usedPercent'), raw.get('resetsAt')))
    return [window for window in windows if window is not None]


def _codex_buckets(data):
    buckets = data.get('rateLimitsByLimitId')
    return buckets if isinstance(buckets, dict) and buckets else {'codex': data.get('rateLimits')}


def _usage_credits(data):
    bucket = _codex_buckets(data).get('codex')
    if not isinstance(bucket, dict) or not isinstance(bucket.get('credits'), dict):
        bucket = data.get('rateLimits')
    credits = bucket.get('credits') if isinstance(bucket, dict) else None
    if not isinstance(credits, dict):
        return None
    has_credits, unlimited = credits.get('hasCredits'), credits.get('unlimited')
    if not isinstance(has_credits, bool) or not isinstance(unlimited, bool):
        return None
    balance = credits.get('balance')
    if not isinstance(balance, str) or not re.fullmatch(r'[0-9]{1,16}(?:\.[0-9]{1,16})?', balance):
        balance = None
    return {'hasCredits': has_credits, 'unlimited': unlimited, 'balance': balance}


class ProbeError(Exception):
    pass


class SignInError(ProbeError):
    pass


def _terminate(process):
    # macOS raises PermissionError when killpg targets a session leader that has
    # already exited as a zombie before wait() reaps it.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        process.wait()


def _read_protocol(command, provider, env, cwd, reset_key=None, prepare_reset=None):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, env=env, cwd=cwd,
                               start_new_session=True)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    pending = b''
    deadline = time.monotonic() + PROBE_SECONDS
    total = 0

    def send(message):
        process.stdin.write((json.dumps(message) + '\n').encode())
        process.stdin.flush()

    def response(request_id):
        nonlocal pending, total
        while True:
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                try:
                    message = json.loads(line)
                except (ValueError, UnicodeDecodeError):
                    continue
                if not isinstance(message, dict):
                    continue
                if provider == 'codex' and message.get('id') == request_id:
                    if 'error' in message:
                        raise ProbeError('Usage is unavailable. Check your Codex sign-in and try again.')
                    result = message.get('result')
                    if not isinstance(result, dict):
                        raise ProbeError('Codex returned an unsupported usage response.')
                    return result
                reply = message.get('response')
                if (provider == 'claude' and message.get('type') == 'control_response'
                        and isinstance(reply, dict) and reply.get('request_id') == request_id):
                    result = reply.get('response')
                    if reply.get('subtype') != 'success' or not isinstance(result, dict):
                        raise ProbeError('Usage is unavailable. Update Claude Code and check your sign-in.')
                    return result
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not selector.select(remaining):
                raise ProbeError('The usage check timed out. Try again shortly.')
            chunk = os.read(process.stdout.fileno(), 65536)
            if not chunk:
                raise ProbeError('The CLI exited before returning usage. Check your sign-in.')
            pending += chunk
            total += len(chunk)
            if total > 1024 * 1024:
                raise ProbeError('The CLI returned an unsupported usage response.')

    try:
        if provider == 'codex':
            send({'id': 1, 'method': 'initialize',
                  'params': {'clientInfo': {'name': 'orc_usage', 'version': '1.0'},
                             **({'capabilities': {'experimentalApi': True}} if reset_key or prepare_reset else {})}})
            response(1)
            send({'method': 'initialized'})
            if not reset_key:
                send({'id': 2, 'method': 'account/rateLimits/read'})
                limits = response(2)
                if not prepare_reset:
                    return limits
                reset_key = prepare_reset(limits)
                if not reset_key:
                    return None
            send({'id': 3, 'method': 'account/rateLimitResetCredit/consume',
                  'params': {'idempotencyKey': reset_key}})
            return response(3)
        send({'type': 'control_request', 'request_id': 'init', 'request': {'subtype': 'initialize'}})
        response('init')
        send({'type': 'control_request', 'request_id': 'usage', 'request': {'subtype': 'get_usage', 'skip_behaviors': True}})
        return response('usage')
    finally:
        selector.close()
        _terminate(process)
        process.stdin.close()
        process.stdout.close()


def _read_agy(command, env, cwd):
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, env=env, cwd=cwd,
                               start_new_session=True)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    selector.register(process.stderr, selectors.EVENT_READ)
    stdout, stderr = b'', b''
    deadline = time.monotonic() + PROBE_SECONDS
    total = 0
    try:
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProbeError('The usage check timed out. Try again shortly.')
            events = selector.select(remaining)
            if not events:
                raise ProbeError('The usage check timed out. Try again shortly.')
            for key, _ in events:
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                total += len(chunk)
                if total > 1024 * 1024:
                    raise ProbeError('Antigravity CLI returned an unsupported usage response.')
                if key.fileobj is process.stdout:
                    stdout += chunk
                else:
                    stderr += chunk
            if b'Authentication required' in stderr or b'not logged into Antigravity' in stderr:
                raise SignInError('Usage is unavailable. Run agy in a terminal to sign in.')
        if not stdout.strip():
            raise ProbeError('The CLI exited before returning usage. Check your sign-in.')
        try:
            message = json.loads(stdout)
        except (ValueError, UnicodeDecodeError) as error:
            raise ProbeError('Antigravity CLI returned an unsupported usage response.') from error
        if not isinstance(message, dict):
            raise ProbeError('Antigravity CLI returned an unsupported usage response.')
        if message.get('status') != 'SUCCESS':
            error_text = str(message.get('error') or '')
            if 'not logged in' in error_text.lower() or 'authentication' in error_text.lower():
                raise SignInError('Usage is unavailable. Run agy in a terminal to sign in.')
            raise ProbeError('Usage is unavailable. Check your agy sign-in and try again.')
        command_reply = message.get('command')
        data = command_reply.get('data') if isinstance(command_reply, dict) and command_reply.get('name') == 'usage' else None
        if not isinstance(data, dict):
            raise ProbeError('Antigravity CLI returned an unsupported usage response.')
        return data
    finally:
        selector.close()
        _terminate(process)
        process.stdout.close()
        process.stderr.close()


_INSTALL_NAMES = {'claude': 'Claude Code', 'codex': 'Codex', 'agy': 'Antigravity CLI (agy)'}


def _probe(provider, account=None, **reset_options):
    executable = shutil.which(provider)
    if not executable:
        raise ProbeError(f'Install {_INSTALL_NAMES.get(provider, provider)} and sign in to see your allowance.')
    env = os.environ.copy()
    if provider == 'agy':
        home = Path(env.get('HOME') or Path.home())
        if not (home / '.gemini').is_dir():
            raise SignInError('Run agy in a terminal to sign in and see your allowance.')
        with tempfile.TemporaryDirectory(prefix='orc-usage-') as cwd:
            # Signed-out agy attempts to open a Google OAuth tab via BROWSER / open / xdg-open
            # and wait 60s for a callback; blocking browser launch keeps polling silent.
            shims = Path(cwd) / 'bin'
            shims.mkdir()
            for opener in ('open', 'xdg-open'):
                shim = shims / opener
                shim.write_text('#!/bin/sh\nexit 0\n', encoding='utf-8')
                shim.chmod(0o755)
            env['PATH'] = f"{shims}{os.pathsep}{env.get('PATH', '')}"
            env['BROWSER'] = 'false'
            return _read_agy([executable, *AGY_USAGE_ARGS], env, cwd)
    if provider == 'claude':
        env.pop('CLAUDECODE', None)
        env.update(ENABLE_CLAUDEAI_MCP_SERVERS='false', CLAUDE_CODE_AUTO_CONNECT_IDE='0',
                   CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL='1',
                   CLAUDE_CODE_ENTRYPOINT=headless_session.CLAUDE_ENTRYPOINT)
        env.pop('CLAUDE_CONFIG_DIR', None)
        env.update(claude_accounts.launch_env(account or claude_accounts.DEFAULT))
        command = [executable, *CLAUDE_USAGE_ARGS]
    else:
        command = [executable, 'app-server']
    with tempfile.TemporaryDirectory(prefix='orc-usage-') as cwd:
        return _read_protocol(command, provider, env, cwd, **reset_options)


def _reset_credits(data):
    """Codex's rateLimitResetCredits as availableResets and nextResetExpiresAt,
    or {} when the count is missing or malformed."""
    credits = data.get('rateLimitResetCredits')
    count = credits.get('availableCount') if isinstance(credits, dict) else None
    if not isinstance(count, int) or isinstance(count, bool) or not 0 <= count <= 9007199254740991:
        return {}
    entries = credits.get('credits')
    expiries = [_date(entry.get('expiresAt')) for entry in entries
                if isinstance(entry, dict) and entry.get('status') == 'available'] if isinstance(entries, list) else []
    return {'availableResets': count,
            'nextResetExpiresAt': min((date for date in expiries if date), default=None) if count > 0 else None}


def claude_reset_grants(block):
    """Claude's cedar_ember usage block as availableResets and
    nextResetExpiresAt, or None for an ineligible sign-in or a malformed block.
    Paused grants are left out, as Claude Code leaves them out of its own count."""
    if not isinstance(block, dict) or block.get('eligible') is not True:
        return None
    grants = block.get('grants')
    count, expiries = 0, []
    for grant in grants if isinstance(grants, list) else []:
        if not isinstance(grant, dict) or grant.get('paused') is True:
            continue
        left = grant.get('resets_left')
        if not isinstance(left, int) or isinstance(left, bool) or not 0 <= left <= 9007199254740991:
            continue
        count += left
        if left:
            expiries.append(_date(grant.get('ends_at')))
    return {'availableResets': count,
            'nextResetExpiresAt': min((date for date in expiries if date), default=None) if count else None}


def _claude_access_token(account=None):
    """The OAuth access token Claude Code saved for a sign-in, or None. Claude
    Code keeps it in the macOS Keychain, named with a hash of the config folder
    for a non-default sign-in, and in .credentials.json elsewhere."""
    folder = claude_accounts.launch_env(account).get('CLAUDE_CONFIG_DIR') if account else None
    if account and not folder:
        return None
    raw = None
    if shutil.which('security'):
        service = 'Claude Code-credentials' + (
            '-' + hashlib.sha256(folder.encode()).hexdigest()[:8] if folder else '')
        found = subprocess.run(['security', 'find-generic-password', '-s', service, '-w'],
                               capture_output=True, timeout=10)
        raw = found.stdout if found.returncode == 0 else None
    if raw is None:
        try:
            raw = (Path(folder or Path.home() / claude_accounts.DEFAULT) / '.credentials.json').read_bytes()
        except OSError:
            return None
    oauth = json.loads(raw).get('claudeAiOauth')
    token = oauth.get('accessToken') if isinstance(oauth, dict) else None
    expires = oauth.get('expiresAt') if isinstance(oauth, dict) else None
    if not isinstance(token, str) or not token or (_number(expires) and expires / 1000 <= time.time()):
        return None
    return token


def _fetch_claude_reset_grants(account=None):
    token = _claude_access_token(account)
    if token is None:
        raise ProbeError('No saved Claude sign-in token.')
    request = urllib.request.Request(CLAUDE_USAGE_URL, headers={
        'Authorization': f'Bearer {token}', 'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'orc-usage/1.0'})
    with urllib.request.urlopen(request, timeout=PROBE_SECONDS) as response:
        body = json.loads(response.read(1024 * 1024 + 1)[:1024 * 1024])
    block = body.get('cedar_ember') if isinstance(body, dict) else None
    if isinstance(block, dict) and block.get('ineligible_reason') == 'unavailable':
        raise ProbeError('Claude reset grants are unavailable right now.')
    return claude_reset_grants(block)


def _claude_resets(key, account=None):
    """Reset grants for one Claude sign-in, checked at most every
    RESET_GRANTS_SECONDS whether or not the user asked for a refresh. A failed
    check keeps the last answer for the same sign-in."""
    signed_in = email('claude', account)
    cached = _RESET_GRANTS.get(key)
    if cached and cached[1] != signed_in:
        cached = None
    if cached and time.monotonic() - cached[0] < RESET_GRANTS_SECONDS:
        return cached[2]
    try:
        grants = _fetch_claude_reset_grants(account)
    except Exception:  # noqa: BLE001 - a private endpoint; any change reads as no answer
        grants = cached[2] if cached else None
    _RESET_GRANTS[key] = (time.monotonic(), signed_in, grants)
    return grants


def read_provider(provider, refresh=False, account=None):
    """Usage for one CLI login. A Claude account other than the default is
    named in the result so each login gets its own row. A failed check of the
    same sign-in returns its last good result marked stale, so the allowance
    stays visible while the CLI cannot reach the usage service."""
    key = f'{provider}:{account}' if account else provider
    with _provider_lock(key):
        cached = _CACHE.get(key)
        if cached and time.monotonic() - cached[0] < (REFRESH_SECONDS if refresh else CACHE_SECONDS):
            return cached[1]
        result = {'provider': provider, 'status': 'unavailable', 'windows': [],
                  'checkedAt': datetime.now(timezone.utc).isoformat(), 'availableResets': None,
                  'nextResetExpiresAt': None, 'usageCredits': None}
        if account:
            result['account'] = account
        failure = None
        signed_out = False
        try:
            data = _probe(provider, account)
            result['windows'] = normalize(provider, data)
            if provider == 'codex':
                result['usageCredits'] = _usage_credits(data)
                result.update(_reset_credits(data))
            elif provider == 'claude' and result['windows']:
                result.update(_claude_resets(key, account) or {})
            if result['windows']:
                result['status'] = 'available'
            elif provider == 'claude' and data.get('rate_limits_available') is True:
                failure = 'Claude Code could not reach the usage service. Try again shortly.'
            else:
                result['message'] = 'This sign-in does not report subscription limits. API-key accounts may not include an allowance.'
        except SignInError as error:
            signed_out = True
            failure = str(error)
        except ProbeError as error:
            failure = str(error)
        except (OSError, ValueError, TypeError):
            failure = 'Could not read usage. Check your CLI installation and sign-in, then try again.'
        except Exception:  # noqa: BLE001 - a reply shaped in a way this reader does not know
            failure = ('Could not read usage: the CLI may have changed how it reports it. '
                       'Run orc-harness-compat to check.')
        if result['status'] == 'available':
            _LAST_GOOD[key] = (email(provider, account), result)
        elif signed_out:
            _LAST_GOOD.pop(key, None)
            result = {**result, 'message': failure}
        elif failure:
            last = _LAST_GOOD.get(key)
            result = ({**last[1], 'stale': True, 'message': failure}
                      if last and last[0] == email(provider, account) else {**result, 'message': failure})
        _CACHE[key] = (time.monotonic(), result)
        return result


def _reset_outcome(result):
    outcome = result.get('outcome')
    if outcome not in ('reset', 'alreadyRedeemed', 'nothingToReset', 'noCredit'):
        raise ProbeError('Unsupported reset response.')
    return outcome


def redeem_reset(idempotency_key):
    if not isinstance(idempotency_key, str) or not re.fullmatch(
            r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', idempotency_key):
        raise ValueError('A reset attempt UUID is required.')
    with _provider_lock('codex'):
        try:
            return {'outcome': _reset_outcome(_probe('codex', reset_key=idempotency_key))}
        except (ProbeError, OSError, ValueError, TypeError) as error:
            raise ProbeError('Could not confirm the reset. Check usage, then retry this attempt. '
                             'You may need to update Codex or sign in again.') from error
        finally:
            _CACHE.pop('codex', None)


def _jobs():
    extra = [name for name in claude_accounts.available() if name != claude_accounts.DEFAULT]
    agy = [('agy', None)] if harnesses.get('gemini') else []
    return [('claude', None), *(('claude', name) for name in extra), ('codex', None), *agy]


def account_keys():
    """Keys naming each usage row's account: claude, claude:.claude-two, codex, agy."""
    return [f'{provider}:{account}' if account else provider for provider, account in _jobs()]


def _read_json(path):
    try:
        with open(path, encoding='utf-8') as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _claude_sign_in(account=None):
    """The oauthAccount object of a Claude login's .claude.json, or {}."""
    folder = Path.home() / account if account else Path.home()
    oauth = (_read_json(folder / '.claude.json') or {}).get('oauthAccount')
    return oauth if isinstance(oauth, dict) else {}


def _codex_sign_in():
    """The claims of Codex's ChatGPT ID token, decoded without verification
    since it is local data, or {} for API-key, missing or malformed auth."""
    auth = _read_json(Path(os.environ.get('CODEX_HOME') or Path.home() / '.codex') / 'auth.json') or {}
    tokens = auth.get('tokens')
    token = tokens.get('id_token') if isinstance(tokens, dict) else None
    mode = auth.get('auth_mode')
    if not isinstance(token, str) or (isinstance(mode, str) and mode.lower() in ('apikey', 'api_key')):
        return {}
    try:
        payload = token.split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
    except (IndexError, ValueError):
        return {}
    return claims if isinstance(claims, dict) else {}


def _codex_reset_account():
    claims = _codex_sign_in()
    auth = claims.get('https://api.openai.com/auth')
    account = auth.get('chatgpt_account_id') if isinstance(auth, dict) else None
    subject = claims.get('sub')
    if not isinstance(account, str) or not account or not isinstance(subject, str) or not subject:
        return None, None
    return account, hashlib.sha256(json.dumps([account, subject]).encode()).hexdigest()


def _active_codex_windows(data, now):
    bucket = _codex_buckets(data).get('codex')
    if not isinstance(bucket, dict):
        return {}
    active = {}
    for field in ('primary', 'secondary'):
        raw = bucket.get(field)
        if not isinstance(raw, dict):
            continue
        window = _window(field, raw.get('usedPercent'), raw.get('resetsAt'))
        if window and (window['resetsAt'] or '') > now:
            active[f"{field}@{window['resetsAt']}"] = window['remainingPercent']
    return active


class CodexAutoReset:
    def __init__(self, config_dir):
        self.directory = Path(config_dir) / 'codex-auto-reset'
        self._lock = threading.Lock()
        self._wake = threading.Event()

    def _state(self, account):
        state = _read_json(self.directory / f'{account}.json') or {}
        attempt = state.get('attempt')
        windows = state.get('windows')
        return {**state, 'attempt': attempt if isinstance(attempt, dict) else {},
                'windows': windows if isinstance(windows, dict) else {}}

    def status(self):
        _, account = _codex_reset_account()
        if not account:
            return None
        state = self._state(account)
        enabled = state.get('enabled') is True
        outcome = state['attempt'].get('outcome') if enabled else None
        return {'account': account, 'enabled': enabled, 'outcome': outcome}

    def set_enabled(self, account, enabled):
        with self._lock:
            if not account or account != _codex_reset_account()[1]:
                raise ValueError('The Codex sign-in changed. Refresh usage and try again.')
            state = self._state(account)
            self._save(account, {**state, 'enabled': enabled})
            outcome = state['attempt'].get('outcome') if enabled else None
        if enabled:
            self._wake.set()
        return {'account': account, 'enabled': enabled, 'outcome': outcome}

    def _save(self, account, state):
        self.directory.mkdir(parents=True, exist_ok=True)
        app_plugins.atomic_json(self.directory / f'{account}.json', state)

    def check(self):
        provider_account, account = _codex_reset_account()
        if not account or self._state(account).get('enabled') is not True:
            return
        attempt_key = None

        def prepare_reset(data):
            nonlocal attempt_key
            if data.get('accountId') != provider_account:
                return None
            now = datetime.now(timezone.utc).isoformat()
            active = _active_codex_windows(data, now)
            exhausted = {window for window, remaining in active.items() if remaining == 0}
            with self._lock:
                state = self._state(account)
                if state.get('enabled') is not True or _codex_reset_account() != (provider_account, account):
                    return None
                attempt = state['attempt']
                previous = state['windows']
                blocked = {window: key for window, key in previous.items()
                           if window.partition('@')[2] > now and active.get(window, 0) == 0}
                seen = exhausted.intersection(blocked)
                retry_key = attempt.get('key') if attempt.get('outcome') == 'pending' else None
                retry = isinstance(retry_key, str) and any(blocked[window] == retry_key for window in seen)
                can_start = exhausted and not seen and _reset_credits(data).get('availableResets')
                if not (retry or can_start):
                    if blocked != previous:
                        self._save(account, {**state, 'windows': blocked})
                    return None
                # A lost response or restart must retry with the same provider key.
                key = retry_key if retry else str(uuid.uuid4())
                blocked.update({window: key for window in exhausted - seen})
                self._save(account, {**state, 'windows': blocked, 'attempt': {'key': key, 'outcome': 'pending'}})
                attempt_key = key
                return key

        with _provider_lock('codex'):
            try:
                result = _probe('codex', prepare_reset=prepare_reset)
                if result is None:
                    return
                outcome = _reset_outcome(result)
            except (ProbeError, OSError, ValueError, TypeError):
                return
            finally:
                if attempt_key:
                    _CACHE.pop('codex', None)
            with self._lock:
                state = self._state(account)
                attempt = state['attempt']
                if attempt.get('key') == attempt_key:
                    self._save(account, {**state, 'attempt': {**attempt, 'outcome': outcome}})

    def watch(self, available):
        while True:
            self._wake.clear()
            try:
                if available():
                    self.check()
            except (OSError, ValueError):
                pass
            self._wake.wait(CACHE_SECONDS)


def email(provider, account=None):
    """The address an account is signed in as, when it looks like one."""
    if provider == 'agy':
        return None
    value = (_claude_sign_in(account).get('emailAddress') if provider == 'claude'
             else _codex_sign_in().get('email'))
    if (not isinstance(value, str) or len(value) >= 320 or '@' not in value
            or any(char.isspace() or unicodedata.category(char).startswith('C') for char in value)):
        return None
    return value


def valid_renewal_day(day):
    return type(day) is int and 1 <= day <= 31


def renewal(provider, account=None, manual_days=None):
    """Renewal day for one account, set by hand in Settings, or None. Local
    sign-in data does not carry the billing day, so nothing is detected."""
    key = f'{provider}:{account}' if account else provider
    manual = manual_days.get(key) if isinstance(manual_days, dict) else None
    return {'day': manual} if valid_renewal_day(manual) else None


CORE_PROVIDERS = frozenset({'claude', 'codex', 'agy'})


def _plugin_window(window):
    return (isinstance(window, dict) and isinstance(window.get('label'), str) and window['label'].strip() != ''
            and _number(window.get('remainingPercent')) and math.isfinite(window['remainingPercent'])
            and (window.get('resetsAt') is None or isinstance(window['resetsAt'], str)))


def plugin_rows(results):
    """The rows from plugins' ``usage(refresh)`` hooks that the usage card can
    draw: one per plugin id, each naming itself with a ``label``. A malformed
    row is dropped so one plugin cannot break the card for the others."""
    rows, seen = [], set()
    for result in results:
        for row in result if isinstance(result, list) else [result]:
            provider = row.get('provider') if isinstance(row, dict) else None
            if (not isinstance(provider, str) or not app_plugins.IDENTIFIER.fullmatch(provider)
                    or provider in CORE_PROVIDERS or provider in seen
                    or not isinstance(row.get('label'), str) or not row['label'].strip()
                    or not isinstance(row.get('windows'), list)
                    or not all(_plugin_window(window) for window in row['windows'])):
                continue
            seen.add(provider)
            rows.append(row)
    return rows


def snapshot(refresh=False, renewal_days=None, plugin_usage=None):
    """Usage per account. Renewal and email are read fresh on every call, outside
    the usage cache, so a saved manual day shows on the next fetch.
    ``plugin_usage(refresh)`` returns enabled plugins' hook results and runs
    beside the CLI checks."""
    jobs = _jobs()
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs) + 1) as pool:
        extra = pool.submit(plugin_usage, refresh) if plugin_usage else None
        results = list(pool.map(lambda job: read_provider(job[0], refresh, job[1]), jobs))
        extra = plugin_rows(extra.result()) if extra else []
    rows = [{**result, 'renewal': renewal(provider, account, renewal_days), 'email': email(provider, account)}
            for (provider, account), result in zip(jobs, results)]
    return {'providers': rows + extra}
