"""Pictures and HTML mockups a question's answer shows, kept in ``media/``.

A question run holds its answer and nothing a build makes, but an answer may
still need a screenshot or a sketch. ``orc-publish-question --media`` is the
only writer: it checks each file, copies it flat into ``<run>/media/`` and
refuses an answer that names a ``media/`` file the run does not hold. A mockup
takes the ``fonts/*.woff2`` files it names from beside it, into
``media/fonts/``, so it keeps Orc's type when opened in the browser.
"""
from __future__ import annotations

import os
import re
import tempfile

MEDIA_DIR = "media"
NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\Z")
# Magic bytes per picture extension; a renamed file is refused.
PICTURES = {
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".gif": (b"GIF87a", b"GIF89a"),
    ".webp": (b"RIFF",),
}
MOCKUP = ".html"
MAX_PICTURE = 12 * 1024 * 1024
MAX_MOCKUP = 2 * 1024 * 1024
MAX_FONT = 1024 * 1024
MAX_FILES = 24
FONT_REF = re.compile(r"""url\(\s*["']?(?:\./)?fonts/([A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.woff2)["']?\s*\)""")
# Markdown images and links, and raw src/href attributes, that point into media/.
ANSWER_REF = re.compile(
    r"""(?:\]\(\s*<?|(?:src|href)\s*=\s*["'])(?:\./)?media/([^\s)"'>?#]+)""")


def _read_regular(path, limit, what):
    if os.path.islink(path) or not os.path.isfile(path):
        raise ValueError("%s must be a regular non-symlink file: %s" % (what, path))
    if os.path.getsize(path) > limit:
        raise ValueError("%s is larger than %d MiB: %s" % (what, limit // (1024 * 1024), path))
    with open(path, "rb") as handle:
        return handle.read()


def stage(paths):
    """Check each source and return {relative path under media/: bytes}."""
    paths = list(paths or ())
    if len(paths) > MAX_FILES:
        raise ValueError("pass at most %d media files at once" % MAX_FILES)
    staged = {}
    for raw in paths:
        source = os.path.abspath(os.path.expanduser(raw))
        name = os.path.basename(source)
        extension = os.path.splitext(name)[1].lower()
        if not NAME_RE.fullmatch(name):
            raise ValueError("media name must be letters, digits, '.', '_' or '-': %s" % name)
        if name in staged:
            raise ValueError("two media files share the name %s" % name)
        if extension in PICTURES:
            body = _read_regular(source, MAX_PICTURE, "picture")
            if not body.startswith(PICTURES[extension]) or (
                    extension == ".webp" and body[8:12] != b"WEBP"):
                raise ValueError("%s is not a %s picture" % (name, extension[1:].upper()))
            staged[name] = body
        elif extension == MOCKUP:
            body = _read_regular(source, MAX_MOCKUP, "mockup")
            try:
                text = body.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise ValueError("mockup is not UTF-8: %s" % name) from exc
            staged[name] = body
            for font in sorted(set(FONT_REF.findall(text))):
                font_path = os.path.join(os.path.dirname(source), "fonts", font)
                if os.path.exists(font_path):
                    staged["fonts/" + font] = _read_regular(font_path, MAX_FONT, "font")
        else:
            raise ValueError("media must be a PNG, JPEG, GIF or WebP picture or an HTML "
                             "mockup: %s" % name)
    return staged


def references(answer):
    """The media/ files an answer names, as paths under media/."""
    text = answer.decode("utf-8", "replace") if isinstance(answer, bytes) else answer
    return sorted(set(ANSWER_REF.findall(text)))


def held(run_dir):
    """Paths under media/ already in the run."""
    root = os.path.join(run_dir, MEDIA_DIR)
    found = set()
    for base, dirs, names in os.walk(root):
        dirs[:] = [name for name in dirs if not name.startswith(".")]
        for name in names:
            if not name.startswith("."):
                found.add(os.path.relpath(os.path.join(base, name), root).replace(os.sep, "/"))
    return found


def check_references(run_dir, answer, staged):
    missing = [path for path in references(answer)
               if path not in staged and path not in held(run_dir)]
    if missing:
        raise ValueError("the answer shows media the run does not hold: %s; pass each "
                         "with --media" % ", ".join("media/" + path for path in missing))


def write(run_dir, staged):
    """Copy staged files into media/, each through an atomic replace."""
    root = os.path.join(run_dir, MEDIA_DIR)
    if os.path.islink(root) or (os.path.exists(root) and not os.path.isdir(root)):
        raise ValueError("the run's media folder must be a real folder")
    written = []
    for relative, body in sorted(staged.items()):
        target = os.path.join(root, relative)
        folder = os.path.dirname(target)
        if os.path.islink(folder):
            raise ValueError("the run's media folder must be a real folder")
        os.makedirs(folder, exist_ok=True)
        if os.path.islink(target):
            os.unlink(target)
        handle, temporary = tempfile.mkstemp(dir=folder, prefix=".media-")
        try:
            with os.fdopen(handle, "wb") as out:
                out.write(body)
            os.chmod(temporary, 0o644)
            os.replace(temporary, target)
        except BaseException:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise
        written.append(MEDIA_DIR + "/" + relative)
    if written:
        # Orc reuses a settled run's row while its folder's mtime holds, and a
        # write inside media/ leaves that alone (serve.py settled_row_key).
        os.utime(run_dir)
    return written
