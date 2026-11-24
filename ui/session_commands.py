"""Acceptance only confirms process start;
it does not confirm that the agent read or processed the prompt.
"""
from dataclasses import dataclass
import os
from pathlib import Path
import re
import signal
import subprocess
from typing import Literal

import claude_accounts
import harness_context
import harnesses
import headless_session
import power_mode
import run_chat
import run_diff
import run_rescue
import run_session


# Matches the chat's "Shell command" bubble: `!!` and a lone `!` stay prose.
SHELL_COMMAND = re.compile(r"!(?!!)\s*(\S[\s\S]*)")
SHELL_TIMEOUT_SECONDS = 120
SHELL_OUTPUT_LIMIT = 30000
# The release this daemon runs from: this file sits in its ui/.
RUNTIME_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


def current_release_args(extra_args):
    """A saved launch embeds the release it started from, such as the
    orc-orchestrator path in an MCP config, and every later turn reuses it.
    Pointing those at the running release means an old run never needs an old
    release kept around, so installs can prune them.

    A preview or dev viewer runs from a checkout whose code is unreviewed and
    whose worktree can be torn down under the run, so it points them at the
    release runtime/current names instead, and leaves them as saved when there
    is none. A checkout path is never written in."""
    runtime = os.path.join(os.path.expanduser("~"), ".orc", "runtime")
    releases = os.path.join(runtime, "releases")
    root = RUNTIME_ROOT
    if os.path.dirname(root) != os.path.realpath(releases):
        root = os.path.realpath(os.path.join(runtime, "current"))
        if os.path.dirname(root) != os.path.realpath(releases) or not os.path.isdir(root):
            return list(extra_args)
    prefix = re.compile(re.escape(releases) + r"/[^/\s\"']+/")
    root = root.rstrip("/") + "/"
    return [prefix.sub(lambda _match: root, arg) for arg in extra_args]


@dataclass(frozen=True)
class Delivery:
    certainty: Literal["accepted", "definitely_unsent", "uncertain"]
    error: tuple[int, str] | None = None
    busy: bool = False


def submit(run_dir: str | os.PathLike[str], text: str) -> Delivery:
    """Start the run's next turn with the user's ``text``."""
    with headless_session.control_lock(os.fspath(run_dir)):
        return _submit(run_dir, text, user_turn=True)


def submit_from_orc(run_dir: str | os.PathLike[str], text: str) -> Delivery:
    """Start the run's next turn with text Orc wrote on its own, such as a
    Ship gate reminder. It carries on the user's last turn, so "Since last
    turn" keeps that turn's baseline."""
    with headless_session.control_lock(os.fspath(run_dir)):
        return _submit(run_dir, text, user_turn=False)


