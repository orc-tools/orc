"""Retire user-scope registrations written by the old `orc-mcp setup`."""

import argparse
import os
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
_RELEASE = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
_DIGEST = re.compile(r"[0-9a-f]{64}")
_COMMANDS = frozenset({"bin/orc-mcp", "app-plugins/mcp/orc-mcp"})


def _app_plugins():
    ui_dir = str(ROOT / "ui")
    if ui_dir not in sys.path:
        sys.path.insert(0, ui_dir)
    import app_plugins
    return app_plugins


def _commands(source=None):
    commands = set(_COMMANDS)
    policy = _app_plugins().catalog_policy(ROOT if source is None else source)
    if policy is not None and hasattr(policy, "retired_mcp_commands"):
        commands.update(policy.retired_mcp_commands())
    return commands


def _location(path, home, source):
    commands = _commands(source)
    orc = home / ".orc"
    roots = [orc / "src", orc / "dist", orc / "runtime/current"]
    if source is not None:
        roots.append(Path(source))
    if any(path == root.resolve() / command for root in roots for command in commands):
        return True
    for base, id_pattern, rel_commands in (
        (orc / "runtime/releases", _RELEASE, commands),
        (orc / "app-plugins/mcp", _DIGEST, {"orc-mcp"}),
    ):
        try:
            parts = path.relative_to(base.resolve()).parts
        except ValueError:
            continue
        if len(parts) > 1 and id_pattern.fullmatch(parts[0]) and "/".join(parts[1:]) in rel_commands:
            return True
    return False


def _direct_command(path, home, source):
    # Resolve directory aliases, including a chosen Orc data folder, while
    # checking separately for a replacement of the executable itself.
    path = path.parent.resolve() / path.name
    return _location(path, home, source) and (
        not path.is_symlink() or _location(path.resolve(), home, source)
    )


def _link(home):
    return home / ".local/bin/orc-mcp"


def _owned_link(home, source):
    link = _link(home)
    return link.is_symlink() and _direct_command(link.parent / link.readlink(), home, source)


def is_managed_command(command, *, home, source=None):
    """Whether a saved absolute command selects a historical Orc-managed path."""
    if not isinstance(command, str) or not os.path.isabs(command) or "\0" in command:
        return False
    home = Path(home).resolve()
    path = Path(command)
    try:
        link = _link(home)
        if path.parent.resolve() / path.name == link.parent.resolve() / link.name:
            # Disabling the old plugin already removed its link. Callers also
            # match the saved preset or setup arguments before removing it.
            return not os.path.lexists(link) or _owned_link(home, source)
        return _direct_command(path, home, source)
    except (OSError, RuntimeError):
        return False


def _setup_entry(entry, home, source):
    if not isinstance(entry, dict) or entry.get("type", "stdio") != "stdio":
        return False
    args = entry.get("args")
    return (
        entry.keys() <= {"command", "args", "type", "env"} and not entry.get("env")
        and isinstance(args, list) and len(args) == 7
        and args[:2] == ["stdio", "--state-dir"]
        and args[3] == "--orc-port" and args[5] == "--bridge-token-file"
        and all(isinstance(args[i], str) and os.path.isabs(args[i]) for i in (2, 6))
        and isinstance(args[4], str) and re.fullmatch(r"[0-9]{1,5}", args[4])
        and 1 <= int(args[4]) <= 65535
        and is_managed_command(entry.get("command"), home=home, source=source)
    )


def _configs(home):
    codex = [home / ".codex"]
    claude = [home, *sorted(home.glob(".claude-*"))]
    for paths, key in ((codex, "CODEX_HOME"), (claude, "CLAUDE_CONFIG_DIR")):
        if value := os.environ.get(key):
            paths.append(home / value[2:] if value.startswith("~/") else Path(value))
    return (
        (agent, path)
        for agent, filename, folders in (("Codex", "config.toml", codex), ("Claude", ".claude.json", claude))
        for path in dict.fromkeys((folder / filename).resolve() for folder in folders)
        if path.is_file()
    )


def _clean_clients(home, source):
    configs = list(_configs(home))
    if not configs:
        return True
    load_package_module = _app_plugins().load_package_module

    config_files = load_package_module("orc_retire_mcp_config", ROOT / "app-plugins/mcp-client", "config_files.py")
    edit = config_files.config_edit
    files = config_files.Files(home / ".orc")

    def codex(text):
        entry = edit.codex_servers(text).get("orc")
        return edit.codex_change(text, "orc", None) if _setup_entry(entry, home, source) else text

    def claude(text):
        entry = edit.claude_servers(text).get("orc")
        return edit.claude_change(text, None, "orc", None) if _setup_entry(entry, home, source) else text

    succeeded = True
    for agent, path in configs:
        transform = codex if agent == "Codex" else claude
        try:
            before = path.read_bytes().decode("utf-8")
            if before == transform(before):
                continue
            changed = files.change({path: (transform, agent == "Claude")})
        except (OSError, UnicodeError, edit.EditError) as error:
            print(f"{agent}: could not retire Orc MCP in {path}: {error}", file=sys.stderr)
            succeeded = False
            continue
        if changed:
            print(f"{agent}: removed Orc MCP from {path}")
    return succeeded


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()
    home = Path.home().resolve()
    succeeded = _clean_clients(home, args.source)
    if _owned_link(home, args.source):
        _link(home).unlink()
        print("Removed the retired Orc MCP command link.")
    return 0 if succeeded else 1


if __name__ == "__main__":
    sys.exit(main())
