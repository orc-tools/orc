"""The QA window's server side: one payload for the window, and the actions
its buttons take on a run's QA steps (ui/qa_steps.py).

A command step runs on this computer, in the run's checkout, only when the
person presses Run: its text came from a pull request, which is someone
else's. An MCP step sends one call to the project's main app and to the
run's, and keeps both answers with the differences between them."""
import base64
import json
import os
import re
import shutil
import signal
import subprocess
import threading
import time
from contextlib import ExitStack
from datetime import datetime, timezone
from urllib.parse import urlsplit

import qa_sandbox
import qa_steps
import run_terminal
from keyed_locks import KeyedLocks

OUTPUT_DIR = "qa/output"
SHOTS_DIR = "qa/shots"
TAIL_BYTES = 16 * 1024
MAX_SHOT_BYTES = 8 * 1024 * 1024
MAX_SHOTS_PER_STEP = 6
MAX_BODY_BYTES = 256 * 1024
STOP_GRACE_SECONDS = 5
# A failed step goes to your review of a colleague's pull request, or to your
# own run's agent, never both: which one is the server's call (the run's kind),
# so a colleague's step text never reaches an agent that edits code.
TARGETS = ("review", "agent")
FAILURE_TAIL_LINES = 12
FAILURE_TAIL_CHARS = 2000
MAX_PAGE = 2000
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]")
IMAGE_TYPES = {"image/png": (b"\x89PNG\r\n\x1a\n", "png"), "image/jpeg": (b"\xff\xd8\xff", "jpg")}

# One lock per run: a verdict, a finishing command and a comparison all rewrite
# the same results file.
run_lock = KeyedLocks(threading.RLock)
# The command each step is running now, by (run id, step id). A command is its
# own process group and outlives a server restart, which forgets this table:
# such a command is found again by the pid and start time its result recorded
# (`orphan_alive`), so it still reads as running and Stop still ends it.
_running = {}
_running_guard = threading.Lock()


class ActionError(Exception):
    """A QA action that cannot be taken, as (HTTP status, message)."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def sentence(text):
    """A lower-case reason from elsewhere as a sentence the window shows."""
    text = str(text).strip()
    return text[:1].upper() + text[1:] + ("" if text.endswith((".", "!", "?")) else ".")


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def host_of(url):
    try:
        return urlsplit(url).netloc or None
    except ValueError:
        return None


def clean_output(data):
    """Command output as the window shows it: colour codes gone, carriage
    returns (progress bars) folded to the line they end on."""
    text = ANSI.sub("", data.decode("utf-8", "replace")).replace("\r\n", "\n")
    return "\n".join(line.rsplit("\r", 1)[-1] for line in text.split("\n"))


def output_tail(run_dir, step_id):
    try:
        with open(os.path.join(run_dir, OUTPUT_DIR, step_id + ".log"), "rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - TAIL_BYTES))
            data = handle.read()
    except OSError:
        return ""
    text = clean_output(data)
    if size > TAIL_BYTES:
        # The first line is cut wherever the window began.
        text = text.split("\n", 1)[-1]
    return text.rstrip("\n")


def _step(document, step_id, kind=None, seen=None):
    """The step an action names. `seen` is the hash of the step as the window
    showed it: a step rewritten since then is refused, so Run never starts a
    command the person has not read."""
    for step in (document or {}).get("steps", []):
        if step["id"] == step_id:
            if kind and step["kind"] != kind:
                raise ActionError(400, "Step %s is not a %s step." % (step_id, kind))
            if seen is not None and seen != qa_steps.step_hash(step):
                raise ActionError(409, "This step changed since you opened it. Read it again.")
            return step
    raise ActionError(404, "That step is no longer in this run's QA steps.")


def _change(run_dir, run_id, document, step_id, change, kind=None, seen=None):
    """Applies `change(entry)` to one step's result and saves it."""
    step = _step(document, step_id, kind, seen)
    with run_lock(run_id):
        results = qa_steps.read_results(run_dir)
        change(qa_steps.entry_for(results, step))
        qa_steps.write_results(run_dir, results)
    return step


