"""The MCP client's throwaway environments.

An environment is one-off testing: a temporary folder, the MCP servers picked
or pasted for it, and the agent chats started in it. Everything it keeps on
disk sits under ``<config dir>/mcp-environments/<id>``: ``folder`` is where
its agents work, and ``chats`` holds each chat's turns, outside that folder so
an agent never reads what Orc sends its servers. Its record lives in
config.json under ``mcpClient.environments``. A server pasted into it names
its environment in its own entry, so it never outlives the environment. A
server picked from a project is only named in ``picks``, by its project and
the id agents.py gives it, and stays in the project when the environment goes.

Closing an environment deletes all of it, and so do 7 days without use.
"""
from __future__ import annotations

import re
import secrets
import shutil
import time
from pathlib import Path

from . import servers as store_module

ENVIRONMENT_ID = re.compile(r"[a-z0-9]{8}")
CHAT_ID = re.compile(r"[a-z0-9]{8}")
NAME_LIMIT = 40
MAX_ENVIRONMENTS = 12
MAX_CHATS = 20
MAX_PICKS = 50
UNUSED_SECONDS = 7 * 24 * 3600
# Opening an environment counts as using it, and an open chat reads it every
# second, so the time is only written when it has moved this far.
USED_STEP = 3600
FOLDER = "mcp-environments"
ADOPTED_NAME = "Saved servers"

StoreError = store_module.StoreError


def clean_name(value) -> str:
    return " ".join(value.split())[:NAME_LIMIT] if isinstance(value, str) else ""


def _valid(entry) -> bool:
    return (isinstance(entry, dict) and isinstance(entry.get("id"), str)
            and bool(ENVIRONMENT_ID.fullmatch(entry["id"])))


def _chats(entry) -> list[dict]:
    raw = entry.get("chats")
    return [chat for chat in raw if isinstance(chat, dict) and isinstance(chat.get("id"), str)
            and CHAT_ID.fullmatch(chat["id"])] if isinstance(raw, list) else []


def _picks(entry) -> list[dict]:
    raw = entry.get("picks")
    return [{"project": pick["project"], "id": pick["id"]} for pick in raw
            if isinstance(pick, dict) and isinstance(pick.get("project"), str)
            and isinstance(pick.get("id"), str)] if isinstance(raw, list) else []


