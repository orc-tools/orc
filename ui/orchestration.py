"""Scoped automated worker execution and explicit result publication."""
from __future__ import annotations

import hashlib
import fcntl
import json
import math
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

import harnesses
import run_relationships
import run_tasks
import orchestrator_tools
import claude_accounts
import project_trust

ROLES = frozenset(orchestrator_tools.ROLES)
WRITE_ROLES = frozenset({'implementation', 'test', 'general'})
READ_ONLY_ROLES = ROLES - WRITE_ROLES
# Design writes the files its task declares, since mockups and variants have
# to be committed, and is read-only with none, so a proposal can still run
# before the build branch exists.
FILES_DECIDE_ROLES = frozenset({'design'})
TERMINAL = frozenset({'completed', 'failed', 'cancelled', 'interrupted'})
EFFORTS = ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')


def task_writes(role, files):
    """Whether a task may change its repository: its role says so, or for
    design its declared files do."""
    return role in WRITE_ROLES or (role in FILES_DECIDE_ROLES and bool(files))


def effort_within(span, requested, levels, default='medium'):
    """The effort a routed task runs at: requested, or default when none was
    asked for, held inside span (lowest, highest) among the levels its model
    takes. None when the model takes no effort."""
    levels = [level for level in EFFORTS if level in levels]
    if not levels:
        return None
    low, high = (EFFORTS.index(level) for level in span or (levels[0], levels[-1]))
    def off(level):
        at = EFFORTS.index(level)
        return max(low - at, at - high, 0)
    # A range the model cannot reach leaves the level nearest to it.
    inside = [level for level in levels if off(level) == min(map(off, levels))]
    wanted = EFFORTS.index(requested if requested in EFFORTS else default)
    return min(inside, key=lambda level: abs(EFFORTS.index(level) - wanted))


def git(cwd, *args):
    process = subprocess.run(['git', '-C', str(cwd), *args], capture_output=True, text=True)
    if process.returncode:
        raise ValueError(process.stderr.strip() or 'git command failed')
    return process.stdout.strip()


def is_ancestor(cwd, commit, head):
    return subprocess.run(['git', '-C', str(cwd), 'merge-base', '--is-ancestor', commit, head],
                          capture_output=True).returncode == 0


def run_branch_base(cwd, base, head, branch):
    # A coordinator that rebases its run branch asks workers to rebase onto it,
    # so any commit the run branch has pointed at is coordinator-owned history.
    # Measuring from the closest one keeps the ownership check on the worker's
    # own commits.
    candidates = [base]
    if branch:
        try:
            candidates += git(cwd, 'reflog', 'show', '--format=%H', '-n', '500', f'refs/heads/{branch}', '--').splitlines()
        except ValueError:
            pass
    ancestors = [commit for commit in dict.fromkeys(candidates) if is_ancestor(cwd, commit, head)]
    if not ancestors:
        return base
    return min(ancestors, key=lambda commit: int(git(cwd, 'rev-list', '--count', f'{commit}..{head}')))


def atomic(path, text):
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name)
    try:
        with os.fdopen(descriptor, 'w') as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)



