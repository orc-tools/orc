"""What a plan run's plan must hold before the user is asked to read it.

A plan run (skills/orc-plan/SKILL.md) writes a plan that fits on about one
screen: what will change, a mockup when the change is visual, what Orc
assumed, and what it leaves out. Earlier plans ran to thousands of words and
went unread, so `bin/orc-plan-ready` refuses a plan that is missing a part,
runs long, or names a picture that is not in the run folder.

When a guess hangs on production data, the plan puts a check under it: a
read-only SQL query for the read replica or an `aws` command in a fenced
block, for the user to run and paste back. Checks do not count toward the
word limit, and this module refuses one that could change data.
"""
import os
import re
import shlex

import plan_steps

WORD_LIMIT = 300
# A plan that several runs build names each of them under `## Work`.
WORD_LIMIT_WITH_STEPS = 450
MAX_PAIRS = 3
MAX_CHECKS = 3
SQL_LANGUAGES = {"sql", "postgres", "postgresql", "psql", "pgsql", "mysql"}
# A statement a check may run on the read replica starts with one of these.
# The words and functions after them change data, take locks or end
# sessions wherever they appear, even inside a WITH or EXPLAIN.
SQL_READ = re.compile(r"(?i)^(select|with|explain|show|describe|desc|values|table)\b")
SQL_WRITE = re.compile(
    r"(?i)\b(insert|update|delete|merge|drop|alter|truncate|create|grant|revoke|call|copy"
    r"|lock|into|nextval|setval|set_config|pg_terminate_backend|pg_cancel_backend"
    r"|pg_advisory_lock|pg_reload_conf|dblink|lo_import|lo_unlink)\b")
# `aws` global options that take a value before the service name.
AWS_VALUE_OPTIONS = {"--profile", "--region", "--output", "--endpoint-url", "--query",
                     "--color", "--ca-bundle", "--cli-read-timeout", "--cli-connect-timeout",
                     "--cli-binary-format"}
AWS_READ = re.compile(r"^(describe|get|list)-")
# The parts in reading order, each with the headings that name it.
PARTS = (
    ("change", ("what will change",)),
    ("mockup", ("mockup", "mockups")),
    ("assumed", ("what orc assumed", "assumptions")),
    ("out", ("left out", "what it leaves out", "out of scope")),
)
REQUIRED = ("change", "assumed", "out")
PART_NAMES = {"change": "What will change", "mockup": "Mockup",
              "assumed": "What Orc assumed", "out": "Left out"}

