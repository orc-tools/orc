"""Move settled runs' bulky files to the Bin.

A run settled on the sidebar shelf for long enough, and finished for good,
keeps what Orc reads (plans, PR bodies, answers, decisions, Ship pages, chat
history) and sends everything else, the recordings, archives and oversized
text, to the user's Bin, where it stays recoverable. A screenshot is kept at
lower quality: a reduced JPEG takes its place under the same name, so links to
it still work, and the full-size original goes to the Bin. One that does not
shrink by a quarter (or cannot be reduced, as without macOS's sips) stays as
it is.

A Claude or Codex conversation lives outside the run, and Claude Code deletes
a transcript 30 days after its last use, so archiving keeps it in the run
folder as `.transcript-<id>.jsonl`, a hard link to the original, or as a
gzipped `.transcript-<id>.jsonl.gz` copy where a link cannot be made. Chat
reads it once the original is gone. With the conversation kept, or an external
harness's turns synced into a transcript file, every headless turn log but
the latest's duplicates it and goes to the Bin under `.headless/`. The latest
turn's output and stderr, or every finished turn's when the history could not
be kept, are gzipped in place.

The record, `.assets-archived.json`, names the Bin folders (`trashPaths`) and
counts what went there (`files`, `bytes`, turn logs included), the screenshots
reduced (`reduced`), the files that would not move (`failed`) and the bytes
gzip saved on turn logs (`turnLogBytesSaved`). `inProgress` marks an archive
cut off before its final write. Version 1 records predate turn logs and
conversations, so their runs are archived once more.

`ui.archiveSettledAssetsDays` in ~/.orc/config.json picks the age: missing
means DEFAULT_DAYS, `false` turns it off, a positive integer is the number of
days.

On WSL, screenshot reduction optionally uses Pillow.
"""

import errno
import gzip
import json
import mmap
import os
import re
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

import headless_session
import run_chat
import windows_host

DEFAULT_DAYS = 7
RECORD = ".assets-archived.json"
RECORD_VERSION = 2
KEEP_SUFFIXES = (".md", ".mdx", ".json", ".jsonl", ".txt", ".html", ".log", ".patch",
                 ".diff", ".yml", ".yaml", ".toml", ".csv")
KEEP_MAX_BYTES = 1024 * 1024
ARCHIVED_STATUSES = ("merged", "merged-to-parent", "cancelled", "failed")
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg")
REDUCED_SUFFIX = ".orc-reduced"
REDUCE_BELOW = 0.75
MAX_WIDTH = 1600


class BinUnavailable(OSError):
    pass


def threshold_days(config):
    """Days a run stays settled before its files move, or None when off."""
    ui = config.get("ui") if isinstance(config, dict) else None
    value = ui.get("archiveSettledAssetsDays", DEFAULT_DAYS) if isinstance(ui, dict) else DEFAULT_DAYS
    if value is False:
        return None
    if type(value) is int and value > 0:
        return value
    return DEFAULT_DAYS


def _settled_at(config, run_id):
    ui = config.get("ui") if isinstance(config, dict) else None
    settled = ui.get("settledRuns") if isinstance(ui, dict) else None
    at = settled.get(run_id) if isinstance(settled, dict) else None
    return at if type(at) in (int, float) else None


def eligible(run_id, meta, config, run_dir, now=None):
    days = threshold_days(config)
    at = _settled_at(config, run_id)
    if days is None or at is None:
        return False
    if (time.time() if now is None else now) * 1000 - at < days * 86400 * 1000:
        return False
    if not isinstance(meta, dict):
        return False
    status = meta.get("status")
    # A complete run with a PR can still deliver, and delivery rereads its
    # diff and shots; it qualifies once it is merged. An answered question or
    # a settled no-diff run never delivers.
    answered = (status == "complete" and meta.get("phase") == "done"
                and meta.get("outcome") == "question")
    no_diff_done = (status == "complete" and meta.get("phase") == "done"
                    and isinstance(meta.get("noDiffCompletion"), dict)
                    and meta["noDiffCompletion"].get("schemaVersion") == 1
                    and not meta.get("prUrl") and not meta.get("prUrls"))
    if status not in ARCHIVED_STATUSES and not answered and not no_diff_done:
        return False
    # Settled again since the last archive: it may have taken new turns.
    return at > _archived_at(run_dir)


