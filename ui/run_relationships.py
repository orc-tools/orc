#!/usr/bin/env python3
"""Durable relationship authority for Orc runs.

The store lives outside ``runs/<id>`` so linking and context lineage never
rewrite lifecycle records or terminal artifacts.
"""
from __future__ import annotations

import contextlib
import fcntl
import hashlib
import json
import os
import re
import subprocess
import tempfile
from datetime import datetime, timezone


SCHEMA_VERSION = 1
RUN_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,120}\Z")
LINK_TYPES = frozenset({"related", "blocked-by", "superseded-by"})
PLANNING_ROUTE = "planning-session"
# Routes whose runs build nothing: no branch, worktree, checks or delivery.
NON_BUILD_ROUTES = (PLANNING_ROUTE, "local-review", "evals", "meeting-prep", "qa")
QUESTION_META_KEYS = frozenset({
    "runId", "source", "sourceRef", "sourceUrl", "title", "mode", "harness",
    "host", "claudeAccount",
    "launchedBy", "machineId",
    "sessionId", "sessionBackend", "sessionRescue", "sessionHistory",
    "codexThreadId", "cursorSessionId", "model",
    "launchModel", "launchEffort", "launchFast", "launchPermissionMode",
    "orchestration", "orchestrationPreset", "orchestrationProfile", "powerMode",
    "subagentModels", "runtimeCommit",
})
# A question run's route survives publication only when the run's output is
# the answer itself: a finished flashcard still needs its route for its
# Flashcard tab, Calendar link and card-rewriting replies.
ANSWER_ROUTES = frozenset({"meeting-prep"})
# Where a flashcard run keeps its meeting (ui/meeting_prep.py BRIEF).
MEETING_BRIEF = "inputs/meeting.json"
# The question-run shape. ui/serve.py aliases these three rather than keeping
# its own copy, so `--repair` below and the UI predicate can never drift apart.
QUESTION_FORBIDDEN_META = frozenset({
    "mainRepoPath", "repoPath", "repository", "branch", "baseBranch",
    "defaultBranch", "buildBaseCommit",
    "worktree", "repositories",
    "repositoriesVersion", "primaryRepositoryId", "phaseDispatch",
    "qaEmbeddedInRecap", "grillingCompletionVersion", "grillingApproval",
    "grillingCompletion", "planContractVersion", "conditional", "gatedPhases",
    "mvpCheckpointVersion", "reviewEvidenceVersion", "reviewAutoRepairHeads",
    "lifecycleVersion", "verifyRepairHeads",
    "revalidationRequired", "cancelReason", "delivery", "prUrl",
    "prUrls", "prState", "prFeedback", "notionUrl", "techDocUrl",
    "techDocPublic", "forks", "forkLaunches", "parentRunId", "forkFile",
    "contextBrief", "contextPackage", "relationshipLaunchToken",
    "gitProvenance", "mergedIntoRunId",
    "mergedIntoBranch", "mergeCommit", "mergedAt", "mergeConflict",
})
QUESTION_FORBIDDEN_ARTIFACTS = frozenset({
    "inputs/grilling-brief.md", "inputs/clarification-brief.md",
    "clarification/clarification.mdx", "clarification-questions.json",
    "clarification/clarification.html", "grilling-questions.json", "plan.mdx",
    "plan.html", "plan-questions.json", "diff.patch", "build-progress.md",
    "build-summary.md", "review.html", "review-questions.json", "ponytail.md",
    "review-report.md", "a11y-report.md", "analytics-report.md",
    "review-liveness.json", "review-degradation.json",
    "review-spec-drift.json", "review-evidence-admission.json",
    "qa-report.md", "qa-review.html",
    "qa-review-questions.json", "audit.html", "build-review.html",
    "audit-questions.json", "pr-body.md", "pr-comments.mdx",
    "delivery-authority.json", "verification-receipt.json", "ship/ship.mdx", "ship/ship.html",
    "pr-comments.html", "notion-comments.mdx",
    "notion-comments-questions.json", "notion-comments.html", "decisions.md",
    "decisions.jsonl",
})
QUESTION_FORBIDDEN_PREFIXES = (
    "grilling-review/", "clarification-review/", "inputs/build-spec/",
    "phase-dispatch/", "evidence/",
    "mvp/", "shots/", "adrs/", "docs/", "recap/", "present/", "ship/",
    "review-provenance-",
)


