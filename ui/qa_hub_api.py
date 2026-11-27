"""QA window, step actions, terminal and per-window chat routes."""
import contextlib
import json
import os
import re
from urllib.parse import parse_qs, urlsplit

import local_review
import mcp_inspect
import qa_chat
import qa_hub
import qa_sandbox
import qa_setup_fix
import qa_steps
import run_diff
import run_mcp
import run_terminal


QA_ROUTE = "qa"
QA_PHASE = "qa-hub"
QA_BRIEF = "inputs/qa.json"
QA_REVIEW = "qa/review.json"


def is_qa_run(meta):
    return isinstance(meta, dict) and meta.get("route") == QA_ROUTE


REVIEWED_PR_URL = re.compile(r"https://github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)/?")


def reviewed_pull_request(meta):
    """The pull request a code review run (/orc-review on a PR) reviews, or
    None. Its review writes QA steps too, so its QA window walks that PR."""
    if not isinstance(meta, dict) or meta.get("route") != local_review.ROUTE:
        return None
    review = meta.get("review") if isinstance(meta.get("review"), dict) else {}
    url = review.get("prUrl")
    match = REVIEWED_PR_URL.fullmatch(url) if isinstance(url, str) else None
    if not match:
        return None
    return {"url": url, "repo": match.group(1), "number": int(match.group(2)),
            "author": review.get("prAuthor") if isinstance(review.get("prAuthor"), str) else None,
            "title": review.get("prTitle") if isinstance(review.get("prTitle"), str) else None}


def qa_pull_request(meta):
    """The pull request a run's QA walks: a QA run's own, or the one a code
    review run reviews. None for any other run."""
    if is_qa_run(meta):
        pr = (meta.get("qa") or {}).get("pr") if isinstance(meta.get("qa"), dict) else None
        return pr if isinstance(pr, dict) else None
    return reviewed_pull_request(meta)