def _read_record(run_dir):
    """The run's archive record, None when it has none. Raises ValueError
    for one that cannot be read."""
    try:
        with open(os.path.join(run_dir, RECORD)) as handle:
            record = json.load(handle)
    except FileNotFoundError:
        return None
    except OSError as error:
        raise ValueError("unreadable archive record") from error
    if not isinstance(record, dict):
        raise ValueError("unreadable archive record")
    return record


def _archived_at(run_dir):
    """When the run was last archived, in ms: -inf when never, when an
    archive was cut off mid-move, so the next sweep finishes it, or when an
    older version archived it, and +inf when its record cannot be read, so
    such a run is left as it is."""
    try:
        record = _read_record(run_dir)
        if (record is None or record.get("inProgress") is True
                or record.get("schemaVersion") == 1):
            return float("-inf")
        return datetime.fromisoformat(record["archivedAt"].replace("Z", "+00:00")).timestamp() * 1000
    except (ValueError, KeyError, TypeError, AttributeError):
        return float("inf")


def _active_since(run_dir, archived_at):
    """True when meta.json changed after `archived_at`, or either is unreadable."""
    try:
        started = datetime.fromisoformat(archived_at.replace("Z", "+00:00")).timestamp()
        return os.stat(os.path.join(run_dir, "meta.json")).st_mtime > started
    except (OSError, ValueError, TypeError, AttributeError):
        return True


def _keeps(rel, size):
    # meta.json makes it a run and diff.patch is its Diff tab, whatever their size.
    return rel in ("meta.json", "diff.patch") or (
        rel.lower().endswith(KEEP_SUFFIXES) and size <= KEEP_MAX_BYTES)


