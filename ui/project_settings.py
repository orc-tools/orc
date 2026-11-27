"""A project's saved settings in ~/.orc/config.json, for the hook and helpers
that run outside serve.py.

stdlib-only, like the rest of ui/.
"""
import json
import os

SHIP_ACTIONS = ("merge-and-push", "yeet", "merge", "pr")
# The Ship actions that merge to main, in the order the Ship menu lists them.
MERGE_SHIP_ACTIONS = ("merge-and-push", "yeet", "merge")
# The Ship actions that push the default branch once the merge lands.
PUSH_SHIP_ACTIONS = ("merge-and-push", "yeet")
# Yeet it merges and pushes like Merge and push, then settles the run once the
# push lands, so a finished run leaves the list in one click.
SETTLE_SHIP_ACTIONS = ("yeet",)
# What a fresh install's Ship gate leads with: a pull request asks nothing of
# a project's history that its maintainers have not reviewed.
DEFAULT_SHIP_ACTION = "pr"
# Installs that predate Open PR as everyone's default were pinned to Merge and
# push. The first start of this version moves them to Open PR once, and the
# config's `SHIP_ACTION_SWITCHED` key keeps a later choice from moving again.
LEGACY_SHIP_ACTION = "merge-and-push"
SHIP_ACTION_SWITCHED = "shipActionSwitchedToPr"
# What a PR review round's push button does when the round has replies to
# post: push the fixes and post the replies in one click, or push only the
# fixes and leave the replies for their own Push comments click.
PR_PUSH_ACTIONS = ("comments-and-commits", "commits")
DEFAULT_PR_PUSH_ACTION = "comments-and-commits"
MAX_RUNS_AT_ONCE = 9
MAX_GENERATED_RULES = 50

MAX_CONTEXT_WORDS = 30
MIN_QA_STEPS = 2
MAX_QA_STEPS = 4
MAX_BODY_LINES = 6

DEFAULT_PR_BODY_INSTRUCTIONS = f"""Start with a ## headline describing what changed. Explain why it was needed in one sentence of up to {MAX_CONTEXT_WORDS} words.
Under ### QA, give reviewers {MIN_QA_STEPS}–{MAX_QA_STEPS} short steps to try the happy path on their own development host.
Keep the body to {MAX_BODY_LINES} lines, excluding headings, template scaffolding, checklists and screenshots. Omit file-by-file descriptions and implementation history.
When needed, give follow-ups, scope exclusions, risks or related fixes one visible line each. Separate distinct follow-up tasks with a semicolon."""


def generated_files(project):
    """Per-project rules for generated files: [{"pattern": str, "command": str}].

    When a merge touches or conflicts on a matching file, Orc runs `command` in
    the checkout instead of merging the file by hand. Invalid or unsafe rules
    are skipped so a hand-edited config never breaks merges or settings."""
    raw = project.get("generatedFiles") if isinstance(project, dict) else None
    if not isinstance(raw, list):
        return []
    rules = []
    seen = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        pattern = item.get("pattern") if isinstance(item.get("pattern"), str) else item.get("files")
        command = item.get("command")
        if not isinstance(pattern, str) or not isinstance(command, str):
            continue
        pattern = pattern.strip().replace("\\", "/")
        while pattern.startswith("./"):
            pattern = pattern[2:]
        command = command.strip()
        if (not pattern or not command or len(pattern) > 240 or len(command) > 1000
                or pattern.startswith(("/", "~"))
                or any(part in ("", ".", "..") for part in pattern.split("/"))):
            continue
        key = (pattern, command)
        if key in seen:
            continue
        seen.add(key)
        rules.append({"pattern": pattern, "command": command})
        if len(rules) >= MAX_GENERATED_RULES:
            break
    return rules


MAX_DEPLOY_COMMAND = 1000


def deploy_command(project):
    """The project's Deploy after merge command, or '' for none. Orc runs it
    in the project's checkout once a run's merge reaches origin (ui/deploys.py)."""
    raw = project.get("deployCommand") if isinstance(project, dict) else None
    if not isinstance(raw, str):
        return ""
    command = raw.strip()
    return command if len(command) <= MAX_DEPLOY_COMMAND and "\0" not in command else ""


def read_config(config_dir=None):
    """~/.orc/config.json as a dict; {} when it is missing or unreadable."""
    path = os.path.join(config_dir or os.path.join(os.path.expanduser("~"), ".orc"), "config.json")
    try:
        with open(path) as handle:
            config = json.load(handle)
    except (OSError, ValueError):
        return {}
    return config if isinstance(config, dict) else {}


def entry(main_repo, config_dir=None):
    """The project's settings, merged across the keys that name it: Settings
    saves the ~ form, and older entries hold absolute paths. A missing or
    unreadable config, or an unregistered project, is an empty entry."""
    if not isinstance(main_repo, str) or not main_repo:
        return {}
    try:
        repos = read_config(config_dir).get("repos")
        target = os.path.realpath(os.path.expanduser(main_repo))
        merged = {}
        for key, value in repos.items():
            if isinstance(value, dict) and os.path.realpath(os.path.expanduser(key)) == target:
                merged.update(value)
        return merged
    except (OSError, ValueError, AttributeError):
        return {}


