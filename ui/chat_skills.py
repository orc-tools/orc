"""Discover invokable skills for the agent and repository behind a chat."""

import json
import os
from pathlib import Path
import re

import codex_rpc
import harnesses
import skill_commands


def frontmatter(path):
    try:
        with path.open(encoding="utf-8") as handle:
            text = handle.read(65536)
    except (OSError, UnicodeError):
        return {}
    match = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)", text, re.S)
    if not match:
        return {}
    fields = {}
    key = None
    for line in match[1].splitlines():
        field = re.match(r"^([\w-]+):\s*(.*)$", line)
        if field:
            key, value = field.groups()
            fields[key] = "" if value in (">", "|", ">-", "|-") else value.strip("\"'")
        elif key and line.startswith((" ", "\t")):
            fields[key] += " " + line.strip()
    return fields


def read_json(path):
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def claude_skills(cwd):
    home = Path(os.environ.get("CLAUDE_CONFIG_DIR", str(Path.home() / ".claude")))
    roots = [home]
    if cwd:
        project = Path(cwd)
        roots += [parent / ".claude" for parent in reversed([project, *project.parents])]
    found = {}

    def collect_skill(path, namespace="", name=None):
        fields = frontmatter(path)
        if fields.get("user-invocable", "true").lower() == "false":
            return
        name = namespace + (fields.get("name") or name or path.parent.name)
        if re.fullmatch(r"[\w:.-]+", name):
            found[name] = {"name": name, "description": fields.get("description", "").strip(),
                           "invocation": "/" + name, "path": str(path)}
            if fields.get("argument-hint"):
                found[name]["argumentHint"] = fields["argument-hint"].strip()

    def collect(root, namespace=""):
        for folder, pattern in (("commands", "**/*.md"), ("skills", "*/SKILL.md")):
            for path in sorted((root / folder).glob(pattern)):
                name = (path.parent.name if folder == "skills" else
                        path.relative_to(root / folder).with_suffix("").as_posix().replace("/", ":"))
                collect_skill(path, namespace, name)

    def collect_plugin(root, namespace):
        collect(root, namespace)
        paths = read_json(root / ".claude-plugin/plugin.json").get("skills", [])
        if isinstance(paths, str):
            paths = [paths]
        if not isinstance(paths, list):
            return
        for relative in paths:
            if not isinstance(relative, str) or not relative.startswith("./"):
                continue
            directory = (root / relative).resolve()
            if not directory.is_relative_to(root.resolve()):
                continue
            path = directory / "SKILL.md"
            if path.is_file():
                collect_skill(path, namespace)

    enabled = {}
    for root in roots:
        for filename in ("settings.json", "settings.local.json"):
            enabled.update(read_json(root / filename).get("enabledPlugins", {}))
    plugins = read_json(home / "plugins/installed_plugins.json").get("plugins", {})
    for plugin, entries in plugins.items():
        if enabled.get(plugin) is not True:
            continue
        for entry in entries if isinstance(entries, list) else []:
            project_path = entry.get("projectPath")
            if project_path and (not cwd or not Path(cwd).is_relative_to(project_path)):
                continue
            if entry.get("installPath"):
                collect_plugin(Path(entry["installPath"]), plugin.split("@")[0] + ":")
    for root in roots:
        collect(root)
    return list(found.values())


def orc_skills(agent):
    """Orc's own skills, invoked as `/orc:<name>`, for an agent whose turns
    point it at the skill file instead of loading Orc's plugin."""
    found = []
    for path in sorted(skill_commands.SKILLS.glob("*/SKILL.md")):
        fields = frontmatter(path)
        if fields.get("user-invocable", "true").lower() == "false":
            continue
        invocation = skill_commands.invocation(agent, path.parent.name)
        found.append({"name": invocation[1:], "description": fields.get("description", "").strip(),
                      "invocation": invocation, "path": str(path)})
        if fields.get("argument-hint"):
            found[-1]["argumentHint"] = fields["argument-hint"].strip()
    return found


def catalog(meta):
    harness = meta.get("harness") or ("claude" if meta.get("sessionId") else None)
    cwd = meta.get("repoPath") or meta.get("mainRepoPath")
    if harness == "codex":
        if not cwd:
            return {"skills": [], "error": "The chat's project is unavailable."}
        try:
            try:
                with codex_rpc.Client() as client:
                    result = client.call("skills/list", {"cwds": [cwd]})
            except (FileNotFoundError, ConnectionRefusedError):
                with codex_rpc.StdioClient(cwd) as client:
                    result = client.call("skills/list", {"cwds": [cwd]})
            found = {}
            for group in result.get("data", []):
                if group.get("cwd") != cwd:
                    continue
                for skill in group.get("skills", []):
                    name = skill.get("name", "")
                    if skill.get("enabled") is not True or not re.fullmatch(r"[\w:.-]+", name):
                        continue
                    fields = frontmatter(Path(skill.get("path", "")))
                    if fields.get("user-invocable", "true").lower() == "false":
                        continue
                    found[name] = {"name": name, "description": skill.get("description", ""),
                                   "invocation": "$" + name}
                    if fields.get("argument-hint"):
                        found[name]["argumentHint"] = fields["argument-hint"].strip()
            for skill in orc_skills("codex"):
                found.setdefault(skill["name"], {k: v for k, v in skill.items() if k != "path"})
            skills = list(found.values())
        except (OSError, codex_rpc.RpcError, ValueError):
            return {"skills": [], "error": "Could not load Codex skills. Type / again to retry."}
    elif harness == "claude":
        found = {skill["name"]: skill for skill in orc_skills("claude")}
        for skill in claude_skills(cwd):
            found[skill["name"]] = skill
        skills = list(found.values())
    else:
        listing = getattr(harnesses.get(harness), "skill_catalog", None)
        if listing is None:
            return {"skills": [], "error": "Skills are unavailable for this agent."}
        skills = listing(cwd)
    return {"skills": sorted(skills, key=lambda skill: skill["name"].casefold())}
