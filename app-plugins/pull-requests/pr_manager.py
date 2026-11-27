"""The PR manager page: the viewer's open pull requests and the review
requests waiting on someone, read from GitHub (`gh api graphql`) and from the
team's Slack review channels. Reads change nothing. The three writes each
follow a click on the page: merging a PR, asking GitHub for your own review,
and putting your eyes reaction on a PR's Slack post.

Slack is read through Slack's MCP server with Orc's own sign-in
(slack_link.py): Orc calls the tools itself and no model runs, so a read
costs a few HTTP requests and happens every SLACK_STALE_SECONDS, page open
or not. Until you sign in, Orc never reads Slack on its own: Check now and
the eyes button fall back to a headless Claude Code call that may use only
the one or two Slack tools the job needs. Only the raw tool calls and results
in its stream are parsed; the model's prose is never trusted."""
from __future__ import annotations

import collections
import concurrent.futures
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone

import headless_session
import integrations

from . import slack_link
import local_review
import run_pull_request
from run_pull_request import (
    LINEAR_LINK_RE,
    LINEAR_REF_RE,
    PR_LINK_RE,
    PrManagerError,
    iso,
    key_for_url,
    pr_key,
    review_branch,
    review_where,
    run_review_posts,
    run_ticket,
    runs_linear_workspace,
    runs_ready_to_open,
    safe_web_url,
)

GITHUB_STALE_SECONDS = 60
# The assistant watches all day, page open or not, on the same hourly GraphQL
# budget as the user's own gh.
WATCH_STALE_SECONDS = 300
# How old a channel's read may get, page open or not, once Orc is signed in.
SLACK_STALE_SECONDS = 180
DETAIL_CACHE_SECONDS = 30
REPOS_CACHE_SECONDS = 120
SLACK_TIMEOUT = 120
GITHUB_TIMEOUT = 45
SEARCH_PAGES = 3
LINKED_BATCH = 40
GITHUB_WORKERS = 4
SLACK_WORKERS = 2
SLACK_READ_CALLS = 4
READ_CHANNEL = "mcp__slack__slack_read_channel"
GET_REACTIONS = "mcp__slack__slack_get_reactions"
# The channel read only counts each reaction, so who left one is a call per
# post. Names stay with a post until its reactions change, and one refresh
# asks about at most this many posts.
REACTOR_LOOKUPS = 10
SEARCH_CHANNELS = "mcp__slack__slack_search_channels"
# Slack documents the tool as "Add reactions" without its identifier, so each
# channel read learns the name from the tools Claude Code lists; this is the
# guess until one has.
DEFAULT_REACTION_TOOL = "mcp__slack__slack_add_reaction"
REACTION_TOOL_RE = re.compile(r"mcp__slack__\w*add\w*reaction\w*")
SLACK_CHANNEL_ID_RE = re.compile(r"[CG][A-Z0-9]+")
# Slack channel names: lowercase letters, digits, hyphens, underscores, periods.
SLACK_CHANNEL_NAME_RE = re.compile(r"[a-z0-9][a-z0-9._-]{0,79}")
SLACK_TS_RE = re.compile(r"\d+(?:\.\d+)?")
PICKED_UP_REACTION = "eyes"
SLACK_NOT_CONNECTED = "Slack is not connected in Claude Code. Sign Orc in to Slack in Settings, Integrations."
# The name Claude Code gives a tool of the server it calls "slack".
CLAUDE_TOOL_PREFIX = "mcp__slack__"
# Slack names the emoji in add_reaction's arguments with one of these.
EMOJI_ARGUMENTS = ("emoji_name", "emoji", "name", "reaction")
NEXT_CURSOR_RE = re.compile(r"next_cursor\W{1,4}([A-Za-z0-9=_%-]{4,})")
# A review post this many days old with no picked-up reaction is stale.
STALE_DAYS = 4
DEFAULTS = {
    "useSlack": True,
    "slackChannel": "eng-review-requests",
    "slackChannelId": None,
    "lookbackDays": 14,
    "slackMcpUrl": "https://mcp.slack.com/mcp",
    "pickedUpReactions": ["eyes", "white_check_mark", "heavy_check_mark", "ballot_box_with_check"],
    "linearWorkspace": None,
    "slackWorkspaceUrl": None,
    "githubOrgs": [],
    "repoScope": None,
}
VISIBLE_LISTS = ("now", "waiting", "reviewed", "own", "stale", "team-reviews")
BOARD_COLUMNS = ("repo", "author", "size", "ticket", "checks")
# First match wins, so a PR that is approved but has new feedback or a
# conflict lands in Needs your action; the page shows Ready to merge first.
DEFAULT_SECTIONS = [
    {"id": "needs-action", "title": "Needs your action", "filters": [
        [{"field": "review_status", "operator": "equals", "value": "changes_requested"}],
        [{"field": "feedback", "operator": "is", "value": "new"}],
        [{"field": "check_status", "operator": "is", "value": "failure"}],
        [{"field": "mergeable", "operator": "is", "value": "conflicting"}]]},
    {"id": "ready", "title": "Ready to merge", "filters": [
        [{"field": "review_status", "operator": "equals", "value": "approved"},
         {"field": "pr_status", "operator": "is", "value": "open"}]]},
    {"id": "in-review", "title": "In review", "filters": [
        [{"field": "pr_status", "operator": "is", "value": "open"}]]},
    {"id": "drafts", "title": "Drafts", "filters": [
        [{"field": "pr_status", "operator": "is", "value": "draft"}]]},
]

GITHUB_LOGIN = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})"
GITHUB_LOGIN_RE = re.compile(r"^%s$" % GITHUB_LOGIN)
GITHUB_REPO_RE = re.compile(r"^(%s)/([A-Za-z0-9._-]{1,100})$" % GITHUB_LOGIN)
PR_URL_RE = re.compile(r"https://github\.com/(%s)/([A-Za-z0-9._-]{1,100})/pull/([1-9]\d{0,9})" % GITHUB_LOGIN)
HEADER_RE = re.compile(r"^=== Message from (?P<name>.*?) \((?P<id>[A-Z0-9]+)\) at (?P<when>[^=\n]*?)\s*===[ \t]*$",
                       re.M)
TS_RE = re.compile(r"^Message TS:\s*(\d+(?:\.\d+)?)\s*$", re.M)
REACTIONS_RE = re.compile(r"^Reactions:\s*(.*)$", re.M)
REACTION_RE = re.compile(r"([\w+:'-]+) \((\d+)\)")
# get_reactions reads ":eyes: \u00d7 2 \u2014 Juan (U01), Kim (U02)".
REACTORS_LINE_RE = re.compile(r"^:([\w+'-]+):\s*\u00d7\s*\d+\s*\u2014\s*(.+)$", re.M)
REACTOR_RE = re.compile(r"\s*([^,]+?)\s*\(([UW][A-Z0-9]+)\)")
# Slack's read_channel quotes each line of a message body ("> *Forest:* <url|title>"),
# and older results did not; one leading "> " is stripped so both read the same.
QUOTE_PREFIX_RE = re.compile(r"^> ?", re.M)
TAG_RE = re.compile(r"^\s*(?:\*(?P<starred>[A-Za-z][\w &'-]{0,29}?)(?:\*:|:\*)|(?P<plain>[A-Za-z][\w&'-]{0,29}):)(?=\s|$)")
CHANNEL_RE = re.compile(r"Channel:\s*#?([\w.-]+)\s*\(([CG][A-Z0-9]+)\)")
SLACK_DOMAIN_RE = re.compile(r"https://([a-z0-9-]+\.slack\.com)/archives/")
TITLE_REF_RE = re.compile(r"^\s*\[?([A-Za-z]{2,10}-\d{1,6})\]?(?=\s*[|:\-\]\s])")
GITHUB_REMOTE_RE = re.compile(
    r"(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([\w.-]+/[\w.-]+?)(?:\.git)?/?")
HOOK_GIT_ENV = ("GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE",
                "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES")
STATE_RANK = {"waiting": 0, "picked-up": 1, "approved": 2}

PR_FIELDS = """
  number title url state isDraft createdAt updatedAt headRefName headRefOid baseRefName
  repository { nameWithOwner owner { avatarUrl(size: 64) } }
  author { login avatarUrl(size: 64) __typename }
  additions deletions mergeable body
  comments { totalCount }
  labels(first: 10) { nodes { name color } }
  reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug } } } }
  reviews(last: 100) { nodes { author { login __typename } state submittedAt } }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
"""
REPLY_FIELDS = """
  recentComments: comments(last: 30) { nodes { author { login } createdAt } }
"""
# Feedback on your own PRs since the last push: review threads and comments,
# with each author's type so Zerohands and other bot reviewers are known. A
# reply in an older thread still shows as a COMMENTED review in `reviews`.
# Zerohands posts a COMMENTED review on a clean pass too, so each reviewer's
# newest review carries its text. latestReviews keeps one per reviewer, so
# your replies and approvals after a pass cannot push it out, as they would
# from the last few of anyone's reviews.
FEEDBACK_FIELDS = """
  recentComments: comments(last: 30) { nodes { author { login __typename } createdAt } }
  reviewThreads(last: 20) { nodes { comments(last: 10) { nodes { author { login __typename } createdAt } } } }
  reviewBodies: latestReviews(last: 20) { nodes { author { login __typename } submittedAt bodyText } }
"""
ZEROHANDS_PASS = "\u2705 Looks good to merge"
REREQUEST_FIELDS = """
  reRequests: timelineItems(last: 20, itemTypes: [REVIEW_REQUESTED_EVENT]) { nodes {
    ... on ReviewRequestedEvent { createdAt requestedReviewer { __typename ... on User { login } } } } }
"""
SEARCH_TEMPLATE = """query($q: String!, $after: String) {
  viewer { login }
  search(query: $q, type: ISSUE, first: %(first)d, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { %(fields)s } }
  }
}"""
SEARCH_QUERY = SEARCH_TEMPLATE % {"first": 100, "fields": PR_FIELDS}
# GitHub charges a search for every nested node it could return, so the
# review threads under each PR set the cost: 50 PRs a page with their last 20
# threads costs 14 points, against 27 at 100 a page.
MINE_QUERY = SEARCH_TEMPLATE % {"first": 50, "fields": PR_FIELDS + FEEDBACK_FIELDS}
REVIEWED_QUERY = SEARCH_TEMPLATE % {"first": 100, "fields": PR_FIELDS + REPLY_FIELDS + REREQUEST_FIELDS}
TIMELINE_TYPES = ("ISSUE_COMMENT, PULL_REQUEST_REVIEW, PULL_REQUEST_COMMIT, MERGED_EVENT, CLOSED_EVENT, "
                  "REOPENED_EVENT, READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, REVIEW_REQUESTED_EVENT, "
                  "HEAD_REF_FORCE_PUSHED_EVENT")
ACTOR = "{ login avatarUrl(size: 80) __typename }"
TIMELINE_NODE = """__typename
          ... on IssueComment { id author %(a)s createdAt url bodyHTML isMinimized minimizedReason }
          ... on PullRequestReview { id author %(a)s state submittedAt createdAt url bodyHTML }
          ... on PullRequestCommit { id url commit { oid abbreviatedOid messageHeadline committedDate
            author { name user { login } } } }
          ... on MergedEvent { id actor %(a)s createdAt mergeRefName commit { abbreviatedOid } }
          ... on ClosedEvent { id actor %(a)s createdAt }
          ... on ReopenedEvent { id actor %(a)s createdAt }
          ... on ReadyForReviewEvent { id actor %(a)s createdAt }
          ... on ConvertToDraftEvent { id actor %(a)s createdAt }
          ... on ReviewRequestedEvent { id actor %(a)s createdAt
            requestedReviewer { __typename ... on User { login } ... on Team { slug } ... on Bot { login } } }
          ... on HeadRefForcePushedEvent { id actor %(a)s createdAt
            beforeCommit { abbreviatedOid } afterCommit { abbreviatedOid } }""" % {"a": ACTOR}
CONVERSATION_FIELDS = """
      timelineHead: timelineItems(first: 50, itemTypes: [%(types)s]) {
        totalCount nodes { %(node)s }
      }
      timelineTail: timelineItems(last: 50, itemTypes: [%(types)s]) { nodes { %(node)s } }
      reviewThreads(first: 100) { nodes { id isResolved isOutdated path line originalLine
        resolvedBy { login }
        comments(first: 50) { nodes { id author %(a)s createdAt url bodyHTML diffHunk isMinimized
          minimizedReason pullRequestReview { id } } } } }
""" % {"types": TIMELINE_TYPES, "node": TIMELINE_NODE, "a": ACTOR}
DETAIL_QUERY = """query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    viewerDefaultMergeMethod
    pullRequest(number: $number) {
      %s
      id bodyHTML changedFiles
      commitCount: commits { totalCount }
      checkRollup: commits(last: 1) { nodes { commit { statusCheckRollup { state
        contexts(first: 100) { nodes { __typename
          ... on CheckRun { name conclusion status detailsUrl }
          ... on StatusContext { context state targetUrl } } } } } } }
      %s
    }
  }
}""" % (PR_FIELDS, CONVERSATION_FIELDS)
MERGE_MUTATION = """mutation($id: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!) {
  mergePullRequest(input: {pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $head}) {
    pullRequest { state }
  }
}"""
REPOS_QUERY = """query {
  viewer {
    login
    organizations(first: 100) {
      nodes { login }
    }
    repositories(first: 100, ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], isArchived: false, orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes { nameWithOwner isArchived }
    }
    repositoriesContributedTo(first: 100, contributionTypes: [COMMIT, PULL_REQUEST, PULL_REQUEST_REVIEW], includeUserRepositories: true, orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes { nameWithOwner isArchived }
    }
  }
}"""
REPO_SEARCH_QUERY = """query($q: String!) {
  search(query: $q, type: REPOSITORY, first: 30) {
    nodes { ... on Repository { nameWithOwner isArchived } }
  }
}"""
VIEWER_ID_QUERY = "query { viewer { id login } }"
REQUEST_REVIEW_MUTATION = """mutation($id: ID!, $user: ID!) {
  requestReviews(input: {pullRequestId: $id, userIds: [$user], union: true}) {
    pullRequest { id }
  }
}"""
MERGE_METHODS = ("MERGE", "SQUASH", "REBASE")


class SourceError(Exception):
    pass


class SlackNotConnected(SourceError):
    def __init__(self, message=SLACK_NOT_CONNECTED):
        super().__init__(message)


def in_orgs(repo, orgs):
    return not orgs or repo.split("#", 1)[0].split("/", 1)[0].lower() in {org.lower() for org in orgs}