# A launch stub that was never classified stays live, not history, while its
# agent still owns it: working, escalated to the user, at a gate, or paused.
LIVE_LAUNCH_STUB_STATUSES = frozenset({"running", "escalated", "awaiting-gate", "paused"})


class RelationshipStoreError(OSError):
    pass


def retired_lifecycle(meta):
    if not isinstance(meta, dict):
        return False
    if meta.get("lifecycleVersion") is not None:
        return meta["lifecycleVersion"] not in (3, 4)
    if meta.get("outcome"):
        return False
    if meta.get("route") in NON_BUILD_ROUTES + ("orchestration-worker",):
        return False
    if not meta.get("phase"):
        return meta.get("status") in ("complete", "merged")
    # Launch stubs precede classification into a question or a v4 change run.
    # An agent may retitle one, dropping titlePending, and never classify it,
    # and may escalate, wait at a gate or pause it before classifying; only a
    # stub that finished is history.
    if (meta.get("phase") == "grilling" and meta.get("status") in LIVE_LAUNCH_STUB_STATUSES
            and (meta.get("titlePending") or meta.get("mode") in ("gated", "quick"))
            and not any(key in meta for key in ("branch", "buildBaseCommit", "phaseDispatch"))):
        return False
    return True


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def valid_run_id(value):
    return isinstance(value, str) and RUN_ID_RE.fullmatch(value) is not None


def store_path(config_dir):
    return os.path.join(config_dir, "relationships.json")


def context_dir(config_dir):
    return os.path.join(config_dir, "relationship-contexts")


def empty_store():
    return {"schemaVersion": SCHEMA_VERSION, "links": [], "children": [],
            "removedLinks": [], "questionProjects": []}


def _normalize(store):
    if not isinstance(store, dict) or store.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError("unsupported relationship store")
    if not all(isinstance(store.get(key), list)
               for key in ("links", "children", "removedLinks")):
        raise ValueError("malformed relationship store")
    links = store["links"]
    children = store["children"]
    removed = store["removedLinks"]
    question_projects = store.get("questionProjects", [])
    if not isinstance(question_projects, list):
        question_projects = []
    return {"schemaVersion": SCHEMA_VERSION, "links": links, "children": children,
            "removedLinks": removed, "questionProjects": question_projects}


def read_store(config_dir):
    try:
        with open(store_path(config_dir), encoding="utf-8") as handle:
            return _normalize(json.load(handle))
    except FileNotFoundError:
        return empty_store()
    except (OSError, ValueError, TypeError) as exc:
        raise RelationshipStoreError("relationship store is unreadable") from exc


