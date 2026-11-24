"""Deliver and durably record one Orc artifact-feedback batch."""

import argparse
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile

import run_relationships

STATUSES = {"answered", "applied", "declined", "needs-input",
            "stale-anchor", "failed"}
MAX_FILE = 2 * 1024 * 1024
BATCH_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,199}")
HELPER = Path(__file__).resolve()
WORKFLOW = HELPER.parents[1] / "skills" / "_shared" / "artifact-feedback.md"


def delivery_text(run_id, batch_id, runs_dir):
    command = "ORC_RUNS_DIR=%s %s" % (
        shlex.quote(str(runs_dir)), shlex.join(("python3", str(HELPER))))
    return (
        "Process Orc artifact feedback for run `%s`, batch `%s`. "
        "Adopt this existing run and its immutable batch. Read `%s` "
        "and follow its processing workflow. Start with `%s inspect %s %s` "
        "and use the same helper for claim, record, and complete. "
        "Feedback grants no gate approval or delivery consent."
        % (run_id, batch_id, WORKFLOW, command, run_id, batch_id)
    )


class FeedbackError(Exception):
    pass


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def runs_dir():
    override = os.environ.get("ORC_RUNS_DIR")
    return Path(override).resolve() if override else \
        Path(os.path.expanduser("~/.orc/runs")).resolve()


def safe_id(value, label):
    if not isinstance(value, str) or not BATCH_ID.fullmatch(value):
        raise FeedbackError("invalid %s" % label)
    return value


def safe_relative(value):
    return isinstance(value, str) and 0 < len(value) <= 500 \
        and not value.startswith(("/", "\\")) \
        and ".." not in value.replace("\\", "/").split("/")


def paths(run_id, batch_id):
    safe_id(run_id, "run id")
    safe_id(batch_id, "batch id")
    run = (runs_dir() / run_id).resolve()
    if run.parent != runs_dir() or not run.is_dir():
        raise FeedbackError("run not found")
    root = run / "artifact-feedback"
    return run, root, root / "batches" / (batch_id + ".json"), \
        root / "state" / (batch_id + ".json"), \
        root / "manifests" / (batch_id + ".json")


def read_json(path):
    try:
        if path.stat().st_size > MAX_FILE:
            raise FeedbackError("feedback file is too large")
        value = json.loads(path.read_text())
    except FileNotFoundError:
        raise FeedbackError("feedback record not found")
    except (OSError, ValueError) as exc:
        raise FeedbackError("invalid feedback record: %s" % exc)
    if not isinstance(value, dict):
        raise FeedbackError("invalid feedback record")
    return value