def validate_repo_scope(value):
    """Canonical repoScope dict (`mode`: `'all'` | `'selected'`), or raises PrManagerError(400)."""
    if not isinstance(value, dict):
        raise PrManagerError(400, "Expected a repository scope object.")
    mode = value.get("mode")
    if mode == "all":
        return {"mode": "all", "orgs": [], "repos": []}
    if mode != "selected":
        raise PrManagerError(400, "Choose All repositories or selected organizations and repositories.")
    raw_orgs = value.get("orgs", [])
    raw_repos = value.get("repos", [])
    if not isinstance(raw_orgs, list) or not isinstance(raw_repos, list):
        raise PrManagerError(400, "orgs and repos must be lists.")
    orgs, seen_orgs = [], set()
    for item in raw_orgs:
        if not isinstance(item, str) or not GITHUB_LOGIN_RE.fullmatch(item.strip()):
            raise PrManagerError(400, "Invalid GitHub organization or owner: %r." % item)
        clean = item.strip()
        if clean.lower() not in seen_orgs:
            seen_orgs.add(clean.lower())
            orgs.append(clean)
    repos, seen_repos = [], set()
    for item in raw_repos:
        if not isinstance(item, str) or not GITHUB_REPO_RE.fullmatch(item.strip()):
            raise PrManagerError(400, "Invalid GitHub repository: %r." % item)
        clean = item.strip()
        owner = clean.split("/", 1)[0].lower()
        if owner in seen_orgs or clean.lower() in seen_repos:
            continue
        seen_repos.add(clean.lower())
        repos.append(clean)
    if not orgs and not repos:
        raise PrManagerError(400, "Select at least one organization or repository, or choose All repositories.")
    return {"mode": "selected", "orgs": orgs, "repos": repos}


def normalize_repo_scope(value):
    try:
        return validate_repo_scope(value)
    except PrManagerError:
        return None


def in_scope(repo_or_key, scope):
    if scope is None or scope.get("mode") == "all":
        return True
    target = (repo_or_key or "").split("#", 1)[0]
    owner = target.split("/", 1)[0].lower()
    if owner in {org.lower() for org in scope.get("orgs") or ()}:
        return True
    return target.lower() in {repo.lower() for repo in scope.get("repos") or ()}


def _effective_scope(opts):
    """Saved repoScope overrides legacy githubOrgs; unset scope falls back for direct unit helpers."""
    scope = opts.get("repoScope")
    if scope is not None:
        return scope
    orgs = opts.get("githubOrgs") or []
    return {"mode": "selected", "orgs": list(orgs), "repos": []} if orgs else {"mode": "all", "orgs": [], "repos": []}


def normalize_slack_channel(value):
    channel = value.strip().lstrip("#").lower() if isinstance(value, str) else ""
    return channel if SLACK_CHANNEL_NAME_RE.fullmatch(channel) else None


def validate_choices(value, field, allowed=None, required=False):
    if not isinstance(value, list) or (required and not value):
        raise PrManagerError(400, "%s must be %slist." % (field, "a non-empty " if required else "a "))
    choices = []
    for item in value:
        if allowed is None:
            item = normalize_slack_channel(item)
            if item is None:
                raise PrManagerError(400, "%s must contain Slack channel names, such as review-requests." % field)
        elif item not in allowed:
            raise PrManagerError(400, "Unknown %s option: %r." % (field, item))
        choices.append(item)
    return list(dict.fromkeys(choices))


BOARD_CHOICES = {
    "visibleLists": (VISIBLE_LISTS, True),
    "columns": (BOARD_COLUMNS, False),
    "slackChannels": (None, False),
}


def settings(config):
    raw = config.get("prManager") if isinstance(config, dict) else None
    raw = raw if isinstance(raw, dict) else {}
    result = dict(DEFAULTS)
    for key in ("slackChannel", "slackChannelId", "slackMcpUrl", "linearWorkspace", "slackWorkspaceUrl"):
        value = raw.get(key)
        if isinstance(value, str) and value.strip():
            result[key] = value.strip()
    result["slackChannel"] = result["slackChannel"].lstrip("#")
    for field, (allowed, required) in BOARD_CHOICES.items():
        try:
            result[field] = validate_choices(raw[field], field, allowed, required)
        except (KeyError, PrManagerError):
            result[field] = list(allowed) if allowed is not None else [result["slackChannel"]]
    if result["slackChannels"] and result["slackChannels"][0] != result["slackChannel"]:
        result["slackChannel"] = result["slackChannels"][0]
        result["slackChannelId"] = None
    if type(raw.get("useSlack")) is bool:
        result["useSlack"] = raw["useSlack"]
    days = raw.get("lookbackDays")
    if type(days) is int and 1 <= days <= 90:
        result["lookbackDays"] = days
    reactions = raw.get("pickedUpReactions")
    if isinstance(reactions, list) and reactions and all(isinstance(r, str) and r for r in reactions):
        result["pickedUpReactions"] = [r.strip(":") for r in reactions]
    orgs = raw.get("githubOrgs")
    if isinstance(orgs, list) and all(isinstance(o, str) and re.fullmatch(GITHUB_LOGIN, o) for o in orgs):
        result["githubOrgs"] = orgs
    result["repoScope"] = normalize_repo_scope(raw.get("repoScope"))
    result["sections"] = raw.get("sections")
    return result


def clean_env():
    env = {k: v for k, v in os.environ.items() if k not in HOOK_GIT_ENV}
    env.update(GH_PROMPT_DISABLED="1", GIT_TERMINAL_PROMPT="0", NO_COLOR="1")
    return env


def normalize_tag(tag):
    tag = tag.strip()
    return "All" if tag.lower() == "all" else tag


