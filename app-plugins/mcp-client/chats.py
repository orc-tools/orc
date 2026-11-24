"""The agent chats of a throwaway environment.

A chat is one agent, a Claude login or Codex, run as headless turns in the
environment's folder. The agent loads only the environment's MCP servers,
with the headers and sign-in Orc has for each, and none of the person's own:
Claude Code gets them in a private file and reads no settings; Codex gets
them as overrides, with each secret in the turn's environment, and skips its
config.toml. Neither is told how to sign in to a server, and neither needs to.

A chat's turns live beside the environment's folder, never in Orc's runs, so
no chat shows in the sidebar and closing the environment deletes all of it.
The agent may edit files in its folder and call its servers' tools, and
nothing asks first. A server under test is not yet trusted and what it
answers reaches the agent, so Claude Code runs no shell command, and Codex's
shell stays in its sandbox: it writes only to the folder and has no network.
"""
from __future__ import annotations

import contextlib
import json
import os
import re
import secrets
import shutil
import time
import uuid
from pathlib import Path

import agent_accounts
import claude_accounts
import headless_session
import run_chat

from . import servers as store_module

StoreError = store_module.StoreError
AGENTS = ("claude", "codex")
TEXT_LIMIT = 64 * 1024
TITLE_LIMIT = 60
CONFIG_FILE = "mcp.json"
SECRET_ENV = "ORC_MCP_SECRET_%d"


class ChatBusy(StoreError):
    """The chat's agent is still working on its last message."""


def server_names(entries) -> dict:
    """A name each agent accepts for every server, by server id: lower-case
    letters, digits and underscores, and never the same one twice."""
    names, taken = {}, set()
    for entry in entries:
        base = re.sub(r"[^a-z0-9]+", "_", entry["name"].lower()).strip("_")[:40] or "server"
        name, count = base, 1
        while name in taken:
            count += 1
            name = "%s_%d" % (base, count)
        taken.add(name)
        names[entry["id"]] = name
    return names


def claude_argv(binary, session_id, resume, config_path, names):
    allowed = ["--allowedTools", *["mcp__" + name for name in names]] if names else []
    return [binary, "-p", "--output-format", "stream-json", "--verbose",
            "--setting-sources", "", "--strict-mcp-config", "--mcp-config", str(config_path),
            "--permission-mode", "acceptEdits", "--permission-prompts", "none", *allowed,
            "--disallowedTools", "AskUserQuestion", "Bash",
            "--resume" if resume else "--session-id", session_id]


def codex_config(servers) -> tuple[list[str], dict]:
    """Codex ``-c`` overrides for ``servers`` ([(name, url, headers)]) and the
    environment variables that carry their secrets, so none shows in the
    process list."""
    args, env = ["-c", 'sandbox_mode="workspace-write"', "-c", 'approval_policy="never"'], {}
    for name, url, headers in servers:
        prefix = "mcp_servers.%s." % name
        args += ["-c", prefix + "url=" + json.dumps(url),
                 "-c", prefix + 'default_tools_approval_mode="auto"']
        named = {}
        for header, value in headers.items():
            variable = SECRET_ENV % len(env)
            if header.lower() == "authorization" and value.startswith("Bearer "):
                env[variable] = value[len("Bearer "):]
                args += ["-c", prefix + "bearer_token_env_var=" + json.dumps(variable)]
            else:
                env[variable] = value
                named[header] = variable
        if named:
            table = ", ".join("%s = %s" % (json.dumps(header), json.dumps(variable))
                              for header, variable in named.items())
            args += ["-c", prefix + "env_http_headers={%s}" % table]
    return args, env


def codex_argv(binary, thread_id, cwd, config):
    shared = ["--json", "--skip-git-repo-check", "--ignore-user-config", *config]
    if thread_id:
        return [binary, "exec", "resume", *shared, thread_id, "-"]
    return [binary, "exec", *shared, "--cd", str(cwd), "-"]


