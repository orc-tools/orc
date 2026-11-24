"""Adding, editing, removing and syncing the MCP servers agents have.

agents.py reads what each agent holds; this writes it. One change reaches
every agent it names at once: a refused change to one file leaves the others
as they were (config_files.py), and each changed file is copied first.

For the global lists a server goes into each login's ``.claude.json`` and
Codex's ``config.toml``. For a folder it goes into each login's private list
for that folder, and for Codex into ``.codex/config.toml`` inside the folder,
which is kept out of git and which Codex reads once it trusts the folder. A
server a repo shares in ``.mcp.json`` is never changed.
"""
from __future__ import annotations

import os
import shlex
from pathlib import Path

import claude_accounts
import keychain_secrets
import project_trust
from . import agents as agents_module
from . import config_edit
from . import config_files
from . import servers as store_module
from .config_edit import EditError

SHARED = "shared"
PAIRS_LIMIT = 32
VALUE_LIMIT = 2048


def _pairs(value, what, name_ok) -> dict:
    """``[{name, value?}]`` as the form sends it, as ``{name: value | None}``.
    A missing value keeps the one the agent has."""
    if value is None:
        return {}
    if not isinstance(value, list) or len(value) > PAIRS_LIMIT:
        raise EditError("Add at most %d %ss." % (PAIRS_LIMIT, what))
    found = {}
    for item in value:
        name = item.get("name").strip() if isinstance(item, dict) and isinstance(item.get("name"), str) else ""
        if not name_ok(name):
            raise EditError("%s is not a %s an agent can use." % (name or "A blank name", what))
        if name.lower() in {other.lower() for other in found}:
            raise EditError("%s is there twice." % name)
        text = item.get("value")
        if text is not None and (not isinstance(text, str) or len(text) > VALUE_LIMIT
                                 or not keychain_secrets.PRINTABLE_ASCII.fullmatch(text)):
            raise EditError("The value of %s must be printable ASCII on one line, up to %d characters."
                            % (name, VALUE_LIMIT))
        found[name] = text or None
    return found


def clean_spec(data) -> dict:
    """The server a form describes: a command when it names one, else an
    address. Header and variable values may be missing (see ``_pairs``)."""
    command = data.get("command")
    if isinstance(command, str) and command.strip():
        try:
            words = shlex.split(command)
        except ValueError:
            words = []
        if not words or len(command) > VALUE_LIMIT:
            raise EditError("Enter the command as you would type it in a terminal.")
        return {"transport": "stdio", "command": words[0], "args": words[1:],
                "env": _pairs(data.get("env"), "variable", lambda name: bool(config_edit.ENV_NAME.fullmatch(name)))}
    try:
        url = store_module.clean_url(data.get("url"))
    except store_module.StoreError as error:
        raise EditError(str(error)) from None
    return {"transport": "http", "url": url,
            "headers": _pairs(data.get("headers"), "header",
                              lambda name: bool(store_module.HEADER_NAME.fullmatch(name)))}


class _List:
    """One agent's list of servers for a project, inside its config file."""

    def __init__(self, agent, path, *, folder=None, codex=False, beside=True):
        self.agent, self.path, self.folder, self.codex, self.beside = agent, Path(path), folder, codex, beside

    def _key(self, text):
        """The folder as this login's config spells it."""
        if self.folder is None:
            return None
        return next((key for key in config_edit.claude_folders(text)
                     if os.path.isabs(key) and agents_module.normal_path(key) == self.folder), self.folder)

    def servers(self, text) -> dict:
        return config_edit.codex_servers(text) if self.codex else config_edit.claude_servers(text, self._key(text))

    def change(self, text, name, entry) -> str:
        return config_edit.codex_change(text, name, entry) if self.codex \
            else config_edit.claude_change(text, self._key(text), name, entry)

    def rename(self, text, name, new_name) -> str:
        return config_edit.codex_rename(text, name, new_name) if self.codex \
            else config_edit.claude_rename(text, self._key(text), name, new_name)

    def spec(self, entry):
        return config_edit.spec_from_codex(entry) if self.codex else config_edit.spec_from_claude(entry)

    def entry(self, spec, current=None) -> dict:
        return config_edit.codex_entry(spec, current) if self.codex else config_edit.claude_entry(spec, current)

    def read(self) -> str:
        try:
            return self.path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            return ""


