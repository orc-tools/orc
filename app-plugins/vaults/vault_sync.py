"""Optional sync of vaults between the user's machines, through their own
Cloudflare Worker (cloud/project-memory, the /v1/vaults routes).

A vault syncs once the user turns it on in its cog. Its soul, page brief,
notes and page files go to the Worker, and every machine signed in to the
same Worker takes them up: a synced vault another machine made appears here
by itself. Automations, allowed tools, link sites, entries waiting for
approval and build history stay on each machine, so an automation runs only
where it was made and its page reaches the others through sync.

Each file has a revision on the Worker. A machine sends a change with the
revision it last saw, and the Worker keeps it only when nobody changed the
file since, so the first upload wins and the other machine merges:

- a note, the soul or the page brief is merged line by line against the
  version both last saw (``git merge-file``), keeping both sides' lines
  where they changed the same place, and the merge is sent back;
- a page file takes the other machine's version. The page as it was here is
  kept first, so Undo brings it back.

A vault being built is left alone until its build ends. Deleting a synced
vault here deletes it on every machine; turning sync off leaves every copy.
"""
from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import os
import re
import subprocess
import tempfile
import threading
from datetime import datetime, timezone

import cloud_worker

from . import vault_store

PASS_SECONDS = 60
PAGE_LIMIT = 100
PUSH_CHANGES = 50
# The Worker takes 8 MB a request; base64 and JSON need room.
PUSH_BYTES = 5_000_000
STATE_FILE = "sync.json"
BASES = "sync-base"
MERGED = (".md", ".txt")
# What the Worker refuses in a name or a path (cloud/project-memory/src/vaults.js).
CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")
WIRE_NAME_MAX = 60
WIRE_PATH_MAX = 300
REDEPLOY = ("Your Worker has no vault sync yet. Run its schema again and redeploy it, as "
            "cloud/project-memory/README.md says under Vault sync.")


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _body(data):
    """``(encoding, body)`` for the Worker: text as it is, anything else in base64."""
    try:
        return "utf8", data.decode("utf-8")
    except UnicodeDecodeError:
        return "base64", base64.b64encode(data).decode("ascii")


def _wire_name(name, slug):
    """A vault's name as the Worker takes it."""
    return CONTROL.sub("", name).strip()[:WIRE_NAME_MAX] or slug


def _syncable(path):
    return len(path) <= WIRE_PATH_MAX and not CONTROL.search(path)


def _data(change):
    """A remote file's bytes, or None when it was removed."""
    if change.get("deleted") or change.get("body") is None:
        return None
    if change.get("encoding") == "base64":
        return base64.b64decode(change["body"])
    return change["body"].encode("utf-8")


def merge(base, ours, theirs):
    """Both machines' changes to one note: git's three-way merge against the
    version both last saw, and where both changed the same lines, both sides'
    lines. Without git, the other machine's text with this one's after it."""
    with tempfile.TemporaryDirectory(prefix="orc-vault-merge-") as folder:
        paths = []
        for name, data in (("here", ours), ("base", base or b""), ("there", theirs)):
            path = os.path.join(folder, name)
            with open(path, "wb") as handle:
                handle.write(data)
            paths.append(path)
        for extra in ([], ["--union"]):
            try:
                done = subprocess.run(["git", "merge-file", "-p", *extra, *paths], capture_output=True, timeout=30)
            except (OSError, subprocess.TimeoutExpired):
                break
            if done.returncode == 0:
                return done.stdout
            if not 0 < done.returncode < 128:
                break
    return theirs + (b"" if not theirs or theirs.endswith(b"\n") else b"\n") + ours


