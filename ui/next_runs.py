"""Runs a delivered run suggests starting next.

`/orc-docs pr` closes a PR body with at most one visible `Follow-up:` line:
work this run found but left for later, often several items joined by `;`.
Chat offers each item as a run to start once the run is done, so a follow-up
is not lost in a body nobody reopens after merge.
"""
import glob
import os
import re

LIMIT = 5
MAX_CHARS = 600

# `Follow-up:`, `Follow-ups:`, `**Follow-up:**` and `**Follow-up**:`, also as
# a list item. `Follow-up` alone, without the colon, is ordinary prose, and a
# line indented four spaces is a code block.
_LABEL = r"follow[- ]?ups?\s*"
_LINE = re.compile(
    r"^ {0,3}(?:[-*+]\s+)?(?:(\*\*|__)" + _LABEL + r"(?::\1|\1\s*:)|" + _LABEL + r":)"
    r"\s*(.*\S)\s*$", re.I)
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_COMMENT = re.compile(r"<!--.*?-->", re.S)
# What an agent or a repo template writes when there is nothing to follow up.
_PLACEHOLDERS = {"none", "n/a", "na", "-", "tbd", "nothing", "no"}


def bodies(run_dir):
    """The run's PR bodies, the single body first, then grouped deliveries."""
    paths = [os.path.join(run_dir, "pr-body.md")]
    paths += sorted(glob.glob(os.path.join(run_dir, "pr-body-*.md")))
    paths += sorted(glob.glob(os.path.join(run_dir, "delivery", "*", "pr-body.md")))
    return [path for path in paths if os.path.isfile(path)]


def split_items(text):
    """Items are `;`-separated, but inline code such as `a; b` and a link's
    `(https://x/y;z)` stay whole."""
    items, current, in_code, depth = [], [], False, 0
    for char in text:
        if char == "`":
            in_code = not in_code
        elif not in_code and char == "(":
            depth += 1
        elif not in_code and char == ")" and depth:
            depth -= 1
        elif char == ";" and not in_code and not depth:
            items.append("".join(current))
            current = []
            continue
        current.append(char)
    items.append("".join(current))
    result = []
    for item in items:
        item = item.strip()
        if item.endswith(".") and not item.endswith(".."):
            item = item[:-1].rstrip()
        if item and item.casefold() not in _PLACEHOLDERS:
            result.append(item)
    return result


def from_markdown(text):
    found, fence = [], None
    for line in _COMMENT.sub("", text).splitlines():
        opening = _FENCE.match(line)
        if opening:
            marker = opening.group(1)
            if fence is None:
                fence = marker
            elif marker[0] == fence[0] and len(marker) >= len(fence):
                fence = None
            continue
        match = None if fence else _LINE.match(line)
        if match:
            found += split_items(match.group(2))
    return found


def suggestions(run_dir):
    """Follow-up items from the run's PR bodies, deduplicated and capped."""
    seen, result = set(), []
    for path in bodies(run_dir):
        try:
            with open(path, encoding="utf-8") as handle:
                text = handle.read()
        except (OSError, UnicodeDecodeError):
            continue
        for item in from_markdown(text):
            item = item[:MAX_CHARS].rstrip()
            if item.casefold() in seen:
                continue
            seen.add(item.casefold())
            result.append(item)
            if len(result) == LIMIT:
                return result
    return result