def set_verdict(run_dir, run_id, document, step_id, verdict, seen=None, page=None):
    """Records pass, fail or nothing. A failure keeps `page`, the app page the
    window was on when you pressed Fail, as a path in the app; any other
    verdict forgets it and where the failure was sent, so failing the step
    again offers it again."""
    if verdict is not None and verdict not in qa_steps.VERDICTS:
        raise ActionError(400, "A verdict is pass, fail or nothing.")

    def change(entry):
        entry["verdict"] = verdict
        entry["checkedAt"] = now_iso() if verdict else None
        if verdict != "fail":
            entry.pop("sent", None)
            entry.pop("page", None)
        elif _page_path(page):
            entry["page"] = page
    _change(run_dir, run_id, document, step_id, change, seen=seen)


def set_note(run_dir, run_id, document, step_id, note, seen=None):
    if not isinstance(note, str) or len(note) > qa_steps.MAX_NOTE:
        raise ActionError(400, "A note is text of at most %d characters." % qa_steps.MAX_NOTE)
    note = note.strip()
    _change(run_dir, run_id, document, step_id, lambda entry: entry.update(note=note or None), seen=seen)


def add_screenshot(run_dir, run_id, document, step_id, image, seen=None):
    """Saves a picture the window took of the app as PNG or JPEG. The name is
    ours and the bytes are checked, so the file can only ever be served as
    the image it is."""
    match = re.fullmatch(r"data:(image/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)", image) \
        if isinstance(image, str) else None
    if not match:
        raise ActionError(400, "A screenshot is a PNG or JPEG image.")
    magic, extension = IMAGE_TYPES[match[1]]
    try:
        data = base64.b64decode(match[2], validate=False)
    except ValueError:
        raise ActionError(400, "The screenshot could not be read.") from None
    if not data.startswith(magic):
        raise ActionError(400, "A screenshot is a PNG or JPEG image.")
    if len(data) > MAX_SHOT_BYTES:
        raise ActionError(413, "The screenshot is larger than 8 MB.")
    step = _step(document, step_id, seen=seen)
    with run_lock(run_id):
        results = qa_steps.read_results(run_dir)
        entry = qa_steps.entry_for(results, step)
        shots = entry.setdefault("shots", [])
        if len(shots) >= MAX_SHOTS_PER_STEP:
            raise ActionError(409, "This step already has %d screenshots. Remove one first." % MAX_SHOTS_PER_STEP)
        folder = os.path.join(run_dir, SHOTS_DIR)
        os.makedirs(folder, exist_ok=True)
        # Numbered across both image types, so a step's pictures keep their order.
        taken = {name.rsplit(".", 1)[0] for name in os.listdir(folder)} | {
            os.path.basename(shot).rsplit(".", 1)[0] for shot in shots}
        number = 1
        while "%s-%d" % (step_id, number) in taken:
            number += 1
        name = "%s-%d.%s" % (step_id, number, extension)
        with open(os.path.join(folder, name), "wb") as handle:
            handle.write(data)
        shots.append("%s/%s" % (SHOTS_DIR, name))
        qa_steps.write_results(run_dir, results)


def remove_screenshot(run_dir, run_id, document, step_id, path):
    step = _step(document, step_id)
    with run_lock(run_id):
        results = qa_steps.read_results(run_dir)
        entry = qa_steps.entry_for(results, step)
        shots = entry.get("shots") or []
        # results.json sits in a folder the run's agent can write, so a path
        # is only ever one this module could have made.
        if path not in shots or not isinstance(path, str) or not qa_steps.SHOT_PATH.fullmatch(path):
            raise ActionError(404, "That screenshot is no longer on this step.")
        shots.remove(path)
        qa_steps.write_results(run_dir, results)
        try:
            os.unlink(os.path.join(run_dir, path))
        except OSError:
            pass


def set_finished(run_dir, run_id, finished):
    with run_lock(run_id):
        results = qa_steps.read_results(run_dir)
        results["finishedAt"] = now_iso() if finished else None
        qa_steps.write_results(run_dir, results)


# ---------- failed steps, sent on ----------

def _page_path(page):
    return isinstance(page, str) and len(page) <= MAX_PAGE and qa_steps.root_relative(page)