def _movable(run_dir):
    """(relative path, size) for every file that leaves the run."""
    found = []
    for root, dirs, files in os.walk(run_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in files:
            if name.startswith("."):
                continue
            full = os.path.join(root, name)
            try:
                size = os.lstat(full).st_size
            except OSError:
                continue
            rel = os.path.relpath(full, run_dir)
            if not _keeps(rel, size):
                found.append((rel, size))
    return sorted(found)


def _bin_folder(trash_dir, run_id):
    try:
        os.makedirs(trash_dir, exist_ok=True)
        base = os.path.join(trash_dir, "%s (Orc assets)" % run_id)
        candidate, n = base, 1
        while True:
            try:
                os.mkdir(candidate)
                return candidate
            except FileExistsError:
                n += 1
                candidate = "%s %d" % (base, n)
    except OSError as error:
        raise BinUnavailable(error.errno, "cannot write to the Bin at %s: %s" % (
            trash_dir, error.strerror or error)) from error


def _open_parent(run_fd, rel):
    """A descriptor for the directory holding `rel`, reached from the run's
    one directory at a time without following a link."""
    fd = os.dup(run_fd)
    for part in filter(None, os.path.dirname(rel).split(os.sep)):
        try:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
        finally:
            os.close(fd)
        fd = child
    return fd


def _move(dir_fd, name, target):
    """Move `name`, in the directory open at `dir_fd`, to `target` in the
    Bin, moving a link as a link."""
    os.makedirs(os.path.dirname(target), exist_ok=True)
    to = os.open(os.path.dirname(target), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    new = os.path.basename(target)
    try:
        try:
            os.rename(name, new, src_dir_fd=dir_fd, dst_dir_fd=to)
            return
        except OSError as error:
            if error.errno != errno.EXDEV:
                raise
        info = os.lstat(name, dir_fd=dir_fd)
        if stat.S_ISLNK(info.st_mode):
            os.symlink(os.readlink(name, dir_fd=dir_fd), new, dir_fd=to)
        else:
            with open(os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dir_fd), "rb") as reader, \
                    open(os.open(new, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                 0o600, dir_fd=to), "wb") as writer:
                shutil.copyfileobj(reader, writer)
                writer.flush()
                os.fchmod(writer.fileno(), stat.S_IMODE(info.st_mode))
                os.utime(writer.fileno(), ns=(info.st_atime_ns, info.st_mtime_ns))
        os.unlink(name, dir_fd=dir_fd)
    finally:
        os.close(to)


def _opaque(source, folder):
    """True when every pixel of `source` is fully opaque, read from the
    32-bit BMP sips writes into `folder`, which keeps the alpha channel."""
    bmp = os.path.join(folder, "alpha.bmp")
    try:
        subprocess.run(["sips", "-s", "format", "bmp", source, "--out", bmp],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30, check=True)
        with open(bmp, "rb") as handle, \
                mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as data:
            offset, header = struct.unpack_from("<II", data, 10)
            width, height, _planes, bpp, compression = struct.unpack_from("<iiHHI", data, 18)
            if (header < 108 or bpp != 32 or compression != 3 or width <= 0
                    or struct.unpack_from("<I", data, 66)[0] != 0xFF000000):
                return False
            count = width * abs(height)
            alphas = data[offset + 3:offset + count * 4:4]
            return alphas.count(255) == count
    except (OSError, ValueError, struct.error, subprocess.SubprocessError):
        return False


def reduce_image(source, target):
    """Write a smaller JPEG of the image `source` to `target`; False when it
    could not or when the image has transparent pixels. Scratch files go in
    `target`'s folder, which must be private to the caller."""
    if windows_host.WSL:
        try:
            from PIL import Image
        except ImportError:
            return False
        try:
            with Image.open(source) as image:
                if image.width * image.height > Image.MAX_IMAGE_PIXELS or getattr(image, "is_animated", False):
                    return False
                if image.convert("RGBA").getchannel("A").getextrema()[0] < 255:
                    return False
                image.thumbnail((MAX_WIDTH, image.height))
                image.convert("RGB").save(target, format="JPEG", quality=70)
            return True
        except (OSError, ValueError, Image.DecompressionBombError):
            return False
    try:
        info = subprocess.check_output(["sips", "-g", "pixelWidth", "-g", "hasAlpha", source],
                                       stderr=subprocess.DEVNULL, timeout=30, text=True)
        width = re.search(r"^\s+pixelWidth:\s*(\d+)\s*$", info, re.M)
        if not width:
            return False
        # JPEG has no alpha: sips flattens it onto white, blanking a light
        # logo on a transparent background. 23 of 59 sampled screenshots
        # report an alpha channel with nothing transparent in it, and those
        # still shrink.
        if (re.search(r"^\s+hasAlpha:\s*yes\s*$", info, re.M)
                and not _opaque(source, os.path.dirname(target))):
            return False
        # Capping the width, not the longest side, keeps a tall page capture
        # readable; a narrower image is only re-encoded, never enlarged.
        resize = ["--resampleWidth", str(MAX_WIDTH)] if int(width[1]) > MAX_WIDTH else []
        subprocess.run(["sips", *resize, "-s", "format", "jpeg", "-s", "formatOptions", "70",
                        source, "--out", target],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30, check=True)
    except (OSError, ValueError, subprocess.SubprocessError):
        return False
    return os.path.isfile(target)


def _same(first, second):
    return (first.st_dev, first.st_ino) == (second.st_dev, second.st_ino)


def _reduced_copy(dir_fd, name):
    """The name of a hidden reduced copy of `name`, beside it in the
    directory open at `dir_fd` and carrying its times, or None when it would
    not save enough or is not a regular file."""
    # Hidden, so the walks here and in run_inventory skip it.
    temporary = "." + name + REDUCED_SUFFIX
    try:
        source_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dir_fd)
    except OSError:
        return None
    fd = private = None
    created = kept = False
    try:
        # sips gets only a private copy read through this descriptor: it
        # writes into a directory named as its output, and anything in the
        # run can be swapped for a link while it works.
        with open(source_fd, "rb") as reader:
            original = os.fstat(reader.fileno())
            if not stat.S_ISREG(original.st_mode):
                return None
            try:
                planted = os.lstat(temporary, dir_fd=dir_fd)
            except FileNotFoundError:
                planted = None
            if planted and stat.S_ISDIR(planted.st_mode):
                return None
            if planted:
                os.unlink(temporary, dir_fd=dir_fd)
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600,
                         dir_fd=dir_fd)
            created = True
            private = tempfile.mkdtemp(prefix="orc-reduce-")
            source = os.path.join(private, "source" + os.path.splitext(name)[1].lower())
            with open(source, "xb") as copy:
                shutil.copyfileobj(reader, copy)
        output = os.path.join(private, "reduced.jpg")
        if not reduce_image(source, output):
            return None
        reduced = os.lstat(output)
        if not (stat.S_ISREG(reduced.st_mode)
                and 0 < reduced.st_size < original.st_size * REDUCE_BELOW):
            return None
        with open(os.open(output, os.O_RDONLY | os.O_NOFOLLOW), "rb") as result, \
                os.fdopen(fd, "wb") as writer:
            fd = None
            shutil.copyfileobj(result, writer)
            writer.flush()
            os.fchmod(writer.fileno(), stat.S_IMODE(original.st_mode))
            os.utime(writer.fileno(), ns=(original.st_atime_ns, original.st_mtime_ns))
            # Both names must still be the files read and written here.
            kept = (_same(os.fstat(writer.fileno()), os.lstat(temporary, dir_fd=dir_fd))
                    and _same(original, os.lstat(name, dir_fd=dir_fd)))
        return temporary if kept else None
    except OSError:
        return None
    finally:
        if fd is not None:
            os.close(fd)
        if private:
            shutil.rmtree(private, ignore_errors=True)
        if created and not kept:
            try:
                os.unlink(temporary, dir_fd=dir_fd)
            except OSError:
                pass