def _filled(spec, *known) -> dict:
    """The spec with each missing header or variable value taken from the
    first of ``known`` that has it: the agent's own entry, then another's."""
    field = "env" if spec["transport"] == "stdio" else "headers"
    values = {}
    for name, value in spec[field].items():
        value = value or next((other[field][name] for other in known
                               if other and other["transport"] == spec["transport"] and other[field].get(name)), None)
        if value is None:
            raise EditError("Enter a value for %s." % name)
        values[name] = value
    return {**spec, field: values}


class Changes:
    def __init__(self, reader, orc_dir, *, trust=project_trust.trust_project):
        self.reader = reader
        self.files = config_files.Files(orc_dir)
        self.trust = trust

    # -- where each agent keeps a project's servers --

    def lists(self, project) -> dict:
        """``{agent id: _List}`` for every agent that keeps a list for the
        global servers or for a folder. Codex keeps none for the folder its
        own home is in: ``.codex/config.toml`` there is its global list."""
        folder = None if project == agents_module.GLOBAL else project
        found = {}
        for agent in self.reader.agents():
            if agent["id"] == agents_module.CODEX:
                path = self.reader.codex_dir / "config.toml" if folder is None \
                    else Path(folder) / config_files.CODEX_PROJECT_FILE
                if folder is None or path.parent != self.reader.codex_dir:
                    found[agent["id"]] = _List(agent, path, codex=True, beside=folder is None)
            else:
                home = self.reader.home
                login = home if agent["login"] == claude_accounts.DEFAULT else home / agent["login"]
                found[agent["id"]] = _List(agent, login / ".claude.json", folder=folder)
        return found

    def _row(self, project, row_id) -> dict:
        row = next((row for row in self.reader.rows(project) if row["id"] == row_id), None)
        if row is None:
            raise EditError("That MCP server is no longer there. Reload the page.")
        return row

    def _held(self, project, row, agent_ids=None) -> list[tuple]:
        """(list, name) for each agent's own entry in a row, without the
        shared ones, which Orc never changes."""
        lists = self.lists(project)
        return [(lists[member["agent"]], member["name"]) for member in row["agents"]
                if member["scope"] != SHARED and member["agent"] in lists
                and (agent_ids is None or member["agent"] in agent_ids)]

    def _apply(self, project, steps) -> dict:
        """Runs ``[(list, edit)]``, where ``edit(text)`` answers the list's
        file as it should be, and answers what the screen says about it."""
        edits, lists = {}, {}
        for held, edit in steps:
            before = edits.get(held.path)
            edits[held.path] = ((lambda text, a=before[0], b=edit: b(a(text))) if before else edit, held.beside)
            lists[held.path] = held
        in_repo = next((held for held in lists.values() if held.codex and not held.beside), None)
        if in_repo:
            config_files.keep_out_of_git(project)
        changed = self.files.change(edits)
        warnings = []
        if in_repo and Path(os.path.realpath(in_repo.path)) in changed:
            try:
                self.trust(Path(project), harness="codex",
                           env={"HOME": str(self.reader.home), "CODEX_HOME": str(self.reader.codex_dir)})
            except project_trust.ProjectTrustError:
                warnings.append("Codex reads a folder's servers once it trusts the folder. "
                                "Orc could not mark this one trusted, so open it in Codex once.")
        labels = [held.agent["label"] for path, held in lists.items() if Path(os.path.realpath(path)) in changed]
        return {"agents": labels, "backups": sum(copy is not None for copy in changed.values()), "warnings": warnings}

    # -- changes --

    def add(self, project, data, agent_ids) -> dict:
        name = config_edit.clean_name(data.get("name"))
        spec = _filled(clean_spec(data))
        lists = self.lists(project)
        picked = [lists[agent] for agent in agent_ids if agent in lists]
        if not picked:
            raise EditError("Tick at least one agent to add the server to.")

        def step(held):
            def edit(text):
                if name in held.servers(text):
                    raise EditError("%s already has a server named %s here." % (held.agent["label"], name))
                return held.change(text, name, held.entry(spec))
            return held, edit
        return self._found(project, self._apply(project, [step(held) for held in picked]), picked[0], name)

    def edit(self, project, row_id, data, agent_ids) -> dict:
        row = self._row(project, row_id)
        held = self._held(project, row, agent_ids)
        if not held:
            raise EditError("Tick at least one agent to change the server on.")
        typed = data.get("name")
        new_name = config_edit.clean_name(typed) if isinstance(typed, str) and typed.strip() != row["name"] else None
        spec = clean_spec(data)
        if row["transport"] == agents_module.SSE and spec["transport"] == "http":
            # The form has no field for it, and an SSE server stays one.
            spec["transport"] = "sse"
        # Read before the files are locked: a value another agent holds only
        # fills in one this agent lacks.
        known = [owner.spec(owner.servers(owner.read()).get(name)) for owner, name in self._held(project, row)]

        def step(owner, name):
            def edit(text):
                current = owner.servers(text).get(name)
                if current is None:
                    raise EditError("%s no longer has %s. Reload the page." % (owner.agent["label"], name))
                if new_name and new_name != name:
                    text = owner.rename(text, name, new_name)
                entry = owner.entry(_filled(spec, owner.spec(current), *known), current)
                return owner.change(text, new_name or name, entry)
            return owner, edit
        result = self._apply(project, [step(owner, name) for owner, name in held])
        return self._found(project, result, held[0][0], new_name or held[0][1])

    def _found(self, project, result, owner, name) -> dict:
        """The result with the id of the row the server shows as now."""
        row = next((row["id"] for row in self.reader.rows(project) for member in row["agents"]
                    if member["agent"] == owner.agent["id"] and member["name"] == name and member["scope"] != SHARED), None)
        return {**result, "row": row}

    def remove(self, project, row_id, agent_ids) -> dict:
        held = self._held(project, self._row(project, row_id), agent_ids)
        if not held:
            raise EditError("Tick at least one agent to remove the server from.")
        return self._apply(project, [(owner, lambda text, owner=owner, name=name: owner.change(text, name, None))
                                     for owner, name in held])

    def lacking(self, project, rows=None) -> dict:
        """``{row id: [agent]}``: the agents Sync would add each server to.
        An agent is left out when it has another server under the name, since
        Sync never replaces one; a Claude login for a server the repo shares,
        which it reads itself unless it turned it off; and Codex for a server
        that only speaks SSE."""
        rows = self.reader.rows(project) if rows is None else rows
        every = [held.agent for held in self.lists(project).values()]
        taken: dict = {}
        for row in rows:
            for member in row["agents"]:
                taken.setdefault(member["agent"], set()).add(member["name"])
        found = {}
        for row in rows:
            have = {member["agent"] for member in row["agents"]}
            shared = any(member["scope"] == SHARED for member in row["agents"])
            found[row["id"]] = [
                agent for agent in every
                if agent["id"] not in have and row["name"] not in taken.get(agent["id"], ())
                and not (shared and agent["id"] != agents_module.CODEX)
                and not (row["transport"] == agents_module.SSE and agent["id"] == agents_module.CODEX)]
        return found

    def sync(self, project, row_id=None) -> dict:
        """Adds each server (or one) to the agents that lack it. Nothing is
        replaced or removed. ``skipped`` names what a change since the page
        was read, or two servers under one name, kept off an agent."""
        rows = self.reader.rows(project)
        lacking = self.lacking(project, rows)
        lists = self.lists(project)
        steps, skipped = [], []
        for row in rows if row_id is None else [self._row(project, row_id)]:
            source = self._source(project, row) if lacking[row["id"]] else None
            if source is not None:
                steps += [self._copy(lists[agent["id"]], row["name"], source, skipped) for agent in lacking[row["id"]]]
        result = self._apply(project, steps) if steps else {"agents": [], "backups": 0, "warnings": []}
        return {**result, "skipped": skipped}

    def _source(self, project, row) -> dict | None:
        """The whole of a row's server, values included, from the first
        agent whose config still has it."""
        for owner, name in self._held(project, row):
            spec = owner.spec(owner.servers(owner.read()).get(name))
            if spec is not None:
                return spec
        for member in row["agents"]:
            if member["scope"] == SHARED:
                try:
                    text = (Path(project) / ".mcp.json").read_text(encoding="utf-8")
                    return config_edit.spec_from_claude(config_edit.claude_servers(text).get(member["name"]))
                except (OSError, UnicodeError, EditError):
                    return None
        return None

    @staticmethod
    def _copy(target, name, spec, skipped):
        def edit(text):
            try:
                if name in target.servers(text):
                    raise EditError("%s has another server under that name." % target.agent["label"])
                return target.change(text, name, target.entry(spec))
            except EditError as error:
                skipped.append({"agent": target.agent["label"], "server": name, "why": str(error)})
                return text
        return target, edit