def _sent(stored):
    sent = stored.get("sent")
    return sent if isinstance(sent, dict) and sent.get("to") in TARGETS else None


def unsent_failures(document, results):
    """(number, step, stored result) for each failed step not sent yet."""
    found = []
    for number, step in enumerate((document or {}).get("steps", []), 1):
        stored = qa_steps.result_for(results, step)
        if stored.get("verdict") == "fail" and not _sent(stored):
            found.append((number, step, stored))
    return found


def shot_files(run_dir, shots):
    """The screenshots a result names that this module could have made and
    that still sit in the run's qa/shots folder, as full paths. results.json
    is in a folder the run's agent can write, and these get copied and
    uploaded to GitHub, so nothing else is."""
    folder = os.path.realpath(os.path.join(run_dir, SHOTS_DIR))
    found = []
    for path in shots if isinstance(shots, list) else []:
        if not isinstance(path, str) or not qa_steps.SHOT_PATH.fullmatch(path):
            continue
        full = os.path.realpath(os.path.join(run_dir, path))
        if os.path.dirname(full) == folder and os.path.isfile(full) and full not in found:
            found.append(full)
    return found


def failure(run_dir, number, step, stored):
    """What one failed step carries: its words, your note and screenshots, the
    page it failed on, and a command's last lines of output or an MCP call's
    differences."""
    tail = None
    if step["kind"] == "command" and isinstance(stored.get("command"), dict):
        lines = output_tail(run_dir, step["id"]).splitlines()[-FAILURE_TAIL_LINES:]
        tail = "\n".join(lines)[-FAILURE_TAIL_CHARS:] or None
    record = stored.get("mcp") if step["kind"] == "mcp" and isinstance(stored.get("mcp"), dict) else {}
    differences = [item["label"] for item in record.get("differences") or []
                   if isinstance(item, dict) and isinstance(item.get("label"), str)][:qa_steps.MAX_DIFFERENCES + 1]
    page = stored.get("page") if _page_path(stored.get("page")) else (
        step.get("path") if step["kind"] == "page" else None)
    note = stored.get("note") if isinstance(stored.get("note"), str) else ""
    return {"id": step["id"], "number": number, "kind": step["kind"], "title": step["title"],
            "expect": step.get("expect"), "command": step.get("command"),
            "tool": step["mcp"]["tool"] if step["kind"] == "mcp" else None,
            "note": note.strip()[:qa_steps.MAX_NOTE] or None, "page": page, "tail": tail,
            "differences": differences, "shots": shot_files(run_dir, stored.get("shots"))}


def stage_shots(files, target_run_dir):
    """Copies screenshots into a run's attachments folder, the one place a
    drafted review and Chat take pictures from, each as qa-<its name>.
    Returns their paths in that run, as attachments/<name>."""
    root = os.path.realpath(target_run_dir)
    folder = os.path.join(root, "attachments")
    os.makedirs(folder, mode=0o700, exist_ok=True)
    if os.path.realpath(folder) != folder:
        raise ActionError(409, "This run's attachments folder is not one Orc can use.")
    staged = []
    for full in files:
        name = "qa-" + os.path.basename(full)
        target = os.path.join(folder, name)
        if os.path.islink(target):
            raise ActionError(409, "This run's attachments folder is not one Orc can use.")
        shutil.copyfile(full, target)
        staged.append("attachments/" + name)
    return staged


def _code(text):
    """Text as inline code that nothing in it can close."""
    text = str(text).replace("\n", " ")
    longest = max((len(run) for run in re.findall(r"`+", text)), default=0)
    fence = "`" * (longest + 1)
    pad = " " if text.startswith("`") or text.endswith("`") else ""
    return fence + pad + text + pad + fence


def _fenced(text):
    """Lines in a code block that no line of them can close."""
    longest = max((len(run) for run in re.findall(r"`+", text)), default=0)
    fence = "`" * max(3, longest + 1)
    return "%s\n%s\n%s" % (fence, text, fence)


