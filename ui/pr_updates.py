"""What changed on the pull requests a run opened.

orc-ui's watch loop reads your open PRs from the Pull requests plugin and
compares each one with what the run last saw: a reviewer picking it up,
approving it, asking for changes or commenting, and its Slack post gaining a
reaction. Each change becomes a card in the run's Chat and marks the run as
needing attention until you open it. Kept in the run's ``pr-updates.json``.
"""
from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timezone

from keychain_secrets import _locked, _write_json

UPDATES_FILE = "pr-updates.json"
LOCK_FILE = ".pr-updates.lock"
ITEMS_MAX = 50
REVIEW_RANK = {"waiting": 0, "picked-up": 1, "approved": 2}
# A run that takes no more work on its PR; its saved review state no longer applies.
CLOSED_STATUSES = ("cancelled", "merged", "merged-to-parent")


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read(run_dir):
    try:
        with open(os.path.join(run_dir, UPDATES_FILE)) as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _people(logins):
    """Requested reviewers who are people. A team is asked by CODEOWNERS, so
    its request says nothing about someone picking the PR up."""
    return [login for login in logins or [] if isinstance(login, str) and not login.startswith("team:")]


def review_state(row):
    """How far one PR's review has got. Changes requested on GitHub win over a
    tick in Slack; an approval in either place counts."""
    slack = (row.get("slack") or {}).get("state")
    if row.get("reviewStatus") == "changes_requested":
        return "changes_requested"
    if row.get("reviewStatus") == "approved" or slack == "approved":
        return "approved"
    if _people(row.get("requestedReviewers")) or slack == "picked-up":
        return "picked-up"
    return "waiting"


def facts(row):
    """What a later read is compared against."""
    return {
        "url": row.get("url"),
        "number": row.get("number"),
        "requested": sorted(_people(row.get("requestedReviewers"))),
        "approvedBy": sorted(row.get("approvedBy") or []),
        "changesBy": sorted(row.get("changesRequestedBy") or []),
        "feedback": {item["login"]: item["at"] for item in row.get("feedback") or []},
        "slack": (row.get("slack") or {}).get("state"),
        "slackBy": list((row.get("slack") or {}).get("by") or []),
        "review": review_state(row),
    }


def changes(previous, row, channel=None):
    """The cards one PR earns since ``previous``, oldest first. A reviewer who
    acts twice in one read gets the card for the stronger act."""
    current = facts(row)
    bots = {item["login"] for item in row.get("feedback") or [] if item.get("bot")}
    slack = row.get("slack") or {}
    found, spoken = [], set()

    def add(kind, who=None, at=None, url=None):
        found.append({"kind": kind, "who": who, "bot": who in bots, "at": at,
                      "prUrl": current["url"], "number": current["number"],
                      "url": url or current["url"]})
        spoken.add(who)

    for login in current["approvedBy"]:
        if login not in previous.get("approvedBy", []):
            add("approved", login)
    for login in current["changesBy"]:
        if login not in previous.get("changesBy", []):
            add("changes", login)
    for login, at in current["feedback"].items():
        if login not in spoken and at > previous.get("feedback", {}).get(login, ""):
            add("comment", login, at)
    known = set(previous.get("reviewers", []))
    for login in current["requested"]:
        if login not in known and login not in spoken:
            add("picked-up", login)
    # A Slack reaction's card is only worth showing when GitHub has not
    # already said the same thing.
    before = REVIEW_RANK.get(previous.get("review"), 0)
    rank = REVIEW_RANK.get(current["slack"], 0)
    if rank > REVIEW_RANK.get(previous.get("slack"), 0) and rank > before and not found:
        add("slack-approved" if current["slack"] == "approved" else "slack-picked-up",
            ", ".join(current["slackBy"]) or None, url=slack.get("permalink"))
        found[-1]["channel"] = channel
    current["reviewers"] = sorted(known | set(current["requested"]) | set(current["approvedBy"])
                                  | set(current["changesBy"]) | set(current["feedback"]))
    return current, found


