import hashlib
import json
from pathlib import Path
from urllib.parse import quote

import merge_queue


TERMINAL = {'complete', 'merged', 'merged-to-parent', 'cancelled'}


def feed(runtime, arguments, error):
    items = []
    for row in runtime['scan_cached']():
        meta = row.get('meta') or {}
        status = meta.get('status')
        if status in TERMINAL or row.get('pending'):
            continue
        pending = meta.get('pendingQuestion')
        if not pending and (status not in ('awaiting-gate', 'escalated')
                            or merge_queue.conflict_resolution_pending(meta)):
            continue
        run_id = row['id']
        phase = meta.get('phase')
        path = None
        decision = pending or {'questions': []}
        if phase == 'ship':
            path = 'pr-body.md' if meta.get('route') == 'minimal-shell' else 'ship/ship.html'
            if not pending and status == 'awaiting-gate':
                decision = {'questions': [{'question': 'Review the result and choose a delivery action.'}]}
        elif phase in ('plan', 'clarification', 'grilling'):
            path = {'plan': 'plan.html', 'clarification': 'clarification/clarification.html',
                    'grilling': 'grilling.html'}[phase]
            if not pending:
                root = Path(runtime['RUNS']).resolve()
                source = root / run_id / (phase + '-questions.json')
                try:
                    if source.resolve().is_relative_to(root / run_id) and source.stat().st_size <= 262144:
                        data = json.loads(source.read_text())
                        decision = {'questions': data.get('questions') or []}
                except (OSError, ValueError, TypeError):
                    pass
                if not decision['questions'] and phase == 'plan' and status == 'awaiting-gate':
                    decision = {'questions': [{'question': 'Approve the current plan or request changes.'}]}
        decision = dict(decision)
        questions = decision.get('questions') or []
        decision['questions'] = questions[:8]
        decision['truncated'] = len(questions) > 8
        if len(json.dumps(decision).encode()) > 32768:
            decision = {'questions': [], 'truncated': True}
        item = {'runId': run_id, 'title': str(meta.get('title') or run_id)[:60],
                'phase': phase, 'status': status,
                'reason': 'question' if pending else status,
                'decision': decision,
                'artifact': {'path': path, 'url': '/#' + quote(run_id, safe='') + '/' + path} if path else None,
                'url': '/#' + quote(run_id, safe='')}
        items.append(item)
    items.sort(key=lambda item: item['runId'])
    snapshot = hashlib.sha256(json.dumps(items, sort_keys=True).encode()).hexdigest()
    offset = 0
    cursor = arguments.get('cursor')
    if cursor:
        try:
            digest, number = cursor.split(':')
            offset = int(number)
            if offset < 0 or len(digest) != 64 or str(offset) != number:
                raise ValueError()
        except ValueError:
            raise error(400, 'invalid attention cursor')
        if digest != snapshot:
            raise error(409, 'attention queue changed; restart without a cursor')
        if offset > len(items):
            raise error(400, 'attention cursor is out of range')
    limit = arguments.get('limit', 20)
    end = offset + limit
    return {'items': items[offset:end], 'total': len(items), 'snapshot': snapshot,
            'nextCursor': snapshot + ':' + str(end) if end < len(items) else None}
