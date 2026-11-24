"""A run's QA steps and what you found walking through them.

The steps are typed: a page to open, a command to run or an MCP call to send
to main and to the run. A run's agent writes them to `qa/steps.json` through
`orc-qa-steps`; a run with no such file gets steps read from its PR body's QA
section, linked to the worktree pages it recorded. Review in Orc seeds the file
from the pull request's QA section at launch (`seeded_document`), so the window
has steps before the review agent types them. Results live beside them in
`qa/results.json`, which only the server writes."""
import difflib
import hashlib
import json
import os
import re
import tempfile

# Headings a pull request's QA section goes by. Orc's own PR bodies use the
# first two (orc-pr-body-lint); other authors' pull requests often use the rest.
QA_HEADINGS = ("qa", "qa steps", "how to test", "test plan")
HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$")
STEP = re.compile(r"^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(\S.*)$")
IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
EMPHASIS = re.compile(r"(\*\*|__)(.+?)\1")
MAX_STEPS = 20
MAX_TEXT = 400
MAX_TITLE = 160
MAX_COMMAND = 2000
MAX_ARGUMENTS = 16 * 1024

STEPS_FILE = "qa/steps.json"
RESULTS_FILE = "qa/results.json"
KINDS = ("page", "command", "mcp")
# Where the steps came from: the pull request's own QA section, or the diff
# when it had none, which the QA window says above the steps.
SOURCES = ("pr-body", "diff")
# Steps are the QA steps unless they say `"group": "edge"`: an edge case Orc
# found worth checking, such as another plan, role or account setup the change
# branches on. Edge cases come after the QA steps, each saying `why`, and the
# window lists them under their own heading.
EDGE = "edge"
MAX_EDGE_CASES = 6
STEP_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,31}")
MCP_NAME = re.compile(r"[^\s\x00-\x1f\x7f]{1,200}")
VERDICTS = ("pass", "fail")
MAX_NOTE = 2000
MAX_DIFFERENCES = 12
MAX_ROWS = 2000
MAX_ROW_TEXT = 2000
# Above this, two answers are not compared line by line: the comparison is
# quadratic, and its rows ride on every poll of the QA window.
MAX_COMPARE_BYTES = 512 * 1024
SHOT_PATH = re.compile(r"qa/shots/[a-z0-9][a-z0-9-]{0,31}-\d{1,3}\.(?:png|jpg)")


class QaError(ValueError):
    """Steps or a result that do not fit the contract."""


def plain(text):
    text = IMAGE.sub("", text)
    text = LINK.sub(r"\1", text)
    text = EMPHASIS.sub(r"\2", text)
    text = re.sub(r"\s+", " ", text.replace("`", "")).strip()
    return text if len(text) <= MAX_TEXT else text[:MAX_TEXT - 1] + "…"


def section_steps(markdown):
    """The QA section's list items as plain text, in order. Indented lines
    continue the step above; tables and images inside the section are not
    steps."""
    steps, inside = [], False
    for line in markdown.splitlines():
        heading = HEADING.match(line)
        if heading:
            if inside:
                break
            inside = heading.group(1).strip().casefold() in QA_HEADINGS
            continue
        if not inside or not line.strip():
            continue
        step = STEP.match(line.strip())
        if step and len(line) - len(line.lstrip()) < 2:
            steps.append(step.group(1))
        elif steps and line[:1].isspace():
            steps[-1] += " " + (step.group(1) if step else line.strip())
    return [text for text in (plain(step) for step in steps[:MAX_STEPS]) if text]


def root_relative(path):
    return (isinstance(path, str) and path.startswith("/")
            and not path.startswith("//") and not re.search(r"[\s\\\x00-\x1f\x7f]", path))