def record(run_dir, rows, channel=None, now=None):
    """Save what the run's open PRs look like now. Returns (changed, cards):
    whether the saved state moved at all, and the new cards. The first read of
    a PR only sets the baseline, so a PR that was already reviewed when Orc
    first saw it does not flood the Chat."""
    now = now or _now()
    with _locked(run_dir, LOCK_FILE):
        data = _read(run_dir)
        saved = data.get("prs") if isinstance(data.get("prs"), dict) else {}
        items = [item for item in data.get("items") or [] if isinstance(item, dict)]
        prs, cards = {}, []
        for row in rows:
            key = "%s#%s" % (row.get("repo"), row.get("number"))
            previous = saved.get(key)
            current, found = changes(previous if isinstance(previous, dict) else {}, row, channel)
            prs[key] = current
            if isinstance(previous, dict):
                cards += found
        for card in cards:
            card.update(id=secrets.token_hex(4), at=card["at"] or now)
        cards.sort(key=lambda card: card["at"])
        if prs == saved and not cards:
            return False, []
        result = {"prs": prs, "items": (items + cards)[-ITEMS_MAX:]}
        if cards or data.get("attentionAt"):
            result["attentionAt"] = now if cards else data["attentionAt"]
        _write_json(os.path.join(run_dir, UPDATES_FILE), result)
        return True, cards


def acknowledge(run_dir):
    """The user has seen the run's cards. Returns whether anything was waiting."""
    if not os.path.exists(os.path.join(run_dir, UPDATES_FILE)):
        return False
    with _locked(run_dir, LOCK_FILE):
        data = _read(run_dir)
        if not data.pop("attentionAt", None):
            return False
        _write_json(os.path.join(run_dir, UPDATES_FILE), data)
        return True


def summary(run_dir, meta):
    """The review state of the run's open PRs for the run list, or None. A
    run with several PRs is approved only when every one is."""
    if meta.get("status") in CLOSED_STATUSES or meta.get("prState") == "closed":
        return None
    if not os.path.exists(os.path.join(run_dir, UPDATES_FILE)):
        return None
    data = _read(run_dir)
    prs = [pr for pr in (data.get("prs") or {}).values() if isinstance(pr, dict)]
    states = [pr.get("review") for pr in prs]
    if not states:
        return None
    if "changes_requested" in states:
        state = "changes_requested"
    elif all(value == "approved" for value in states):
        state = "approved"
    elif any(value in ("picked-up", "approved") for value in states):
        state = "picked-up"
    else:
        state = "waiting"
    # Who got it there: the approvers once approved, else whoever reacted in Slack.
    by = []
    for pr in prs:
        if state == "approved":
            by += pr.get("approvedBy") or []
        if pr.get("slack") == state:
            by += pr.get("slackBy") or []
    result = {"state": state, "attention": bool(data.get("attentionAt"))}
    if by and state in ("picked-up", "approved"):
        result["by"] = list(dict.fromkeys(by))
    return result


def _name(card):
    who = card.get("who") or ""
    return who[:-5] if who.endswith("[bot]") else who


def text(card):
    who, channel = _name(card), card.get("channel")
    place = "#%s" % channel if channel else "Slack"
    return {
        "approved": "%s has approved this" % who,
        "changes": "%s has requested changes" % who,
        "comment": "%s left a %s" % (who, "review" if card.get("bot") else "comment"),
        "picked-up": "%s has picked this up" % who,
        "slack-picked-up": "%s has picked this up in %s" % (who or "Someone", place),
        "slack-approved": "%s has approved this in %s" % (who or "Someone", place),
    }.get(card.get("kind"), "The pull request changed")


def view(run_dir):
    """The run's cards as Chat shows them, oldest first."""
    if not os.path.exists(os.path.join(run_dir, UPDATES_FILE)):
        return []
    return [{"id": card.get("id"), "kind": card.get("kind"), "at": card.get("at"),
             "text": text(card), "url": card.get("url"), "number": card.get("number"),
             "source": "slack" if str(card.get("kind")).startswith("slack-") else "github"}
            for card in _read(run_dir).get("items") or [] if isinstance(card, dict)]
