"""Whether a project tells runs how to verify their work.

A project's home suggests the verification setup run
(skills/_shared/verification-setup.md) until one of these holds: the
repository's agent instructions carry a section about verifying changes, the
user keeps a private guide for it in Orc's own data, an enabled plugin ships a
guide for the repository, the user started the setup run, or the user chose
Not now. Not now only quiets the project home: project Settings' Verification
card still offers setup, and once a project has steps it shows them with ways
to update them or set up again.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import subprocess

# The heading the setup run writes. Any heading about verifying counts, so a
# repository that wrote its own ("Verifying Orc changes") is already set up.
SECTION_HEADING = "## Verifying changes"
HEADING = re.compile(r"^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$")
VERIFYING = re.compile(r"\bverif", re.IGNORECASE)
FENCE = re.compile(r"^[ \t]{0,3}(`{3,}|~{3,})")
INSTRUCTION_FILES = ("AGENTS.md", "CLAUDE.md")
MAX_INSTRUCTIONS_BYTES = 1024 * 1024
# Project Settings shows the steps; a guide longer than this is cut, since no
# useful set of steps comes near it.
MAX_STEPS_CHARS = 32 * 1024
# Each choice is a list of project keys in config.json's ``ui``. Started keeps
# its first name: the card's two buttons shared it before Not now had a list.
CHOICE_KEYS = {"started": "verificationSetupDismissed", "skipped": "verificationSetupSkipped"}
# Private guides live outside every repository, one file per main checkout, so
# nothing has to be committed and every worktree of the project finds the same
# guide.
PRIVATE_GUIDES_DIR = "verification"
# Git variables a hook can leave set, which would point `git -C` elsewhere.
HOOK_GIT_ENV = ("GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE")


def orc_home():
    return Path(os.environ.get("ORC_HOME", "~/.orc")).expanduser()


def main_checkout(repo):
    """The main checkout that ``repo`` (it or one of its worktrees) belongs
    to, or None outside a Git checkout."""
    env = {k: v for k, v in os.environ.items() if k not in HOOK_GIT_ENV}
    try:
        common = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--path-format=absolute", "--git-common-dir"],
            capture_output=True, text=True, timeout=10, env=env, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    if not common:
        return None
    common = Path(common)
    return str(common.parent if common.name == ".git" else common)


def private_guide_path(main_repo, home=None):
    """Where the private guide for the main checkout ``main_repo`` lives:
    named after the folder, with a hash of its real path so two checkouts of
    the same name never share a guide."""
    real = os.path.realpath(os.path.expanduser(str(main_repo)))
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", os.path.basename(real)).strip("-.") or "project"
    digest = hashlib.sha256(real.encode("utf-8")).hexdigest()[:12]
    return Path(home or orc_home()) / PRIVATE_GUIDES_DIR / ("%s-%s.md" % (name, digest))


def private_guide(main_repo, home=None):
    """The private guide for ``main_repo`` when one with content exists, or
    None."""
    path = private_guide_path(main_repo, home)
    try:
        return path if path.is_file() and path.stat().st_size > 0 else None
    except OSError:
        return None


def home_relative(path):
    """``path`` in ~ form when it sits under the home folder, for display."""
    home = os.path.expanduser("~")
    path = str(path)
    return "~" + path[len(home):] if path == home or path.startswith(home + os.sep) else path


def guides(repo, plugin_guides, home=None):
    """Every guide runs in ``repo`` (a main checkout or a worktree) follow
    besides its own instructions: the private guide first, then each enabled
    plugin's, as ``{'source', 'path'}`` rows (plugin rows add ``plugin``)."""
    rows = []
    main = main_checkout(repo)
    found = private_guide(main, home) if main else None
    if found:
        rows.append({"source": "private", "path": str(found)})
    rows.extend({"source": "plugin", "plugin": row["plugin"], "path": str(row["path"])}
                for row in plugin_guides(repo))
    return rows


