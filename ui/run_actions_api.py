"""Run action dispatch and the shared reentrant run mutation lock."""
import contextlib
import fcntl
import json
import os
import re
import threading

import local_review
import run_relationships


JSON_ACTIONS = {
    "send-answers": "send_answers",
    "btw": "send_btw",
    "send-failed": "send_failed",
    "answer-question": "answer_question",
    "send-review": "send_review",
    "session": "session_action",
    "tasks": "task_action",
    "fork": "fork",
    "follow-up": "follow_up",
    "cancel": "cancel_run",
    "planning-start": "planning_start",
    "sibling": "open_sibling",
    "review-action": "local_review_action",
    "link": "link_run",
    "worktree-app": "worktree_app_action",
    "artifact-feedback-draft": "artifact_feedback_draft",
    "artifact-feedback-submit": "artifact_feedback_submit",
    "artifact-feedback-thread": "artifact_feedback_thread",
}

RUN_ACTIONS = {
    "planning-done": "planning_done",
    "plan-reveal": "plan_reveal",
    "push-main": "push_main",
    "deploy-retry": "deploy_retry",
    "deploy-dismiss": "deploy_dismiss",
}

SPECIAL_ACTIONS = {
    "chat-send", "chat-stop", "chat-send-now", "chat-retry",
    "chat-resume-queue", "focus", "start-now", "plan-review-submit",
    "grilling-review-submit", "clarification-review-submit", "question-set-submit", "open-session",
    "reopen-session", "open-terminal", "terminal-tab", "run-script",
    "worktree-launch", "open-in", "needs-you-run", "needs-you-open",
    "rescue", "attachments", "pr-body", "pr-body-update",
    "pr-replies", "pr-review", "reviewer-request", "pr-review-post",
    "merge-queue", "merge-queue-retry", "merge-queue-resolve", "merge-participant",
}
ALLOWED_ACTIONS = JSON_ACTIONS.keys() | RUN_ACTIONS.keys() | SPECIAL_ACTIONS | {"delivery-groups"}