def _evidence(item, saw_label):
    """The lines both a review comment and the agent's message carry about
    one failure, after its title."""
    lines = []
    if item["expect"]:
        lines.append("Expected: %s" % item["expect"])
    if saw_label and item["note"]:
        lines.append("%s: %s" % (saw_label, item["note"]))
    if item["page"]:
        lines.append("Page: %s" % _code(item["page"]))
    if item["kind"] == "command" and item["command"]:
        lines.append("Command: %s" % _code(item["command"]))
    if item["differences"]:
        lines.append("Differences from main: %s" % "; ".join(item["differences"]))
    if item["tail"]:
        lines.append("Last lines of its output:\n%s" % _fenced(item["tail"]))
    return lines


def review_comment(item, images):
    """A failure as a comment in your drafted review: your note first, as if
    you typed it, then what the step expected and where it failed. The step's
    title is the comment's header, which the review prints above it."""
    body = "\n".join([item["note"] or "This didn't work when I tested it.", ""] + _evidence(item, None)).strip()
    return {"id": "qa-" + item["id"], "header": item["title"],
            "finding": "Step %d failed in your QA." % item["number"], "body": body, "images": images}


def agent_message(items, attachments):
    """The failures as one Chat message to the run's agent. `attachments`
    holds each failure's screenshots as full paths, by step id, which Chat
    shows as pictures and the agent can open."""
    count = len(items)
    parts = ["I tested this in the QA window and %s failed. Fix %s, then commit." % (
        "1 step" if count == 1 else "%d steps" % count, "it" if count == 1 else "each one")]
    pictures = []
    for item in items:
        shots = attachments.get(item["id"]) or []
        lines = ["Step %d: %s" % (item["number"], item["title"])] + _evidence(item, "What I saw")
        if shots:
            lines.append("Screenshots: %d, attached below." % len(shots) if len(shots) > 1
                         else "Screenshot: attached below.")
        parts.append("\n".join(lines))
        pictures += ["[Image attachment: %s]" % path for path in shots]
    return "\n\n".join(parts + (["\n".join(pictures)] if pictures else []))


def send_failures(run_dir, run_id, document, shown, to, deliver, commit=None):
    """Sends the failed steps the window showed, `shown` as [{id, hash}], to
    `to`. `deliver(failures)` takes them to your review or the run's agent
    and raises ActionError when it cannot; only after it returns are they
    marked sent, so a failure that did not go is offered again. One the window
    showed that is no longer an unsent failure, or whose words changed, is
    refused: only what you read goes. Returns how many went."""
    if to not in TARGETS:
        raise ActionError(400, "Failures go to your review or to the agent.")
    if not isinstance(shown, list) or not shown or len(shown) > qa_steps.MAX_STEPS:
        raise ActionError(400, "Name the failed steps the window showed.")
    with run_lock(run_id):
        results = qa_steps.read_results(run_dir)
        unsent = {step["id"]: (number, step, stored) for number, step, stored in unsent_failures(document, results)}
        picked = []
        for item in shown:
            found = unsent.get(item.get("id")) if isinstance(item, dict) else None
            if found is None or item.get("hash") != qa_steps.step_hash(found[1]):
                raise ActionError(409, "Your failed steps changed since you looked. Check them again.")
            if found not in picked:
                picked.append(found)
        deliver([failure(run_dir, *found) for found in picked])
        sent = {"to": to, "at": now_iso(), **({"commit": commit} if commit else {})}
        for _number, step, _stored in picked:
            qa_steps.entry_for(results, step)["sent"] = dict(sent)
        qa_steps.write_results(run_dir, results)
    return len(picked)


def retest(run_dir, run_id, document, step_id, seen=None):
    """Clears a failure you sent so the step can be checked again, keeping the
    old result beside it as `previous`."""
    def change(entry):
        if entry.get("verdict") != "fail" or not _sent(entry):
            raise ActionError(409, "Only a failure you sent can be tested again.")
        entry["previous"] = {key: entry.get(key) for key in ("verdict", "note", "checkedAt", "page", "shots", "sent")}
        for key in ("verdict", "note", "checkedAt", "page", "sent"):
            entry.pop(key, None)
        entry["shots"] = []
    _change(run_dir, run_id, document, step_id, change, seen=seen)


def command_running(run_id, step_id):
    with _running_guard:
        return (run_id, step_id) in _running


