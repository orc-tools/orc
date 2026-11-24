"""Agents beside Claude and Codex: the ones built into Orc, and the ones
application packages add.

A built-in agent (``ui/<agent>/harness.json`` and ``harness.py``) is offered
only while its CLI is signed in, which its module's ``signed_in()`` reports.
A package's ``harness`` contribution names a module that core imports only
while the package is enabled. Core's launch lists, labels and tables ask that
module about its agent. Signed out, or with the package off, core neither
offers nor launches the agent, and refuses it with a message saying why.
"""
import sys
import threading
import time
from collections.abc import Mapping
from pathlib import Path

import app_plugins

CORE_AGENTS = app_plugins.CORE_AGENTS
BUILTIN_AGENTS = app_plugins.BUILTIN_AGENTS
BUILTIN_ROOT = Path(__file__).resolve().parent
# How long a sign-in answer stands before a background check refreshes it.
SIGN_IN_SECONDS = 60
# The registry harnesses are read from; None reads the user's own home.
REGISTRY = None
_default = None
_lock = threading.RLock()
_cache = {"key": None, "enabled": {}, "known": {}, "manifests": {}}
_sign_ins = {}
_builtins = {}


def registry():
    global _default
    if REGISTRY is not None:
        return REGISTRY
    if _default is None:
        _default = app_plugins.Registry()
    return _default


def load(root, entry):
    """The harness module at ``root/entry``, imported once per package
    directory, which differs for every revision. It is a package rooted at
    ``root``, so it imports its siblings relatively. Bytecode would make the
    registry refuse the package as local state."""
    return app_plugins.cached_module("orc_harness_", root, entry)


def builtin(agent):
    """A built-in agent's harness module, imported once, or None."""
    if agent not in BUILTIN_AGENTS:
        return None
    with _lock:
        if agent not in _builtins:
            _builtins[agent] = load(BUILTIN_ROOT / agent, "harness.py")
        return _builtins[agent]


def _check_sign_in(agent):
    started = time.monotonic()
    try:
        found = builtin(agent).signed_in()
    except Exception as error:  # a broken check must not take core down
        print("%s sign-in check: %s" % (agent, error), file=sys.stderr)
        found = None
    with _lock:
        previous = _sign_ins.get(agent, {})
        # A background check that began before a newer answer landed (a
        # Check again) leaves that answer alone.
        if previous.get("at", -1.0) > started:
            previous["checking"] = False
            return
        # A check that could not tell keeps the last answer, so a slow
        # keychain never pulls an agent out from under a running turn.
        _sign_ins[agent] = {"value": previous.get("value", False) if found is None else found,
                            "at": started, "checking": False}


def signed_in(agent, refresh=False):
    """Whether a built-in agent's CLI is signed in. The first ask and a
    refresh check now; after that a stale answer is served while a
    background check replaces it."""
    if agent not in BUILTIN_AGENTS:
        return False
    with _lock:
        entry = _sign_ins.get(agent)
        stale = entry is not None and time.monotonic() - entry["at"] >= SIGN_IN_SECONDS
        start = stale and not entry["checking"]
        if start:
            entry["checking"] = True
    if entry is None or refresh:
        _check_sign_in(agent)
    elif start:
        threading.Thread(target=_check_sign_in, args=(agent,), daemon=True).start()
    with _lock:
        return _sign_ins[agent]["value"]


def last_sign_in(agent):
    """The last sign-in answer for a built-in agent, checking nothing; False
    before the first check."""
    with _lock:
        return _sign_ins.get(agent, {}).get("value", False)


def builtin_state():
    """Each built-in agent's manifest with ``signedIn``, as the browser reads
    it from ``window.ORC_BUILTIN_HARNESSES``."""
    return [{**builtin(agent).MANIFEST, "signedIn": signed_in(agent)} for agent in BUILTIN_AGENTS]


def _refresh():
    reg = registry()
    signed = tuple(signed_in(agent) for agent in BUILTIN_AGENTS)
    key = (id(reg), reg.state_key(), signed)
    with _lock:
        if _cache["key"] == key:
            return _cache
        enabled, known, manifests = {}, {}, {}
        for agent, ready in zip(BUILTIN_AGENTS, signed):
            module = builtin(agent)
            known[agent] = (module.MANIFEST["label"], None)
            manifests[agent] = module.MANIFEST
            if ready:
                enabled[agent] = module
        try:
            rows = reg.list()["plugins"]
        except (app_plugins.PluginError, OSError) as error:
            print("application plugins: %s" % error, file=sys.stderr)
            rows = []
        for row in rows:
            harness = row.get("contributes", {}).get("harness")
            # An old release's Gemini package stays installed until the
            # registry retires it; Orc's own Gemini wins.
            if not harness or row["error"] or harness["id"] in BUILTIN_AGENTS:
                continue
            known[harness["id"]] = (harness["label"], row["name"])
            manifests[harness["id"]] = harness
            if row["enabled"]:
                try:
                    enabled[harness["id"]] = load(row["root"], harness["module"])
                except Exception as error:  # a broken package must not take core down
                    print("application plugin %s: %s" % (row["id"], error), file=sys.stderr)
        _cache.update(key=key, enabled=enabled, known=known, manifests=manifests)
        return _cache


