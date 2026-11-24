"""Markdown image references shared by PR preview checks and delivery."""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit


# Milkdown Crepe renders raw HTML literally in the PR preview and `gh pr create --attach` only rewrites ![alt](path).
RAW_HTML_SCREENSHOT_TAG = re.compile(
    r"<(?:/\s*)?(img|table)(?=[\s/>])(?:=\s*\"[^\"]*\"|=\s*'[^']*'|[^>])*>",
    re.IGNORECASE,
)
MARKDOWN_IMAGE = re.compile(
    r'''!\[(?:\\.|[^\]\\])*\]\(\s*(?:<([^>\n]+)>|((?:\\.|[^()\s]|\([^()]*\))+))(?:\s+["'][^\n]*?["'])?\s*\)'''
)
MARKDOWN_ANGLE_DEST = re.compile(r"(\]\(\s*)<[^>\n]+>")
FENCE_OPEN = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")
BLANK_LINE = re.compile(r"\r?\n[ \t]*\r?\n")


class ImageSources(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []

    def handle_starttag(self, tag, attrs):
        if tag == "img":
            self.sources.extend(value for key, value in attrs
                                if key == "src" and value)


def strip_fenced_code(text: str) -> str:
    kept: list[str] = []
    fence: tuple[str, int] | None = None
    for line in text.splitlines(keepends=True):
        body = line.rstrip("\r\n")
        ending = line[len(body):]
        if fence is None:
            match = FENCE_OPEN.match(body)
            # CommonMark backtick fences forbid backticks in the info string; ```x``` on one line is inline code.
            if match and ("`" not in match.group(2) or match.group(1)[0] == "~"):
                fence = (match.group(1)[0], len(match.group(1)))
                kept.append(ending)
                continue
            kept.append(line)
        else:
            char, length = fence
            if re.match(rf"^\s*{char}{{{length},}}\s*$", body):
                fence = None
            kept.append(ending)
    return "".join(kept)


def strip_code_and_comments(text: str, comments: list[str] | None = None) -> str:
    """Blank out code and HTML comments, collecting the comments when asked."""
    stripped = strip_fenced_code(text)
    out: list[str] = []
    index = 0
    length = len(stripped)
    while index < length:
        if stripped.startswith("<!--", index):
            end = stripped.find("-->", index + 4)
            if end != -1:
                if comments is not None:
                    comments.append(stripped[index:end + 3])
                out.append("\n" * stripped[index:end + 3].count("\n"))
                index = end + 3
                continue
        if stripped[index] == "`":
            ticks = index
            while ticks < length and stripped[ticks] == "`":
                ticks += 1
            run_len = ticks - index
            blank = BLANK_LINE.search(stripped, ticks)
            limit = blank.start() if blank else length
            probe = ticks
            closed = -1
            while probe < limit:
                if stripped[probe] == "`":
                    end_ticks = probe
                    while end_ticks < limit and stripped[end_ticks] == "`":
                        end_ticks += 1
                    if end_ticks - probe == run_len:
                        closed = end_ticks
                        break
                    probe = end_ticks
                else:
                    probe += 1
            if closed != -1:
                out.append("\n" * stripped[index:closed].count("\n"))
                index = closed
                continue
            out.append(stripped[index:ticks])
            index = ticks
            continue
        out.append(stripped[index])
        index += 1
    return "".join(out)


def image_sources(text: str, *, allow_html: bool = False) -> list[str]:
    stripped = strip_code_and_comments(text)
    sources: list[str] = []
    if allow_html:
        html_text = MARKDOWN_ANGLE_DEST.sub(r"\1()", stripped)
        parser = ImageSources()
        for match in RAW_HTML_SCREENSHOT_TAG.finditer(html_text):
            if match.group(1).lower() == "img":
                parser.feed(match.group(0))
        parser.close()
        sources.extend(parser.sources)
    sources.extend(
        match.group(1) or match.group(2)
        for match in MARKDOWN_IMAGE.finditer(stripped)
    )
    return sources


def local_image_path(source: str, artifact: Path) -> Path | None:
    source = re.sub(r"\\([() ])", r"\1", source)
    parsed = urlsplit(source)
    if parsed.scheme or parsed.netloc:
        return None
    return artifact.parent / unquote(parsed.path)


def image_identity(source: str, artifact: Path) -> str:
    path = local_image_path(source, artifact)
    return str(path.resolve()) if path else source


def local_paths(text: str, artifact: Path) -> list[Path]:
    paths = (local_image_path(source, artifact) for source in image_sources(text))
    return list(dict.fromkeys(path for path in paths if path is not None))