def recorded_links(meta):
    """meta.worktree.relevantLinks as (qaStep or None, link) pairs."""
    worktree = meta.get("worktree") if isinstance(meta.get("worktree"), dict) else {}
    candidates = worktree.get("relevantLinks")
    if not isinstance(candidates, list):
        return []
    pairs, seen = [], set()
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        title, path, step = candidate.get("title"), candidate.get("path"), candidate.get("qaStep")
        if not isinstance(title, str) or not title.strip() or not root_relative(path):
            continue
        if not isinstance(step, int) or isinstance(step, bool) or step < 1:
            step = None
        if (step, path) in seen:
            continue
        seen.add((step, path))
        pairs.append((step, {"title": title.strip(), "path": path}))
    return pairs


# Words too common to tie a step to a page.
COMMON_WORDS = frozenset("a an and as at by for from go in into is it of on open or see the then this to under with you your".split())


def _words(text):
    return {word for word in re.findall(r"[a-z0-9]+", (text or "").casefold()) if word not in COMMON_WORDS}


def fallback_paths(steps, meta):
    """{step id: path} for page steps with no page of their own: the page the
    run recorded whose title shares the most words with the step's text, the
    first recorded on a tie. A run that recorded one page sends every such
    step there, which beats the app's home page."""
    pages = []
    for _, link in recorded_links(meta):
        if link["path"] not in (path for _, path in pages):
            pages.append((_words(link["title"]), link["path"]))
    if not pages:
        return {}
    found = {}
    for step in steps:
        if step.get("kind") != "page" or step.get("path"):
            continue
        words = _words(" ".join(filter(None, (step.get("title"), step.get("do")))))
        score, path = max(((len(words & title), path) for title, path in pages), key=lambda pair: pair[0])
        if score or len(pages) == 1:
            found[step["id"]] = path
    return found


def _text(value, name, limit, required=False):
    if value is None or value == "":
        if required:
            raise QaError("%s is required" % name)
        return None
    if not isinstance(value, str):
        raise QaError("%s must be text" % name)
    value = re.sub(r"[ \t]+", " ", value.replace("\r", "")).strip()
    if not value:
        if required:
            raise QaError("%s is required" % name)
        return None
    if len(value) > limit:
        raise QaError("%s is longer than %d characters" % (name, limit))
    if re.search(r"[\x00-\x08\x0b-\x1f\x7f]", value):
        raise QaError("%s has control characters" % name)
    return value


def _step(raw, number, taken):
    where = "step %d" % number
    if not isinstance(raw, dict):
        raise QaError("%s must be an object" % where)
    kind = raw.get("kind")
    if kind not in KINDS:
        raise QaError("%s: kind must be one of %s" % (where, ", ".join(KINDS)))
    step_id = raw.get("id", "s%d" % number)
    if not isinstance(step_id, str) or not STEP_ID.fullmatch(step_id):
        raise QaError("%s: id must be lower-case letters, digits and dashes" % where)
    if step_id in taken:
        raise QaError("%s: id %s is used twice" % (where, step_id))
    taken.add(step_id)
    step = {"id": step_id, "kind": kind,
            "title": _text(raw.get("title"), where + ": title", MAX_TITLE, required=True).replace("\n", " "),
            "do": _text(raw.get("do"), where + ": do", MAX_TEXT),
            "expect": _text(raw.get("expect"), where + ": expect", MAX_TEXT)}
    group = raw.get("group")
    if group not in (None, EDGE):
        raise QaError("%s: group must be %s, or left out for a QA step" % (where, EDGE))
    if group == EDGE:
        step["group"] = EDGE
        step["why"] = _text(raw.get("why"), where + ": why", MAX_TEXT, required=True)
    elif raw.get("why") is not None:
        raise QaError("%s: why belongs to an edge case (\"group\": \"%s\")" % (where, EDGE))
    if kind == "page":
        path = raw.get("path")
        if path is not None and not root_relative(path):
            raise QaError("%s: path must start with one / and name a page in the app" % where)
        step["path"] = path
    elif kind == "command":
        # Kept character for character: squeezing spaces as for prose would
        # change what a quoted argument means.
        command = raw.get("command")
        if not isinstance(command, str) or not command.strip():
            raise QaError("%s: command is required" % where)
        command = command.strip()
        if len(command) > MAX_COMMAND:
            raise QaError("%s: command is longer than %d characters" % (where, MAX_COMMAND))
        if re.search(r"[\x00-\x08\x0a-\x1f\x7f]", command):
            raise QaError("%s: command must be one line" % where)
        step["command"] = command
    else:
        call = raw.get("mcp")
        if not isinstance(call, dict):
            raise QaError("%s: mcp must be an object with a tool" % where)
        tool, arguments, path = call.get("tool"), call.get("arguments", {}), call.get("path")
        if not isinstance(tool, str) or not MCP_NAME.fullmatch(tool):
            raise QaError("%s: mcp.tool must name one tool" % where)
        if not isinstance(arguments, dict):
            raise QaError("%s: mcp.arguments must be an object" % where)
        if len(json.dumps(arguments)) > MAX_ARGUMENTS:
            raise QaError("%s: mcp.arguments are too large" % where)
        if path is not None and not root_relative(path):
            raise QaError("%s: mcp.path must start with one /" % where)
        step["mcp"] = {"tool": tool, "arguments": arguments, **({"path": path} if path else {})}
    return step


