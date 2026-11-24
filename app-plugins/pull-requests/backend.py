"""Pull requests routes exist only while the application plugin is enabled."""
from __future__ import annotations

import json
import threading
from urllib.parse import parse_qs, urlsplit

from . import pr_manager

GET_ROUTES = ("/api/prs", "/api/prs/pr", "/api/prs/repos")
POST_ROUTES = ("/api/prs/refresh", "/api/prs/review", "/api/prs/merge", "/api/prs/onboarding",
               "/api/prs/reviewer", "/api/prs/eyes", "/api/prs/resolve-conflict")


def _read_disk_config(config_dir):
    path = config_dir / "config.json"
    try:
        return json.loads(path.read_text()), path.stat().st_mtime, None
    except FileNotFoundError:
        return {}, None, None
    except (OSError, ValueError) as error:
        return {}, None, str(error)


class Service:
    pr_manager = pr_manager

    def __init__(self, context):
        self.context = context
        self._lock = threading.Lock()
        self._manager = None

    def manager(self):
        config_dir = (str(self.context["config_dir"]()) if "config_dir" in self.context
                      else str(self.context["home"] / ".orc"))
        runs_dir = (str(self.context["runs_dir"]()) if "runs_dir" in self.context
                    else str(self.context["home"] / ".orc" / "runs"))
        read_config = (self.context["read_config_full"] if "read_config_full" in self.context
                       else lambda: _read_disk_config(self.context["home"] / ".orc"))
        with self._lock:
            if self._manager is None or (self._manager.config_dir, self._manager.runs_dir) != (config_dir, runs_dir):
                self._manager = pr_manager.Manager(config_dir, runs_dir, read_config)
            return self._manager

    def _active_manager(self):
        if "pr_manager" in self.context:
            override = self.context["pr_manager"]()
            if override is not None:
                return override
        return self.manager()

    def _attach_proposals(self, snapshot):
        links = self.context["proposal_links"]() if "proposal_links" in self.context else {}
        for section in snapshot.get("sections") or ():
            for row in section.get("items") or ():
                if row.get("url") in links:
                    row["garyProposal"] = links[row["url"]]
        return snapshot

    def handle(self, handler, method, path):
        if not ((method == "GET" and path in GET_ROUTES) or (method == "POST" and path in POST_ROUTES)):
            return False
        if not self.context["is_enabled"]():
            handler.json_error(404, "Pull requests is disabled.", False)
            return True
        try:
            if method == "GET":
                manager = self._active_manager()
                query = parse_qs(urlsplit(handler.path).query)
                if path == "/api/prs":
                    snapshot = self._attach_proposals(manager.snapshot(query.get("refresh") == ["1"]))
                    handler.send_body(json.dumps(snapshot).encode(), "application/json")
                elif path == "/api/prs/pr":
                    detail = manager.detail((query.get("url") or [""])[0])
                    handler.send_body(json.dumps(detail).encode(), "application/json")
                else:
                    repos = manager.repositories(
                        (query.get("q") or [""])[0],
                        force=query.get("refresh") == ["1"],
                    )
                    handler.send_body(json.dumps(repos).encode(), "application/json")
                return True

            if path == "/api/prs/refresh":
                handler.send_body(json.dumps(self._active_manager().refresh()).encode(), "application/json")
                return True

            if path == "/api/prs/onboarding":
                data = handler.read_json_object(32 * 1024)
                if data is None:
                    handler.json_error(400, "expected a JSON object")
                    return True
                snapshot = self._attach_proposals(
                    self._active_manager().save_repo_scope(data, self.context["update_config"]))
                handler.send_body(json.dumps(snapshot).encode(), "application/json")
                return True

            if path == "/api/prs/merge":
                data = handler.read_json_object(16 * 1024)
                if data is None:
                    handler.json_error(400, "expected a JSON object")
                    return True
                url, head = data.get("url"), data.get("headOid")
                if not isinstance(head, str) or not head:
                    handler.json_error(400, "headOid is required")
                    return True
                result = self._active_manager().merge(url if isinstance(url, str) else "", head)
                handler.send_body(json.dumps(result).encode(), "application/json")
                return True

            data = handler.read_json_object(16 * 1024)
            if data is None:
                handler.json_error(400, "expected a JSON object")
                return True
            if path in ("/api/prs/reviewer", "/api/prs/eyes"):
                manager = self._active_manager()
                act = manager.request_review if path == "/api/prs/reviewer" else manager.add_eyes
                url = data.get("url")
                handler.send_body(json.dumps(act(url if isinstance(url, str) else "")).encode(), "application/json")
                return True
            agent = data.get("agent", "claude")
            if agent not in self.context["new_conv_agents"]():
                handler.json_error(400, self.context["agent_refusal"](agent))
                return True
            url = data.get("url")
            url = url if isinstance(url, str) else ""
            if path == "/api/prs/resolve-conflict":
                # The composer's own agent and model, as card launches use;
                # orchestrator_start_run checks the runner can start here.
                launch = {"agent": agent, **{key: data[key] for key in ("model", "effort")
                                             if isinstance(data.get(key), str) and data[key]}}
                result = self._active_manager().resolve_conflict(url, launch, self.context["orchestrator_start_run"])
                handler.send_body(json.dumps(result).encode(), "application/json")
                return True
            if agent not in self.context["core_agents"]():
                handler.json_error(400, "Local review does not support %s yet" % self.context["agent_label"](agent))
                return True
            orchestration_enabled = data.get("orchestration", False)
            if type(orchestration_enabled) is not bool:
                handler.json_error(400, "orchestration must be boolean")
                return True
            if orchestration_enabled and self.context["orchestration_refusal"](agent):
                handler.json_error(400, self.context["orchestration_refusal"](agent))
                return True
            if orchestration_enabled and self.context["is_preview"]():
                handler.json_error(409, "orchestrated launches are unavailable in preview")
                return True
            manager = self._active_manager()
            detail = manager.detail(url)
            review = detail["review"]
            if not review["available"]:
                raise pr_manager.PrManagerError(409, review["reason"])
            worktree = manager.prepare_review_worktree(
                review["project"], detail["repo"], detail["number"], detail["baseRef"])
            prompt = pr_manager.review_prompt(detail, (detail.get("viewer") or {}).get("login"))
            # start_run validates both; left out, the server's review defaults apply.
            chosen = {key: data[key] for key in ("model", "effort", "orchestrationPreset")
                      if data.get(key) is not None}
            # Core starts the checkout's app and one review run, its QA steps
            # seeded from the pull request's QA section.
            handler.start_qa_review(
                detail, worktree,
                {"agent": agent, "repo": review["project"], "orchestration": orchestration_enabled, **chosen},
                prompt)
            return True
        except pr_manager.PrManagerError as error:
            handler.json_error(error.status, error.message)
            return True

    def reset_manager(self):
        with self._lock:
            self._manager = None

    def deactivate(self):
        self.reset_manager()
        return True

    def resume(self):
        return True


def activate(context):
    return Service(context)