def slack_time(when):
    match = re.fullmatch(r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\s*(\w+)?", when.strip())
    if not match:
        return None
    offset = {"BST": 3600, "CEST": 7200, "CET": 3600}.get((match[2] or "").upper(), 0)
    moment = datetime.strptime(match[1], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    return moment.timestamp() - offset


def _message_blocks(text):
    """(header, body) for each message in Slack's read_channel text, with
    bump reminders and join notices dropped."""
    text = text.replace("\\/", "/")
    headers = list(HEADER_RE.finditer(text))
    for index, header in enumerate(headers):
        end = headers[index + 1].start() if index + 1 < len(headers) else len(text)
        block = QUOTE_PREFIX_RE.sub("", text[header.end():end])
        if ":mr-bump:" not in block and "has joined the channel" not in block:
            yield header, block


def links_pull_requests(text):
    """Whether a read_channel result has a message that links a pull request.
    When no message header is recognised, any pull request link counts, so a
    changed header format is noticed too."""
    text = text.replace("\\/", "/")
    if not HEADER_RE.search(text):
        return bool(PR_LINK_RE.search(text))
    return any(PR_LINK_RE.search(block) for _header, block in _message_blocks(text))


def unread_warning(texts, posts, channel):
    """The error to show when Slack returned messages linking pull requests
    but none was read as a tagged review request, which is how a change to
    Slack's message format shows up."""
    if posts or not any(links_pull_requests(text) for text in texts):
        return None
    return ("Messages in #%s link pull requests, but Orc could read none of them as a review request. "
            "Slack may have changed its message format; Orc reads posts tagged like *Forest:* <link>." % channel)


def parse_messages(text):
    """Posts that link at least one tagged pull request, in Slack's
    read_channel text format. Bump reminders and join notices are dropped."""
    posts = []
    for header, block in _message_blocks(text):
        ts_match = TS_RE.search(block)
        ts = ts_match[1] if ts_match else None
        epoch = float(ts) if ts else slack_time(header["when"])
        links, seen, current_tag = [], set(), None
        for line in block.splitlines():
            if line.startswith(("Message TS:", "Reactions:", "Thread:")):
                continue
            tag_match = TAG_RE.match(line)
            if tag_match:
                current_tag = normalize_tag(tag_match["starred"] or tag_match["plain"])
            for link in PR_LINK_RE.finditer(line):
                key = pr_key(link[1] + "/" + link[2], link[3])
                if current_tag and key not in seen:
                    seen.add(key)
                    links.append({"url": "https://github.com/%s/%s/pull/%d" % (link[1], link[2], int(link[3])),
                                  "key": key, "tag": current_tag})
        if not links or epoch is None:
            continue
        reactions = []
        reaction_line = REACTIONS_RE.search(block)
        if reaction_line:
            reactions = [{"name": name.strip(":"), "count": int(count)}
                         for name, count in REACTION_RE.findall(reaction_line[1])]
        name, user_id = header["name"].strip(), header["id"]
        posts.append({"ts": ts, "epoch": epoch, "postedBy": name, "userId": user_id,
                      "bot": user_id.startswith("B") or "(via " in name,
                      "links": links, "reactions": reactions})
    return posts


def _tool_result_texts(content):
    if isinstance(content, str):
        return [content]
    if isinstance(content, list):
        return [item.get("text") for item in content
                if isinstance(item, dict) and isinstance(item.get("text"), str)]
    return []


def _stream_events(output):
    for line in output.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if isinstance(event, dict):
            yield event


def _slack_connected(init_event):
    servers = init_event.get("mcp_servers") or []
    slack = next((s for s in servers if isinstance(s, dict) and s.get("name") == "slack"), None)
    return bool(slack and slack.get("status") == "connected")


def _content_items(event):
    message = event.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    return [item for item in content if isinstance(item, dict)] if isinstance(content, list) else []


def parse_stream(output, channel_name=None, channel_id=None):
    """The Slack facts in a `claude -p --output-format stream-json` stream:
    whether Slack was connected, the channel read, and every read_channel
    result's message text."""
    found = new_found(channel_id)
    reads = {}
    for event in _stream_events(output):
        if event.get("type") == "system" and event.get("subtype") == "init":
            found["connected"] = _slack_connected(event)
            found["reactionTool"] = next((tool for tool in event.get("tools") or []
                                          if isinstance(tool, str) and REACTION_TOOL_RE.fullmatch(tool)), None)
            continue
        for item in _content_items(event):
            if event.get("type") == "assistant" and item.get("type") == "tool_use" \
                    and item.get("name") == READ_CHANNEL:
                inputs = item.get("input")
                target = inputs.get("channel_id") if isinstance(inputs, dict) else None
                reads[item.get("id")] = target if isinstance(target, str) and SLACK_CHANNEL_ID_RE.fullmatch(target) else None
            elif event.get("type") == "user" and item.get("type") == "tool_result" \
                    and item.get("tool_use_id") in reads:
                for text in _tool_result_texts(item.get("content")):
                    if item.get("is_error"):
                        found["toolErrors"].append(text)
                    else:
                        take_read(found, text, reads[item["tool_use_id"]], channel_name)
    return found


def new_found(channel_id=None, connected=None):
    return {"connected": connected, "channelId": channel_id, "messages": [], "domains": [],
            "readCalls": 0, "toolErrors": [], "reactionTool": None}


def take_read(found, text, target, channel_name):
    """Add one read_channel result to `found`, unless it is another channel's.
    Returns the result's next page cursor, or None."""
    try:
        payload = json.loads(text)
    except ValueError:
        payload = None
    messages = payload.get("messages") if isinstance(payload, dict) else text
    header = CHANNEL_RE.match(messages.lstrip()) if isinstance(messages, str) else None
    reported_id = header[2] if header else target
    if (header and ((target and target != reported_id) or
                    (channel_name and header[1].lower() != channel_name.lower())) or
            (found["channelId"] and found["channelId"] != reported_id)):
        return None
    found["channelId"] = reported_id
    found["readCalls"] += 1
    if isinstance(messages, str):
        found["domains"] += SLACK_DOMAIN_RE.findall(messages.replace("\\/", "/"))
        found["messages"].append(messages)
    pages = payload.get("pagination_info") if isinstance(payload, dict) else None
    if isinstance(pages, dict):
        cursor = pages.get("next_cursor")
        return cursor if isinstance(cursor, str) and cursor else None
    match = NEXT_CURSOR_RE.search(pages) if isinstance(pages, str) else None
    return match[1] if match else None


def server_tool(tool):
    """Slack's own name for a tool Claude Code calls `tool`."""
    return tool[len(CLAUDE_TOOL_PREFIX):] if tool.startswith(CLAUDE_TOOL_PREFIX) else tool


def _schema_names(tool):
    schema = tool.get("inputSchema") if isinstance(tool, dict) else None
    properties = schema.get("properties") if isinstance(schema, dict) else None
    return list(properties) if isinstance(properties, dict) else []


def _direct(call):
    """Run one direct Slack step, as the errors the readers already handle."""
    try:
        return call()
    except slack_link.NotSignedIn as error:
        raise SlackNotConnected(str(error)) from None
    except slack_link.SlackError as error:
        raise SourceError(str(error)) from None


def direct_channel_id(link, opts, tools):
    """The ID of #slackChannel, from Slack's channel search."""
    name = opts["slackChannel"]
    tool = tools.get(server_tool(SEARCH_CHANNELS))
    if tool is None:
        raise SourceError("Slack's server has no channel search, so set the channel ID in Pull requests settings.")
    argument = "query" if "query" in _schema_names(tool) or not _schema_names(tool) else _schema_names(tool)[0]
    texts, failed = link.call(opts["slackMcpUrl"], tool["name"], {argument: name})
    if failed:
        raise SourceError("Slack would not search for #%s: %s" % (name, " ".join(texts).strip()[:200]))
    named = r"(?<![\w.-])#?%s(?![\w.-])" % re.escape(name)
    pattern = re.compile(r"%s[^\n]{0,120}?\b([CG][A-Z0-9]{6,})\b|\b([CG][A-Z0-9]{6,})\b[^\n]{0,120}?%s"
                         % (named, named))
    for text in texts:
        for match in pattern.finditer(text.replace("\\/", "/")):
            return match[1] or match[2]
    raise SourceError("Slack found no channel named #%s that you can read." % name)


def read_direct(link, opts, channel_id, now):
    """read_channel's pages of the channel, called by Orc itself with its own
    sign-in, as parse_stream would find them in a Claude Code stream."""
    url = opts["slackMcpUrl"]
    tools = link.tools(url)
    found = new_found(channel_id, True)
    reaction = next((name for name in tools if REACTION_TOOL_RE.fullmatch(CLAUDE_TOOL_PREFIX + name)), None)
    found["reactionTool"] = CLAUDE_TOOL_PREFIX + reaction if reaction else None
    read = server_tool(READ_CHANNEL)
    if read not in tools:
        raise SourceError("Slack's server has no %s tool for Orc to read the channel with." % read)
    target = channel_id or direct_channel_id(link, opts, tools)
    oldest = int(now - opts["lookbackDays"] * 86400)
    cursor = None
    for _call in range(SLACK_READ_CALLS):
        arguments = {"channel_id": target, "oldest": str(oldest), "limit": 100}
        if cursor:
            arguments["cursor"] = cursor
        texts, failed = link.call(url, read, arguments)
        cursor = None
        for text in texts:
            if failed:
                found["toolErrors"].append(text)
            else:
                cursor = take_read(found, text, target, opts["slackChannel"]) or cursor
        if not cursor:
            break
    return found


def claude_binary():
    return os.environ.get("ORC_PR_MANAGER_CLAUDE") or shutil.which("claude")


def slack_prompt(opts, channel_id, now):
    oldest = int(now - opts["lookbackDays"] * 86400)
    target = ("channel ID %s (#%s)" % (channel_id, opts["slackChannel"]) if channel_id else
              "#%s; first find its channel ID with %s" % (opts["slackChannel"], SEARCH_CHANNELS))
    return ("Read the Slack channel %s.\n"
            "Call %s with oldest=\"%d\" and limit=100. If its pagination_info has a next_cursor, "
            "call it again with that cursor, at most %d calls in total. Do not summarise or "
            "change anything in Slack. When you have finished, reply with the single word done.\n"
            % (target, READ_CHANNEL, oldest, SLACK_READ_CALLS))


def slack_session(opts, tools, prompt, consequence):
    """The stream of one headless Claude Code call that may use only `tools`
    on Slack. `consequence` ends the message when Claude Code cannot run."""
    binary = claude_binary()
    if not binary:
        raise SourceError("Claude Code is not installed, so %s." % consequence)
    mcp = json.dumps({"mcpServers": {"slack": {"type": "http", "url": opts["slackMcpUrl"]}}})
    argv = [binary, "-p", "--model", "haiku", "--effort", "low", "--tools", "",
            "--setting-sources", "", "--mcp-config", mcp, "--strict-mcp-config",
            "--no-session-persistence", "--permission-mode", "dontAsk",
            "--allowedTools", *tools, "--output-format", "stream-json", "--verbose"]
    env = {k: v for k, v in os.environ.items() if k not in ("ORC_RUN_ID",)}
    env["CLAUDE_CODE_ENTRYPOINT"] = headless_session.CLAUDE_ENTRYPOINT
    with tempfile.TemporaryDirectory(prefix="orc-pr-slack-") as cwd:
        try:
            result = subprocess.run(argv, input=prompt, cwd=cwd, env=env,
                                    capture_output=True, text=True, timeout=SLACK_TIMEOUT)
        except OSError:
            raise SourceError("Claude Code could not be started, so %s." % consequence) from None
        except subprocess.TimeoutExpired:
            raise SourceError("Slack did not answer within %d seconds." % SLACK_TIMEOUT) from None
    return result.stdout or ""


def fetch_slack(opts, channel_id=None, now=None, previous=None, open_keys=(), link=None):
    """One channel's posts: with Orc's own sign-in when `link` is given, else
    through a Claude Code session."""
    now = time.time() if now is None else now
    channel_id = opts.get("slackChannelId") or channel_id
    if link is not None:
        found = _direct(lambda: read_direct(link, opts, channel_id, now))
    else:
        tools = [READ_CHANNEL] if channel_id else [READ_CHANNEL, SEARCH_CHANNELS]
        found = parse_stream(slack_session(opts, tools, slack_prompt(opts, channel_id, now), "Slack can't be read"),
                             opts["slackChannel"], channel_id)
    if found["connected"] is False:
        raise SlackNotConnected()
    if not found["readCalls"]:
        if found["toolErrors"]:
            said = found["toolErrors"][0].strip()[:200]
            raise SourceError("Slack refused to read #%s%s" % (opts["slackChannel"], ": %s" % said if said else "."))
        raise SourceError("Slack sent nothing back for #%s." % opts["slackChannel"] if link is not None
                          else "Claude Code finished without reading #%s." % opts["slackChannel"])
    posts = []
    seen = set()
    for text in found["messages"]:
        for post in parse_messages(text):
            if (post["ts"], post["postedBy"]) not in seen:
                seen.add((post["ts"], post["postedBy"]))
                posts.append(post)
    posts.sort(key=lambda post: post["epoch"])
    name_reactors(posts, previous, opts, found["channelId"], open_keys, link)
    return {"posts": posts, "warning": unread_warning(found["messages"], posts, opts["slackChannel"]), "channel": opts["slackChannel"], "channelId": found["channelId"] or channel_id,
            "domain": found["domains"][0] if found["domains"] else None,
            "reactionTool": found["reactionTool"]}


def parse_reactors(text):
    """Who left each reaction, by emoji name, from one get_reactions result."""
    try:
        payload = json.loads(text)
    except ValueError:
        payload = None
    if isinstance(payload, dict) and isinstance(payload.get("result"), str):
        text = payload["result"]
    return {name: [who for who, _user_id in REACTOR_RE.findall(people)]
            for name, people in REACTORS_LINE_RE.findall(text)}


def fetch_reactors(opts, channel_id, stamps, link=None):
    """Who reacted to each message in `stamps`, keyed by its timestamp. A
    message Claude did not ask about, or Slack refused, is left out."""
    if link is not None:
        return _direct(lambda: reactors_direct(link, opts, channel_id, stamps))
    prompt = ("For each of these messages in Slack channel ID %s, call %s once with that message_ts: %s.\n"
              "Call nothing else and change nothing in Slack. When you have finished, reply with the "
              "single word done.\n" % (channel_id, GET_REACTIONS, ", ".join(stamps)))
    calls, found = {}, {}
    for event in _stream_events(slack_session(opts, [GET_REACTIONS], prompt, "reactions can't be read")):
        for item in _content_items(event):
            if event.get("type") == "assistant" and item.get("type") == "tool_use" \
                    and item.get("name") == GET_REACTIONS:
                sent = item.get("input") if isinstance(item.get("input"), dict) else {}
                if sent.get("channel_id") == channel_id and sent.get("message_ts") in stamps:
                    calls[item.get("id")] = sent["message_ts"]
            elif event.get("type") == "user" and item.get("type") == "tool_result" \
                    and item.get("tool_use_id") in calls and not item.get("is_error"):
                found[calls[item["tool_use_id"]]] = parse_reactors(" ".join(_tool_result_texts(item.get("content"))))
    return found


def reactors_direct(link, opts, channel_id, stamps):
    found = {}
    for ts in stamps:
        texts, failed = link.call(opts["slackMcpUrl"], server_tool(GET_REACTIONS),
                                  {"channel_id": channel_id, "message_ts": ts})
        if not failed:
            found[ts] = parse_reactors(" ".join(texts))
    return found


def name_reactors(posts, previous, opts, channel_id, open_keys=(), link=None):
    """Set each post's reactedBy: the last read's names while its reactions
    are unchanged, else a lookup for the posts showing a picked-up reaction,
    open PRs' newest first. A lookup that fails leaves the names unknown."""
    signature = lambda post: json.dumps(post.get("reactions"), sort_keys=True)  # noqa: E731
    known = {(post.get("ts"), signature(post)): post["reactedBy"] for post in previous or []
             if isinstance(post, dict) and isinstance(post.get("reactedBy"), dict)}
    picked_up = set(opts["pickedUpReactions"])
    wanted = []
    for post in posts:
        names = known.get((post["ts"], signature(post)))
        if names is not None:
            post["reactedBy"] = names
        elif post["ts"] and not post["bot"] and any(r["name"] in picked_up for r in post["reactions"]):
            wanted.append(post)
    if not wanted or not SLACK_CHANNEL_ID_RE.fullmatch(channel_id or ""):
        return
    wanted.sort(key=lambda post: (not any(link["key"] in open_keys for link in post["links"]), -post["epoch"]))
    batch = wanted[:REACTOR_LOOKUPS]
    try:
        found = fetch_reactors(opts, channel_id, [post["ts"] for post in batch], link)
    except SourceError:
        return
    for post in batch:
        if post["ts"] in found:
            post["reactedBy"] = found[post["ts"]]


def add_slack_reaction(opts, channel_id, ts, tool=None, link=None):
    """Put the viewer's eyes reaction on one Slack message. Slack's answer is
    read from the tool result. True when this call added it, False when the
    viewer's reaction was already there."""
    if not (SLACK_CHANNEL_ID_RE.fullmatch(channel_id or "") and SLACK_TS_RE.fullmatch(ts or "")):
        raise SourceError("Orc does not know which Slack message to react to. Refresh and try again.")
    if link is not None:
        return _direct(lambda: react_direct(link, opts, channel_id, ts))
    tool = tool if tool and REACTION_TOOL_RE.fullmatch(tool) else DEFAULT_REACTION_TOOL
    prompt = ("Add the emoji reaction \"%s\" (no colons) to the Slack message with timestamp %s in "
              "channel ID %s.\nCall %s exactly once and change nothing else in Slack. When you have "
              "finished, reply with the single word done.\n" % (PICKED_UP_REACTION, ts, channel_id, tool))
    connected, calls, results = None, {}, []
    for event in _stream_events(slack_session(opts, [tool], prompt, "the reaction was not added")):
        if event.get("type") == "system" and event.get("subtype") == "init":
            connected = _slack_connected(event)
        for item in _content_items(event):
            if event.get("type") == "assistant" and item.get("type") == "tool_use" and item.get("name") == tool:
                calls[item.get("id")] = item.get("input") if isinstance(item.get("input"), dict) else {}
            elif event.get("type") == "user" and item.get("type") == "tool_result" \
                    and item.get("tool_use_id") in calls:
                results.append((calls[item["tool_use_id"]], bool(item.get("is_error")),
                                " ".join(_tool_result_texts(item.get("content")))))
    if connected is False:
        raise SlackNotConnected()
    if not results:
        raise SourceError("Claude Code finished without adding the reaction. Add it in Slack instead.")
    sent, failed, text = results[-1]
    # The model fills in the call, so a success only counts for this message.
    if ts not in sent.values() or channel_id not in sent.values():
        raise SourceError("The reaction went to a different Slack message. Check the post in Slack.")
    if failed and "already_reacted" not in text:
        raise SourceError("Slack refused the reaction: %s" % (text.strip()[:200] or "no reason given"))
    return not failed


def react_direct(link, opts, channel_id, ts):
    tools = link.tools(opts["slackMcpUrl"])
    tool = next((tool for name, tool in tools.items() if REACTION_TOOL_RE.fullmatch(CLAUDE_TOOL_PREFIX + name)), None)
    if tool is None:
        raise SourceError("Slack's server has no tool for adding a reaction. Add it in Slack instead.")
    names = _schema_names(tool)
    emoji = next((name for name in EMOJI_ARGUMENTS if name in names), EMOJI_ARGUMENTS[0])
    texts, failed = link.call(opts["slackMcpUrl"], tool["name"],
                              {"channel_id": channel_id, "message_ts": ts, emoji: PICKED_UP_REACTION})
    text = " ".join(texts)
    if failed and "already_reacted" not in text:
        raise SourceError("Slack refused the reaction: %s" % (text.strip()[:200] or "no reason given"))
    return not failed


def gh_binary():
    return os.environ.get("ORC_PR_MANAGER_GH") or "gh"


def graphql(query, variables, job="pr-queue"):
    """(data, errors) for one GraphQL request. gh exits non-zero when any
    alias failed, yet still prints the partial data, so stdout wins. `job`
    names the call on Settings' Integrations page."""
    body = json.dumps({"query": query, "variables": variables})
    integrations.note(job)
    try:
        result = subprocess.run([gh_binary(), "api", "graphql", "--input", "-"], input=body,
                                env=clean_env(), capture_output=True, text=True,
                                timeout=GITHUB_TIMEOUT, cwd=tempfile.gettempdir())
    except FileNotFoundError:
        raise SourceError("The GitHub CLI (gh) is not installed.") from None
    except OSError:
        raise SourceError("The GitHub CLI (gh) could not be started.") from None
    except subprocess.TimeoutExpired:
        raise SourceError("GitHub did not answer within %d seconds." % GITHUB_TIMEOUT) from None
    try:
        payload = json.loads(result.stdout)
    except ValueError:
        payload = None
    if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        return payload["data"], payload.get("errors") or []
    stderr = (result.stderr or "").strip().splitlines()
    last = stderr[-1] if stderr else "gh exited %d" % result.returncode
    if "auth login" in last or "not logged" in last.lower():
        raise SourceError("The GitHub CLI is not signed in. Run gh auth login.")
    raise SourceError("GitHub returned an error: %s" % last[:200])


def is_bot(actor):
    if not isinstance(actor, dict):
        return False
    return actor.get("__typename") == "Bot" or str(actor.get("login") or "").endswith("[bot]")


def review_status(reviews, author_login=None):
    """Port of workbench pr-inbox computeReviewStatus: each reviewer's latest
    APPROVED/CHANGES_REQUESTED/DISMISSED counts; COMMENTED never does."""
    author_key = (author_login or "").lower()
    filtered = [r for r in reviews if not author_key or r["login"].lower() != author_key]
    latest = {}
    for review in filtered:
        if review["state"] in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED"):
            latest[review["login"]] = review["state"]
    approvals = sum(1 for state in latest.values() if state == "APPROVED")
    changes = sum(1 for state in latest.values() if state == "CHANGES_REQUESTED")
    has_comments = any(r["state"] == "COMMENTED" and latest.get(r["login"]) in (None, "DISMISSED")
                       for r in filtered)
    status = None
    if changes:
        status = "changes_requested"
    elif approvals:
        status = "approved"
    elif not latest:
        status = "review_required"
    return {"reviewStatus": status, "approvals": approvals, "hasCommentReviews": has_comments}


def check_status(state):
    return {"SUCCESS": "success", "FAILURE": "failure", "ERROR": "failure",
            "PENDING": "pending", "EXPECTED": "pending"}.get((state or "").upper())


def _nodes(value):
    nodes = value.get("nodes") if isinstance(value, dict) else None
    return [node for node in nodes or [] if isinstance(node, dict)]


def _actor(value):
    if not isinstance(value, dict) or not value.get("login"):
        return {"login": "ghost", "bot": False, "avatarUrl": None}
    return {"login": value["login"], "bot": is_bot(value), "avatarUrl": value.get("avatarUrl")}


def _minimized(node):
    if not node.get("isMinimized"):
        return None
    return str(node.get("minimizedReason") or "hidden").lower().replace("_", "-")


def _thread_comment(node):
    return {"id": node.get("id"), "author": _actor(node.get("author")), "createdAt": node.get("createdAt"),
            "url": node.get("url"), "bodyHtml": node.get("bodyHTML") or "", "minimized": _minimized(node)}


def _thread(node):
    comments = _nodes(node.get("comments"))
    first = comments[0] if comments else {}
    lines = str(first.get("diffHunk") or "").split("\n")
    if lines and lines[0].startswith("@@"):
        lines = lines[1:]
    line = node.get("line") if node.get("line") is not None else node.get("originalLine")
    resolver = node.get("resolvedBy")
    return {"id": node.get("id"), "path": node.get("path"), "line": line,
            "outdated": bool(node.get("isOutdated")), "resolved": bool(node.get("isResolved")),
            "resolvedBy": resolver.get("login") if isinstance(resolver, dict) else None,
            "diffHunk": "\n".join(lines[-4:]), "createdAt": first.get("createdAt"),
            "comments": [_thread_comment(c) for c in comments]}


EVENTS = {"MergedEvent": "merged", "ClosedEvent": "closed", "ReopenedEvent": "reopened",
          "ReadyForReviewEvent": "ready", "ConvertToDraftEvent": "draft",
          "ReviewRequestedEvent": "review-requested", "HeadRefForcePushedEvent": "force-pushed"}


def _event_detail(node):
    kind = node.get("__typename")
    if kind == "MergedEvent":
        commit = node.get("commit") or {}
        return "%s into %s" % (commit.get("abbreviatedOid"), node.get("mergeRefName"))
    if kind == "ReviewRequestedEvent":
        reviewer = node.get("requestedReviewer") or {}
        return "team:%s" % reviewer.get("slug") if reviewer.get("slug") else reviewer.get("login")
    if kind == "HeadRefForcePushedEvent":
        return "%s \u2192 %s" % ((node.get("beforeCommit") or {}).get("abbreviatedOid"),
                                 (node.get("afterCommit") or {}).get("abbreviatedOid"))
    return None


def _commit_entry(node):
    commit = node.get("commit") or {}
    git_author = commit.get("author") or {}
    user = git_author.get("user") or {}
    return {"oid": commit.get("oid"), "shortOid": commit.get("abbreviatedOid"),
            "headline": commit.get("messageHeadline") or "", "url": node.get("url"),
            "author": user.get("login") or git_author.get("name") or None}


def _timeline_item(node, threads):
    kind = node.get("__typename")
    if kind == "IssueComment":
        return {"kind": "comment", **_thread_comment(node)}
    if kind == "PullRequestReview":
        attached = [_thread(t) for t in threads if _first_review_id(t) == node.get("id")]
        body = node.get("bodyHTML") or ""
        if node.get("state") == "COMMENTED" and not body.strip() and not attached:
            return None
        return {"kind": "review", "id": node.get("id"), "author": _actor(node.get("author")),
                "state": node.get("state"), "createdAt": node.get("submittedAt") or node.get("createdAt"),
                "url": node.get("url"), "bodyHtml": body, "threads": attached}
    if kind == "PullRequestCommit":
        return {"kind": "commits", "createdAt": (node.get("commit") or {}).get("committedDate"),
                "commits": [_commit_entry(node)]}
    if kind in EVENTS:
        return {"kind": "event", "event": EVENTS[kind], "actor": _actor(node.get("actor")),
                "createdAt": node.get("createdAt"), "detail": _event_detail(node)}
    return None


def _first_review_id(thread):
    comments = _nodes(thread.get("comments"))
    review = comments[0].get("pullRequestReview") if comments else None
    return review.get("id") if isinstance(review, dict) else None


def conversation(node):
    head_connection = node.get("timelineHead")
    head = _nodes(head_connection)
    union = list(head)
    seen = {item.get("id") for item in head}
    tail = [item for item in _nodes(node.get("timelineTail")) if item.get("id") not in seen]
    union += tail
    total = head_connection.get("totalCount") if isinstance(head_connection, dict) else 0
    missing = (total or 0) - len(union)
    threads = _nodes(node.get("reviewThreads"))
    items = []
    for index, raw in enumerate(union):
        if index == len(head) and missing > 0:
            items.append({"kind": "gap", "count": missing})
        item = _timeline_item(raw, threads)
        if item is None:
            continue
        if item["kind"] == "commits" and items and items[-1]["kind"] == "commits":
            items[-1]["commits"] += item["commits"]
        else:
            items.append(item)
    if missing > 0 and len(head) >= len(union):
        items.append({"kind": "gap", "count": missing})
    review_ids = {raw.get("id") for raw in union if raw.get("__typename") == "PullRequestReview"}
    for raw in threads:
        if _first_review_id(raw) in review_ids:
            continue
        thread = {"kind": "thread", **_thread(raw)}
        at = next((i for i, item in enumerate(items) if item["kind"] != "gap"
                   and (item.get("createdAt") or "") > (thread["createdAt"] or "")), len(items))
        items.insert(at, thread)
    return items


def _rollup(node, field="commits"):
    for commit in _nodes(node.get(field)):
        rollup = (commit.get("commit") or {}).get("statusCheckRollup")
        if isinstance(rollup, dict):
            return rollup
    return None


def human_reviews(node):
    reviews = []
    for review in _nodes(node.get("reviews")):
        author = review.get("author")
        if isinstance(author, dict) and author.get("login") and not is_bot(author):
            reviews.append({"login": author["login"], "state": review.get("state") or "",
                            "submittedAt": review.get("submittedAt")})
    return reviews


def body_ticket(body):
    match = LINEAR_LINK_RE.search(body or "")
    if not match:
        return None
    ref = match[2].upper()
    return {"ref": ref, "url": "https://linear.app/%s/issue/%s" % (match[1], ref), "workspace": match[1]}


def ticket_for(record_body, head_ref, title, workspace):
    """Body link first, then the branch's `<author>/<ref>/...` slot (where
    `noticket` opts out), then a `REF | title` prefix."""
    linked = body_ticket(record_body)
    if linked:
        return {"ref": linked["ref"], "url": linked["url"]}
    segment = (head_ref or "").split("/")
    ref = None
    if len(segment) > 1 and segment[1].lower() == "noticket":
        return None
    if len(segment) > 1 and LINEAR_REF_RE.match(segment[1]):
        ref = segment[1].upper()
    if not ref:
        match = TITLE_REF_RE.match(title or "")
        ref = match[1].upper() if match else None
    if not ref:
        return None
    return {"ref": ref, "url": "https://linear.app/%s/issue/%s" % (workspace, ref) if workspace else None}


def normalize_pr(node):
    """One GraphQL PullRequest as a cacheable record, or None for a bot's PR.
    The body is kept only until tickets are resolved."""
    if not isinstance(node, dict) or not node.get("url"):
        return None
    author = node.get("author") if isinstance(node.get("author"), dict) else {}
    if is_bot(author):
        return None
    login = author.get("login") or "ghost"
    reviews = human_reviews(node)
    status = review_status(reviews, login)
    requested = []
    for request in _nodes(node.get("reviewRequests")):
        reviewer = request.get("requestedReviewer") or {}
        if reviewer.get("login"):
            requested.append(reviewer["login"])
        elif reviewer.get("slug"):
            requested.append("team:" + reviewer["slug"])
    rollup = _rollup(node)
    repository = node.get("repository") or {}
    repo = repository.get("nameWithOwner") or ""
    last_commit = next(((c.get("commit") or {}).get("committedDate") for c in _nodes(node.get("commits"))), None)
    record = {
        "url": node["url"], "repo": repo, "number": node.get("number"),
        "title": node.get("title") or "", "author": login, "isDraft": bool(node.get("isDraft")),
        "authorAvatarUrl": author.get("avatarUrl"), "ownerAvatarUrl": (repository.get("owner") or {}).get("avatarUrl"),
        "state": node.get("state") or "OPEN", "createdAt": node.get("createdAt"),
        "updatedAt": node.get("updatedAt"), "headRef": node.get("headRefName") or "",
        "baseRef": node.get("baseRefName") or "", "reviewStatus": status["reviewStatus"],
        "approvals": status["approvals"], "hasCommentReviews": status["hasCommentReviews"],
        "checkStatus": check_status(rollup.get("state") if rollup else None),
        "mergeable": node.get("mergeable") or "UNKNOWN",
        "comments": (node.get("comments") or {}).get("totalCount") or 0,
        "additions": node.get("additions") or 0, "deletions": node.get("deletions") or 0,
        "labels": [{"name": label.get("name"), "color": label.get("color")}
                   for label in _nodes(node.get("labels")) if label.get("name")],
        "requestedReviewers": requested, "body": node.get("body") or "",
        "reviews": [{"author": r["login"], "state": r["state"], "submittedAt": r["submittedAt"]}
                    for r in reviews],
        "lastCommitAt": last_commit, "headOid": node.get("headRefOid") or "",
        "changesRequestedBy": verdicts_by(reviews, login, "CHANGES_REQUESTED"),
        "approvedBy": verdicts_by(reviews, login, "APPROVED"),
    }
    if "recentComments" in node:
        record["recentComments"] = [
            {"author": (c.get("author") or {}).get("login") or "", "createdAt": c.get("createdAt")}
            for c in _nodes(node.get("recentComments"))]
    if "reviewThreads" in node:
        record["feedback"] = feedback_since(node, login, last_commit)
    if "reRequests" in node:
        record["reviewRequests"] = [
            {"login": ((e.get("requestedReviewer") or {}).get("login") or ""), "at": e.get("createdAt")}
            for e in _nodes(node.get("reRequests")) if e.get("createdAt")]
    return record


def verdicts_by(reviews, author_login, verdict):
    """Reviewers other than the author whose latest verdict is this one."""
    latest = {}
    for review in reviews:
        if review["login"].lower() != author_login.lower() and \
                review["state"] in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED"):
            latest[review["login"]] = review["state"]
    return [login for login, state in latest.items() if state == verdict]


def feedback_since(node, author_login, since):
    """Who left feedback on this PR after its last push, newest first, one
    entry each. A bot counts only as a reviewer: CI and deploy bots post
    plain comments on every push, Zerohands reviews. A Zerohands pass, and
    the notes it left at or before it, ask nothing of you; what it says
    after still does."""
    passed = {}
    for review in _nodes(node.get("reviewBodies")):
        author = review.get("author")
        login, at = (author or {}).get("login") if isinstance(author, dict) else None, review.get("submittedAt")
        if login and at and is_bot(author) and reviewer_name(login, True) == "Zerohands" \
                and (review.get("bodyText") or "").lstrip().startswith(ZEROHANDS_PASS):
            passed[login] = max(passed.get(login, ""), at)
    events = []
    for review in _nodes(node.get("reviews")):
        if review.get("state") in ("COMMENTED", "CHANGES_REQUESTED"):
            events.append((review.get("author"), review.get("submittedAt"), True))
    for comment in _nodes(node.get("recentComments")):
        events.append((comment.get("author"), comment.get("createdAt"), False))
    for thread in _nodes(node.get("reviewThreads")):
        for comment in _nodes(thread.get("comments")):
            events.append((comment.get("author"), comment.get("createdAt"), True))
    latest = {}
    for author, at, reviewing in events:
        login = (author or {}).get("login") if isinstance(author, dict) else None
        bot = is_bot(author)
        if not login or not at or login.lower() == author_login.lower() or (bot and not reviewing):
            continue
        if since and at <= since:
            continue
        if login in passed and at <= passed[login]:
            continue
        if login not in latest or latest[login]["at"] < at:
            latest[login] = {"login": login, "bot": bot, "at": at}
    return sorted(latest.values(), key=lambda item: item["at"], reverse=True)


def reviewer_name(login, bot):
    if not bot:
        return login
    name = login[:-5] if login.endswith("[bot]") else login
    return "Zerohands" if name.lower().startswith("zerohands") else name


def action_reasons(row):
    """Why one of your open PRs needs you, each with the words the page and
    The assistant shows it."""
    reasons = []
    if row.get("mergeable") == "CONFLICTING":
        reasons.append({"kind": "conflict", "label": "Conflicts with %s" % (row.get("baseRef") or "its base")})
    for item in row.get("feedback") or []:
        reasons.append({"kind": "feedback", "label": reviewer_name(item["login"], item["bot"]),
                        "bot": item["bot"], "at": item["at"]})
    requested = [login for login in row.get("changesRequestedBy") or []
                 if not any(item["login"] == login for item in row.get("feedback") or [])]
    if row.get("reviewStatus") == "changes_requested" and (requested or not row.get("feedback")):
        reasons.append({"kind": "changes", "label": ", ".join(requested) or "a reviewer"})
    if row.get("checkStatus") == "failure":
        reasons.append({"kind": "checks", "label": "Checks failing"})
    return reasons


def review_activity(record, viewer):
    """What happened after the viewer last reviewed or commented: `repliedAt`
    for an author comment or review reply, `pushedAt` for a newer commit; and
    `reRequestedAt`, a request for your review since your last review. A
    commit's date is when it was committed, so a rebase counts as a push."""
    me, author = (viewer or "").lower(), record["author"].lower()
    events = [(r["author"], r["submittedAt"]) for r in record["reviews"]]
    events += [(c["author"], c["createdAt"]) for c in record.get("recentComments") or []]
    mine = [at for login, at in events if at and login.lower() == me]
    replies = [at for login, at in events if at and login.lower() == author]
    reviewed_at = max(mine, default=None)
    replied_at = max(replies, default=None)
    pushed_at = record.get("lastCommitAt")
    last_review = max((r["submittedAt"] for r in record["reviews"]
                       if r["submittedAt"] and r["author"].lower() == me), default=None)
    requested_at = max((r["at"] for r in record.get("reviewRequests") or [] if r["login"].lower() == me),
                       default=None)
    return {"reviewedAt": reviewed_at,
            "repliedAt": replied_at if reviewed_at and replied_at and replied_at > reviewed_at else None,
            "pushedAt": pushed_at if reviewed_at and pushed_at and pushed_at > reviewed_at else None,
            "reRequestedAt": requested_at if last_review and requested_at and requested_at > last_review else None}


def resolve_tickets(records, fallback_workspace=None):
    """Tickets for a fetch's records. A branch or title ref borrows the Linear
    workspace another PR body in the same fetch links to."""
    workspace = next((t["workspace"] for t in (body_ticket(r["body"]) for r in records) if t),
                     None) or fallback_workspace
    for record in records:
        record["ticket"] = ticket_for(record.pop("body", ""), record["headRef"], record["title"], workspace)
    return workspace


def search(query, graphql_query=SEARCH_QUERY):
    viewer, records, after = None, [], None
    for _page in range(SEARCH_PAGES):
        data, errors = graphql(graphql_query, {"q": query, "after": after})
        if not isinstance(data.get("search"), dict):
            raise SourceError("GitHub search failed: %s" % _first_error(errors))
        viewer = (data.get("viewer") or {}).get("login") or viewer
        records += [r for r in map(normalize_pr, data["search"].get("nodes") or []) if r]
        page = data["search"].get("pageInfo") or {}
        if not page.get("hasNextPage"):
            break
        after = page.get("endCursor")
    return viewer, records


def _first_error(errors):
    for error in errors or []:
        if isinstance(error, dict) and error.get("message"):
            return error["message"]
    return "no data"


def fetch_linked(urls):
    """Slack-linked PRs in aliased batches, fetched at once. A deleted or
    private PR nulls only its own alias."""
    wanted = []
    for url in urls:
        match = PR_LINK_RE.search(url)
        if match:
            wanted.append((match[1], match[2], int(match[3])))
    batches = [wanted[start:start + LINKED_BATCH] for start in range(0, len(wanted), LINKED_BATCH)]
    if not batches:
        return []
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(batches), GITHUB_WORKERS)) as pool:
        return [record for found in pool.map(_fetch_linked_batch, batches) for record in found]


