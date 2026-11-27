"""Replace a provider session while retaining one run's workspace and authority."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import subprocess
import tarfile
import tempfile
import uuid

import claude_accounts
import harness_context
import harnesses
import headless_session
import power_mode
import session_identity
import session_paths
import run_lifecycle
import follow_up_queue
import run_session
import run_chat
import skill_commands

OWNER_KEYS = {'claude': 'sessionId', 'codex': 'codexThreadId'}
INITIAL_PROMPT_BUDGET = 4000
COMMAND_RESULTS_BUDGET = 4000
RECENT_CONVERSATION_BUDGET = 10000
CHECK_COMMAND_RE = re.compile(
    r'(?:^|\s|/)(?:pytest|unittest|playwright|vitest|jest|cargo\s+(?:test|check|clippy)|'
    r'go\s+(?:test|vet)|npm\s+(?:test|run)|pnpm\s+(?:test|run|check)|yarn\s+(?:test|check)|'
    r'tsc|eslint|ruff|mypy|pyright|flake8|bin/test|orc-[a-z0-9-]+|make\s+(?:test|check|lint)|'
    r'git\s+(?:commit|status|diff))\b',
    re.I,
)

RECOVERY_FIELDS = {
    'outcome': ('Intended outcome', 'Read inputs/build-spec/source.json and inputs/start-prompt.txt.'),
    'decisions': ('Accepted decisions', 'Read decisions.jsonl and the saved conversation; do not infer new approval.'),
    'checks': ('Checks so far', 'No verified results supplied. Read saved proof and rerun checks affected by unfinished edits.'),
    'failedHypotheses': ('Failed hypotheses', 'Not recorded. Review the conversation before repeating an attempted fix.'),
    'nextStep': ('Next step', 'Validate the workspace, reconcile interrupted actions, then identify the first unfinished requirement.'),
}


def normalize_recovery_notes(value):
    if value is None:
        return {}
    if not isinstance(value, dict) or set(value) - RECOVERY_FIELDS.keys():
        raise RescueError('Recovery notes must contain only the supported handoff fields.')
    notes = {}
    for key, text in value.items():
        if not isinstance(text, str) or len(text) > 4000 or '\x00' in text:
            raise RescueError('Each recovery note must be text of at most 4000 characters without null bytes.')
        if text.strip():
            notes[key] = text.strip()
    return notes


MAX_CHECKPOINT_BYTES = 32 * 1024 * 1024
MAX_USER_PROMPT_CHARS = 200_000
CONTEXT_FILES = ('inputs/start-prompt.txt', 'inputs/work-spec.md', 'inputs/clarification-brief.md',
                 'planning/planning.mdx', 'plan.mdx', 'answer.md', 'review/recap.mdx',
                 'inputs/build-spec/source.json', 'build-summary.md', 'pr-body.md',
                 'decisions.jsonl', 'follow-ups.json')
SETTLED_STATUSES = ('complete', 'merged')
OPEN_OUTCOMES = ('question', 'evals')
LEGACY_SESSION_KEYS = ('herdrPane', 'herdrTab', 'herdrSession', 'tmuxPane', 'paneAlive')


class RescueError(ValueError):
    pass


def normalize_user_prompt(value):
    if value is None:
        return ''
    if not isinstance(value, str) or len(value) > MAX_USER_PROMPT_CHARS or '\x00' in value:
        raise RescueError('Draft text must be plain text without null bytes.')
    return value.strip()


def is_settled_session(meta):
    return (meta.get('status') in SETTLED_STATUSES
            or meta.get('outcome') in OPEN_OUTCOMES)


def unstarted_stub(meta):
    """An orc-ui launch stub no /orc:run session adopted, so it holds
    nothing but its reserved brief and lineage."""
    return (meta.get('launchedBy') == 'orc-ui' and meta.get('titlePending') is True
            and meta.get('status') == 'running' and not meta.get('outcome')
            and not any(key in meta for key in ('lifecycleVersion', 'route', 'branch', 'repositories')))


def first_launch_failed(run, meta):
    turn = headless_session.turn_state(run)
    return turn['outcome'] == 'failed' if turn else bool(meta.get('launchFailure'))


def reserved_launch_args(run):
    brief = (run / 'inputs' / 'start-prompt.txt').read_text()
    return '--launch-run %s --quoted-prompt %s' % (run.name, shlex.quote(brief.removesuffix('\n')))


def reserved_launch_prompt(run, agent):
    """The exact line orc-ui first sent, so the launch hook adopts this stub
    on the new agent instead of minting another run."""
    return '%s %s' % (skill_commands.invocation(agent, 'orc'), reserved_launch_args(run))


def owner(meta):
    harness = meta.get('harness') or ('claude' if meta.get('sessionId') else '')
    key = OWNER_KEYS.get(harness)
    return '%s:%s' % (harness, (meta.get(key) if key else None) or '')


def _resolve_cwd(run, meta):
    worktree = meta.get('worktree') if isinstance(meta.get('worktree'), dict) else {}
    launch = headless_session.read_launch(run) or {}
    candidates = (
        meta.get('repoPath'),
        worktree.get('path'),
        meta.get('mainRepoPath'),
        meta.get('projectContext'),
        launch.get('cwd'),
    )
    for raw in candidates:
        if isinstance(raw, str) and raw.strip():
            path = Path(raw).expanduser()
            if path.is_dir():
                return path.resolve()
    if is_settled_session(meta) or not meta.get('repoPath'):
        return run.resolve()
    return None


def _is_git_worktree(cwd):
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    try:
        result = subprocess.run(
            ['git', '-C', str(cwd), 'rev-parse', '--is-inside-work-tree'],
            capture_output=True, timeout=10, env=env,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0 and result.stdout.decode('utf-8', 'replace').strip() == 'true'


def _git_branch(cwd):
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    result = subprocess.run(
        ['git', '-C', str(cwd), 'symbolic-ref', '--short', 'HEAD'],
        capture_output=True, timeout=15, env=env,
    )
    if result.returncode == 0:
        return result.stdout.decode('utf-8', 'replace').strip()
    return git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD').decode('utf-8', 'replace').strip()


def _safe_participant_dir(repo_id, index):
    cleaned = re.sub(r'[^A-Za-z0-9._-]+', '-', str(repo_id or '')).strip('.-')
    return cleaned[:64] or ('repo-%d' % index)


def _participant_checkouts(meta, primary_cwd):
    repositories = meta.get('repositories')
    if not isinstance(repositories, list) or len(repositories) <= 1:
        return []
    seen = {primary_cwd} if primary_cwd is not None else set()
    extras = []
    for index, entry in enumerate(repositories):
        if not isinstance(entry, dict):
            continue
        worktree = entry.get('worktree') if isinstance(entry.get('worktree'), dict) else {}
        raw = worktree.get('path') or entry.get('repoPath') or entry.get('mainRepoPath')
        if not isinstance(raw, str) or not raw.strip():
            continue
        candidate = Path(raw).expanduser()
        if not candidate.is_dir():
            continue
        resolved = candidate.resolve()
        if resolved in seen or not _is_git_worktree(resolved):
            continue
        seen.add(resolved)
        extras.append({
            'id': str(entry.get('id') or ('repo-%d' % index)),
            'dirName': _safe_participant_dir(entry.get('id'), index),
            'path': resolved,
            'branch': entry.get('branch') if isinstance(entry.get('branch'), str) else None,
        })
    return extras


def _snapshot_git_workspace(cwd, folder, expected_branch=None, *, size_budget=MAX_CHECKPOINT_BYTES):
    head = git(cwd, 'rev-parse', 'HEAD').decode().strip()
    branch = _git_branch(cwd)
    if expected_branch and branch != expected_branch:
        raise RescueError('The checkout branch changed; reconcile it before rescuing.')
    state = git(cwd, 'status', '--porcelain=v1', '-z')
    staged = git(cwd, 'diff', '--cached', '--binary', '--full-index')
    unstaged = git(cwd, 'diff', '--binary', '--full-index')
    paths = git(cwd, 'ls-files', '--others', '--exclude-standard', '-z').split(b'\0')
    size = len(staged) + len(unstaged)
    untracked = {}
    for name in filter(None, paths):
        path = cwd / os.fsdecode(name)
        size += path.lstat().st_size
        if size > size_budget:
            raise RescueError('Unfinished changes exceed the 32 MiB rescue checkpoint limit. Save them before retrying.')
        untracked[os.fsdecode(name)] = file_digest(path)
    if size > size_budget:
        raise RescueError('Unfinished changes exceed the 32 MiB rescue checkpoint limit. Save them before retrying.')
    folder.mkdir(parents=True, mode=0o700, exist_ok=True)
    (folder / 'staged.patch').write_bytes(staged)
    (folder / 'unstaged.patch').write_bytes(unstaged)
    with tarfile.open(folder / 'untracked.tar', 'w', dereference=False) as archive:
        for name in filter(None, paths):
            relative = os.fsdecode(name)
            path = cwd / relative
            if not path.is_symlink() and not path.is_file():
                raise RescueError('An untracked special file cannot be checkpointed: ' + relative)
            archive.add(path, arcname=relative, recursive=False)
    return {
        'path': str(cwd),
        'head': head,
        'branch': branch,
        'status': state.decode('utf-8', 'replace'),
        'untracked': untracked,
    }, (state, head, staged, unstaged), size


def _verify_git_workspace(workspace, folder):
    cwd = Path(workspace['path'])
    paths = git(cwd, 'ls-files', '--others', '--exclude-standard', '-z').split(b'\0')
    live_untracked = {os.fsdecode(name): file_digest(cwd / os.fsdecode(name)) for name in paths if name}
    if (git(cwd, 'rev-parse', 'HEAD').decode().strip() != workspace['head']
            or _git_branch(cwd) != workspace['branch']
            or git(cwd, 'status', '--porcelain=v1', '-z').decode('utf-8', 'replace') != workspace['status']
            or git(cwd, 'diff', '--cached', '--binary', '--full-index') != (folder / 'staged.patch').read_bytes()
            or git(cwd, 'diff', '--binary', '--full-index') != (folder / 'unstaged.patch').read_bytes()
            or live_untracked != workspace['untracked']):
        raise RescueError('The workspace changed after checkpointing. Rescue again before continuing.')


def write_json(path, value):
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.rescue-')
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(value, handle, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def git(cwd, *args):
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    result = subprocess.run(['git', '-C', str(cwd), *args], capture_output=True,
                            timeout=15, env=env)
    if result.returncode:
        raise RescueError('Could not inspect the checkout: ' + result.stderr.decode('utf-8', 'replace')[:300])
    return result.stdout


def file_digest(path):
    if path.is_symlink():
        return {'symlink': os.readlink(path)}
    if not path.is_file():
        raise RescueError('An untracked special file cannot be checkpointed: ' + str(path))
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(65536), b''):
            digest.update(block)
    return {'sha256': digest.hexdigest(), 'mode': path.stat().st_mode}


def validate_checkpoint(path):
    saved = json.loads(path.read_text())
    if set(saved.get('files') or {}) != {'staged.patch', 'unstaged.patch', 'untracked.tar', 'context.md'}:
        raise RescueError('The rescue checkpoint is incomplete.')
    for name, digest in saved['files'].items():
        artifact = path.parent / name
        if artifact.is_symlink() or artifact.parent != path.parent or hashlib.sha256(artifact.read_bytes()).hexdigest() != digest:
            raise RescueError('Rescue checkpoint contents changed. Inspect it before continuing.')
    workspace = saved.get('workspace')
    if isinstance(workspace, dict) and workspace.get('path'):
        _verify_git_workspace(workspace, path.parent)
    for extra in saved.get('workspaces') or ():
        if not isinstance(extra, dict) or not extra.get('path') or not extra.get('dirName'):
            raise RescueError('The rescue checkpoint is incomplete.')
        part_folder = (path.parent / 'participants' / extra['dirName']).resolve()
        if not part_folder.is_relative_to((path.parent / 'participants').resolve()):
            raise RescueError('The rescue checkpoint is incomplete.')
        extra_files = extra.get('files') or {}
        if set(extra_files) != {'staged.patch', 'unstaged.patch', 'untracked.tar'}:
            raise RescueError('The rescue checkpoint is incomplete.')
        for name, digest in extra_files.items():
            artifact = part_folder / name
            if artifact.is_symlink() or artifact.parent != part_folder or hashlib.sha256(artifact.read_bytes()).hexdigest() != digest:
                raise RescueError('Rescue checkpoint contents changed. Inspect it before continuing.')
        _verify_git_workspace(extra, part_folder)


def require_no_detached_workers(run):
    state = headless_session._read_state(run)
    if not state or not headless_session._turn_process_alive(state):
        return
    processes = run_session.process_group_snapshot()
    if not processes or state['pid'] not in processes:
        raise RescueError('Could not inspect the old worker process tree. Retry before switching.')
    descendants = {state['pid']}
    while True:
        children = {pid for pid, row in processes.items() if row['parentPid'] in descendants}
        if children.issubset(descendants):
            break
        descendants.update(children)
    group = processes[state['pid']]['processGroup']
    detached = sorted(pid for pid in descendants if processes[pid]['processGroup'] != group)
    if detached:
        raise RescueError('Stop the old session\'s detached background commands before rescuing. Process IDs: '
                          + ', '.join(map(str, detached)))


def _initial_prompt(run, items):
    for index, item in enumerate(items):
        if not isinstance(item, dict) or item.get('kind') != 'user':
            continue
        prompt_file = item.get('promptFile') if isinstance(item.get('promptFile'), dict) else {}
        raw = (prompt_file.get('body') or item.get('text') or '').strip()
        if raw:
            return index, (run_chat.prompt_file_body(raw) or raw).strip()
    start_file = run / 'inputs' / 'start-prompt.txt'
    if start_file.is_file() and not start_file.is_symlink():
        raw = start_file.read_text('utf-8', 'replace').strip()
        if raw:
            return None, (run_chat.prompt_file_body(raw) or raw).strip()
    return None, ''


def _format_command_entry(item):
    command = ' '.join(str(item.get('detail') or item.get('title') or '').splitlines()).strip()
    if not command:
        return None
    status = str(item.get('status') or 'done')
    exit_code = item.get('exitCode')
    badge = '%s, exit %d' % (status, exit_code) if isinstance(exit_code, int) else status
    header = '- [%s] %s' % (badge, command[:300] + ('…' if len(command) > 300 else ''))
    output = str(item.get('output') or '').strip()
    if not output:
        return header
    excerpt = ('…' + output[-599:].lstrip()) if len(output) > 600 else output
    indented = '\n'.join('  ' + line for line in excerpt.splitlines()[-12:])
    return header + '\n' + indented


def _select_command_results(items):
    candidates = []
    for index, item in enumerate(items):
        if not isinstance(item, dict) or item.get('kind') != 'tool' or item.get('category') != 'command':
            continue
        formatted = _format_command_entry(item)
        if not formatted:
            continue
        status = item.get('status')
        exit_code = item.get('exitCode')
        failed = status in ('error', 'interrupted', 'declined') or (isinstance(exit_code, int) and exit_code != 0)
        command = str(item.get('detail') or item.get('title') or '')
        priority = 2 if failed else (1 if CHECK_COMMAND_RE.search(command) else 0)
        candidates.append((priority, index, formatted))
    budget = COMMAND_RESULTS_BUDGET
    chosen = []
    for _priority, index, formatted in sorted(candidates, key=lambda row: (row[0], row[1]), reverse=True):
        entry = formatted[:budget]
        if not entry:
            break
        if len(entry) < len(formatted) and chosen:
            continue
        chosen.append((index, entry))
        budget -= len(entry) + 1
        if budget <= 0:
            break
    chosen.sort(key=lambda row: row[0])
    return [entry for _index, entry in chosen], len(candidates) - len(chosen)


def _conversation_sections(run, conversation, retained_transcript=None):
    items = [item for item in list(conversation or ()) if isinstance(item, dict)]
    lines = []
    first_index, initial_text = _initial_prompt(run, items)
    if initial_text:
        excerpt = initial_text[:INITIAL_PROMPT_BUDGET]
        lines += ['## Initial prompt', '', excerpt, '']
        if len(initial_text) > len(excerpt):
            lines += ['Excerpt only. Read inputs/start-prompt.txt or the retained transcript for the full prompt.', '']

    selected_commands, omitted_commands = _select_command_results(items)
    lines += ['## Key check and command results', '']
    if selected_commands:
        lines.extend(selected_commands)
        lines.append('')
    else:
        lines += ['No command results recorded in the prior transcript.', '']

    message_rows = [
        (index, item)
        for index, item in enumerate(items)
        if isinstance(item.get('text'), str)
        and item.get('kind') in ('assistant', 'user', 'error', 'notice')
    ]
    budget = RECENT_CONVERSATION_BUDGET
    recent = []
    included_indices = set()
    for index, item in reversed(message_rows):
        if index == first_index and initial_text and len(message_rows) > 1 and budget < len(item['text']):
            continue
        text = item['text'][:min(4000, budget)]
        if not text:
            break
        recent.append('%s: %s' % (item['kind'], text))
        included_indices.add(index)
        budget -= len(text)
        if budget <= 0:
            break
    omitted_messages = sum(
        1 for index, _item in message_rows
        if index not in included_indices and not (index == first_index and initial_text)
    )
    lines += ['## Recent conversation', '']
    if recent:
        lines.extend(reversed(recent))
        lines.append('')
    else:
        lines += ['No conversation turns recorded yet.', '']

    lookup_sources = []
    if retained_transcript:
        lookup_sources.append(str(retained_transcript))
    lookup_sources.append(str(run / headless_session.STATE_DIR))
    lookup_sources.append(str(run / 'decisions.jsonl'))
    if omitted_messages or omitted_commands:
        lines += [
            '## Omitted history',
            '',
            'Budgeted handoff omitted %d earlier message(s) and %d command result(s) between the initial prompt '
            'and the recent tail. Look up full prior history on demand in: %s.'
            % (omitted_messages, omitted_commands, ', '.join(lookup_sources)),
            '',
        ]
    elif retained_transcript:
        lines += [
            'Full prior session transcript retained for on-demand lookup at: %s.' % retained_transcript,
            '',
        ]
    return lines


def checkpoint(run, meta, token, conversation, recovery_notes=None,
               previous_session_id=None, retained_transcript=None, cwd=None):
    settled = is_settled_session(meta)
    resolved_cwd = Path(cwd).expanduser().resolve() if cwd else _resolve_cwd(run, meta)
    folder = run / 'rescues' / token
    folder.mkdir(parents=True, mode=0o700, exist_ok=True)
    has_git_workspace = (
        not settled
        and resolved_cwd is not None
        and resolved_cwd.is_dir()
        and _is_git_worktree(resolved_cwd)
    )
    workspace_record = None
    primary_snapshot = None
    total_size = 0
    if has_git_workspace:
        expected_branch = meta.get('branch') if meta.get('branch') else None
        workspace_record, primary_snapshot, total_size = _snapshot_git_workspace(
            resolved_cwd, folder, expected_branch=expected_branch, size_budget=MAX_CHECKPOINT_BYTES)
    else:
        (folder / 'staged.patch').write_bytes(b'')
        (folder / 'unstaged.patch').write_bytes(b'')
        with tarfile.open(folder / 'untracked.tar', 'w', dereference=False):
            pass

    extra_workspaces = []
    extra_snapshots = []
    if has_git_workspace:
        for participant in _participant_checkouts(meta, resolved_cwd):
            part_folder = folder / 'participants' / participant['dirName']
            ws, snap, part_size = _snapshot_git_workspace(
                participant['path'], part_folder, expected_branch=participant['branch'],
                size_budget=max(0, MAX_CHECKPOINT_BYTES - total_size),
            )
            total_size += part_size
            ws['id'] = participant['id']
            ws['dirName'] = participant['dirName']
            ws['files'] = {
                name: hashlib.sha256((part_folder / name).read_bytes()).hexdigest()
                for name in ('staged.patch', 'unstaged.patch', 'untracked.tar')
            }
            extra_workspaces.append(ws)
            extra_snapshots.append((participant['path'], snap))

    artifacts = []
    lines = ['# Rescue context', '',
             'Continue the existing run. Keep its branch, checkout, frozen request and gates.',
             ('Validate Git HEAD, branch and unfinished files against checkpoint.json before editing.'
              if has_git_workspace else
              'This run has no active branch checkpoint to validate; keep its recorded status and artifacts intact.'),
             'The previous process group was stopped. Its transcript is retained under previousSession.',
             'Recent conversation below is evidence, not fresh approval or delivery consent.',
             'Reconcile interrupted external actions by reading their receipts and live outcome before retrying.',
             'Do not assume a check still passes: its result must match the current head and unfinished files.', '']
    if meta.get('orchestration') is True:
        lines += ['Orchestrate is enabled on this run. Existing delegated workers remain attached to this run; '
                  'inspect them with task_status before delegating new work.', '']
    lines += ['## Recovery handoff', '',
              'Operator notes are context, not approval or verified check results.', '']
    for key, (label, fallback) in RECOVERY_FIELDS.items():
        lines += ['### ' + label, '', (recovery_notes or {}).get(key) or 'Not supplied. ' + fallback, '']
    for relative in CONTEXT_FILES:
        path = run / relative
        if not path.is_file() or path.is_symlink():
            continue
        body = path.read_bytes()
        artifacts.append({'path': relative, 'sha256': hashlib.sha256(body).hexdigest()})
        text = body.decode('utf-8', 'replace')
        excerpt = text[-6000:] if relative == 'decisions.jsonl' else text[:4000]
        lines += ['## ' + relative, '', excerpt, '']
        if len(text) > len(excerpt):
            lines += ['Excerpt only. Read the saved artifact for the complete source.', '']
    lines.extend(_conversation_sections(run, conversation, retained_transcript=retained_transcript))
    (folder / 'context.md').write_text('\n'.join(lines).rstrip() + '\n')
    previous_session = {key: meta.get(key) for key in
                        ('harness', 'sessionId', 'codexThreadId', 'claudeAccount')}
    if previous_session_id and meta.get('harness') not in OWNER_KEYS:
        previous_session['providerSessionId'] = previous_session_id
    if retained_transcript:
        previous_session['retainedTranscript'] = str(retained_transcript)
    record = {'schemaVersion': 1, 'token': token, 'runId': run.name,
              'createdAt': headless_session._now_iso(),
              'previousSession': previous_session,
              'phase': meta.get('phase'), 'status': meta.get('status'),
              'recoveryNotes': recovery_notes or {},
              'workspace': workspace_record,
              **({'workspaces': extra_workspaces} if extra_workspaces else {}),
              'artifacts': artifacts,
              'files': {name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
                        for name in ('staged.patch', 'unstaged.patch', 'untracked.tar', 'context.md')}}
    write_json(folder / 'checkpoint.json', record)
    if primary_snapshot is not None:
        state, head, staged, unstaged = primary_snapshot
        if (git(resolved_cwd, 'status', '--porcelain=v1', '-z') != state
                or git(resolved_cwd, 'rev-parse', 'HEAD').decode().strip() != head
                or git(resolved_cwd, 'diff', '--cached', '--binary', '--full-index') != staged
                or git(resolved_cwd, 'diff', '--binary', '--full-index') != unstaged):
            raise RescueError('The checkout changed during the checkpoint. Stop other writers and retry.')
    for part_cwd, (state, head, staged, unstaged) in extra_snapshots:
        if (git(part_cwd, 'status', '--porcelain=v1', '-z') != state
                or git(part_cwd, 'rev-parse', 'HEAD').decode().strip() != head
                or git(part_cwd, 'diff', '--cached', '--binary', '--full-index') != staged
                or git(part_cwd, 'diff', '--binary', '--full-index') != unstaged):
            raise RescueError('A participant checkout changed during the checkpoint. Stop other writers and retry.')
    validate_checkpoint(folder / 'checkpoint.json')
    return folder / 'checkpoint.json'


def _retain_previous_transcript(run, meta, token, previous_session_id, stub):
    source_harness = meta.get('harness') or ('claude' if meta.get('sessionId') else None)
    if stub or not source_harness:
        return None
    if source_harness in harnesses.CORE_AGENTS:
        if not previous_session_id:
            return None
        return run_chat.locate(source_harness, previous_session_id) or run_chat.saved_conversation(meta)
    prior_path = Path(headless_session.harness_transcript(str(run), source_harness))
    if not prior_path.is_file() or not prior_path.stat().st_size:
        return None
    folder = run / 'rescues' / token
    folder.mkdir(parents=True, mode=0o700, exist_ok=True)
    target = folder / 'previous-transcript.jsonl'
    shutil.copyfile(prior_path, target)
    return target


def _release_follow_ups_locked(run):
    """Let the queue carry on with the new session, as Resume queue would.

    A switch is an explicit "carry on", so it clears the old session's failed
    send and lifts a Stop hold. A pause the user or the run queue chose
    (``runPause``, ``focusPaused``) stays in force. The caller holds the queue lock.
    An uncertain delivery stays held too. Return True while either hold remains.
    """
    path = run / 'follow-ups.json'
    if not path.is_file() or path.is_symlink():
        return False
    try:
        state = json.loads(path.read_text())
    except (OSError, ValueError):
        return False
    if not isinstance(state, dict):
        return False
    if follow_up_queue.projection(state) == 'uncertain':
        return True
    paused = bool(state.get('held') and (state.get('runPause') or state.get('focusPaused')))
    keys = ('lastError', 'lastAttemptAt') if paused else ('held', 'lastError', 'lastAttemptAt')
    if not any(key in state for key in keys):
        return paused
    for key in keys:
        state.pop(key, None)
    try:
        follow_up_queue.write(path, state, 'edit' if paused else 'resume',
                              caller='session rescue')
    except OSError:
        pass
    return paused


def _stop_legacy_session(run, meta):
    """Best-effort cleanup when replacing a non-headless (herdr/tmux) session."""
    if meta.get('herdrTab'):
        try:
            import run_herdr
            config_dir = str(run.parent.parent)
            if os.path.exists(run_herdr.session_socket(config_dir)):
                run_herdr.close_tab(config_dir, meta['herdrTab'])
        except Exception:
            pass


def rescue(run_dir, *, agent, extra_args, claude_account=None, expected_owner=None,
           expected_generation=None, conversation=None, recovery_notes=None, user_prompt=None, on_exit=None):
    recovery_notes = normalize_recovery_notes(recovery_notes)
    cleaned_prompt = normalize_user_prompt(user_prompt)
    run = Path(run_dir).resolve()
    if agent not in headless_session.AGENTS or not headless_session.available(agent):
        raise RescueError('The selected agent is unavailable.')
    target_module = harnesses.get(agent)
    if agent not in harnesses.CORE_AGENTS and target_module is None:
        raise RescueError(harnesses.refusal(agent))
    if claude_account is not None and (agent != 'claude' or claude_account not in claude_accounts.available()):
        raise RescueError('Unknown Claude account.')
    with follow_up_queue.lock(run), headless_session.control_lock(run):
        meta = run_lifecycle.Snapshot(json.loads((run / 'meta.json').read_text()))
        source_harness = meta.get('harness') or ('claude' if meta.get('sessionId') else None)
        if source_harness and not harnesses.known(source_harness):
            raise RescueError('Unknown run harness: %s' % source_harness)
        old_module = harnesses.get(source_harness) if source_harness else None
        old_rescue = meta.get('sessionRescue') or {}
        if expected_owner != owner(meta) or expected_generation != old_rescue.get('token'):
            raise RescueError('The session changed. Refresh Run Control before rescuing again.')
        if meta.get('remote') is True:
            raise RescueError('Remote runs cannot switch models from this computer.')
        if meta.get('route') == 'orchestration-worker':
            raise RescueError('Delegated worker sessions are managed by their coordinator.')
        if meta.get('status') == 'merged-to-parent':
            raise RescueError('Runs merged into a parent cannot switch sessions.')
        if meta.get('outcome') and meta.get('outcome') not in OPEN_OUTCOMES:
            raise RescueError('Closed runs cannot switch sessions.')
        if (meta.get('mergeConflict') or meta.get('mergeOperation')
                or meta.get('deliveryOperation')
                or meta.get('status') in ('merging', 'merging-to-parent')):
            raise RescueError('Reconcile the pending delivery or merge before rescuing.')
        was_headless = headless_session.is_headless(meta)
        prior_turn = headless_session.turn_state(run) if was_headless else None
        was_running = bool(prior_turn and prior_turn.get('state') == 'running')
        last_turn_failed = bool(prior_turn and prior_turn.get('outcome') == 'failed') or bool(meta.get('launchFailure'))
        stub_candidate = unstarted_stub(meta) and was_headless
        stub = False
        launch_arguments = None
        if stub_candidate:
            if first_launch_failed(run, meta):
                if recovery_notes:
                    raise RescueError('This launch never started, so it has no recovery handoff. Omit the notes.')
                try:
                    launch_arguments = reserved_launch_args(run)
                except OSError as exc:
                    raise RescueError('The launch brief is unavailable.') from exc
                stub = True
            else:
                existing_items = (
                    run_chat.timeline(meta, harness_run_dir=str(run)).get('items', ())
                    if conversation is None else conversation
                )
                if not was_running and not existing_items:
                    raise RescueError('A launch that has not started moves to another agent only after its first turn failed.')
        resolved_cwd = _resolve_cwd(run, meta)
        if resolved_cwd is None:
            raise RescueError('The run checkout is unavailable.')
        previous = dict(meta)
        token = secrets.token_hex(12)
        operation = {'token': token, 'state': 'stopping', 'agent': agent,
                     'startedAt': headless_session._now_iso()}
        meta['sessionRescue'] = operation
        run_lifecycle.write_meta(run / 'meta.json', meta, caller='session rescue')
        try:
            if was_headless:
                require_no_detached_workers(run)
                if headless_session.interrupt(run) not in ('stopped', 'idle'):
                    raise RescueError('The old worker did not stop. No replacement was launched.')
            else:
                _stop_legacy_session(run, previous)
            # A killed worker may have written metadata while Stop was in flight.
            meta = run_lifecycle.Snapshot(json.loads((run / 'meta.json').read_text()))
            if owner(meta) != owner(previous):
                raise RescueError('The run changed while stopping. Inspect it before retrying.')
            if (meta.get('mergeConflict') or meta.get('mergeOperation')
                    or meta.get('deliveryOperation')
                    or meta.get('status') in ('merging', 'merging-to-parent', 'merged-to-parent')):
                raise RescueError('The run changed while stopping. Inspect it before retrying.')
            if (meta.get('status') != previous.get('status')
                    and meta.get('status') not in ('running', 'awaiting-gate', 'escalated', *SETTLED_STATUSES)):
                raise RescueError('The run changed while stopping. Inspect it before retrying.')
            if old_module is not None:
                old_module.sync_transcript(str(run), final=True, strict=True)
            previous_key = OWNER_KEYS.get(source_harness)
            previous_session_id = (
                previous.get(previous_key) if previous_key
                else (old_module.session_id(str(run))
                      if old_module is not None and hasattr(old_module, 'session_id') else None)
            )
            retained_transcript = _retain_previous_transcript(
                run, previous, token, previous_session_id, stub)
            items = (
                (() if stub else run_chat.timeline(previous, harness_run_dir=str(run)).get('items', ()))
                if conversation is None else conversation
            )
            meta['sessionRescue'] = operation
            operation['state'] = 'preparing'
            run_lifecycle.write_meta(run / 'meta.json', meta, caller='session rescue')
            if stub:
                # Nothing ran in the checkout, so there is no workspace to checkpoint.
                (run / 'rescues' / token).mkdir(parents=True, mode=0o700, exist_ok=True)
                saved = run / 'rescues' / token / 'previous-launch.json'
                relative = None
                record = {'previousLaunch': str(saved.relative_to(run))}
            else:
                saved = checkpoint(run, meta, token, items, recovery_notes,
                                   previous_session_id, retained_transcript, cwd=resolved_cwd)
                relative = str(saved.relative_to(run))
                record = {'checkpoint': relative}
            launch = headless_session.read_launch(run) or {}
            write_json(saved.with_name('previous-launch.json'), launch)
            launch_effort_val = run_chat.launch_effort(extra_args)
            launch_fast_val = run_chat.launch_fast(extra_args)
            launch_model = run_chat.launch_model(extra_args)
            target_claude_account = (claude_account or claude_accounts.DEFAULT) if agent == 'claude' else None
            switched_to = {
                'harness': agent,
                **({'model': launch_model} if launch_model else {}),
                **({'effort': launch_effort_val} if launch_effort_val else {}),
                **({'fast': launch_fast_val} if launch_fast_val else {}),
                **({'claudeAccount': target_claude_account} if target_claude_account else {}),
            }
            history = list(meta.get('sessionHistory') or [])
            history.append({
                **{key: previous.get(key) for key in ('harness', 'sessionId', 'codexThreadId', 'claudeAccount')},
                **({'providerSessionId': previous_session_id}
                   if previous_session_id and source_harness not in OWNER_KEYS else {}),
                **({'retainedTranscript': str(retained_transcript)} if retained_transcript else {}),
                'state': 'superseded',
                'token': token,
                'switchedTo': switched_to,
                **record,
                'supersededAt': headless_session._now_iso(),
            })
            if previous_session_id and source_harness:
                retired = session_paths.retired_session_path(
                    run.parent.parent, source_harness, previous_session_id)
                retired.parent.mkdir(mode=0o700, exist_ok=True)
                write_json(retired, {'schemaVersion': 1, 'runId': run.name,
                                    'harness': source_harness,
                                    'sessionId': previous_session_id, 'checkpoint': relative})
            meta['sessionHistory'] = history
            for key in ('sessionId', 'codexThreadId', 'forkSessionFrom', 'claudeAccount',
                        'launchModel', 'sessionOperation', 'launchFailure', 'launchPermissionFallback',
                        *LEGACY_SESSION_KEYS):
                meta.pop(key, None)
            meta['harness'] = agent
            meta['sessionBackend'] = 'headless'
            meta['launchEffort'] = launch_effort_val
            meta['launchFast'] = launch_fast_val
            if launch_model:
                meta['launchModel'] = launch_model
            if agent == 'claude':
                meta['sessionId'] = str(uuid.uuid4())
                meta['claudeAccount'] = target_claude_account
            old_turn = headless_session.turn_state(run) or {}
            first_turn = old_turn.get('turn', 0) + 1
            operation.update(state='ready', firstTurn=first_turn, targetHarness=agent,
                             **({'checkpoint': relative} if relative else {}))
            run_lifecycle.write_meta(run / 'meta.json', meta, caller='session rescue')
            if not session_identity.remember_launch_identity(meta, str(run)):
                raise RescueError('Could not save the replacement session identity.')
            cwd = str(resolved_cwd)
            headless_session.save_launch(run, agent=agent, cwd=cwd, extra_args=extra_args,
                                         claude_account=claude_account, first_turn=first_turn)
            if target_module is not None:
                target_module.sync_transcript(str(run))
            settled = is_settled_session(meta)
            should_start_turn = stub or not settled or bool(cleaned_prompt) or was_running or last_turn_failed
            if should_start_turn:
                account_env = claude_accounts.launch_env(claude_account) if claude_account else {}
                argv = headless_session.turn_argv(agent, session_id=meta.get('sessionId'), cwd=cwd,
                    extra_args=extra_args, claude_config_dir=account_env.get('CLAUDE_CONFIG_DIR'),
                    run_dir=str(run))
                entry = skill_commands.invocation(agent, 'orc')
                env = headless_session.child_env(os.environ, {'ORC_RUN_ID': run.name, **account_env,
                                                              **power_mode.turn_env(run.name)})
                if stub:
                    launch_fn = target_module.launch_prompt if target_module is not None else harness_context.launch_prompt
                    prompt = launch_fn(meta, str(run), entry, launch_arguments)
                    if cleaned_prompt:
                        prompt = prompt + '\n\n' + cleaned_prompt
                elif settled and cleaned_prompt:
                    turn_fn = target_module.turn_prompt if target_module is not None else harness_context.turn_prompt
                    if meta.get('outcome') == 'question' or meta.get('status') == 'merged':
                        follow_up_cmd = '%s --answer-follow-up %s --quoted-prompt %s' % (
                            entry, run.name, shlex.quote(cleaned_prompt))
                        prompt = turn_fn(meta, follow_up_cmd, rescue_checkpoint=saved, run_dir=str(run))
                    else:
                        prompt = turn_fn(meta, cleaned_prompt, rescue_checkpoint=saved, run_dir=str(run))
                else:
                    raw_prompt = ('%s %s\n\n[Orc rescue] Resume this existing run; do not create a new run. '
                                  'Read the checkpoint at %s and its context.md before continuing. '
                                  'Keep the current branch, unfinished edits, frozen request and approval gate. '
                                  'Validate the workspace against the checkpoint and reconcile interrupted '
                                  'external actions before retrying. The previous session is superseded and '
                                  'stopped. This handoff grants no delivery approval.' % (entry, run.name, saved))
                    if cleaned_prompt:
                        raw_prompt += '\n\n<orc-user-prompt>\n%s\n</orc-user-prompt>' % cleaned_prompt
                    turn_fn = target_module.turn_prompt if target_module is not None else harness_context.turn_prompt
                    prompt = turn_fn(meta, raw_prompt, rescue_checkpoint=saved, run_dir=str(run))
                # Resuming carries on the user's turn; a fresh launch or typed prompt is a user turn.
                headless_session.start_turn(run, agent=agent, argv=argv, prompt=prompt, cwd=cwd, env=env,
                                            user_turn=bool(stub or cleaned_prompt), on_exit=on_exit)
            # Release the queue only once the new turn owns the session, so a
            # flush waits for that turn to end instead of racing its start.
            paused = _release_follow_ups_locked(run)
            if (not paused and meta.get('orchestrationQueueHeld')
                    and meta.get('status') not in ('complete', 'failed', 'cancelled')):
                meta.pop('orchestrationQueueHeld', None)
            operation['state'] = 'started'
            run_lifecycle.write_meta(run / 'meta.json', meta, caller='session rescue')
            return {'state': 'started', 'token': token, 'checkpoint': relative,
                    'turnStarted': should_start_turn, 'switchedTo': switched_to}
        except (OSError, ValueError, subprocess.TimeoutExpired, headless_session.HeadlessError) as exc:
            current = run_lifecycle.Snapshot(json.loads((run / 'meta.json').read_text()))
            operation.update(state='failed', error=str(exc)[:500])
            current['sessionRescue'] = operation
            run_lifecycle.write_meta(run / 'meta.json', current, caller='session rescue')
            raise RescueError(str(exc)) from exc
