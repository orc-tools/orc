"""Deploy after merge: run a project's deploy command once a run's merge
reaches origin.

A project's `deployCommand` (Settings -> project -> Delivery) is empty by
default. When a merge lands on origin -- Merge and push, Yeet it, or a pull
request Orc sees merged -- the code that saw it calls `request`, which marks
the run's meta.json with a queued `deploy` record. orc-ui's watcher then calls
`Runner.tick` every few seconds, and the runner:

- runs one deploy per project at a time, in the project's own checkout, on
  its default branch brought level with origin;
- lets the newest queued run lead and every other run queued with it share
  that one deploy's result (`coveredBy`), so runs merged close together
  deploy once;
- runs the command detached in the user's login shell, writing `deploy.log`
  and an exit-code file into the leading run's folder, so an orc-ui restart
  mid-deploy picks the result up again;
- clears an earlier failed deploy of the same project once a later one
  succeeds, since that deploy shipped its merge too.

A failed deploy the user dismissed (a newer run will ship it anyway) stays
failed, so its card keeps its log and Retry deploy, but it stops holding the
run open: `blocking` is False and the run can settle.

The record (`meta["deploy"]`):
  state        queued | running | deployed | failed
  via          what queued it: merge-and-push, yeet, pr, push or retry
  requestedAt  when it was queued
  command, branch, commit, startedAt, finishedAt, exitCode, error
  pid          the leading deploy's process, while it runs
  coveredBy    the run whose deploy stands for this one
  dismissedAt  when the user dismissed a failed deploy; retrying clears it

stdlib-only, like the rest of ui/.
"""
from __future__ import annotations

import contextlib
import datetime as _dt
import json
import os
import signal
import subprocess
import tempfile
import time

import fcntl
import hashlib

import merge_queue
import project_settings

STATES = ("queued", "running", "deployed", "failed")
PENDING_STATES = ("queued", "running")
LOG_NAME = "deploy.log"
EXIT_NAME = ".deploy-exit"
TIMEOUT_SECONDS = 30 * 60
KILL_GRACE_SECONDS = 5
LOCK_WAIT_SECONDS = 30
GIT_TIMEOUT = 30
TAIL_LINES = 6
LOG_VIEW_BYTES = 48_000


class DeployError(Exception):
    """Why a deploy could not start, in words the run's card shows."""


def iso_now(clock=time.time):
    return _dt.datetime.fromtimestamp(clock(), _dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(value):
    try:
        return _dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=_dt.timezone.utc).timestamp()
    except (TypeError, ValueError):
        return None


def record(meta):
    """The run's deploy record, or None."""
    value = meta.get("deploy") if isinstance(meta, dict) else None
    return value if isinstance(value, dict) and value.get("state") in STATES else None


def state(meta):
    """The run's deploy state, or None when it has no deploy."""
    current = record(meta)
    return current["state"] if current else None


def pending(meta):
    return state(meta) in PENDING_STATES


def failed(meta):
    return state(meta) == "failed"


def dismissed(meta):
    """A failed deploy the user dismissed from its card."""
    return failed(meta) and bool(record(meta).get("dismissedAt"))


def blocking(meta):
    """The deploy still holds the run open: queued, running, or failed and
    not dismissed."""
    return pending(meta) or (failed(meta) and not dismissed(meta))


def command_for(meta, config_dir=None):
    """The deploy command saved for the run's project, or ''."""
    repo = meta.get("mainRepoPath") if isinstance(meta, dict) else None
    return project_settings.deploy_command(project_settings.entry(repo, config_dir))


def request(meta, via, config_dir=None, clock=time.time):
    """Queue a deploy on `meta` in place when its project has a deploy
    command, and say whether it did. The caller writes meta.json."""
    if not command_for(meta, config_dir):
        return False
    meta["deploy"] = {"state": "queued", "via": via, "requestedAt": iso_now(clock)}
    return True


def retry(meta, config_dir=None, clock=time.time):
    """Queue a failed deploy again. Returns why it cannot, or None."""
    if not failed(meta):
        return "this run has no failed deploy"
    if not command_for(meta, config_dir):
        return "this project has no deploy command; add one in its Delivery settings"
    request(meta, "retry", config_dir, clock)
    return None


