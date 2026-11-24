"""Persist and recover agent conversation identifiers."""
import json
import os
import tempfile
from pathlib import Path

import headless_session
import run_chat
import stat_cache

_LAUNCH_IDENTITY_KEYS = ("sessionId", "codexThreadId")


def headless_codex_thread(meta, run_dir):
    """The thread a headless Codex run's own turns started, for a run whose
    launch hook never recorded it, or None. A run queue can interrupt the
    launch turn before that hook runs, and later turns are chat messages it
    ignores. A rescue's logs count from its first turn, and a rescue still
    swapping sessions has no owner to recover yet."""
    rescue = meta.get("sessionRescue") or {}
    if (meta.get("harness") != "codex" or meta.get("codexThreadId")
            or not headless_session.is_headless(meta)
            or rescue.get("state") in ("stopping", "preparing", "failed")):
        return None
    return headless_session.codex_thread_id(run_dir, first_turn=rescue.get("firstTurn", 1))


def _restore_headless_launch(meta, run_dir):
    rescue = meta.get("sessionRescue") or {}
    if rescue.get("state") in ("stopping", "preparing", "failed"):
        return meta
    need_backend = (meta.get("outcome") == "question" and not meta.get("sessionBackend")
                    and not meta.get("herdrPane"))
    need_effort = not meta.get("launchEffort")
    need_model = not meta.get("launchModel")
    need_account = meta.get("harness") == "claude" and not meta.get("claudeAccount")
    if not (need_backend or need_effort or need_model or need_account):
        return meta
    launch = headless_session.read_launch(run_dir)
    if not launch or launch.get("agent") != meta.get("harness"):
        return meta
    extra_args = launch.get("extraArgs")
    if not isinstance(extra_args, list):
        extra_args = []
    extra = {}
    if need_backend:
        extra["sessionBackend"] = "headless"
    if need_effort:
        effort = run_chat.launch_effort(extra_args)
        if effort:
            extra["launchEffort"] = effort
    if need_model:
        model = run_chat.launch_model(extra_args)
        if model:
            extra["launchModel"] = model
    if need_account and isinstance(launch.get("claudeAccount"), str) and launch["claudeAccount"]:
        extra["claudeAccount"] = launch["claudeAccount"]
    return {**meta, **extra} if extra else meta


def restore_launch_identity(meta, run_dir):
    """Recover fields lost by a stale metadata writer without replacing ownership."""
    meta = _restore_headless_launch(meta, run_dir)
    meta = _restore_saved_identity(meta, run_dir)
    thread = headless_codex_thread(meta, run_dir)
    return {**meta, "codexThreadId": thread} if thread else meta


def _restore_saved_identity(meta, run_dir):
    try:
        identity = json.loads(stat_cache.RUN_FILES.read(
            os.path.join(run_dir, ".session-launch.json")))
    except (OSError, ValueError):
        return meta
    if (not isinstance(identity, dict) or identity.get("schemaVersion") != 1
            or identity.get("runId") != os.path.basename(run_dir)
            or identity.get("harness") != meta.get("harness")
            or any(meta.get(key) and identity.get(key)
                   and meta[key] != identity[key]
                   for key in _LAUNCH_IDENTITY_KEYS)):
        return meta
    return {**meta,
            **{key: identity[key] for key in _LAUNCH_IDENTITY_KEYS
               if not meta.get(key) and isinstance(identity.get(key), str)
               and identity[key]}}


def remember_launch_identity(meta, run_dir):
    identity = {"schemaVersion": 1, "runId": os.path.basename(run_dir),
                "harness": meta.get("harness"),
                **{key: meta[key] for key in _LAUNCH_IDENTITY_KEYS if meta.get(key)}}
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(dir=run_dir, prefix=".session-launch-")
        with os.fdopen(fd, "w") as handle:
            json.dump(identity, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, os.path.join(run_dir, ".session-launch.json"))
        return True
    except OSError:
        return False
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