def runs_at_once(project):
    """How many of the project's runs may work at the same time, or None for
    no limit. The rest wait in the project's queue."""
    value = project.get("runsAtOnce") if isinstance(project, dict) else None
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_RUNS_AT_ONCE:
        return None
    return value


def known_ship_action(value):
    """`value` as a current Ship action, or None."""
    return value if isinstance(value, str) and value in SHIP_ACTIONS else None


def default_ship_action(config):
    """The Ship action every project without its own uses: the config's
    top-level `shipAction`, else Open PR."""
    value = config.get("shipAction") if isinstance(config, dict) else None
    return known_ship_action(value) or DEFAULT_SHIP_ACTION


def pr_push_action(config):
    """The config's top-level `prPushAction`, else Push comments & commits."""
    value = config.get("prPushAction") if isinstance(config, dict) else None
    return value if value in PR_PUSH_ACTIONS else DEFAULT_PR_PUSH_ACTION


PR_PUSH_HINTS = {
    "comments-and-commits": (
        "Push to a PR (Settings) is Push comments & commits. When the user asks in this chat to push this "
        "run's open PR (\"push\", \"push it\"), do what that button does: push the commits, then answer the "
        "PR's review comments those commits fix, each with a reply checked through talk-like-rick and a "
        "\U0001f44d reaction; a comment the push leaves unchanged gets a reply only. With a review round "
        "waiting (`prFeedback`), push it with `--post-replies`; with none, follow \"Push with no review "
        "round\" in orc-pr's references/pr-feedback-and-ci.md. A PR with no review comments just gets the push."),
    "commits": (
        "Push to a PR (Settings) is Push commits. When the user asks in this chat to push this run's open "
        "PR, push the commits only: replies to people wait for the user's Push comments, and Zerohands "
        "replies go out as they do today."),
}


PR_ROUND_HINT = (
    " A chat request to fix, address or answer this PR's review comments, Zerohands' included, runs "
    "orc-pr's review round (`/orc-pr feedback <run-id>`, references/pr-feedback-and-ci.md), never a "
    "loose edit, so its replies are recorded for the push.")


def has_open_pr(meta):
    """Whether a run is linked to a pull request it can push to."""
    if not isinstance(meta, dict):
        return False
    urls = meta.get("prUrls") if isinstance(meta.get("prUrls"), list) else [meta.get("prUrl")]
    if meta.get("source") == "pr":
        urls = [*urls, meta.get("sourceUrl")]
    return any(isinstance(url, str) and "/pull/" in url for url in urls)


def pr_push_hook_context(meta, config_dir=None):
    """The turn context that tells a run with an open PR what a chat "push"
    does, so it matches the Push button and Settings > Push to a PR."""
    if not has_open_pr(meta) or meta.get("route") == "orchestration-worker":
        return ""
    return PR_PUSH_HINTS[pr_push_action(read_config(config_dir))] + PR_ROUND_HINT


def offer_other_ship_actions(config):
    """Whether the Ship button's menu offers the other Ship actions for one
    run. The config's top-level `offerOtherShipActions`; on unless it is
    `false`, so the button always does the project's own action."""
    return not (isinstance(config, dict) and config.get("offerOtherShipActions") is False)


def offer_ship_when_done(config):
    """Whether the composer and Chat offer Ship when done. The config's
    top-level `offerShipWhenDone`; on unless it is `false`."""
    return not (isinstance(config, dict) and config.get("offerShipWhenDone") is False)


def project_override(project):
    """The project's own Ship action, or None when it uses the default.
    `orc-init` used to write `offerMergeToMain: false` with no `shipAction`,
    which reads as `pr`."""
    project = project if isinstance(project, dict) else {}
    action = known_ship_action(project.get("shipAction"))
    if action:
        return action
    return "pr" if project.get("offerMergeToMain") is False else None


def ship_action(project, default=DEFAULT_SHIP_ACTION):
    """What the project's Ship gate leads with: its own choice, else `default`
    (the global one from `default_ship_action`)."""
    return project_override(project) or default


def project_ship_action(main_repo, config_dir=None):
    """`ship_action` for a project path, read from the config on disk."""
    return ship_action(entry(main_repo, config_dir),
                       default_ship_action(read_config(config_dir)))


def pin_default_ship_action(config):
    """Settle the config's global Ship action once, and say whether it changed.

    Run when Orc starts and before a project is first added. A config with no
    `shipAction`, or the Merge and push an older Orc pinned for existing
    installs, gets Open PR. Yeet it and Merge to main stay. Either way the
    config is marked, so a Ship action picked after this one stays. The old
    `newProjectShipAction` goes too: new projects use the global one."""
    if not isinstance(config, dict) or config.get(SHIP_ACTION_SWITCHED) is True:
        return False
    action = known_ship_action(config.get("shipAction"))
    config["shipAction"] = DEFAULT_SHIP_ACTION if action in (None, LEGACY_SHIP_ACTION) else action
    config.pop("newProjectShipAction", None)
    config[SHIP_ACTION_SWITCHED] = True
    return True
