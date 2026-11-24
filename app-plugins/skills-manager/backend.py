"""HTTP routes and background update checker for the Skills manager plugin."""
from __future__ import annotations

import json
from pathlib import Path
import re
import threading

from . import skills_store

PREFIX = "/api/skills-manager"
BODY_LIMIT = 2 * skills_store.SKILL_MD_MAX_BYTES + 32 * 1024
SKILL_FILE_RE = re.compile(r"/api/skills-manager/skills/([a-z0-9._-]+)/files/(.+)")
SKILL_ROUTE_RE = re.compile(r"/api/skills-manager/skills/([a-z0-9._-]+)(/sync|/update|/configure|/markdown|/delete|/restore)?")


def _only(data: dict, *allowed: str) -> None:
    unknown = sorted(set(data) - set(allowed))
    if unknown:
        raise skills_store.invalid("Unknown fields: %s." % ", ".join(unknown))


def _can_manage(handler) -> bool:
    checker = getattr(handler, "_secret_entry_local", None)
    return bool(checker()) if callable(checker) else True


class Service:
    skills_store = skills_store

    def __init__(self, context: dict):
        self.context = context
        self._lock = threading.Lock()
        self._check_lock = threading.Lock()
        self._store: skills_store.Store | None = None
        self._store_key: tuple[str, str] | None = None
        self._stop_event = threading.Event()
        self._checking = False
        self._thread: threading.Thread | None = None
        self._initial_delay = float(context.get("scheduler_initial_delay", 20.0))
        self._poll_seconds = float(context.get("scheduler_poll_seconds", 900.0))
        self._start_scheduler_if_wanted()

    @property
    def allow_network(self) -> bool:
        val = self.context.get("allow_network", True)
        return bool(val() if callable(val) else val)

    def _should_schedule(self) -> bool:
        if "enable_scheduler" in self.context:
            return bool(self.context["enable_scheduler"])
        return bool(self.allow_network and self.context.get("owns_native_app"))

    def _start_scheduler_if_wanted(self) -> None:
        if not self._should_schedule():
            return
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._scheduler_loop,
            name="orc-skills-update-checker",
            daemon=True,
        )
        self._thread.start()

    def _scheduler_loop(self) -> None:
        if self._stop_event.wait(self._initial_delay):
            return
        while not self._stop_event.is_set():
            if self.context["is_enabled"]() and self.allow_network:
                try:
                    store = self.store()
                    if store.update_due():
                        self.run_update_check(slug=None)
                except Exception:
                    pass
            if self._stop_event.wait(self._poll_seconds):
                return

    def _resolve_paths(self) -> tuple[Path, Path]:
        if "config_dir" in self.context and callable(self.context["config_dir"]):
            cfg = Path(self.context["config_dir"]()).resolve()
        else:
            cfg = (Path(self.context.get("home") or Path.home()) / ".orc").resolve()
        if "home_dir" in self.context and callable(self.context["home_dir"]):
            home = Path(self.context["home_dir"]()).resolve()
        elif cfg.name == ".orc":
            home = cfg.parent
        else:
            home = Path(self.context.get("home") or Path.home()).resolve()
        return cfg, home

    def store(self) -> skills_store.Store:
        cfg, home = self._resolve_paths()
        key = (str(cfg), str(home))
        with self._lock:
            if self._store is None or self._store_key != key:
                self._store = skills_store.Store(
                    cfg,
                    home,
                    read_config=self.context.get("read_config"),
                    fetch_url=self.context.get("fetch_url"),
                )
                self._store_key = key
            return self._store

    def run_update_check(self, *, slug: str | None = None) -> dict:
        with self._check_lock:
            self._checking = True
            try:
                return self.store().check_updates(slug=slug, allow_network=self.allow_network)
            finally:
                self._checking = False

    def _decorate_snapshot(self, payload: dict, handler) -> dict:
        store = self.store()
        return {
            **payload,
            "canManage": _can_manage(handler),
            "allowNetwork": self.allow_network,
            "updateCheckDue": store.update_due(),
        }

    def handle(self, handler, method: str, path: str) -> bool:
        if not (path == PREFIX or path.startswith(PREFIX + "/")) or method not in ("GET", "POST"):
            return False
        if not self.context["is_enabled"]():
            handler.json_error(404, "Skills manager is disabled.", False)
            return True
        if method == "POST" and not _can_manage(handler):
            handler.json_error(403, "Manage skills in Orc on this Mac.", False)
            return True

        try:
            if method == "GET":
                status, payload = self._get(path, handler)
            else:
                data = handler.read_json_object(BODY_LIMIT)
                if data is None:
                    raise skills_store.invalid("Send a JSON object.")
                status, payload = self._post(path, data, handler)
        except skills_store.SkillsError as error:
            status, payload = error.status, error.payload()
        except OSError as error:
            reason = error.strerror or str(error)
            status, payload = 503, {"error": f"Skills are unavailable: {reason}", "code": "unavailable"}

        if status is None:
            status, payload = 404, {"error": "Not found.", "code": "not_found"}
        handler._respond(status, json.dumps(payload).encode("utf-8"), "application/json", {"Cache-Control": "no-store"})
        return True

    def _get(self, path: str, handler) -> tuple[int | None, dict | None]:
        store = self.store()
        if path == PREFIX:
            return 200, self._decorate_snapshot(store.snapshot(), handler)
        file_match = SKILL_FILE_RE.fullmatch(path)
        if file_match:
            return 200, {"file": store.read_file(file_match[1], file_match[2])}
        skill_match = SKILL_ROUTE_RE.fullmatch(path)
        if skill_match and not skill_match[2]:
            detail = store.detail(skill_match[1])
            detail["canManage"] = _can_manage(handler)
            detail["allowNetwork"] = self.allow_network
            return 200, detail
        return None, None

    def _post(self, path: str, data: dict, handler) -> tuple[int | None, dict | None]:
        store = self.store()

        if path == PREFIX + "/install":
            _only(data, "source", "selectedSubdirs", "slug", "scope", "targets", "projects", "overwrite", "revision")
            result = store.install_from_input(
                data.get("source"),
                selected_subdirs=data.get("selectedSubdirs"),
                slug_override=data.get("slug"),
                scope=data.get("scope") or "global",
                targets=data.get("targets"),
                projects=data.get("projects"),
                overwrite=data.get("overwrite", True) is not False,
                allow_network=self.allow_network,
                expected_revision=data.get("revision"),
            )
            if result.get("status") == "choose_skills":
                return 200, result
            return 200, self._decorate_snapshot(result, handler)

        if path == PREFIX + "/create":
            _only(data, "name", "description", "body", "scope", "targets", "projects", "revision")
            result = store.create_skill(
                name=data.get("name"),
                description=data.get("description") or "",
                body=data.get("body") or "",
                scope=data.get("scope") or "global",
                targets=data.get("targets"),
                projects=data.get("projects"),
                expected_revision=data.get("revision"),
            )
            return 200, self._decorate_snapshot(result, handler)

        if path == PREFIX + "/sync-all":
            _only(data, "strategy", "revision")
            result = store.sync_all(
                strategy=data.get("strategy") or "safe",
                expected_revision=data.get("revision"),
            )
            return 200, self._decorate_snapshot(result, handler)

        if path == PREFIX + "/check-updates":
            _only(data, "slug")
            result = self.run_update_check(slug=data.get("slug"))
            return 200, self._decorate_snapshot(result, handler)

        if path == PREFIX + "/update-all":
            _only(data)
            with self._check_lock:
                self._checking = True
                try:
                    result = store.update_all(allow_network=self.allow_network)
                finally:
                    self._checking = False
            return 200, self._decorate_snapshot(result, handler)

        if path == PREFIX + "/settings":
            _only(data, "defaultTargets", "autoSyncNewAccounts", "updateCheckInterval", "applyToGlobalSkills", "revision")
            result = store.update_settings(
                default_targets=data.get("defaultTargets"),
                auto_sync_new_accounts=data.get("autoSyncNewAccounts"),
                update_check_interval=data.get("updateCheckInterval"),
                apply_to_global_skills=bool(data.get("applyToGlobalSkills")),
                expected_revision=data.get("revision"),
            )
            return 200, self._decorate_snapshot(result, handler)

        skill_match = SKILL_ROUTE_RE.fullmatch(path)
        if not skill_match or not skill_match[2]:
            return None, None
        slug, action = skill_match[1], skill_match[2]

        if action == "/sync":
            _only(data, "preferredSource", "revision")
            result = store.sync_skill(
                slug,
                preferred_source=data.get("preferredSource"),
                expected_revision=data.get("revision"),
            )
            return 200, self._decorate_snapshot(result, handler)

        if action == "/update":
            _only(data, "revision")
            with self._check_lock:
                self._checking = True
                try:
                    result = store.update_skill(
                        slug,
                        allow_network=self.allow_network,
                        expected_revision=data.get("revision"),
                    )
                finally:
                    self._checking = False
            return 200, self._decorate_snapshot(result, handler)

        if action == "/configure":
            _only(data, "enabled", "scope", "targetMode", "targets", "excludedTargets", "projects", "sourceUrl", "revision")
            detail = store.configure_skill(
                slug,
                enabled=data.get("enabled"),
                scope=data.get("scope"),
                target_mode=data.get("targetMode"),
                targets=data.get("targets"),
                excluded_targets=data.get("excludedTargets"),
                projects=data.get("projects"),
                source_url=data.get("sourceUrl"),
                expected_revision=data.get("revision"),
            )
            detail["canManage"] = _can_manage(handler)
            detail["allowNetwork"] = self.allow_network
            return 200, detail

        if action == "/markdown":
            _only(data, "text", "baseDigest", "revision")
            detail = store.save_skill_markdown(
                slug,
                data.get("text"),
                base_digest=data.get("baseDigest"),
                expected_revision=data.get("revision"),
            )
            detail["canManage"] = _can_manage(handler)
            detail["allowNetwork"] = self.allow_network
            return 200, detail

        if action == "/delete":
            _only(data, "confirm", "revision")
            result = store.delete_skill(
                slug,
                confirm=bool(data.get("confirm")),
                expected_revision=data.get("revision"),
            )
            return 200, self._decorate_snapshot(result, handler)

        if action == "/restore":
            _only(data, "token", "revision")
            result = store.restore_skill(
                slug,
                data.get("token"),
                expected_revision=data.get("revision"),
            )
            return 200, self._decorate_snapshot(result, handler)

        return None, None

    def resume(self) -> bool:
        self._start_scheduler_if_wanted()
        return True

    def deactivate(self) -> bool:
        self._stop_event.set()
        thread = self._thread
        if thread is not None and thread.is_alive() and threading.current_thread() is not thread and not self._checking:
            thread.join(timeout=2.0)
        return not self._checking and (thread is None or not thread.is_alive())


def activate(context: dict) -> Service:
    return Service(context)