def validate(document):
    """The steps document an agent wrote, checked and in its stored shape."""
    if not isinstance(document, dict):
        raise QaError("expected an object with source and steps")
    source = document.get("source", "pr-body")
    if source not in SOURCES:
        raise QaError("source must be one of %s" % ", ".join(SOURCES))
    raw = document.get("steps")
    if not isinstance(raw, list) or not raw:
        raise QaError("steps must be a list with at least one step")
    if len(raw) > MAX_STEPS:
        raise QaError("more than %d steps" % MAX_STEPS)
    taken = set()
    steps = [_step(step, index + 1, taken) for index, step in enumerate(raw)]
    edges = [index for index, step in enumerate(steps) if step.get("group") == EDGE]
    if edges and edges != list(range(edges[0], len(steps))):
        raise QaError("step %d: edge cases come after every QA step" % (edges[0] + 1))
    if len(edges) > MAX_EDGE_CASES:
        raise QaError("more than %d edge cases" % MAX_EDGE_CASES)
    if len(edges) == len(steps):
        raise QaError("steps need at least one QA step before the edge cases")
    stored = {"schemaVersion": 1, "source": source, "steps": steps}
    if document.get("seeded") is True:
        # Only the server writes these (seeded_document), and orc-qa-steps
        # publish drops the mark: typed steps replace them.
        if source != "pr-body" or edges or any(step["kind"] != "page" for step in steps):
            raise QaError("seeded steps are the pull request's own QA items, as pages")
        stored["seeded"] = True
        for step in steps:
            step["seeded"] = True
    return stored


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def write_json(path, value):
    """Atomic, so a reader never sees half a file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".qa.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def written_steps(run_dir):
    """The steps the run's agent wrote, or None when there are none or the
    file does not fit: a hand-edited file must not break the window."""
    document = _read_json(os.path.join(run_dir, STEPS_FILE))
    if document is None:
        return None
    try:
        return validate(document)
    except QaError:
        return None


def section_page_steps(markdown, links=None):
    """The QA section's items as page steps, each on the page `links` gives
    its number, if any."""
    links = links or {}
    return [{"id": "s%d" % (index + 1), "kind": "page",
             "title": text if len(text) <= MAX_TITLE else text[:MAX_TITLE - 1] + "…",
             "do": text if len(text) > MAX_TITLE else None, "expect": None,
             "path": links.get(index + 1)} for index, text in enumerate(section_steps(markdown or ""))]


def seeded_document(markdown):
    """Steps for the QA window before anyone has read the change: the pull
    request's QA section, item for item, marked `seeded` so the window shows
    them without a kind and says the review is still typing them. None when
    the description has no QA section. Their ids (`pr-1`, `pr-2`, ...) are
    ones a typed step only gets by copying one on purpose, never by default,
    so a result moves to a typed step only when the review says it is the
    same step."""
    steps = [dict(step, id="pr-%d" % number) for number, step in enumerate(section_page_steps(markdown), 1)]
    if not steps:
        return None
    try:
        return validate({"source": "pr-body", "seeded": True, "steps": steps})
    except QaError:
        return None


def derived_steps(markdown, meta):
    """Steps for a run whose agent wrote none: its PR body's QA section, each
    item a page step on the page the run linked to it, then the MCP calls the
    run recorded as showing the change."""
    links = {}
    for number, link in recorded_links(meta):
        if number:
            links.setdefault(number, link["path"])
    steps = section_page_steps(markdown, links)
    setups = meta.get("mcpSetups")
    for entry in setups if isinstance(setups, list) else []:
        if len(steps) >= MAX_STEPS:
            break
        tool = entry.get("tool") if isinstance(entry, dict) else None
        arguments = entry.get("arguments", {}) if isinstance(entry, dict) else None
        title = entry.get("title") if isinstance(entry, dict) else None
        if (not isinstance(tool, str) or not MCP_NAME.fullmatch(tool) or not isinstance(arguments, dict)
                or len(json.dumps(arguments)) > MAX_ARGUMENTS):
            continue
        steps.append({"id": "s%d" % (len(steps) + 1), "kind": "mcp",
                      "title": (title.strip()[:MAX_TITLE] if isinstance(title, str) and title.strip()
                                else "Compare %s on main and this run" % tool),
                      "do": None, "expect": None, "mcp": {"tool": tool, "arguments": arguments}})
    if not steps:
        return None
    return {"schemaVersion": 1, "source": "pr-body", "steps": steps}


def steps_for(run_dir, meta):
    """The run's steps document, or None when it has none yet."""
    written = written_steps(run_dir)
    if written is not None:
        return written
    try:
        with open(os.path.join(run_dir, "pr-body.md"), encoding="utf-8") as handle:
            markdown = handle.read(262144)
    except (OSError, UnicodeDecodeError):
        markdown = None
    return derived_steps(markdown, meta)


