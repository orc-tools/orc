import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

import chat_skills
import headless_session
import harness_context
import run_chat
import model_catalog

from . import transcript

BINARY = 'agy'
MANIFEST = json.loads((Path(__file__).resolve().parent / 'harness.json').read_text())
# `agy models` ids; `default` leaves the model saved in agy's settings.
MODELS = tuple(mode['model'] for mode in MANIFEST['modes'])
MODEL_ALIASES = {alias: mode['model'] for mode in MANIFEST['modes'] for alias in mode.get('aliases', ())}
DEFAULT_MODEL = MODELS[0]
EFFORT_MODES = tuple(MANIFEST['effortModes'])
EFFORT_LEVELS = tuple(MANIFEST['effortLevels'])
MODE_EFFORT_LEVELS = {
    mode['model']: tuple(mode.get('effortLevels') or EFFORT_LEVELS)
    for mode in MANIFEST['modes']
    if mode['model'] in EFFORT_MODES
}
ALL_EFFORT_LEVELS = tuple(dict.fromkeys(
    effort for model in EFFORT_MODES for effort in MODE_EFFORT_LEVELS[model]
))
# Runs started before effort modes were collapsed stored suffixed ids in .headless/launch.json.
LEGACY_MODELS = tuple(
    '%s-%s' % (model, effort)
    for model in EFFORT_MODES
    for effort in MODE_EFFORT_LEVELS[model]
)
LAUNCH_ALIASES = {**MODEL_ALIASES, **{
    '%s-%s' % (alias, level): '%s-%s' % (target, level)
    for alias, target in MODEL_ALIASES.items()
    for level in MODE_EFFORT_LEVELS.get(target, ())
}}
PERMISSION_MODES = {'default': [], 'bypass': ['--dangerously-skip-permissions']}
REVIEWS = False
EFFORT_REFUSAL = 'This Gemini model sets its own effort.'
CONVERSATION = transcript.CONVERSATION
# How long Antigravity's record of a turn must sit finished while its process
# stays alive before Orc ends the turn. In 179 recorded conversations a
# finished reply was always followed by more work within 10 seconds, or had
# a background task, subagent or schedule still pending.
SETTLE_SECONDS = 300


# Where agy keeps its Google sign-in: the system keyring entry it logs as
# "authenticated via keyring". `security` exits 44 when there is no such item.
KEYCHAIN = ('gemini', 'antigravity')
KEYCHAIN_MISSING = 44
# When agy cannot save a refreshed token to the keyring it logs "falling back
# to file" and keeps the token here instead, and the keyring item can be gone.
TOKEN_FILE = Path('.gemini', 'antigravity-cli', 'antigravity-oauth-token')
SIGN_IN = 'Sign in to Antigravity CLI first: run agy in a terminal once.'


