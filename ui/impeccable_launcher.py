"""Where the impeccable skill's launcher is installed on this machine.

The design hook (`hooks/impeccable-design-hook.py`) and the Design check
(`bin/orc-design-check`) both run impeccable's own launcher, which ships inside
the skill folder. The current Claude account's copy comes first, then the
shared and skills-manager copies, so a machine where impeccable lives only in
the skills manager's store still finds it.
"""
from __future__ import annotations

import os
from pathlib import Path

RELATIVE = Path("skills") / "impeccable" / "scripts" / "impeccable"


def candidates(home: Path | None = None) -> list[Path]:
    home = home or Path.home()
    found = []
    override = os.environ.get("ORC_IMPECCABLE_LAUNCHER")
    if override:
        return [Path(override).expanduser()]
    config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
    if config_dir:
        found.append(Path(config_dir).expanduser() / RELATIVE)
    found += [
        home / ".claude" / RELATIVE,
        home / ".agents" / RELATIVE,
        home / ".orc" / "skills-manager" / "store" / "impeccable" / "scripts" / "impeccable",
    ]
    return found


def find(home: Path | None = None) -> Path | None:
    """The first installed launcher, or None when impeccable is not installed."""
    for path in candidates(home):
        if path.is_file() and os.access(path, os.X_OK):
            return path
    return None