def step_hash(step):
    """What a result was recorded against. A step that is rewritten loses its
    result: the verdict was about other words."""
    fields = {key: step.get(key) for key in ("kind", "title", "do", "expect", "path", "command", "mcp")}
    if step.get("group") == EDGE:
        # Only edge cases carry these, so a QA step keeps the hash its
        # result was recorded against before groups existed.
        fields.update(group=EDGE, why=step.get("why"))
    return hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()[:16]


def read_results(run_dir):
    document = _read_json(os.path.join(run_dir, RESULTS_FILE))
    steps = document.get("steps") if isinstance(document, dict) else None
    return {"schemaVersion": 1,
            "steps": {key: value for key, value in (steps if isinstance(steps, dict) else {}).items()
                      if isinstance(key, str) and isinstance(value, dict)},
            "finishedAt": document.get("finishedAt") if isinstance(document, dict)
            and isinstance(document.get("finishedAt"), str) else None}


def write_results(run_dir, results):
    write_json(os.path.join(run_dir, RESULTS_FILE), results)


def _carries(stored, step):
    """Whether a result recorded on a seeded step still holds for `step`, the
    typed step that kept the seeded step's id: the review agent keeps the id
    only for a step that checks the same thing (skills/_shared/qa-steps.md),
    so its result outlives the page, command or expectation added to it. An
    edge case was never seeded."""
    return stored.get("seeded") is True and step.get("group") != EDGE


def result_for(results, step):
    """The stored result for `step`, or an empty one when it was recorded
    against different words."""
    stored = results["steps"].get(step["id"])
    if not stored or (stored.get("hash") != step_hash(step) and not _carries(stored, step)):
        return {}
    return stored


