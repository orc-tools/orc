"""Sound files people add in Settings → Sounds, to play for a run event.

Each one is a copy kept in ~/.orc/sounds/, so the file it came from can move
or be deleted. Its event-sound id is ``custom:<file name>``.
"""

import contextlib
import os
import re
import tempfile

MAX_BYTES = 5 * 1024 * 1024
ID_PREFIX = "custom:"
NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,47}\.(mp3|wav|m4a|ogg|flac|aiff)")
CONTENT_TYPES = {
    "mp3": "audio/mpeg", "wav": "audio/wav", "m4a": "audio/mp4",
    "ogg": "audio/ogg", "flac": "audio/flac", "aiff": "audio/aiff",
}


class SoundError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def audio_type(head):
    """The extension for a file starting with ``head``, or None when the bytes
    are not a sound a browser plays. The bytes decide, not the file's name."""
    if head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0
                                   and head[1] & 0x06):
        # 0xFFF0/0xFFF1 with layer bits 00 is AAC in ADTS, not MP3.
        return "mp3"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:4] == b"OggS":
        return "ogg"
    if head[:4] == b"fLaC":
        return "flac"
    if head[:4] == b"FORM" and head[8:12] in (b"AIFF", b"AIFC"):
        return "aiff"
    if head[4:8] == b"ftyp" and head[8:12] in (b"M4A ", b"M4B ", b"mp41", b"mp42", b"isom", b"iso2"):
        return "m4a"
    return None


def folder(config_dir, create=False):
    base = os.path.join(config_dir, "sounds")
    if create:
        os.makedirs(base, mode=0o700, exist_ok=True)
    return base


def path_for(config_dir, name):
    """The stored file ``name``, or None when it is not one this module wrote."""
    if not isinstance(name, str) or not NAME_RE.fullmatch(name):
        return None
    full = os.path.join(folder(config_dir), name)
    return full if os.path.isfile(full) and not os.path.islink(full) else None


def label_for(name):
    stem = os.path.splitext(name)[0]
    return re.sub(r"[-_]+", " ", stem).strip() or stem


def entry(name):
    return {"id": ID_PREFIX + name, "label": label_for(name), "url": "/api/sounds/" + name}


def listing(config_dir):
    try:
        names = os.listdir(folder(config_dir))
    except OSError:
        return []
    return [entry(name) for name in sorted(names, key=str.lower)
            if path_for(config_dir, name)]


def _stem(original):
    # Not splitext(), which reads ".mp3" as a name with no extension.
    stem = re.sub(r"\.[^.]*$", "", os.path.basename(original or ""))
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", stem).strip("-_")[:40]
    return stem or "sound"


def save(config_dir, read, length, original):
    """Copy ``length`` bytes from ``read(n)`` into the folder and return the
    new entry. Raises SoundError with the HTTP status to answer."""
    if length <= 0:
        raise SoundError(400, "empty sound")
    if length > MAX_BYTES:
        raise SoundError(413, "a sound can be at most %d MB" % (MAX_BYTES // (1024 * 1024)))
    head = read(min(length, 64))
    extension = audio_type(head)
    if extension is None:
        raise SoundError(415, "that file is not an MP3, WAV, M4A, OGG, FLAC or AIFF sound")
    base = folder(config_dir, create=True)
    stem = _stem(original)
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix=".upload-", dir=base)
        written = 0
        with os.fdopen(fd, "wb") as handle:
            chunk = head
            while chunk:
                handle.write(chunk)
                written += len(chunk)
                chunk = read(min(1024 * 1024, length - written)) if written < length else b""
        if written != length:
            raise SoundError(400, "the sound upload was cut off")
        os.chmod(temporary, 0o600)
        for attempt in range(1, 1000):
            name = "%s.%s" % (stem if attempt == 1 else "%s-%d" % (stem, attempt), extension)
            destination = os.path.join(base, name)
            # link() refuses to replace, so two uploads of one name both stay.
            try:
                os.link(temporary, destination)
                break
            except FileExistsError:
                continue
        else:
            raise SoundError(409, "too many sounds share that name")
    except OSError:
        raise SoundError(500, "could not save the sound")
    finally:
        if temporary:
            with contextlib.suppress(OSError):
                os.unlink(temporary)
    return entry(name)


def remove(config_dir, name):
    full = path_for(config_dir, name)
    if full is None:
        raise SoundError(404, "no such sound")
    try:
        os.unlink(full)
    except OSError:
        raise SoundError(500, "could not remove the sound")
