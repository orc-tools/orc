"""Image and video attachments: the types Orc accepts, and the staged images a
composer paste leaves under ``~/.orc/attachments`` for a message to reference.

A message carries each image as a ``[Image attachment: <path>]`` line. The
path only means something on the machine that took the upload, so anything
that hands the message to an agent running elsewhere checks the file here
first and delivers the bytes itself.

A video travels as a ``[Video attachment: <path>]`` line and is never
delivered elsewhere: no agent takes video bytes, so the one reading the
message samples frames from the file at that path.
"""
from __future__ import annotations

import os
import re
import stat

MAX_BYTES = 10 * 1024 * 1024
TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/avif": "avif",
}
MAX_VIDEO_BYTES = 200 * 1024 * 1024
VIDEO_TYPES = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
}
# ISO BMFF major brands that hold video. Audio-only (M4A) and still-image
# (HEIC) files share the container and stay out.
MP4_BRANDS = (b"isom", b"iso2", b"iso4", b"iso5", b"iso6", b"mp41", b"mp42",
              b"avc1", b"M4V ", b"M4VH", b"M4VP", b"mmp4", b"dash")
LINE = re.compile(r"^\[Image attachment: (/[^\]\r\n]+)\][ \t]*$", re.M)


def image_type(body):
    """Return a browser-safe image MIME from its signature, never its name."""
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if body.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(body) >= 12 and body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        return "image/webp"
    if body.startswith(b"BM"):
        return "image/bmp"
    # ISO BMFF: the major or a compatible brand identifies AVIF.
    if len(body) >= 16 and body[4:8] == b"ftyp" and any(
            body[i:i + 4] in (b"avif", b"avis")
            for i in range(8, min(len(body) - 3, 32), 4)):
        return "image/avif"
    return None


def video_type(head):
    """Return the video container MIME from its signature, never its name."""
    if len(head) >= 12 and head[4:8] == b"ftyp":
        if head[8:12] == b"qt  ":
            return "video/quicktime"
        if head[8:12] in MP4_BRANDS:
            return "video/mp4"
    # Matroska shares the EBML magic; only its WebM doctype plays in a browser.
    if head.startswith(b"\x1a\x45\xdf\xa3") and b"webm" in head[:64]:
        return "video/webm"
    return None


def jail(config_dir):
    return os.path.realpath(os.path.join(config_dir, "attachments"))


def check(config_dir, path):
    """Why the staged image at ``path`` cannot be delivered, or None when it
    is a regular image file inside this machine's attachment jail."""
    base = jail(config_dir)
    if os.path.dirname(path) != base or os.path.realpath(path) != path:
        return "not one of Orc's attachments on this machine"
    try:
        info = os.lstat(path)
    except OSError:
        return "not on this machine"
    if not stat.S_ISREG(info.st_mode):
        return "not on this machine"
    if info.st_size > MAX_BYTES:
        return "larger than 10 MB"
    try:
        with open(path, "rb") as handle:
            head = handle.read(64)
    except OSError:
        return "unreadable"
    return None if image_type(head) else "not a supported image"
