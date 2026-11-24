"""What a Claude launch's permission flags become under the person's settings.

Claude Code settings can turn modes off: ``permissions.disableBypassPermissionsMode``
for bypass, and ``disableAutoMode`` (top level or under ``permissions``) for
auto. Orc's headless turns run with ``--permission-prompts none``, so a mode
Claude refuses would quietly turn every approval into a denial. A bypass that
is off runs as auto instead, and as Manual when auto is off too; the run
records the step down so it is never silent.

Every source is read, and any one turning a mode off wins, as in Claude Code:
managed settings and their drop-ins, the account's cached remote settings and
user settings, and the project's shared and local settings. MDM profiles are
not read.
"""
import json
import os
from pathlib import Path
import shutil

DISABLE = "disable"
BYPASS_FLAGS = (["--dangerously-skip-permissions"], ["--permission-mode", "bypassPermissions"])
AUTO_FLAGS = ["--permission-mode", "auto"]
MANAGED_DIRS = (Path("/Library/Application Support/ClaudeCode"), Path("/etc/claude-code"))


def _read(path):
    try:
        with open(path, encoding="utf-8") as handle:
            settings = json.load(handle)
    except (OSError, ValueError):
        return {}
    return settings if isinstance(settings, dict) else {}


def _sources(cwd, config_dir, managed_dirs):
    for directory in managed_dirs:
        yield directory / "managed-settings.json"
        try:
            yield from sorted((directory / "managed-settings.d").glob("*.json"))
        except OSError:
            pass
    home = Path(config_dir or os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    yield home / "remote-settings.json"
    yield home / "settings.json"
    if cwd:
        yield Path(cwd) / ".claude" / "settings.json"
        yield Path(cwd) / ".claude" / "settings.local.json"


def availability(cwd, config_dir=None, managed_dirs=MANAGED_DIRS):
    """{"bypassDisabled": bool, "autoDisabled": bool} across every settings source."""
    bypass_disabled = auto_disabled = False
    for path in _sources(cwd, config_dir, managed_dirs):
        settings = _read(path)
        permissions = settings.get("permissions")
        permissions = permissions if isinstance(permissions, dict) else {}
        bypass_disabled |= permissions.get("disableBypassPermissionsMode") == DISABLE
        auto_disabled |= DISABLE in (settings.get("disableAutoMode"), permissions.get("disableAutoMode"))
    return {"bypassDisabled": bypass_disabled, "autoDisabled": auto_disabled}


def _without(args, flags):
    """args with the first side-by-side run of flags removed, and whether it was there."""
    for i in range(len(args)):
        if args[i:i + len(flags)] == flags:
            return args[:i] + args[i + len(flags):], True
    return args, False


def effective_args(args, cwd, config_dir=None, managed_dirs=MANAGED_DIRS):
    """(args, fallback): the Claude launch flags with any mode the settings turn
    off stepped down, and {"requested", "effective", "reason"} when one was."""
    args = list(args or [])
    rest, requested = args, None
    for flags in BYPASS_FLAGS:
        rest, found = _without(rest, flags)
        requested = requested or ("bypass" if found else None)
    if requested is None:
        rest, found = _without(rest, AUTO_FLAGS)
        requested = "auto" if found else None
    if requested is None:
        return args, None
    available = availability(cwd, config_dir, managed_dirs)
    if requested == "bypass" and available["bypassDisabled"] and not available["autoDisabled"]:
        return AUTO_FLAGS + rest, {"requested": "bypass", "effective": "auto",
                                   "reason": "Claude settings turn off bypass permissions"}
    if (available["bypassDisabled"] or requested == "auto") and available["autoDisabled"]:
        reason = ("Claude settings turn off auto mode" if requested == "auto"
                  else "Claude settings turn off bypass permissions and auto mode")
        return rest, {"requested": requested, "effective": "default", "reason": reason}
    return args, None


# Orc's own run helpers, as {helper: subcommands}. Each one writes only the
# run's folder under ~/.orc/runs, the run's worktree or a local gate, and
# sends nothing off this machine. An empty tuple allows any arguments, so only
# a helper that never runs a supplied command, pushes, posts or merges takes
# one. Delivery helpers (orc-pr, orc-merge-main, orc-pr-replies, orc-pr-review,
# orc-bring-to-main, orc-record-delivery) are never listed: auto mode keeps
# judging them, and Ship stays the user's.
LOCAL_HELPERS = {
    "orc-app-plugin": ("repository-rules", "verification-guides"),
    "orc-browser-failures": ("list", "check", "check-report"),
    # `orc-check run` runs the command it is given, so only the reporting forms.
    "orc-check": ("start", "pass", "fail", "skip"),
    "orc-clarification-done": (),
    "orc-decision": (),
    "orc-delivery-authority": ("ship", "ship-template", "publish", "validate", "freeze-build-spec"),
    "orc-escalate": (),
    "orc-local-review": ("init", "scope", "publish", "close"),
    "orc-manual-step": (),
    "orc-phase-handoff": ("start", "claim", "complete"),
    "orc-plan-lint": (),
    "orc-plan-ready": (),
    "orc-pr-body-lint": (),
    "orc-publish-diagram": (),
    "orc-publish-question": (),
    "orc-qa-steps": ("publish",),
    "orc-record-model": (),
    # Changes only chat_settings.SETTINGS, on this machine, with Undo.
    "orc-setting": ("list", "set"),
    "orc-ship-hold": (),
    "orc-split-children": (),
    "orc-sync-main": (),
    "orc-test-select": (),
    "orc-ticket-evidence": ("validate",),
    "orc-ui": ("open --gate",),
    "orc-validate-shots": (),
    "orc-verification-guides": (),
    # Not start-server: it runs the project's own server command.
    "orc-worktree": ("start-minimal", "add-repo", "resolve", "setup-generic", "setup-devd"),
}
DELIVERY_HELPERS = ("orc-pr", "orc-merge-main", "orc-pr-replies", "orc-pr-review",
                    "orc-bring-to-main", "orc-record-delivery")
DEFAULTS = "$defaults"


def bin_dirs(root, config_dir=None):
    """Every spelling of root's bin directory an agent may type: as given,
    resolved, and through ~/.orc/runtime/current when that names root."""
    root = os.path.abspath(os.fspath(root))
    dirs = [root, os.path.realpath(root)]
    current = os.path.join(config_dir or os.path.expanduser("~/.orc"), "runtime", "current")
    if os.path.realpath(current) == os.path.realpath(root):
        dirs.append(current)
    return [os.path.join(path, "bin") for path in dict.fromkeys(dirs)]


def preferred_bin(root, config_dir=None):
    """The bin path to tell agents: ~/.orc/runtime/current/bin when it names
    root, so the path an agent learned still matches after an update."""
    return bin_dirs(root, config_dir)[-1]


def _invocations():
    """Each allowed helper with its subcommand, as an agent types it."""
    for helper, subcommands in sorted(LOCAL_HELPERS.items()):
        yield from (("%s %s" % (helper, sub)) for sub in subcommands) if subcommands else [helper]


def _orc_on_path(helper, path=None):
    """Whether a bare `helper` runs Orc's own script: PATH has no relative
    entry a `cd` could redirect, and the name resolves into an Orc tree (the
    links install.sh puts in ~/.local/bin)."""
    path = os.environ.get("PATH", "") if path is None else path
    entries = path.split(os.pathsep)
    if any(entry and not os.path.isabs(entry) for entry in entries) or "" in entries:
        return False
    found = shutil.which(helper, path=path)
    if not found:
        return False
    real = Path(os.path.realpath(found))
    return (real.parent.name == "bin" and real.name == helper
            and (real.parent.parent / "skills" / "orc" / "SKILL.md").is_file())


def helper_rules(root, config_dir=None, path=None):
    """Bash allow rules for LOCAL_HELPERS. Claude Code drops wildcarded paths
    in auto mode and matches rules against the literal command, so each
    helper and subcommand gets its own rule: by every absolute spelling of
    root's bin, and by bare name only when that name runs Orc's own script.
    A relative bin/ path could be a repository's own script, so never that."""
    rules = []
    for directory in bin_dirs(root, config_dir):
        rules += ["Bash(%s/%s *)" % (directory, call) for call in _invocations()]
    rules += ["Bash(%s *)" % call for call in _invocations()
              if _orc_on_path(call.split(" ", 1)[0], path)]
    return rules


def auto_mode_settings(args, root, runs_dir=None, config_dir=None):
    """The --settings keys that let a turn in auto mode run Orc's own run
    helpers: allow rules, which Claude Code applies before its classifier,
    and classifier context for the shapes no rule matches (a pipe or a file
    redirect sends the command back to the classifier). {} outside auto."""
    if not any(args[i:i + len(AUTO_FLAGS)] == AUTO_FLAGS for i in range(len(args))):
        return {}
    bin_dir = preferred_bin(root, config_dir)
    names = "; ".join("`%s`" % call for call in _invocations())
    where = " Its run records are local files under %s." % runs_dir if runs_dir else ""
    return {
        "permissions": {"allow": helper_rules(root, config_dir)},
        "autoMode": {
            "environment": [DEFAULTS, (
                "Orc: this session is an Orc run. Orc's own helpers are in %s.%s"
                % (bin_dir, where))],
            "allow": [DEFAULTS, (
                "Orc Run Helpers: Running exactly these Orc helper commands, from %s or by "
                "name, on this session's Orc run is a Local Operation: %s. Other subcommands "
                "of the same helpers are not covered. They write the run's folder, its git worktree and "
                "local Orc gates, and send nothing off this machine. Opening a gate, such as "
                "`orc-delivery-authority ship` or `orc-ui open --gate`, hands the decision to the "
                "user: it is not Unsanctioned Communication or a Destructive or Unwanted Action. "
                "Does NOT cover %s, `orc-check run`, git push, gh pr or any other delivery, "
                "which keep their usual review." % (bin_dir, names, ", ".join(DELIVERY_HELPERS)))],
        },
    }