def _fetch_linked_batch(batch):
    fields = "\n".join(
        "p%d: repository(owner: %s, name: %s) { pullRequest(number: %d) { %s } }"
        % (index, json.dumps(owner), json.dumps(name), number, "...Pr")
        for index, (owner, name, number) in enumerate(batch))
    query = "query {\n%s\n}\nfragment Pr on PullRequest { %s }" % (fields, PR_FIELDS)
    data, errors = graphql(query, {})
    if not any(isinstance(data.get("p%d" % i), dict) for i in range(len(batch))) \
            and errors and not all(_is_not_found(e) for e in errors):
        raise SourceError("GitHub could not read the linked pull requests: %s" % _first_error(errors))
    found = []
    for index in range(len(batch)):
        repo = data.get("p%d" % index)
        record = normalize_pr(repo.get("pullRequest")) if isinstance(repo, dict) else None
        if record:
            found.append(record)
    return found


def _is_not_found(error):
    return isinstance(error, dict) and error.get("type") in ("NOT_FOUND", "FORBIDDEN")


def _scope_clauses(orgs=(), repos=(), budget=190):
    tokens = ["org:" + org for org in orgs] + ["repo:" + repo for repo in repos]
    if not tokens:
        return [""]
    clauses, current, length = [], [], 0
    for token in tokens:
        needed = len(token) + 1
        if current and length + needed > budget:
            clauses.append("".join(" " + item for item in current))
            current, length = [], 0
        current.append(token)
        length += needed
    if current:
        clauses.append("".join(" " + item for item in current))
    return clauses


