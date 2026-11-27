"""Declared transitions shared by the file-backed Orc state machines."""

import logging


class RefusedTransition(ValueError):
    pass


def refuse(machine, owner, caller, before, event):
    message = f"{machine} {owner}: {caller} refused {event!r} from {before!r}"
    logging.getLogger("orc.transitions").warning(message)
    raise RefusedTransition(message)


def advance(table, state, event, *, machine, owner, caller):
    try:
        return table[state][event]
    except (KeyError, TypeError):
        refuse(machine, owner, caller, state, event)


def diagram(title, table):
    """Render stable Mermaid identifiers even for states containing punctuation."""
    states = {state: f"s{index}" for index, state in enumerate(sorted(table))}
    lines = [f"# {title}", "", "```mermaid", "stateDiagram-v2"]
    for state, label in states.items():
        lines.append(f'    state "{state}" as {label}')
    for state in states:
        for event, target in sorted(table[state].items()):
            lines.append(f"    {states[state]} --> {states[target]}: {event}")
    return "\n".join([*lines, "```", ""])