class Chats:
    """``servers(environment id)`` answers what a turn hands its agent:
    {name, url, headers} for each of the environment's servers, the headers
    being what Orc sends that server now."""

    def __init__(self, context, environments, servers, *, start_turn=headless_session.start_turn, clock=time.time):
        self.context = context
        self.environments = environments
        self.servers = servers
        self.start_turn = start_turn
        self.clock = clock

    # -- what the screen reads --

    def agents(self) -> list[dict]:
        """The agents a chat can run on: each Claude login, then Codex."""
        found = [{"agent": "claude", "account": account, "label": agent_accounts.label("claude", account),
                  "available": headless_session.available("claude")}
                 for account in claude_accounts.available(self.context.get("home"))]
        return found + [{"agent": "codex", "account": None, "label": agent_accounts.label("codex", None),
                         "available": headless_session.available("codex")}]

    def public(self, chat) -> dict:
        return {"id": chat["id"], "agent": chat.get("agent"), "account": chat.get("account"),
                "label": agent_accounts.label(chat.get("agent"), chat.get("account") or claude_accounts.DEFAULT),
                "title": chat.get("title") or "", "startedAt": chat.get("startedAt")}

    def require(self, environment_id, chat_id) -> dict:
        entry = self.environments.require(environment_id)
        chat = next((item for item in entry["chats"] if item["id"] == chat_id), None)
        if chat is None:
            raise StoreError("That chat is no longer in this environment.")
        return chat

    def _meta(self, environment_id, chat) -> dict:
        if chat["agent"] == "claude":
            return {"harness": "claude", "sessionId": chat.get("sessionId")}
        return {"harness": "codex", "codexThreadId": self._thread(environment_id, chat)}

    def _thread(self, environment_id, chat):
        """The Codex thread the chat's first turn started. A turn's log is
        pruned in time, so the id is kept once Codex has reported it."""
        thread = chat.get("threadId")
        if thread:
            return thread
        thread = headless_session.codex_thread_id(str(self.environments.chat_dir(environment_id, chat["id"])))
        if thread:
            with contextlib.suppress(StoreError):
                self.environments.update_chat(environment_id, chat["id"], threadId=thread)
        return thread

    def view(self, environment_id, chat_id, cursor=None) -> dict:
        """The chat's conversation since ``cursor`` and whether its agent is
        working. ``prompt`` is the message the agent is working on, for the
        moment before its transcript shows it."""
        chat = self.require(environment_id, chat_id)
        chat_dir = str(self.environments.chat_dir(environment_id, chat_id))
        payload = run_chat.timeline(self._meta(environment_id, chat), cursor)
        state = headless_session.turn_state(chat_dir) or {}
        working = state.get("state") == "running"
        reply = {"chat": self.public(chat), "items": payload.get("items") or [], "cursor": payload.get("cursor"),
                 "reset": payload.get("reset") is True, "working": working,
                 "error": state.get("error") if state.get("outcome") == "failed" else None}
        if working:
            reply["prompt"] = headless_session.turn_prompt(chat_dir, state.get("turn"))
        return reply

    # -- turns --

    def _text(self, data) -> str:
        text = data.get("text")
        if not isinstance(text, str) or not text.strip():
            raise StoreError("Write a message first.")
        if len(text.encode()) > TEXT_LIMIT:
            raise StoreError("That message is too long to send.")
        return text.strip()

    def _servers(self, environment_id) -> list[tuple]:
        """(name, url, headers) for each of the environment's servers, under
        a name the agent accepts."""
        found = self.servers(environment_id)
        names = server_names(found)
        return [(names[server["id"]], server["url"], server["headers"]) for server in found]

    def _turn(self, environment_id, chat, text) -> None:
        folder = self.environments.ensure_folder(environment_id)
        chat_dir = self.environments.chat_dir(environment_id, chat["id"])
        chat_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        servers = self._servers(environment_id)
        agent = chat["agent"]
        if agent == "claude":
            config_path = chat_dir / CONFIG_FILE
            _write_private(config_path, json.dumps({"mcpServers": {
                name: {"type": "http", "url": url, "headers": headers} for name, url, headers in servers}}))
            session_id = chat["sessionId"]
            argv = claude_argv(headless_session.agent_binary("claude"), session_id,
                               run_chat.claude_transcript(session_id) is not None, config_path,
                               [name for name, _url, _headers in servers])
            extra = claude_accounts.launch_env(chat.get("account") or claude_accounts.DEFAULT)
        else:
            config, extra = codex_config(servers)
            argv = codex_argv(headless_session.agent_binary("codex"), self._thread(environment_id, chat),
                              folder, config)
        try:
            self.start_turn(str(chat_dir), agent=agent, argv=argv, prompt=text, cwd=str(folder),
                            env=headless_session.standalone_env(extra=extra))
        except headless_session.HeadlessBusy:
            raise ChatBusy("The agent is still working. Stop it, or wait for its reply.") from None
        except (headless_session.HeadlessError, OSError) as error:
            raise StoreError("Orc could not start the agent: %s" % error) from None

    def start(self, environment_id, data) -> dict:
        """Starts a chat on one agent with its first message."""
        text = self._text(data)
        agent = data.get("agent")
        account = data.get("account") if agent == "claude" else None
        choice = next((item for item in self.agents()
                       if item["agent"] == agent and item["account"] == (account or item["account"])), None)
        if agent not in AGENTS or choice is None:
            raise StoreError("Pick Claude or Codex for the chat.")
        if not choice["available"]:
            raise StoreError("%s is not installed on this Mac." % choice["label"])
        chat = {"id": secrets.token_hex(4), "agent": agent, "account": choice["account"],
                "title": " ".join(text.split())[:TITLE_LIMIT], "startedAt": self.clock()}
        if agent == "claude":
            chat["sessionId"] = str(uuid.uuid4())
        self.environments.add_chat(environment_id, chat)
        try:
            self._turn(environment_id, chat, text)
        except StoreError:
            # A chat whose first message never started is not one to list.
            self.environments.remove_chat(environment_id, chat["id"])
            raise
        return chat

    def send(self, environment_id, chat_id, data) -> None:
        text = self._text(data)
        self._turn(environment_id, self.require(environment_id, chat_id), text)
        self.environments.touch(environment_id)

    def stop(self, environment_id, chat_id) -> bool:
        self.require(environment_id, chat_id)
        return headless_session.interrupt(str(self.environments.chat_dir(environment_id, chat_id))) != "failed"

    def stop_quietly(self, environment_id, chat_id) -> None:
        with contextlib.suppress(StoreError, OSError):
            headless_session.interrupt(str(self.environments.chat_dir(environment_id, chat_id)))

    def end(self, environment_id, chat) -> None:
        """Stops the chat's agent and deletes the conversation it kept. The
        chat's turns go with the environment's folder."""
        self.stop_quietly(environment_id, chat["id"])
        with contextlib.suppress(OSError):
            if chat.get("agent") == "claude":
                _forget_claude(run_chat.claude_transcript(chat.get("sessionId")))
            else:
                rollout = run_chat.codex_rollout(self._thread(environment_id, chat))
                if rollout is not None:
                    rollout.unlink(missing_ok=True)


def _write_private(path: Path, text: str) -> None:
    """Writes a file only this user can read, replacing it whole."""
    temporary = path.with_name(path.name + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        handle.write(text)
    os.replace(temporary, path)


def _forget_claude(transcript: Path | None) -> None:
    """Deletes a Claude Code session's transcript, what it kept beside it,
    and its project folder once nothing else is in it."""
    if transcript is None:
        return
    transcript.unlink(missing_ok=True)
    shutil.rmtree(transcript.with_suffix(""), ignore_errors=True)
    with contextlib.suppress(OSError):
        transcript.parent.rmdir()
