"""Orc's skill commands and legacy entry aliases."""

from pathlib import Path
import re

SKILLS = Path(__file__).resolve().parents[1] / 'skills'

ENTRY_SKILLS = ('orc', 'orc-plan', 'orc-plan-session', 'orc-review', 'orc-challenge')
LEGACY_ENTRY_SKILLS = ('orc-fork', 'orc-ostack')


def invocation(agent, skill):
    name = 'run' if skill == 'orc' else skill.removeprefix('orc-')
    return ('$' if agent == 'codex' else '/') + 'orc:' + name


def normalize_entry(prompt):
    match = re.match(r'^(\s*)([/\$])orc[:\-]([a-z-]+)(?=\s|$)', prompt)
    if not match:
        return prompt
    name = match.group(3)
    canonical = 'orc' if name == 'run' else 'orc-' + name
    if canonical not in ENTRY_SKILLS:
        return prompt
    return match.group(1) + match.group(2) + canonical + prompt[match.end():]


ENTRY_COMMANDS = {
    command
    for agent in ('claude', 'codex')
    for skill in (*ENTRY_SKILLS, *LEGACY_ENTRY_SKILLS)
    for command in (invocation(agent, skill), ('$' if agent == 'codex' else '/') + skill)
}


def orc_skill_path(text):
    """The SKILL.md that a message opening with `/orc:<name>` or `/orc-<name>`
    (or `$orc:...` / `$orc-...`) invokes, or None."""
    match = re.match(r'\s*[/\$]orc(?:[:\-]([a-z0-9-]+))?(?=\s|$)', text or '')
    if not match:
        return None
    name = match.group(1) or 'run'
    for directory in (('orc',) if name == 'run' else ('orc-' + name, name)):
        path = SKILLS / directory / 'SKILL.md'
        if path.is_file():
            return path
    return None