def _finish_reduced(run_fd):
    """Settle the reduced copies a cut-off sweep left: a regular file whose
    original already went to the Bin takes its place, any other is dropped."""
    for _root, dirs, files, root_fd in os.fwalk(".", dir_fd=run_fd):
        # os.fwalk lists a link to a directory among the directories.
        for name in dirs + files:
            if not (name.startswith(".") and name.endswith(REDUCED_SUFFIX)):
                continue
            try:
                entry = os.lstat(name, dir_fd=root_fd)
                try:
                    os.lstat(name[1:-len(REDUCED_SUFFIX)], dir_fd=root_fd)
                    original_left = True
                except FileNotFoundError:
                    original_left = False
                if original_left or not stat.S_ISREG(entry.st_mode):
                    os.unlink(name, dir_fd=root_fd)
                else:
                    os.replace(name, name[1:-len(REDUCED_SUFFIX)],
                               src_dir_fd=root_fd, dst_dir_fd=root_fd)
            except OSError:
                pass
        dirs[:] = [d for d in dirs if not d.startswith(".")]


def _write_record(run_dir, record):
    fd, temporary = tempfile.mkstemp(dir=run_dir, prefix=".assets-archived-")
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(record, handle)
        os.replace(temporary, os.path.join(run_dir, RECORD))
    except OSError:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _save_conversation(run_dir):
    """Keep the run's Claude or Codex conversation in the run folder and
    return whether it is kept there. A hard link costs no space and outlives
    Claude Code's cleanup, which only unlinks its own name; a gzipped copy
    stands in where a link cannot be made, such as across volumes. Raises
    OSError when the conversation exists but could not be kept, so the run
    stays eligible and the next sweep tries again."""
    try:
        with open(os.path.join(run_dir, "meta.json")) as handle:
            meta = json.load(handle)
    except (OSError, ValueError):
        return False
    found = run_chat.conversation_copy(meta, run_dir) if isinstance(meta, dict) else None
    if found is None:
        return False
    original, link, packed = found
    try:
        source = os.stat(original) if original is not None else None
    except FileNotFoundError:
        source = None
    if source is None:
        return run_chat.kept_conversation(link, packed) is not None
    try:
        current = os.lstat(link)
    except FileNotFoundError:
        current = None
    if current is not None and _same(current, source):
        _unlink(packed)
        return True
    try:
        _link(original, link)
    except OSError:
        _pack(original, packed, source)
        # An older version's link would be read before the fresh copy.
        _unlink(link)
        return True
    _unlink(packed)
    return True


