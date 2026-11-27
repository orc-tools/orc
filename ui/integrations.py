"""Settings' Integrations: what Orc does on its own with Slack, GitHub and
Notion, and how often.

Each service has one switch in ``config.json``'s ``integrations`` object,
on until set to false. Off stops the background checks only: a page on
screen, Ship and anything the user clicks still reach the service.

GitHub is reached through the gh CLI, so every place the server runs gh
names the job it does here with ``note``. The counts live in this process
and reset when Orc restarts. An agent's own gh calls inside a run are the
agent's, not Orc's, and are not counted.

stdlib only, so the server and its tests import it without the plugins.
"""
from __future__ import annotations

import collections
import re
import threading
import time
from datetime import datetime, timedelta, timezone

SERVICES = ("slack", "github", "notion")
HOUR = 3600
DAY = 24 * HOUR
NOTION_TOOL_RE = re.compile(r"notion", re.I)

# Every job the server runs gh for, in the order the card lists them.
# ``switch`` marks the jobs the GitHub switch stops; ``background`` is the
# pace with no page open, when it differs.
GITHUB_JOBS = (
    {"id": "run-prs", "switch": True, "every": "60 s",
     "title": "Checks each run's pull request, deployments and whether it has merged",
     "detail": "At once when an agent's turn ends."},
    {"id": "pr-queue", "switch": True, "every": "60 s", "background": "3 to 5 min in the background",
     "title": "Refreshes your pull requests and review queue",
     "detail": "For the Pull requests screen and the sidebar."},
    {"id": "run-pr-panel", "every": "30 s",
     "title": "Reads the open run's pull request for its panel",
     "detail": "Only while that run is on screen."},
    {"id": "repos", "every": "5 min",
     "title": "Lists your repositories and account",
     "detail": "For Add project and this page."},
    {"id": "backup", "every": "5 min",
     "title": "Backs up your settings to GitHub",
     "detail": "Only once backup is set up in Account & devices."},
    {"id": "actions", "every": "When you click",
     "title": "Does what you ask: posts reviews, merges and clones",
     "detail": "Ship pushes through the agent, not here."},
)
GITHUB_JOB_IDS = frozenset(job["id"] for job in GITHUB_JOBS)

_LOCK = threading.Lock()
_CALLS: dict[str, collections.deque] = collections.defaultdict(collections.deque)
_LAST: dict[str, float] = {}


def note(job: str, count: int = 1, now: float | None = None) -> None:
    """Count ``count`` gh calls for ``job``, one of GITHUB_JOB_IDS."""
    if job not in GITHUB_JOB_IDS:
        raise ValueError("unknown GitHub job %r" % job)
    now = time.time() if now is None else now
    with _LOCK:
        calls = _CALLS[job]
        calls.extend([now] * count)
        while calls and calls[0] <= now - HOUR:
            calls.popleft()
        _LAST[job] = now


def activity(now: float | None = None) -> dict:
    """``{job: {"lastRan": epoch or None, "pastHour": n}}`` for every job."""
    now = time.time() if now is None else now
    with _LOCK:
        found = {}
        for job in GITHUB_JOB_IDS:
            calls = _CALLS.get(job) or ()
            found[job] = {"lastRan": _LAST.get(job),
                          "pastHour": sum(1 for at in calls if at > now - HOUR)}
        return found


def reset() -> None:
    """Forget every count. For tests."""
    with _LOCK:
        _CALLS.clear()
        _LAST.clear()


def enabled(config, service: str) -> bool:
    """Whether ``service``'s background checks may run. Missing means on."""
    if service not in SERVICES:
        raise ValueError("unknown integration %r" % service)
    chosen = config.get("integrations") if isinstance(config, dict) else None
    return not (isinstance(chosen, dict) and chosen.get(service) is False)