def entry_for(results, step):
    """The result to change for `step`, started afresh when the step changed.
    One recorded on a seeded step says so, so the typed step that keeps its
    id keeps it."""
    current = step_hash(step)
    stored = results["steps"].get(step["id"])
    if not stored or (stored.get("hash") != current and not _carries(stored, step)):
        stored = results["steps"][step["id"]] = {"hash": current}
    stored["hash"] = current
    if step.get("seeded") is True:
        stored["seeded"] = True
    else:
        stored.pop("seeded", None)
    return stored


def _short(value, limit=40):
    text = json.dumps(value, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit - 1] + "…"


def _key(parent, key):
    if isinstance(key, int):
        return "%s[%d]" % (parent, key)
    return "%s.%s" % (parent, key) if parent else str(key)


def _differences(main, pr, path, found):
    if main == pr:
        return
    if isinstance(main, dict) and isinstance(pr, dict):
        for key in list(main) + [key for key in pr if key not in main]:
            if key not in pr:
                found.append("%s removed" % _key(path, key))
            elif key not in main:
                found.append("%s added" % _key(path, key))
            else:
                _differences(main[key], pr[key], _key(path, key), found)
        return
    if isinstance(main, list) and isinstance(pr, list):
        before = [json.dumps(item, sort_keys=True) for item in main]
        after = [json.dumps(item, sort_keys=True) for item in pr]
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, before, after, autojunk=False).get_opcodes():
            if tag == "equal":
                continue
            paired = min(i2 - i1, j2 - j1) if tag == "replace" else 0
            for offset in range(paired):
                _differences(main[i1 + offset], pr[j1 + offset], _key(path, j1 + offset), found)
            for index in range(i1 + paired, i2):
                found.append("%s removed" % _key(path, index))
            for index in range(j1 + paired, j2):
                found.append("%s added" % _key(path, index))
        return
    found.append("%s %s → %s" % (path or "value", _short(main), _short(pr)))


def comparable(main, pr):
    """Whether two answers are small enough to compare in full."""
    return len(json.dumps(main)) + len(json.dumps(pr)) <= MAX_COMPARE_BYTES


def differences(main, pr):
    """What differs between two responses, one short label per place, in the
    order the pull request's response lists them."""
    if not comparable(main, pr):
        return [] if main == pr else [{"label": "too large to list"}]
    found = []
    _differences(main, pr, "", found)
    labels = [{"label": label} for label in found[:MAX_DIFFERENCES]]
    if len(found) > MAX_DIFFERENCES:
        labels.append({"label": "+%d more" % (len(found) - MAX_DIFFERENCES)})
    return labels


def pretty(value):
    """An answer as the lines the window shows. A side that never answered
    has none, so the other side's lines face a gap, not the word null."""
    return [] if value is None else json.dumps(value, indent=2, ensure_ascii=False).splitlines()


def _row_text(line):
    return line if len(line) <= MAX_ROW_TEXT else line[:MAX_ROW_TEXT - 1] + "…"


def diff_rows(main, pr):
    """The two responses pretty-printed and aligned line by line: a line only
    one side has leaves a gap on the other."""
    if not comparable(main, pr):
        note = "These answers are too large to show line by line."
        return [{"kind": "same" if main == pr else "changed", "main": note, "pr": note}]
    left, right = [_row_text(line) for line in pretty(main)], [_row_text(line) for line in pretty(pr)]
    rows = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, left, right, autojunk=False).get_opcodes():
        if tag == "equal":
            rows += [{"kind": "same", "main": line, "pr": line} for line in left[i1:i2]]
            continue
        paired = min(i2 - i1, j2 - j1)
        rows += [{"kind": "changed", "main": left[i1 + offset], "pr": right[j1 + offset]}
                 for offset in range(paired)]
        rows += [{"kind": "removed", "main": line, "pr": None} for line in left[i1 + paired:i2]]
        rows += [{"kind": "added", "main": None, "pr": line} for line in right[j1 + paired:j2]]
    if len(rows) > MAX_ROWS:
        rows = rows[:MAX_ROWS] + [{"kind": "same", "main": "…", "pr": "…"}]
    return rows
