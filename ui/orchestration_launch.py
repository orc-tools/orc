"""Run-scoped orchestration credentials and harness launch configuration."""
import hmac
import json
import os
from pathlib import Path
import secrets
import shlex
import stat
import sys
import time

import harnesses
import run_relationships
import delegation_policy


def credential_path(config_dir, run_id):
    if not run_relationships.valid_run_id(run_id):
        raise ValueError('invalid orchestration run id')
    return Path(config_dir) / 'orchestration' / (run_id + '.json')


def read_credential(config_dir, run_id):
    path = credential_path(config_dir, run_id)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        details = os.fstat(fd)
        if not stat.S_ISREG(details.st_mode) or details.st_mode & 0o077 or details.st_uid != os.getuid():
            raise ValueError('orchestration credential is not private')
        with os.fdopen(fd, 'r', closefd=False) as handle:
            credential = json.load(handle)
    finally:
        os.close(fd)
    if (not isinstance(credential, dict) or credential.get('runId') != run_id
            or not isinstance(credential.get('token'), str)
            or len(credential['token']) != 64):
        raise ValueError('invalid orchestration credential')
    return credential


def issue_credential(config_dir, run_id):
    path = credential_path(config_dir, run_id)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    value = {'runId': run_id, 'token': secrets.token_hex(32), 'createdAt': time.time()}
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        read_credential(config_dir, run_id)
        return path
    with os.fdopen(fd, 'w') as handle:
        json.dump(value, handle)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    return path


def authorize(config_dir, run_id, authorization):
    try:
        token = read_credential(config_dir, run_id)['token']
        return isinstance(authorization, str) and hmac.compare_digest(authorization, 'Bearer ' + token)
    except (OSError, ValueError):
        return False


# Who does a coordinator's delegated work while no Orchestrate rule routes a
# role. orchestrate_rules.policy() supplies the wording once one does.
UNROUTED_POLICY = '''Workers share one usage limit, so start with one or two tasks. Give mechanical work a
cheaper model at low effort. Keep implementation inline unless the plan has separate
pieces with no shared files. For a trivial single operation, do it directly.
The chosen parent agent, model and account remain the coordinator. Workers run on
the coordinator's own agent and account; another provider is refused.'''