def _submit(run_dir: str | os.PathLike[str], text: str, *, user_turn: bool) -> Delivery:
    run_dir = os.path.normpath(os.fspath(run_dir))
    run_id = os.path.basename(run_dir)
    meta = run_session.RunSessions(os.path.dirname(run_dir)).read(run_id).meta
    launch = headless_session.read_launch(run_dir)
    rescue = meta.get("sessionRescue") or {}
    if rescue.get("state") in ("stopping", "preparing", "failed"):
        return Delivery("definitely_unsent", (409, "session rescue needs attention in Run Control before sending"))
    if not headless_session.is_headless(meta) or not launch:
        return Delivery("definitely_unsent", (500, "this run has no headless session to send to"))
    cwd = next((os.path.expanduser(path)
                for path in (meta.get("repoPath"), meta.get("mainRepoPath"), launch.get("cwd"))
                if isinstance(path, str) and os.path.isdir(os.path.expanduser(path))), None)
    if cwd is None:
        return Delivery("definitely_unsent", (500, "the run's checkout directory is unavailable"))
    agent = launch["agent"]
    module = harnesses.get(agent)
    if agent not in harnesses.CORE_AGENTS and module is None:
        return Delivery("definitely_unsent", (409, harnesses.refusal(agent)))
    try:
        if agent == "claude":
            session_id = meta.get("sessionId")
            resume = bool(session_id and run_chat.claude_transcript(session_id))
        elif module is not None:
            session_id = module.session_id(run_dir)
            resume = bool(session_id)
        else:
            session_id = meta.get("codexThreadId")
            resume = bool(session_id)
        account_env = (claude_accounts.launch_env(launch.get("claudeAccount"))
                       if agent == "claude" and launch.get("claudeAccount") else {})
        extra_args = current_release_args(launch["extraArgs"])
        fork_from = meta.get("forkSessionFrom") if agent == "claude" and not resume else None
        if isinstance(fork_from, str):
            extra_args += ["--resume", fork_from, "--fork-session"]
        argv = headless_session.turn_argv(
            agent, session_id=session_id, resume=resume, cwd=cwd,
            extra_args=extra_args, claude_config_dir=account_env.get("CLAUDE_CONFIG_DIR"),
            run_dir=run_dir)
        env = headless_session.child_env(os.environ, {"ORC_RUN_ID": run_id, **account_env,
                                                      **power_mode.turn_env(run_id)})
        shell = SHELL_COMMAND.fullmatch(text.strip())
        turn_base = None
        if shell:
            # Print mode has no `!` shell, so run it here and hand the agent
            # the result the way an interactive session would.
            state = headless_session.turn_state(run_dir)
            if state and state["state"] == "running":
                raise headless_session.HeadlessBusy()
            if user_turn:
                turn_base = run_diff.capture_turn_base(run_dir, meta)
            text = run_shell(shell.group(1), cwd, env)
        rescue_checkpoint = None
        if not resume and rescue.get("checkpoint"):
            candidate = (Path(run_dir) / str(rescue["checkpoint"])).resolve()
            if not candidate.is_relative_to(Path(run_dir).resolve() / "rescues") or not candidate.is_file():
                raise run_rescue.RescueError("The rescue checkpoint is unavailable.")
            run_rescue.validate_checkpoint(candidate)
            rescue_checkpoint = candidate
        turn_prompt_fn = module.turn_prompt if module is not None else harness_context.turn_prompt
        text = turn_prompt_fn(meta, text, rescue_checkpoint=rescue_checkpoint, run_dir=run_dir)
    except headless_session.HeadlessBusy:
        return Delivery("definitely_unsent", (409, "the agent is still working, so the text was not sent"), busy=True)
    except run_rescue.RescueError as exc:
        return Delivery("definitely_unsent", (409, str(exc)))
    except (headless_session.HeadlessError, OSError, ValueError) as exc:
        return Delivery("definitely_unsent", (500, "could not start the agent's next turn: " + str(exc)))
    try:
        headless_session.start_turn(run_dir, agent=agent, argv=argv, prompt=text, cwd=cwd, env=env,
                                    turn_base=turn_base, user_turn=user_turn)
    except headless_session.HeadlessBusy:
        if shell:
            # The command already ran; a busy retry would run it again.
            return Delivery("uncertain", (409, "the command ran, but the agent started working before it could see the output"))
        return Delivery("definitely_unsent", (409, "the agent is still working, so the text was not sent"), busy=True)
    except (headless_session.HeadlessError, OSError) as exc:
        # A spawned process may read its prompt before state recording fails,
        # so only the runner's pre-spawn error codes allow a safe retry, and
        # never once a command has run.
        certainty = ("definitely_unsent" if not shell and isinstance(exc, headless_session.HeadlessError)
                     and exc.code in ("no_cwd", "spawn_failed") else "uncertain")
        return Delivery(certainty, (500, "could not start the agent's next turn: " + str(exc)))
    return Delivery("accepted")


def run_shell(command, cwd, env):
    """The prompt that hands `command`'s result to the agent, in the format
    Claude Code records for its own `!` shell mode."""
    shell = env.get("SHELL") or "/bin/sh"
    try:
        with subprocess.Popen([shell, "-c", command], cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                              errors="replace", start_new_session=True) as process:
            try:
                stdout, stderr = process.communicate(timeout=SHELL_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                stdout, stderr = process.communicate()
                stderr += "\nTimed out after %d seconds" % SHELL_TIMEOUT_SECONDS
            else:
                if process.returncode:
                    stderr += "\nExit code %d" % process.returncode
    except OSError as exc:
        stdout, stderr = "", "could not run %s: %s" % (shell, exc)
    return ("<bash-input>%s</bash-input>\n<bash-stdout>%s</bash-stdout><bash-stderr>%s</bash-stderr>"
            % (command, stdout[-SHELL_OUTPUT_LIMIT:], stderr[-SHELL_OUTPUT_LIMIT:]))