def iso(epoch: float | None) -> str | None:
    if epoch is None:
        return None
    return datetime.fromtimestamp(float(epoch), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def github_status(config, login, gh_installed, now=None) -> dict:
    """The GitHub card: who gh is signed in as and every job's calls."""
    counts = activity(now)
    jobs = [{**job, "lastRan": iso(counts[job["id"]]["lastRan"]), "pastHour": counts[job["id"]]["pastHour"]}
            for job in GITHUB_JOBS]
    ui = config.get("ui") if isinstance(config, dict) else None
    return {"enabled": enabled(config, "github"), "installed": bool(gh_installed), "login": login,
            # The older ui.prPoll switch still stops the merge check alone.
            "mergePollOff": isinstance(ui, dict) and ui.get("prPoll") is False,
            "jobs": jobs, "pastHour": sum(job["pastHour"] for job in jobs)}


def slack_status(config, pr_status, redirect_uri=None) -> dict:
    """The Slack card. ``pr_status`` is the Pull requests plugin's saved
    Slack reads and Orc's own Slack sign-in (None while the plugin is off);
    nothing here reads Slack. Signed in or not comes from the sign-in, never
    from a saved read: one made through Claude Code says connected too."""
    found = {"enabled": enabled(config, "slack"), "pluginOn": pr_status is not None, "redirectUri": redirect_uri}
    if pr_status is None:
        return {**found, "state": "plugin-off"}
    channels = pr_status.get("channels") or []
    sign_in = pr_status.get("signIn") or {}
    found.update(onboarded=pr_status.get("onboarded"), useSlack=pr_status.get("useSlack"),
                 mcpUrl=pr_status.get("mcpUrl"), channels=channels, checking=pr_status.get("checking", False),
                 signIn=sign_in, scopes=pr_status.get("scopes") or [], everySeconds=pr_status.get("everySeconds"))
    if not pr_status.get("useSlack"):
        state = "slack-off"
    elif not sign_in.get("signedIn"):
        state = "signed-out"
    elif any(channel.get("connected") is False for channel in channels):
        state = "signed-out"
    elif any(channel.get("error") for channel in channels):
        state = "error"
    elif any(channel.get("connected") is True for channel in channels):
        state = "connected"
    else:
        state = "unread"
    return {**found, "state": state}


def notion_tools(tools) -> list[str]:
    return [tool for tool in tools or () if isinstance(tool, str) and NOTION_TOOL_RE.search(tool)]


def _moment(value):
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def notion_status(config, vaults, now=None) -> dict:
    """The Notion card from each vault's settings and build history.

    ``vaults`` is ``[{"slug", "name", "settings", "history"}]``,
    or None while the Vaults plugin is off. A vault reads Notion when it is
    allowed a Notion tool, so each of its automations is listed."""
    found = {"enabled": enabled(config, "notion"), "pluginOn": vaults is not None, "automations": []}
    if vaults is None:
        return found
    now = datetime.now(timezone.utc) if now is None else datetime.fromtimestamp(now, timezone.utc)
    for vault in vaults:
        if not notion_tools((vault.get("settings") or {}).get("tools")):
            continue
        history = vault.get("history") or []
        for automation in (vault.get("settings") or {}).get("automations") or []:
            runs = sum(1 for entry in history
                       if entry.get("source") == "automation" and entry.get("title") == automation.get("title")
                       and (_moment(entry.get("at")) or now - timedelta(days=2)) > now - timedelta(days=1))
            found["automations"].append({
                "vault": vault["name"], "slug": vault["slug"], "title": automation.get("title"),
                "when": automation.get("label"), "enabled": automation.get("enabled") is not False,
                "lastRan": automation.get("lastRun"), "pastDay": runs})
    found["vaults"] = sum(1 for vault in vaults if notion_tools((vault.get("settings") or {}).get("tools")))
    return found


# Notion's MCP servers as Claude Code names them: the claude.ai connector,
# and the name its own docs give a server the user adds.
NOTION_SERVERS = ("mcp__claude_ai_Notion", "mcp__notion")


def notion_denied(tools, source, config) -> list[str]:
    """Permission rules that refuse every Notion tool to an automation's
    build while the Notion switch is off. A build runs with the user's own
    settings, which may allow a Notion tool the vault never listed, so
    leaving the vault's own out of --allowedTools is not enough."""
    if source != "automation" or enabled(config, "notion"):
        return []
    servers = {"__".join(tool.split("__")[:2]) for tool in notion_tools(tools)
               if tool.startswith("mcp__") and tool.count("__") >= 2}
    return sorted(servers | set(NOTION_SERVERS))


def tools_for_build(tools, source, config) -> list[str]:
    """The tools a vault build may use: an automation's build leaves out
    Notion's while the Notion switch is off. One the user starts keeps them."""
    if source == "automation" and not enabled(config, "notion"):
        return [tool for tool in tools if not NOTION_TOOL_RE.search(tool)]
    return list(tools)
