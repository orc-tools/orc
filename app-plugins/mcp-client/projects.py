"""The projects the MCP client lists, and which of them someone added or hid.

The page starts with Global and the Orc projects some agent keeps servers
for. Every other folder waits under Add project. ``mcpClient.projects`` in config.json holds the folders that
were added and the projects that were archived.
"""
from __future__ import annotations

import os
from pathlib import Path

from . import agents
from .servers import CONFIG_KEY, StoreError

GLOBAL = agents.GLOBAL
MAX_ADDED = 200
MAX_HIDDEN = 500
GONE = "Orc no longer lists that project."


class Projects:
    def __init__(self, context, reader):
        self.context = context
        self.reader = reader

    # -- config --

    def _state(self) -> tuple[list[str], list[str], list[str]]:
        """Orc's own projects, the folders added here, and what is hidden."""
        config, _broken = self.context["read_config"]()
        config = config if isinstance(config, dict) else {}
        repos = config.get("repos")
        section = config.get(CONFIG_KEY)
        section = section.get("projects") if isinstance(section, dict) else None
        section = section if isinstance(section, dict) else {}

        def paths(value):
            # Only folders: the client once listed its own saved servers as a
            # project that could be hidden, under a key that is no path.
            return [item for item in (value if isinstance(value, list) else [])
                    if isinstance(item, str) and os.path.isabs(item)]
        return ([agents.normal_path(path, self.reader.home) for path in (repos if isinstance(repos, dict) else {})
                 if isinstance(path, str) and path],
                paths(section.get("added")), paths(section.get("hidden")))

    def _change(self, change) -> None:
        def transform(config):
            section = dict(config.get(CONFIG_KEY) or {})
            kept = section.get("projects") if isinstance(section.get("projects"), dict) else {}
            added, hidden = change([item for item in kept.get("added") or [] if isinstance(item, str)],
                                   [item for item in kept.get("hidden") or [] if isinstance(item, str)])
            section["projects"] = {"added": added[-MAX_ADDED:], "hidden": hidden[-MAX_HIDDEN:]}
            config[CONFIG_KEY] = section
            return config
        self.context["update_config"](transform)

    # -- views --

    def describe(self, key, repos=None) -> dict:
        repos = self._state()[0] if repos is None else repos
        rows = self.reader.rows(key)
        counts: dict = {}
        for row in rows:
            for member in row["agents"]:
                counts.setdefault(member["agent"], [member["label"], 0])[1] += 1
        found = [{"id": agent, "label": label, "servers": count} for agent, (label, count) in counts.items()]
        if key == GLOBAL:
            return {"key": GLOBAL, "kind": GLOBAL, "name": "Global", "path": None, "servers": len(rows), "agents": found}
        home = str(self.reader.home)
        shown = "~" + key[len(home):] if key == home or key.startswith(home + os.sep) else key
        return {"key": key, "kind": "project" if key in repos else "folder", "name": os.path.basename(key) or key,
                "path": shown, "servers": len(rows), "agents": found, "missing": not os.path.isdir(key)}

    def listing(self) -> dict:
        repos, added, hidden = self._state()
        folders = self.reader.folders({*repos, *added})
        shown = [path for path in dict.fromkeys([*(path for path in repos if path in folders), *added])
                 if path not in hidden]
        waiting = [path for path in dict.fromkeys([*folders, *repos]) if path not in shown and path not in hidden]

        def described(keys):
            return [self.describe(key, repos) for key in keys]

        def by_name(rows):
            return sorted(rows, key=lambda row: (row["name"].casefold(), row["key"]))
        return {
            "projects": [*described([GLOBAL]), *by_name(described(shown))],
            "hidden": by_name(described(dict.fromkeys(hidden))),
            # A folder with servers is the likelier pick, so those come first.
            "candidates": sorted(described(waiting), key=lambda row: (not row["servers"], row["name"].casefold(), row["key"])),
        }

    def folders(self) -> set[str]:
        """Every folder some agent keeps servers for, shown here or not."""
        repos, added, _hidden = self._state()
        return self.reader.folders({*repos, *added})

    def known(self, key) -> bool:
        if key == GLOBAL:
            return True
        if not isinstance(key, str) or len(key) > agents.PATH_LIMIT or not os.path.isabs(key):
            return False
        repos, added, hidden = self._state()
        return key in repos or key in added or key in hidden or key in self.reader.folders()

    def require(self, key) -> str:
        """The project a request names."""
        if not self.known(key):
            raise StoreError(GONE)
        return key

    # -- changes --

    def add(self, path) -> str:
        """Lists a folder, which also brings back one that was archived."""
        if not isinstance(path, str) or not path.strip() or len(path) > agents.PATH_LIMIT:
            raise StoreError("Enter the folder's path, such as ~/Projects/my-app.")
        key = agents.normal_path(path.strip(), self.reader.home)
        if not (Path(key).is_dir() or self.known(key)):
            raise StoreError("Orc found no folder at %s." % path.strip())
        self._change(lambda added, hidden: ([*(item for item in added if item != key), key],
                                            [item for item in hidden if item != key]))
        return key

    def archive(self, key) -> None:
        if key == GLOBAL or not self.known(key):
            raise StoreError("Global always shows." if key == GLOBAL else GONE)
        self._change(lambda added, hidden: (added, [*(item for item in hidden if item != key), key]))

    def restore(self, key) -> None:
        self._change(lambda added, hidden: (added, [item for item in hidden if item != key]))
