"""The steps a finished plan lists under `## Work`.

A planning session's `planning/planning.mdx` names the runs it expects as a
numbered list, one item per run (skills/_shared/planning-session.md). The plan
page reads the same list in `ui/js/plan-page.js`; the two share
`tests/fixtures/plan-steps.json` so they cannot drift apart.
"""
import re

_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_SECTION = re.compile(r"^##\s+(.+?)\s*#*\s*$")
_ITEM = re.compile(r"^ {0,3}\d{1,3}[.)]\s+(\S.*)$")
_INLINE = (
    (re.compile(r"!?\[([^\]]*)\]\([^)]*\)"), r"\1"),
    (re.compile(r"(\*\*|__|`|~~)"), ""),
    (re.compile(r"(^|[\s(])[*_](?=\S)|(?<=\S)[*_](?=[\s).,;:!?]|$)"), r"\1"),
    (re.compile(r"\s+"), " "),
)


def _plain(text):
    for pattern, replacement in _INLINE:
        text = pattern.sub(replacement, text)
    return text.strip()


def _title(first_line):
    bold = re.match(r"\*\*(.+?)\*\*", first_line)
    if bold:
        return re.sub(r"[.:,;]+$", "", _plain(bold.group(1)))
    plain = _plain(first_line)
    stop = re.search(r"[.:](?:\s|$)", plain)
    name = plain[:stop.start()] if stop and stop.start() > 0 else plain
    if len(name) > 90:
        name = re.sub(r"\s+\S*$", "", name[:89]) + "…"
    return name


def _work(text):
    """Lines of the first `## Work` section, or None when the plan has none."""
    rows, fence, inside = None, "", False
    for row in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        mark = _FENCE.match(row)
        if mark and (not fence or fence == mark.group(1)[0]):
            fence = "" if fence else mark.group(1)[0]
        elif not fence:
            heading = _SECTION.match(row)
            if heading:
                if inside:
                    break
                inside = heading.group(1).strip().lower() == "work"
                if inside:
                    rows = []
                continue
        if inside:
            rows.append(row)
    return rows


def _items(text):
    """Each Work item as its lines, the first one without its number."""
    items = []
    gap = False
    fence = ""
    for row in _work(text) or ():
        opened = bool(fence)
        mark = re.match(r"\s*(`{3,}|~{3,})", row)
        if mark and (not fence or fence == mark.group(1)[0]):
            fence = "" if fence else mark.group(1)[0]
        if opened:
            # Inside a code block nothing is a step.
            if items:
                items[-1].append(row)
            gap = False
            continue
        item = _ITEM.match(row)
        if item:
            items.append([item.group(1)])
            gap = False
        elif not items:
            continue
        elif not row.strip():
            gap = True
        elif gap and not re.match(r"\s{2,}\S", row):
            # A flush line after a blank one ends the list.
            break
        else:
            items[-1].append(row)
            gap = False
    return items


# The repository a step builds in: a code span in brackets on the item's first
# line, as `**Export worker** (`serverless`).` Steps that wait on another say
# so in the item, as `Waits on step 1.` or `Waits on steps 1 and 2.`
_REPO = re.compile(r"\s*\(\s*`([^`\n]+)`\s*\)")
_WAITS = re.compile(r"\bwaits?\s+(?:on|for)\s+steps?\s+(\d{1,3}(?:(?:\s*,\s*|\s*,?\s+and\s+)\d{1,3})*)",
                    re.I)


def _step(lines):
    first = lines[0]
    repo = _REPO.search(first)
    if repo:
        first = first[:repo.start()] + first[repo.end():]
    waits = []
    for match in _WAITS.finditer(_plain(" ".join(lines))):
        for number in re.findall(r"\d+", match.group(1)):
            if int(number) not in waits:
                waits.append(int(number))
    return {"title": _title(first), "repo": repo.group(1).strip() if repo else "",
            "waitsOn": waits}


def steps(text):
    """Each step's name, repository and the steps it waits on, in order."""
    found = [_step(lines) for lines in _items(text)]
    for number, step in enumerate(found, 1):
        # A step waits only on an earlier step, so a group always starts.
        step["waitsOn"] = [n for n in step["waitsOn"] if 1 <= n < number]
    return found


def titles(text):
    """The name of each step, in order. Empty for a plan one run builds."""
    return [step["title"] for step in steps(text)]
