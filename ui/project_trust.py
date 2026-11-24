"""Project-scoped harness trust shared by setup and delegated task launches."""
from __future__ import annotations

import copy
from contextlib import ExitStack
import fcntl
import json
import os
from pathlib import Path
import re
import tempfile
import tomllib


class ProjectTrustError(ValueError):
    """Trust could not be persisted without changing unrelated settings."""


def read_config(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ProjectTrustError(f"cannot read {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ProjectTrustError(f"{path} must contain a JSON object")
    return value


def atomic_write_json(path: Path, value: dict) -> None:
    atomic_write_bytes(path, (json.dumps(value, indent=2) + "\n").encode())


def atomic_write_bytes(path: Path, data: bytes) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
    except OSError as exc:
        raise ProjectTrustError(f"cannot write {path}: {exc}") from exc


def codex_trust_text(text: str, target: Path) -> str:
    try:
        current = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        raise ProjectTrustError(f"cannot parse Codex config: {exc}") from exc
    expected = copy.deepcopy(current)
    projects = expected.setdefault('projects', {})
    if not isinstance(projects, dict):
        raise ProjectTrustError('Codex projects must be a table')
    project = projects.setdefault(str(target), {})
    if not isinstance(project, dict):
        raise ProjectTrustError('Codex project entry must be a table')
    project['trust_level'] = 'trusted'
    if current == expected:
        return text

    # Validate each surgical edit against the complete parsed config so quoted
    # keys, comments and unrelated settings keep their original bytes.
    key = json.dumps(str(target), ensure_ascii=False)
    candidates = [f'projects.{key}.trust_level = "trusted"\n' + text,
                  text + f'\n[projects.{key}]\ntrust_level = "trusted"\n']
    lines = text.splitlines(keepends=True)
    for index, line in enumerate(lines):
        if re.match(r'^\s*(?:trust_level|"trust_level"|\'trust_level\')\s*=', line):
            candidates.append(''.join(lines[:index]) + 'trust_level = "trusted"\n'
                              + ''.join(lines[index + 1:]))
        if line.lstrip().startswith('['):
            candidates.append(''.join(lines[:index + 1]) + '\ntrust_level = "trusted"\n'
                              + ''.join(lines[index + 1:]))
    for candidate in candidates:
        try:
            if tomllib.loads(candidate) == expected:
                return candidate
        except tomllib.TOMLDecodeError:
            continue
    raise ProjectTrustError('cannot safely edit Codex project trust; use a [projects."<path>"] '
                            'table in config.toml')


def trust_project(target: Path, *, harness: str | None = None, env=None) -> None:
    if harness not in (None, 'claude', 'codex'):
        raise ProjectTrustError('unknown harness for project trust')
    env = os.environ if env is None else env
    target = Path(target).resolve()
    if not target.is_dir():
        raise ProjectTrustError(f'trust target is not a directory: {target}')
    home = Path(env.get('HOME') or Path.home()).resolve()

    def config_dir(raw):
        return (home / raw[2:] if raw.startswith('~/') else
                home if raw == '~' else Path(raw)).resolve()

    claude_dir = env.get('CLAUDE_CONFIG_DIR')
    claude_path = (config_dir(claude_dir) if claude_dir else home) / '.claude.json'
    codex_path = config_dir(env.get('CODEX_HOME') or str(home / '.codex')) / 'config.toml'
    paths = ([claude_path] if harness == 'claude' else
             [codex_path] if harness == 'codex' else [claude_path, codex_path])
    try:
        with ExitStack() as stack:
            # Workers launch concurrently; a stable sidecar serializes Orc's
            # read-modify-write operations across atomic config replacements.
            for path in sorted(paths):
                path.parent.mkdir(parents=True, exist_ok=True)
                lock = stack.enter_context(open(path.with_name(path.name + '.orc-trust.lock'), 'a'))
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            updates = {}
            for path in paths:
                original = path.read_bytes() if path.exists() else b''
                if path == claude_path:
                    claude = read_config(path)
                    projects = claude.setdefault('projects', {})
                    if not isinstance(projects, dict):
                        raise ProjectTrustError(f'{path}: projects must be an object')
                    project = projects.setdefault(str(target), {})
                    if not isinstance(project, dict):
                        raise ProjectTrustError(f'{path}: project entry must be an object')
                    project['hasTrustDialogAccepted'] = True
                    updated = ((json.dumps(claude, indent=2) + '\n').encode()
                               if read_config(path) != claude else original)
                else:
                    updated = codex_trust_text(original.decode('utf-8'), target).encode()
                updates[path] = (original, updated)
            for path, (original, updated) in updates.items():
                current = path.read_bytes() if path.exists() else b''
                if current != original:
                    raise ProjectTrustError(f'{path} changed while preparing project trust; retry the operation')
                if updated != original:
                    atomic_write_bytes(path, updated)
                if path.read_bytes() != updated:
                    raise ProjectTrustError('project trust changed during setup; retry the operation')
    except (OSError, UnicodeError) as exc:
        raise ProjectTrustError(f'cannot save project trust: {exc}') from exc