def enabled():
    """{agent: harness module} for every signed-in built-in agent and enabled harness package."""
    return dict(_refresh()["enabled"])


def get(agent):
    """The enabled harness module for a plugin agent, or None."""
    return None if agent in CORE_AGENTS else _refresh()["enabled"].get(agent)


def agents():
    return (*CORE_AGENTS, *_refresh()["enabled"])


def known(agent):
    """Whether ``agent`` is core's, built in, or a harness some package offers, offered now or not."""
    return agent in CORE_AGENTS or agent in _refresh()["known"]


def canonical_model(entry):
    """``{"agent", "model"}`` for a saved model choice, with a retired alias
    or an effort-suffixed harness mode replaced by the mode it now names."""
    agent, model = entry.get("agent"), entry.get("model")
    manifest = _refresh()["manifests"].get(agent)
    if manifest and isinstance(model, str):
        levels = manifest.get("effortLevels") or ()
        raw_modes = [mode for mode in (manifest.get("modes") or ()) if isinstance(mode, dict)]
        effort_modes = set(manifest.get("effortModes") or ())
        if model not in {mode.get("id") for mode in raw_modes}:
            for mode in raw_modes:
                base = mode.get("id")
                names = (base, *(mode.get("aliases") or ()))
                suffixed = base in effort_modes and any(
                    model == "%s-%s" % (name, level)
                    for level in mode.get("effortLevels") or levels for name in names)
                if model in names or suffixed:
                    model = base
                    break
    return {"agent": agent, "model": model}


def label(agent):
    return Labels().get(agent, agent)


def manifest(agent):
    """The manifest of a built-in agent or a package's harness, offered now or not, or None."""
    return _refresh()["manifests"].get(agent)


def local_mode(agent, model):
    """(core agent, core model) that a cloud harness's mode runs, or None when
    ``model`` is not one of its modes or runs on no core agent."""
    for mode in (manifest(agent) or {}).get("modes") or ():
        if isinstance(mode, dict) and mode.get("id") == model and mode.get("agent") in CORE_AGENTS:
            return mode["agent"], mode.get("model")
    return None


def refusal(agent):
    """Why core cannot launch ``agent``, or None when it can."""
    if agent in agents():
        return None
    if agent in BUILTIN_AGENTS:
        return builtin(agent).SIGN_IN
    entry = _refresh()["known"].get(agent) if isinstance(agent, str) else None
    if entry:
        return "%s needs the %s plugin. Enable it in Settings → Plugins." % entry
    return "unknown agent"


class Agents:
    """The launchable agents, read each time: core's, then offered harnesses."""

    def __contains__(self, agent):
        return agent in agents()

    def __iter__(self):
        return iter(agents())

    def __len__(self):
        return len(agents())


class Table(Mapping):
    """A per-agent table: core's rows, then each offered harness's
    ``attribute``, so a signed-out or disabled harness has no row."""

    def __init__(self, core, attribute):
        self.core, self.attribute = core, attribute

    def _rows(self):
        return {**self.core, **{agent: getattr(module, self.attribute)
                                for agent, module in _refresh()["enabled"].items()
                                if hasattr(module, self.attribute)}}

    def __getitem__(self, agent):
        return self._rows()[agent]

    def __iter__(self):
        return iter(self._rows())

    def __len__(self):
        return len(self._rows())


class Labels(Mapping):
    """Agent display names: core's, then every built-in or package harness,
    offered now or not, so a signed-out or disabled agent's old runs still name it."""

    def _rows(self):
        return {"claude": "Claude", "codex": "Codex",
                **{agent: entry[0] for agent, entry in _refresh()["known"].items()}}

    def __getitem__(self, agent):
        return self._rows()[agent]

    def __iter__(self):
        return iter(self._rows())

    def __len__(self):
        return len(self._rows())


def supports_orchestration(agent):
    module = get(agent)
    return agent in CORE_AGENTS or (module is not None and hasattr(module, "orchestration_args"))
