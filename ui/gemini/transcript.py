import contextlib
from datetime import datetime, timezone
import json
import os
import re
from pathlib import Path
import sqlite3
import tempfile
import threading

import headless_session
import headless_transcript
import model_prices

# Antigravity's own record of each conversation. It keeps growing while the
# agent works even after the stream-json output Orc reads has gone quiet.
BRAIN = Path.home() / '.gemini' / 'antigravity-cli' / 'brain'
CONVERSATION = re.compile(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\Z')
EFFORT_SUFFIX = re.compile(r'^(gemini-[a-z0-9._-]+|claude-[a-z0-9._-]+)-(low|medium|high|xhigh|max)\Z')
SUBAGENT_CONVERSATION = re.compile(r'"conversationId"\s*:\s*"([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})"')
SYSTEM_SENDER = re.compile(r'\[Message\][^\n]*?\bsender=([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})\b')
TASK_STARTED = re.compile(r'running as a background task with task id: (\S+)')
TASK_ENDED = re.compile(r'Task id "([^"]+)" (?:finished|was canceled) with result')
# Tools that leave the agent waiting on something besides a background task.
WAITING_TOOLS = frozenset({'schedule', 'invoke_subagent', 'manage_subagents', 'send_message', 'swarm_wait'})
ROLE_WORKER_NAME = re.compile(r'^(narrator|monitor)(?:-\d+)?$')
BOARD_MENTION = re.compile(r'(?<![A-Za-z0-9_])@([A-Za-z0-9_-]+)')
WORKFLOW_PHASE = re.compile(r'^- \[phase\]\s+(.+)$')
WORKFLOW_AGENT = re.compile(
    r'^- \[agent:([^\]]+)\]\s+(.+?):\s+(done|failed|error|running|cancelled|interrupted)\s+'
    r'\(([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})\)(?::\s*(.*))?$'
)
WORKFLOW_CREATED = re.compile(r'^Created At:\s*(\S+)', re.MULTILINE)
WORKFLOW_COMPLETED = re.compile(r'^Completed At:\s*(\S+)', re.MULTILINE)
WORKFLOW_FAILED = re.compile(r'^Workflow\s+"[^"]*"\s+failed\b', re.MULTILINE)
USER_REQUEST_BLOCK = re.compile(r'<USER_REQUEST>\s*(.*?)\s*</USER_REQUEST>', re.DOTALL)
SETTLED = 'orc_settled'
# The marker run_chat reads as a stopped turn.
INTERRUPTED = '[Request interrupted by user]'
BRIEF_LIMIT = 240
_BRAIN_CACHE_MAX = 64
_BRAIN_CACHE = {}
_BRAIN_LOCK = threading.Lock()


def split_model(raw):
    """Split a model id like ``gemini-4-neon-high`` into ``(model, effort)``."""
    if not isinstance(raw, str) or not raw.strip():
        return None, None
    slug = raw.strip()
    match = EFFORT_SUFFIX.fullmatch(slug)
    if match:
        return match.group(1), match.group(2)
    return slug, None


def _size(text):
    return len(text.encode('utf-8', 'replace')) if isinstance(text, str) else None


def _brief(text):
    if not isinstance(text, str):
        return None
    cleaned = ' '.join(text.split())
    return cleaned[:BRIEF_LIMIT] if cleaned else None


def _iso_stamp(value):
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    try:
        parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def _epoch(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def raw_transcript(run_dir, final=False, strict=False):
    return headless_transcript.sync(run_dir, 'gemini-raw', final=final, strict=strict)


def _object(value):
    return value if isinstance(value, dict) else {}


def empty_reply_permission_error(result):
    result = _object(result)
    response = result.get('response')
    denied = result.get('denied_actions')
    if result.get('status') != 'SUCCESS' or not isinstance(denied, list) or not denied:
        return None
    if isinstance(response, str) and response.strip():
        return None
    actions = ', '.join(dict.fromkeys(str(_object(item).get('action') or 'unknown tool') for item in denied))
    return 'Headless permission denied for %s. Gemini ended without a reply.' % actions


def _message(kind, uid, stamp, blocks, **extra):
    return dict(type=kind, uuid=uid, timestamp=stamp, message={'content': blocks}, **extra)


def _prompt_stamp(run_dir, turn, stamp):
    """When the turn started. Every event Orc reads in one pass carries that
    read's time, so a short turn's prompt would otherwise share its last
    step's time and the turn read as taking no time at all. Once the prompt
    file is pruned, ``stamp`` is the start the transcript already kept."""
    try:
        started = os.stat(headless_session._path(run_dir, headless_session._turn_name(turn, 'prompt'))).st_mtime
    except OSError:
        return stamp
    started = datetime.fromtimestamp(started, timezone.utc).isoformat().replace('+00:00', 'Z')
    return started if started < stamp else stamp


def _seconds(stamp):
    try:
        return datetime.strptime(stamp, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp()
    except (TypeError, ValueError):
        return None


def _turn_conversation(log):
    try:
        with open(log) as handle:
            event = json.loads(handle.readline())
    except (OSError, ValueError):
        return None
    conversation = _object(event).get('conversation_id')
    return conversation if isinstance(conversation, str) and CONVERSATION.fullmatch(conversation) else None


def _turn_pending_work(turn, allow_send_message=False):
    waiting = WAITING_TOOLS - {'send_message'} if allow_send_message else WAITING_TOOLS
    tasks = set()
    pending_calls = []
    pending_workflows = 0
    for record in turn:
        rtype = record.get('type')
        content = record.get('content') if isinstance(record.get('content'), str) else ''
        tasks.update(TASK_STARTED.findall(content))
        if rtype == 'SYSTEM_MESSAGE':
            tasks.difference_update(TASK_ENDED.findall(content))
        if rtype == 'PLANNER_RESPONSE':
            calls = record.get('tool_calls') or []
            if not isinstance(calls, list) or any(
                    not isinstance(call, dict) or call.get('name') in waiting for call in calls):
                return True
            for call in calls:
                cname = call.get('name')
                pending_calls.append(cname)
                if cname == 'run_workflow':
                    pending_workflows += 1
        elif rtype == 'GENERIC' and pending_calls:
            cname = pending_calls.pop(0)
            if cname == 'run_workflow' and (record.get('status') in ('DONE', 'ERROR') or TASK_STARTED.search(content)):
                pending_workflows = max(0, pending_workflows - 1)
    return bool(tasks) or pending_workflows > 0


def _brain_turn_open(records, allow_send_message=False):
    if not records:
        return True
    start = max((index for index, record in enumerate(records)
                 if record.get('type') == 'USER_INPUT'), default=-1)
    turn = records[start + 1:]
    reply = turn[-1] if turn else {}
    text = reply.get('content')
    if (reply.get('type') != 'PLANNER_RESPONSE' or reply.get('status') != 'DONE'
            or reply.get('tool_calls') or not isinstance(text, str) or not text.strip()):
        return True
    return _turn_pending_work(turn, allow_send_message=allow_send_message)


def brain_log(conversation_id):
    if not isinstance(conversation_id, str) or not CONVERSATION.fullmatch(conversation_id):
        return None
    try:
        root = BRAIN.resolve()
        logs = (BRAIN / conversation_id / '.system_generated' / 'logs').resolve()
    except OSError:
        return None
    if not logs.is_relative_to(root):
        return None
    for name in ('transcript_full.jsonl', 'transcript.jsonl'):
        path = logs / name
        if path.is_file():
            return path
    return None


def _brain_swarm_dir(conversation_id):
    if not isinstance(conversation_id, str) or not CONVERSATION.fullmatch(conversation_id):
        return None
    try:
        root = BRAIN.resolve()
        path = (BRAIN / conversation_id / '.system_generated' / 'swarm').resolve()
    except OSError:
        return None
    return path if path.is_relative_to(root) and path.is_dir() else None


def _board_time_iso(value):
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    try:
        parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
    except ValueError:
        return None
    parsed = parsed.astimezone(timezone.utc)
    return parsed.isoformat().replace('+00:00', 'Z')


def _read_swarm_roster(swarm_dir):
    if swarm_dir is None:
        return None
    path = swarm_dir / 'members.json'
    try:
        data = json.loads(path.read_text(encoding='utf-8', errors='replace'))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    members = _object(data.get('members'))
    return {'title': data.get('title') if isinstance(data.get('title'), str) else '', 'members': members}


def _read_swarm_board(swarm_dir):
    if swarm_dir is None:
        return []
    path = swarm_dir / 'board.jsonl'
    try:
        lines = path.read_text(encoding='utf-8', errors='replace').splitlines()
    except OSError:
        return []
    out = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if isinstance(msg, dict):
            out.append(msg)
    return out


def _swarm_role(name, member):
    raw = _object(member).get('role')
    if isinstance(raw, str) and raw.strip() and raw.strip() != 'worker':
        return raw.strip()
    match = ROLE_WORKER_NAME.fullmatch(str(name or ''))
    if match:
        return match.group(1)
    return raw.strip() if isinstance(raw, str) and raw.strip() else 'worker'


def _swarm_turn_ended(records):
    """Mirror swarm_board's turnEnded(): 'idle', 'error', or 'working'."""
    results = []
    saw_last = False
    for record in reversed(records):
        if not isinstance(record, dict):
            continue
        rtype = record.get('type')
        if not saw_last:
            saw_last = True
            if rtype == 'ERROR_MESSAGE':
                return 'error'
        if rtype == 'GENERIC':
            results.insert(0, record)
            continue
        if rtype != 'PLANNER_RESPONSE':
            return 'working'
        calls = record.get('tool_calls') or []
        if not calls:
            return 'idle' if not results and record.get('status') == 'DONE' else 'working'
        wait_idx = next((idx for idx, call in enumerate(calls)
                         if isinstance(call, dict) and call.get('name') == 'swarm_wait'), -1)
        if wait_idx >= 0 and len(results) >= len(calls) and results[wait_idx].get('status') == 'DONE':
            return 'idle'
        return 'working'
    return 'working'


def _has_active_swarm(conversation_id):
    roster = _read_swarm_roster(_brain_swarm_dir(conversation_id))
    if not roster:
        return False
    for name, member in roster['members'].items():
        if not isinstance(member, dict):
            continue
        if name == 'coordinator' or _swarm_role(name, member) == 'coordinator':
            continue
        cid = member.get('conversation_id')
        if cid == conversation_id or member.get('killed'):
            continue
        records = _read_brain_records(brain_log(cid)) if isinstance(cid, str) else []
        if records:
            if _swarm_turn_ended(records) == 'working':
                return True
        elif member.get('wake_mode') not in ('mentions', 'anything'):
            return True
    return False


def _has_active_children(conversation_id):
    for row in conversation_children(conversation_id):
        if row.get('killed'):
            continue
        if row.get('notFullyIdle') or row.get('status') not in ('', 'CASCADE_RUN_STATUS_IDLE'):
            return True
    return False


def _read_brain_records(path):
    if path is None:
        return []
    key = str(path)
    try:
        st = os.stat(path)
    except OSError:
        with _BRAIN_LOCK:
            _BRAIN_CACHE.pop(key, None)
        return []
    sig = (st.st_dev, st.st_ino, st.st_mtime_ns, st.st_size)
    with _BRAIN_LOCK:
        cached = _BRAIN_CACHE.get(key)
        if cached is not None and cached[0] == sig:
            return cached[1]
    records = []
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except ValueError:
                    continue
                if isinstance(record, dict):
                    records.append(record)
    except OSError:
        return []
    with _BRAIN_LOCK:
        if len(_BRAIN_CACHE) >= _BRAIN_CACHE_MAX:
            _BRAIN_CACHE.pop(next(iter(_BRAIN_CACHE)), None)
        _BRAIN_CACHE[key] = (sig, records)
    return records


def conversation_children(parent_id):
    if not isinstance(parent_id, str) or not CONVERSATION.fullmatch(parent_id):
        return []
    db = BRAIN.parent / 'conversation_summaries.db'
    if not db.is_file():
        return []
    try:
        with contextlib.closing(sqlite3.connect(db.as_uri() + '?mode=ro', uri=True, timeout=0.1)) as conn:
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if 'conversation_summaries' not in tables:
                return []
            if 'conversation_parents' in tables:
                query = """
                    WITH RECURSIVE children(id) AS (
                        SELECT conversation_id FROM conversation_summaries WHERE parent_conversation_id = ?
                        UNION
                        SELECT conversation_id FROM conversation_parents WHERE parent_id = ?
                        UNION
                        SELECT s.conversation_id FROM conversation_summaries s JOIN children c ON s.parent_conversation_id = c.id
                        UNION
                        SELECT p.conversation_id FROM conversation_parents p JOIN children c ON p.parent_id = c.id
                        LIMIT 128
                    )
                    SELECT s.conversation_id, s.agent_name, s.title, s.status, s.not_fully_idle, s.killed, s.last_modified_time
                    FROM conversation_summaries s JOIN children c ON s.conversation_id = c.id
                    WHERE s.conversation_id != ?
                """
                rows = conn.execute(query, (parent_id, parent_id, parent_id)).fetchall()
            else:
                query = """
                    WITH RECURSIVE children(id) AS (
                        SELECT conversation_id FROM conversation_summaries WHERE parent_conversation_id = ?
                        UNION
                        SELECT s.conversation_id FROM conversation_summaries s JOIN children c ON s.parent_conversation_id = c.id
                        LIMIT 128
                    )
                    SELECT s.conversation_id, s.agent_name, s.title, s.status, s.not_fully_idle, s.killed, s.last_modified_time
                    FROM conversation_summaries s JOIN children c ON s.conversation_id = c.id
                    WHERE s.conversation_id != ?
                """
                rows = conn.execute(query, (parent_id, parent_id)).fetchall()
    except (OSError, sqlite3.Error):
        return []
    return [{
        'id': row[0],
        'agentName': row[1] or '',
        'title': row[2] or '',
        'status': row[3] or '',
        'notFullyIdle': bool(row[4]),
        'killed': bool(row[5]),
        'updatedAt': _iso_stamp(row[6]),
    } for row in rows if isinstance(row[0], str) and CONVERSATION.fullmatch(row[0])]


def _planner_tokens(record):
    total = 0
    found = False
    for key in ('input_tokens', 'cache_read_tokens', 'output_tokens'):
        value = record.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
            total += int(value)
            found = True
    return total if found else None


def _extract_user_prompt(content):
    if not isinstance(content, str) or not content.strip():
        return None
    match = USER_REQUEST_BLOCK.search(content)
    text = match.group(1) if match else content
    suffix = '\n\nWhen you are done, call the finish tool with your result.'
    if text.endswith(suffix):
        text = text[:-len(suffix)]
    return text.strip() or None


def _child_brain_stats(conversation_id, active, db_row=None, billed=None):
    records = _read_brain_records(brain_log(conversation_id))
    model = None
    effort = None
    started = None
    updated = None
    tokens = None
    last_text = None
    finish_text = None
    first_prompt = None
    calls = []
    for idx, record in enumerate(records):
        at = _iso_stamp(record.get('created_at'))
        if at:
            started = started or at
            updated = at
        if first_prompt is None and record.get('type') in ('USER_INPUT', 'SYSTEM_MESSAGE'):
            first_prompt = _extract_user_prompt(record.get('content'))
        if record.get('type') != 'PLANNER_RESPONSE':
            continue
        raw_model = record.get('model')
        parsed_model, parsed_effort = split_model(raw_model)
        model = parsed_model or model
        effort = parsed_effort or effort
        step_tokens = _planner_tokens(record)
        if step_tokens is not None:
            tokens = (tokens or 0) + step_tokens
            if billed is not None and raw_model:
                usage = {
                    'input_tokens': record.get('input_tokens') or 0,
                    'cache_read_tokens': record.get('cache_read_tokens') or 0,
                    'output_tokens': record.get('output_tokens') or 0,
                }
                calls.append(('gemini:%s:%s' % (conversation_id, record.get('step_index', idx)),
                              {'at': at, 'model': raw_model, 'tokens': model_prices.claude_tokens(raw_model, usage)}))
        content = record.get('content')
        if isinstance(content, str) and content.strip():
            last_text = content
        for call in (record.get('tool_calls') or ()):
            if isinstance(call, dict) and call.get('name') == 'finish':
                res = _object(call.get('args') or call.get('arguments')).get('result')
                if isinstance(res, str) and res.strip():
                    finish_text = res
                elif res is not None:
                    finish_text = json.dumps(res)
    if billed is not None and calls:
        billed[conversation_id] = calls
    updated = updated or (db_row or {}).get('updatedAt')
    if db_row and db_row.get('killed'):
        status, ended = 'interrupted', updated
    elif db_row and db_row.get('status') == 'CASCADE_RUN_STATUS_IDLE' and not db_row.get('notFullyIdle'):
        status, ended = 'done', updated
    elif records and not _brain_turn_open(records, allow_send_message=True) and not (db_row and db_row.get('notFullyIdle')):
        status, ended = 'done', updated
    else:
        status, ended = ('running' if active else 'unknown'), None
    result_text = last_text or finish_text
    return {
        'model': model,
        'effort': effort,
        'startedAt': started,
        'updatedAt': updated,
        'endedAt': ended,
        'status': status,
        'tokens': tokens,
        'brief': _brief(first_prompt),
        'briefBytes': _size(first_prompt),
        'resultBytes': _size(result_text) if status in ('done', 'interrupted') and result_text else None,
    }


def _apply_plan_handoff(planner, executor, kind, text, at):
    if kind == 'exit_plan_mode':
        planner['endedAt'] = at
        if text:
            planner['resultBytes'] = _size(text)
        executor['seen'] = True
        executor['startedAt'] = executor.get('startedAt') or at
        executor['updatedAt'] = at
        executor['endedAt'] = None
        if executor.get('briefBytes') is None:
            if text:
                executor['brief'] = _brief(text)
                executor['briefBytes'] = _size(text)
        else:
            executor['messages'] = executor.get('messages', 0) + 1
            executor['messageBytes'] = executor.get('messageBytes', 0) + (_size(text) or 0)
            executor['messagedAt'] = at
            if text:
                executor['brief'] = _brief(text)
        return 'executor'
    if kind == 'enter_plan_mode':
        executor['endedAt'] = at
        if text:
            executor['resultBytes'] = _size(text)
        planner['seen'] = True
        planner['messages'] = planner.get('messages', 0) + 1
        if text:
            planner['messageBytes'] = planner.get('messageBytes', 0) + _size(text)
        planner['messagedAt'] = at
        planner['endedAt'] = None
        planner['updatedAt'] = at
        return 'planner'
    return None


def _orchestrator_rows(summary, parent_records, active):
    orchestrator_model = isinstance(summary.model, str) and summary.model.startswith('gemini-pro-orchestrator')
    has_brain_handoff = any(
        isinstance(call, dict) and call.get('name') in ('exit_plan_mode', 'enter_plan_mode')
        for record in parent_records
        if record.get('type') == 'PLANNER_RESPONSE'
        for call in (record.get('tool_calls') or ())
    )
    if not orchestrator_model and not summary.plan_handoffs and not has_brain_handoff:
        return []
    planner = {'id': 'orchestrator:planner', 'kind': 'orchestrator', 'name': 'Planner', 'role': 'Orchestrator',
               'status': 'unknown', 'seen': False}
    executor = {'id': 'orchestrator:executor', 'kind': 'orchestrator', 'name': 'Executor', 'role': 'Orchestrator',
                'status': 'unknown', 'seen': False}
    if parent_records:
        phase = 'planner'
        saw_user = False
        latest_brain_epoch = None
        for record in parent_records:
            rtype = record.get('type')
            at = _iso_stamp(record.get('created_at'))
            at_epoch = _epoch(at)
            if at_epoch is not None:
                latest_brain_epoch = max(latest_brain_epoch or at_epoch, at_epoch)
            if rtype == 'USER_INPUT':
                phase = 'planner'
                if executor['seen'] and executor.get('endedAt') is None:
                    executor['endedAt'] = executor.get('updatedAt') or at
                prompt = record.get('content')
                if isinstance(prompt, str):
                    if not saw_user:
                        planner['startedAt'] = planner.get('startedAt') or at
                        planner['updatedAt'] = at
                        if prompt.strip():
                            planner['brief'] = _brief(prompt)
                            planner['briefBytes'] = _size(prompt)
                    else:
                        planner['messages'] = planner.get('messages', 0) + 1
                        planner['messageBytes'] = planner.get('messageBytes', 0) + (_size(prompt) or 0)
                        planner['messagedAt'] = at
                        planner['endedAt'] = None
                        planner['updatedAt'] = at
                saw_user = True
            elif rtype == 'PLANNER_RESPONSE':
                target = planner if phase == 'planner' else executor
                target['seen'] = True
                model, effort = split_model(record.get('model'))
                target['model'] = model or target.get('model')
                target['effort'] = effort or target.get('effort')
                target['startedAt'] = target.get('startedAt') or at
                target['updatedAt'] = at
                step_tokens = _planner_tokens(record)
                if step_tokens is not None:
                    target['tokens'] = (target.get('tokens') or 0) + step_tokens
                for call in (record.get('tool_calls') or ()):
                    if not isinstance(call, dict):
                        continue
                    cname = call.get('name')
                    args = _object(call.get('args') or call.get('arguments') or call.get('parameters'))
                    text = args.get('plan') if cname == 'exit_plan_mode' else args.get('reason')
                    next_phase = _apply_plan_handoff(
                        planner, executor, cname, text if isinstance(text, str) else '', at)
                    if next_phase:
                        phase = next_phase
        turn_open = _brain_turn_open(parent_records)
        result_epoch = _epoch(summary.last_result_at)
        newer_after_result = (latest_brain_epoch is not None and result_epoch is not None
                              and latest_brain_epoch > result_epoch)
        turn_in_progress = turn_open and (summary.turn_active is not False or newer_after_result)
        live_turn = active and turn_in_progress
        if not turn_open:
            last_rec = parent_records[-1]
            final_text = last_rec.get('content')
            if isinstance(final_text, str) and final_text.strip():
                active_row = planner if phase == 'planner' else executor
                active_row['resultBytes'] = _size(final_text)
        out = []
        for role_name, row in (('planner', planner), ('executor', executor)):
            if not row.pop('seen', False):
                continue
            if live_turn and phase == role_name:
                row['status'] = 'running'
                row['endedAt'] = None
            elif not active and turn_in_progress and phase == role_name:
                row['status'] = 'unknown'
                row['endedAt'] = None
            else:
                row['status'] = 'done'
                row['endedAt'] = row.get('endedAt') or row.get('updatedAt')
            out.append(row)
        return out
    # Fallback when no Antigravity brain log exists on disk: reconstruct from stream-json handoffs.
    phase = 'planner'
    planner['seen'] = True
    planner['startedAt'] = summary.started
    planner['updatedAt'] = summary.updated
    for handoff in summary.plan_handoffs.values():
        next_phase = _apply_plan_handoff(
            planner, executor, handoff.get('kind'), handoff.get('text') or '', handoff.get('at'))
        if next_phase:
            phase = next_phase
    live_turn = active and summary.turn_active is True
    out = []
    for role_name, row in (('planner', planner), ('executor', executor)):
        if not row.pop('seen', False):
            continue
        if live_turn and phase == role_name:
            row['status'] = 'running'
            row['endedAt'] = None
        elif not active and summary.turn_active is True and phase == role_name:
            row['status'] = 'unknown'
            row['endedAt'] = None
        else:
            row['status'] = 'done'
            row['endedAt'] = row.get('endedAt') or row.get('updatedAt') or summary.updated
        out.append(row)
    return out


def _apply_brain_subagent_history(rows, parent_records):
    by_id = {row['id']: row for row in rows.values() if isinstance(row.get('id'), str)}
    pending_invokes = []
    sends_by_id = {}
    kills_by_id = {}
    results_by_id = {}
    for record in parent_records:
        rtype = record.get('type')
        at = _iso_stamp(record.get('created_at'))
        if rtype == 'PLANNER_RESPONSE':
            for call in (record.get('tool_calls') or ()):
                if not isinstance(call, dict):
                    continue
                cname = call.get('name')
                args = _object(call.get('args') or call.get('arguments') or call.get('parameters'))
                if cname == 'invoke_subagent':
                    pending_invokes.append((at, args))
                elif cname == 'send_message':
                    recipient = args.get('Recipient') or args.get('recipient')
                    msg = args.get('Message') or args.get('message')
                    if isinstance(recipient, str) and CONVERSATION.fullmatch(recipient) and isinstance(msg, str):
                        entry = sends_by_id.setdefault(recipient, {'messages': 0, 'messageBytes': 0, 'messagedAt': None})
                        entry['messages'] += 1
                        entry['messageBytes'] += _size(msg) or 0
                        entry['messagedAt'] = at
                elif cname == 'manage_subagents':
                    action = args.get('Action')
                    if action == 'kill':
                        for cid in (args.get('ConversationIds') or ()):
                            if isinstance(cid, str) and CONVERSATION.fullmatch(cid):
                                kills_by_id[cid] = at
                    elif action == 'kill_all':
                        for cid in list(by_id):
                            kills_by_id.setdefault(cid, at)
        elif rtype == 'GENERIC':
            content = record.get('content')
            if isinstance(content, str) and 'Created the following subagent' in content:
                match = SUBAGENT_CONVERSATION.search(content)
                if match:
                    cid = match.group(1)
                    started_at, args = pending_invokes.pop(0) if pending_invokes else (at, {})
                    row = by_id.get(cid)
                    if row is None:
                        row = {'id': cid, 'kind': 'subagent', 'status': 'running'}
                        rows[cid] = row
                        by_id[cid] = row
                    row['name'] = row.get('name') or args.get('Role') or args.get('TypeName') or ('Subagent ' + cid[:8])
                    row['role'] = row.get('role') or args.get('TypeName')
                    model_arg = args.get('Model')
                    if isinstance(model_arg, str) and model_arg and model_arg != 'inherit' and not row.get('model'):
                        row['model'] = model_arg
                    row['startedAt'] = row.get('startedAt') or started_at or at
                    prompt = args.get('Prompt')
                    if isinstance(prompt, str) and prompt.strip() and not row.get('briefBytes'):
                        row['brief'] = _brief(prompt)
                        row['briefBytes'] = _size(prompt)
        elif rtype == 'SYSTEM_MESSAGE':
            content = record.get('content')
            if isinstance(content, str):
                match = SYSTEM_SENDER.search(content)
                if match:
                    cid = match.group(1)
                    body = content.split('content=', 1)[1] if 'content=' in content else content
                    results_by_id[cid] = _size(body)
    for cid, send in sends_by_id.items():
        row = by_id.get(cid)
        if row is not None:
            row.update(send)
    for cid, killed_at in kills_by_id.items():
        row = by_id.get(cid)
        if row is not None:
            row['status'] = 'interrupted'
            row['endedAt'] = killed_at
    for cid, rbytes in results_by_id.items():
        row = by_id.get(cid)
        if row is not None and rbytes:
            row['resultBytes'] = rbytes


def _max_iso(*stamps):
    valid = [( _epoch(s), s ) for s in stamps if isinstance(s, str) and _epoch(s) is not None]
    return max(valid, key=lambda pair: pair[0])[1] if valid else None


def _board_targets(text, names):
    if not isinstance(text, str) or not names:
        return []
    name_set = set(names)
    targets = []
    seen = set()
    for token in BOARD_MENTION.findall(text):
        if token == 'all':
            matched = names
        elif token in name_set:
            matched = (token,)
        else:
            prefix = token + '-'
            matched = [n for n in names if n.startswith(prefix) and n[len(prefix):].isdigit()]
        for n in matched:
            if n not in seen:
                seen.add(n)
                targets.append(n)
    return targets


def _strip_mention_prefix(text):
    return re.sub(r'^@[A-Za-z0-9_-]+\s*', '', text.lstrip(), count=1)


def _swarm_tool_history(summary, parent_records):
    calls = []
    if parent_records:
        for record in parent_records:
            if record.get('type') != 'PLANNER_RESPONSE':
                continue
            at = _iso_stamp(record.get('created_at'))
            for call in (record.get('tool_calls') or ()):
                if not isinstance(call, dict):
                    continue
                cname = call.get('name')
                if cname in ('swarm', 'post_message'):
                    args = _object(call.get('args') or call.get('arguments') or call.get('parameters'))
                    calls.append((at, {'_tool': cname, **args}, at))
    else:
        calls = list(getattr(summary, 'swarm_calls', ()) or ())

    added = {}
    killed = {}
    models = {}
    posts = []
    for call_at, args, done_at in calls:
        tool = args.get('_tool')
        if tool == 'swarm':
            action = args.get('action')
            raw_name = args.get('name')
            if action == 'add' and isinstance(raw_name, str) and raw_name.strip():
                base = raw_name.strip()
                tasks = args.get('tasks')
                count = args.get('n')
                shared_brief = args.get('brief') if isinstance(args.get('brief'), str) else ''
                model_arg = args.get('model') if isinstance(args.get('model'), str) and args.get('model').strip() else None
                if isinstance(tasks, list) and tasks:
                    names = [('%s-%d' % (base, i + 1), '%s\n%s' % (shared_brief, t) if shared_brief else str(t))
                             for i, t in enumerate(tasks)]
                elif isinstance(count, int) and not isinstance(count, bool) and count > 1:
                    names = [('%s-%d' % (base, i + 1), shared_brief) for i in range(count)]
                else:
                    names = [(base, shared_brief)]
                for mname, mbrief in names:
                    added.setdefault(mname, {
                        'name': mname,
                        'startedAt': call_at or done_at,
                        'brief': _brief(mbrief),
                        'briefBytes': _size(mbrief) if mbrief.strip() else None,
                        'model': model_arg,
                    })
            elif action == 'kill' and isinstance(raw_name, str) and raw_name.strip():
                target = raw_name.strip()
                killed[target] = done_at or call_at
                for known in list(added):
                    if known.startswith(target + '-') and known[len(target) + 1:].isdigit():
                        killed[known] = done_at or call_at
            elif action == 'model' and isinstance(raw_name, str) and raw_name.strip():
                model_arg = args.get('model')
                if isinstance(model_arg, str) and model_arg.strip():
                    models[raw_name.strip()] = model_arg.strip()
        elif tool == 'post_message':
            text = args.get('text')
            if isinstance(text, str) and text.strip():
                posts.append((done_at or call_at, text))
    return added, killed, models, posts


def _swarm_rows(summary, parent_records, db_rows, claimed_ids, active, billed, billed_seen):
    added, killed_at, model_overrides, fallback_posts = _swarm_tool_history(summary, parent_records)
    swarm_dir = _brain_swarm_dir(summary.id)
    roster = _read_swarm_roster(swarm_dir)
    if roster and roster['members']:
        board = _read_swarm_board(swarm_dir)
        members = roster['members']
        member_names = [
            n for n, m in members.items()
            if isinstance(m, dict) and n != 'coordinator'
            and _swarm_role(n, m) != 'coordinator'
            and m.get('conversation_id') != summary.id
        ]
        inbound_by = {n: {'brief': None, 'briefBytes': None, 'startedAt': None,
                          'messages': 0, 'messageBytes': 0, 'messagedAt': None} for n in member_names}
        posts_by = {n: {'bytes': 0, 'at': None} for n in member_names}
        for msg in board:
            if msg.get('control'):
                continue
            sender = str(msg.get('agent') or '')
            text = msg.get('text')
            if not isinstance(text, str):
                continue
            at = _board_time_iso(msg.get('time'))
            bsize = _size(text) or 0
            if sender in posts_by:
                posts_by[sender]['bytes'] += bsize
                if at:
                    posts_by[sender]['at'] = _max_iso(posts_by[sender]['at'], at)
            for target in _board_targets(text, member_names):
                if target == sender:
                    continue
                entry = inbound_by[target]
                if entry['brief'] is None:
                    stripped = _strip_mention_prefix(text)
                    entry['brief'] = _brief(stripped) or _brief(text)
                    entry['briefBytes'] = bsize
                    entry['startedAt'] = entry['startedAt'] or at
                else:
                    entry['messages'] += 1
                    entry['messageBytes'] += bsize
                    if at:
                        entry['messagedAt'] = _max_iso(entry['messagedAt'], at)

        out = []
        for name in member_names:
            m = members[name]
            cid = m.get('conversation_id')
            cid = cid if isinstance(cid, str) and CONVERSATION.fullmatch(cid) else None
            db_row = db_rows.get(cid) if cid else None
            if cid:
                claimed_ids.add(cid)
            records = _read_brain_records(brain_log(cid)) if cid else []
            bill_target = billed if (billed is not None and cid and cid not in billed_seen) else None
            stats = _child_brain_stats(cid, active=active, db_row=db_row, billed=bill_target) if cid else {}
            if cid and billed is not None:
                billed_seen.add(cid)

            inbound = inbound_by[name]
            outbound = posts_by[name]
            add_info = added.get(name, {})
            raw_model = model_overrides.get(name) or m.get('model')
            fallback_model, fallback_effort = split_model(raw_model)
            model = stats.get('model') or fallback_model
            effort = stats.get('effort') or fallback_effort
            started_at = stats.get('startedAt') or inbound['startedAt'] or add_info.get('startedAt')
            updated_at = _max_iso(stats.get('updatedAt'), outbound['at'], inbound['messagedAt'],
                                  inbound['startedAt'], (db_row or {}).get('updatedAt'), started_at)
            is_killed = bool(m.get('killed') or (db_row and db_row.get('killed')) or name in killed_at)
            turn_state = _swarm_turn_ended(records) if records else None
            if is_killed:
                status = 'interrupted'
                ended_at = killed_at.get(name) or updated_at
            elif turn_state == 'error':
                status = 'error'
                ended_at = updated_at
            elif turn_state == 'idle':
                status = 'done'
                ended_at = updated_at
            elif not records:
                if db_row and db_row.get('status') == 'CASCADE_RUN_STATUS_IDLE' and not db_row.get('notFullyIdle'):
                    status, ended_at = 'done', updated_at
                elif m.get('wake_mode') in ('mentions', 'anything'):
                    status, ended_at = 'done', updated_at
                else:
                    status, ended_at = ('running' if active else 'unknown'), None
            else:
                status, ended_at = ('running' if active else 'unknown'), None

            brief = inbound['brief'] or add_info.get('brief') or stats.get('brief')
            brief_bytes = inbound['briefBytes'] if inbound['briefBytes'] is not None else (
                add_info.get('briefBytes') if add_info.get('briefBytes') is not None else stats.get('briefBytes'))
            result_bytes = outbound['bytes'] if outbound['bytes'] > 0 else stats.get('resultBytes')
            row = {
                'id': cid or ('swarm:' + name),
                'kind': 'swarm',
                'name': name,
                'role': _swarm_role(name, m),
                'status': status,
            }
            if model:
                row['model'] = model
            if effort:
                row['effort'] = effort
            if started_at:
                row['startedAt'] = started_at
            if updated_at:
                row['updatedAt'] = updated_at
            if ended_at:
                row['endedAt'] = ended_at
            if stats.get('tokens') is not None:
                row['tokens'] = stats['tokens']
            if brief:
                row['brief'] = brief
            if brief_bytes is not None:
                row['briefBytes'] = brief_bytes
            if inbound['messages']:
                row['messages'] = inbound['messages']
                row['messageBytes'] = inbound['messageBytes']
                if inbound['messagedAt']:
                    row['messagedAt'] = inbound['messagedAt']
            if result_bytes:
                row['resultBytes'] = result_bytes
            out.append(row)
        return out

    if not added:
        return []
    member_names = list(added)
    inbound_by = {n: {'messages': 0, 'messageBytes': 0, 'messagedAt': None} for n in member_names}
    for at, text in fallback_posts:
        bsize = _size(text) or 0
        for target in _board_targets(text, member_names):
            entry = inbound_by[target]
            entry['messages'] += 1
            entry['messageBytes'] += bsize
            if at:
                entry['messagedAt'] = _max_iso(entry['messagedAt'], at)
    out = []
    for name, info in added.items():
        raw_model = model_overrides.get(name) or info.get('model')
        model, effort = split_model(raw_model)
        is_killed = name in killed_at
        status = 'interrupted' if is_killed else ('running' if active else 'unknown')
        row = {
            'id': 'swarm:' + name,
            'kind': 'swarm',
            'name': name,
            'role': _swarm_role(name, {}),
            'status': status,
            'startedAt': info.get('startedAt'),
            'updatedAt': _max_iso(info.get('startedAt'), inbound_by[name]['messagedAt'], killed_at.get(name)),
        }
        if is_killed and killed_at.get(name):
            row['endedAt'] = killed_at[name]
        if model:
            row['model'] = model
        if effort:
            row['effort'] = effort
        if info.get('brief'):
            row['brief'] = info['brief']
        if info.get('briefBytes') is not None:
            row['briefBytes'] = info['briefBytes']
        if inbound_by[name]['messages']:
            row['messages'] = inbound_by[name]['messages']
            row['messageBytes'] = inbound_by[name]['messageBytes']
            if inbound_by[name]['messagedAt']:
                row['messagedAt'] = inbound_by[name]['messagedAt']
        out.append(row)
    return out


def _parse_workflow_output(output):
    if not isinstance(output, str) or not output.strip():
        return None, None, None, []
    created = WORKFLOW_CREATED.search(output)
    completed = WORKFLOW_COMPLETED.search(output)
    created_iso = _iso_stamp(created.group(1)) if created else None
    completed_iso = _iso_stamp(completed.group(1)) if completed else None
    current_phase = None
    agents = []
    for line in output.splitlines():
        stripped = line.strip()
        pm = WORKFLOW_PHASE.match(stripped)
        if pm:
            current_phase = pm.group(1).strip()
            continue
        am = WORKFLOW_AGENT.match(stripped)
        if am:
            agents.append((current_phase, am.group(1).strip(), am.group(2).strip(),
                           am.group(3).strip(), am.group(4), am.group(5) or ''))
    return created_iso, completed_iso, current_phase, agents


def _workflow_rows(summary, parent_records, db_rows, claimed_ids, active, billed, billed_seen):
    workflows = []
    if parent_records:
        pending_calls = []
        by_task = {}
        for idx, record in enumerate(parent_records):
            rtype = record.get('type')
            at = _iso_stamp(record.get('created_at'))
            if rtype == 'PLANNER_RESPONSE':
                for cidx, call in enumerate(record.get('tool_calls') or ()):
                    if not isinstance(call, dict):
                        continue
                    cname = call.get('name')
                    wf = None
                    if cname == 'run_workflow':
                        args = _object(call.get('args') or call.get('arguments') or call.get('parameters'))
                        desc = args.get('Description')
                        script = args.get('Script') or args.get('ScriptPath')
                        desc_clean = _brief(desc) if isinstance(desc, str) else None
                        brief = _brief(script) if isinstance(script, str) and script.strip() else desc_clean
                        brief_bytes = _size(script) if isinstance(script, str) and script.strip() else (
                            _size(desc) if isinstance(desc, str) and desc.strip() else None)
                        wf = {
                            'id': 'wf-%s-%s' % (record.get('step_index', idx), cidx),
                            'description': desc_clean,
                            'brief': brief,
                            'briefBytes': brief_bytes,
                            'startedAt': at,
                            'updatedAt': at,
                            'endedAt': None,
                            'status': 'running',
                            'output': None,
                        }
                        workflows.append(wf)
                    pending_calls.append(wf)
            elif rtype == 'GENERIC' and pending_calls:
                wf = pending_calls.pop(0)
                if wf is not None:
                    content = record.get('content') if isinstance(record.get('content'), str) else ''
                    wf['updatedAt'] = at or wf.get('updatedAt')
                    task_match = TASK_STARTED.search(content)
                    if task_match:
                        by_task[task_match.group(1)] = wf
                    elif record.get('status') == 'ERROR':
                        wf['output'] = content
                        wf['endedAt'] = at
                        wf['status'] = 'error'
                    elif record.get('status') == 'DONE':
                        wf['output'] = content
                        wf['endedAt'] = at
                        wf['status'] = 'error' if WORKFLOW_FAILED.search(content) else 'done'
            elif rtype == 'SYSTEM_MESSAGE':
                content = record.get('content') if isinstance(record.get('content'), str) else ''
                for tid in TASK_ENDED.findall(content):
                    wf = by_task.pop(tid, None)
                    if wf is not None:
                        wf['output'] = content
                        wf['updatedAt'] = at or wf.get('updatedAt')
                        wf['endedAt'] = at
                        wf['status'] = 'error' if ('was canceled' in content or WORKFLOW_FAILED.search(content)) else 'done'
    else:
        for wf in getattr(summary, 'workflows', {}).values():
            copy = dict(wf)
            copy.setdefault('status', 'running')
            workflows.append(copy)

    out = []
    for wf in workflows:
        created_iso, completed_iso, last_phase, agents = _parse_workflow_output(wf.get('output'))
        if agents:
            for phase, type_name, agent_role, agent_status, cid, snippet in agents:
                claimed_ids.add(cid)
                db_row = db_rows.get(cid)
                bill_target = billed if (billed is not None and cid not in billed_seen) else None
                stats = _child_brain_stats(cid, active=active, db_row=db_row, billed=bill_target)
                if billed is not None:
                    billed_seen.add(cid)
                if agent_status in ('failed', 'error'):
                    status = 'error'
                elif agent_status in ('cancelled', 'interrupted'):
                    status = 'interrupted'
                elif agent_status == 'done' and stats['status'] in ('running', 'unknown'):
                    status = 'done'
                else:
                    status = stats['status']
                role_label = phase or (type_name if type_name and type_name != 'self' else 'Workflow')
                name = agent_role or (db_row or {}).get('title') or stats.get('brief') or 'Workflow agent'
                ended_at = stats.get('endedAt') or completed_iso or wf.get('endedAt') if status in ('done', 'error', 'interrupted') else None
                result_bytes = stats.get('resultBytes')
                if not result_bytes and snippet.strip():
                    raw_snip = snippet.strip()
                    if raw_snip.startswith('"') and raw_snip.endswith('"'):
                        try:
                            raw_snip = str(json.loads(raw_snip))
                        except ValueError:
                            pass
                    result_bytes = _size(raw_snip)
                row = {
                    'id': cid,
                    'kind': 'workflow',
                    'name': name,
                    'role': role_label,
                    'status': status,
                    'startedAt': stats.get('startedAt') or created_iso or wf.get('startedAt'),
                    'updatedAt': stats.get('updatedAt') or completed_iso or wf.get('updatedAt'),
                }
                if phase:
                    row['phase'] = phase
                if ended_at:
                    row['endedAt'] = ended_at
                if stats.get('model'):
                    row['model'] = stats['model']
                if stats.get('effort'):
                    row['effort'] = stats['effort']
                if stats.get('tokens') is not None:
                    row['tokens'] = stats['tokens']
                brief = stats.get('brief') or wf.get('brief')
                brief_bytes = stats.get('briefBytes') if stats.get('briefBytes') is not None else wf.get('briefBytes')
                if brief:
                    row['brief'] = brief
                if brief_bytes is not None:
                    row['briefBytes'] = brief_bytes
                if result_bytes:
                    row['resultBytes'] = result_bytes
                out.append(row)
        else:
            status = wf.get('status') or 'running'
            if status == 'running' and not active:
                status = 'unknown'
            elif status == 'done' and WORKFLOW_FAILED.search(wf.get('output') or ''):
                status = 'error'
            started_at = created_iso or wf.get('startedAt')
            updated_at = completed_iso or wf.get('updatedAt') or started_at
            ended_at = (completed_iso or wf.get('endedAt') or updated_at) if status in ('done', 'error', 'interrupted') else None
            row = {
                'id': 'workflow:' + str(wf['id']),
                'kind': 'workflow',
                'name': wf.get('description') or 'Workflow',
                'role': last_phase or 'Workflow',
                'status': status,
            }
            if last_phase:
                row['phase'] = last_phase
            if started_at:
                row['startedAt'] = started_at
            if updated_at:
                row['updatedAt'] = updated_at
            if ended_at:
                row['endedAt'] = ended_at
            brief = wf.get('brief') or wf.get('description')
            if brief:
                row['brief'] = brief
            if wf.get('briefBytes') is not None:
                row['briefBytes'] = wf['briefBytes']
            if status in ('done', 'error', 'interrupted') and wf.get('output'):
                row['resultBytes'] = _size(wf['output'])
            elif wf.get('resultBytes'):
                row['resultBytes'] = wf['resultBytes']
            out.append(row)
    return out


def subagents_snapshot(summary, active=True, billed=None):
    """Orchestrator roles, swarm workers, workflows and native Gemini subagents for ``summary``."""
    parent_records = _read_brain_records(brain_log(summary.id))
    db_rows = {row['id']: row for row in conversation_children(summary.id)}
    claimed_ids = set()
    billed_seen = set()
    out = _orchestrator_rows(summary, parent_records, active)
    out.extend(_swarm_rows(summary, parent_records, db_rows, claimed_ids, active, billed, billed_seen))
    out.extend(_workflow_rows(summary, parent_records, db_rows, claimed_ids, active, billed, billed_seen))
    rows = {}
    for call in summary.calls.values():
        copy = dict(call)
        copy.setdefault('kind', 'subagent')
        if copy.get('id') not in claimed_ids:
            rows[copy['id']] = copy
    if parent_records:
        _apply_brain_subagent_history(rows, parent_records)
    for cid in list(rows):
        if cid in claimed_ids:
            rows.pop(cid, None)
    for cid, db_row in db_rows.items():
        if cid not in rows and cid not in claimed_ids:
            rows[cid] = {
                'id': cid,
                'kind': 'subagent',
                'name': db_row.get('title') or db_row.get('agentName') or ('Subagent ' + cid[:8]),
                'role': db_row.get('agentName') or None,
                'status': 'running',
            }
    for row in list(rows.values()):
        cid = row.get('id')
        if not (isinstance(cid, str) and CONVERSATION.fullmatch(cid)):
            continue
        bill_target = billed if (billed is not None and cid not in billed_seen) else None
        stats = _child_brain_stats(cid, active=active, db_row=db_rows.get(cid), billed=bill_target)
        if billed is not None:
            billed_seen.add(cid)
        row['model'] = stats['model'] or row.get('model')
        row['effort'] = stats['effort'] or row.get('effort')
        row['startedAt'] = stats['startedAt'] or row.get('startedAt')
        row['updatedAt'] = stats['updatedAt'] or row.get('updatedAt')
        if stats['tokens'] is not None:
            row['tokens'] = stats['tokens']
        if row.get('status') != 'interrupted':
            row['status'] = stats['status']
            row['endedAt'] = stats['endedAt']
        else:
            row['endedAt'] = row.get('endedAt') or row.get('updatedAt')
        if stats['resultBytes'] and not row.get('resultBytes'):
            row['resultBytes'] = stats['resultBytes']
        out.append(row)
    for row in rows.values():
        if row not in out:
            out.append(row)
    return out


def finished_turn(run_dir, state, quiet_since):
    """The final reply of the running turn when Antigravity's own record says
    the agent finished it and nothing has been written since ``quiet_since``,
    else None. Anything unexpected reads as still working.

    agy can stop writing its stream-json output partway through a turn and
    then never send the result that ends the process, though the agent keeps
    working to the end. Returns {'at': epoch, 'response': text}."""
    log = headless_session._path(run_dir, headless_session._turn_name(state['turn'], 'jsonl'))
    conversation = _turn_conversation(log)
    if conversation is None:
        return None
    path = BRAIN / conversation / '.system_generated' / 'logs' / 'transcript_full.jsonl'
    try:
        written = max(os.stat(path).st_mtime, os.stat(log).st_mtime)
        if written > quiet_since:
            return None
        records = [json.loads(line) for line in path.read_text().splitlines()]
    except (OSError, ValueError):
        return None
    if not records or not all(isinstance(record, dict) for record in records):
        return None
    start = max((index for index, record in enumerate(records)
                 if record.get('type') == 'USER_INPUT'), default=None)
    asked = None if start is None else _seconds(records[start].get('created_at'))
    # The prompt agy recorded must be this turn's, not one a resumed turn's
    # process has yet to record.
    if asked is None or asked < state['spawnedAt'] - headless_session.START_SLACK_SECONDS:
        return None
    turn = records[start + 1:]
    reply = turn[-1] if turn else {}
    text = reply.get('content')
    if (reply.get('type') != 'PLANNER_RESPONSE' or reply.get('status') != 'DONE'
            or reply.get('tool_calls') or not isinstance(text, str) or not text.strip()):
        return None
    if _turn_pending_work(turn) or _has_active_swarm(conversation) or _has_active_children(conversation):
        return None
    at = _seconds(reply.get('created_at'))
    return None if at is None else {'at': max(at, written), 'response': text}


def _normalise(records, run_dir, previous):
    settled, ended = {}, set()
    for event in records:
        identity = re.fullmatch(r'gemini-raw-(\d+)-(\d+)', str(event.get('uuid')))
        if identity and event.get('event') == SETTLED:
            settled[int(identity[1])] = event
        elif identity and event.get('event') == 'result':
            ended.add(int(identity[1]))
    out = []
    steps = {}
    current_turn = None
    responded = False
    finished_response = False
    error_slot = None
    for event in records:
        uid = event['uuid']
        identity = re.fullmatch(r'gemini-raw-(\d+)-(\d+)', str(uid))
        if not identity:
            continue
        turn = int(identity[1])
        stamp = event['timestamp']
        if turn != current_turn:
            current_turn, responded, finished_response, steps, error_slot = turn, False, False, {}, None
            last_reply = None
            earlier = previous.get('gemini-user-%d' % turn) or {}
            prompt = headless_session.turn_prompt(run_dir, turn) or earlier.get('text')
            if prompt:
                out.append(_message('user', 'gemini-user-%d' % turn,
                                    _prompt_stamp(run_dir, turn, earlier.get('timestamp') or stamp),
                                    [{'type': 'text', 'text': prompt}]))
        if event.get('event') == 'init':
            init = _object(event.get('init'))
            model = init.get('model')
            out.append(dict(type='system', subtype='init', uuid=uid, timestamp=stamp,
                            session_id=event.get('conversation_id'), cwd=init.get('cwd'),
                            **({'model': model.strip()} if isinstance(model, str) and model.strip() else {})))
        elif event.get('event') == 'step_update':
            step = _object(event.get('step_update'))
            key = step.get('step_index')
            if not isinstance(key, int):
                continue
            finished_response = False
            identity = 'gemini-%d-step-%d' % (turn, key)
            if step.get('step_type') == 'agent_response':
                text = step.get('text_delta')
                if isinstance(text, str):
                    steps[key] = steps.get(key, '') + text
                if step.get('state') == 'DONE' and steps.get(key):
                    last_reply = steps.pop(key)
                    out.append(_message('assistant', identity, stamp, [{'type': 'text', 'text': last_reply}]))
                    responded = True
                    finished_response = True
            elif step.get('step_type') == 'tool':
                info = _object(step.get('tool_info'))
                name = info.get('name') or step.get('tool_name') or 'tool'
                out.append(_message('assistant', uid + '-call', stamp,
                                    [{'type': 'tool_use', 'id': identity, 'name': name, 'input': _object(info.get('parameters'))}]))
                if step.get('state') == 'DONE':
                    error = info.get('error')
                    output = info.get('output', '')
                    out.append(_message('user', uid + '-result', stamp,
                                        [{'type': 'tool_result', 'tool_use_id': identity,
                                          'content': json.dumps(error) if error else str(output), 'is_error': bool(error)}]))
            elif step.get('step_type') == 'subagent':
                info = _object(step.get('subagent_info'))
                entries = [entry for entry in (info.get('subagents') or []) if isinstance(entry, dict)]
                if not entries:
                    entries = [{}]
                name = step.get('tool_name') or 'invoke_subagent'
                for index, entry in enumerate(entries):
                    suffix = '' if index == 0 else '-%d' % index
                    call_id = identity + suffix
                    cid = entry.get('conversation_id')
                    params = {}
                    for source, dest in (('type_name', 'TypeName'), ('role', 'Role'),
                                         ('initial_prompt', 'Prompt'), ('conversation_id', 'conversationId')):
                        if isinstance(entry.get(source), str) and entry[source]:
                            params[dest] = entry[source]
                    out.append(_message('assistant', uid + '-call' + suffix, stamp,
                                        [{'type': 'tool_use', 'id': call_id, 'name': name, 'input': params}]))
                    if step.get('state') == 'DONE':
                        has_cid = isinstance(cid, str) and bool(cid)
                        extra = {'toolUseResult': {'agentId': cid, 'isAsync': True, 'status': 'async_launched'}} if has_cid else {}
                        out.append(_message('user', uid + '-result' + suffix, stamp,
                                            [{'type': 'tool_result', 'tool_use_id': call_id,
                                              'content': json.dumps({'conversationId': cid}) if has_cid else '',
                                              'is_error': False}], **extra))
            elif step.get('step_type') == 'error_message' and step.get('state') == 'DONE':
                # Antigravity emits error text only on the turn's result event;
                # reserve the step's slot so in-turn recovery stays ordered.
                error_slot = (len(out), stamp)
                out.append(None)
        elif event.get('event') == 'result' or (event.get('event') == SETTLED and turn not in ended):
            # A settled turn whose process was killed before agy wrote its
            # result ends at Orc's own record instead.
            result = _object(event.get('result'))
            response = result.get('response')
            show = not responded
            if turn in settled:
                # Orc ended a turn agy had stopped reporting on, so agy's own
                # error here only says the turn was stopped. The final reply
                # shows unless the stream already ended on it, and a reply the
                # stream cut off is dropped.
                response, error_slot, steps = settled[turn].get('response'), None, {}
                show = not (finished_response and isinstance(response, str)
                            and isinstance(last_reply, str) and response.strip() == last_reply.strip())
                if show:
                    out.append(dict(type='system', subtype='informational', level='warning',
                                    uuid=uid + '-settled', timestamp=stamp,
                                    content='Antigravity stopped reporting this turn partway through, so some '
                                            'of its steps are missing here. Orc ended the turn after the agent '
                                            'finished.'))
            if show and isinstance(response, str) and response:
                out.append(_message('assistant', uid + '-response', stamp,
                                    [{'type': 'text', 'text': response}]))
            status = result.get('status')
            # Antigravity repeats any earlier conversation ERROR_MESSAGE on
            # later turns' result events even when the new turn finished cleanly.
            settled_cleanly = turn in settled or (finished_response and result.get('error') != 'interrupted')
            # agy's "interrupted" is Orc or the person stopping the turn, not
            # a failure: it reads as a stop, as Claude's own marker does.
            interrupted = turn not in settled and status != 'SUCCESS' and result.get('error') == 'interrupted'
            permission_error = None if settled_cleanly else empty_reply_permission_error(result)
            turn_failed = bool(permission_error) or (status != 'SUCCESS' and not settled_cleanly and not interrupted)
            if interrupted:
                if error_slot is not None:
                    out[error_slot[0]] = None
                    error_slot = None
                out.append(_message('user', uid + '-interrupted', stamp,
                                    [{'type': 'text', 'text': INTERRUPTED}]))
            elif permission_error or (status != 'SUCCESS' and (error_slot is not None or not settled_cleanly)):
                text = permission_error or str(result.get('error') or 'Antigravity ended with status %s' % status)
                if error_slot is not None:
                    out[error_slot[0]] = _message('assistant', uid + '-error', error_slot[1],
                                                  [{'type': 'text', 'text': text}], isApiErrorMessage=True)
                    error_slot = None
                else:
                    out.append(_message('assistant', uid + '-error', stamp,
                                        [{'type': 'text', 'text': text}], isApiErrorMessage=True))
            usage = _object(result.get('usage'))
            out.append(_message('assistant', uid + '-usage', stamp, []))
            out[-1]['message']['usage'] = usage
            out[-1]['message']['id'] = uid
            out.append(dict(type='result', uuid=uid, timestamp=stamp, is_error=turn_failed,
                            result=permission_error or (response if isinstance(response, str) else ''),
                            usage=result.get('usage') or {}))
    for key, text in steps.items():
        if text:
            out.append(_message('assistant', 'gemini-%d-step-%d' % (current_turn, key), stamp,
                                [{'type': 'text', 'text': text}]))
    return [record for record in out if record is not None]


def sync(run_dir, final=False, strict=False):
    raw = raw_transcript(run_dir, final=final, strict=strict)
    target = Path(headless_session.harness_transcript(run_dir, 'gemini'))
    with headless_session._locked(run_dir, '.gemini-transcript.lock'):
        try:
            with headless_session._locked(run_dir, '.transcript.lock'):
                records = [json.loads(line) for line in Path(raw).read_text().splitlines()]
        except FileNotFoundError:
            if target.exists():
                target.unlink()
            return str(target)
        previous = {}
        if target.exists():
            for line in target.read_text().splitlines():
                record = json.loads(line)
                if record.get('uuid', '').startswith('gemini-user-'):
                    previous[record['uuid']] = {'text': record['message']['content'][0]['text'],
                                                'timestamp': record.get('timestamp')}
        data = ''.join(json.dumps(record) + '\n' for record in _normalise(records, run_dir, previous))
        if target.exists() and target.read_text() == data:
            return str(target)
        fd, temporary = tempfile.mkstemp(dir=target.parent, prefix='.gemini-')
        try:
            with os.fdopen(fd, 'w') as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return str(target)