def orphan_alive(command):
    """Whether a result's recorded command still runs although this server
    did not start it: the same pid, still leading its own process group, and
    started when the result says. The start time is what tells it from another
    process that was later given the same pid."""
    pid = command.get("pid") if isinstance(command, dict) else None
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 1 \
            or command.get("state") not in ("running", "stopping"):
        return False
    try:
        if os.getpgid(pid) != pid:
            return False
        listed = subprocess.run(["ps", "-o", "lstart=", "-p", str(pid)], capture_output=True, text=True,
                                timeout=5, env={**os.environ, "LC_ALL": "C"}).stdout.strip()
        began = datetime.strptime(listed, "%a %b %d %H:%M:%S %Y").astimezone(timezone.utc)
        recorded = datetime.strptime(command.get("startedAt") or "", "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (OSError, ValueError, subprocess.SubprocessError):
        return False
    return abs((began - recorded).total_seconds()) <= 5


def _stored_command(run_dir, step_id):
    """The command record kept for a step id, whatever words the step had
    when it started: rewriting a step must not hide a command still running."""
    stored = qa_steps.read_results(run_dir)["steps"].get(step_id)
    command = stored.get("command") if isinstance(stored, dict) else None
    return command if isinstance(command, dict) else None


def _extract_urls(env, urls=None):
    found = {}
    for source in (env, urls):
        if not isinstance(source, dict):
            continue
        for key in qa_sandbox.URL_ENV_KEYS:
            value = source.get(key)
            if isinstance(value, str) and value:
                found[key] = value
    return found


def run_command(run_dir, run_id, document, step_id, cwd, env=None, seen=None):
    """Starts a command step inside the QA sandbox in the run's checkout.
    Its output goes to a log under the run, and its exit code and duration land
    in the results when it ends."""
    step = _step(document, step_id, "command", seen)
    if not cwd or not os.path.isdir(cwd):
        raise ActionError(409, "This run's checkout is not on this computer.")
    with run_lock(run_id), ExitStack() as rollback:
        if command_running(run_id, step_id) or orphan_alive(_stored_command(run_dir, step_id)):
            raise ActionError(409, "This command is already running.")
        try:
            argv, sandbox_env, cleanup = qa_sandbox.prepare_run(
                step["command"], cwd, urls=_extract_urls(env),
            )
        except qa_sandbox.SandboxError as error:
            raise ActionError(503, str(error)) from None
        rollback.callback(qa_sandbox.cleanup_paths, cleanup)
        folder = os.path.join(run_dir, OUTPUT_DIR)
        os.makedirs(folder, exist_ok=True)
        started, clock = now_iso(), time.monotonic()
        sandbox_meta = {"engine": qa_sandbox.ENGINE_NAME, "network": "localhost", "writes": "scratch-only"}
        with open(os.path.join(folder, step_id + ".log"), "wb") as log:
            try:
                process = subprocess.Popen(argv, cwd=cwd, env=sandbox_env, stdin=subprocess.DEVNULL,
                                           stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            except OSError as error:
                process = None
                log.write(("Could not start: %s\n" % error).encode())
                state = {"state": "failed", "exitCode": None, "startedAt": started, "durationMs": 0, "sandbox": sandbox_meta}
            else:
                rollback.callback(run_terminal.stop_process, process)
                state = {"state": "running", "exitCode": None, "startedAt": started, "durationMs": None,
                         "pid": process.pid, "sandbox": sandbox_meta}
        results = qa_steps.read_results(run_dir)
        qa_steps.entry_for(results, step)["command"] = state
        qa_steps.write_results(run_dir, results)
        if process is not None:
            # The waiter takes ownership only after the running state is on disk.
            with _running_guard:
                _running[(run_id, step_id)] = process
                try:
                    threading.Thread(target=_await_command, name="orc-qa-command", daemon=True,
                                     args=(run_dir, run_id, step_id, process, clock, cleanup)).start()
                except BaseException:
                    del _running[(run_id, step_id)]
                    raise
            rollback.pop_all()


def _await_command(run_dir, run_id, step_id, process, clock, cleanup=()):
    try:
        code = process.wait()
        with run_lock(run_id):
            results = qa_steps.read_results(run_dir)
            stored = results["steps"].get(step_id)
            command = stored.get("command") if isinstance(stored, dict) else None
            # A newer run of the step owns the result now.
            if not isinstance(command, dict) or command.get("pid") != process.pid:
                return
            stopped = command.get("state") == "stopping"
            command.update(state="stopped" if stopped else "done", exitCode=None if stopped else code,
                           durationMs=int((time.monotonic() - clock) * 1000))
            command.pop("pid", None)
            qa_steps.write_results(run_dir, results)
    finally:
        qa_sandbox.cleanup_paths(cleanup)
        # A stopped command's terminal state and scratch cleanup must be
        # visible before a new invocation can take its place.
        with _running_guard:
            if _running.get((run_id, step_id)) is process:
                del _running[(run_id, step_id)]


def run_in_terminal(run_dir, run_id, document, step_id, cwd, urls=None, seen=None):
    """Types a command step into its interactive sandboxed terminal."""
    step = _step(document, step_id, "command", seen)
    if not cwd or not os.path.isdir(cwd):
        raise ActionError(409, "This run's checkout is not on this computer.")
    try:
        qa_sandbox.send_terminal_command(
            run_id, step_id, step["command"], cwd, urls=_extract_urls(None, urls),
        )
    except qa_sandbox.SandboxError as error:
        raise ActionError(503, str(error)) from None


def reset_terminal(run_id, document, step_id):
    """Closes the interactive sandboxed terminal for `step_id` and wipes its scratch dir."""
    _step(document, step_id, "command")
    qa_sandbox.reset_terminal(run_id, step_id)


def stop_command(run_dir, run_id, document, step_id):
    """Ends a running command and everything it started. It goes by the step's
    id alone: a command keeps running, and must stay stoppable, after the
    step it came from is rewritten or the server restarts."""
    _step(document, step_id, "command")
    with run_lock(run_id):
        with _running_guard:
            process = _running.get((run_id, step_id))
        results = qa_steps.read_results(run_dir)
        stored = results["steps"].get(step_id)
        command = stored.get("command") if isinstance(stored, dict) else None
        if process is None or process.poll() is not None:
            if not orphan_alive(command):
                raise ActionError(409, "This command is not running.")
            # No waiter will record how it ends, so this is its ending.
            pid = command.pop("pid")
            command.update(state="stopped", exitCode=None)
            qa_steps.write_results(run_dir, results)
            _signal_pid_group(pid, signal.SIGTERM)
            threading.Timer(STOP_GRACE_SECONDS, _signal_pid_group, (pid, signal.SIGKILL)).start()
            return
        if isinstance(command, dict) and command.get("pid") == process.pid:
            command["state"] = "stopping"
            qa_steps.write_results(run_dir, results)
    _signal_pid_group(process.pid, signal.SIGTERM)

    def finish():
        try:
            process.wait(STOP_GRACE_SECONDS)
        except subprocess.TimeoutExpired:
            _signal_pid_group(process.pid, signal.SIGKILL)
    threading.Thread(target=finish, name="orc-qa-command-stop", daemon=True).start()


def _signal_pid_group(pid, sig):
    try:
        os.killpg(pid, sig)
    except (ProcessLookupError, PermissionError):
        pass


def response_body(reply):
    """The part of a tool's answer worth comparing: its structured content,
    else its one text block read as JSON, else the whole result."""
    result = reply.get("result") if isinstance(reply, dict) else None
    if not isinstance(result, dict):
        return result
    if "structuredContent" in result:
        return result["structuredContent"]
    content = result.get("content")
    if isinstance(content, list) and len(content) == 1 and isinstance(content[0], dict) \
            and content[0].get("type") == "text" and isinstance(content[0].get("text"), str):
        try:
            return json.loads(content[0]["text"])
        except ValueError:
            return content[0]["text"]
    return result


def call_request(step):
    """The JSON-RPC body both servers get, as the window shows it."""
    return {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": step["mcp"]["tool"], "arguments": step["mcp"]["arguments"]}}


def _call_side(act, key, server, step):
    """One side's answer as {label, url, ok, status, ms, error, body}."""
    side = {"label": server["label"], "url": server.get("url"), "ok": False, "status": None,
            "ms": None, "error": server.get("error"), "body": None}
    if side["error"]:
        return side
    started = time.monotonic()
    try:
        status, reply = act(key, {"name": server["name"], "url": server["url"],
                                  "headers": server.get("headers") or {}},
                            {"action": "call", "tool": step["mcp"]["tool"],
                             "arguments": step["mcp"]["arguments"]})
    except Exception as error:  # one side failing must still show the other
        side["error"] = "The call failed: %s" % error
        return side
    side["ms"] = round(reply.get("ms") if isinstance(reply.get("ms"), (int, float))
                       else (time.monotonic() - started) * 1000)
    if status != 200:
        side["status"] = status
        side["error"] = (("Sign in to this server in the MCP client first." if reply.get("auth") else None)
                         or reply.get("error") or "The server did not answer.")
        return side
    side["status"] = 200
    if reply.get("ok") is False:
        error = reply.get("error")
        side["error"] = (error.get("message") if isinstance(error, dict) else None) or "The tool returned an error."
        side["body"] = error
        return side
    side["ok"] = True
    side["body"] = response_body(reply)
    return side


def compare(run_dir, run_id, document, step_id, servers, act, seen=None):
    """Sends the step's call to main and to the run at once and keeps both
    answers. `servers` is {"main": ..., "pr": ...}, each {label, name, url,
    headers} or {label, error} when that side has no server to call."""
    step = _step(document, step_id, "mcp", seen)
    sides = {}

    def call(name):
        sides[name] = _call_side(act, ("qa", run_id, name), servers[name], step)
    threads = [threading.Thread(target=call, args=(name,), name="orc-qa-compare") for name in ("main", "pr")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    both = sides["main"]["ok"] and sides["pr"]["ok"]
    record = {"ranAt": now_iso(), "request": call_request(step),
              "differences": qa_steps.differences(sides["main"]["body"], sides["pr"]["body"]) if both else [],
              "rows": qa_steps.diff_rows(sides["main"]["body"], sides["pr"]["body"])
              if sides["main"]["body"] is not None or sides["pr"]["body"] is not None else []}
    for side in sides.values():
        # The rows carry the text; a huge body is not kept twice.
        if len(json.dumps(side["body"])) > MAX_BODY_BYTES:
            side["body"] = None
            side["truncated"] = True
    record["sides"] = sides
    _change(run_dir, run_id, document, step_id, lambda entry: entry.update(mcp=record), "mcp")


def _command_view(run_dir, run_id, step, stored):
    command = stored.get("command")
    alive = command_running(run_id, step["id"])
    if not isinstance(command, dict):
        # The step was rewritten while its old command still runs: show the
        # one that is running, so it can be stopped.
        command = _stored_command(run_dir, step["id"]) if alive else None
        if command is None:
            return None
    state = command.get("state")
    if state in ("running", "stopping"):
        state = "running" if alive or orphan_alive(command) else "stopped"
    return {"state": state, "exitCode": command.get("exitCode"), "startedAt": command.get("startedAt"),
            "durationMs": command.get("durationMs"), "tail": output_tail(run_dir, step["id"]),
            "logUrl": "/runs/%s/%s/%s.log" % (run_id, OUTPUT_DIR, step["id"]),
            **({"sandbox": command["sandbox"]} if isinstance(command.get("sandbox"), dict) else {})}


def _mcp_view(stored):
    record = stored.get("mcp")
    if not isinstance(record, dict):
        return None
    sides = {name: {key: side.get(key) for key in ("label", "url", "ok", "status", "ms", "error")}
             for name, side in (record.get("sides") or {}).items() if isinstance(side, dict)}
    return {"ranAt": record.get("ranAt"), "request": record.get("request"), "sides": sides,
            "differences": record.get("differences") or [], "rows": record.get("rows") or []}


def _shot_views(run_id, shots):
    return [{"path": path, "url": "/runs/%s/%s" % (run_id, path)}
            for path in shots if isinstance(path, str) and qa_steps.SHOT_PATH.fullmatch(path)] \
        if isinstance(shots, list) else []


def _sent_view(stored, head):
    """Where a failure went, and for one sent to the agent whether the run has
    a new commit since, so it is worth testing again. A checkout whose head is
    unknown, then or now, never offers Retest."""
    sent = _sent(stored)
    if not sent or stored.get("verdict") != "fail":
        return None
    commit = sent.get("commit")
    retest = bool(sent["to"] == "agent" and isinstance(commit, str) and commit
                  and head and head() not in (None, commit))
    return {"to": sent["to"], "at": sent.get("at"), "retest": retest}


def _previous_view(run_id, stored):
    """The result a Retest set aside."""
    previous = stored.get("previous")
    if not isinstance(previous, dict) or previous.get("verdict") not in qa_steps.VERDICTS:
        return None
    note = previous.get("note")
    return {"verdict": previous["verdict"], "note": note if isinstance(note, str) else None,
            "checkedAt": previous.get("checkedAt") if isinstance(previous.get("checkedAt"), str) else None,
            "shots": _shot_views(run_id, previous.get("shots"))}


def payload(run_dir, run_id, document, *, run, app, main, review, writing, mcp_server=None, mcp_hash=None,
            meta=None, delivery=None):
    """Everything the QA window draws. `run`, `app`, `main` and `review` are
    built by the server, which knows the run's project and its servers. A
    page step with no page of its own opens the page in the run's `meta`
    that matches it best (qa_steps.fallback_paths). `delivery` says where
    failed steps go, {target, state, head}: `state` is "open" when they can
    go now, and `head` reads the run's commit for Retest."""
    results = qa_steps.read_results(run_dir)
    head = None
    if delivery and callable(delivery.get("head")):
        read_head, cached = delivery["head"], []

        def head():
            if not cached:
                cached.append(read_head())
            return cached[0]
    steps, checked = [], 0
    root = app.get("url") if app.get("state") == "running" else None
    fallback = qa_steps.fallback_paths((document or {}).get("steps", []), meta or {})
    for number, step in enumerate((document or {}).get("steps", []), 1):
        stored = qa_steps.result_for(results, step)
        view = {"id": step["id"], "number": number, "kind": step["kind"], "title": step["title"],
                "do": step.get("do"), "expect": step.get("expect"), "hash": qa_steps.step_hash(step)}
        if step.get("group") == qa_steps.EDGE:
            view.update(group=qa_steps.EDGE, why=step.get("why"))
        if step["kind"] == "page":
            path = step.get("path") or fallback.get(step["id"])
            view["path"] = path
            view["url"] = root.rstrip("/") + (path or "/") if root else None
        elif step["kind"] == "command":
            view["command"] = step["command"]
            view["sandbox"] = qa_sandbox.step_info(run_id, step["id"])
        else:
            view["mcp"] = {"server": mcp_server, "method": "tools/call", "tool": step["mcp"]["tool"],
                           "arguments": step["mcp"]["arguments"], "request": call_request(step),
                           "openHash": mcp_hash}
        verdict = stored.get("verdict") if stored.get("verdict") in qa_steps.VERDICTS else None
        checked += bool(verdict)
        view["result"] = {
            "verdict": verdict, "note": stored.get("note"), "checkedAt": stored.get("checkedAt"),
            "shots": _shot_views(run_id, stored.get("shots")),
            "command": _command_view(run_dir, run_id, step, stored) if step["kind"] == "command" else None,
            "mcp": _mcp_view(stored) if step["kind"] == "mcp" else None,
            "sent": _sent_view(stored, head), "previous": _previous_view(run_id, stored)}
        steps.append(view)
    failures = None
    if delivery and delivery.get("target") in TARGETS and steps:
        failures = {"target": delivery["target"], "state": delivery.get("state") or "none",
                    "count": len(unsent_failures(document, results))}
    return {"run": run, "app": app, "main": main, "review": review,
            "source": (document or {}).get("source"), "writing": bool(writing and not steps),
            # The pull request's own QA items, which the review has not typed yet.
            "seeded": bool(steps and (document or {}).get("seeded")),
            "steps": steps, "progress": {"checked": checked, "total": len(steps)},
            "finishedAt": results["finishedAt"] if steps else None, "failures": failures}