class Sync:
    def __init__(self, store, config_dir, *, building=lambda slug: False, call=None, keychain=None):
        self.store = store
        self.config_dir = config_dir
        self.building = building
        self.call = call or cloud_worker.request
        self.keychain = keychain or cloud_worker.keychain_secrets
        self.lock = threading.Lock()
        self._nudged = threading.Event()
        self._snapped = set()

    # ---------- State, beside each vault's settings where its page's builder cannot write ----------

    def _global_path(self):
        return self.store.root / vault_store.STATE / STATE_FILE

    def _global(self):
        value = vault_store._read_json(self._global_path()) or {}
        return {"after": value.get("after") if isinstance(value.get("after"), int) else 0,
                "deletes": value.get("deletes") if isinstance(value.get("deletes"), dict) else {},
                "stopped": [slug for slug in value.get("stopped") or [] if isinstance(slug, str)],
                "remote": [slug for slug in value.get("remote") or [] if isinstance(slug, str)],
                "lastSync": value.get("lastSync"), "error": value.get("error"), "redeploy": value.get("redeploy") is True}

    def _save_global(self, state):
        vault_store._write_json(self._global_path(), state)

    def _vault_path(self, slug):
        return self.store.root / vault_store.STATE / slug / STATE_FILE

    def _vault(self, slug):
        value = vault_store._read_json(self._vault_path(slug)) or {}
        return {"enabled": value.get("enabled") is True,
                "revision": value.get("revision") if isinstance(value.get("revision"), int) else 0,
                "name": value.get("name"), "localName": value.get("localName"),
                "files": value.get("files") if isinstance(value.get("files"), dict) else {},
                "tooLarge": [path for path in value.get("tooLarge") or [] if isinstance(path, str)],
                "error": value.get("error") if isinstance(value.get("error"), str) else None,
                "lost": value.get("lost") is True}

    def _save_vault(self, slug, state):
        vault_store._write_json(self._vault_path(slug), state)

    def _base_path(self, slug, path):
        return self.store.root / vault_store.STATE / slug / BASES / path

    def _keep_base(self, slug, path, data):
        """The version both machines last saw of a merged file, to merge against."""
        if not path.lower().endswith(MERGED):
            return
        target = self._base_path(slug, path)
        if data is None:
            with contextlib.suppress(OSError):
                target.unlink()
        else:
            vault_store._write(target, data)

    def _base(self, slug, path):
        try:
            return self._base_path(slug, path).read_bytes()
        except OSError:
            return None

    # ---------- What Orc shows and changes ----------

    def available(self):
        """Whether this machine has a Worker to sync with."""
        return cloud_worker.configured(self.config_dir)

    def status(self, slug):
        state, glob = self._vault(slug), self._global()
        return {"available": self.available(), "enabled": state["enabled"], "lastSync": glob["lastSync"],
                "error": state["error"] or glob["error"], "redeploy": glob["redeploy"], "tooLarge": state["tooLarge"],
                "remote": not state["enabled"] and slug in glob["remote"]}

    def _send(self, method, path, payload=None):
        base, token = cloud_worker.credentials(self.config_dir, keychain=self.keychain)
        if not base:
            raise vault_store.VaultError(409, "Set up your Cloudflare Worker first.", "no_worker")
        return self.call(base, token, method, path, payload)

    def set_enabled(self, slug, enabled, join=False):
        """Start or stop syncing one vault. A vault of the same id that already
        syncs from another machine is joined only when asked: the two are then
        merged file by file."""
        self.store.state_dir(slug)
        if not enabled:
            with self.lock:
                glob = self._global()
                self._save_vault(slug, {"enabled": False})
                glob["stopped"] = sorted(set(glob["stopped"]) | {slug})
                self._save_global(glob)
            return
        # Asked before the lock, so a pass in flight does not hold the request up.
        try:
            listed = self._send("GET", "/v1/vaults").get("vaults") or []
        except cloud_worker.WorkerError as error:
            raise vault_store.VaultError(502, REDEPLOY if error.status == 404 else str(error), "worker") from None
        remote = any(isinstance(item, dict) and item.get("slug") == slug for item in listed)
        if remote and not join:
            raise vault_store.VaultError(409, "A vault called %s already syncs from another Mac. Join it to "
                                         "merge the two." % slug, "remote_exists")
        with self.lock:
            glob = self._global()
            state = {"enabled": True, "revision": 0, "name": None, "localName": None, "files": {}, "tooLarge": []}
            self._save_vault(slug, state)
            glob["stopped"] = [item for item in glob["stopped"] if item != slug]
            glob["remote"] = [item for item in glob["remote"] if item != slug]
            # The vault's files were seen before it synced here, so they are read again.
            if remote:
                glob["after"] = 0
            self._save_global(glob)
        self.nudge()

    def forget(self, slug):
        """A synced vault is about to be deleted here: delete it everywhere."""
        with self.lock:
            state, glob = self._vault(slug), self._global()
            if not state["enabled"]:
                return
            glob["deletes"][slug] = {"revision": state["revision"], "name": state["name"] or self.store.name(slug)}
            self._save_global(glob)
        self.nudge()

    # ---------- A pass ----------

    def run(self):
        """One pass: deletes, then what other machines changed, then what
        changed here. Returns the global state it leaves."""
        with self.lock:
            glob = self._global()
            self._snapped = set()
            try:
                base, _token = cloud_worker.credentials(self.config_dir, keychain=self.keychain)
                if not base:
                    return glob
                self._push_deletes(glob)
                self._pull(glob)
                failed = None
                for slug in self.store.slugs():
                    if self._vault(slug)["enabled"] and not self.building(slug):
                        failed = self._push_vault(glob, slug) or failed
                glob.update(error=failed, redeploy=False, lastSync=_now())
            except cloud_worker.WorkerError as error:
                glob.update(error=REDEPLOY if error.status == 404 else str(error), redeploy=error.status == 404)
            except (vault_store.VaultError, OSError) as error:
                glob["error"] = str(error)
            self._save_global(glob)
            return glob

    def _push_deletes(self, glob):
        for slug, gone in list(glob["deletes"].items()):
            change = {"kind": "vault", "slug": slug, "base": gone.get("revision") or 0,
                      "name": gone.get("name") or slug, "deleted": True}
            result = self._send("POST", "/v1/vaults/push", {"machine": self._machine(), "changes": [change]})
            answer = (result.get("results") or [{}])[0]
            current = answer.get("current") or {}
            if answer.get("status") == "conflict" and not current.get("deleted"):
                # Changed elsewhere since: the user still deleted it.
                change["base"] = current.get("revision", 0)
                self._send("POST", "/v1/vaults/push", {"machine": self._machine(), "changes": [change]})
            del glob["deletes"][slug]
            self._save_global(glob)

    def _machine(self):
        machine = cloud_worker.machine_id(self.config_dir)
        if not machine:
            raise cloud_worker.WorkerError("This machine has no Orc machine ID yet.")
        return machine

    def _pull(self, glob):
        restarted = again = False
        while True:
            page = self._send("GET", "/v1/vaults/changes?after=%d&limit=%d" % (glob["after"], PAGE_LIMIT))
            for change in page.get("changes") or []:
                outcome = self._apply(glob, change)
                if outcome == "wait":
                    return
                again = again or outcome == "again"
                glob["after"] = max(glob["after"], int(change.get("seq") or 0))
            self._save_global(glob)
            if page.get("more"):
                continue
            # A vault that arrived after some of its files reads them again.
            if again and not restarted:
                restarted, again, glob["after"] = True, False, 0
                continue
            return

    def _apply(self, glob, change):
        if change.get("kind") == "vault":
            return self._apply_vault(glob, change)
        slug, path = change.get("vault"), change.get("path")
        if slug not in self.store.slugs() or self.store.synced_path(path) is None:
            return None
        state = self._vault(slug)
        if not state["enabled"]:
            return None
        if self.building(slug):
            return "wait"
        known = state["files"].get(path) or {}
        if int(known.get("revision") or 0) >= int(change.get("revision") or 0):
            return None
        # A file changed here while this ran is left for the next push, which merges it.
        with contextlib.suppress(vault_store.VaultError):
            self._take(slug, state, path, change)
            self._save_vault(slug, state)
        return None

    def _apply_vault(self, glob, change):
        slug = change.get("slug")
        if not isinstance(slug, str) or not vault_store.SLUG.fullmatch(slug):
            return None
        here = slug in self.store.slugs()
        state = self._vault(slug)
        remote = set(glob["remote"])
        if change.get("deleted"):
            glob["remote"] = sorted(remote - {slug})
            # An old deletion of the same id says nothing about a vault this
            # Mac has not synced yet, which revives the id when it pushes.
            if here and state["enabled"] and 0 < state["revision"] < int(change.get("revision") or 0):
                if self.building(slug):
                    return "wait"
                self.store.delete(slug)
            return None
        if here and state["enabled"]:
            if int(change.get("revision") or 0) > state["revision"]:
                local = self.store.name(slug)
                if local == state["localName"] and change.get("name") and change["name"] != local:
                    with contextlib.suppress(vault_store.VaultError):
                        self.store.rename(slug, change["name"])
                state.update(revision=int(change["revision"]), name=change.get("name"),
                             localName=self.store.name(slug))
                self._save_vault(slug, state)
            return None
        if here:
            if slug not in glob["stopped"]:
                glob["remote"] = sorted(remote | {slug})
            return None
        if slug in glob["stopped"]:
            return None
        try:
            name = self.store.create_synced(slug, change.get("name") or slug)
        except vault_store.VaultError:
            # Orc keeps at most VAULTS_MAX vaults, so a full Mac goes without this one.
            return None
        self._save_vault(slug, {"enabled": True, "revision": int(change.get("revision") or 0),
                                "name": change.get("name"), "localName": name, "files": {}, "tooLarge": []})
        return "again"

    def _take(self, slug, state, path, change):
        """Leave ``path`` as the other machine has it, merged with what
        changed here since both last saw it."""
        spelling, found = self._local(slug, path)
        ours = found.read_bytes() if found is not None else None
        theirs = _data(change)
        known = state["files"].get(path) or {}
        # Changed here since both machines last saw it. A file this machine
        # never synced but holds counts as changed, so joining merges it.
        mine = (_sha(ours) if ours is not None else None) != known.get("sha")
        if theirs is not None and ours is not None and _sha(ours) == _sha(theirs):
            result = ours
        elif not mine:
            result = theirs
        elif theirs is None:
            result = ours
        elif ours is None:
            # Changed there and removed here: the change is kept.
            result = theirs
        elif path.lower().endswith(MERGED):
            result = merge(self._base(slug, path), ours, theirs)
        else:
            result = theirs
        if result is not ours and result != ours:
            if path.startswith(vault_store.PAGE + "/") and slug not in self._snapped and self.store.page(slug)["exists"]:
                self._snapped.add(slug)
                self.store.snapshot_page(slug)
            self.store.write_synced(slug, spelling, result, expect=None if ours is None else _sha(ours))
        state["files"][path] = {"revision": int(change.get("revision") or 0),
                                "sha": None if theirs is None else _sha(theirs)}
        self._keep_base(slug, path, theirs)

    def _local(self, slug, path):
        """``(spelling, Path or None)``: the file here that ``path`` names. Mac
        folders ignore case, so Ideas.md from another Mac is ideas.md here."""
        files = self.store.synced_files(slug)
        if path in files:
            return path, files[path]
        folded = path.casefold()
        for spelling, found in files.items():
            if spelling.casefold() == folded:
                return spelling, found
        return path, None

    def _files(self, slug, state):
        """This vault's synced files under the spelling the Worker knows them by."""
        known = {path.casefold(): path for path in state["files"]}
        return {known.get(path.casefold(), path): found for path, found in self.store.synced_files(slug).items()}

    def _push_vault(self, glob, slug):
        """Push one vault, keeping its error to itself so the others still sync.
        Returns that error, or None."""
        state = None
        try:
            self._push(glob, slug)
            return None
        except cloud_worker.WorkerError as error:
            if error.status == 404:
                raise
            state, message = self._vault(slug), str(error)
        except (vault_store.VaultError, OSError) as error:
            state, message = self._vault(slug), str(error)
        if slug in self.store.slugs():
            state["error"] = message
            self._save_vault(slug, state)
        return message

    def _push(self, glob, slug, retried=False):
        state = self._vault(slug)
        local = self.store.name(slug)
        changes = []
        if state["revision"] == 0 or state["lost"] or local != state["localName"]:
            changes.append({"kind": "vault", "slug": slug, "base": state["revision"], "name": _wire_name(local, slug),
                            "deleted": False})
        files = self._files(slug, state)
        folder = self.store.root / slug
        large, sizes = [], {}
        for path, found in sorted(files.items()):
            try:
                data = found.read_bytes()
            except OSError:
                continue
            if len(data) > vault_store.SYNC_FILE_MAX_BYTES or not _syncable(path):
                large.append(path)
                continue
            known = state["files"].get(path) or {}
            digest = _sha(data)
            if known.get("sha") == digest:
                continue
            encoding, body = _body(data)
            changes.append({"kind": "file", "vault": slug, "path": path, "base": int(known.get("revision") or 0),
                            "sha": digest, "encoding": encoding, "body": body, "deleted": False})
            sizes[path] = data
        for path, known in sorted(state["files"].items()):
            # Gone from the folder, not just from the listing, which stops at
            # the most page files Orc serves.
            if path not in files and known.get("sha") is not None and not (folder / path).exists():
                changes.append({"kind": "file", "vault": slug, "path": path, "base": int(known.get("revision") or 0),
                                "sha": None, "encoding": None, "body": None, "deleted": True})
        state.update(tooLarge=large, error=None)
        for batch in self._batches(changes):
            result = self._send("POST", "/v1/vaults/push", {"machine": self._machine(), "changes": batch})
            for change, answer in zip(batch, result.get("results") or []):
                outcome = self._answered(glob, slug, state, change, answer, sizes, local)
                if outcome == "gone":
                    return
                if outcome == "retry" and not retried:
                    self._save_vault(slug, state)
                    return self._push(glob, slug, retried=True)
        self._save_vault(slug, state)

    @staticmethod
    def _batches(changes):
        batch, size = [], 0
        for change in changes:
            # As sent: JSON escapes each character outside ASCII to six.
            weight = len(json.dumps(change))
            if batch and (len(batch) >= PUSH_CHANGES or size + weight > PUSH_BYTES):
                yield batch
                batch, size = [], 0
            batch.append(change)
            size += weight
        if batch:
            yield batch

    def _answered(self, glob, slug, state, change, answer, sizes, local):
        status = answer.get("status")
        current = answer.get("current") or {}
        if change["kind"] == "vault":
            if status == "applied":
                state.update(revision=int(answer["revision"]), name=local, localName=local, lost=False)
            elif status == "conflict" and not answer.get("current"):
                # The Worker lost the vault (a new database): it is sent again whole.
                state.update(revision=0, files={}, lost=False)
                return "retry"
            elif status == "conflict" and current.get("deleted") and state["revision"] == 0:
                # Another vault of this id was deleted once; this one takes the id over.
                state["revision"] = int(current.get("revision") or 0)
                return "retry"
            elif status == "conflict" and current.get("deleted"):
                # Another machine deleted it first, which the user asked for there.
                self.store.delete(slug)
                return "gone"
            elif status == "conflict":
                state.update(revision=int(current.get("revision") or 0), name=current.get("name"))
                if state["localName"] is None:
                    state["localName"] = local
            return None
        path = change["path"]
        if status == "applied":
            state["files"][path] = {"revision": int(answer["revision"]), "sha": change["sha"]}
            self._keep_base(slug, path, None if change["deleted"] else sizes.get(path))
        elif status == "conflict":
            # Merged now; the merge goes up on the next pass.
            with contextlib.suppress(vault_store.VaultError):
                self._take(slug, state, path, current)
        elif status == "gone":
            # No live vault on the Worker: the next pass sends the vault again,
            # or deletes it here when another Mac deleted it.
            state["lost"] = True
        return None

    # ---------- In the background ----------

    def nudge(self):
        self._nudged.set()

    def watch(self, stop, may_run):
        """Sync every minute, and soon after a change here, while ``may_run``."""
        while not stop.is_set():
            if may_run() and self.available():
                with contextlib.suppress(Exception):
                    self.run()
            self._nudged.wait(PASS_SECONDS)
            self._nudged.clear()
            if stop.wait(2):
                return
