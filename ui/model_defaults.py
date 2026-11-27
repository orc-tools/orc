"""The models Orc picks when nobody chose one, and what replaces them.

Orc ships exact model ids so that a launch with no model chosen runs on one
it has been tried with. Those ids retire. Once the CLI that runs one stops
listing it, Orc moves to the CLI's own choice, so default launches keep
working without an Orc release. Only ids Orc itself sets are moved; a model
someone picked stays as they picked it, because a CLI accepts ids its list
leaves out.

The lists come from ``model_catalog``'s cache, which fills when the model
picker loads, and from Codex's own ``models_cache.json``. Asking a CLI for
its list takes seconds, so a launch never waits on it: until a list is
known, the shipped id stays.
"""
import re

import model_catalog

LAUNCH = {"claude": "claude-opus-5-5", "codex": "gpt-6.2-sol"}
# Every id Orc sets on its own (launch defaults, the assistant's model, its
# proposals and its skill replies), plus earlier launch defaults that saved
# proposals may still carry.
SHIPPED = {"claude": frozenset({"claude-opus-5-5", "claude-sonnet-5-5"}),
           "codex": frozenset({"gpt-6.2-sol", "gpt-6.1-sol"})}
# Claude Code resolves a family alias to that family's newest model.
CLAUDE_FAMILY = re.compile(r"claude-(opus|sonnet|haiku|fable)-")


def offered(agent):
    """The ids agent's CLI listed when last asked, its first choice first,
    or [] when Orc does not know."""
    rows = model_catalog.models_for(agent, discover=False)
    if not rows and agent == "codex":
        rows = model_catalog.codex_cache_rows()
    return [row["id"] for row in rows]


def current(agent, model):
    """model, unless Orc shipped it and its CLI no longer lists it: then the
    family alias for Claude, or the CLI's first choice for Codex."""
    if model not in SHIPPED.get(agent, ()):
        return model
    ids = offered(agent)
    if not ids or model in ids:
        return model
    if agent == "claude":
        return CLAUDE_FAMILY.match(model)[1]
    return ids[0]


def launch_default(agent):
    """The model a launch with none chosen runs on, or None for an agent
    that picks its own."""
    return current(agent, LAUNCH[agent]) if agent in LAUNCH else None


def claude_label(model, rows=()):
    """A Claude model's short name, as a picker shows it: Sonnet 5.5."""
    for row in rows:
        if row.get("id") == model and isinstance(row.get("label"), str) and row["label"].strip():
            return re.sub(r"^Claude\s+", "", row["label"].strip())
    match = re.fullmatch(r"claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?", model)
    if not match:
        return model
    return "%s %s" % (match[1].capitalize(), match[2] + ("." + match[3] if match[3] else ""))


def claude_choices(chosen, default, rows=None):
    """The Claude models a small picker offers: the ones Claude Code listed
    when Orc's model picker last asked, with the default and the current
    choice always among them. Asking takes seconds, so a picker never does."""
    rows = model_catalog.models_for("claude", discover=False) if rows is None else rows
    valid = lambda value: isinstance(value, str) and bool(model_catalog.MODEL_ID.fullmatch(value))  # noqa: E731
    # Before the picker has asked, the models Orc ships with.
    listed = [row["id"] for row in rows if valid(row.get("id"))] or sorted(SHIPPED["claude"])
    ids = list(dict.fromkeys(model for model in (*listed, default, chosen) if valid(model)))
    return [{"id": model, "label": claude_label(model, rows)} for model in ids]