class Service:
    def __init__(self, runtime):
        self.runtime = runtime
        self.mutation_state = threading.local()

    @contextlib.contextmanager
    def run_mutation_lock(self, run_id=None):
        """Coordinate UI mutations with the external parent-merge helper.

        HTTP handlers compose smaller mutation helpers, so make the process-side
        lock reentrant within one request thread while retaining one flock against
        the helper process and other server threads.
        """
        depth = getattr(self.mutation_state, "depth", 0)
        if depth:
            self.mutation_state.depth = depth + 1
            try:
                yield
            finally:
                self.mutation_state.depth -= 1
            return
        os.makedirs(self.runtime["RUNS"], exist_ok=True)
        meta = self.runtime["run_meta"](run_id) if run_id else {}
        with open(self.runtime["merge_lock_path"](meta), "a+") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            self.mutation_state.depth = 1
            try:
                yield
            finally:
                self.mutation_state.depth = 0
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def post(self, handler, path):
        parts = path.lstrip("/").split("/")
        # generation-keyed answers files (<gate>-answers.<ts>.json — see
        # page_gen) gate on the same base file's phases
        base = re.sub(r"\.\d{8}-\d{6}(?:-\d+)?(?=\.json$)", "", parts[-1])
        if len(parts) != 3 or parts[0] != "runs":
            return handler.send_error(404)
        action = parts[2]
        if action not in ALLOWED_ACTIONS and base not in self.runtime["ANSWER_FILES"]:
            return handler.send_error(404)
        run_id = parts[1]
        run_dir = os.path.realpath(os.path.join(self.runtime["RUNS"], run_id))
        if (run_id.startswith(".") or os.sep in run_id
                or not run_dir.startswith(os.path.realpath(self.runtime["RUNS"]) + os.sep)
                or not os.path.isdir(run_dir)):
            return handler.send_error(400)
        meta = self.runtime["run_meta"](run_id)
        if (self.runtime["has_question_outcome"](meta)
                and action not in ("link", "fork", "follow-up")
                # Focusing or closing its own pane leaves the answer intact:
                # session_action writes nothing back for a question run.
                # Shell tabs also leave the published answer intact.
                # Chat hands the answering agent a follow-up to judge, and
                # writes nothing back to the answer either.
                and not (action in ("open-session", "session", "open-terminal", "terminal-tab",
                                      "chat-send", "chat-stop", "chat-send-now", "chat-retry", "chat-resume-queue")
                         and self.runtime["is_question_run"](meta, run_dir=run_dir))
                # Opening a file the Chat links writes nothing to any settled run.
                and action != "open-in"
                # A closed planning session is a record, but the work it
                # settled can still start from it: a fork never rewrites it.
                and not (self.runtime["planning_outcome"](meta)
                         and action in ("open-session", "planning-start", "session"))
                and not (local_review.is_review(meta)
                         and action == "open-session")
                and not (self.runtime["published_evals_parent"](meta)
                         and action in self.runtime["EVALS_PARENT_ACTIONS"])):
            return handler.json_error(
                409, "answered question runs are read-only", False)
        # Cancelling settles unfinished history, and stopping its agent ends a
        # turn, without resuming or upgrading it.
        if (action not in ("link", "fork", "follow-up", "cancel", "session")
                and run_relationships.retired_lifecycle(meta)):
            return handler.json_error(409, self.runtime["LEGACY_READ_ONLY_ERROR"], False)
        if action in ("chat-send", "chat-stop", "chat-send-now", "chat-retry", "chat-resume-queue"):
            # Typing into a live pane, so a page on another origin must not
            # reach it. No run lock is held across the send: the woken agent
            # may run an Orc helper that takes this run's lock before the
            # paste returns. Queue changes use their separate queue lock.
            if not self.runtime["_origin_may_mutate"](handler.headers):
                return handler.json_error(403, "cross-site request rejected")
            if self.runtime["merged_to_parent_read_only"](run_id):
                return handler.json_error(
                    409, "run is read-only after merge to parent", False)
            options = handler.read_json_object(64 * 1024)
            if options is None:
                return handler.send_error(400)
            if action == "chat-resume-queue":
                return handler.chat_resume_queue(run_id)
            if action == "chat-stop":
                return handler.chat_stop(run_id)
            if action == "chat-send-now":
                return handler.chat_send_now(run_id, options)
            if action == "chat-retry":
                return handler.chat_retry(run_id, options)
            return handler.chat_send(run_id, options)
        if action == "focus":
            if not self.runtime["_origin_may_mutate"](handler.headers):
                return handler.json_error(403, "cross-site request rejected")
            return handler.focus_action(run_id, handler.read_json_object(1024))
        if action == "start-now":
            if not self.runtime["_origin_may_mutate"](handler.headers):
                return handler.json_error(403, "cross-site request rejected")
            ok, err = self.runtime["release_start_after_run"](run_id, manual=True)
            if not ok:
                return handler.json_error(409, err or "run is not waiting on another run", False)
            return handler.send_body(json.dumps({"ok": True, "runId": run_id}).encode(), "application/json")
        if action == "open-session":
            # Focus only — no merged-to-parent refusal here. Jumping to a pane
            # writes nothing, and a merged child's window is often still alive.
            with self.run_mutation_lock(run_id):
                return handler.open_session(run_id)
        if action == "reopen-session":
            with self.run_mutation_lock(run_id):
                if self.runtime["merged_to_parent_read_only"](run_id):
                    return handler.json_error(
                        409, "run is read-only after merge to parent", False)
                options = handler.read_json_object(64 * 1024)
                if options is None:
                    return handler.send_error(400)
                return handler.reopen_session(run_id, focus=options.get("focus") is not False)
        if action == "rescue":
            if not self.runtime["_origin_may_mutate"](handler.headers):
                return handler.json_error(403, "cross-site request rejected")
            options = handler.read_json_object(64 * 1024)
            if options is None:
                return handler.json_error(400, "expected an object")
            with self.run_mutation_lock(run_id):
                return handler.rescue_session(run_id, options)
        if action == "open-terminal":
            options = handler.read_json_object(64 * 1024)
            if options is None:
                return handler.send_error(400)
            with self.run_mutation_lock(run_id):
                if self.runtime["merged_to_parent_read_only"](run_id):
                    return handler.json_error(
                        409, "run is read-only after merge to parent", False)
                return handler.open_terminal(run_id, options)
        if action == "terminal-tab":
            options = handler.read_json_object(64 * 1024)
            if options is None:
                return handler.send_error(400)
            with self.run_mutation_lock(run_id):
                if self.runtime["merged_to_parent_read_only"](run_id):
                    return handler.json_error(
                        409, "run is read-only after merge to parent", False)
                return handler.terminal_tab_action(self.runtime["run_terminal_page"](run_id, meta), options)
        if action in ("needs-you-run", "needs-you-open"):
            # Writes nothing to the run, so a merged run still runs
            # the steps its Ship page left for after the merge.
            options = handler.read_json_object(64 * 1024)
            if options is None:
                return handler.send_error(400)
            if action == "needs-you-open":
                return handler.open_needs_you_command(run_id, options)
            return handler.run_needs_you_command(run_id, options)
        if action == "run-script":
            options = handler.read_json_object(64 * 1024)
            if options is None:
                return handler.send_error(400)
            with self.run_mutation_lock(run_id):
                if self.runtime["merged_to_parent_read_only"](run_id):
                    return handler.json_error(
                        409, "run is read-only after merge to parent", False)
                return handler.run_project_script(run_id, options.get("id"))
        if action == "worktree-launch":
            options = handler.read_json_object(64 * 1024)
            if options is None:
                return handler.send_error(400)
            with self.run_mutation_lock(run_id):
                if self.runtime["merged_to_parent_read_only"](run_id):
                    return handler.json_error(
                        409, "run is read-only after merge to parent", False)
                return handler.run_worktree_launch(run_id, options.get("command"))
        if action == "open-in":
            # Writes nothing to the run, so it takes no run lock.
            options = handler.read_json_object(64 * 1024)
            if options is None:
                return handler.send_error(400)
            return handler.open_in_editor(run_id, options)
        if action == "attachments":
            with self.run_mutation_lock(run_id):
                if self.runtime["merged_to_parent_read_only"](run_id):
                    return handler.json_error(
                        409, "run is read-only after merge to parent", False)
                return self.runtime["ATTACHMENTS_SERVICE"].post_attachment(handler, run_id, run_dir)
        if action == "pr-body":
            with self.run_mutation_lock(run_id):
                if self.runtime["merged_to_parent_read_only"](run_id):
                    return handler.json_error(
                        409, "run is read-only after merge to parent", False)
                return handler.post_pr_body(run_id, run_dir)
        if action == "pr-body-update":
            return handler.post_pr_body_update(run_id)
        if action == "pr-replies":
            with self.run_mutation_lock(run_id):
                return handler.post_pr_reply(run_dir)
        if action == "reviewer-request":
            return handler.post_reviewer_request(run_id)
        if action == "pr-review":
            with self.run_mutation_lock(run_id):
                return handler.post_pr_review_edit(run_id, run_dir)
        if action == "pr-review-post":
            return handler.post_pr_review(run_id, run_dir)
        if action == "merge-queue":
            try:
                length = int(handler.headers.get("Content-Length") or 0)
            except ValueError:
                return handler.send_error(400)
            if length < 0 or length > 64 * 1024:
                return handler.send_error(400)
            try:
                payload = json.loads(handler.rfile.read(length) or b"{}")
            except ValueError:
                return handler.send_error(400)
            if not isinstance(payload, dict):
                return handler.send_error(400)
            consent, consent_error = self.runtime["merge_queue_request_consent"](self.runtime["run_meta"](run_id), payload)
            if consent_error:
                return handler.json_error(409, consent_error, False)
            state, error = self.runtime["enqueue_merge"](
                run_id, payload.get("receiptDigest"), payload.get("authorityDigest"),
                **consent)
            if error:
                code = 404 if error == "run not found" else 409
                return handler.json_error(code, error, False)
            return handler.send_body(json.dumps(state).encode(), "application/json")
        if action == "merge-participant":
            try:
                length = int(handler.headers.get("Content-Length") or 0)
            except ValueError:
                return handler.send_error(400)
            if length < 0 or length > 64 * 1024:
                return handler.send_error(400)
            try:
                payload = json.loads(handler.rfile.read(length) or b"{}")
            except ValueError:
                return handler.send_error(400)
            if not isinstance(payload, dict):
                return handler.send_error(400)
            # Synchronous on purpose: a local `git merge` of one repository
            # takes seconds, the button already reads "Merging…" while the
            # request is out, and the reload that follows shows the landing.
            state, error = self.runtime["merge_participant_now"](
                run_id, payload.get("participantId"),
                payload.get("receiptDigest"), payload.get("authorityDigest"))
            if error:
                code = 404 if error in ("run not found", "unknown participant") else 409
                return handler.json_error(code, error, False)
            return handler.send_body(json.dumps(state).encode(), "application/json")
        if action == "merge-queue-resolve":
            try:
                length = int(handler.headers.get("Content-Length") or 0)
            except ValueError:
                return handler.send_error(400)
            if length < 0 or length > 64 * 1024:
                return handler.send_error(400)
            if length:
                handler.rfile.read(length)
            error = self.runtime["start_early_resolution"](run_id)
            if error:
                code = 404 if error == "run not found" else 409
                return handler.json_error(code, error, False)
            self.runtime["invalidate_runs_body"](queue_changed=True)
            return handler.send_body(b'{"ok": true}', "application/json")
        if action == "merge-queue-retry":
            try:
                length = int(handler.headers.get("Content-Length") or 0)
            except ValueError:
                return handler.send_error(400)
            if length < 0 or length > 64 * 1024:
                return handler.send_error(400)
            if length:
                handler.rfile.read(length)
            state, error = self.runtime["retry_merge_queue_recovery"](run_id)
            if error:
                code = 404 if error == "run not found" else 409
                return handler.json_error(code, error, False)
            return handler.send_body(json.dumps(state).encode(), "application/json")
        try:
            length = int(handler.headers.get("Content-Length") or 0)
        except ValueError:
            return handler.send_error(400)
        if length <= 0 or length > 256 * 1024:
            return handler.send_error(400)
        body = handler.rfile.read(length)
        try:
            data = json.loads(body)
        except ValueError:
            return handler.send_error(400)
        # The synchronous helper takes the same per-repo flock, so release it
        # before dispatch to avoid deadlocking against the child process.
        if (action == "send-answers" and isinstance(data, dict)
                and (("feedbackCommit" in data and data.get("action") in ("pr-push", "pr-replies"))
                     or (data.get("action") in ("pr", "pr-push") and self.runtime["use_pr_cli"](meta)))):
            if not self.runtime["_origin_may_mutate"](handler.headers):
                return handler.json_error(403, "cross-site request rejected")
            if "feedbackCommit" in data:
                commit = data["feedbackCommit"]
                if not isinstance(commit, str) or not re.fullmatch("[0-9a-f]{40}(?:[0-9a-f]{24})?", commit):
                    return handler.json_error(409, "invalid feedback commit")
                args = ["--feedback-commit", commit, "--action", data["action"]]
                if data.get("postReplies") is True:
                    args.append("--post-replies")
                error, already = self.runtime["run_pr_cli"](run_id, args)
            else:
                error, already = self.runtime["deliver_ship_pr"](run_id, data["action"], data.get("authorityDigest")), False
            if error:
                return handler.json_error(409, error)
            return handler.send_body(json.dumps({"alreadyPushed": True} if already else {}).encode(),
                                  "application/json")
        if action == "send-answers" and isinstance(data, dict) \
                and data.get("action") == "bring-to-main":
            return handler.send_answers(run_id, data)
        if action == "plan-review-submit":
            return handler.plan_review_submit(run_id, data)
        if action == "grilling-review-submit":
            return handler.grilling_review_submit(run_id, data)
        if action == "clarification-review-submit":
            return handler.clarification_review_submit(run_id, data)
        if action == "question-set-submit":
            return handler.question_set_submit(run_id, data)
        with self.run_mutation_lock(run_id):
            if action not in ("link", "fork") and self.runtime["merged_to_parent_read_only"](run_id):
                return handler.json_error(
                    409, "run is read-only after merge to parent", False)
            if (action not in JSON_ACTIONS and action not in RUN_ACTIONS
                    and action != "delivery-groups"
                    and self.runtime["page_locked"](run_id, self.runtime["ANSWER_FILES"][base])):
                return handler.send_error(403)
            if action == "delivery-groups":
                frozen, error = self.runtime["freeze_delivery_groups"](run_id, data)
                if error:
                    return handler.json_error(
                        409, error, False,
                        self.runtime["delivery_grouping_field_errors"](error, data))
                return handler.send_body(json.dumps({"ok": True, "delivery": frozen}).encode(),
                                      "application/json")
            if action in JSON_ACTIONS:
                return getattr(handler, JSON_ACTIONS[action])(run_id, data)
            if action in RUN_ACTIONS:
                return getattr(handler, RUN_ACTIONS[action])(run_id)
            with open(os.path.join(run_dir, action), "wb") as f:
                f.write(body)
            handler.send_body(b"{}", "application/json")