def _dedupe_records(records):
    seen, unique = set(), []
    for record in records:
        url = record.get("url")
        if url and url not in seen:
            seen.add(url)
            unique.append(record)
    return unique


def search_github(orgs=(), repos=()):
    clauses = _scope_clauses(orgs, repos)
    searches = [
        (kind, prefix + clause, gql)
        for clause in clauses
        for kind, prefix, gql in (
            ("mine", "is:pr is:open author:@me archived:false", MINE_QUERY),
            ("requested", "is:pr is:open user-review-requested:@me archived:false", SEARCH_QUERY),
            ("reviewed", "is:pr is:open reviewed-by:@me -author:@me archived:false", REVIEWED_QUERY),
        )
    ]
    grouped = {"mine": [], "requested": [], "reviewed": []}
    viewer = None
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(searches), max(3, GITHUB_WORKERS))) as pool:
        results = list(pool.map(lambda item: (item[0], *search(item[1], item[2])), searches))
    for kind, found_viewer, records in results:
        viewer = viewer or found_viewer
        grouped[kind].extend(records)
    if not viewer:
        raise SourceError("GitHub did not say who is signed in.")
    return (
        viewer,
        _dedupe_records(grouped["mine"]),
        _dedupe_records(grouped["requested"]),
        _dedupe_records(grouped["reviewed"]),
    )


def fetch_github(searched, slack_posts, linear_workspace=None, previous=None, prefetched=(), orgs=(), repos=()):
    """A merged PR never changes again, so the previous fetch's record of one
    is reused instead of asking GitHub; most Slack-linked PRs are merged. A
    reused record has no body left, so the Linear workspace an earlier body
    linked carries over."""
    viewer, mine, requested, reviewed = searched
    previous = previous or {}
    scope = ({"mode": "selected", "orgs": list(orgs), "repos": list(repos)}
             if (orgs or repos) else {"mode": "all", "orgs": [], "repos": []})
    merged = {key_for_url(r["url"]): r for r in previous.get("linked") or [] if r["state"] == "MERGED"}
    ready = {key_for_url(r["url"]): r for r in prefetched}
    known = {key_for_url(r["url"]) for r in mine + requested + reviewed}
    linked_urls, reused, fetched = [], [], []
    for post in slack_posts:
        for link in post["links"]:
            if link["key"] not in known and in_scope(link["key"], scope):
                known.add(link["key"])
                if link["key"] in merged:
                    reused.append(merged[link["key"]])
                elif link["key"] in ready:
                    fetched.append(ready[link["key"]])
                else:
                    linked_urls.append(link["url"])
    fetched += fetch_linked(linked_urls)
    workspace = resolve_tickets(mine + requested + reviewed + fetched,
                                linear_workspace or previous.get("linearWorkspace"))
    linked = fetched + reused
    for record in reviewed:
        record["reviewActivity"] = review_activity(record, viewer)
    for record in mine + requested + reviewed + linked:
        record.pop("reviews", None)
        record.pop("recentComments", None)
        record.pop("reviewRequests", None)
    return {"viewer": viewer, "mine": mine, "requested": requested, "reviewed": reviewed, "linked": linked,
            "linearWorkspace": workspace}


# A run that takes no more work on its PR. Not complete: an Orc run whose PR
# is open sits there, and its PR feedback round is how it takes more.
RUN_FINISHED = ("cancelled", "merged", "merged-to-parent")


RUN_STAMP = re.compile(r"-(\d{8}-\d{4})(?:-(\d+))?$")


def orc_runs_by_pr(runs_dir):
    """The Orc run each PR belongs to. Assistant PR cards key on it, so the
    choice depends only on the runs themselves, never on which meta.json was
    written last: a run that made the PR over a review of it, a live run over
    a finished one, one that recorded the PR over one seeded from it, then
    the earliest started, by the time in its id."""
    best = {}
    try:
        entries = list(os.scandir(runs_dir))
    except OSError:
        return {}
    for entry in entries:
        if entry.name.startswith("."):
            continue
        try:
            with open(os.path.join(entry.path, "meta.json")) as handle:
                meta = json.load(handle)
        except (OSError, ValueError):
            continue
        if not isinstance(meta, dict):
            continue
        review = meta.get("route") == "local-review"
        finished = meta.get("status") in RUN_FINISHED
        recorded = run_pull_request.linked_urls({key: meta[key] for key in ("delivery", "prUrl", "prUrls") if key in meta})
        stamp = RUN_STAMP.search(entry.name)
        started = (stamp[1], int(stamp[2] or 1)) if stamp else ("~", 0)
        for url in run_pull_request.linked_urls(meta):
            key = key_for_url(url)
            order = (review, finished, url not in recorded, started, entry.name)
            if key and (key not in best or order < best[key][0]):
                best[key] = (order, {"runId": entry.name, "title": meta.get("title") or entry.name,
                                     **({"harness": meta["harness"]} if isinstance(meta.get("harness"), str) else {}),
                                     **({"review": True} if review else {}),
                                     **({"finished": True} if finished else {})})
    return {key: value for key, (_order, value) in best.items()}


def review_runs_by_pr(runs_dir):
    """The newest local review run of each PR that finished its review,
    keyed like key_for_url: a follow-up reads that run's findings, which a
    cancelled or failed review never wrote."""
    best = {}
    try:
        entries = list(os.scandir(runs_dir))
    except OSError:
        return {}
    for entry in entries:
        try:
            mtime = os.stat(os.path.join(entry.path, "meta.json")).st_mtime
            with open(os.path.join(entry.path, "meta.json")) as handle:
                meta = json.load(handle)
        except (OSError, ValueError):
            continue
        review = meta.get("review") if isinstance(meta, dict) and meta.get("route") == "local-review" else None
        if (not isinstance(review, dict) or meta.get("status") in ("cancelled", "failed")
                or not os.path.isfile(os.path.join(entry.path, local_review.RESULT))):
            continue
        key = key_for_url(review.get("prUrl")) if isinstance(review, dict) and isinstance(review.get("prUrl"), str) else None
        if key and (key not in best or best[key][0] < mtime):
            best[key] = (mtime, entry.name)
    return {key: run_id for key, (_mtime, run_id) in best.items()}


# Port of workbench pr-inbox lib/filter-engine.ts, so sections behave the same in both tools.

TITLE_OPERATORS = ("contains", "does_not_contain", "starts_with", "does_not_start_with",
                   "ends_with", "does_not_end_with", "equals", "does_not_equal")
FIELDS = {
    "author": (("is", "is_not"), None),
    "repo": (("is", "is_not"), None),
    "title": (TITLE_OPERATORS, None),
    "labels": (("includes", "does_not_include"), None),
    "pr_status": (("is", "is_not"), ("open", "draft", "merged", "closed")),
    "review_status": (("equals", "does_not_equal"), ("approved", "changes_requested", "review_required",
                                                      "has_approvals", "has_requested_reviewers",
                                                      "has_comment_reviews")),
    "requested_reviewers": (("includes", "does_not_include"), None),
    "check_status": (("is", "is_not"), ("success", "failure", "pending", "none")),
    "mergeable": (("is", "is_not"), ("conflicting", "mergeable")),
    # Orc's own field: feedback from a reviewer or Zerohands since the last push.
    "feedback": (("is", "is_not"), ("new",)),
}


def _positive(operator):
    return operator in ("is", "equals", "includes", "contains", "starts_with", "ends_with")


def evaluate_condition(pr, condition, viewer):
    field, operator, value = condition["field"], condition["operator"], condition["value"]
    if value == "@me":
        value = viewer or ""
    value = value.lower()
    if field == "title":
        title = pr["title"].lower()
        return {"contains": value in title, "does_not_contain": value not in title,
                "starts_with": title.startswith(value), "does_not_start_with": not title.startswith(value),
                "ends_with": title.endswith(value), "does_not_end_with": not title.endswith(value),
                "equals": title == value, "does_not_equal": title != value}[operator]
    if field == "author":
        match = pr["author"].lower() == value
    elif field == "repo":
        match = pr["repo"].lower() == value
    elif field == "labels":
        wanted = {v.strip() for v in value.split(",") if v.strip()}
        match = any(label["name"].lower() in wanted for label in pr["labels"])
    elif field == "requested_reviewers":
        match = any(reviewer.lower() == value for reviewer in pr["requestedReviewers"])
    elif field == "pr_status":
        state = pr["state"].upper()
        match = {"open": state == "OPEN" and not pr["isDraft"], "draft": pr["isDraft"],
                 "merged": state == "MERGED", "closed": state == "CLOSED"}[value]
    elif field == "review_status":
        match = {"approved": pr["reviewStatus"] == "approved",
                 "changes_requested": pr["reviewStatus"] == "changes_requested",
                 "review_required": pr["reviewStatus"] == "review_required",
                 "has_approvals": pr["approvals"] > 0,
                 "has_requested_reviewers": bool(pr["requestedReviewers"]),
                 "has_comment_reviews": bool(pr.get("hasCommentReviews"))}[value]
    elif field == "check_status":
        match = (pr["checkStatus"] or "none") == value
    elif field == "mergeable":
        match = pr["mergeable"].lower() == value
    elif field == "feedback":
        match = bool(pr.get("feedback"))
    else:
        return True
    return match if _positive(operator) else not match


def evaluate_section(pr, section, viewer):
    repos = section.get("repos")
    if repos and not any(pr["repo"].lower() == repo.lower() for repo in repos):
        return False
    groups = section["filters"]
    return not groups or any(all(evaluate_condition(pr, c, viewer) for c in group) for group in groups)


def validate_sections(value):
    """The configured sections, or raises ValueError naming the first problem."""
    if not isinstance(value, list) or not value:
        raise ValueError("it must be a non-empty list")
    sections, ids = [], set()
    for index, section in enumerate(value):
        where = "section %d" % (index + 1)
        if not isinstance(section, dict):
            raise ValueError(where + " is not an object")
        title = section.get("title")
        if not isinstance(title, str) or not title.strip():
            raise ValueError(where + " has no title")
        section_id = section.get("id")
        if section_id is None:
            section_id = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "section-%d" % (index + 1)
        if not isinstance(section_id, str) or not section_id or section_id in ids:
            raise ValueError(where + " has a missing or duplicate id")
        ids.add(section_id)
        repos = section.get("repos")
        if repos is not None and not (isinstance(repos, list) and all(isinstance(r, str) for r in repos)):
            raise ValueError(where + " repos must be a list of owner/name strings")
        groups = section.get("filters", [])
        if not isinstance(groups, list) or not all(isinstance(g, list) for g in groups):
            raise ValueError(where + " filters must be a list of condition lists")
        for group in groups:
            for condition in group:
                if not isinstance(condition, dict) or condition.get("field") not in FIELDS:
                    raise ValueError(where + " has an unknown filter field")
                operators, values = FIELDS[condition["field"]]
                if condition.get("operator") not in operators:
                    raise ValueError("%s: %s does not support %r" % (where, condition["field"],
                                                                    condition.get("operator")))
                if not isinstance(condition.get("value"), str) or not condition["value"]:
                    raise ValueError(where + " has a filter without a value")
                if values and condition["value"] not in values:
                    raise ValueError("%s: %s cannot be %r" % (where, condition["field"], condition["value"]))
        sections.append({"id": section_id, "title": title.strip(), "repos": repos, "filters": groups})
    return sections


def assign_sections(prs, sections, viewer):
    ordered = sorted(prs, key=lambda pr: pr.get("updatedAt") or "", reverse=True)
    assigned, result = set(), []
    for section in sections:
        items = []
        for pr in ordered:
            if pr["url"] not in assigned and evaluate_section(pr, section, viewer):
                assigned.add(pr["url"])
                items.append(pr)
        if items:
            result.append({"id": section["id"], "title": section["title"], "items": items})
    return result


def _pr_ref(row):
    return {"repo": row["repo"], "number": row["number"], "url": row["url"]}


def link_related(rows):
    """Marks PRs stacked on another PR (its base branch is that PR's head in
    the same repo) or sharing a ticket with one, and gives each connected set a
    group ordered from the bottom of the stack up."""
    parent = {row["url"]: row["url"] for row in rows}

    def root(url):
        while parent[url] != url:
            parent[url] = parent[parent[url]]
            url = parent[url]
        return url

    heads = {(row["repo"], row["headRef"]): row for row in rows if row.get("headRef")}
    for row in rows:
        base = heads.get((row["repo"], row.get("baseRef")))
        if base is not None and base is not row:
            row["stackedOn"] = _pr_ref(base)
            parent[root(row["url"])] = root(base["url"])
    stack_of = {row["url"]: root(row["url"]) for row in rows}
    by_ticket = {}
    for row in rows:
        ref = (row.get("ticket") or {}).get("ref")
        if ref:
            by_ticket.setdefault(ref, []).append(row)
    for linked in by_ticket.values():
        for row in linked:
            others = [_pr_ref(other) for other in linked if stack_of[other["url"]] != stack_of[row["url"]]]
            if others:
                row["linkedWith"] = others
            parent[root(row["url"])] = root(linked[0]["url"])

    by_url = {row["url"]: row for row in rows}

    def depth(row, seen=()):
        base = by_url.get((row.get("stackedOn") or {}).get("url"))
        return 0 if base is None or base["url"] in seen else 1 + depth(base, seen + (row["url"],))

    components = {}
    for index, row in enumerate(rows):
        components.setdefault(root(row["url"]), []).append((depth(row), index, row))
    for members in components.values():
        if len(members) < 2:
            continue
        members.sort(key=lambda member: member[:2])
        kind = "stack" if any("stackedOn" in row for _depth, _index, row in members) else "linked"
        for position, (_depth, _index, row) in enumerate(members):
            row["group"] = {"id": members[0][2]["url"], "kind": kind, "position": position, "size": len(members)}
    return rows


def post_state(reactions, picked_up):
    names = {r["name"] for r in reactions if r.get("count", 0) > 0}
    if any(name in picked_up and "check" in name for name in names):
        return "approved"
    if names & set(picked_up):
        return "picked-up"
    return "waiting"


def permalink(domain, channel_id, ts):
    if not (domain and channel_id and ts):
        return None
    return "https://%s/archives/%s/p%s" % (domain, channel_id, ts.replace(".", ""))


def slack_by_pr(posts, opts):
    """Each linked PR's Slack summary: its earliest post, and the strongest
    state any post reached."""
    workspace = re.sub(r"^https?://", "", opts.get("slackWorkspaceUrl") or "").strip("/")
    grouped = collections.defaultdict(list)
    for post in sorted(posts, key=lambda p: p["epoch"]):
        for link in post["links"]:
            grouped[link["key"]].append((post, link["tag"]))
    result = {}
    for key, entries in grouped.items():
        first, tag = entries[0]
        reactions = {}
        for post, _tag in entries:
            for reaction in post["reactions"]:
                reactions[reaction["name"]] = max(reactions.get(reaction["name"], 0), reaction["count"])
        state = max((post_state(post["reactions"], opts["pickedUpReactions"]) for post, _ in entries),
                    key=STATE_RANK.get)
        # The people behind the state: a tick for approved, eyes or the
        # like for picked up.
        marks = [name for name in opts["pickedUpReactions"] if ("check" in name) == (state == "approved")]
        by = [who for post, _ in entries for name in marks for who in (post.get("reactedBy") or {}).get(name) or []]
        result[key] = {"tag": tag, "tags": sorted({t for _, t in entries}),
                       "postedAt": iso(first["epoch"]), "postedBy": first["postedBy"],
                       "channel": first["channel"],
                       "permalink": permalink(first["domain"] or workspace, first["channelId"], first["ts"]),
                       "reactions": [{"name": n, "count": c} for n, c in reactions.items()],
                       "state": state, "by": list(dict.fromkeys(by))}
    return result