def _write_store(config_dir, store):
    os.makedirs(config_dir, mode=0o700, exist_ok=True)
    path = store_path(config_dir)
    encoded = (json.dumps(store, indent=2, sort_keys=True) + "\n").encode()
    fd, temporary = tempfile.mkstemp(dir=config_dir, prefix=".relationships.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        try:
            directory = os.open(config_dir, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        except OSError:
            pass
    except Exception:
        with contextlib.suppress(OSError):
            os.unlink(temporary)
        raise


@contextlib.contextmanager
def locked_store(config_dir):
    os.makedirs(config_dir, mode=0o700, exist_ok=True)
    lock_path = os.path.join(config_dir, ".relationships.lock")
    with open(lock_path, "a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        store = read_store(config_dir)
        yield store
        _write_store(config_dir, store)
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def add_link(config_dir, source_id, target_id, link_type, created_at=None):
    if not valid_run_id(source_id) or not valid_run_id(target_id):
        raise ValueError("invalid run id")
    if source_id == target_id:
        raise ValueError("cannot link a run to itself")
    if link_type not in LINK_TYPES:
        raise ValueError("unknown link type")
    with locked_store(config_dir) as store:
        key = (source_id, target_id, link_type)
        if any((row.get("sourceRunId"), row.get("targetRunId"), row.get("type")) == key
               for row in store["links"] if isinstance(row, dict)):
            raise ValueError("link already exists")
        store["removedLinks"] = [row for row in store["removedLinks"] if not (
            isinstance(row, dict) and (row.get("sourceRunId"), row.get("targetRunId"),
                                       row.get("type")) == key)]
        store["links"].append({
            "sourceRunId": source_id, "targetRunId": target_id,
            "type": link_type, "createdAt": created_at or utc_now(),
        })


def remove_link(config_dir, source_id, target_id, link_type, legacy_exists=False):
    with locked_store(config_dir) as store:
        before = len(store["links"])
        store["links"] = [row for row in store["links"] if not (
            isinstance(row, dict) and row.get("sourceRunId") == source_id
            and row.get("targetRunId") == target_id and row.get("type") == link_type)]
        if len(store["links"]) == before and not legacy_exists:
            raise KeyError("link not found")
        key = (source_id, target_id, link_type)
        if legacy_exists and not any(
                isinstance(row, dict) and (row.get("sourceRunId"),
                    row.get("targetRunId"), row.get("type")) == key
                for row in store["removedLinks"]):
            store["removedLinks"].append({"sourceRunId": source_id,
                                          "targetRunId": target_id,
                                          "type": link_type,
                                          "removedAt": utc_now()})


def upsert_child(config_dir, record):
    token = record.get("launchToken") if isinstance(record, dict) else None
    if not isinstance(token, str) or not re.fullmatch(r"[a-f0-9]{24}", token):
        raise ValueError("invalid launch token")
    source_id = record.get("sourceRunId")
    if not valid_run_id(source_id):
        raise ValueError("invalid source run id")
    with locked_store(config_dir) as store:
        row = next((item for item in store["children"]
                    if isinstance(item, dict) and item.get("launchToken") == token), None)
        if row is None:
            row = dict(record)
            store["children"].append(row)
        else:
            row.update(record)
        row["updatedAt"] = utc_now()
        return dict(row)


def child_by_token(config_dir, token):
    return next((dict(row) for row in read_store(config_dir)["children"]
                 if isinstance(row, dict) and row.get("launchToken") == token), None)


def child_by_run(config_dir, child_id):
    return next((dict(row) for row in read_store(config_dir)["children"]
                 if isinstance(row, dict) and row.get("childRunId") == child_id), None)


def _canonical_project(value):
    if not isinstance(value, str) or not value.strip():
        return None
    expanded = os.path.expanduser(value.strip())
    if not os.path.isabs(expanded):
        return None
    return os.path.realpath(expanded)


def add_question_project(config_dir, run_id, project, created_at=None):
    """Record one immutable launch-project owner for a question run."""
    if not valid_run_id(run_id):
        raise ValueError("invalid run id")
    canonical = _canonical_project(project)
    if canonical is None:
        raise ValueError("invalid project")
    with locked_store(config_dir) as store:
        rows = [row for row in store["questionProjects"]
                if isinstance(row, dict) and row.get("runId") == run_id]
        if len(rows) == 1 and rows[0].get("project") == canonical:
            return dict(rows[0])
        if rows:
            raise ValueError("question project already exists with different authority")
        row = {"runId": run_id, "project": canonical,
               "createdAt": created_at or utc_now()}
        store["questionProjects"].append(row)
        return dict(row)


def question_project_context(store, run_id):
    """Return project context only for one unambiguous, well-formed record."""
    if not valid_run_id(run_id) or not isinstance(store, dict):
        return None
    rows = [row for row in store.get("questionProjects", [])
            if isinstance(row, dict) and row.get("runId") == run_id]
    if len(rows) != 1:
        return None
    row = rows[0]
    project = row.get("project")
    if (set(row) != {"runId", "project", "createdAt"}
            or _canonical_project(project) != project
            or not isinstance(row.get("createdAt"), str)
            or not row["createdAt"].strip()):
        return None
    return project


def _configured_project(config_dir, meta):
    candidates = [_canonical_project(meta.get(key))
                  for key in ("mainRepoPath", "repoPath") if meta.get(key)]
    if not candidates:
        return None
    if any(candidate is None for candidate in candidates):
        raise ValueError("question stub has conflicting project authority")
    try:
        with open(os.path.join(config_dir, "config.json"), encoding="utf-8") as handle:
            config = json.load(handle)
    except FileNotFoundError:
        return None
    except (OSError, ValueError, TypeError) as exc:
        raise RelationshipStoreError("project configuration is unreadable") from exc
    repos = config.get("repos") if isinstance(config, dict) else None
    if not isinstance(repos, dict):
        return None
    configured = [_canonical_project(key) for key in repos]

    def configured_authority(candidate):
        possible = [candidate]
        try:
            common = subprocess.check_output(
                ["git", "-C", candidate, "rev-parse", "--git-common-dir"],
                stderr=subprocess.DEVNULL, text=True).strip()
            if common:
                if not os.path.isabs(common):
                    common = os.path.join(candidate, common)
                common = os.path.realpath(common)
                if os.path.basename(common) == ".git":
                    possible.append(os.path.dirname(common))
        except (OSError, subprocess.SubprocessError):
            pass
        matches = [project for project in configured if project in possible]
        return matches[0] if len(matches) == 1 else None

    authorities = [configured_authority(candidate) for candidate in candidates]
    if len(set(candidates)) > 1 and (None in authorities
                                      or len(set(authorities)) != 1):
        raise ValueError("question stub has conflicting project authority")
    unique = set(authority for authority in authorities if authority is not None)
    return unique.pop() if len(unique) == 1 else None


def _atomic_bytes(path, body):
    directory = os.path.dirname(path)
    fd, temporary = tempfile.mkstemp(
        dir=directory, prefix=".%s." % os.path.basename(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        try:
            directory_fd = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            pass
    except Exception:
        with contextlib.suppress(OSError):
            os.unlink(temporary)
        raise


def _question_shape_violations(run_dir):
    """Artifacts in run_dir that prove lifecycle work, so it is not an answer."""
    found = []
    for root, dirs, names in os.walk(run_dir):
        dirs[:] = [name for name in dirs if not name.startswith(".")]
        for name in names:
            if name.startswith("."):
                continue
            path = os.path.relpath(os.path.join(root, name), run_dir)
            if path in QUESTION_FORBIDDEN_ARTIFACTS or any(
                    path.startswith(prefix)
                    for prefix in QUESTION_FORBIDDEN_PREFIXES):
                found.append(path)
            elif path == "grilling.mdx" and os.path.getsize(
                    os.path.join(run_dir, path)):
                found.append(path)
    return sorted(found)


def _terminal_question_meta(meta, run_dir):
    """The metadata a published answer keeps: QUESTION_META_KEYS, plus an
    answer route. A flashcard published before its route was kept is a
    calendar run with its meeting on disk; repair gives it its route back."""
    kept = {key: value for key, value in meta.items() if key in QUESTION_META_KEYS}
    route = meta.get("route")
    if route is None and meta.get("source") == "calendar" \
            and isinstance(meta.get("sourceRef"), str) \
            and os.path.isfile(os.path.join(run_dir, MEETING_BRIEF)) \
            and not os.path.islink(os.path.join(run_dir, MEETING_BRIEF)):
        route = "meeting-prep"
    if route in ANSWER_ROUTES:
        kept["route"] = route
    return kept


def publish_question(config_dir, run_dir, answer, repair=False, ui_spec=None, title=None):
    """Publish a question answer while moving project ownership externally.

    ``repair`` re-runs the terminal write for a run that was published by hand
    and kept keys QUESTION_META_KEYS drops — the only reason an already-answered
    run fails is_question_run and strands itself read-only in the UI. It reuses
    the answer already on disk and never rewrites it.
    """
    clean_title = None
    if title is not None:
        if not isinstance(title, str) or not title.strip() or len(title.strip()) > 80:
            raise ValueError("question title must be a non-empty string of at most 80 characters")
        clean_title = title.strip()
    config_dir = os.path.realpath(config_dir)
    run_dir = os.path.realpath(run_dir)
    runs_dir = os.path.realpath(os.path.join(config_dir, "runs"))
    if os.path.dirname(run_dir) != runs_dir or not os.path.isdir(run_dir):
        raise ValueError("question run is outside the configured run store")
    run_id = os.path.basename(run_dir)
    meta_path = os.path.join(run_dir, "meta.json")
    if os.path.islink(meta_path):
        raise ValueError("question metadata must not be a symlink")
    try:
        with open(meta_path, encoding="utf-8") as handle:
            meta = json.load(handle)
    except (OSError, ValueError, TypeError) as exc:
        raise ValueError("question metadata is unreadable") from exc
    if not isinstance(meta, dict) or meta.get("runId") != run_id:
        raise ValueError("question metadata has the wrong run id")

    answer_path = os.path.join(run_dir, "answer.md")
    terminal = (meta.get("outcome"), meta.get("phase"), meta.get("status")) \
        == ("question", "done", "complete")
    try:
        with open(answer_path, "rb") as handle:
            existing = handle.read()
    except FileNotFoundError:
        existing = b""
    except OSError as exc:
        raise ValueError("question answer is unreadable") from exc
    if repair:
        # Repair only ever republishes an answer that already exists, and only
        # for a run whose artifacts still say "answer" — otherwise stripping
        # repository authority would destroy a real run's metadata.
        if "outcome" not in meta:
            raise ValueError("run has no answered outcome to repair")
        if not existing.strip():
            raise ValueError("question answer is empty")
        violations = _question_shape_violations(run_dir)
        if violations:
            raise ValueError(
                "run carries lifecycle artifacts, refusing repair: %s"
                % ", ".join(violations))
        answer = existing
    elif terminal:
        if not existing:
            raise ValueError("terminal question answer is empty")
        if clean_title is not None and meta.get("title") != clean_title:
            terminal_meta = _terminal_question_meta(meta, run_dir)
            terminal_meta.update({"outcome": "question", "phase": "done",
                                  "status": "complete", "title": clean_title})
            _atomic_bytes(meta_path, (json.dumps(terminal_meta, indent=2, sort_keys=True)
                                      + "\n").encode())
        return {"runId": run_id, "answer": answer_path,
                "project": question_project_context(read_store(config_dir), run_id)}
    else:
        # Publishing over lifecycle work would strip the run's repository
        # metadata, and the UI would still not read it as an answer, so the
        # run would lose its project and Chat.
        violations = _question_shape_violations(run_dir)
        if violations:
            raise ValueError(
                "run carries lifecycle artifacts, refusing publication: %s"
                % ", ".join(violations))

    if isinstance(answer, str):
        answer = answer.encode("utf-8")
    if not isinstance(answer, bytes) or not answer.strip():
        raise ValueError("question answer is empty")
    view = None
    if ui_spec is not None:
        if repair:
            raise ValueError("repair cannot replace an answer view")
        from structured_answer import prepare_view
        view = prepare_view(ui_spec, existing or answer)
    project = _configured_project(config_dir, meta)
    if view is not None:
        _atomic_bytes(os.path.join(run_dir, "answer.ui.json"), view)
    if not existing:
        _atomic_bytes(answer_path, answer)
    if project is not None:
        add_question_project(config_dir, run_id, project)

    terminal_meta = _terminal_question_meta(meta, run_dir)
    if clean_title is not None:
        terminal_meta["title"] = clean_title
    terminal_meta.update({"outcome": "question", "phase": "done",
                          "status": "complete"})
    _atomic_bytes(meta_path, (json.dumps(terminal_meta, indent=2, sort_keys=True)
                              + "\n").encode())
    return {"runId": run_id, "answer": answer_path, "project": project}


def _completed_question(run_dir, action, config_dir=None):
    """(run_dir, meta) of a valid completed question run, or ValueError
    naming the refused action. With config_dir, the run must also sit in
    that config's run store."""
    run_dir = os.path.realpath(run_dir)
    if config_dir is not None and os.path.dirname(run_dir) != os.path.join(
            os.path.realpath(config_dir), "runs"):
        raise ValueError("question run is outside the configured run store")
    meta_path = os.path.join(run_dir, "meta.json")
    answer_path = os.path.join(run_dir, "answer.md")
    if os.path.islink(meta_path) or os.path.islink(answer_path):
        raise ValueError("question files must not be symlinks")
    try:
        with open(meta_path, encoding="utf-8") as handle:
            meta = json.load(handle)
    except (OSError, ValueError) as exc:
        raise ValueError("question metadata is unreadable") from exc
    if (not isinstance(meta, dict)
            or meta.get("runId") != os.path.basename(run_dir)
            or (meta.get("outcome"), meta.get("phase"), meta.get("status"))
            != ("question", "done", "complete")
            or QUESTION_FORBIDDEN_META.intersection(meta)
            or _question_shape_violations(run_dir)):
        raise ValueError("only valid completed question answers can be " + action)
    return run_dir, meta


def update_question(config_dir, run_dir, answer, expected_sha256):
    run_dir, meta = _completed_question(run_dir, "updated", config_dir)
    answer_path = os.path.join(run_dir, "answer.md")
    if not isinstance(answer, bytes) or not answer.strip():
        raise ValueError("question answer is empty")
    answer.decode("utf-8")
    with open(answer_path, "rb") as handle:
        current = handle.read()
    if hashlib.sha256(current).hexdigest() != expected_sha256:
        raise ValueError("question answer changed; read it again before updating")
    _atomic_bytes(answer_path, answer)
    return {"runId": meta["runId"], "answer": answer_path, "updated": True}


FOLLOW_UP_BRIEF = "inputs/follow-up-brief.md"
LAUNCH_DELIVERY = "inputs/launch-delivery.json"
# Composer Ship consent was given for the question; set aside, it stays on
# record but never queues a merge of work the user has not seen.
ANSWERED_LAUNCH_DELIVERY = "inputs/answer-launch-delivery.json"


def _follow_up_request(message):
    return "## Request\n\n" + message.strip() + "\n"


def awaiting_build(meta):
    """Whether a continued answer has not yet entered Build: the state a
    retried takeover may report again, and a later turn must finish."""
    return (isinstance(meta, dict) and bool(meta.get("answerContinuedAt"))
            and "outcome" not in meta
            and (meta.get("phase"), meta.get("status")) == ("grilling", "running")
            and not any(key in meta for key in ("lifecycleVersion", "branch", "route")))


def continue_question(config_dir, run_dir, project, message):
    """Turn an answered question into the change run its follow-up asks for,
    in place, so the conversation that wrote the answer builds the work.

    The run gets back the repository authority publish_question moved into
    the store, and inputs/follow-up-brief.md carries the request with the
    question and answer it follows, so the frozen build spec has both. The
    answer stays as answer.md. Repeating the same request before Build
    starts returns the same result without changing anything.
    """
    if not isinstance(message, str) or not message.strip():
        raise ValueError("follow-up text is empty")
    canonical = _canonical_project(project)
    if canonical is None:
        raise ValueError("invalid project")
    resolved = os.path.realpath(run_dir)
    run_id = os.path.basename(resolved)
    try:
        with open(os.path.join(resolved, "meta.json"), encoding="utf-8") as handle:
            current = json.load(handle)
    except (OSError, ValueError):
        current = None
    if isinstance(current, dict) and current.get("answerContinuedAt"):
        try:
            with open(os.path.join(resolved, FOLLOW_UP_BRIEF), encoding="utf-8") as handle:
                same = _follow_up_request(message) in handle.read()
        except (OSError, UnicodeDecodeError):
            same = False
        if not (awaiting_build(current) and same):
            raise ValueError("this answer already continued as a change run")
        return {"runId": run_id, "state": "continued",
                "project": current.get("mainRepoPath")}
    run_dir, meta = _completed_question(run_dir, "continued")

    def read(relative):
        try:
            with open(os.path.join(run_dir, relative), encoding="utf-8") as handle:
                return handle.read().strip()
        except (OSError, UnicodeDecodeError):
            return ""

    brief = "\n\n".join(part for part in (
        "# Follow-up on an answered question\n\n"
        "This run answered a question first. The request below continues it "
        "as work in the same run.",
        _follow_up_request(message).rstrip(),
        read("inputs/start-prompt.txt") and "## Question\n\n" + read("inputs/start-prompt.txt"),
        "## Answer\n\n" + read("answer.md"),
    ) if part) + "\n"
    meta_path = os.path.join(run_dir, "meta.json")
    with open(meta_path, "rb") as handle:
        original = handle.read()
    os.makedirs(os.path.join(run_dir, "inputs"), exist_ok=True)
    _atomic_bytes(os.path.join(run_dir, FOLLOW_UP_BRIEF), brief.encode())
    consent = os.path.join(run_dir, LAUNCH_DELIVERY)
    set_aside = os.path.join(run_dir, ANSWERED_LAUNCH_DELIVERY)
    if os.path.lexists(consent):
        os.replace(consent, set_aside)
    meta.pop("outcome", None)
    meta.update({"phase": "grilling", "status": "running",
                 "mainRepoPath": canonical, "repoPath": canonical,
                 "answerContinuedAt": utc_now()})
    # A launch stub is gated or quick; anything else reads as retired history.
    if meta.get("mode") not in ("gated", "quick"):
        meta["mode"] = "gated"
    try:
        _atomic_bytes(meta_path, (json.dumps(meta, indent=2, sort_keys=True) + "\n").encode())
        with locked_store(config_dir) as store:
            store["questionProjects"] = [
                row for row in store["questionProjects"]
                if not (isinstance(row, dict) and row.get("runId") == run_id)]
    except Exception:
        # Half a takeover would be a running run nobody builds, so the answer
        # stays whole and the caller starts a child instead.
        _atomic_bytes(meta_path, original)
        if os.path.lexists(set_aside) and not os.path.lexists(consent):
            os.replace(set_aside, consent)
        raise
    return {"runId": run_id, "state": "continued", "project": canonical}


def write_context(config_dir, token, package, markdown):
    root = context_dir(config_dir)
    os.makedirs(root, mode=0o700, exist_ok=True)
    json_path = os.path.join(root, token + ".json")
    md_path = os.path.join(root, token + ".md")
    encoded = (json.dumps(package, indent=2, sort_keys=True) + "\n").encode()
    for path, body in ((json_path, encoded), (md_path, markdown.encode())):
        if os.path.exists(path):
            with open(path, "rb") as handle:
                if handle.read() != body:
                    raise ValueError("context package already exists with different bytes")
            continue
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
    return md_path, json_path, hashlib.sha256(encoded).hexdigest()


def plan_handoff(runs, row):
    """Identify work started by a plan for top-level display and plan
    navigation. The runs of a plan that opened one run per step across
    several repositories stay nested under it: they list as its group."""
    source = runs.get(row.get("sourceRunId"))
    child = runs.get(row.get("childRunId"))
    return (isinstance(source, dict) and source.get("route") == PLANNING_ROUTE
            and isinstance(child, dict) and child.get("route") != PLANNING_ROUTE
            and row.get("mode") != "orc-plan-session"
            and not plan_group_spans_repos(row))


def plan_group_spans_repos(row):
    return row.get("planGroup") is True and type(row.get("planRepos")) is int \
        and row["planRepos"] > 1


def compatibility_view(runs, store):
    """Return deduplicated canonical plus legacy edges without writing history."""
    links = []
    children = []
    link_keys = set()
    child_keys = {}
    removed_keys = {
        (row.get("sourceRunId"), row.get("targetRunId"), row.get("type"))
        for row in store.get("removedLinks", []) if isinstance(row, dict)
    }

    def take_link(row, legacy=False):
        if not isinstance(row, dict):
            return
        key = (row.get("sourceRunId"), row.get("targetRunId"), row.get("type"))
        if not all(valid_run_id(value) for value in key[:2]) or key[0] == key[1] \
                or key[2] not in LINK_TYPES or key in link_keys or key in removed_keys:
            return
        link_keys.add(key)
        links.append({**row, "legacy": legacy or bool(row.get("legacy"))})

    def take_child(row, legacy=False):
        if not isinstance(row, dict):
            return
        source_id, child_id = row.get("sourceRunId"), row.get("childRunId")
        if not valid_run_id(source_id) or (child_id is not None and not valid_run_id(child_id)):
            return
        key = (source_id, child_id or row.get("launchToken") or row.get("contextPath"))
        taken = child_keys.get(key)
        if taken is not None:
            # A legacy fork is recorded twice: the child's parentRunId carries
            # gitProvenance, the parent's forks[] carries title and file. Runs
            # arrive in no fixed order, so merge the halves instead of letting
            # whichever came first decide the payload. A store row stays whole.
            if legacy and taken["legacy"]:
                for field, value in row.items():
                    if taken.get(field) is None:
                        taken[field] = value
            return
        entry = {**row, "legacy": legacy or bool(row.get("legacy"))}
        child_keys[key] = entry
        children.append(entry)

    for row in store.get("links", []):
        take_link(row)
    for row in store.get("children", []):
        take_child(row)
    for run_id, meta in runs.items():
        if not isinstance(meta, dict):
            continue
        for row in meta.get("links") or []:
            if isinstance(row, dict):
                take_link({"sourceRunId": run_id, "targetRunId": row.get("runId"),
                           "type": row.get("type")}, legacy=True)
        parent_id = meta.get("parentRunId")
        if valid_run_id(parent_id):
            take_child({"sourceRunId": parent_id, "childRunId": run_id,
                        "gitProvenance": meta.get("gitProvenance")}, legacy=True)
        for row in meta.get("forks") or []:
            if isinstance(row, dict) and valid_run_id(row.get("childRunId")):
                take_child({"sourceRunId": run_id, "childRunId": row.get("childRunId"),
                            "title": row.get("title"), "legacyFile": row.get("file")}, legacy=True)
    for row in children:
        if plan_handoff(runs, row):
            row["planHandoff"] = True
    links.sort(key=lambda row: (row["sourceRunId"], row["targetRunId"], row["type"]))
    children.sort(key=lambda row: (row["sourceRunId"], row.get("childRunId") or "",
                                   row.get("launchToken") or ""))
    return {"links": links, "children": children,
            "questionProjects": list(store.get("questionProjects", []))}


def group_row(row):
    """A launch row that puts its run in a group: one of a plan's per-step
    runs, or a sibling a run opened in another repository."""
    return isinstance(row, dict) and (row.get("planGroup") is True or row.get("sibling") is True)


def _repo_name(path):
    return os.path.basename(str(path or "").rstrip("/"))


def group_view(root_id, rows, metas):
    """Who is in the group `root_id` heads, for the sidebar, the plan's steps
    and each member's line naming its siblings. `rows` are the root's launch
    rows and `metas` maps run ids to their meta. A plan is not a member; a run
    that opened siblings is. Returns None when the root heads no group."""
    rows = [row for row in rows if group_row(row) and row.get("sourceRunId") == root_id]
    if not rows:
        return None
    root = metas.get(root_id) or {}
    plan = root.get("route") == PLANNING_ROUTE
    by_step = {row.get("planStep"): row for row in rows if type(row.get("planStep")) is int}
    members = []
    if not plan:
        members.append({"runId": root_id, "title": root.get("title") or root_id,
                        "repo": _repo_name(root.get("mainRepoPath") or root.get("repoPath")),
                        "state": "launched", "status": root.get("status"),
                        "phase": root.get("phase"), "prUrl": root.get("prUrl")})
    rows = sorted(rows, key=lambda row: (row.get("planStep") or 1000, row.get("requestedAt") or ""))
    for row in rows:
        state = row.get("state")
        child = row.get("childRunId") if valid_run_id(row.get("childRunId")) else None
        meta = metas.get(child) or {} if child else {}
        if state == "launched" and (not meta or meta.get("status") == "cancelled"):
            continue
        if state not in ("launched", "launching", "waiting"):
            continue
        waits = [(by_step.get(step) or {}).get("planRepo") or "step %d" % step
                 for step in row.get("waitsOn") or ()]
        members.append({
            "runId": child, "step": row.get("planStep"),
            "title": meta.get("title") or row.get("planStepTitle") or child or "",
            "repo": row.get("planRepo") or _repo_name(row.get("targetProject")),
            "state": state, "status": meta.get("status"), "phase": meta.get("phase"),
            "prUrl": meta.get("prUrl"), "since": row.get("requestedAt"),
            "path": row.get("targetProject"),
            "waitsOn": list(row.get("waitsOn") or []),
            "waitsOnRepos": waits})
    repos = {member["repo"] for member in members if member["repo"]}
    return {"root": root_id, "plan": plan, "repos": len(repos), "members": members}