def launch_configuration(config_dir, run_id, port, root, agent, worker=None, policy=None):
    path = issue_credential(config_dir, run_id)
    bridge = str(Path(root) / 'bin' / 'orc-orchestrator')
    args = [bridge, '--run-id', run_id, '--token-file', str(path), '--port', str(port)]
    fallback = shlex.join([sys.executable, *args, 'call'])
    instructions = f'''Orc orchestration is enabled for this run. You are the coordinator.
Decide yourself what to delegate, choose models from orchestrator_capabilities, and
delegate using delegate_task, without asking the user to create tasks or select child agents.
{policy or UNROUTED_POLICY}
Use disjoint file ownership, self-contained child prompts, and stable clientRequestId
values for retries. Discover models from orchestrator_capabilities and use the selected model. A child
receives only the task you supply. For coding workers declare files and use worktree
isolation from your local committed HEAD; commit inputs before delegating dependent
code work. Uncommitted edits are not copied. Tell coding workers to commit each time
their tests pass. You own integration and final checks.
Prefer mode=async, continue your independent work, and consume returned results.
Keep each taskId. Delegate at most one review task; fix its findings yourself and check
the fixes with targeted tests rather than another review round.
A wait timeout does not cancel work. task_status reads and acknowledges a published
result. task_cancel interrupts the child and nested workers, preserving published
results. A worker with live children is still working. Do not stop the overall run
at Ship until child work is resolved and accepted. Never infer a worker result from
a quiet turn or a Ship gate. Results never approve a gate or grant delivery consent.
Use the scoped orc-orchestrator MCP tools. If this harness does not expose the MCP
server, invoke the same operations through the supported product bridge, starting
with `{fallback} orchestrator_capabilities --arguments '{{}}'`.
For delegate_task, pass a JSON object with task, role, files for writing work,
mode, isolation, clientRequestId, and optional target.providerInstanceId/model.
Give each task the role that names its work: orchestrator_capabilities says under
roles what each one is for and whether it writes.
Finish implementation and stop at Orc's normal delivery gate. Orchestration does
not grant scheduling or permission escalation authority.'''
    if worker:
        instructions = f'''You are an Orc-owned bounded delegated worker, not a lifecycle controller.
The initial /orc --launch-run command binds your session to the precreated worker
run only. Read that run's orchestrationWorker authority and execute the supplied
self-contained task. Do not classify it as a new lifecycle, open Plan or Ship gates,
push, merge, create a PR, or change run metadata. Respect the declared role and files.
Use orchestrator_capabilities and delegate_task for useful nested independent work,
keeping nested file ownership within your own and supplying self-contained prompts.
Children receive only their supplied task. Prefer mode=async and consume results
with task_status. A wait timeout does not cancel tasks. task_cancel interrupts
children and descendants. Do not complete while your delegated children are live.
For writing work use the declared workspace, run targeted checks, and commit each time
they pass, so a usage-limit failure loses little work. Shared workers leave changes for the parent. Read-only tasks do not edit files.
Publish your final summary, status and checks through task_complete, then stop.
The parent reviews and integrates your work and owns lifecycle and delivery decisions.
Use the scoped orc-orchestrator MCP tools. If unavailable, call the same supported
product bridge, starting with `{fallback} orchestrator_capabilities --arguments '{{}}'`.
The toggle requires no manual delegation form or child-agent selection by the user.'''
    policy = delegation_policy.hook_context({'status': 'running', 'orchestration': True})
    instructions = policy + ' ' + ' '.join(instructions.splitlines())
    server = {'command': sys.executable, 'args': args}
    if agent == 'claude':
        instructions_file = credential_path(config_dir, run_id).with_suffix('.instructions.md')
        descriptor = os.open(instructions_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as handle:
            handle.write(instructions + '\n')
        return ['--mcp-config', json.dumps({'mcpServers': {'orc-orchestrator': server}}),
                '--append-system-prompt-file', str(instructions_file),
                '--allowedTools', 'mcp__orc-orchestrator__*'], instructions
    instructions_file = credential_path(config_dir, run_id).with_suffix('.instructions.md')
    try:
        descriptor = os.open(instructions_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        if instructions_file.is_symlink() or instructions_file.read_text() != instructions + '\n':
            raise ValueError('orchestration launch instructions changed')
    else:
        with os.fdopen(descriptor, 'w') as handle:
            handle.write(instructions + '\n')
    harness = harnesses.get(agent)
    if harness is not None:
        return harness.orchestration_args(server), instructions
    return codex_args(server), instructions


def codex_args(server):
    return ['-c', 'mcp_servers.orc_orchestrator.command=' + json.dumps(server['command']),
            '-c', 'mcp_servers.orc_orchestrator.args=' + json.dumps(server['args']),
            '-c', 'mcp_servers.orc_orchestrator.tool_timeout_sec=3610',
            '-c', 'mcp_servers.orc_orchestrator.default_tools_approval_mode="auto"']


def read_instructions(config_dir, run_id):
    read_credential(config_dir, run_id)
    path = credential_path(config_dir, run_id).with_suffix('.instructions.md')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        details = os.fstat(fd)
        if not stat.S_ISREG(details.st_mode) or details.st_mode & 0o077 or details.st_uid != os.getuid():
            raise ValueError('orchestration instructions are not private')
        with os.fdopen(fd, 'r', closefd=False) as handle:
            return handle.read()
    finally:
        os.close(fd)


def codex_resume_args(config_dir, run_id, port, root):
    path = credential_path(config_dir, run_id)
    return codex_args({'command': sys.executable,
                       'args': [str(Path(root) / 'bin/orc-orchestrator'), '--run-id', run_id,
                                '--token-file', str(path), '--port', str(port)]})


def claude_resume_args(config_dir, run_id, port, root):
    read_instructions(config_dir, run_id)
    path = credential_path(config_dir, run_id)
    server = {'command': sys.executable,
              'args': [str(Path(root) / 'bin/orc-orchestrator'), '--run-id', run_id,
                       '--token-file', str(path), '--port', str(port)]}
    return ['--mcp-config', json.dumps({'mcpServers': {'orc-orchestrator': server}}),
            '--append-system-prompt-file', str(path.with_suffix('.instructions.md')),
            '--allowedTools', 'mcp__orc-orchestrator__*']


def hook_context(config_dir, run_id):
    instructions = read_instructions(config_dir, run_id)
    path = credential_path(config_dir, run_id).with_suffix('.instructions.md')
    policy = delegation_policy.hook_context({'status': 'running', 'orchestration': True})
    if not instructions.startswith(policy):
        instructions = policy + '\n' + instructions
    return ('Orc Orchestrate is enabled for this run. Read and follow the complete '
            'run-scoped instructions at ' + str(path) + '.\n' + instructions)


def session_hook_context(config_dir, session_id, harness='codex'):
    meta = delegation_policy.session_meta(config_dir, session_id, harness)
    return hook_context(config_dir, meta['runId']) if meta and meta.get('orchestration') is True else ''


def additional_context(config_dir, run_id):
    text = read_instructions(config_dir, run_id)
    chunks = []
    chunk = []
    size = 0
    for character in text:
        width = len(character.encode('utf-8'))
        if size + width >= 4000:
            chunks.append(''.join(chunk))
            chunk, size = [], 0
        chunk.append(character)
        size += width
    if chunk:
        chunks.append(''.join(chunk))
    return {f'orc-orchestration:{index:04d}': {'kind': 'application', 'value': value}
            for index, value in enumerate(chunks)}