class Service:
    def __init__(self, runtime):
        self.runtime = runtime

    def _qa_review_state(self, run_id, meta):
        """The code review beside the QA: a code review run itself, or the review
        child of a QA run from before Review in Orc ran the review alone. Where it
        is and what it found."""
        if reviewed_pull_request(meta):
            return self._qa_review_summary(run_id, meta)
        if not is_qa_run(meta):
            return None
        try:
            with open(os.path.join(self.runtime["RUNS"], run_id, QA_REVIEW), encoding="utf-8") as handle:
                record = json.load(handle)
        except (OSError, ValueError):
            record = None
        if not isinstance(record, dict):
            return {"runId": None, "hash": None, "state": "reviewing", "findings": 0, "blocking": 0,
                    "summary": "Starting…"}
        child_id = record.get("runId")
        child = self.runtime["run_meta"](child_id) if isinstance(child_id, str) and self.runtime["_existing_run_id"](child_id) else {}
        if not child:
            return {"runId": None, "hash": None, "state": "stopped", "findings": 0, "blocking": 0,
                    "summary": record.get("error") or "The review run is no longer on this computer."}
        return self._qa_review_summary(child_id, child)

    def _qa_review_summary(self, child_id, child):
        """What the code review run `child_id` (meta `child`) has found so far."""
        try:
            with open(os.path.join(self.runtime["RUNS"], child_id, local_review.RESULT), encoding="utf-8") as handle:
                result = json.load(handle)
        except (OSError, ValueError):
            result = None
        found = [item for item in (result.get("findings") or [] if isinstance(result, dict) else [])
                 if isinstance(item, dict) and item.get("status") in ("open", "question")]
        blocking = sum(1 for item in found if item.get("blocking") is True)
        review = child.get("review") if isinstance(child.get("review"), dict) else {}
        published = isinstance(result, dict) and bool(review.get("resultDigest"))
        if published and (child.get("status") == "awaiting-gate" or child.get("status") in ("complete", "merged")):
            state = "done"
            summary = "No findings" if not found else "%d finding%s, %s" % (
                len(found), "" if len(found) == 1 else "s",
                "none block" if not blocking else "%d block%s" % (blocking, "s" if blocking == 1 else ""))
        elif child.get("status") in ("cancelled", "complete", "merged"):
            state, summary = "stopped", "The review stopped before it finished."
        else:
            state, summary = "reviewing", "Reviewing…"
        return {"runId": child_id, "hash": child_id + ("/review/recap.html" if state == "done" else ""),
                "state": state, "findings": len(found), "blocking": blocking, "summary": summary}

    def _qa_run_view(self, run_id, meta):
        pr = qa_pull_request(meta)
        title = (pr or {}).get("title") or meta.get("title") or run_id
        return {"id": run_id, "title": title, "kind": "review" if pr else "run",
                "pr": {key: pr.get(key) for key in ("url", "repo", "number", "author")} if pr else None}

    def qa_payload(self, run_id, *, terminal_allowed=True):
        run_dir = os.path.join(self.runtime["RUNS"], run_id)
        meta = self.runtime["run_meta"](run_id)
        document = qa_steps.steps_for(run_dir, meta)
        has_mcp_tab = bool(run_mcp.servers(run_id, meta))
        review = self._qa_review_state(run_id, meta)
        # A QA run's agent writes the steps while it runs; a pull request's review
        # writes or types them while it reviews.
        writing = meta.get("status") == "running" and (is_qa_run(meta) or bool(reviewed_pull_request(meta)))
        payload = qa_hub.payload(
            run_dir, run_id, document, run=self._qa_run_view(run_id, meta), app=self.runtime["_qa_app_state"](run_id, meta),
            main=self.runtime["_qa_main_state"](meta), review=review, writing=writing,
            mcp_server=self.qa_mcp_server_name(run_id, meta),
            mcp_hash="%s/%s" % (run_id, "__mcp__") if has_mcp_tab else None, meta=meta,
            delivery=self.runtime["qa_failure_delivery"](run_id, meta))
        payload["shell"] = self.runtime["_qa_shell_status"](meta, terminal_allowed)
        return payload

    def qa_chat_diff(self, run_id, meta):
        """The change Greg is asked about, as a patch: a pull request against the
        branch it targets, any other run against where its branch started. None
        when there is no diff to read."""
        patch = None
        base = (meta.get("review") or {}).get("baseRef") if isinstance(meta.get("review"), dict) else None
        if is_qa_run(meta):
            try:
                with open(os.path.join(self.runtime["RUNS"], run_id, QA_BRIEF), encoding="utf-8") as handle:
                    brief = json.load(handle)
            except (OSError, ValueError):
                brief = None
            base = brief.get("baseRef") if isinstance(brief, dict) else None
        if qa_pull_request(meta) and base:
            patch = qa_chat.pull_request_diff(self.runtime["run_checkout_dir"](meta), base)
        if patch is None:
            with contextlib.suppress(Exception):
                patch = run_diff.read_diff(os.path.join(self.runtime["RUNS"], run_id), meta, scope="branch").patch
        return patch or None

    def qa_mcp_servers(self, run_id, meta, step):
        """Where an MCP step's call goes: {"main": ..., "pr": ...}, each {label,
        name, url, headers} or {label, error}. A devd project's run MCP answers
        for the run with the run's header and for main without it; any other
        project is asked at its two apps' own addresses."""
        app, main = self.runtime["_qa_app_state"](run_id, meta), self.runtime["_qa_main_state"](meta)
        found = run_mcp.run_server(run_id, meta)
        if found is not None:
            name, entry = found
            headers = dict(entry.get("headers") or {})
            return {"pr": {"label": app["label"], "name": name, "url": entry["url"], "headers": headers},
                    "main": {"label": "main", "name": name, "url": entry["url"],
                             "headers": {key: value for key, value in headers.items() if key.lower() != "x-orc-run"}}}
        name = self.qa_mcp_server_name(run_id, meta)
        path = step["mcp"].get("path") or "/mcp"
        sides = {}
        for key, side, missing in (("pr", app, "The app is not running."), ("main", main, "main's app is not running.")):
            sides[key] = ({"label": side["label"], "name": name, "url": side["url"].rstrip("/") + path, "headers": {}}
                          if side["url"] else {"label": side["label"], "error": side["error"] or missing})
        return sides

    def qa_mcp_server_name(self, run_id, meta):
        found = run_mcp.run_server(run_id, meta)
        if found is not None:
            return found[0]
        project = meta.get("mainRepoPath") or meta.get("repoPath") or ""
        return os.path.basename(str(project).rstrip("/")) or "app"

    def qa_command_urls(self, run_id, meta):
        """Non-empty QA app URLs injected into a sandboxed command or terminal."""
        app, main = self.runtime["_qa_app_state"](run_id, meta), self.runtime["_qa_main_state"](meta)
        urls = {}
        for name, side in (("ORC_QA_APP_URL", app), ("ORC_QA_MAIN_URL", main)):
            if side["url"]:
                urls[name] = side["url"]
        return urls

    def serve_qa_terminal(self, handler, run_id):
        """A sandboxed PTY for a QA command step or a window-owned tab, or
        (`?fix=1`) the terminal of the setup fix the person started with Run it."""
        if handler._on_lan():
            return handler.json_error(403, "QA runs on the computer Orc runs on.", False)
        origin = handler.headers.get("Origin")
        if origin not in self.runtime["_page_origins"](handler.headers):
            return handler.json_error(403, "the terminal only opens from this Orc page", False)
        key = handler.headers.get("Sec-WebSocket-Key")
        if (handler.headers.get("Upgrade") or "").lower() != "websocket" or not key:
            return handler.json_error(400, "expected a WebSocket upgrade", False)
        run_dir = os.path.join(self.runtime["RUNS"], run_id)
        if not os.path.isfile(os.path.join(run_dir, "meta.json")):
            return handler.json_error(404, "run not found", False)
        query = parse_qs(urlsplit(handler.path).query, keep_blank_values=True)
        step_id = (query.get("step") or [""])[0]
        tabs = query.get("tab")
        tab_id = None
        meta = self.runtime["run_meta"](run_id)
        fix_run = None
        if "fix" in query:
            fix_run = qa_setup_fix.get(run_id)
            if fix_run is None or "step" in query or tabs is not None:
                return handler.json_error(404, "This run has no setup fix to show.", False)
        elif tabs is not None:
            if ("step" in query or len(tabs) != 1 or not re.fullmatch(
                    r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", tabs[0])):
                return handler.json_error(400, "expected a QA terminal tab UUID", False)
            if self.runtime["_qa_shell_preview"]():
                return handler.json_error(403, "QA terminal previews do not start a shell.", False)
            tab_id = tabs[0]
        else:
            document = qa_steps.steps_for(run_dir, meta)
            try:
                qa_hub._step(document, step_id, "command")
            except qa_hub.ActionError as error:
                return handler.json_error(error.status, error.message, False)
        cols = run_terminal.clamp_size((query.get("cols") or [""])[0], 80, 2, 1000)
        rows = run_terminal.clamp_size((query.get("rows") or [""])[0], 24, 1, 500)
        handler.send_response(101, "Switching Protocols")
        handler.send_header("Upgrade", "websocket")
        handler.send_header("Connection", "Upgrade")
        handler.send_header("Sec-WebSocket-Accept", run_terminal.accept_key(key))
        handler.end_headers()
        handler.close_connection = True
        ws = run_terminal.WebSocket(handler.rfile, handler.wfile, handler.connection)
        if fix_run is not None:
            # Outside the sandbox on purpose: a fix signs in, so it needs the
            # network and writes to the person's own config.
            with contextlib.closing(ws):
                if ws.send_json({"type": "ready", "cwd": None}):
                    with handler._held_by_device():
                        run_terminal.bridge(ws, fix_run.shell, cols, rows, on_copy=run_terminal.copy_to_mac)
            return
        cwd = self.runtime["run_checkout_dir"](meta)
        with contextlib.ExitStack() as stack:
            stack.callback(ws.close)
            try:
                urls = self.qa_command_urls(run_id, meta)
                if tab_id is None:
                    shell = qa_sandbox.get_terminal_shell(run_id, step_id, cwd, urls=urls)
                else:
                    shell = stack.enter_context(qa_sandbox.terminal_tab(run_id, tab_id, cwd, urls=urls))
            except (qa_sandbox.SandboxError, OSError) as exc:
                ws.send_json({"type": "error", "message": str(exc)})
                return
            if ws.send_json({"type": "ready", "sandbox": qa_sandbox.availability(), "cwd": cwd}):
                with handler._held_by_device():
                    run_terminal.bridge(ws, shell, cols, rows, on_copy=run_terminal.copy_to_mac)

    def post_run_qa(self, handler, run_id):
        """One action from the QA window on one of the run's QA steps, answered
        with the window's fresh payload."""
        # A paired phone or browser reads Orc; it does not start commands on
        # this computer. A linked laptop is the person's own Mac acting as this
        # one, as it does for the run terminal, so it is not refused here.
        if handler._on_lan():
            return handler.json_error(403, "QA runs on the computer Orc runs on.")
        run_dir = os.path.join(self.runtime["RUNS"], run_id)
        if not os.path.isfile(os.path.join(run_dir, "meta.json")):
            return handler.json_error(404, "run not found", False)
        data = handler.read_json_object(qa_hub.MAX_SHOT_BYTES * 2)
        if data is None:
            return handler.json_error(400, "expected a JSON object")
        meta = self.runtime["run_meta"](run_id)
        document = qa_steps.steps_for(run_dir, meta)
        action, step = data.get("action"), data.get("step")
        # The step as the window showed it. Run must have it: the command is
        # someone else's text, and only the text the person read may start.
        seen = data.get("hash") if isinstance(data.get("hash"), str) else None
        try:
            if action == "verdict":
                qa_hub.set_verdict(run_dir, run_id, document, step, data.get("verdict"), seen, data.get("page"))
            elif action == "send-failures":
                self.runtime["send_qa_failures"](run_id, meta, document, data.get("steps"))
            elif action == "retest":
                qa_hub.retest(run_dir, run_id, document, step, seen)
            elif action == "note":
                qa_hub.set_note(run_dir, run_id, document, step, data.get("note"), seen)
            elif action == "screenshot":
                qa_hub.add_screenshot(run_dir, run_id, document, step, data.get("image"), seen)
            elif action == "remove-screenshot":
                qa_hub.remove_screenshot(run_dir, run_id, document, step, data.get("path"))
            elif action == "run":
                if seen is None:
                    raise qa_hub.ActionError(400, "Run needs the step as the QA window showed it.")
                qa_hub.run_command(run_dir, run_id, document, step, self.runtime["run_checkout_dir"](meta),
                                   self.qa_command_urls(run_id, meta), seen)
            elif action == "stop":
                qa_hub.stop_command(run_dir, run_id, document, step)
            elif action == "terminal-run":
                if seen is None:
                    raise qa_hub.ActionError(400, "Run needs the step as the QA window showed it.")
                qa_hub.run_in_terminal(run_dir, run_id, document, step, self.runtime["run_checkout_dir"](meta),
                                       self.qa_command_urls(run_id, meta), seen)
            elif action == "terminal-reset":
                qa_hub.reset_terminal(run_id, document, step)
            elif action == "compare":
                qa_hub.compare(
                    run_dir, run_id, document, step,
                    self.qa_mcp_servers(run_id, meta, qa_hub._step(document, step, "mcp", seen)),
                    lambda key, server, call: mcp_inspect.act(
                        key, server, call,
                        client_info={"name": "orc", "title": "Orc", "version": self.runtime["orc_version"]() or "0.0.0"}),
                    seen)
            elif action == "app":
                self.runtime["qa_app_action"](run_id, meta, data.get("target"), data.get("do"))
            elif action == "setup-fix":
                self.runtime["qa_setup_fix_action"](run_id, meta, data.get("do"), data.get("fix"))
            elif action in ("finish", "reopen"):
                if document is None:
                    raise qa_hub.ActionError(409, "This run has no QA steps yet.")
                qa_hub.set_finished(run_dir, run_id, action == "finish")
                self.runtime["settle_qa_run"](run_id, action == "finish")
            else:
                return handler.json_error(400, "unknown QA action")
        except qa_hub.ActionError as error:
            return handler.json_error(error.status, error.message)
        return handler.send_body(json.dumps(self.qa_payload(run_id)).encode(), "application/json")

    def post_run_qa_chat(self, handler, run_id):
        """One action on Greg's chat from a QA window: send, stop, model,
        leave or close. Every action but leave and close answers with the
        chat."""
        # As post_run_qa: a turn is a process on this computer.
        if handler._on_lan():
            return handler.json_error(403, "QA runs on the computer Orc runs on.")
        if not os.path.isfile(os.path.join(self.runtime["RUNS"], run_id, "meta.json")):
            return handler.json_error(404, "run not found", False)
        data = handler.read_json_object(64 * 1024)
        if data is None:
            return handler.json_error(400, "expected a JSON object")
        action, session = data.get("action"), data.get("session")
        defaults = qa_chat.settings(self.runtime["read_config"]()[0])
        try:
            if action == "close":
                qa_chat.close(self.runtime["QA_CHAT_DIR"], run_id, session)
                return handler.send_body(b'{"ok": true}', "application/json")
            if action == "leave":
                qa_chat.leave(self.runtime["QA_CHAT_DIR"], run_id, session)
                return handler.send_body(b'{"ok": true}', "application/json")
            if action == "send":
                meta = self.runtime["run_meta"](run_id)
                chat = qa_chat.send(
                    self.runtime["QA_CHAT_DIR"], run_id, session, data.get("text"), qa=self.qa_payload(run_id),
                    where={"step": data.get("step"), "page": data.get("page")},
                    checkout=self.runtime["run_checkout_dir"](meta), defaults=defaults, diff=self.qa_chat_diff(run_id, meta))
            elif action == "stop":
                chat = qa_chat.stop(self.runtime["QA_CHAT_DIR"], run_id, session, defaults)
            elif action == "model":
                chat = qa_chat.choose(self.runtime["QA_CHAT_DIR"], run_id, session, data.get("model"), data.get("effort"), defaults)
            else:
                return handler.json_error(400, "unknown chat action")
        except qa_chat.ChatError as error:
            return handler.json_error(error.status, error.message)
        return handler.send_body(json.dumps(chat).encode(), "application/json")

    def get_run_qa_chat(self, handler, run_id):
        """GET /api/runs/<id>/qa/chat?session=<window>: Greg's chat as that QA
        window left it."""
        if handler._on_lan():
            return handler.json_error(403, "QA runs on the computer Orc runs on.")
        if not os.path.isfile(os.path.join(self.runtime["RUNS"], run_id, "meta.json")):
            return handler.json_error(404, "run not found", False)
        session = parse_qs(handler.path.partition("?")[2]).get("session", [None])[0]
        try:
            chat = qa_chat.state(self.runtime["QA_CHAT_DIR"], run_id, session, qa_chat.settings(self.runtime["read_config"]()[0]))
        except qa_chat.ChatError as error:
            return handler.json_error(error.status, error.message)
        return handler._respond(200, json.dumps(chat).encode(), "application/json", {"Cache-Control": "no-store"})

    def get(self, handler, path):
        if not path.startswith("/api/runs/"):
            return False
        for suffix in ("/qa/chat", "/qa/terminal", "/qa"):
            if path.endswith(suffix):
                run_id = path[len("/api/runs/"):-len(suffix)]
                if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", run_id):
                    handler.send_error(400)
                elif suffix == "/qa/chat":
                    self.get_run_qa_chat(handler, run_id)
                elif not os.path.isdir(os.path.join(self.runtime["RUNS"], run_id)):
                    handler.send_error(404)
                elif suffix == "/qa/terminal":
                    self.serve_qa_terminal(handler, run_id)
                else:
                    payload = self.qa_payload(run_id, terminal_allowed=not handler._on_lan())
                    handler.send_body(json.dumps(payload).encode(), "application/json")
                return True
        return False

    def post(self, handler, path):
        chat = re.fullmatch(r"/runs/([A-Za-z0-9][A-Za-z0-9_.-]*)/qa/chat", path)
        if chat:
            self.post_run_qa_chat(handler, chat[1])
            return True
        qa = re.fullmatch(r"/runs/([A-Za-z0-9][A-Za-z0-9_.-]*)/qa", path)
        if qa:
            self.post_run_qa(handler, qa[1])
            return True
        return False
