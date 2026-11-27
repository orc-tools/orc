"""Staged and run attachment storage and HTTP routes."""
import contextlib
import hashlib
import json
import os
import re
import tempfile
import time
from urllib.parse import quote

import operations
import staged_images


def attachment_dir(run_dir, create=False):
    """Resolve the run-local attachment jail, rejecting a symlink escape."""
    run_dir = os.path.realpath(run_dir)
    expected = os.path.join(run_dir, "attachments")
    if create:
        os.makedirs(expected, mode=0o700, exist_ok=True)
    resolved = os.path.realpath(expected)
    if resolved != expected or not resolved.startswith(run_dir + os.sep):
        return None
    return resolved


class Service:
    def __init__(self, *, config_dir, runs, run_directory, mutation_lock, merged, answered):
        self.config_dir = config_dir
        self.runs = runs
        self.run_directory = run_directory
        self.mutation_lock = mutation_lock
        self.merged = merged
        self.answered = answered

    def staged_attachment_path(self, name=None, create=False):
        """The runless attachment jail (~/.orc/attachments) used by the New
        conversation composer, which has no run to hang uploads off yet — or one
        file inside it, None when the name would escape."""
        base = os.path.join(self.config_dir(), "attachments")
        if create:
            os.makedirs(base, mode=0o700, exist_ok=True)
        base = os.path.realpath(base)
        if name is None:
            return base
        if not name or name != os.path.basename(name) or name.startswith("."):
            return None
        full = os.path.join(base, name)
        return full if os.path.realpath(full) == full else None

    def store_staged_images(self, references, target, maximum):
        """Copy composer uploads from the staged jail into the folder `target()`
        makes. Returns `(names, error)`; nothing is copied unless all are good.

        A copy rather than a move: the composer deletes its staged file when its
        thumbnail is removed, and that must not take the stored image with it.
        """
        if not isinstance(references, list) or len(references) > maximum \
                or not all(isinstance(item, str) for item in references):
            return None, "images must be a list of at most %d attached images" % maximum
        staged = self.staged_attachment_path()
        bodies = []
        for reference in dict.fromkeys(references):
            source = os.path.realpath(reference)
            if os.path.dirname(source) != staged \
                    or self.staged_attachment_path(os.path.basename(source)) != source \
                    or not os.path.isfile(source):
                return None, "image is not an attached image: " + os.path.basename(reference)
            try:
                if os.path.getsize(source) > staged_images.MAX_BYTES:
                    return None, "image exceeds 10 MB limit"
                with open(source, "rb") as handle:
                    body = handle.read()
            except OSError:
                return None, "image could not be read: " + os.path.basename(reference)
            if staged_images.image_type(body) is None:
                return None, "image is not a supported image: " + os.path.basename(reference)
            bodies.append((os.path.basename(source), body))
        names = []
        for name, body in bodies:
            try:
                target_dir = target()
                if target_dir is None:
                    return None, "image could not be saved"
                if os.path.exists(os.path.join(target_dir, name)):
                    stem, extension = os.path.splitext(name)
                    name = "%s-%x%s" % (stem, time.time_ns(), extension)
                fd, temporary = tempfile.mkstemp(prefix=".image-", dir=target_dir)
                with os.fdopen(fd, "wb") as handle:
                    handle.write(body)
                os.chmod(temporary, 0o600)
                os.replace(temporary, os.path.join(target_dir, name))
            except OSError:
                with contextlib.suppress(OSError, UnboundLocalError):
                    os.unlink(temporary)
                return None, "image could not be saved"
            names.append(name)
        return names, None

    def save_attachment(self, handler, resolve_dir, url_prefix):
        declared = handler.headers.get("Content-Type", "").split(";", 1)[0].lower().strip()
        declared = {"image/jpg": "image/jpeg", "image/x-png": "image/png",
                    "video/x-m4v": "video/mp4"}.get(declared, declared)
        video = declared in staged_images.VIDEO_TYPES
        noun = "video" if video else "image"
        limit = staged_images.MAX_VIDEO_BYTES if video else staged_images.MAX_BYTES
        try:
            length = int(handler.headers.get("Content-Length") or 0)
        except ValueError:
            return handler.json_error(400, "invalid %s size" % noun)
        if length <= 0:
            return handler.json_error(400, "empty %s" % noun)
        if length > limit:
            return handler.json_error(413, "%s exceeds %d MB limit" % (noun, limit // (1024 * 1024)))
        if not video and declared not in staged_images.TYPES:
            return handler.json_error(415, "unsupported attachment type")
        head = handler.rfile.read(min(length, 64))
        if video:
            # A browser names the container from the file's extension, so a
            # .mov holding MP4 arrives as QuickTime. The signature decides.
            detected = staged_images.video_type(head)
            if detected is None:
                return handler.json_error(415, "content is not a supported video")
        else:
            detected = staged_images.image_type(head)
            if detected != declared:
                return handler.json_error(415, "content is not a valid %s image" % declared)
        target_dir = resolve_dir()
        if target_dir is None:
            return handler.json_error(400, "unsafe attachment directory")
        original = handler.headers.get("X-Orc-Filename", noun)
        stem = os.path.splitext(original)[0]
        stem = re.sub(r"[^A-Za-z0-9_-]+", "-", stem).strip("-_")[:48] or noun
        extension = (staged_images.VIDEO_TYPES if video else staged_images.TYPES)[detected]
        temporary = None
        try:
            fd, temporary = tempfile.mkstemp(prefix=".upload-", dir=target_dir)
            digest, written = hashlib.sha256(), 0
            with os.fdopen(fd, "wb") as handle:
                chunk = head
                while chunk:
                    handle.write(chunk)
                    digest.update(chunk)
                    written += len(chunk)
                    chunk = handler.rfile.read(min(1024 * 1024, length - written))
            if written != length:
                os.unlink(temporary)
                return handler.json_error(400, "%s upload was cut off" % noun)
            filename = "%s-%x-%s.%s" % (
                stem, time.time_ns(), digest.hexdigest()[:10], extension)
            destination = os.path.join(target_dir, filename)
            os.chmod(temporary, 0o600)
            os.replace(temporary, destination)
        except OSError:
            if temporary:
                with contextlib.suppress(OSError):
                    os.unlink(temporary)
            return handler.json_error(500, "could not save %s" % noun)
        url = url_prefix + quote(filename)
        handler.send_body(json.dumps({
            "reference": destination,
            "url": url,
            "name": filename,
            "type": detected,
            "size": written,
        }).encode(), "application/json")

    def post_attachment(self, handler, run_id, run_dir):
        return self.save_attachment(handler, lambda: attachment_dir(run_dir, create=True),
                                    "/runs/%s/attachments/" % quote(run_id))

    # New conversation composer: no run exists yet, so uploads stage under
    # ~/.orc/attachments and travel to the agent as a path reference.
    def post_staged_attachment(self, handler):
        return self.save_attachment(handler, lambda: self.staged_attachment_path(create=True),
                                    "/api/attachments/")

    def resolve_run_file(self, run_id, filename):
        run_dir = self.run_directory(run_id)
        directory = attachment_dir(str(run_dir))
        if directory is None or filename.startswith("."):
            return None, (400, "Invalid attachment path.")
        target = os.path.realpath(os.path.join(directory, filename))
        if os.path.dirname(target) != directory:
            return None, (400, "Invalid attachment path.")
        if not os.path.isfile(target):
            return None, (404, "Image file not found on disk.")
        return target, None

    def get_staged(self, handler, path):
        full = self.staged_attachment_path(path[len("/api/attachments/"):])
        if not full or not os.path.isfile(full):
            return handler.send_error(404)
        return handler.send_file(full)

    def post(self, handler, path):
        if path != "/api/attachments":
            return False
        self.post_staged_attachment(handler)
        return True

    def delete(self, handler, path):
        if path.startswith("/api/attachments/"):
            self.delete_staged(handler, path)
        else:
            parts = path.lstrip("/").split("/")
            if len(parts) != 4 or parts[0] != "runs" or parts[2] != "attachments":
                return False
            self.delete_run(handler, parts[1], parts[3])
        return True

    def get(self, handler, path):
        attachment = re.fullmatch(r"/runs/([^/]+)/attachments/([^/]+)", path)
        if not attachment:
            return False
        try:
            target, error = self.resolve_run_file(*attachment.groups())
        except operations.OperationError as exc:
            handler.json_error(exc.status, str(exc), False)
            return True
        if error:
            handler.send_error(error[0])
        else:
            handler.send_file(target)
        return True

    def delete_staged(self, handler, path):
        full = self.staged_attachment_path(path[len("/api/attachments/"):])
        if not full:
            return handler.send_error(400)
        if not os.path.lexists(full):
            return handler.send_error(404)
        try:
            os.unlink(full)
        except OSError:
            return handler.json_error(500, "could not remove image")
        return handler.send_body(b"{}", "application/json")

    def delete_run(self, handler, run_id, filename):
        run_dir = os.path.realpath(os.path.join(self.runs(), run_id))
        if (run_id.startswith(".") or os.sep in run_id or not filename
                or filename != os.path.basename(filename)
                or not run_dir.startswith(os.path.realpath(self.runs()) + os.sep)
                or not os.path.isdir(run_dir)):
            return handler.send_error(400)
        target_dir = attachment_dir(run_dir)
        if target_dir is None:
            return handler.send_error(404)
        target = os.path.join(target_dir, filename)
        with self.mutation_lock(run_id):
            if self.merged(run_id):
                return handler.json_error(
                    409, "run is read-only after merge to parent", False)
            if self.answered(run_id):
                return handler.json_error(
                    409, "answered question runs are read-only", False)
            if not os.path.lexists(target):
                return handler.send_error(404)
            try:
                os.unlink(target)
            except OSError:
                return handler.json_error(500, "could not remove image")
        return handler.send_body(b"{}", "application/json")