def slack_channels(state, opts):
    """Select current channels in settings order and read single-channel caches from older versions."""
    slack = state["slack"]
    reads = slack.get("channels")
    if reads is None:
        name = (slack.get("data") or {}).get("channel")
        reads = {name: slack} if name else {}
    return {name: reads.get(name, {}) for name in opts["slackChannels"]}


def slack_metadata(state, opts):
    channels = slack_channels(state, opts)
    connected = not channels or any(read.get("connected") is not False for read in channels.values())
    enabled = opts.get("useSlack", True)
    shown = enabled and opts.get("repoScope") is not None and bool(channels) and connected
    errors = [(name, read["error"]) for name, read in channels.items() if read.get("error")] if shown else []
    error = " ".join("#%s: %s" % (name, err) if len(channels) > 1 else err for name, err in errors)
    times = [read["fetchedAt"] for read in channels.values() if read.get("fetchedAt")] if shown else []
    return {"channel": opts["slackChannel"], "channels": list(channels), "lookbackDays": opts["lookbackDays"],
            "enabled": enabled, "connected": connected, "shown": shown,
            "ok": not errors, "error": error or None, "fetchedAt": max(times, default=None)}


def slack_posts(channels):
    posts = []
    for name, read in channels.items():
        if read.get("connected") is False:
            continue
        data = read.get("data") or {}
        posts.extend(dict(post, channel=name, channelId=data.get("channelId"), domain=data.get("domain"),
                          reactionTool=data.get("reactionTool"))
                     for post in data.get("posts") or [])
    return posts


def visible_slack_posts(state, opts):
    return slack_posts(slack_channels(state, opts)) if slack_metadata(state, opts)["shown"] else []


def slack_due(read, now, stale_after):
    attempted = read.get("attemptedAt")
    return attempted is None or now - attempted > stale_after


def stale_rows(posts, slack, records, orc_runs, requested_keys, now):
    """Open PRs whose first post is STALE_DAYS old and still has no picked-up
    reaction, oldest first. Yours count too, so you can bump them."""
    first = {}
    for post in posts:
        for link in post["links"]:
            first[link["key"]] = min(first.get(link["key"], post["epoch"]), post["epoch"])
    cutoff = now - STALE_DAYS * 86400
    rows = []
    for key, summary in slack.items():
        record = records.get(key)
        if (record and record["state"] == "OPEN" and not record["isDraft"]
                and summary["state"] == "waiting" and first[key] <= cutoff):
            row = to_row(record, slack, orc_runs, requested_keys)
            row["waitingSince"] = summary["postedAt"]
            rows.append(row)
    rows.sort(key=lambda row: row["waitingSince"] or "")
    return rows


def detect_team(posts, authors, viewer):
    counts, latest = collections.Counter(), {}
    for post in posts:
        for link in post["links"]:
            if link["tag"] != "All" and viewer and authors.get(link["key"], "").lower() == viewer.lower():
                counts[link["tag"]] += 1
                latest[link["tag"]] = max(latest.get(link["tag"], 0), post["epoch"])
    if not counts:
        return None
    return max(counts, key=lambda tag: (counts[tag], latest[tag]))


def to_row(record, slack, orc_run, requested_keys):
    key = key_for_url(record["url"])
    row = {k: v for k, v in record.items() if k not in ("body", "reviews")}
    row.update(slack=slack.get(key), orcRun=orc_run.get(key),
               reviewRequestedFromYou=key in requested_keys, waitingSince=None)
    return row


def needs_rereview(row):
    activity = row.get("reviewActivity") or {}
    return bool(activity.get("repliedAt") or activity.get("pushedAt"))


def empty_state():
    return {"version": 1, "attemptedAt": None, "fetchedAt": None,
            "github": {"ok": True, "error": None, "fetchedAt": None, "data": None},
            "slack": {"channels": {}},
            "orcRuns": {}, "reviewRuns": {}}


def assemble(state, opts, refreshing, now=None):
    now = time.time() if now is None else now
    data = state["github"].get("data") or {}
    scope = _effective_scope(opts)
    github = {group: [r for r in data.get(group) or [] if in_scope(r["repo"], scope)]
              for group in ("mine", "requested", "reviewed", "linked")}
    viewer = data.get("viewer")
    posts = visible_slack_posts(state, opts)
    notices = []
    sections = DEFAULT_SECTIONS
    if opts.get("sections") is not None:
        try:
            sections = validate_sections(opts["sections"])
        except ValueError as error:
            notices.append("prManager.sections is invalid: %s; using the default sections." % error)
    records = {}
    for group in ("linked", "requested", "mine"):
        for record in github[group]:
            records[key_for_url(record["url"])] = record
    requested_keys = {key_for_url(r["url"]) for r in github["requested"]}
    slack = slack_by_pr(posts, opts)
    orc_runs = state.get("orcRuns") or {}
    posted = {key: records[key] for key in slack
              if key in records and records[key]["state"] == "OPEN" and not records[key]["isDraft"]
              and (not viewer or records[key]["author"].lower() != viewer.lower())}
    waiting = {key: record for key, record in posted.items() if slack[key]["state"] == "waiting"}
    for record in github["requested"]:
        if record["state"] == "OPEN":
            waiting[key_for_url(record["url"])] = record
    # Your review re-requested on a PR you already reviewed is a review you
    # started, not a new one to pick up.
    started = {key_for_url(r["url"]) for r in github["reviewed"]
               if (r.get("reviewActivity") or {}).get("reviewedAt")}
    waiting_rows = []
    for key, record in waiting.items():
        if key in started:
            continue
        row = to_row(record, slack, orc_runs, requested_keys)
        row["waitingSince"] = (row["slack"] or {}).get("postedAt") or record["createdAt"]
        waiting_rows.append(row)
    waiting_rows.sort(key=lambda row: row["waitingSince"] or "")
    link_related(waiting_rows)
    posted_rows = []
    for record in posted.values():
        row = to_row(record, slack, orc_runs, requested_keys)
        row["waitingSince"] = row["slack"]["postedAt"]
        posted_rows.append(row)
    posted_rows.sort(key=lambda row: row["waitingSince"] or "")
    link_related(posted_rows)
    reviewed_rows = [to_row(r, slack, orc_runs, requested_keys) for r in github["reviewed"]
                     if r["state"] == "OPEN"
                     and (key_for_url(r["url"]) not in waiting or key_for_url(r["url"]) in started)
                     and (not viewer or r["author"].lower() != viewer.lower())]
    reviewed_rows.sort(key=lambda row: row.get("updatedAt") or "", reverse=True)
    reviewed_rows.sort(key=lambda row: (not (row.get("reviewActivity") or {}).get("reRequestedAt"),
                                        not needs_rereview(row)))
    link_related(reviewed_rows)
    mine = [to_row(r, slack, orc_runs, requested_keys) for r in github["mine"]
            if r["state"] == "OPEN"]
    for row in mine:
        row["actionReasons"] = action_reasons(row)
    link_related(mine)
    authors = {key: record["author"] for key, record in records.items()}
    return {
        "viewer": {"login": viewer} if viewer else None,
        "onboardingComplete": opts.get("repoScope") is not None,
        "repoScope": opts.get("repoScope"),
        "visibleLists": opts["visibleLists"],
        "columns": opts["columns"],
        "refreshing": refreshing,
        "fetchedAt": state.get("fetchedAt"),
        "github": {k: state["github"].get(k) for k in ("ok", "error", "fetchedAt")},
        "slack": slack_metadata(state, opts),
        "team": {"detected": detect_team(posts, authors, viewer),
                 "tags": sorted({link["tag"] for post in posts for link in post["links"]})},
        "notices": notices,
        "waiting": waiting_rows,
        # Every open post by someone else in the order it was posted, picked
        # up or not: the page lists your team's from here.
        "posted": posted_rows,
        "stale": stale_rows(posts, slack, records, orc_runs, requested_keys, now),
        "reviewed": reviewed_rows,
        "sections": assign_sections(mine, sections, viewer),
        # Unfiltered, so a configured section that matches none of your PRs
        # never hides one from the assistant's proposals.
        "mine": mine,
        # Decided from the config, never from the sections sent back: only
        # sections with rows are sent, so an empty Ready to merge is normal.
        "customSections": sections is not DEFAULT_SECTIONS
        and not {"ready", "needs-action"} <= {section["id"] for section in sections},
        "readyToOpen": [],
    }


def refresh_slack_channel(name, read, opts, now, open_keys, sources_changed, link=None):
    if sources_changed is not None and sources_changed.is_set():
        return
    channel_opts = {**opts, "slackChannel": name,
                    "slackChannelId": opts["slackChannelId"] if name == opts["slackChannel"] else None}
    data = read.get("data") or {}
    read["attemptedAt"] = now
    try:
        fresh = fetch_slack(channel_opts, data.get("channelId"), now, data.get("posts"), open_keys, link)
        read.update(error=fresh.pop("warning", None), fetchedAt=iso(now), data=fresh, connected=True)
    except SlackNotConnected as error:
        read.update(error=str(error), connected=False)
    except SourceError as error:
        # Signed in, a failed read says nothing about the sign-in.
        read.update(error=str(error), **({"connected": None} if link is not None else {}))
    except Exception as error:   # a parser bug must not take GitHub down with it
        read.update(error="Slack could not be read: %s." % error)


def refresh_state(previous, opts, runs_dir, now=None, force=False, slack=True, sources_changed=None,
                  link=None, check=False):
    """A new state from GitHub, and from Slack, unless slack is False. With
    Orc signed in to Slack (`link`), a channel is read when forced or when
    its read is SLACK_STALE_SECONDS old. Signed out, Slack is read only for
    `check`, Check now, through a Claude Code session. A source that fails
    keeps its last good data and reports why."""
    now = time.time() if now is None else now
    state = json.loads(json.dumps(previous))
    state["attemptedAt"] = now
    channels = slack_channels(state, opts)
    state["slack"] = {"channels": channels}
    previous_linked = (previous["github"].get("data") or {}).get("linked") or []
    linked_keys = {link["key"] for post in visible_slack_posts(state, opts) for link in post["links"]}
    scope = _effective_scope(opts)
    orgs, repos = scope["orgs"], scope["repos"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        searching = pool.submit(search_github, orgs, repos)
        # Slack is the slow source, so PRs it linked last time load alongside it.
        open_keys = {key_for_url(r["url"]) for r in previous_linked if r["state"] not in ("MERGED", "CLOSED")}
        prefetching = pool.submit(fetch_linked, [
            r["url"] for r in previous_linked if r["state"] != "MERGED" and in_scope(r["repo"], scope)
            and key_for_url(r["url"]) in linked_keys
        ])
        direct = link if link is not None and signed_in(link, opts) else None
        if slack and opts.get("useSlack", True) and opts.get("repoScope") is not None and (direct or check):
            with concurrent.futures.ThreadPoolExecutor(max_workers=SLACK_WORKERS) as slack_pool:
                for name, read in channels.items():
                    if force or check or slack_due(read, now, SLACK_STALE_SECONDS):
                        slack_pool.submit(refresh_slack_channel, name, read, opts, now, open_keys, sources_changed,
                                          direct)
        try:
            github = fetch_github(searching.result(), visible_slack_posts(state, opts), opts.get("linearWorkspace"),
                                  state["github"].get("data"), prefetching.result(), orgs, repos)
            state["github"] = {"ok": True, "error": None, "fetchedAt": iso(now), "data": github}
        except SourceError as error:
            state["github"].update(ok=False, error=str(error))
    state["orcRuns"] = orc_runs_by_pr(runs_dir)
    state["reviewRuns"] = review_runs_by_pr(runs_dir)
    state["fetchedAt"] = iso(now)
    return state


def signed_in(link, opts):
    """Whether Orc's own Slack sign-in can read the configured server. A
    Keychain that cannot be read counts as signed out."""
    try:
        return link.signed_in(opts["slackMcpUrl"])
    except (OSError, ValueError):
        return False


def _start_thread(target):
    threading.Thread(target=target, name="orc-pr-manager-refresh", daemon=True).start()


def _write_json(path, data):
    """Replace the JSON file at `path` whole, so a reader never sees half of it."""
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".%s." % os.path.basename(path))
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(data, handle)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


# A conflict run that was cancelled or failed resolved nothing, so the page
# offers Resolve the conflict again.
CONFLICT_RUN_OVER = ("cancelled", "failed")