class Environments:
    def __init__(self, context, store, *, clock=time.time):
        self.context = context
        self.store = store
        self.clock = clock

    @property
    def root(self) -> Path:
        return Path(self.context["config_dir"]()) / FOLDER

    def home(self, environment_id: str) -> Path:
        if not isinstance(environment_id, str) or not ENVIRONMENT_ID.fullmatch(environment_id):
            raise StoreError("That is not a throwaway environment.")
        return self.root / environment_id

    def folder(self, environment_id: str) -> Path:
        """Where the environment's agents work."""
        return self.home(environment_id) / "folder"

    def chat_dir(self, environment_id: str, chat_id: str) -> Path:
        if not isinstance(chat_id, str) or not CHAT_ID.fullmatch(chat_id):
            raise StoreError("That is not a chat of this environment.")
        return self.home(environment_id) / "chats" / chat_id

    # -- reading --

    def all(self) -> list[dict]:
        config, _broken = self.context["read_config"]()
        section = config.get(store_module.CONFIG_KEY) if isinstance(config, dict) else None
        raw = section.get("environments") if isinstance(section, dict) else None
        return [{**entry, "chats": _chats(entry), "picks": _picks(entry)}
                for entry in raw if _valid(entry)] if isinstance(raw, list) else []

    def get(self, environment_id) -> dict | None:
        return next((entry for entry in self.all() if entry["id"] == environment_id), None)

    def require(self, environment_id) -> dict:
        entry = self.get(environment_id)
        if entry is None:
            raise StoreError("That throwaway environment was closed.")
        return entry

    def servers(self, environment_id: str) -> list[dict]:
        return [entry for entry in self.store.servers() if entry.get("environment") == environment_id]

    # -- changing --

    def _change(self, change):
        """Rewrites the plugin's section of config.json under the Settings
        lock. ``change(section, environments)`` edits both in place and
        returns what the caller wants back."""
        result = {}

        def transform(config):
            section = dict(config.get(store_module.CONFIG_KEY) or {})
            environments = [dict(entry) for entry in section.get("environments") or [] if _valid(entry)]
            result["value"] = change(section, environments)
            section["environments"] = environments
            config[store_module.CONFIG_KEY] = section
            return config
        self.context["update_config"](transform)
        return result.get("value")

    def _edit(self, environment_id, edit):
        def change(_section, environments):
            entry = next((item for item in environments if item["id"] == environment_id), None)
            if entry is None:
                raise StoreError("That throwaway environment was closed.")
            edit(entry)
            return dict(entry)
        return self._change(change)

    def create(self, name="") -> dict:
        now = self.clock()
        entry = {"id": secrets.token_hex(4), "name": clean_name(name), "createdAt": now, "usedAt": now, "chats": []}

        def change(_section, environments):
            if len(environments) >= MAX_ENVIRONMENTS:
                raise StoreError("Orc keeps at most %d throwaway environments. Close one first." % MAX_ENVIRONMENTS)
            environments.append(entry)
            return dict(entry)
        created = self._change(change)
        self.ensure_folder(created["id"])
        return created

    def ensure_folder(self, environment_id: str) -> Path:
        folder = self.folder(environment_id)
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        return folder

    def rename(self, environment_id, name) -> dict:
        return self._edit(environment_id, lambda entry: entry.update(name=clean_name(name)))

    def touch(self, environment_id) -> None:
        """Marks the environment used now, which puts off its clean-up."""
        entry = self.get(environment_id)
        now = self.clock()
        if entry is None or now - float(entry.get("usedAt") or 0) < USED_STEP:
            return
        try:
            self._edit(environment_id, lambda found: found.update(usedAt=now))
        except StoreError:
            pass

    def add_chat(self, environment_id, chat: dict) -> dict:
        def edit(entry):
            chats = _chats(entry)
            if len(chats) >= MAX_CHATS:
                raise StoreError("This environment has %d chats. Close it and start a new one." % MAX_CHATS)
            entry["chats"] = chats + [chat]
            entry["usedAt"] = self.clock()
        return self._edit(environment_id, edit)

    def pick(self, environment_id, project, server_id) -> None:
        """Adds a project's server to the environment by name only."""
        def edit(entry):
            picks = [pick for pick in _picks(entry) if (pick["project"], pick["id"]) != (project, server_id)]
            if len(picks) >= MAX_PICKS:
                raise StoreError("This environment has %d picked servers. Remove one first." % MAX_PICKS)
            entry["picks"] = picks + [{"project": project, "id": server_id}]
            entry["usedAt"] = self.clock()
        self._edit(environment_id, edit)

    def unpick(self, environment_id, server_id) -> None:
        self._edit(environment_id, lambda entry: entry.update(
            picks=[pick for pick in _picks(entry) if pick["id"] != server_id]))

    def remove_chat(self, environment_id, chat_id) -> None:
        def edit(entry):
            entry["chats"] = [chat for chat in _chats(entry) if chat["id"] != chat_id]
        self._edit(environment_id, edit)
        shutil.rmtree(self.chat_dir(environment_id, chat_id), ignore_errors=True)

    def update_chat(self, environment_id, chat_id, **fields) -> None:
        def edit(entry):
            entry["chats"] = [{**chat, **fields} if chat["id"] == chat_id else chat for chat in _chats(entry)]
        self._edit(environment_id, edit)

    def adopt_saved(self) -> str | None:
        """Moves the servers saved before environments existed into one
        environment, and answers its id. Later calls find nothing to move."""
        if all(entry.get("environment") for entry in self.store.saved()):
            return None
        now = self.clock()
        adopted = {"id": secrets.token_hex(4), "name": ADOPTED_NAME, "createdAt": now, "usedAt": now, "chats": []}

        def change(section, environments):
            def loose(entry):
                return isinstance(entry, dict) and not entry.get("environment") and not entry.get("linked")
            if not any(loose(entry) for entry in section.get("servers") or []):
                return None
            if len(environments) >= MAX_ENVIRONMENTS:
                raise StoreError("Orc keeps at most %d throwaway environments. Close one first." % MAX_ENVIRONMENTS)
            section["servers"] = [{**entry, "environment": adopted["id"]} if loose(entry) else entry
                                  for entry in section.get("servers") or []]
            environments.append(adopted)
            return adopted["id"]
        environment_id = self._change(change)
        if environment_id:
            self.ensure_folder(environment_id)
        return environment_id

    def expired(self) -> list[str]:
        cutoff = self.clock() - UNUSED_SECONDS
        return [entry["id"] for entry in self.all() if float(entry.get("usedAt") or 0) < cutoff]

    def delete(self, environment_id) -> dict | None:
        """Deletes the servers pasted into the environment with Orc's sign-in
        for each, its folder and its record. Answers the record, whose chats
        the caller ends, or None when it was already gone."""
        entry = self.get(environment_id)
        if entry is None:
            return None
        for server in self.servers(environment_id):
            try:
                self.store.remove(server["id"])
            except StoreError:
                pass
        self.remove_folder(environment_id)

        def change(_section, environments):
            environments[:] = [item for item in environments if item["id"] != environment_id]
        self._change(change)
        return entry

    def remove_folder(self, environment_id: str) -> None:
        home = self.home(environment_id)
        # Only ever a real folder directly inside Orc's own environments
        # folder: a link there is removed, never followed.
        if home.is_symlink():
            home.unlink()
        elif home.is_dir() and home.resolve().parent == self.root.resolve():
            shutil.rmtree(home, ignore_errors=True)

    def orphans(self) -> list[str]:
        """Folders left by an environment whose record is gone."""
        known = {entry["id"] for entry in self.all()}
        try:
            return [child.name for child in self.root.iterdir()
                    if ENVIRONMENT_ID.fullmatch(child.name) and child.name not in known]
        except OSError:
            return []
