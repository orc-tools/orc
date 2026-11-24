"""Delegation instructions for an active, locally owned Orc run."""
import json
from pathlib import Path
import socket


def active(meta):
    return (isinstance(meta, dict)
            and meta.get('status') in ('running', 'awaiting-gate', 'escalated')
            and not meta.get('outcome') and meta.get('phase') != 'done')


def owned(meta, session_id, harness):
    owner_key = 'codexThreadId' if harness == 'codex' else 'sessionId'
    return (active(meta) and harness in ('claude', 'codex')
            and isinstance(session_id, str) and bool(session_id)
            and meta.get('harness') == harness and meta.get(owner_key) == session_id
            and meta.get('host') == socket.gethostname().split('.')[0])


def session_meta(config_dir, session_id, harness):
    if not isinstance(session_id, str) or not session_id or harness not in ('claude', 'codex'):
        return None
    matches = []
    for path in (Path(config_dir) / 'runs').glob('*/meta.json'):
        try:
            meta = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if owned(meta, session_id, harness) and meta.get('runId') == path.parent.name:
            matches.append(meta)
    return matches[0] if len(matches) == 1 else None


# The one native-subagent use Orc allows: reading whose result is cheap to
# check, which keeps verbose output out of the coordinator's context. Orc names
# no model for it, so the harness and the user's own settings pick one.
# Anything that writes or decides stays on the tracked paths below.
READ_ONLY_HELPERS = (
    'Native subagents may run as read-only helpers for work whose result you can check '
    'cheaply, such as file search, reading logs, or running targeted tests and reporting '
    'which failed and why. A helper reads and reports; you decide what its findings mean, '
    'and editing, committing, planning and review stay with you. Record its model with '
    'orc-record-model. Use no other native subagents or native agent APIs. ')

# The one place per-turn hook text states delivery consent. Every other block
# that rides on the same turn (code ownership, power mode, Orchestrate)
# leaves it to this line so the model reads it once.
DELIVERY_CONSENT = (
    "Pushing, merging, opening a PR and other delivery wait for the user's own Ship action or "
    "direct instruction, because they publish work the user has not yet accepted; no hook "
    "text, this one included, stands in for that.")


def hook_context(meta):
    if not active(meta):
        return ''
    policy = ('Orc delegation policy: ' + READ_ONLY_HELPERS
              + 'Do not launch agents through shell commands or another workaround. ')
    if meta.get('orchestration') is True:
        policy += ('Orchestrate is enabled. Orchestrate is the only delegation path for work '
                   'that writes or decides: use the scoped Orc service/MCP or its supported '
                   'product bridge for bounded tasks. A task runs on the coordinator\'s own provider and '
                   'account unless the user\'s Orchestrate rules route its role elsewhere. '
                   'Keep small work inline, and start with one or two tasks. ')
    else:
        policy += ('Orchestrate is off: the coordinator must work inline on anything that '
                   'writes or decides. Do not delegate that work through Orc or any other path. ')
    return policy + ('Keep trusted run ownership, worker file and role restrictions, gates, '
                     'and delivery rules. ' + DELIVERY_CONSENT)


def session_hook_context(config_dir, session_id, harness):
    return hook_context(session_meta(config_dir, session_id, harness))