def dismiss(meta, clock=time.time):
    """Mark a failed deploy dismissed in place. Returns why it cannot, or None."""
    if not failed(meta):
        return "this run has no failed deploy"
    if not dismissed(meta):
        meta["deploy"] = {**record(meta), "dismissedAt": iso_now(clock)}
    return None


def project_key(meta):
    repo = meta.get("mainRepoPath") if isinstance(meta, dict) else None
    if not isinstance(repo, str) or not repo.strip():
        return None
    return os.path.realpath(os.path.expanduser(repo))


def target_branch(meta):
    """The branch the run merged into, when its meta names one."""
    transaction = meta.get("mergeMainTransaction")
    for value in ((transaction.get("targetBranch") if isinstance(transaction, dict) else None),
                  meta.get("baseBranch"), meta.get("defaultBranch")):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def deploy_env(base=None):
    """The environment a deploy runs with: Orc's own, less the git state a
    hook may have left, so the login shell's profile decides the rest."""
    env = dict(os.environ if base is None else base)
    for key in list(env):
        if key.startswith("GIT_"):
            env.pop(key)
    return env


def _git(repo, *args, timeout=GIT_TIMEOUT):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True,
                          errors="replace", timeout=timeout, env=deploy_env())


def _last_line(result, fallback):
    lines = [line.strip() for line in (result.stderr or result.stdout or "").splitlines() if line.strip()]
    return lines[-1] if lines else fallback


def prepare_checkout(repo, branch_hint=None, merged_commit=None):
    """Bring the project's checkout level with origin on its default branch
    and return ``(branch, short commit)``. Raises DeployError rather than
    deploy anything but origin's copy of that branch: a checkout on another
    branch, with uncommitted changes to tracked files, with commits origin
    lacks, or without the run's merge commit."""
    if not os.path.isdir(repo):
        raise DeployError("The project's checkout is missing at %s." % repo)
    try:
        current = _git(repo, "symbolic-ref", "--quiet", "--short", "HEAD").stdout.strip()
        branch = branch_hint
        if not branch:
            origin_head = _git(repo, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD").stdout.strip()
            branch = origin_head.split("/", 1)[1] if origin_head.startswith("origin/") else current or "main"
        if current != branch:
            raise DeployError("The project's checkout is on %s, not %s. Switch it back to %s and retry."
                              % (current or "a detached HEAD", branch, branch))
        if _git(repo, "status", "--porcelain", "--untracked-files=no").stdout.strip():
            raise DeployError("The project's checkout has uncommitted changes. Commit or discard them and retry.")
        if _git(repo, "remote", "get-url", "origin").returncode == 0:
            remote = "refs/remotes/origin/%s" % branch
            fetched = _git(repo, "fetch", "--quiet", "origin", "+refs/heads/%s:%s" % (branch, remote))
            if fetched.returncode:
                raise DeployError("Could not fetch origin: %s" % _last_line(fetched, "git fetch failed"))
            head = _git(repo, "rev-parse", "HEAD").stdout.strip()
            behind = _git(repo, "merge-base", "--is-ancestor", head, remote).returncode == 0
            ahead = _git(repo, "merge-base", "--is-ancestor", remote, head).returncode == 0
            if behind and not ahead:
                merged = _git(repo, "merge", "--ff-only", "--quiet", remote)
                if merged.returncode:
                    raise DeployError("Could not bring %s level with origin: %s"
                                      % (branch, _last_line(merged, "git merge failed")))
            elif not behind:
                raise DeployError("%s has commits origin/%s does not. Push or drop them and retry."
                                  % (branch, branch))
        if isinstance(merged_commit, str) and merged_commit.strip() and _git(
                repo, "merge-base", "--is-ancestor", merged_commit.strip(), "HEAD").returncode:
            raise DeployError("%s does not hold this run's merge %s yet." % (branch, merged_commit.strip()[:7]))
        commit = _git(repo, "rev-parse", "--short", "HEAD").stdout.strip()
    except subprocess.TimeoutExpired:
        raise DeployError("git timed out preparing the project's checkout.") from None
    except OSError as exc:
        raise DeployError("Could not run git: %s" % exc) from None
    return branch, commit


# The wrapper outlives orc-ui: it records the command's exit code beside the
# log, so a restart mid-deploy still learns how it ended.
_WRAPPER = '"$0" -lc "$1"; code=$?; printf "%s\\n" "$code" > "$2.tmp" && mv -f "$2.tmp" "$2"'


def login_shell(env):
    shell = env.get("SHELL")
    return shell if shell and os.path.isabs(shell) and os.access(shell, os.X_OK) else "/bin/sh"


def spawn_command(command, cwd, log_path, exit_path, env):
    """Start `command` detached in the user's login shell. Returns the Popen."""
    with open(log_path, "ab") as log:
        return subprocess.Popen(["/bin/sh", "-c", _WRAPPER, login_shell(env), command, exit_path],
                                cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=log,
                                stderr=subprocess.STDOUT, start_new_session=True)


def marker_path(runs_dir, repo):
    """The project's running-deploy marker: beside its merge queue, under the
    same digest, so the queue can hold merges while it deploys."""
    digest = hashlib.sha256(str(merge_queue.repository_path(repo)).encode()).hexdigest()[:16]
    return os.path.join(runs_dir, ".deploy-%s.json" % digest)


def read_marker(path):
    try:
        with open(path) as handle:
            value = json.load(handle)
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def deploying(runs_dir, digest):
    """Whether a deploy is running in the project whose merge queue file is
    `.merge-queue-<digest>.json`. Merges wait for it: they would change the
    checkout under the deploy."""
    marker = read_marker(os.path.join(runs_dir, ".deploy-%s.json" % digest))
    return bool(marker) and _alive(marker.get("pid"))


def _write_marker(path, value):
    tmp = path + ".tmp"
    with open(tmp, "w") as handle:
        json.dump(value, handle)
    os.replace(tmp, path)


def _alive(pid):
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def read_log(path, limit=LOG_VIEW_BYTES):
    """The end of a deploy log, at most `limit` bytes, or ''."""
    try:
        with open(path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - limit))
            data = handle.read()
    except OSError:
        return ""
    text = data.decode("utf-8", "replace")
    if size > limit:
        text = text.split("\n", 1)[-1]
    return text