class Service:
    def __init__(self, host):
        self.h = SimpleNamespace(**host)

    def call(self, run_id, tool, args):
        if not isinstance(args, dict):
            raise ValueError('tool arguments must be an object')
        if not run_relationships.valid_run_id(run_id):
            raise ValueError('invalid run id')
        handlers = {
            'capabilities': self.capabilities, 'delegate_task': self.delegate,
            'task_status': self.status, 'task_complete': self.complete,
            'stop_task': self.stop, 'thread_list': self.threads,
            'thread_read': self.read, 'thread_send': self.send,
            'thread_wait': self.wait, 'thread_interrupt': self.interrupt,
        }
        aliases = {'orchestrator_capabilities': 'capabilities', 'task_cancel': 'stop_task',
                   'orc_thread_list': 'thread_list', 'orc_thread_read': 'thread_read',
                   'orc_thread_send': 'thread_send', 'orc_thread_wait': 'thread_wait',
                   'orc_thread_interrupt': 'thread_interrupt'}
        handler = handlers.get(aliases.get(tool, tool))
        if not handler:
            raise ValueError('unknown orchestration tool')
        return handler(run_id, args)

    def active(self, run_id):
        if self.h.IS_PREVIEW:
            raise ValueError('orchestration unavailable in preview')
        if not self.h.task_parent_active(run_id):
            raise ValueError('orchestration requires an active run')
        if not run_tasks.policy(self.h.CONFIG_DIR, run_id).get('enabled'):
            raise ValueError('orchestration disabled for this run')
        meta = self.h.run_meta(run_id)
        if meta.get('route') == 'orchestration-worker':
            task = run_tasks.task_by_child(self.h.CONFIG_DIR, run_id)
            if not task or task['state'] in TERMINAL:
                raise ValueError('delegated worker task is terminal')
        return meta

    def home_provider(self, meta):
        if meta.get('harness') == 'codex' or meta.get('harness') not in (None, *harnesses.CORE_AGENTS):
            return meta['harness']
        return (self.h.run_claude_account(meta) or '.claude').lstrip('.')

    def routes(self, meta):
        """{role: route} from the user's Orchestrate rules: where a task with
        that role runs, whatever the coordinator asks for. Empty for a
        standalone review, whose tasks stay on the review's own agent."""
        read = getattr(self.h, 'orchestration_rules', None)
        if read is None or meta.get('route') == 'local-review':
            return {}
        rules = read(meta) or {}
        return {role: found for role, found in (rules.get('routes') or {}).items() if role in ROLES}

    def route_instance(self, meta, provider):
        """(provider instance, None) for a route's agent, or (None, why it
        cannot run here). Claude means the coordinator's own login when it is
        on Claude, else the first one signed in."""
        if provider in harnesses.CORE_AGENTS:
            logins = [choice['value'] for choice in self.h.task_agent_choices()
                      if (choice['value'] == 'codex') == (provider == 'codex')]
            home = self.home_provider(meta)
            if not logins:
                return None, harnesses.label(provider) + ' is not installed on this computer'
            return (home if home in logins else logins[0]), None
        harness = harnesses.get(provider)
        if harness is None:
            return None, harnesses.refusal(provider) or harnesses.label(provider) + ' is unavailable'
        if not hasattr(harness, 'orchestration_provider') or not hasattr(harness, 'task_selection'):
            return None, harnesses.label(provider) + ' cannot run delegated tasks'
        return provider, None

    def route_target(self, meta, found):
        """(provider instance, model, None) for a route, or (None, None, why
        it cannot run here). A cloud harness the user has not picked for this
        project runs its mode as the same model on this machine, which is what
        the composer does with it there."""
        provider, model = found['provider'], found['model']
        offered = getattr(self.h, 'harness_offered', None)
        if (provider not in harnesses.CORE_AGENTS and offered is not None
                and not offered(provider, meta.get('mainRepoPath') or meta.get('repoPath'))):
            local = harnesses.local_mode(provider, model)
            if local is None:
                return None, None, harnesses.label(provider) + ' is not picked for this project'
            provider, model = local
        instance, reason = self.route_instance(meta, provider)
        return instance, (None if reason else model), reason

    def routed_selection(self, run_id, role, instance, model, found, effort):
        agent = instance if instance == 'codex' or harnesses.get(instance) is not None else 'claude'
        levels = [level for level in EFFORTS if self.h.valid_launch_effort(agent, level, model)]
        try:
            return self.h.task_selection(run_id, instance, model,
                                         effort_within(found.get('effort'), effort, levels))
        except ValueError as error:
            raise ValueError(self.route_refusal(role, found, str(error))) from error

    def route_refusal(self, role, found, reason):
        return ('Orchestrate routes %s tasks to %s on %s, which cannot run here: %s. Do this task inline, '
                'or ask the user to change the route in Orchestrate settings.'
                % (role, found['model'], harnesses.label(found['provider']), reason))

    def capabilities(self, run_id, args):
        inherited = self.h.run_meta(run_id)
        home = self.home_provider(inherited)
        routes, routed = {}, []
        for role, found in self.routes(inherited).items():
            instance, model, reason = self.route_target(inherited, found)
            routes[role] = {'providerInstanceId': instance or found['provider'], 'model': model or found['model'],
                            **({'effort': dict(zip(('min', 'max'), found['effort']))} if found.get('effort') else {}),
                            **({'fast': found['fast']} if found.get('fast') else {}),
                            **({'unavailable': reason} if reason else {})}
            if instance and instance != home and instance not in routed:
                routed.append(instance)
        available = [choice for choice in self.h.task_agent_choices() if choice['value'] in (home, *routed)]
        source = (Path(__file__).parent / 'js' / 'launch-selection.js').read_text()
        models = {
            provider: re.findall(r"\['([^']+)', '([^']+)'", block)
            for provider, block in re.findall(r'(claude|codex): \[(.*?)\n  \]', source, re.S)
        }
        # A harness package is not a Run Control task agent, so a harness is
        # offered only to its own coordinator or as a route's agent, and only
        # while enabled.
        own = [harness.orchestration_provider() for harness in map(harnesses.get, (home, *routed))
               if harness is not None and hasattr(harness, 'orchestration_provider')]
        return {'inheritedRuntime': {'permissionMode': inherited.get('launchPermissionMode', 'default'),
                    'effort': inherited.get('launchEffort'), 'fast': inherited.get('launchFast', False)},
                'enabled': run_tasks.policy(self.h.CONFIG_DIR, run_id).get('enabled', False),
                'providers': [{'providerInstanceId': choice['value'],
                               'provider': 'codex' if choice['value'] == 'codex' else 'claude',
                               'runtimeModes': ['inherit'] + ([] if inherited.get('launchPermissionMode') in ('readOnly', 'plan') else ['default']) + (['auto'] if choice['value'] != 'codex' and inherited.get('launchPermissionMode') in ('bypass', 'auto') else []) + (['bypassPermissions' if choice['value'] != 'codex' else 'danger-full-access'] if inherited.get('launchPermissionMode') == 'bypass' else []),
                               'options': {'effort': list(getattr(self.h, 'NEW_CONV_EFFORT_LEVELS', {}).get('codex' if choice['value'] == 'codex' else 'claude', ('low', 'medium', 'high', 'xhigh', 'max'))), 'fast': True},
                               'models': [{'id': key, 'name': label} for key, label in
                                          models.get('codex' if choice['value'] == 'codex' else 'claude', [])]}
                              for choice in available] + own,
                'roles': {role: does for role, does in orchestrator_tools.ROLES.items()
                          if inherited.get('route') != 'local-review' or role in READ_ONLY_ROLES},
                'routes': routes,
                'isolation': ['shared', 'worktree'],
                'tools': list(orchestrator_tools.TOOLS_BY_NAME)}

    def delegate(self, run_id, args):
        meta = self.active(run_id)
        text = args.get('task', args.get('text'))
        role = args.get('role', 'general')
        if not isinstance(text, str) or not text.strip() or len(text) > 32000:
            raise ValueError('task must contain 1 to 32000 characters')
        if role not in ROLES:
            raise ValueError('invalid task role')
        files = args.get('files', [])
        if not isinstance(files, list) or any(not isinstance(item, str) or not item or
                Path(item).is_absolute() or '..' in Path(item).parts or item.startswith('.git') for item in files):
            raise ValueError('files must be repository relative paths')
        writes = task_writes(role, files)
        if writes and meta.get('route') == 'local-review':
            raise ValueError('standalone reviews may delegate only read-only tasks')
        if writes and not files:
            raise ValueError('writing tasks require explicit files')
        parent_worker = meta.get('orchestrationWorker') or {}
        if writes and parent_worker:
            if not task_writes(parent_worker.get('role'), parent_worker.get('files')):
                raise ValueError('read-only workers cannot delegate writing work')
            parent_files = parent_worker.get('files', [])
            if any(not any(item == owned or item.startswith(owned.rstrip('/') + '/')
                           for owned in parent_files) for item in files):
                raise ValueError('nested worker ownership exceeds its parent task')
        isolation = args.get('isolation', 'worktree')
        if isolation not in ('worktree', 'shared'):
            raise ValueError('invalid isolation')
        mode = args.get('mode', 'async')
        if mode not in ('async', 'wait'):
            raise ValueError('mode must be async or wait')
        timeout = self.timeout(args)
        target = args.get('target') or {}
        if not isinstance(target, dict):
            raise ValueError('target must be an object')
        raw_options = target.get('options', {})
        if not isinstance(raw_options, dict):
            raise ValueError('target options must be an object')
        options = dict(raw_options)
        if args.get('runtimeMode', 'inherit') != 'inherit':
            options['runtimeMode'] = args['runtimeMode']
        if not isinstance(options, dict):
            raise ValueError('target options must be an object')
        requested = target.get('providerInstanceId', args.get('agent', 'auto'))
        home = self.home_provider(meta)
        found = self.routes(meta).get(role)
        instance, routed_model, refusal = self.route_target(meta, found) if found else (home, None, None)
        # A route outranks the request, so its agent is the only provider a
        # coordinator may name besides its own.
        if requested not in ('auto', home, instance):
            raise ValueError("workers stay on the coordinator's plan: " + home)
        requested = home if requested == 'auto' else requested
        model = target.get('model', args.get('model'))
        main = self.h.configured_repo_cwd(meta.get('mainRepoPath') or meta.get('repoPath'))
        if not main:
            raise ValueError('run has no configured repository')
        request_id = args.get('clientRequestId', args.get('requestId'))
        request = {'text': text.strip(), 'kind': role, 'project': main, 'agent': requested,
                   'model': model, 'files': files, 'isolation': isolation, 'options': options,
                   'title': args.get('title')}
        prior = next((row for row in run_tasks.list_tasks(self.h.CONFIG_DIR, run_id)
                      if row.get('requestId') == request_id), None)
        if prior:
            selection = prior['selection']
        elif refusal:
            raise ValueError(self.route_refusal(role, found, refusal))
        elif found:
            selection = self.routed_selection(run_id, role, instance, routed_model, found, options.get('effort'))
        else:
            selection = self.h.task_selection(run_id, requested, model, options.get('effort'))
        if model and not prior and not found:
            catalogue = self.capabilities(run_id, {})['providers']
            known = next((item['models'] for item in catalogue if item['providerInstanceId'] == requested), [])
            if model not in [item['id'] for item in known] and model != meta.get('model'):
                raise ValueError('model is unavailable for selected provider')
        if prior:
            if prior['request'] != request:
                raise ValueError('request id already has different task authority')
            return self.wait_task(run_id, prior['taskId'], timeout) if mode == 'wait' else prior
        parent_cwd = meta.get('repoPath') or main
        if writes:
            branch = git(parent_cwd, 'branch', '--show-current')
            if meta.get('phase') != 'build' or not meta.get('branch') or branch != meta['branch'] \
                    or branch in ('main', 'master', meta.get('defaultBranch')):
                raise ValueError('writing tasks require the frozen parent build branch')
        permission_args = self.permissions(meta, selection, options,
                                           route_fast=found.get('fast', False) if found else None)
        task, created = run_tasks.reserve(self.h.CONFIG_DIR, run_id, request_id, request, selection)
        if not created:
            return task
        task_id = task['taskId']
        run_tasks.update_task(self.h.CONFIG_DIR, run_id, task_id, state='launching', if_active=True)
        launch_attempted = False
        try:
            workspace = self.workspace(meta, task, main)
            current = run_tasks.update_task(self.h.CONFIG_DIR, run_id, task_id, workspace=workspace)
            if current['state'] in TERMINAL:
                return current
            title = args.get('title')
            if not isinstance(title, str) or not title.strip():
                title = text.strip().splitlines()[0]
            title = ' '.join(title.split())
            if len(title) > 60:
                title = title[:59].rstrip() + '…'
            account_env = (claude_accounts.launch_env(selection.get('claudeAccount'))
                           if selection['agent'] == 'claude' else {})
            # Harness packages keep no per-project trust of Claude's or Codex's kind.
            if selection['agent'] in harnesses.CORE_AGENTS:
                trust_env = self.h.headless_session.child_env(os.environ, account_env)
                project_trust.trust_project(workspace['repoPath'], harness=selection['agent'], env=trust_env)
            worker = {'parentRunId': run_id, 'taskId': task_id, 'launchToken': task['launchToken'],
                      'workspace': workspace, 'role': role, 'files': files, 'selection': selection,
                      'title': title}
            def reserved(result):
                child_id = result.get('runId')
                run_relationships.upsert_child(self.h.CONFIG_DIR, {
                    'launchToken': task['launchToken'], 'sourceRunId': run_id,
                    'childRunId': child_id, 'targetProject': main, 'taskId': task_id,
                    'route': 'orchestration-worker'})
                run_tasks.update_task(self.h.CONFIG_DIR, run_id, task_id, childRunId=child_id)
                if run_tasks.get_task(self.h.CONFIG_DIR, run_id, task_id)['state'] == 'cancelled':
                    raise ValueError('task launch was cancelled')
            prompt = self.worker_prompt(worker, text.strip())
            current, launch_attempted = run_tasks.begin_launch(self.h.CONFIG_DIR, run_id, task_id)
            if not launch_attempted:
                return current
            spawn = self.h.spawn_headless_conversation
            result, error = spawn(
                workspace['repoPath'], selection['agent'], 'orc-task-worker', prompt,
                permission_args=permission_args, claude_account=selection.get('claudeAccount'),
                orchestration=True, worker=worker, on_reserved=reserved)
            if error:
                run_tasks.finish_launch(self.h.CONFIG_DIR, run_id, task_id, 'failed', error=str(error[1]))
            else:
                reserved(result)
                run_tasks.finish_launch(self.h.CONFIG_DIR, run_id, task_id, 'running')
        except Exception as exc:
            run_tasks.finish_launch(self.h.CONFIG_DIR, run_id, task_id,
                                  state='launching' if launch_attempted else 'failed',
                                  error=('launch acceptance unknown: ' if launch_attempted else '') + str(exc))
        if run_tasks.get_task(self.h.CONFIG_DIR, run_id, task_id)['state'] == 'cancelled':
            return self.stop(run_id, {'taskId': task_id})
        return self.wait_task(run_id, task_id, timeout) if mode == 'wait' else run_tasks.get_task(self.h.CONFIG_DIR, run_id, task_id)

    def permissions(self, meta, selection, options, route_fast=None):
        """The worker's launch arguments. route_fast is a routed role's own
        Fast choice, which outranks the request and the parent's."""
        agent = selection['agent']
        parent = meta.get('launchPermissionMode', 'default')
        desired = options.get('runtimeMode', parent)
        desired = {'bypassPermissions': 'bypass', 'danger-full-access': 'bypass'}.get(desired, desired)
        narrow = {'bypass': {'default', 'readOnly', 'plan', 'acceptEdits', 'fullAuto', 'auto'},
                  'auto': {'default', 'plan', 'acceptEdits'},
                  'acceptEdits': {'default', 'plan'}, 'fullAuto': {'default', 'readOnly'},
                  'default': {'readOnly', 'plan'}, 'readOnly': {'plan'}, 'plan': {'readOnly'}}
        allowed = self.h.NEW_CONV_PERMISSION_MODES[agent]
        if desired not in allowed:
            if 'runtimeMode' in options:
                raise ValueError('invalid runtime mode for provider')
            desired = 'readOnly' if parent == 'plan' and agent == 'codex' else 'plan' if parent == 'readOnly' and agent == 'claude' else 'default'
        # A routed worker can be on an agent with fewer modes than its parent's.
        if desired not in allowed:
            raise ValueError("%s workers cannot keep within this run's %s permission mode"
                             % (harnesses.label(agent), parent))
        if desired != parent and desired not in narrow.get(parent, set()):
            raise ValueError('worker runtime mode cannot broaden parent permissions')
        argv = list(allowed[desired]) + ['--model', selection['model']]
        effort = selection['effort']
        if not self.h.valid_launch_effort(agent, effort, selection['model']):
            raise ValueError('invalid worker effort')
        if effort is not None:
            argv += ['-c', 'model_reasoning_effort=' + json.dumps(effort)] if agent == 'codex' else ['--effort', effort]
        if 'fast' in options and type(options['fast']) is not bool:
            raise ValueError('fast must be boolean')
        if route_fast is not None:
            fast = route_fast
        elif 'fast' in options:
            fast = options['fast']
            if fast and self.h.offers_fast_mode() and agent not in self.h.NEW_CONV_FAST_ARGS:
                raise ValueError('fast mode is not available for this provider')
        else:
            fast = bool(meta.get('launchFast'))
        argv += self.h.launch_fast_args(agent, selection['model'], fast)
        return argv

    def workspace(self, meta, task, main):
        source = meta.get('repoPath') or main
        base = git(source, 'rev-parse', 'HEAD')
        isolation = task['request']['isolation']
        branch = git(source, 'branch', '--show-current')
        cwd = source
        if isolation == 'worktree':
            branch = 'orc/task-' + task['taskId']
            cwd = str(Path(main).parent / (Path(main).name + '-worktrees') / ('orc-task-' + task['taskId']))
            Path(cwd).parent.mkdir(parents=True, exist_ok=True)
            git(source, 'worktree', 'add', '-b', branch, cwd, base)
            server_fn = getattr(self.h, '_repo_worktree_server', None)
            server = server_fn({'mainRepoPath': main}) if server_fn else None
            install = server.get('install') if isinstance(server, dict) else None
            if install:
                command = install if isinstance(install, list) else ['/bin/sh', '-c', install]
                result = subprocess.run(command, cwd=cwd, capture_output=True, text=True)
                if result.returncode:
                    raise ValueError('worker install failed: ' + result.stderr[-2000:])
        return {'repoPath': cwd, 'mainRepoPath': main, 'baseCommit': base, 'branch': branch,
                'isolation': isolation, 'files': task['request']['files'],
                'initialStatus': git(cwd, 'status', '--porcelain', '--untracked-files=all')}

    def worker_prompt(self, worker, text):
        writable = task_writes(worker['role'], worker['files'])
        return ('You are an Orc delegated worker. Work only on this supplied task.\n'
                'Do not start another /orc lifecycle, approve lifecycle gates, push, merge, or publish a PR.\n'
                + ('Edit only the declared files. ' + ('Commit your isolated changes' if worker['workspace']['isolation'] == 'worktree' else 'Leave changes uncommitted for the parent; do not stage or commit other work') + ' and run targeted checks.\n'
                   if writable else 'This task is read-only. Do not modify repository files or create commits; '
                                    'return your result in the summary.\n')
                + 'Use the injected orchestration tools. Report task_complete with summary, status, and checks.\n'
                'Do not complete while your delegated children are active. The parent integrates changes.\n'
                + 'Worker authority: ' + json.dumps(worker, sort_keys=True) + '\n\nTask:\n' + text)

    def task(self, run_id, args):
        return run_tasks.get_task(self.h.CONFIG_DIR, run_id, args.get('taskId'))

    def status(self, run_id, args):
        row = self.task(run_id, args)
        result = row.get('result')
        if result and row.get('childRunId'):
            body = run_tasks.accepted_result(row, self.h.RUNS)
            row['summary'] = body.decode() if isinstance(body, bytes) else body
            acknowledge = getattr(run_tasks, 'acknowledge_result', None)
            if acknowledge and args.get('_acknowledge', True):
                refreshed = acknowledge(self.h.CONFIG_DIR, run_id, row['taskId'])
                row['delivery'] = refreshed['delivery']
        active_children = row.get('childRunId') and run_tasks.has_live_descendants(self.h.CONFIG_DIR, row['childRunId'])
        row['workState'] = 'result_available' if row.get('result') else 'waiting_for_children' if active_children else 'working'
        row['waitTimedOut'] = False
        return row

    def complete(self, run_id, args):
        directory = Path(self.h.RUNS) / run_id
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError('worker run directory is unavailable')
        with open(directory / '.task-completion.lock', 'a') as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            return self.complete_locked(run_id, args)

    def complete_locked(self, run_id, args):
        meta = self.h.run_meta(run_id)
        worker = meta.get('orchestrationWorker') or {}
        if meta.get('route') != 'orchestration-worker' or not worker:
            raise ValueError('task_complete requires a delegated worker')
        parent = worker.get('parentRunId')
        row = run_tasks.get_task(self.h.CONFIG_DIR, parent, worker.get('taskId'))
        if row.get('childRunId') != run_id or row['launchToken'] != worker.get('launchToken'):
            raise ValueError('worker identity does not match task authority')
        if row['state'] in TERMINAL:
            published = row.get('manifest') or {}
            if row['state'] in ('completed', 'failed') and published.get('summary') == (args.get('summary') or '').strip() and published.get('outcome') == args.get('status', args.get('outcome', 'completed')) and published.get('checks') == args.get('checks', []):
                run_tasks.accepted_result(row, self.h.RUNS)
                if meta.get('status') != ('complete' if row['state'] == 'completed' else 'failed'):
                    meta.update(phase='done', status='complete' if row['state'] == 'completed' else 'failed')
                    if not self.h._write_run_meta(run_id, meta):
                        raise ValueError('could not persist completed worker metadata')
                return row
            raise ValueError('task is terminal; published result is immutable')
        if run_tasks.has_live_descendants(self.h.CONFIG_DIR, run_id):
            raise ValueError('worker has active delegated children')
        summary = args.get('summary')
        if not isinstance(summary, str) or not summary.strip() or len(summary) > 64000:
            raise ValueError('summary must contain 1 to 64000 characters')
        outcome = args.get('status', args.get('outcome', 'completed'))
        if outcome not in ('completed', 'failed'):
            raise ValueError('invalid outcome')
        workspace = row.get('workspace')
        if workspace != worker.get('workspace'):
            raise ValueError('worker workspace authority changed')
        cwd, base = workspace['repoPath'], workspace['baseCommit']
        head = git(cwd, 'rev-parse', 'HEAD')
        if args.get('head') is not None and args['head'] != head:
            raise ValueError('reported head differs from live worker head')
        writes = task_writes(row['request']['kind'], row['request']['files'])
        branch = self.h.run_meta(parent).get('branch')
        if writes and workspace['isolation'] == 'worktree':
            base = run_branch_base(cwd, base, head, branch)
        if outcome == 'completed' and not is_ancestor(cwd, base, head):
            raise ValueError(f'worker head {head[:8]} descends from neither its base {base[:8]} nor any head '
                             f'of the run branch; rebase onto the run branch {branch} and complete again')
        changed = git(cwd, 'diff', '--name-only', base, head).splitlines()
        dirty = git(cwd, 'status', '--porcelain', '--untracked-files=all')
        checks = args.get('checks', [])
        if not isinstance(checks, list) or any(not isinstance(check, dict) or
                not isinstance(check.get('command'), str) or type(check.get('exitCode')) is not int for check in checks):
            raise ValueError('checks require command and integer exitCode')
        if writes:
            if outcome == 'completed' and (not checks or any(check['exitCode'] != 0 for check in checks)):
                raise ValueError('writing task completion requires passing targeted checks')
            if outcome == 'completed' and workspace['isolation'] == 'worktree' and dirty:
                raise ValueError('isolated worker must commit all changes before completion')
            if workspace['isolation'] == 'shared':
                changed += git(cwd, 'diff', '--name-only', head).splitlines()
                changed += git(cwd, 'ls-files', '--others', '--exclude-standard').splitlines()
            owned = workspace['files']
            if outcome == 'completed' and any(not any(path == item or path.startswith(item.rstrip('/') + '/') for item in owned)
                   for path in changed):
                raise ValueError('worker changed undeclared files')
        elif outcome == 'completed' and workspace['isolation'] == 'worktree' and (head != base or dirty != workspace['initialStatus']):
            raise ValueError('read-only worker modified its repository')
        manifest = {'taskId': row['taskId'], 'parentRunId': parent, 'childRunId': run_id,
                    'outcome': outcome, 'summary': summary.strip(), 'workspace': workspace,
                    'baseCommit': base, 'headCommit': head, 'changedFiles': sorted(set(changed)),
                    'checks': checks, 'dirtyFiles': dirty.splitlines() if outcome == 'failed' else []}
        run_dir = Path(self.h.RUNS) / run_id
        if run_dir.is_symlink():
            raise ValueError('worker directory is a symlink')
        content = summary.strip() + '\n'
        atomic(run_dir / 'task-result.md', content)
        atomic(run_dir / 'task-result.json', json.dumps(manifest, indent=2) + '\n')
        result = {'path': 'task-result.md', 'sha256': hashlib.sha256(content.encode()).hexdigest(),
                  'manifestPath': 'task-result.json',
                  'manifestSha256': hashlib.sha256((run_dir / 'task-result.json').read_bytes()).hexdigest()}
        self.active(parent)
        updated = run_tasks.complete_task(self.h.CONFIG_DIR, parent, row['taskId'],
                    run_id, result, manifest, status=outcome)
        meta.update(phase='done', status='complete' if outcome == 'completed' else 'failed')
        if not self.h._write_run_meta(run_id, meta):
            raise ValueError('could not persist completed worker metadata')
        return updated

    def descendants(self, run_id):
        found, pending = {}, [run_id]
        while pending:
            parent = pending.pop()
            for row in run_tasks.list_tasks(self.h.CONFIG_DIR, parent):
                child = row.get('childRunId')
                if child and child not in found:
                    found[child] = row
                    pending.append(child)
        return found

    def threads(self, run_id, args):
        return {'threads': [{'threadId': child, 'taskId': row['taskId'], 'state': row['state']}
                            for child, row in self.descendants(run_id).items()]}

    def scoped(self, run_id, args):
        child = args.get('runId', args.get('threadId'))
        if child not in self.descendants(run_id):
            raise ValueError('thread is outside this worker tree')
        return child

    def read(self, run_id, args):
        child = self.scoped(run_id, args)
        return self.h.run_chat_payload(child, args.get('cursor'))

    def send(self, run_id, args):
        self.active(run_id)
        child = self.scoped(run_id, args)
        text = args.get('text', args.get('message'))
        if not isinstance(text, str) or not text.strip() or len(text) > 32000:
            raise ValueError('message must contain 1 to 32000 characters')
        request = args.get('clientRequestId')
        if not isinstance(request, str) or not request.strip() or len(request) > 256:
            raise ValueError('thread sends require clientRequestId')
        authority = {'threadId': child, 'text': text}
        receipt, created = run_tasks.reserve_send(self.h.CONFIG_DIR, run_id, request, authority)
        if not created:
            return receipt
        error = None
        try:
            self.h.send_orchestration_message(child, text, source={'kind': 'orchestration', 'parentRunId': run_id, 'requestId': request})
        except Exception as exc:
            error = str(exc)
        return run_tasks.finish_send(self.h.CONFIG_DIR, run_id, request, error=error)

    def cancel_child(self, child):
        try:
            outcome = self.h.headless_session.interrupt(os.path.join(self.h.RUNS, child))
        except Exception as error:
            raise ValueError("worker interruption failed: " + str(error)) from error
        if outcome == 'failed':
            raise ValueError('worker interruption failed: its turn did not stop')
        return {'threadId': child, 'interrupted': outcome == 'stopped'}

    def interrupt(self, run_id, args):
        self.active(run_id)
        return self.cancel_child(self.scoped(run_id, args))

    def stop(self, run_id, args):
        row = self.task(run_id, args)
        row, cancelled = run_tasks.cancel_task(self.h.CONFIG_DIR, run_id, row['taskId'])
        errors = []
        pending = False
        for task in reversed(cancelled):
            if run_tasks.launch_pending(task):
                pending = True
                continue
            child = task.get('childRunId')
            if not child:
                run_tasks.update_task(self.h.CONFIG_DIR, task['parentRunId'], task['taskId'],
                                      cancellationPending=False, error=None)
                continue
            child_meta = self.h.run_meta(child)
            if child_meta.get('route') == 'orchestration-worker':
                child_meta['orchestrationQueueHeld'] = True
                self.h._write_run_meta(child, child_meta)
            try:
                self.cancel_child(child)
                child_meta = self.h.run_meta(child)
                child_meta.update(status='cancelled', phase='done')
                self.h._write_run_meta(child, child_meta)
                run_tasks.update_task(self.h.CONFIG_DIR, task['parentRunId'], task['taskId'],
                                      cancellationPending=False, error=None)
            except ValueError as exc:
                errors.append(str(exc))
                run_tasks.update_task(self.h.CONFIG_DIR, task['parentRunId'], task['taskId'], error=str(exc))
        if errors:
            run_tasks.update_task(self.h.CONFIG_DIR, run_id, row['taskId'], error='; '.join(errors))
            return {'taskId': row['taskId'], 'cancelled': False, 'errors': errors}
        if pending:
            return {**row, 'cancelled': False, 'cancellationPending': True}
        return run_tasks.get_task(self.h.CONFIG_DIR, run_id, row['taskId'])

    def timeout(self, args):
        timeout = args.get('timeoutMs', 600000)
        if type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 <= timeout <= 3600000:
            raise ValueError('timeoutMs must be between 0 and 3600000')
        return timeout / 1000

    def wait_task(self, run_id, task_id, timeout, acknowledge=True):
        deadline = time.monotonic() + timeout
        while True:
            row = self.status(run_id, {'taskId': task_id, '_acknowledge': acknowledge})
            if row['state'] in TERMINAL:
                return row
            if time.monotonic() >= deadline:
                row['timedOut'] = True
                row['waitTimedOut'] = True
                return row
            time.sleep(min(.5, max(0, deadline - time.monotonic())))

    def wait(self, run_id, args):
        child = self.scoped(run_id, args)
        row = self.descendants(run_id)[child]
        return self.wait_task(row['parentRunId'], row['taskId'], self.timeout(args), acknowledge=False)