def verifying_section(text):
    """The first section of Markdown ``text`` whose heading is about verifying,
    as ``(heading, section)``: the section runs from that heading to the next
    one at its level or above. Lines inside fenced code are not headings, so a
    shell comment in a code block neither starts nor ends a section. None when
    no heading is about verifying."""
    lines = text.splitlines()
    start = level = title = fence = None
    for index, line in enumerate(lines):
        opened = FENCE.match(line)
        if fence:
            if opened and opened.group(1)[0] == fence[0] and len(opened.group(1)) >= len(fence) \
                    and not line.strip()[len(opened.group(1)):]:
                fence = None
            continue
        if opened:
            fence = opened.group(1)
            continue
        heading = HEADING.match(line)
        if not heading:
            continue
        if start is None:
            if VERIFYING.search(heading.group(2)):
                start, level, title = index, len(heading.group(1)), heading.group(2)
        elif len(heading.group(1)) <= level:
            return title, "\n".join(lines[start:index]).rstrip()
    return (title, "\n".join(lines[start:]).rstrip()) if start is not None else None


def read_text(path, limit=MAX_INSTRUCTIONS_BYTES):
    """Up to ``limit`` characters of the file at ``path``, or None."""
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read(limit)
    except OSError:
        return None


def steps_text(text):
    """``text`` cut to what project Settings shows."""
    return text if len(text) <= MAX_STEPS_CHARS else text[:MAX_STEPS_CHARS].rstrip() + "\n…"


def instructions_section(repo):
    """The first agent instructions file in ``repo`` with a section about
    verifying, as ``{'file', 'heading', 'steps'}``, or None."""
    for name in INSTRUCTION_FILES:
        text = read_text(os.path.join(repo, name))
        found = verifying_section(text) if text else None
        if found:
            return {"file": name, "heading": found[0], "steps": steps_text(found[1])}
    return None


def chosen_projects(config, choice):
    """The project keys saved under ``choice`` (``started`` or ``skipped``)."""
    ui = config.get("ui") if isinstance(config, dict) else None
    raw = ui.get(CHOICE_KEYS[choice]) if isinstance(ui, dict) else None
    return [entry for entry in raw if isinstance(entry, str)] if isinstance(raw, list) else []


def with_choice(config, key, choice):
    """``config`` with ``key`` saved under ``choice`` and removed from the
    other list (``choice`` None removes it from both), or None when that
    changes nothing."""
    if choice is not None and choice not in CHOICE_KEYS:
        raise ValueError("choice must be started, skipped or null")
    ui = config.get("ui") if isinstance(config.get("ui"), dict) else {}
    changed = {}
    for name, field in CHOICE_KEYS.items():
        current = chosen_projects(config, name)
        result = [entry for entry in current if entry != key] + ([key] if choice == name else [])
        if result != ui.get(field, []) and (field in ui or result):
            changed[field] = result
    return {**config, "ui": {**ui, **changed}} if changed else None


def status(repo, key, config, plugin_guides, home=None):
    """What the project home and project Settings show for the main checkout
    ``repo``: ``state`` is ``repo`` (its own section), ``private`` (the
    user's private guide), ``plugin`` (a plugin's guide covers it),
    ``skipped`` (Not now), ``dismissed`` (setup started) or ``missing``. The
    first three carry ``steps``, the text runs follow.
    ``plugin_guides`` is a callable so the plugin lookup, which runs git,
    only happens when the repository has no section of its own."""
    found = instructions_section(repo)
    if found:
        return {"state": "repo", **found}
    private = private_guide(repo, home)
    if private:
        return {"state": "private", "path": home_relative(private),
                "steps": steps_text(read_text(private) or "")}
    covered = plugin_guides(repo)
    if covered:
        return {"state": "plugin", "plugin": covered[0]["plugin"],
                "steps": steps_text(read_text(covered[0]["path"]) or "")}
    if key in chosen_projects(config, "skipped"):
        return {"state": "skipped"}
    if key in chosen_projects(config, "started"):
        return {"state": "dismissed"}
    return {"state": "missing"}
