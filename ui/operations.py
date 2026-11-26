import base64
import binascii
from dataclasses import dataclass, field
import io
import json
import math
from pathlib import Path
import re
from urllib.parse import quote, urlencode

import attention
import exports
import maintenance

SKILLS_DIR = Path(__file__).resolve().parent.parent / 'skills'


SCOPES = ('orc:read', 'orc:write', 'orc:deliver', 'orc:admin')
MAX_RESULT_BYTES = 15 * 1024 * 1024
MAX_BINARY_BYTES = 10 * 1024 * 1024
STRING = {'type': 'string', 'maxLength': 262144}
NULLABLE_STRING = {'type': ['string', 'null'], 'maxLength': 262144}
BOOLEAN = {'type': 'boolean'}
OBJECT = {'type': 'object'}
IDENTITY = {'type': 'string', 'pattern': r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$'}


def enum(*values):
    return {'type': 'string', 'enum': list(values)}


def array(items=STRING, maximum=1000):
    return {'type': 'array', 'items': items, 'maxItems': maximum}


def schema(properties=None, required=()):
    return {'type': 'object', 'properties': properties or {},
            'required': list(required), 'additionalProperties': False}


class OperationError(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


@dataclass
class OperationResult:
    data: object
    status: int = 200
    content_type: str = 'application/json'
    headers: dict = field(default_factory=dict)

    def envelope(self):
        return {'status': self.status, 'data': self.data, 'contentType': self.content_type}


def validate(value, spec, path='arguments'):
    kind = spec.get('type')
    types = kind if isinstance(kind, list) else [kind] if kind else []
    matches = {
        'object': isinstance(value, dict), 'array': isinstance(value, list),
        'string': isinstance(value, str), 'boolean': type(value) is bool,
        'integer': type(value) is int, 'null': value is None,
        'number': type(value) in (int, float) and math.isfinite(value),
    }
    if types and not any(matches.get(t, False) for t in types):
        raise OperationError(400, path + ': invalid type')
    if 'enum' in spec and value not in spec['enum']:
        raise OperationError(400, path + ': unknown value')
    if type(value) in (int, float):
        if value < spec.get('minimum', -math.inf) or value > spec.get('maximum', math.inf):
            raise OperationError(400, path + ': outside allowed range')
    if isinstance(value, dict):
        properties = spec.get('properties', {})
        for key in spec.get('required', []):
            if key not in value:
                raise OperationError(400, path + ': missing ' + key)
        if spec.get('additionalProperties') is False and value.keys() - properties.keys():
            raise OperationError(400, path + ': unknown fields')
        for key, item in value.items():
            if key in properties:
                validate(item, properties[key], path + '.' + key)
    if isinstance(value, list):
        if len(value) > spec.get('maxItems', 10000):
            raise OperationError(400, path + ': too many items')
        for item in value:
            validate(item, spec.get('items', {}), path + '[]')
    if isinstance(value, str):
        if len(value) > spec.get('maxLength', 262144) or len(value) < spec.get('minLength', 0):
            raise OperationError(400, path + ': invalid length')
        if 'pattern' in spec and not re.fullmatch(spec['pattern'], value):
            raise OperationError(400, path + ': invalid identity or path')


@dataclass(frozen=True)
class OperationSpec:
    name: str
    description: str
    method: str
    route: str
    input_schema: dict
    scope: str = 'orc:read'
    native: bool = False
    binary: bool = False
    fixed: dict = field(default_factory=dict)
    plugin: str = None

    def descriptor(self):
        read = self.scope == 'orc:read'
        description = self.description
        conditional = []
        if self.name == 'projects.action':
            description += ' Push additionally requires orc:deliver.'
            conditional = [{'argument': 'action', 'equals': 'push', 'scopes': ['orc:deliver']}]
        elif self.name == 'runs.start':
            conditional = [{'argument': 'launchAction', 'equals': 'ship', 'scopes': ['orc:deliver']}]
        if self.native:
            description += ' Requires the connected Orc desktop app.'
        return {'name': self.name, 'description': description,
                'inputSchema': self.input_schema, 'requiredScopes': [self.scope],
                'conditionalScopes': conditional,
                'annotations': {'readOnlyHint': read, 'destructiveHint': not read,
                                'idempotentHint': self.method == 'GET' and self.name not in ('exports.create', 'backups.create'),
                                'openWorldHint': True},
                'nativeRequired': self.native}


# Operations served by an app plugin, by name prefix: each answers 404 and
# stays out of the catalog while its plugin is absent or disabled.
PLUGIN_OPERATIONS = {'prs.': 'pull-requests'}


def _plugin_operations():
    import app_plugins
    merged = dict(PLUGIN_OPERATIONS)
    policy = app_plugins.catalog_policy()
    if policy is not None and hasattr(policy, 'plugin_operation_prefixes'):
        merged.update(policy.plugin_operation_prefixes())
    return merged


def build_catalog(runtime):
    specs = []

    def add(name, method, route, props=None, required=(), scope='orc:read',
            description=None, native=False, binary=False, fixed=None):
        if any(spec.name == name for spec in specs):
            raise ValueError('duplicate operation name: ' + name)
        properties = dict(props or {})
        path_keys = re.findall(r'{(\w+)}', route)
        for key in path_keys:
            properties[key] = IDENTITY
        specs.append(OperationSpec(name, description or name.replace('.', ' ').replace('_', ' ').capitalize() +
                                   '. Uses the same validation and run-state guards as the Orc app.',
                                   method, route, schema(properties, (*path_keys, *required)),
                                   scope, native, binary, fixed or {},
                                   next((plugin for prefix, plugin in _plugin_operations().items()
                                         if name.startswith(prefix)), None)))

    launch = dict(agent=enum(*runtime['NEW_CONV_AGENTS']), mode=enum(*runtime['NEW_CONV_MODES']),
                  prompt=STRING, repo=STRING, launchAction=enum('start', 'ship'), transport=NULLABLE_STRING,
                  permissionMode=NULLABLE_STRING, model=NULLABLE_STRING, effort=NULLABLE_STRING, fast=BOOLEAN,
                  orchestration=BOOLEAN, orchestrationPreset=NULLABLE_STRING,
                  tickets=array(IDENTITY, 20), claudeAccount=NULLABLE_STRING,
                  startAfter=NULLABLE_STRING, buildOn=NULLABLE_STRING)
    add('runs.list', 'GET', '/api/runs', description='List Orc runs and their current app state.')
    add('runs.collision_radar', 'POST', '/api/collision-radar',
        dict(repo=STRING, prompt=STRING, tickets=array(IDENTITY, 20)), ('repo',),
        description='Predict live runs in a project whose diffs already touch files a prompt is likely to edit. Read-only.')
    add('runs.attention', 'GET', '/api/mcp/attention',
        {'limit': {'type': 'integer', 'minimum': 1, 'maximum': 100},
         'cursor': {'type': 'string', 'maxLength': 100}},
        description='Read a compact paginated attention queue with pending decisions and artifact links. Restart on 409. Read-only; use existing authority-bound actions to answer or deliver.')
    add('maintenance.status', 'GET', '/api/mcp/maintenance',
        description='Read how many lines the orc-review skill and each review context file hold, '
                    'against their line budgets, so a cleanup can be judged due. Read-only.')
    add('agents.compatibility', 'GET', '/api/harness-compat',
        description='Read the last check that each installed agent CLI still works with '
                    'Orc: each installed and newest release, the releases not checked and why, and the '
                    'warnings that need the user. Read-only.')
    add('runs.get', 'GET', '/api/runs/{runId}', description='Read one existing Orc run, using a validated run identity.')
    add('runs.start', 'POST', '/api/new-conversation', launch, ('agent', 'mode', 'prompt', 'repo'), 'orc:write',
        'Start an Orc conversation in a configured project. Returns launchId and reserved run identity. '
        'With orchestration enabled, agent and model must match the lead of orchestrationPreset, '
        'or of the first preset when omitted; a preset with only lead and no task roles skips '
        'Orchestrate for change runs. Ship additionally requires orc:deliver.')
    add('launches.get', 'GET', '/api/new-conversation/{launchId}')
    add('runs.update', 'PATCH', '/api/runs/{runId}',
        dict(title={'type': 'string', 'minLength': 1, 'maxLength': 60},
             status=enum(*sorted(runtime['EDITABLE_STATUSES'])), prUrl=STRING), scope='orc:write')
    add('runs.delete', 'DELETE', '/api/runs/{runId}', scope='orc:write')
    for suffix, props in {
        'merge-queue': {}, 'tasks': {}, 'follow-ups': {}, 'skills': {},
        'chat': {'since': STRING}, 'activity': {'gatePage': STRING},
        'cost': {}, 'waterfall': {}, 'merge-blocker': {}, 'files': {'path': STRING, 'q': STRING},
        'file': {'path': STRING}, 'pull-request': {'url': STRING}, 'terminal/tabs': {},
        'chat-image': {'path': STRING, 'image': STRING},
    }.items():
        name = 'merge_queue_status' if suffix == 'merge-queue' else suffix.replace('-', '_').replace('/', '_')
        add('runs.' + name, 'GET', '/api/runs/{runId}/' + suffix,
            props, binary=suffix == 'chat-image')
    add('runs.artifact_read', 'GET', '/api/runs/{runId}/artifact', {'path': STRING}, ('path',),
        description='Read at most 256 KiB of a text artifact inside the run directory; rejects traversal and symlink escapes.')
    add('runs.artifact_feedback', 'GET', '/runs/{runId}/artifact-feedback')
    add('runs.landing_actions', 'GET', '/runs/{runId}/landing-actions',
        {'page': enum(runtime['RECAP_TAB'], runtime['PRESENT_TAB'], runtime['SHIP_TAB'])}, ('page',), fixed={'action': 'push-main'})

    review = dict(schemaVersion={'type': 'integer', 'enum': [1]}, idempotencyKey=STRING,
                  sourceDigest=STRING, generation=STRING, answers=OBJECT, text=STRING,
                  selectedFeedbackDraftIds=array(STRING, 500), feedbackBatchId={'type': ['string', 'null']},
                  delivery=enum('send', 'copy'), intent=enum('approve', 'revise', 'confirm-decisions', 'answer'))
    actions = {
        'chat-send': (dict(text=STRING), ('text',)),
        'chat-stop': ({}, ()), 'chat-resume-queue': ({}, ()),
        'chat-send-now': (dict(id=STRING), ('id',)),
        'chat-retry': (dict(turn=STRING), ('turn',)),
        'answer-question': (dict(text=STRING, action=enum('dismiss'), questionId=STRING,
                                 requestId=STRING, turnId=STRING, threadId=STRING, version=STRING, answers=OBJECT), ()),
        'btw': (dict(text=STRING, mode=enum('now', 'queue')), ('text',)),
        'send-answers': (dict(text=STRING, action=enum('pr', 'pr-push', 'pr-replies', 'feedback', 'bring-to-main',
                             'resolve-conflicts', 'final-review', 'continue-to-qa'),
                             authorityDigest=STRING, receiptDigest=STRING, gateGeneration=STRING, gatePage=STRING), ('text',)),
        'send-failed': (dict(deliveryIdentity=OBJECT), ('deliveryIdentity',)),
        'plan-review-submit': (review, ('schemaVersion', 'idempotencyKey', 'sourceDigest', 'generation', 'answers', 'text', 'intent')),
        'grilling-review-submit': (review, ('schemaVersion', 'idempotencyKey', 'sourceDigest', 'generation', 'answers', 'text', 'intent')),
        'clarification-review-submit': (review, ('schemaVersion', 'idempotencyKey', 'sourceDigest', 'generation', 'answers', 'text', 'intent')),
        'question-set-submit': (dict(kind=STRING, generation=STRING, answers=OBJECT, notes=STRING, chatSubmission=STRING,
                                     delivery=enum('send', 'copy')), ('kind', 'generation', 'answers')),
        'send-review': (dict(body=STRING, comments=array(OBJECT, 100)), ()),
        'open-session': ({}, ()), 'reopen-session': (dict(focus=BOOLEAN), ()), 'open-terminal': ({}, ()),
        'terminal-tab': (dict(action=enum('focus', 'create', 'rename', 'close'), tabId=STRING, label=STRING), ('action',)),
        'run-script': (dict(id=STRING), ('id',)),
        'worktree-launch': (dict(command=STRING), ('command',)),
        'open-in': (dict(editor=STRING, path=STRING), ()),
        'needs-you-run': (dict(artifact=STRING, command=STRING), ('command',)),
        'needs-you-open': (dict(command=STRING), ('command',)),
        'session': (dict(action=enum('close', 'kill')), ('action',)),
        'rescue': (dict(agent=enum(*runtime['NEW_CONV_AGENTS']), model=STRING, effort=STRING,
                        fast={'type': ['boolean', 'string']}, claudeAccount=STRING,
                        expectedOwner=STRING, expectedGeneration=STRING, prompt=STRING,
                        recoveryNotes=schema({key: {'type': 'string', 'maxLength': 4000}
                            for key in ('outcome', 'decisions', 'checks', 'failedHypotheses', 'nextStep')})),
                   ('agent', 'expectedOwner')),
        'fork': (dict(project=STRING, text=STRING, agent=STRING, model=STRING, effort=STRING,
                      claudeAccount=STRING, orchestration=BOOLEAN, token=STRING, launchToken=STRING,
                      mode=enum(*runtime['CONTEXT_CHILD_MODES'])), ()),
        'follow-up': (dict(text=STRING, agent=enum(*runtime['NEW_CONV_AGENTS']), claudeAccount=STRING,
                           model=STRING, effort=STRING, orchestration=BOOLEAN, childRunId=IDENTITY,
                           takeOver=BOOLEAN, mode=enum(*runtime['CONTEXT_CHILD_MODES'])), ()),
        'cancel': (dict(reason=STRING), ()), 'push-main': ({}, ()), 'deploy-retry': ({}, ()),
        'deploy-dismiss': ({}, ()),
        'planning-start': (dict(step={'type': 'integer', 'minimum': 1}, each=BOOLEAN, now=BOOLEAN,
                                agent=enum(*runtime['NEW_CONV_AGENTS']), model=STRING, effort=STRING,
                                fast={'type': ['boolean', 'string']}, permissionMode=STRING,
                                claudeAccount=STRING, orchestration=BOOLEAN, orchestrationPreset=STRING), ()),
        'planning-done': ({}, ()), 'plan-reveal': ({}, ()),
        'sibling': (dict(repo=STRING, task=STRING, agent=enum(*runtime['NEW_CONV_AGENTS']), model=STRING,
                         effort=STRING, fast={'type': ['boolean', 'string']}, permissionMode=STRING,
                         claudeAccount=STRING, orchestration=BOOLEAN, orchestrationPreset=STRING),
                    ('repo', 'task')),
        'review-action': (dict(reviewAction=enum('close'), resultDigest=STRING), ()),
        'link': (dict(op=enum('add', 'remove'), targetRunId=IDENTITY, type=STRING), ('op', 'targetRunId')),
        'pr-body': (dict(path=STRING, text=STRING), ('path', 'text')),
        'pr-replies': (dict(card=STRING, body=STRING), ('card', 'body')),
        'pr-review': (dict(target=STRING, body=STRING, kept=BOOLEAN, digest=STRING), ('target',)),
        'pr-review-post': (dict(event=enum('REQUEST_CHANGES', 'COMMENT', 'APPROVE'),
                                digest={'type': 'string', 'pattern': '^[0-9a-f]{64}$'}), ('event', 'digest')),
        'focus': (dict(action=enum('prioritise', 'start')), ('action',)),
        'start-now': ({}, ()),
        'merge-queue': (dict(receiptDigest=STRING, authorityDigest=STRING, action=enum('enqueue-merge'), pushAfterMerge=BOOLEAN, closePaneAfterMerge=BOOLEAN, shipAction=enum('merge', 'merge-and-push', 'yeet')), ()),
        'merge-queue-retry': ({}, ()),
        'merge-participant': (dict(participantId=STRING, receiptDigest=STRING, authorityDigest=STRING), ('participantId',)),
        'delivery-groups': (dict(sourceDigest=STRING, tickets=array(schema(dict(ticketId=STRING, groupId=STRING, branch=STRING, baseBranch=STRING), ('ticketId', 'groupId', 'branch', 'baseBranch')))), ('sourceDigest', 'tickets')),
        'artifact-feedback-draft': (dict(action=enum('create', 'delete'), draft=OBJECT, draftId=STRING, id=STRING), ()),
        'artifact-feedback-submit': (dict(batchId=STRING, draftIds=array(STRING), overallNote=STRING), ()),
        'artifact-feedback-thread': (dict(action=enum('resolve', 'reopen'), threadId=STRING), ()),
        'worktree-app': (dict(action=enum('start', 'stop', 'restart', 'cleanup')), ('action',)),
    }
    delivery = {'send-answers', 'push-main', 'deploy-retry', 'merge-queue', 'merge-queue-retry', 'merge-participant',
                'delivery-groups', 'send-review', 'pr-review-post'}
    admin = {'run-script', 'needs-you-run', 'worktree-app', 'worktree-launch'}
    native = {'open-session', 'open-terminal', 'open-in', 'needs-you-open'}
    for action, (props, required) in actions.items():
        scope = 'orc:deliver' if action in delivery else 'orc:admin' if action in admin else 'orc:write'
        add('runs.' + action.replace('-', '_'), 'POST', '/runs/{runId}/' + action,
            props, required, scope, native=action in native)
    for action, props, required in (
        ('cancel', dict(taskId=IDENTITY), ('taskId',)),
        ('configure', dict(enabled=BOOLEAN), ('enabled',)),
        ('delegate', dict(text=STRING, kind=enum('research', 'review'), project=STRING,
                          agent=STRING, model=STRING, effort=STRING, requestId=STRING), ('text', 'requestId')),
    ):
        add('tasks.' + action, 'POST', '/runs/{runId}/tasks', props, required, 'orc:write', fixed={'action': action})
    add('gates.save_answers', 'POST', '/runs/{runId}/{answerFile}',
        dict(answerFile=STRING, answers=OBJECT, generation={'type': 'string', 'pattern': r'\d{8}-\d{6}(?:-\d+)?'}), ('answers',), 'orc:write')
    specs[-1].input_schema['properties']['answerFile'] = enum(*sorted(runtime['ANSWER_FILES']))
    add('runs.follow_up_delete', 'DELETE', '/runs/{runId}/follow-ups/{itemId}', scope='orc:write')
    add('runs.terminal_close', 'DELETE', '/runs/{runId}/terminal', {'tab': {'type': 'integer'}}, scope='orc:write')
    add('runs.merge_queue_remove', 'DELETE', '/runs/{runId}/merge-queue', scope='orc:deliver')

    note = schema({key: {'type': 'number'} for key in ('x', 'y', 'w', 'h', 'z')}, ('x', 'y', 'w', 'h', 'z'))
    note['type'] = ['object', 'null']
    # Tickets carry no project or composer settings. Both are still accepted so
    # an older caller's ticket is not refused; the server ignores them.
    ticket = dict(project=dict(STRING, description='Ignored: tickets carry no project.'), status=STRING, body=STRING, rank={'type': ['number', 'null']},
                  note=note, launch={'description': 'Ignored: tickets carry no composer settings.'},
                  runId=IDENTITY, unlinkRunId=IDENTITY, clientRequestId=STRING)
    add('tickets.list', 'GET', '/api/tickets', dict(full=BOOLEAN))
    add('tickets.get', 'GET', '/api/tickets/{ticketId}')
    add('tickets.create', 'POST', '/api/tickets', dict(ticket, images=array(STRING, runtime['TICKET_IMAGES_MAX'])),
        scope='orc:write', description='Create a ticket. images takes the references attachments_upload returned.')
    add('tickets.update', 'POST', '/api/tickets/{ticketId}',
        dict(ticket, addImages=array(STRING, runtime['TICKET_IMAGES_MAX']),
             removeImages=array(STRING, runtime['TICKET_IMAGES_MAX'])),
        scope='orc:write',
        description='Update a ticket. addImages takes references attachments_upload returned; removeImages takes stored image filenames.')
    add('tickets.delete', 'POST', '/api/tickets/{ticketId}/delete', scope='orc:write')
    add('tickets.image_read', 'GET', '/api/ticket-images/{filename}', binary=True)
    add('tickets.run', 'POST', '/api/tickets/{ticketId}/run',
        dict(project=STRING, **{key: launch[key] for key in
                                ('agent', 'mode', 'transport', 'permissionMode', 'effort', 'claudeAccount')}),
        ('project', 'agent', 'mode'), scope='orc:write',
        description='Start a run from a ticket in project, a configured project path. Tickets name no project.')
    assistant_fields = dict(persona=enum('gary', 'sheila'), agent=STRING, model=STRING, effort=STRING,
                            tools=array(STRING, 100), accountConnectors=array(STRING, 20), mcpServers=OBJECT,
                            checkIn=OBJECT, wisprNotes=OBJECT, baseUpdatedAt=STRING)
    add('assistant.get', 'GET', '/api/assistant', scope='orc:admin',
        description="This machine's assistant: its settings, memory, notebook and whether it is read-only here.")
    add('assistant.update', 'POST', '/api/assistant', assistant_fields, scope='orc:admin')
    add('assistant.memory', 'POST', '/api/assistant/memory',
        dict(text=STRING, baseMtime={'type': ['number', 'null']}), ('text',), 'orc:admin')
    add('assistant.note', 'GET', '/api/assistant/notes/{path}', scope='orc:admin')
    specs[-1].input_schema['properties']['path'] = {'type': 'string', 'minLength': 1, 'maxLength': 1024}
    add('assistant.chat', 'GET', '/api/orchestrator', scope='orc:admin',
        description="The assistant's chat: its topics, the main stream and whether it is replying.")
    add('assistant.topic', 'GET', '/api/orchestrator/topics/{topicId}', scope='orc:admin',
        description="One topic's thread, cards and linked runs.")
    add('assistant.chat_send', 'POST', '/api/orchestrator/send', dict(text=STRING, topic=IDENTITY, id=IDENTITY),
        ('text',), 'orc:admin', description="Send the assistant a message, in the main stream or one topic's thread.")
    add('assistant.chat_stop', 'POST', '/api/orchestrator/stop', scope='orc:admin')
    add('assistant.wispr', 'GET', '/api/orchestrator/wispr', scope='orc:admin',
        description="The assistant's check of your Wispr notes: whether it runs hourly, is running now, and what "
                    "the last one found.")
    add('assistant.wispr_check', 'POST', '/api/orchestrator/wispr/check', scope='orc:admin',
        description="Check your Wispr notes now. New notes worth acting on reach the assistant as one message.")
    job_fields = dict(title=STRING, kind=enum('remind', 'ask'), text=STRING, schedule=OBJECT, enabled=BOOLEAN)
    add('assistant.jobs', 'GET', '/api/orchestrator/jobs', scope='orc:admin',
        description="The assistant's jobs: Orc's built-in checks with their switches, and the reminders and "
                    "prompts the user set, each with its schedule, next run and last run.")
    add('assistant.job_create', 'POST', '/api/orchestrator/jobs', job_fields, ('title', 'kind', 'schedule'),
        'orc:admin', description="Add a job: kind remind posts title and text in the main conversation, ask sends "
                                 "them to the assistant. schedule is {type: once, at: YYYY-MM-DDTHH:MM}, {type: "
                                 "days, times, days, everyWeeks} or {type: every, minutes}.")
    add('assistant.job_update', 'POST', '/api/orchestrator/jobs/{jobId}', job_fields, scope='orc:admin',
        description="Change one of the user's jobs, or switch a built-in job on or off with enabled alone.")
    add('assistant.job_delete', 'POST', '/api/orchestrator/jobs/{jobId}/delete', scope='orc:admin')
    add('assistant.job_run', 'POST', '/api/orchestrator/jobs/{jobId}/run', scope='orc:admin',
        description="Run one of the user's jobs now, whatever its schedule says.")
    for name, route, props, scope in (
        ('projects.status', '/api/repo-status', dict(project=array(STRING), commits=BOOLEAN), 'orc:read'),
        ('projects.delete_preview', '/api/project-delete', dict(project=STRING), 'orc:admin'),
        ('projects.worktree_server', '/api/worktree-server', dict(project=STRING), 'orc:read'),
        ('projects.check_path', '/api/check-path', dict(path=STRING), 'orc:admin'),
        ('projects.path_complete', '/api/path-complete', dict(prefix=STRING), 'orc:admin'),
        ('projects.github_repos', '/api/github-repos', dict(q=STRING), 'orc:admin'),
        ('config.get', '/api/config', {}, 'orc:read'),
        ('servers.list', '/api/servers', {}, 'orc:read'),
        ('servers.dev_list', '/api/dev-servers', {}, 'orc:read'),
        ('sessions.restore_candidates', '/api/restore-candidates', dict(ids=STRING), 'orc:read'),
        ('skills.list', '/api/skills', dict(repo=STRING, agent=STRING), 'orc:read'),
        ('app.status', '/api/app', {}, 'orc:read'),
        ('runs.needs_you', '/api/needs-you/{runId}', {}, 'orc:read'),
        ('usage.get', '/api/usage', dict(range=STRING), 'orc:read'),
        ('providers.usage', '/api/provider-usage', dict(refresh=BOOLEAN), 'orc:read'),
        ('prs.list', '/api/prs', dict(refresh=BOOLEAN), 'orc:read'),
        ('prs.get', '/api/prs/pr', dict(url=STRING), 'orc:read'),
        ('prs.repos', '/api/prs/repos', dict(q=STRING, refresh=BOOLEAN), 'orc:read'),
        ('desktop.update_status', '/api/desktop-update', {}, 'orc:read'),
        ('sidebar.get', '/api/sidebar-settled', {}, 'orc:read'),
        ('lan.status', '/api/lan', {}, 'orc:admin'),
        ('merge.candidates', '/api/merge-candidates', dict(run=array(IDENTITY)), 'orc:read'),
        ('merge.plan_get', '/api/merge-plans/{planId}', dict(live=BOOLEAN), 'orc:read'),
    ):
        add(name, 'GET', route, props, scope=scope)
    for name, route, props, scope in (
        ('projects.add', '/api/project-add', dict(path=STRING), 'orc:admin'),
        ('projects.clone', '/api/project-clone', dict(repo=STRING, dir=STRING), 'orc:admin'),
        ('projects.delete', '/api/project-delete', dict(project=STRING, confirmationToken=STRING), 'orc:admin'),
        ('projects.action', '/api/repo-action', dict(project=STRING, action=enum('fetch', 'pull', 'push')), 'orc:admin'),
        ('config.update', '/api/config', dict(config=OBJECT, baseMtime={'type': ['number', 'null']}), 'orc:admin'),
        ('servers.main', '/api/servers/main', dict(project=STRING, action=enum('start', 'stop', 'restart')), 'orc:admin'),
        ('servers.visibility', '/api/servers/visibility', dict(project=STRING, hidden=BOOLEAN), 'orc:write'),
        ('servers.stop', '/api/dev-servers/stop', dict(run=IDENTITY, serverToken=STRING), 'orc:admin'),
        ('app.navigate', '/api/navigate', dict(fragment=STRING, auto=BOOLEAN, force=BOOLEAN, foreground=BOOLEAN), 'orc:write'),
        ('sidebar.update', '/api/sidebar-settled', {'runId': IDENTITY, 'settled': BOOLEAN, 'import': OBJECT}, 'orc:write'),
        ('usage.record', '/api/usage/events', dict(events=array(OBJECT)), 'orc:write'),
        ('providers.renewal_day', '/api/provider-usage/renewal-day',
         dict(account=STRING, day={'type': ['integer', 'null'], 'minimum': 1, 'maximum': 31}), 'orc:write'),
        ('providers.excluded_window', '/api/provider-usage/excluded-window',
         dict(account=STRING, label=STRING, excluded=BOOLEAN), 'orc:write'),
        ('prs.refresh', '/api/prs/refresh', {}, 'orc:write'),
        ('prs.onboarding', '/api/prs/onboarding',
         dict(mode=enum('all', 'selected'), orgs=array(STRING, 200), repos=array(STRING, 1000)), 'orc:write'),
        ('prs.review', '/api/prs/review', dict(url=STRING, agent=enum(*runtime['NEW_CONV_AGENTS']), orchestration=BOOLEAN), 'orc:write'),
        ('prs.merge', '/api/prs/merge', dict(url=STRING, headOid=STRING), 'orc:deliver'),
        ('lan.pairing_code', '/api/lan/pairing-code', {}, 'orc:admin'),
        ('lan.sign_out_all', '/api/lan/sign-out-all', {}, 'orc:admin'),
        ('merge.batch', '/api/merge-batch', dict(runs=array(OBJECT)), 'orc:deliver'),
        ('merge.plan_create', '/api/merge-plans', dict(runIds=array(IDENTITY)), 'orc:write'),
        ('merge.plan_order', '/api/merge-plans/{planId}/order', dict(order=array(IDENTITY)), 'orc:write'),
        ('merge.plan_submit', '/api/merge-plans/{planId}/merge', dict(runs=array(OBJECT)), 'orc:deliver'),
        ('gallery.create', '/api/gallery-gif', dict(frames=array({'type': 'string', 'maxLength': runtime['GALLERY_GIF_MAX_FRAME_BYTES'] * 2}, runtime['GALLERY_MP4_MAX_FRAMES']), title=STRING, delayCs={'type': 'integer'}, format=enum('gif', 'mp4'), deliver=enum('link', 'download', 'copy'), fps={'type': 'number'}), 'orc:write'),
    ):
        add(name, 'POST', route, props, scope=scope, native=name == 'app.navigate')
    upload = dict(base64={'type': 'string', 'maxLength': 4 * ((MAX_BINARY_BYTES + 2) // 3)},
                  mimeType=enum(*runtime['ATTACHMENT_TYPES']), filename={'type': 'string', 'maxLength': 255})
    for prefix, route in (('attachments', '/api/attachments'), ('runs.attachments', '/runs/{runId}/attachments')):
        add(prefix + '_upload', 'POST', route, upload, ('base64', 'mimeType'), 'orc:write', binary=True)
        add(prefix + '_read', 'GET', route + '/{filename}', binary=True)
        add(prefix + '_delete', 'DELETE', route + '/{filename}', scope='orc:write')
    add('projects.icon', 'GET', '/api/project-icon', dict(project=STRING), ('project',), binary=True)
    add('gallery.read', 'GET', '/api/gallery-gif/{token}', binary=True)
    add('exports.create', 'GET', '/api/export', dict(projects=array(STRING)), ('projects',), 'orc:admin',
        'Export runs for selected projects. Returns a private archive handle; use downloads.read then downloads.release. Handles expire after 15 minutes.')
    add('backups.create', 'GET', '/api/backup-runs', scope='orc:admin',
        description='Back up all runs. Returns a private archive handle; use downloads.read then downloads.release. Handles expire after 15 minutes.')
    handle = {'type': 'string', 'pattern': r'^[A-Za-z0-9_-]{43}$'}
    add('downloads.read', 'GET', '/api/mcp/downloads',
        dict(handle=handle, offset={'type': 'integer', 'minimum': 0},
             length={'type': 'integer', 'minimum': 1, 'maximum': exports.MAX_CHUNK_BYTES}), ('handle',), 'orc:admin',
        'Read a bounded archive chunk as base64. Continue at nextOffset until eof is true; no filesystem paths are accepted.')
    add('downloads.release', 'DELETE', '/api/mcp/downloads', dict(handle=handle), ('handle',), 'orc:admin',
        'Release a private archive handle and delete its temporary storage.')
    return {spec.name: spec for spec in specs}


class ApplicationRequest:
    def __init__(self, method, path, body=b'', headers=None):
        self.command, self.path = method, path
        self.headers = {'Content-Length': str(len(body)), 'Content-Type': 'application/json', **(headers or {})}
        self.rfile = io.BytesIO(body)
        self.result = None

    def _lan_gate(self):
        return True

    def _on_lan(self):
        return False

    def _respond(self, status, body=b'', ctype=None, extra_headers=None):
        if len(body) > MAX_RESULT_BYTES:
            raise OperationError(413, 'operation result exceeds the MCP size limit')
        ctype = ctype or 'application/json'
        if ctype.startswith('application/json'):
            data = json.loads(body) if body else None
        else:
            if len(body) > MAX_BINARY_BYTES:
                raise OperationError(413, 'binary result exceeds 10 MB; use the app download')
            data = {'base64': base64.b64encode(body).decode('ascii'), 'mimeType': ctype, 'size': len(body)}
        self.result = OperationResult(data, status, ctype, extra_headers or {})

    def send_error(self, code, message=None, explain=None):
        return self.json_error(code, message or {400: 'bad request', 403: 'forbidden', 404: 'not found'}.get(code, 'request failed'), False)

    def send_file(self, full):
        with open(full, 'rb') as source:
            body = source.read(MAX_BINARY_BYTES + 1)
        if len(body) > MAX_BINARY_BYTES:
            raise OperationError(413, 'binary result exceeds 10 MB; use the app download')
        import mimetypes
        return self._respond(200, body, mimetypes.guess_type(str(full))[0] or 'application/octet-stream')


def application_request(runtime, method, path, body=b'', headers=None):
    # Both transports inherit these methods so lifecycle checks keep their original lock boundaries.
    cls = type('LocalApplicationRequest', (ApplicationRequest, runtime['ApplicationHandler']), {})
    return cls(method, path, body, headers)


def runs_list(runtime, *, raw=False):
    body, etag = runtime['runs_payload_bytes']()
    return OperationResult(body if raw else json.loads(body), headers={'ETag': etag})


def run_directory(runtime, run_id):
    validate(run_id, IDENTITY, 'runId')
    root = Path(runtime['RUNS']).resolve()
    path = (root / run_id).resolve()
    if path.parent != root or path != root / run_id:
        raise OperationError(400, 'invalid run identity')
    if not path.is_dir():
        raise OperationError(404, 'run not found')
    return path


def runs_get(runtime, arguments):
    run_directory(runtime, arguments['runId'])
    return OperationResult(runtime['run_meta'](arguments['runId']))


def runs_start(runtime, arguments):
    if len(json.dumps(arguments, allow_nan=False).encode()) > 256 * 1024:
        raise OperationError(400, 'empty or oversized body')
    request = application_request(runtime, 'POST', '/api/new-conversation')
    request.start_run(arguments)
    return request.result


class OperationService:
    def __init__(self, runtime):
        self.runtime = runtime
        self.operations = build_catalog(runtime)

    def catalog(self):
        """The operations this server answers now: a plugin's operations
        appear only while that plugin is serving."""
        return [spec.descriptor() for spec in self.operations.values()
                if spec.plugin is None or self.runtime['app_plugin_service'](spec.plugin) is not None]

    def call(self, name, arguments, scopes=()):
        try:
            spec = self.operations.get(name) if isinstance(name, str) else None
            if spec is None:
                raise OperationError(404, 'unknown operation')
            if not isinstance(scopes, (list, tuple, set)) or any(s not in SCOPES for s in scopes):
                raise OperationError(403, 'invalid operation scopes')
            if spec.scope not in scopes:
                raise OperationError(403, 'operation requires ' + spec.scope)
            validate(arguments, spec.input_schema)
            if arguments.get('launchAction') == 'ship' and 'orc:deliver' not in scopes:
                raise OperationError(403, 'Ship launch requires orc:deliver')
            if name == 'projects.action' and arguments.get('action') == 'push' and 'orc:deliver' not in scopes:
                raise OperationError(403, 'repository push requires orc:deliver')
            if name == 'runs.list':
                result = runs_list(self.runtime)
            elif name == 'runs.attention':
                result = OperationResult(attention.feed(self.runtime, arguments, OperationError))
            elif name == 'maintenance.status':
                result = OperationResult(maintenance.status(SKILLS_DIR))
            elif name == 'runs.get':
                result = runs_get(self.runtime, arguments)
            elif name == 'runs.start':
                result = runs_start(self.runtime, arguments)
            elif name == 'runs.artifact_read':
                result = self.read_artifact(arguments)
            elif name == 'exports.create':
                result = OperationResult(exports.create(self.runtime, arguments['projects']))
            elif name == 'backups.create':
                result = OperationResult(exports.create(self.runtime))
            elif name == 'downloads.read':
                result = OperationResult(exports.read(**arguments))
            elif name == 'downloads.release':
                result = OperationResult(exports.release(arguments['handle']))
            else:
                result = self.dispatch(spec, arguments)
            if result is None:
                raise OperationError(500, 'operation returned no result')
            if len(json.dumps(result.envelope()).encode()) > MAX_RESULT_BYTES:
                raise OperationError(413, 'operation result exceeds the MCP size limit')
            return result
        except (OperationError, exports.ExportError) as error:
            return OperationResult({'error': str(error), 'retryable': False}, error.status)
        except (ValueError, TypeError, OSError) as error:
            return OperationResult({'error': 'operation failed: ' + str(error), 'retryable': False}, 400)

    def dispatch(self, spec, arguments):
        route = spec.route
        args = dict(arguments)
        for key in re.findall(r'{(\w+)}', route):
            route = route.replace('{' + key + '}', quote(args.pop(key), safe=''))
        if '{runId}' in spec.route:
            run_directory(self.runtime, arguments['runId'])
        args.update(spec.fixed)
        headers = {}
        if spec.name == 'gates.save_answers':
            if args.get('generation'):
                route = route[:-5] + '.' + args['generation'] + '.json'
            args = args['answers']
        if spec.binary and spec.method == 'POST':
            try:
                body = base64.b64decode(args['base64'], validate=True)
            except (ValueError, binascii.Error):
                raise OperationError(400, 'invalid base64 image') from None
            if not 0 < len(body) <= MAX_BINARY_BYTES:
                raise OperationError(413, 'image must be between 1 byte and 10 MB')
            headers = {'Content-Type': args['mimeType'], 'X-Orc-Filename': args.get('filename', 'image')}
        elif spec.method in ('GET', 'DELETE'):
            query = {key: ('1' if value else '0') if type(value) is bool else value for key, value in args.items()}
            if query:
                route += '?' + urlencode(query, doseq=True)
            body = b''
        else:
            body = json.dumps(args, allow_nan=False).encode()
        request = application_request(self.runtime, spec.method, route, body, headers)
        getattr(request, 'do_' + spec.method)()
        return request.result

    def read_artifact(self, arguments):
        root = run_directory(self.runtime, arguments['runId'])
        relative = Path(arguments['path'])
        if relative.is_absolute() or '..' in relative.parts or any(p.startswith('.') for p in relative.parts):
            raise OperationError(400, 'artifact must be a relative run path')
        path = (root / relative).resolve()
        if not path.is_relative_to(root):
            raise OperationError(400, 'artifact escapes run directory')
        if any(part.startswith('.') for part in path.relative_to(root).parts):
            raise OperationError(400, 'artifact resolves to private run state')
        if path.suffix not in ('.md', '.mdx', '.txt', '.log', '.json', '.jsonl', '.patch', '.diff'):
            raise OperationError(415, 'artifact is not a supported text type')
        if not path.is_file():
            raise OperationError(404, 'artifact not found')
        with path.open('rb') as source:
            raw = source.read(256 * 1024 + 1)
        return OperationResult({'path': str(relative), 'text': raw[:256 * 1024].decode('utf-8', 'replace'),
                                'truncated': len(raw) > 256 * 1024})
