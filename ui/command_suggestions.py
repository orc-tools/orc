"""Commands a project's own files suggest for its dev server and its deploy.

Every answer here is a suggestion for the project's settings to offer: the
user saves it with one press, and nothing in Orc runs it before they do.
README text is untrusted, so only one plain shell line from one of its code
blocks is ever offered, and only when it starts the way known dev or deploy
commands start.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re

README_NAMES = ("README.md", "readme.md", "Readme.md", "README.markdown", "README")
MAKEFILE_NAMES = ("GNUmakefile", "makefile", "Makefile")
DEV_SCRIPTS = ("dev:serve", "dev", "start")
DEPLOY_SCRIPTS = ("bin/deploy", "script/deploy", "scripts/deploy.sh",
                  "tools/deploy.sh", "deploy.sh")
# Prefer the most specific lockfile when a project keeps several.
RUNNERS = (("bun.lock", "bun"), ("bun.lockb", "bun"),
           ("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"),
           ("package-lock.json", "npm"))
README_LIMIT = 256 * 1024
LINE_LIMIT = 160
# A line a README may suggest: words, paths, flags and `=`/`:`/`@` values.
# No pipes, redirects, substitutions or chained commands.
PLAIN_LINE = re.compile(r"[A-Za-z0-9_./:=@,+-]+( [A-Za-z0-9_./:=@,+{}-]+)*\Z")
README_DEV = re.compile(
    r"((npm|pnpm|yarn|bun) (run )?(dev|start|serve)\b"
    r"|bin/dev\b|bin/rails server\b|rails s(erver)?\b"
    r"|python3? manage\.py runserver\b|flask run\b|uvicorn |hugo server\b"
    r"|(bundle exec )?jekyll serve\b|mix phx\.server\b|php artisan serve\b)")
README_DEPLOY = re.compile(
    r"((npm|pnpm|yarn|bun) (run )?deploy\b|make deploy\b|(npx )?wrangler deploy\b"
    r"|fly(ctl)? deploy\b|(npx )?vercel (deploy|--prod)\b|(npx )?netlify deploy\b"
    r"|firebase deploy\b|kamal deploy\b|cap [a-z]+ deploy\b|bin/deploy\b"
    r"|(sh |bash )?(\./)?[A-Za-z0-9_./-]*deploy\.sh\b)")
MAKE_RULE = re.compile(r"^ *([A-Za-z0-9_.-]+(?:[ \t]+[A-Za-z0-9_.-]+)*)[ \t]*:(.*)$")
MAKE_ASSIGNMENT = re.compile(r"^[ \t]*(?:(?:[^\s:=+?!]+)[ \t]*)?(?::+|[+?!])?=")


def runner(repo: Path) -> str:
    return next((name for lock, name in RUNNERS if (repo / lock).is_file()), "npm")


def package_scripts(repo: Path) -> dict:
    try:
        scripts = json.loads((repo / "package.json").read_text()).get("scripts")
    except (OSError, ValueError, AttributeError):
        return {}
    return scripts if isinstance(scripts, dict) else {}


def make_command(repo: Path, target: str) -> dict | None:
    try:
        names = set(os.listdir(repo))
    except OSError:
        return None
    for name in MAKEFILE_NAMES:
        if name not in names:
            continue
        try:
            text = (repo / name).read_text(errors="replace")
        except OSError:
            continue
        for line in re.sub(r"\\\n", " ", text).splitlines():
            match = MAKE_RULE.match(line)
            if match and target in match[1].split() and not MAKE_ASSIGNMENT.match(match[2].removeprefix(":")):
                return {"command": "make " + target, "source": name}
        break
    return None


def readme_commands(repo: Path) -> list[str]:
    """Plain one-line commands from the README's fenced code blocks, in order."""
    for name in README_NAMES:
        try:
            with open(repo / name, encoding="utf-8", errors="replace") as handle:
                text = handle.read(README_LIMIT)
        except OSError:
            continue
        lines, fence = [], None
        for raw in text.splitlines():
            stripped = raw.strip()
            marker = re.match(r"(`{3,}|~{3,})", stripped)
            if marker:
                fence = None if fence and stripped.startswith(fence) else (fence or marker.group(1))
                continue
            if fence is None:
                continue
            line = re.sub(r"^\$\s+", "", stripped)
            if line and len(line) <= LINE_LIMIT and PLAIN_LINE.match(line):
                lines.append(line)
        return lines
    return []


def readme_match(repo: Path, pattern: re.Pattern) -> str | None:
    return next((line for line in readme_commands(repo) if pattern.match(line)), None)


def readme_dev(repo: Path) -> dict | None:
    """A recognized dev server command from the README."""
    command = readme_match(repo, README_DEV)
    return {"command": command, "source": "README"} if command else None


def dev_command(repo: Path) -> dict | None:
    scripts = package_scripts(repo)
    for script in DEV_SCRIPTS:
        value = scripts.get(script)
        if isinstance(value, str) and value.strip():
            manager = runner(repo)
            return {"command": "%s run %s -- --port {port}" % (manager, script),
                    "install": "%s install" % manager,
                    "source": "package.json", "script": script}
    path = repo / "bin/dev"
    if path.is_file() and os.access(path, os.X_OK):
        return {"command": "bin/dev", "source": "bin/dev"}
    return make_command(repo, "dev") or readme_dev(repo)


def deploy_command(repo: Path) -> dict | None:
    """{command, source} for the project's deploy, or None when its files
    name none. Checked from the most to the least explicit place."""
    scripts = package_scripts(repo)
    for script in ("deploy", "deploy:prod", "deploy:production"):
        if isinstance(scripts.get(script), str):
            return {"command": "%s run %s" % (runner(repo), script), "source": "package.json"}
    make = make_command(repo, "deploy")
    if make:
        return make
    for path in DEPLOY_SCRIPTS:
        if (repo / path).is_file():
            command = path if path.startswith(("bin/", "script/")) else "sh " + path
            return {"command": command, "source": path}
    command = readme_match(repo, README_DEPLOY)
    return {"command": command, "source": "README"} if command else None
