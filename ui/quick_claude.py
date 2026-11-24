"""One small, tool-less Claude call for a quick piece of writing.

The run catch-up and the MCP inspector's suggested arguments each ask Claude
Code's fastest model one question and read its reply as text: no tools, no
settings, no MCP servers and no saved session, from an empty folder.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile

import headless_session

MODEL = "haiku"


class QuickError(Exception):
    """Why no reply came back, worded for the person who asked."""


def binary(override_env=None):
    return (override_env and os.environ.get(override_env)) or headless_session.agent_binary("claude")


def ask(request, *, noun, consequence, timeout, override_env=None, run=subprocess.run):
    """Claude's reply to ``request``, stripped. ``noun`` names the reply
    ("catch-up") and ``consequence`` ends a sentence about a missing Claude
    Code ("so the catch-up can't be written")."""
    command = binary(override_env)
    if not shutil.which(command):
        raise QuickError("Claude Code is not installed, %s." % consequence)
    argv = [command, "-p", "--model", MODEL, "--effort", "low", "--tools", "",
            "--setting-sources", "", "--strict-mcp-config", "--no-session-persistence",
            "--output-format", "text"]
    env = headless_session.child_env(os.environ)
    env.pop("ORC_RUN_ID", None)
    with tempfile.TemporaryDirectory(prefix="orc-quick-") as cwd:
        try:
            result = run(argv, input=request, cwd=cwd, env=env, capture_output=True,
                         text=True, timeout=timeout)
        except OSError:
            raise QuickError("Claude Code could not be started, %s." % consequence) from None
        except subprocess.TimeoutExpired:
            raise QuickError("The %s took longer than %d seconds. Try again." % (noun, timeout)) from None
    text = (result.stdout or "").strip()
    if result.returncode or not text:
        raise QuickError("Claude Code returned no %s. Try again." % noun)
    return text