def log_tail(text, lines=TAIL_LINES):
    kept = [line.rstrip() for line in text.splitlines() if line.strip()]
    return "\n".join(kept[-lines:])


def _file_update(runs_dir):
    """read/write callbacks that work straight on run folders."""
    def read(run_id):
        try:
            with open(os.path.join(runs_dir, run_id, "meta.json")) as handle:
                value = json.load(handle)
        except (OSError, ValueError):
            return None
        return value if isinstance(value, dict) else None

    def write(run_id, meta):
        path = os.path.join(runs_dir, run_id, "meta.json")
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".meta.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as handle:
                json.dump(meta, handle, indent=2)
                handle.write("\n")
            os.replace(tmp, path)
        except OSError:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            return False
        return True
    return read, write


class Runner:
    """Starts and finishes queued deploys, one per project at a time. orc-ui's
    watcher calls `tick` with every run's id; only the instance that owns the
    native app may run one."""

    def __init__(self, runs_dir, config_dir=None, *, read=None, write=None, lock=None,
                 spawn=spawn_command, prepare=prepare_checkout, clock=time.time,
                 timeout=TIMEOUT_SECONDS):
        default_read, default_write = _file_update(runs_dir)
        self.runs_dir = runs_dir
        self.config_dir = config_dir
        self.read = read or default_read
        self.write = write or default_write
        self.lock = lock
        self.spawn = spawn
        self.prepare = prepare
        self.clock = clock
        self.timeout = timeout
        self.children = {}

    def _update(self, run_id, change):
        """Re-read the run's meta, apply `change(meta)` and write it when it
        says so. Under the caller's lock when one was given."""
        def apply():
            meta = self.read(run_id)
            if meta is None or not change(meta):
                return False
            return self.write(run_id, meta)
        if self.lock is None:
            return apply()
        with self.lock:
            return apply()

    def tick(self, run_ids):
        groups = {}
        for run_id in run_ids:
            meta = self.read(run_id)
            current = record(meta)
            key = project_key(meta) if current else None
            if key:
                groups.setdefault(key, []).append((run_id, meta, current))
        for runs in groups.values():
            self._tick_project(runs)

    def _tick_project(self, runs):
        leaders = {run_id for run_id, _meta, current in runs
                   if current["state"] == "running" and not current.get("coveredBy")}
        if leaders:
            for leader in sorted(leaders):
                self._check(leader, runs)
            return
        waiting = [(run_id, meta, current) for run_id, meta, current in runs
                   if current["state"] == "queued"
                   or (current["state"] == "running" and current.get("coveredBy") not in leaders)]
        if waiting:
            self._start(waiting, runs)

    def _start(self, waiting, runs):
        waiting.sort(key=lambda item: (str(item[2].get("requestedAt") or ""), item[0]))
        leader_id, leader_meta, _ = waiting[-1]
        command = command_for(leader_meta, self.config_dir)
        if not command:
            # The command was cleared since: the user deploys by hand again.
            for run_id, _meta, _current in waiting:
                self._update(run_id, lambda meta: meta.pop("deploy", None) is not None)
            return
        started = iso_now(self.clock)
        repo = project_key(leader_meta)
        marker = marker_path(self.runs_dir, repo)
        current = read_marker(marker)
        if current and _alive(current.get("pid")):
            # A deploy is still running: a stale write took its record back to
            # queued. Put the record back rather than start it twice.
            leader = current.get("leader")
            if isinstance(leader, str):
                self._finish_record(leader, {key: current.get(key) for key in
                                             ("state", "command", "branch", "commit", "startedAt", "pid")})
            return
        try:
            with self._merge_lock(repo):
                branch, commit = self.prepare(repo, target_branch(leader_meta), leader_meta.get("mergeCommit"))
                child = self._spawn(leader_id, command, repo, branch, commit, started)
        except DeployError as exc:
            for run_id, _meta, _current in waiting:
                self._finish_record(run_id, {"state": "failed", "command": command, "startedAt": started,
                                             "finishedAt": started, "error": str(exc)})
            return
        self.children[child.pid] = child
        base = {"state": "running", "command": command, "branch": branch, "commit": commit, "startedAt": started}
        self._finish_record(leader_id, dict(base, pid=child.pid))
        for run_id, _meta, _current in waiting[:-1]:
            self._finish_record(run_id, dict(base, coveredBy=leader_id))

    @contextlib.contextmanager
    def _merge_lock(self, repo):
        """orc-merge-main's lock on the project's checkout, held while the
        deploy prepares the checkout and starts, so it never races a merge."""
        path = merge_queue.lock_path(self.runs_dir, repo)
        with open(path, "a+") as handle:
            deadline = time.monotonic() + LOCK_WAIT_SECONDS
            while True:
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise DeployError("A merge into the project's checkout is still running. Retry once it lands.") from None
                    time.sleep(0.1)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def _spawn(self, leader_id, command, repo, branch, commit, started):
        """Start the leader's deploy and mark the project as deploying."""
        run_dir = os.path.join(self.runs_dir, leader_id)
        log_path = os.path.join(run_dir, LOG_NAME)
        exit_path = os.path.join(run_dir, EXIT_NAME)
        try:
            for path in (exit_path, exit_path + ".tmp"):
                if os.path.exists(path):
                    os.unlink(path)
            with open(log_path, "w") as log:
                log.write("$ %s\n# on %s at %s, %s\n\n" % (command, branch, commit, started))
            child = self.spawn(command, repo, log_path, exit_path, deploy_env())
        except OSError as exc:
            raise DeployError("Could not start the deploy: %s" % exc) from None
        try:
            _write_marker(marker_path(self.runs_dir, repo), {
                "leader": leader_id, "pid": child.pid, "state": "running", "command": command,
                "branch": branch, "commit": commit, "startedAt": started})
        except OSError:
            pass
        return child

    def _finish_record(self, run_id, fields):
        """Replace the run's deploy record's outcome fields, keeping why it was
        queued."""
        def change(meta):
            current = record(meta) or {}
            kept = {key: current[key] for key in ("via", "requestedAt") if key in current}
            meta["deploy"] = {**kept, **{key: value for key, value in fields.items() if value is not None}}
            return True
        self._update(run_id, change)

    def _stop(self, pid):
        """Stop a deploy's process group: TERM, then KILL after a grace."""
        try:
            os.killpg(pid, signal.SIGTERM)
        except OSError:
            return
        deadline = time.monotonic() + KILL_GRACE_SECONDS
        child = self.children.get(pid)
        while time.monotonic() < deadline:
            if (child.poll() is not None) if child is not None else not _alive(pid):
                return
            time.sleep(0.1)
        try:
            os.killpg(pid, signal.SIGKILL)
        except OSError:
            pass

    def _exit_code(self, run_dir):
        try:
            with open(os.path.join(run_dir, EXIT_NAME)) as handle:
                return int(handle.read().strip())
        except (OSError, ValueError):
            return None

    def _check(self, leader_id, runs):
        meta = self.read(leader_id)
        current = record(meta)
        if not current or current["state"] != "running" or current.get("coveredBy"):
            return
        run_dir = os.path.join(self.runs_dir, leader_id)
        pid = current.get("pid")
        child = self.children.get(pid)
        if child is not None and child.poll() is not None:
            self.children.pop(pid, None)
        code = self._exit_code(run_dir)
        error = None
        if code is None:
            started = parse_iso(current.get("startedAt"))
            if child is not None and child.returncode is None or child is None and _alive(pid):
                if started is None or self.clock() - started < self.timeout:
                    return
                self._stop(pid)
                error = "The deploy took longer than %d minutes, so Orc stopped it." % (self.timeout // 60)
            else:
                # Reaped with no exit file: the wrapper itself was killed.
                code = self._exit_code(run_dir)
                if code is None:
                    error = "The deploy stopped before it reported how it ended."
        if self.children.pop(pid, None) is not None:
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
        marker = marker_path(self.runs_dir, project_key(meta))
        if (read_marker(marker) or {}).get("pid") == pid:
            try:
                os.unlink(marker)
            except OSError:
                pass
        finished = iso_now(self.clock)
        ok = code == 0 and error is None
        fields = {"state": "deployed" if ok else "failed", "command": current.get("command"),
                  "branch": current.get("branch"), "commit": current.get("commit"),
                  "startedAt": current.get("startedAt"), "finishedAt": finished,
                  "exitCode": code, "error": error}
        self._finish_record(leader_id, fields)
        for run_id, _meta, other in runs:
            if run_id != leader_id and other.get("coveredBy") == leader_id and other["state"] == "running":
                self._finish_record(run_id, dict(fields, coveredBy=leader_id))
        if ok:
            self._clear_earlier_failures(leader_id, current.get("startedAt"), current.get("branch"))

    def _clear_earlier_failures(self, leader_id, started, branch):
        """A deploy that succeeded shipped every earlier merge of its project,
        so their failed deploys stop asking for attention."""
        leader = self.read(leader_id)
        key = project_key(leader)
        try:
            names = [name for name in os.listdir(self.runs_dir) if not name.startswith(".")]
        except OSError:
            return
        for run_id in names:
            if run_id == leader_id:
                continue
            meta = self.read(run_id)
            current = record(meta)
            if (not current or current["state"] != "failed" or project_key(meta) != key
                    or str(current.get("finishedAt") or "") > str(started or "")
                    or (target_branch(meta) or branch) != branch):
                continue

            def change(fresh, leader_id=leader_id):
                now = record(fresh)
                if not now or now["state"] != "failed":
                    return False
                covered = {key: value for key, value in now.items() if key != "dismissedAt"}
                fresh["deploy"] = {**covered, "state": "deployed", "coveredBy": leader_id}
                return True
            self._update(run_id, change)


def view(runs_dir, run_id, meta, titles=None):
    """What the run's Chat card shows, or None when the run has no deploy."""
    current = record(meta)
    if not current:
        return None
    covered = current.get("coveredBy")
    source = covered if isinstance(covered, str) and covered and "/" not in covered else run_id
    log = read_log(os.path.join(runs_dir, source, LOG_NAME)) if current["state"] != "queued" else ""
    out = {key: current.get(key) for key in ("state", "via", "requestedAt", "command", "branch", "commit",
                                             "startedAt", "finishedAt", "exitCode", "error", "dismissedAt")
           if current.get(key) is not None}
    out["log"] = log
    if current["state"] == "failed":
        out["tail"] = current.get("error") or log_tail(log)
    if isinstance(covered, str) and covered:
        out["coveredBy"] = covered
        title = (titles or {}).get(covered)
        if title:
            out["coveredByTitle"] = title
    return out