class Manager:
    PrManagerError = PrManagerError

    def __init__(self, config_dir, runs_dir, read_config, start=None, clock=time.time, slack=None):
        self.config_dir = config_dir
        # Orc's own Slack sign-in, kept on this Mac beside the cache.
        self.slack = slack or slack_link.Link(os.path.join(config_dir, "pr-manager", "slack-sign-in.json"))
        self.runs_dir = runs_dir
        self.cache_path = os.path.join(config_dir, "pr-manager", "cache.json")
        # The run Resolve the conflict started for each PR, keyed like key_for_url.
        self.conflict_runs_path = os.path.join(config_dir, "pr-manager", "conflict-runs.json")
        self._conflict_lock = threading.Lock()
        self.read_config = read_config
        self.clock = clock
        self._start = start or _start_thread
        self._lock = threading.Lock()
        self._state = None
        self._refreshing = False
        self._sources_changed = threading.Event()
        self._refresh_pending = False
        self._check_pending = False
        self._details = {}
        self._remotes = {}
        self._repos_cache = None

    def options(self):
        config, _mtime, _error = self.read_config()
        return settings(config if isinstance(config, dict) else {}), config

    def _state_locked(self):
        if self._state is None:
            try:
                with open(self.cache_path) as handle:
                    loaded = json.load(handle)
                self._state = loaded if isinstance(loaded, dict) and loaded.get("version") == 1 \
                    else empty_state()
            except (OSError, ValueError):
                self._state = empty_state()
        return self._state

    def request_refresh(self, force=False, slack=True, stale_after=GITHUB_STALE_SECONDS, after_save=False,
                        check=False):
        """Start a refresh when one is due. `check` is Check now: the only
        read that may go through Claude Code while Orc is signed out of Slack."""
        opts, _config = self.options()
        if opts.get("repoScope") is None:
            return False
        slack = slack and opts.get("useSlack", True)
        direct = slack and signed_in(self.slack, opts)
        with self._lock:
            state = self._state_locked()
            now = self.clock()
            stale = state.get("attemptedAt") is None or now - state["attemptedAt"] > stale_after
            # The assistant's GitHub-only refreshes keep attemptedAt fresh, so
            # Slack goes by its own last read.
            stale = stale or (direct and any(slack_due(read, now, SLACK_STALE_SECONDS)
                                             for read in slack_channels(state, opts).values()))
            if self._refreshing:
                self._refresh_pending = self._refresh_pending or after_save
                self._check_pending = self._check_pending or (check and after_save)
                return False
            if not (force or stale):
                return False
            self._refreshing = True
        self._start(lambda: self._refresh(force, slack, check))
        return True

    def _refresh(self, force=False, slack=True, check=False):
        with self._lock:
            previous = self._state_locked()
            sources_changed = self._sources_changed
        try:
            opts, _config = self.options()
            state = refresh_state(previous, opts, self.runs_dir, self.clock(), force, slack, sources_changed,
                                  self.slack, check)
        except Exception as error:
            state = json.loads(json.dumps(previous))
            state["attemptedAt"] = self.clock()
            state["github"].update(ok=False, error="The PR refresh failed: %s." % error)
        with self._lock:
            if sources_changed.is_set():
                state["slack"] = self._state_locked()["slack"]
            try:
                self._save(state)
            except OSError as error:
                state["github"].update(ok=False, error="The PR refresh could not be saved: %s." % error)
            self._state = state
            pending, check_pending = self._refresh_pending, self._check_pending
            self._refresh_pending = self._check_pending = False
            self._refreshing = pending
        if pending:
            self._start(lambda: self._refresh(force=True, check=check_pending))

    def _save(self, state):
        _write_json(self.cache_path, state)

    def _settle(self, key, live_state):
        """Carry a state the detail view read live into the list, so a PR seen
        merged there leaves the list before the next refresh."""
        with self._lock:
            state = self._state_locked()
            data = state["github"].get("data") or {}
            stale = [record for group in ("mine", "requested", "reviewed", "linked")
                     for record in data.get(group) or []
                     if key_for_url(record["url"]) == key and record["state"] != live_state]
            for record in stale:
                record["state"] = live_state
            if stale:
                self._save(state)

    def _project_remote(self, project):
        if not isinstance(project, str) or not project.strip():
            return None
        path = os.path.realpath(os.path.expanduser(project))
        if path not in self._remotes:
            self._remotes[path] = remote_repo(path)
        return self._remotes[path]

    def _project_in_scope(self, project, scope):
        if scope is None or scope.get("mode") == "all":
            return True
        repo = self._project_remote(project)
        return bool(repo and in_scope(repo, scope))

    def snapshot(self, force=False):
        opts, config = self.options()
        scope = opts.get("repoScope")
        if scope is None:
            snapshot = {**assemble(empty_state(), opts, False), "readyToOpen": []}
            del snapshot["mine"]
            return snapshot
        self.request_refresh(force)
        with self._lock:
            state, refreshing = self._state_locked(), self._refreshing
        accept_project = None if scope["mode"] == "all" else lambda path: self._project_in_scope(path, scope)
        # Read on every poll rather than cached with GitHub's data, so a run
        # leaves the list as soon as its PR opens.
        snapshot = {**assemble(state, opts, refreshing, self.clock()), "readyToOpen": runs_ready_to_open(self.runs_dir, accept_project),
                    "repoProjects": self._repo_projects(config)}
        # The page reaches these rows through its sections; sending them
        # twice would double the payload.
        del snapshot["mine"]
        return snapshot

    def watched(self):
        """The snapshot the assistant watches for PRs that need you. The
        server's watch loop asks all day, so this is what reads Slack every
        SLACK_STALE_SECONDS with the page closed, once Orc is signed in. None
        until onboarding is complete and the Pull requests page has loaded once."""
        opts, _config = self.options()
        if opts.get("repoScope") is None:
            return None
        with self._lock:
            fetched = self._state_locked().get("fetchedAt")
        if fetched is None:
            return None
        # Off on Settings' Integrations page, the saved read is all it gets.
        if integrations.enabled(_config, "github"):
            self.request_refresh(slack=integrations.enabled(_config, "slack"), stale_after=WATCH_STALE_SECONDS)
        opts, _config = self.options()
        with self._lock:
            state = self._state_locked()
        # Read with the PR data, since the host loop watches every 15 s; a
        # cache saved before it was kept has none until the next refresh.
        reviews = state["reviewRuns"] if "reviewRuns" in state else review_runs_by_pr(self.runs_dir)
        return {**assemble(state, opts, False, self.clock()), "reviewRuns": reviews}

    def review_posts(self):
        """Each PR's Slack post from the last saved read, keyed like
        key_for_url. The run list asks on every poll, so with Orc signed in to
        Slack a read older than SLACK_STALE_SECONDS starts one background
        refresh, and never a first one: Slack is read only for someone who has
        completed onboarding and opened Pull requests."""
        opts, config = self.options()
        scope = opts.get("repoScope")
        if scope is None:
            return {}
        with self._lock:
            state = self._state_locked()
            reads = slack_channels(state, opts).values()
        if not opts.get("useSlack", True):
            return {}
        now = self.clock()
        # A refresh reads GitHub with Slack, so both switches must allow it.
        background = (integrations.enabled(config, "slack") and integrations.enabled(config, "github")
                      and signed_in(self.slack, opts))
        if background and any(read.get("attemptedAt") is not None
                              and slack_due(read, now, SLACK_STALE_SECONDS) for read in reads):
            self.request_refresh()
        posts = slack_by_pr(visible_slack_posts(state, opts), opts)
        return {key: post for key, post in posts.items() if in_scope(key, scope)}

    def slack_status(self):
        """What Settings' Integrations page shows of Slack, from the saved
        reads alone: this never starts one."""
        opts, _config = self.options()
        with self._lock:
            reads = slack_channels(self._state_locked(), opts)
            checking = self._refreshing
        channels = [{"name": name, "connected": read.get("connected"), "error": read.get("error"),
                     "readAt": read.get("fetchedAt"), "attemptedAt": iso(read.get("attemptedAt"))}
                    for name, read in reads.items()]
        try:
            sign_in = self.slack.status(opts["slackMcpUrl"])
        except (OSError, ValueError):
            sign_in = {"appSaved": False, "signedIn": False, "clientId": None}
        return {"onboarded": opts.get("repoScope") is not None, "useSlack": opts.get("useSlack", True),
                "mcpUrl": opts["slackMcpUrl"], "channels": channels, "checking": checking, "signIn": sign_in,
                "scopes": list(slack_link.SCOPES), "everySeconds": SLACK_STALE_SECONDS}

    def save_slack_app(self, client_id, client_secret):
        try:
            self.slack.save_app(client_id, client_secret)
        except slack_link.SlackError as error:
            raise PrManagerError(400, str(error)) from None
        return self.slack_status()

    def forget_slack_app(self):
        self.slack.forget_app()
        return self.slack_status()

    def slack_sign_in(self, redirect_uri):
        """The Slack page that signs Orc in, for the card to open."""
        opts, _config = self.options()
        try:
            return self.slack.start(opts["slackMcpUrl"], redirect_uri)
        except slack_link.SlackError as error:
            raise PrManagerError(409, str(error)) from None

    def finish_slack_sign_in(self, query):
        """Settle Slack's answer, then read the channels with the new sign-in."""
        notice = self.slack.finish(query)
        if notice and notice.get("ok"):
            self.request_refresh(force=True, after_save=True)
        return notice

    def slack_sign_out(self):
        self.slack.sign_out()
        return self.slack_status()

    def check_slack(self):
        """Read every review channel now, for the page's Check now."""
        opts, _config = self.options()
        if opts.get("repoScope") is None:
            raise PrManagerError(409, "Choose your repositories in Pull requests first, then check Slack.")
        if not opts.get("useSlack", True):
            raise PrManagerError(409, "Slack is switched off in Pull requests settings.")
        self.request_refresh(force=True, after_save=True, check=True)
        return self.slack_status()

    def approved_by_you(self):
        """Keys, like key_for_url, of the open PRs by others whose latest
        verdict from you is an approval, from the last saved GitHub read. A
        local review of one of them is settled: you approved it on GitHub."""
        opts, _config = self.options()
        if opts.get("repoScope") is None:
            return set()
        with self._lock:
            data = self._state_locked()["github"].get("data") or {}
        viewer = (data.get("viewer") or "").lower()
        if not viewer:
            return set()
        scope = _effective_scope(opts)
        return {key_for_url(record["url"]) for group in ("requested", "reviewed", "linked")
                for record in data.get(group) or []
                if record.get("state") == "OPEN" and in_scope(record["repo"], scope)
                and viewer in (login.lower() for login in record.get("approvedBy") or [])}

    def repositories(self, query="", force=False):
        """Organizations and repositories the viewer can select in onboarding."""
        opts, config = self.options()
        now = self.clock()
        org_names = {}
        repo_names = {}
        priority_orgs = set()
        local_repos = set()

        def add_org(login, priority=False):
            if not isinstance(login, str):
                return
            clean = login.strip()
            if not GITHUB_LOGIN_RE.fullmatch(clean):
                return
            key = clean.lower()
            if key not in org_names or priority:
                org_names[key] = clean
            if priority:
                priority_orgs.add(key)

        def add_repo(full_name, local=False):
            if not isinstance(full_name, str):
                return
            clean = full_name.strip()
            match = GITHUB_REPO_RE.fullmatch(clean)
            if not match:
                return
            key = clean.lower()
            if key not in repo_names or local:
                repo_names[key] = clean
            add_org(match[1], priority=local)
            if local:
                local_repos.add(key)

        repos_cfg = config.get("repos") if isinstance(config, dict) else None
        for project in repos_cfg if isinstance(repos_cfg, dict) else ():
            remote = self._project_remote(project)
            if remote:
                add_repo(remote, local=True)

        saved_scope = opts.get("repoScope")
        if isinstance(saved_scope, dict):
            for org in saved_scope.get("orgs") or ():
                add_org(org, priority=True)
            for repo in saved_scope.get("repos") or ():
                add_repo(repo, local=True)
        for org in opts.get("githubOrgs") or ():
            add_org(org, priority=True)

        with self._lock:
            cached_github = (self._state_locked()["github"].get("data") or {})
        viewer = cached_github.get("viewer")
        for group in ("mine", "requested", "reviewed", "linked"):
            for record in cached_github.get(group) or ():
                if isinstance(record, dict) and record.get("repo"):
                    add_repo(record["repo"])

        error = None
        cached = self._repos_cache
        if not force and cached and now - cached[0] < REPOS_CACHE_SECONDS:
            gh_viewer, gh_orgs, gh_repos = cached[1], cached[2], cached[3]
        else:
            gh_viewer, gh_orgs, gh_repos = None, [], []
            try:
                data, _errors = graphql(REPOS_QUERY, {})
                viewer_node = data.get("viewer") if isinstance(data.get("viewer"), dict) else {}
                gh_viewer = viewer_node.get("login")
                gh_orgs = [node.get("login") for node in _nodes(viewer_node.get("organizations")) if node.get("login")]
                for field in ("repositories", "repositoriesContributedTo"):
                    for node in _nodes(viewer_node.get(field)):
                        if not node.get("isArchived") and node.get("nameWithOwner"):
                            gh_repos.append(node["nameWithOwner"])
                self._repos_cache = (now, gh_viewer, gh_orgs, gh_repos)
            except SourceError as exc:
                error = str(exc)

        if gh_viewer:
            viewer = gh_viewer
            add_org(gh_viewer, priority=True)
        for org in gh_orgs:
            add_org(org, priority=True)
        for repo in gh_repos:
            add_repo(repo)

        needle = (query or "").strip()
        if len(needle) >= 2:
            try:
                data, _errors = graphql(REPO_SEARCH_QUERY, {"q": "%s archived:false in:name" % needle})
                for node in _nodes(data.get("search")):
                    if not node.get("isArchived") and node.get("nameWithOwner"):
                        add_repo(node["nameWithOwner"])
            except SourceError as exc:
                if error is None:
                    error = str(exc)

        counts = collections.Counter(name.split("/", 1)[0].lower() for name in repo_names.values())
        orgs = [
            {"login": org_names[key], "repoCount": counts.get(key, 0)}
            for key in sorted(org_names, key=lambda item: (0 if item in priority_orgs else 1, item))
        ]
        repos = [
            repo_names[key]
            for key in sorted(repo_names, key=lambda item: (0 if item in local_repos else 1, item))
        ]
        if needle:
            low = needle.lower()
            orgs = [item for item in orgs if low in item["login"].lower()]
            repos = [item for item in repos if low in item.lower()]
        return {
            "viewer": {"login": viewer} if viewer else None,
            "orgs": orgs,
            "repos": repos,
            "error": error,
        }

    def save_repo_scope(self, raw_scope, update_config):
        """Validate the scope and the supplied board preferences before updating config."""
        scope = validate_repo_scope(raw_scope)
        use_slack = raw_scope.get("useSlack")
        if use_slack is not None and type(use_slack) is not bool:
            raise PrManagerError(400, "useSlack must be true or false.")
        channel = raw_scope.get("slackChannel")
        if channel is not None:
            channel = normalize_slack_channel(channel)
            if channel is None:
                raise PrManagerError(400, "slackChannel must be a Slack channel name, such as review-requests.")
        choices = {field: validate_choices(raw_scope[field], field, allowed, required)
                   for field, (allowed, required) in BOARD_CHOICES.items() if field in raw_scope}

        source_changed = False

        def apply(config):
            nonlocal source_changed
            raw = config.get("prManager")
            pr_cfg = dict(raw) if isinstance(raw, dict) else {}
            current = settings(config)
            pr_cfg["repoScope"] = scope
            if use_slack is not None:
                pr_cfg["useSlack"] = use_slack
            pr_cfg.update(choices)
            if "slackChannels" in choices:
                primary = next(iter(choices["slackChannels"]), current["slackChannel"])
            else:
                primary = channel or current["slackChannel"]
                if channel is not None and (channel != current["slackChannel"] or not current["slackChannels"]):
                    pr_cfg.pop("slackChannels", None)
            if "slackChannels" in choices or channel is not None:
                if primary != current["slackChannel"] or current["slackChannelId"] is None:
                    pr_cfg.pop("slackChannelId", None)
                pr_cfg["slackChannel"] = primary
            updated = settings({"prManager": pr_cfg})
            if updated["useSlack"] and not updated["slackChannels"]:
                raise PrManagerError(400, "Add a review channel or turn off Slack.")
            source_changed = any(current[key] != updated[key] for key in ("repoScope", "useSlack", "slackChannels"))
            config["prManager"] = pr_cfg
            return config

        try:
            update_config(apply)
        except OSError as error:
            raise PrManagerError(500, "Could not save repository settings: %s" % error) from None
        if source_changed:
            with self._lock:
                opts, _config = self.options()
                state = self._state_locked()
                self._state = {**state, "slack": {"channels": slack_channels(state, opts)}}
                self._sources_changed.set()
                self._sources_changed = threading.Event()
                self._details.clear()
            self.request_refresh(force=True, after_save=True)
        return self.snapshot()

    def prepare_review_worktree(self, project, repo, number, base_ref):
        return prepare_review_worktree(project, repo, number, base_ref)

    def review_prompt(self, detail, viewer):
        return review_prompt(detail, viewer)

    def refresh(self):
        self.request_refresh(force=True)
        with self._lock:
            return {"refreshing": self._refreshing}

    def detail(self, url):
        """The PR page's read of one pull request. The conflict run is read
        fresh each time, so the button turns into Open conflict run as soon
        as one starts, and back once it is cancelled."""
        result = self._detail(url)
        return {**result, "conflictRun": self.conflict_run(result["url"])}

    def _read_conflict_runs(self):
        try:
            with open(self.conflict_runs_path) as handle:
                runs = json.load(handle)
        except (OSError, ValueError):
            return {}
        return runs if isinstance(runs, dict) else {}

    def conflict_run(self, url):
        """The run Resolve the conflict started for the PR at `url` while it
        is still on this machine and was not cancelled or failed, else None."""
        run_id = self._read_conflict_runs().get(key_for_url(url) or "")
        if not isinstance(run_id, str) or not run_id or os.sep in run_id or run_id.startswith("."):
            return None
        try:
            with open(os.path.join(self.runs_dir, run_id, "meta.json")) as handle:
                meta = json.load(handle)
        except (OSError, ValueError):
            return None
        if not isinstance(meta, dict) or meta.get("status") in CONFLICT_RUN_OVER:
            return None
        return run_id

    def resolve_conflict(self, url, launch, start_run):
        """Start one run that merges the base into the PR's branch, resolves
        the conflicts and runs the checks, stopping before it pushes. It is
        nested under the run that built the PR, when one did. `start_run` is
        core's orchestrator_start_run. A second click opens the first run
        rather than starting another."""
        with self._conflict_lock:
            self._details.pop(url, None)
            detail = self.detail(url)
            if detail["conflictRun"]:
                return {"runId": detail["conflictRun"], "alreadyStarted": True}
            if detail["state"] != "OPEN" or detail.get("mergeable") != "CONFLICTING":
                raise PrManagerError(409, "This pull request does not conflict with %s now."
                                     % (detail.get("baseRef") or "its base branch"))
            review = detail["review"]
            if not review["available"]:
                raise PrManagerError(409, review["reason"])
            built = detail.get("orcRun") or {}
            # A local review did not build the PR, so it has no context to hand on.
            parent = None if built.get("review") else built.get("runId")
            prompt = ((run_pull_request.BUILT_RUN_FOLLOW_UP % (parent, parent) if parent else "")
                      + run_pull_request.conflict_prompt(detail))
            try:
                run_id = start_run(os.path.basename(review["project"]), "run", prompt, launch,
                                   parent_run=parent, pr={"url": detail["url"], "reason": "conflict"},
                                   source="pr-page")
            except ValueError as error:
                raise PrManagerError(409, str(error)) from None
            runs = self._read_conflict_runs()
            runs[key_for_url(detail["url"])] = run_id
            _write_json(self.conflict_runs_path, runs)
            self._details.pop(url, None)
            return {"runId": run_id}

    def _detail(self, url):
        match = PR_URL_RE.fullmatch(url or "")
        if not match:
            raise PrManagerError(400, "Use a GitHub pull request URL like https://github.com/owner/repo/pull/1.")
        now = self.clock()
        opts, config = self.options()
        with self._lock:
            state = self._state_locked()
        cached = self._details.get(url)
        if cached and now - cached[0] < DETAIL_CACHE_SECONDS and cached[2] == opts and cached[3] is state:
            return cached[1]
        owner, name, number = match[1], match[2], int(match[3])
        try:
            data, errors = graphql(DETAIL_QUERY, {"owner": owner, "name": name, "number": number})
        except SourceError as error:
            raise PrManagerError(502, str(error)) from None
        repo = data.get("repository")
        node = repo.get("pullRequest") if isinstance(repo, dict) else None
        if not isinstance(node, dict):
            if errors and not all(_is_not_found(e) for e in errors):
                raise PrManagerError(502, "GitHub returned an error: %s" % _first_error(errors))
            raise PrManagerError(404, "That pull request was not found on GitHub.")
        author = node.get("author") if isinstance(node.get("author"), dict) else {}
        record = normalize_pr({**node, "author": {**author, "__typename": "User"}})
        self._settle(key_for_url(record["url"]), record["state"])
        opts, config = self.options()
        with self._lock:
            state = self._state_locked()
        cached_github = state["github"].get("data") or {}
        body = record.pop("body")
        record["ticket"] = ticket_for(body, record["headRef"], record["title"],
                                      cached_github.get("linearWorkspace") or opts.get("linearWorkspace"))
        assembled = assemble(state, opts, False, now)
        key = key_for_url(record["url"])
        known = next((row for row in assembled["waiting"] + [item for section in assembled["sections"]
                                                            for item in section["items"]]
                      if key_for_url(row["url"]) == key), None)
        viewer = (data.get("viewer") or {}).get("login") or cached_github.get("viewer")
        rollup = _rollup(node, "checkRollup")
        result = {**{k: v for k, v in record.items() if k != "reviews"},
                  "slack": slack_by_pr(visible_slack_posts(state, opts), opts).get(key),
                  "orcRun": (state.get("orcRuns") or {}).get(key),
                  "reviewRequestedFromYou": viewer is not None and viewer.lower() in
                  {r.lower() for r in record["requestedReviewers"]},
                  "waitingSince": None,
                  "viewer": {"login": viewer} if viewer else None,
                  "slackChannel": opts["slackChannel"],
                  "slackChannels": opts["slackChannels"],
                  "slackShown": assembled["slack"]["shown"],
                  # Markdown, for Review in Orc's QA steps (qa_steps.seeded_document).
                  "body": body,
                  "bodyHtml": node.get("bodyHTML") or "",
                  "reviews": record["reviews"],
                  "checks": [check_row(item) for item in _nodes((rollup or {}).get("contexts"))],
                  "changedFiles": node.get("changedFiles") or 0,
                  "conversation": conversation(node),
                  "commits": (node.get("commitCount") or {}).get("totalCount") or 0,
                  "review": self.review_availability(record["repo"], config),
                  "merge": merge_availability(record, node.get("id"), node.get("headRefOid"),
                                              repo.get("viewerDefaultMergeMethod"))}
        if known:
            result["waitingSince"] = known.get("waitingSince")
            result["actionReasons"] = known.get("actionReasons") or []
            result["reviewRequestedFromYou"] = result["reviewRequestedFromYou"] or known["reviewRequestedFromYou"]
        self._details = {u: v for u, v in self._details.items() if now - v[0] < DETAIL_CACHE_SECONDS}
        self._details[url] = (now, result, opts, state)
        return result

    def merge(self, url, head):
        """Merge the PR on GitHub with the viewer's default method, only while
        its head is still the commit the page showed."""
        self._details.pop(url, None)
        detail = self.detail(url)
        merge = detail["merge"]
        if not merge["available"]:
            raise PrManagerError(409, merge["reason"])
        if head != merge["headOid"]:
            raise PrManagerError(409, "The pull request changed since this page loaded. Check it again before merging.")
        try:
            data, errors = graphql(MERGE_MUTATION, {"id": merge["id"], "method": merge["method"], "head": head}, "actions")
        except SourceError as error:
            raise PrManagerError(502, str(error)) from None
        self._details.pop(url, None)
        if errors:
            raise PrManagerError(409, "GitHub did not merge it: %s" % _first_error(errors))
        state = (((data.get("mergePullRequest") or {}).get("pullRequest")) or {}).get("state") or "MERGED"
        self._settle(key_for_url(url), state)
        return {"state": state}

    def request_review(self, url):
        """Ask GitHub for the viewer's own review of someone else's open PR."""
        self._details.pop(url, None)
        detail = self.detail(url)
        viewer = (detail.get("viewer") or {}).get("login")
        if detail["state"] != "OPEN":
            raise PrManagerError(409, "This pull request is already %s." % detail["state"].lower())
        if viewer and detail["author"].lower() == viewer.lower():
            raise PrManagerError(409, "This is your own pull request, so you can't be its reviewer.")
        try:
            data, errors = graphql(VIEWER_ID_QUERY, {}, "actions")
            user = (data.get("viewer") or {}).get("id")
            if not user:
                raise SourceError("GitHub did not say who you are: %s" % _first_error(errors))
            _data, errors = graphql(REQUEST_REVIEW_MUTATION, {"id": detail["merge"]["id"], "user": user}, "actions")
        except SourceError as error:
            raise PrManagerError(502, str(error)) from None
        if errors:
            raise PrManagerError(409, "GitHub did not add you as a reviewer: %s" % _first_error(errors))
        self._details.pop(url, None)
        return {"requested": True}

    def add_eyes(self, url):
        """Put the viewer's eyes on the PR's Slack post, and show them on the
        page before the next Slack read."""
        if not PR_URL_RE.fullmatch(url or ""):
            raise PrManagerError(400, "Use a GitHub pull request URL like https://github.com/owner/repo/pull/1.")
        key = key_for_url(url)
        opts, _config = self.options()
        if not opts.get("useSlack", True):
            raise PrManagerError(409, "Slack is turned off in the Pull requests settings.")
        with self._lock:
            state = self._state_locked()
            target = min((post for post in visible_slack_posts(state, opts)
                          if any(link["key"] == key for link in post["links"])),
                         key=lambda post: post["epoch"], default=None)
        if target is None:
            names = ", ".join("#" + name for name in opts["slackChannels"]) or "the selected Slack channels"
            raise PrManagerError(409, "This pull request has no post in %s to react to." % names)
        ts, channel, channel_id = target["ts"], target["channel"], target["channelId"]
        try:
            link = self.slack if signed_in(self.slack, opts) else None
            added = add_slack_reaction(opts, channel_id, ts, target["reactionTool"], link)
        except SourceError as error:
            raise PrManagerError(502, str(error)) from None
        with self._lock:
            opts, _config = self.options()
            state = self._state_locked()
            selected = slack_channels(state, opts).get(channel) or {}
            data = selected.get("data") or {}
            posts = (data.get("posts") or []) if data.get("channelId") == channel_id else []
            post = next((post for post in posts if post["ts"] == ts), None)
            if post is not None:
                mine = next((r for r in post["reactions"] if r["name"] == PICKED_UP_REACTION), None)
                if mine:
                    mine["count"] += int(added)
                else:
                    post["reactions"].append({"name": PICKED_UP_REACTION, "count": 1})
                self._save(state)
            self._details.clear()
            summary = slack_by_pr(visible_slack_posts(state, opts), opts)
        return {"slack": summary.get(key)}

    def _repo_projects(self, config):
        """Each configured project's folder by its GitHub repository, lower-cased."""
        repos = config.get("repos") if isinstance(config, dict) else None
        found = {}
        for key in repos if isinstance(repos, dict) else ():
            remote = self._project_remote(key) if isinstance(key, str) else None
            if remote:
                found.setdefault(remote.lower(), os.path.realpath(os.path.expanduser(key)))
        return found

    def project_for(self, repo, config):
        return self._repo_projects(config).get(repo.lower())

    def review_availability(self, repo, config):
        project = self.project_for(repo, config)
        if not project:
            return {"available": False, "project": None,
                    "reason": "No Orc project for %s. Add it in Settings first." % repo}
        return {"available": True, "reason": None, "project": project}