def _unlink(path):
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def _link(original, link):
    """Point `link` at `original`'s inode, replacing it in one step."""
    temporary = os.path.join(os.path.dirname(link), ".transcript-link-%s" % os.urandom(6).hex())
    os.link(original, temporary)
    try:
        os.replace(temporary, link)
    except OSError:
        _unlink(temporary)
        raise


def _pack(original, packed, source):
    """Write a gzipped copy of `original` to `packed` unless the one there
    is already as new."""
    try:
        if os.lstat(packed).st_mtime_ns >= source.st_mtime_ns:
            return
    except FileNotFoundError:
        pass
    fd, temporary = tempfile.mkstemp(dir=os.path.dirname(packed), prefix=".transcript-")
    try:
        with open(original, "rb") as reader, os.fdopen(fd, "wb") as raw:
            copied = os.fstat(reader.fileno())
            with gzip.GzipFile(filename=os.path.basename(original), mode="wb",
                               fileobj=raw) as writer:
                shutil.copyfileobj(reader, writer)
            raw.flush()
            os.fsync(raw.fileno())
        os.utime(temporary, ns=(copied.st_atime_ns, copied.st_mtime_ns))
        os.replace(temporary, packed)
    except BaseException:
        _unlink(temporary)
        raise


def archive_run(run_dir, trash_dir, runs_dir, now=None):
    """Keep one run's conversation in it, move its movable files and
    redundant turn logs into a fresh folder in `trash_dir`, leaving reduced
    copies of its screenshots and its remaining turn logs gzipped, and record
    it, adding to the record of an earlier archive. Raises BinUnavailable
    when the Bin cannot take them, OSError when the conversation or a turn
    log could not be kept, moved or gzipped, and ValueError for anything but
    a real directory directly inside `runs_dir`."""
    run_dir = os.path.abspath(run_dir)
    if (os.path.islink(run_dir)
            or os.path.dirname(os.path.realpath(run_dir)) != os.path.realpath(runs_dir)):
        raise ValueError("%s is not a run directory inside %s" % (run_dir, runs_dir))
    # The run directory's mtime is the run's last activity in the sidebar.
    before = os.stat(run_dir)
    times = (before.st_atime_ns, before.st_mtime_ns)
    try:
        previous = _read_record(run_dir) or {}
    except ValueError:
        previous = {}
    # A cut-off archive's moves already bumped the dir, so its saved times are
    # the run's last activity, unless meta.json changed after that archive
    # began: archiving never writes it, so a newer one means the run was
    # worked on since.
    saved = previous.get("runDirTimesNs")
    if (previous.get("inProgress") is True and isinstance(saved, list) and len(saved) == 2
            and all(type(value) is int for value in saved)
            and not _active_since(run_dir, previous.get("archivedAt"))):
        times = tuple(saved)
    run_fd = os.open(run_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        _finish_reduced(run_fd)
        # First, so a failure leaves the record as it was and the run eligible.
        history_saved = _save_conversation(run_dir)
        movable = _movable(run_dir)
        folder = (_bin_folder(trash_dir, os.path.basename(run_dir))
                  if movable or headless_session.older_turn_logs(run_dir) else None)
        archived_at = datetime.fromtimestamp(time.time() if now is None else now, timezone.utc)
        trash_paths = [path for path in previous.get("trashPaths") or [previous.get("trashPath")]
                       if isinstance(path, str)] + ([folder] if folder else [])

        def record(moved=0, total=0, failed=0, reduced=0, packed=0, in_progress=False):
            written = {"schemaVersion": RECORD_VERSION,
                       "archivedAt": archived_at.isoformat().replace("+00:00", "Z"),
                       "trashPath": trash_paths[-1] if trash_paths else None,
                       "trashPaths": trash_paths,
                       "files": moved + _count(previous, "files"),
                       "bytes": total + _count(previous, "bytes"),
                       "reduced": reduced + _count(previous, "reduced")}
            if failed + _count(previous, "failed"):
                written["failed"] = failed + _count(previous, "failed")
            if packed + _count(previous, "turnLogBytesSaved"):
                written["turnLogBytesSaved"] = packed + _count(previous, "turnLogBytesSaved")
            if in_progress:
                written["inProgress"] = True
                written["runDirTimesNs"] = list(times)
            return written

        if folder:
            # Named before anything moves, so a failed final write (a full
            # disk), a turn log that cannot move or a killed daemon never
            # leaves files in the Bin that no record points to. The marker
            # makes the next sweep finish it.
            try:
                _write_record(run_dir, record(in_progress=True))
            except OSError:
                os.rmdir(folder)
                raise
            # Undo the record write's own bump, so a kill before the first move
            # leaves the run's last activity as it was.
            os.utime(run_dir, ns=times)
        moved = failed = total = reduced = 0
        emptied = set()
        for rel, size in movable:
            name = os.path.basename(rel)
            try:
                # Every step below goes through this descriptor, so a
                # directory swapped for a link never sends them outside.
                parent = _open_parent(run_fd, rel)
            except OSError:
                failed += 1
                continue
            try:
                smaller = None
                try:
                    entry = os.lstat(name, dir_fd=parent)
                except OSError:
                    failed += 1
                    continue
                if rel.lower().endswith(IMAGE_SUFFIXES) and stat.S_ISREG(entry.st_mode):
                    smaller = _reduced_copy(parent, name)
                    if smaller is None:
                        continue
                try:
                    _move(parent, name, os.path.join(folder, rel))
                except OSError:
                    failed += 1
                    if smaller:
                        os.unlink(smaller, dir_fd=parent)
                    continue
                moved += 1
                total += size
                if smaller:
                    os.replace(smaller, name, src_dir_fd=parent, dst_dir_fd=parent)
                    reduced += 1
                    continue
            finally:
                os.close(parent)
            directory = os.path.dirname(rel)
            while directory:
                emptied.add(directory)
                directory = os.path.dirname(directory)
        for rel in sorted(emptied, key=lambda path: path.count(os.sep), reverse=True):
            try:
                parent = _open_parent(run_fd, rel)
            except OSError:
                continue
            try:
                os.rmdir(os.path.basename(rel), dir_fd=parent)
            except OSError:
                pass
            finally:
                os.close(parent)

        def move_turn_log(name):
            nonlocal moved, total
            rel = os.path.join(headless_session.STATE_DIR, name)
            parent = _open_parent(run_fd, rel)
            try:
                size = os.lstat(name, dir_fd=parent).st_size
                _move(parent, name, os.path.join(folder, rel))
            finally:
                os.close(parent)
            moved += 1
            total += size

        packed = headless_session.archive_turn_logs(
            run_dir, move=move_turn_log if folder else None, history_saved=history_saved)
        if folder and not moved:
            # Every file it was made for stayed, such as screenshots reduced
            # by an earlier archive, or turn logs with no saved history.
            try:
                os.rmdir(folder)
                trash_paths.remove(folder)
            except OSError:
                pass
        final = record(moved, total, failed, reduced, packed)
        _write_record(run_dir, final)
        return final
    finally:
        os.close(run_fd)
        os.utime(run_dir, ns=times)


def _count(record, key):
    value = record.get(key)
    return value if type(value) is int else 0


def sweep(runs_dir, trash_dir, read_config, read_meta, now=None):
    """Archive every eligible run under `runs_dir`; the ids archived.

    Only runs settled when the sweep starts have their meta read. Config and
    meta are read right before each run moves, so a run un-settled or
    reopened mid-sweep is left alone, and a run that fails in any way is
    skipped without stopping the sweep."""
    try:
        names = sorted(name for name in os.listdir(runs_dir) if not name.startswith("."))
    except OSError:
        return []
    config = read_config()
    if threshold_days(config) is None:
        return []
    archived = []
    for name in names:
        run_dir = os.path.join(runs_dir, name)
        if (_settled_at(config, name) is None or os.path.islink(run_dir)
                or not os.path.isdir(run_dir)):
            continue
        try:
            if not eligible(name, read_meta(name), read_config(), run_dir, now):
                continue
            archive_run(run_dir, trash_dir, runs_dir, now)
        except BinUnavailable as error:
            print("orc-ui: settled-run archive stopped: %s" % error.strerror, file=sys.stderr)
            break
        except Exception:  # one bad run must not stop the rest
            continue
        archived.append(name)
    return archived