def atomic_json(path, value, immutable=False):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    encoded = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()
    if immutable and path.exists():
        if path.read_bytes() != encoded:
            raise FeedbackError("immutable feedback record already differs")
        return
    fd, temporary = tempfile.mkstemp(dir=str(path.parent), prefix=".feedback-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    except OSError:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


@contextlib.contextmanager
def mutation_lock(run):
    meta = read_json(run / "meta.json")
    repo = meta.get("mainRepoPath")
    identity = os.path.realpath(os.path.expanduser(repo)) \
        if isinstance(repo, str) and repo.strip() else "unknown"
    digest = hashlib.sha256(identity.encode()).hexdigest()[:16]
    lock = runs_dir() / (".merge-parent-%s.lock" % digest)
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("a+") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def load_batch(run_id, batch_id):
    run, root, batch_path, state_path, manifest_path = paths(run_id, batch_id)
    if run_relationships.retired_lifecycle(read_json(run / "meta.json")):
        raise FeedbackError("pre-v3 run history is read-only")
    batch, state = read_json(batch_path), read_json(state_path)
    if batch.get("id") != batch_id or batch.get("runId") != run_id \
            or state.get("batchId") != batch_id:
        raise FeedbackError("feedback batch identity mismatch")
    return run, root, batch, state, state_path, manifest_path


def image_files(run, images):
    """The absolute paths of a note's images, which the server keeps in the
    run's attachments folder as `attachments/<name>`."""
    folder = run / "attachments"
    return [str(folder / image.split("/", 1)[1]) for image in images or []
            if isinstance(image, str) and image.startswith("attachments/")
            and safe_relative(image) and image.count("/") == 1]


def inspect(args):
    run, _root, batch, state, _state_path, manifest_path = load_batch(
        args.run_id, args.batch_id)
    # A note's images, as paths the agent opens to look at each one.
    images = {item["id"]: image_files(run, item.get("images"))
              for item in batch.get("items", []) if isinstance(item, dict)
              and item.get("images") and isinstance(item.get("id"), str)}
    output = {"batch": batch, "state": state}
    if images:
        output["imageFiles"] = images
    if manifest_path.exists():
        output["manifest"] = read_json(manifest_path)
    print(json.dumps(output, indent=2, sort_keys=True))


def claim(args):
    run, _root, _batch, _state, _state_path, _manifest = load_batch(
        args.run_id, args.batch_id)
    with mutation_lock(run):
        _run, _root, _batch, state, state_path, _manifest = load_batch(
            args.run_id, args.batch_id)
        if state.get("status") in ("complete", "failed", "processing"):
            print(json.dumps(state, indent=2, sort_keys=True))
            return
        if state.get("status") not in ("created", "delivered"):
            raise FeedbackError("batch cannot be claimed from %s" % state.get("status"))
        state.update({"status": "processing", "claimedAt": now(),
                      "claimedBy": "pid:%s" % os.getpid(), "updatedAt": now()})
        state.pop("queued", None)
        atomic_json(state_path, state)
        print(json.dumps(state, indent=2, sort_keys=True))


def validate_result_ref(ref, run):
    artifact_key, relative = ref.get("artifactKey"), ref.get("path")
    if (not isinstance(artifact_key, str) or not artifact_key
            or len(artifact_key) > 200 or not safe_relative(relative)):
        raise FeedbackError("invalid response resultRef")
    meta = read_json(run / "meta.json")
    roots = [run]
    for key in ("repoPath", "mainRepoPath"):
        value = meta.get(key)
        if isinstance(value, str) and value.strip():
            roots.append(Path(os.path.expanduser(value)).resolve())
    resolved = None
    for root in roots:
        candidate = (root / relative).resolve()
        if (candidate == root or root in candidate.parents) and candidate.is_file():
            resolved = candidate
            break
    if resolved is None:
        raise FeedbackError("response resultRef path does not exist")
    digest = ref.get("digest")
    if digest is not None:
        expected = str(digest).removeprefix("sha256:").lower()
        if not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise FeedbackError("invalid response resultRef digest")
        actual = hashlib.sha256(resolved.read_bytes()).hexdigest()
        if actual != expected:
            raise FeedbackError("response resultRef digest mismatch")
    commit = ref.get("commit")
    if commit is not None:
        if not re.fullmatch(r"[0-9a-fA-F]{7,64}", str(commit)):
            raise FeedbackError("invalid response resultRef commit")
        repos = [root for root in roots[1:] if (root / ".git").exists()]
        if not any(subprocess.run(
                ["git", "-C", str(repo), "cat-file", "-e", "%s^{commit}" % commit],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
                for repo in repos):
            raise FeedbackError("response resultRef commit does not exist")


def validate_response(value, item_id, run):
    if not isinstance(value, dict) or value.get("status") not in STATUSES:
        raise FeedbackError("response status must be one of: %s" % ", ".join(sorted(STATUSES)))
    if value.get("itemId") not in (None, item_id):
        raise FeedbackError("response item id mismatch")
    reply, action, refs = value.get("reply"), value.get("action"), value.get("resultRefs", [])
    if not isinstance(reply, str) or not reply.strip() or len(reply.encode()) > 65536:
        raise FeedbackError("response reply is required")
    if action is not None and (not isinstance(action, str) or len(action.encode()) > 65536):
        raise FeedbackError("invalid response action")
    if not isinstance(refs, list) or len(refs) > 100 or any(not isinstance(r, dict) for r in refs):
        raise FeedbackError("invalid response resultRefs")
    normalized_refs = []
    for ref in refs:
        validate_result_ref(ref, run)
        anchor = ref.get("anchor")
        if anchor is not None and (not isinstance(anchor, dict)
                                   or not isinstance(anchor.get("quote", ""), str)
                                   or len(anchor.get("quote", "").encode()) > 16384):
            raise FeedbackError("invalid response resultRef anchor")
        normalized_refs.append({key: ref[key] for key in
                                ("artifactKey", "path", "digest", "version", "anchor", "commit", "label")
                                if key in ref})
    return {"status": value["status"], "reply": reply.strip(),
            "action": action.strip() if isinstance(action, str) else None,
            "resultRefs": normalized_refs}


def record(args):
    response_path = Path(args.response_json)
    response = read_json(response_path)
    run, _root, _batch, _state, _state_path, _manifest = load_batch(
        args.run_id, args.batch_id)
    with mutation_lock(run):
        _run, root, batch, state, _state_path, _manifest = load_batch(
            args.run_id, args.batch_id)
        if state.get("status") not in ("processing", "complete"):
            raise FeedbackError("claim batch before recording responses")
        item = next((i for i in batch.get("items", []) if i.get("id") == args.item_id), None)
        if item is None:
            raise FeedbackError("item not found in batch")
        value = validate_response(response, args.item_id, run)
        event = {"schemaVersion": 1, "id": "response-%s" % args.item_id,
                 "kind": "reply", "actor": "agent", "createdAt": now(),
                 "runId": args.run_id, "batchId": args.batch_id,
                 "draftId": args.item_id, "threadId": item.get("threadId"),
                 "replyTo": item.get("id"), **value}
        event_path = root / "events" / (event["id"] + ".json")
        if event_path.exists():
            existing = read_json(event_path)
            comparable = ("status", "reply", "action", "resultRefs")
            if any(existing.get(k) != event.get(k) for k in comparable):
                raise FeedbackError("item already has a different response")
            print(json.dumps(existing, indent=2, sort_keys=True))
            return
        atomic_json(event_path, event, immutable=True)
        print(json.dumps(event, indent=2, sort_keys=True))


def complete(args):
    run, _root, _batch, _state, _state_path, _manifest = load_batch(
        args.run_id, args.batch_id)
    with mutation_lock(run):
        _run, root, batch, state, state_path, manifest_path = load_batch(
            args.run_id, args.batch_id)
        if manifest_path.exists():
            print(json.dumps(read_json(manifest_path), indent=2, sort_keys=True))
            return
        if state.get("status") != "processing":
            raise FeedbackError("claim batch before completing it")
        responses = []
        for item in batch.get("items", []):
            event_path = root / "events" / ("response-%s.json" % item.get("id"))
            responses.append(read_json(event_path))
        manifest = {"schemaVersion": 1, "batchId": args.batch_id,
                    "runId": args.run_id, "status": "complete",
                    "completedAt": now(), "responses": responses}
        atomic_json(manifest_path, manifest, immutable=True)
        state.update({"status": "complete", "completedAt": manifest["completedAt"],
                      "updatedAt": manifest["completedAt"]})
        atomic_json(state_path, state)
        print(json.dumps(manifest, indent=2, sort_keys=True))


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    for name, handler in (("inspect", inspect), ("claim", claim), ("complete", complete)):
        command = sub.add_parser(name)
        command.add_argument("run_id")
        command.add_argument("batch_id")
        command.set_defaults(handler=handler)
    command = sub.add_parser("record")
    command.add_argument("run_id")
    command.add_argument("batch_id")
    command.add_argument("--item-id", required=True)
    command.add_argument("--response-json", required=True)
    command.set_defaults(handler=record)
    return p


def main():
    args = parser().parse_args()
    try:
        args.handler(args)
    except (FeedbackError, OSError) as exc:
        print("artifact feedback: %s" % exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