def merge_availability(record, node_id, head, default_method):
    method = default_method if default_method in MERGE_METHODS else "MERGE"
    reason = None
    if record["state"] != "OPEN":
        reason = "This pull request is already %s." % record["state"].lower()
    elif record["isDraft"]:
        reason = "Mark it ready for review on GitHub before merging."
    elif record["mergeable"] == "CONFLICTING":
        reason = "Resolve the conflict with %s before merging." % (record["baseRef"] or "the base branch")
    elif not node_id or not head:
        reason = "GitHub did not say which commit to merge."
    return {"available": reason is None, "reason": reason, "method": method, "id": node_id, "headOid": head}


def check_row(item):
    if item.get("__typename") == "StatusContext":
        return {"name": item.get("context") or "Status", "state": item.get("state") or "PENDING",
                "url": safe_web_url(item.get("targetUrl"))}
    completed = (item.get("status") or "").upper() == "COMPLETED"
    return {"name": item.get("name") or "Check",
            "state": (item.get("conclusion") or "UNKNOWN") if completed else "PENDING",
            "url": safe_web_url(item.get("detailsUrl"))}


def git(repo, *args):
    try:
        result = subprocess.run(["git", "-C", str(repo), *args], env=clean_env(),
                                capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        raise PrManagerError(409, "git %s did not finish." % args[0]) from None
    if result.returncode:
        lines = [line for line in (result.stderr or "").strip().splitlines() if line.strip()]
        raise PrManagerError(409, lines[-1][:240] if lines else "git %s failed." % args[0])
    return result.stdout.strip()


def git_no_hooks(repo, *args):
    """Run git without repository hooks or ext:: transport so checking out an
    untrusted pull request branch cannot execute hook scripts."""
    return git(repo, "-c", "core.hooksPath=/dev/null", "-c", "protocol.ext.allow=never", *args)


def remote_repo(path):
    try:
        match = GITHUB_REMOTE_RE.fullmatch(git(path, "remote", "get-url", "origin"))
    except PrManagerError:
        return None
    return match[1] if match else None


def review_worktree_path(project, repo, number):
    project = Path(project)
    return project.parent / (project.name + "-worktrees") / ("review-%s-pr-%d" % (repo.split("/")[-1], number))


def prepare_review_worktree(project, repo, number, base_ref):
    """The PR's head checked out on `orc-review/pr-<n>` in a sibling worktree.
    Only refs are fetched in the project itself; its branch and files are
    never touched. An existing worktree is reused only when it is clean.
    Repository Git hooks are disabled during checkout so a hostile branch
    cannot run hook scripts."""
    if not re.fullmatch(r"[A-Za-z0-9._/-]{1,200}", base_ref or "") or base_ref.startswith(("-", "/")):
        raise PrManagerError(409, "The pull request's base branch name is not usable: %s" % base_ref)
    branch = review_branch(number)
    pull_ref = "refs/orc-pull/%d/head" % number
    git_no_hooks(project, "fetch", "--no-tags", "--no-write-fetch-head", "origin",
                 "+refs/pull/%d/head:%s" % (number, pull_ref),
                 "+refs/heads/%s:refs/remotes/origin/%s" % (base_ref, base_ref))
    head = git_no_hooks(project, "rev-parse", "--verify", pull_ref + "^{commit}")
    path = review_worktree_path(project, repo, number)
    if path.exists():
        common = git_no_hooks(path, "rev-parse", "--path-format=absolute", "--git-common-dir")
        expected = git_no_hooks(project, "rev-parse", "--path-format=absolute", "--git-common-dir")
        if os.path.realpath(common) != os.path.realpath(expected):
            raise PrManagerError(409, "%s exists and is not a worktree of %s." % (path, project))
        if git_no_hooks(path, "status", "--porcelain"):
            raise PrManagerError(409, "The review worktree at %s has uncommitted changes." % path)
        git_no_hooks(path, "checkout", "-q", "-B", branch, head)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        git_no_hooks(project, "worktree", "prune")
        git_no_hooks(project, "worktree", "add", "-q", "-B", branch, str(path), head)
    # gh resolves `gh pr view` in the worktree through this upstream.
    git_no_hooks(project, "config", "branch.%s.remote" % branch, "origin")
    git_no_hooks(project, "config", "branch.%s.merge" % branch, "refs/pull/%d/head" % number)
    return str(path)


def review_prompt(detail, viewer=None):
    url, title, number = detail["url"], detail["title"], detail["number"]
    where = review_where(number, detail["baseRef"])
    return ('Review pull request %s by %s: "%s". %s Read-only: do not edit files.'
            % (url, detail["author"], title, where))