def signed_in():
    """Whether agy is installed and signed in to Google: True, False, or
    None when the check could not tell. Only reads whether agy's token file
    or keychain item exists, never the token. Off macOS, agy's ~/.gemini
    folder stands in for the keyring. ORC_GEMINI_SIGNED_IN=1 or 0 answers for
    fixture servers."""
    forced = os.environ.get('ORC_GEMINI_SIGNED_IN')
    if forced in ('0', '1'):
        return forced == '1'
    if not shutil.which(BINARY) or not (Path.home() / '.gemini').is_dir():
        return False
    if sys.platform != 'darwin':
        return True
    try:
        if (Path.home() / TOKEN_FILE).stat().st_size > 0:
            return True
    except OSError:
        pass
    try:
        result = subprocess.run(['security', 'find-generic-password', '-s', KEYCHAIN[0], '-a', KEYCHAIN[1]],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode == KEYCHAIN_MISSING:
        return False
    return True if result.returncode == 0 else None


def catalog():
    return [row for row in model_catalog.models_for('gemini', discover=False)
            if row['id'] not in MODEL_ALIASES] or [
        {'id': model, 'effortLevels': list(MODE_EFFORT_LEVELS.get(model, ()))} for model in MODELS]


def takes_effort(model):
    return bool(effort_levels(model))


def effort_levels(model=None):
    model = MODEL_ALIASES.get(model, model) or DEFAULT_MODEL
    return tuple(next((row.get('effortLevels', []) for row in catalog()
                       if row['id'] == model), ()))


def check_launch(model, effort):
    model = MODEL_ALIASES.get(model, model)
    if model is not None and model not in {row['id'] for row in catalog()}:
        model_catalog.models_for('gemini')
    if model is not None and model not in {row['id'] for row in catalog()}:
        raise ValueError('unknown Gemini model')
    if effort is not None and not takes_effort(model):
        raise ValueError(EFFORT_REFUSAL)
    if effort is not None and effort not in effort_levels(model):
        raise ValueError('invalid effort level')


def turn_argv(binary, *, session_id=None, resume=False, extra_args=()):
    args = list(extra_args)
    bypass = False
    selected = None
    model = []
    effort = []
    while args:
        flag = args.pop(0)
        if flag == '--model' and args:
            args[0] = LAUNCH_ALIASES.get(args[0], args[0])
            if args[0] not in LEGACY_MODELS:
                check_launch(args[0], None)
            selected = args.pop(0)
            model = [] if selected == 'default' else ['--model', selected]
            continue
        if flag == '--effort' and args and args[0] in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra'):
            effort = ['--effort', args.pop(0)]
            continue
        if flag == '--dangerously-skip-permissions':
            bypass = True
            continue
        raise ValueError('unsupported Gemini launch option')
    if effort and not takes_effort(selected):
        raise ValueError(EFFORT_REFUSAL)
    if effort and effort[1] not in effort_levels(selected):
        raise ValueError('unsupported Gemini launch option')
    argv = [binary, '--input-format', 'stream-json', '--output-format', 'stream-json',
            '--disable-slash-commands', *model, *effort]
    if bypass:
        argv.append('--dangerously-skip-permissions')
    if resume:
        if not isinstance(session_id, str) or not CONVERSATION.fullmatch(session_id):
            raise headless_session.HeadlessError('a resumed Gemini turn needs a conversation id', 'no_session')
        argv += ['--conversation', session_id]
    return argv


def compat_probe(binary):
    """What changed in agy's command line that Orc relies on. agy's model
    service cannot be scripted, so this checks only the flags and commands
    Orc passes, not a real turn."""
    import harness_compat
    import provider_usage

    conversation = '00000000-0000-0000-0000-000000000000'
    turns = [*turn_argv(binary, extra_args=['--dangerously-skip-permissions']),
             *turn_argv(binary, session_id=conversation, resume=True), '--model', '--effort']
    failures = harness_compat.flag_failures(binary, (), [*turns, *provider_usage.AGY_USAGE_ARGS])
    try:
        listed = harness_compat.help_text(binary, 'models')
    except (OSError, harness_compat.subprocess.SubprocessError) as error:
        return failures + ['`agy models --help` did not run: %s' % error]
    if not re.search(r'Usage: agy models\b', listed):
        failures.append('agy no longer has the `agy models` command Orc lists models with')
    return failures


def skill_catalog(cwd):
    # agy runs with slash commands off, so only Orc's skills work: turn_prompt
    # points the agent at the file a leading `/orc:<name>` names.
    return chat_skills.orc_skills('gemini')


def encode_prompt(text):
    return json.dumps({'event': 'user', 'message': {'content': text}}) + '\n'


def launch_prompt(meta, run_dir, entry, arguments, **kwargs):
    return harness_context.launch_prompt(meta, run_dir, entry, arguments, embed_skill=True, **kwargs)


def turn_prompt(meta, text, **kwargs):
    return harness_context.turn_prompt(meta, text, embed_skill=True, **kwargs)


def turn_event_outcome(event):
    if event.get('event') == 'result':
        error = transcript.empty_reply_permission_error(event.get('result'))
        if error:
            return True, error
    return None


def task_selection(model, effort):
    chosen = MODEL_ALIASES.get(model, model) or DEFAULT_MODEL
    check_launch(chosen, effort)
    return {
        'agent': 'gemini',
        'model': chosen,
        'effort': ('medium' if effort is None else effort) if takes_effort(chosen) else None,
    }


def orchestration_provider():
    # Gemini is not a Run Control task agent, so a Gemini coordinator runs
    # workers on its own Antigravity subscription models.
    return {
        'providerInstanceId': 'gemini',
        'provider': 'gemini',
        'runtimeModes': ['inherit', 'default'],
        'options': {'effort': list(ALL_EFFORT_LEVELS), 'effortModels': list(EFFORT_MODES), 'fast': False},
        'models': [{
            'id': mode['id'],
            'name': mode['label'],
            'takesEffort': takes_effort(mode['model']),
            **({'effortLevels': list(effort_levels(mode['model']))} if takes_effort(mode['model']) else {}),
        } for mode in MANIFEST['modes']],
    }


def orchestration_args(server):
    # Antigravity CLI configures MCP globally in ~/.gemini/config/mcp_config.json
    # rather than per session, so Gemini turns call the run-scoped orc-orchestrator
    # bridge injected into <orc-context> instead of mutating shared MCP config.
    return []


def sync_transcript(run_dir, final=False, strict=False):
    return transcript.sync(run_dir, final=final, strict=strict)


def before_turn(run_dir):
    sync_transcript(run_dir, final=True, strict=True)


def settle_turn(run_dir, state, now):
    """End a running turn the agent finished but agy never exited, keeping
    the agent's final reply. Returns True when it stopped the turn."""
    finished = transcript.finished_turn(run_dir, state, now - SETTLE_SECONDS)
    if finished is None or finished['at'] > now - SETTLE_SECONDS:
        return False
    closing = {'event': transcript.SETTLED, 'response': finished['response']}
    return headless_session.interrupt(run_dir, expect=(state['turn'], state['pid']),
                                      settled=closing) == 'stopped'


def session_id(run_dir):
    sync_transcript(run_dir)
    path = transcript.raw_transcript(run_dir)
    try:
        with headless_session._locked(run_dir, '.transcript.lock'):
            records = Path(path).read_text().splitlines()
    except OSError:
        return None
    for line in records:
        event = json.loads(line)
        conversation = event.get('conversation_id') or transcript._object(event.get('result')).get('conversation_id')
        if isinstance(conversation, str) and CONVERSATION.fullmatch(conversation):
            return conversation
    return None


def _command(data, cwd):
    command = str(data.get('CommandLine') or '')
    return 'command', run_chat._first_line(command, 400), run_chat.clip(command, run_chat.DETAIL_LIMIT), {}


def _file(data, cwd):
    path = data.get('TargetFile') or data.get('AbsolutePath') or data.get('FilePath') or ''
    return 'edit', run_chat.display_path(path, cwd), None, {}


CHAT_TOOLS = {'run_command': _command, 'write_to_file': _file,
              'replace_file_content': _file, 'multi_replace_file_content': _file}