_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_HEADING = re.compile(r"^##\s+(.+?)\s*#*\s*$")
_TITLE = re.compile(r"^#\s+\S")
_FRONT_MATTER = re.compile(r"\A---\s*\n.*?\n---\s*(?:\n|\Z)", re.S)
_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
_LINK = re.compile(r"(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
_WORD = re.compile(r"[^\W_]+(?:['’.-][^\W_]+)*")


def _outline(text):
    """(title line or None, intro text, [(part key or None, heading, body)])."""
    title, intro, sections, fence = None, [], [], ""
    rows = intro
    for row in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        mark = _FENCE.match(row)
        if mark and (not fence or fence == mark.group(1)[0]):
            fence = "" if fence else mark.group(1)[0]
        elif not fence:
            if title is None and not sections and _TITLE.match(row) \
                    and not "".join(intro).strip():
                title = row
                continue
            heading = _HEADING.match(row)
            if heading:
                name = heading.group(1).strip()
                key = next((part for part, names in PARTS if name.lower() in names), None)
                rows = []
                sections.append((key, name, rows))
                continue
        rows.append(row)
    return title, "\n".join(intro).strip(), [
        (key, name, "\n".join(body).strip()) for key, name, body in sections]


def _fences(text):
    """(text without fenced blocks, [(language, code)] for each fenced block).
    A block indented under a list item loses that indent."""
    prose, blocks, fence, indent, lang, code = [], [], "", 0, "", []
    for row in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        mark = _FENCE.match(row)
        if mark and not fence:
            fence, indent = mark.group(1)[0], len(row) - len(row.lstrip(" "))
            info = row.strip()[len(mark.group(1)):].split()
            lang, code = (info[0].lower() if info else ""), []
        elif mark and fence == mark.group(1)[0] and not row.strip().strip(fence):
            blocks.append((lang, "\n".join(code)))
            fence = ""
        elif fence:
            code.append(row[min(indent, len(row) - len(row.lstrip(" "))):])
        else:
            prose.append(row)
    if fence:
        blocks.append((lang, "\n".join(code)))
    return "\n".join(prose), blocks


def _shell_lines(code):
    """Each command line of a shell block, continuations joined, prompts and
    comments dropped."""
    lines = re.sub(r"\\\n", " ", code).split("\n")
    return [re.sub(r"^\$\s+", "", line.strip()) for line in lines
            if line.strip() and not line.strip().startswith("#")]


def _aws_call(command):
    """(service, operation) an `aws` command line runs, or None when the line
    does not run `aws`. Anything piped after it is not read."""
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        tokens = list(lexer)
    except ValueError:
        tokens = command.split()
    if not tokens or tokens[0] != "aws":
        return None
    names, skip = [], False
    for token in tokens[1:]:
        if re.match(r"^[;&|<>()]+$", token):
            break
        if skip:
            skip = False
        elif token.startswith("--"):
            skip = "=" not in token and token in AWS_VALUE_OPTIONS
        elif not token.startswith("-"):
            names.append(token)
            if len(names) == 2:
                break
    return tuple(names + [""] * (2 - len(names)))


def _check_kind(lang, code):
    """"sql" or "aws" when a fenced block is a check against real data."""
    if lang in SQL_LANGUAGES:
        return "sql"
    lines = _shell_lines(code)
    return "aws" if lines and _aws_call(lines[0]) is not None else None


def _check_problem(kind, code):
    """Why a check could change something, or None when it only reads."""
    if kind == "sql":
        text = re.sub(r"/\*.*?\*/|--[^\n]*", " ", code, flags=re.S)
        text = re.sub(r"'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"", "''", text)
        statements = [part.strip() for part in text.split(";") if part.strip()]
        if not statements:
            return "A SQL check is empty. Write the `SELECT` that answers the guess."
        for statement in statements:
            write = SQL_WRITE.search(statement)
            word = write.group(1) if write else (
                None if SQL_READ.match(statement) else statement.split()[0])
            if word:
                return ("A SQL check only reads: it holds `%s`. Write a `SELECT` for the "
                        "read replica." % word.upper())
        return None
    for command in _shell_lines(code):
        call = _aws_call(command)
        if call is None:
            return "An `aws` check holds only `aws` commands: `%s` is not one." % command
        service, operation = call
        if not (AWS_READ.match(operation) or (service, operation) == ("s3", "ls")):
            return ("An `aws` check only describes, gets or lists: `aws %s %s` does "
                    "more." % (service, operation))
    return None


def words(text):
    """The words a reader reads: a picture adds none, a link adds its text,
    and a fenced query or command adds none."""
    text = _IMAGE.sub(" ", _fences(_FRONT_MATTER.sub("", text))[0])
    text = _LINK.sub(lambda match: match.group(1), text)
    return len(_WORD.findall(text))


def _local(target):
    return not re.match(r"[a-z][a-z0-9+.-]*:|#|/", target, re.I)


def check(text, run_dir=None):
    """Every reason the plan is not ready to read, in reading order. Empty
    when it is. `run_dir` is where its pictures and mockups must be."""
    text = _FRONT_MATTER.sub("", text)
    title, intro, sections = _outline(text)
    problems = []
    if title is None:
        problems.append("Open the plan with `# <what the user gets>`.")
    elif not intro:
        problems.append("Under the title, say in one or two sentences what changes for the user.")
    found = [key for key, _name, _body in sections if key]
    for key in REQUIRED:
        if key not in found:
            problems.append("Add `## %s`. Write `None.` under it when it has nothing in it."
                            % PART_NAMES[key])
    for key in dict.fromkeys(found):
        if found.count(key) > 1:
            problems.append("`## %s` appears more than once." % PART_NAMES[key])
    order = [key for key, _names in PARTS if key in found]
    if list(dict.fromkeys(found)) != order:
        problems.append("Put the parts in this order: %s."
                        % ", ".join(PART_NAMES[key] for key in order))
    for key, name, body in sections:
        if key in REQUIRED and not body:
            problems.append("`## %s` is empty. Write `None.` when it has nothing in it." % name)
    steps = plan_steps.titles(text)
    if len(steps) == 1:
        problems.append("`## Work` lists one run. Leave it out: a plan with no Work list "
                        "is built by one run.")
    limit = WORD_LIMIT_WITH_STEPS if len(steps) > 1 else WORD_LIMIT
    count = words(text)
    if count > limit:
        problems.append("The plan is %d words. A plan fits on one screen: cut it to %d or fewer."
                        % (count, limit))
    checks = 0
    for key, name, body in [(None, None, intro)] + sections:
        for lang, code in _fences(body)[1]:
            kind = _check_kind(lang, code)
            if kind is None:
                continue
            checks += 1
            if key != "assumed":
                problems.append("A check sits under its guess in `## What Orc assumed`, "
                                "not %s." % ("in `## %s`" % name if name else "above the parts"))
            problem = _check_problem(kind, code)
            if problem:
                problems.append(problem)
    if checks > MAX_CHECKS:
        problems.append("The plan has %d checks. Keep at most %d: the guesses whose answer "
                        "would change the plan." % (checks, MAX_CHECKS))
    mockups = [body for key, _name, body in sections if key == "mockup"]
    for body in mockups:
        pictures = _IMAGE.findall(body)
        if not pictures:
            problems.append("`## Mockup` shows no picture. Add the screen today and the "
                            "mockup's picture, or leave the part out.")
        if not any(target.split("?")[0].split("#")[0].endswith(".html")
                   for _text, target in _LINK.findall(body)):
            problems.append("`## Mockup` links to no mockup. Add a link to its "
                            "`mockups/<label>.html` file.")
        if len(pictures) > MAX_PAIRS * 2:
            problems.append("`## Mockup` shows %d pictures. Show at most %d pairs: the "
                            "screens that change most." % (len(pictures), MAX_PAIRS))
    if run_dir:
        root = os.path.realpath(run_dir)
        base = os.path.join(root, "planning")
        seen = set()
        for _text, target in _IMAGE.findall(text) + _LINK.findall(text):
            path = target.split("?")[0].split("#")[0]
            if not _local(target) or not path or path in seen:
                continue
            seen.add(path)
            real = os.path.realpath(os.path.join(base, path))
            if not real.startswith(root + os.sep):
                problems.append("`%s` is outside the run folder. Keep pictures and "
                                "mockups in it." % path)
            elif not os.path.isfile(real):
                problems.append("`%s` is not in the run folder." % path)
    return problems


def mockups(text, run_dir):
    """The mockups a plan shows, for the run that builds it: each one's label,
    the screen today, the mockup's picture and its HTML, as paths in the run
    folder that exist. A plan with no `## Mockup` has none."""
    root = os.path.realpath(run_dir)
    base = os.path.join(root, "planning")

    def held(target):
        path = target.split("?")[0].split("#")[0]
        if not _local(target) or not path:
            return None
        real = os.path.realpath(os.path.join(base, path))
        return real if real.startswith(root + os.sep) and os.path.isfile(real) else None

    found = []
    _title, _intro, sections = _outline(_FRONT_MATTER.sub("", text))
    for key, _name, body in sections:
        if key != "mockup":
            continue
        pages = [path for path in (held(target) for _text, target in _LINK.findall(body))
                 if path and path.endswith(".html")]
        today = None
        for _alt, target in _IMAGE.findall(body):
            path = held(target)
            if path is None:
                continue
            if "/shots/before/" in path.replace(os.sep, "/"):
                today = path
                continue
            label = os.path.splitext(os.path.basename(path))[0]
            # A redone mockup's picture is `<label>-2.png`; its page keeps
            # `<label>.html`.
            stems = {os.path.splitext(os.path.basename(item))[0]: item for item in reversed(pages)}
            page = stems.get(label) or stems.get(re.sub(r"-\d+$", "", label))
            found.append({"label": label, "today": today, "picture": path,
                          "html": page or (pages[0] if len(pages) == 1 else None)})
            today = None
    return found
