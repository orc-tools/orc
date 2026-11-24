"""Tells a run that the code it works on is its own.

A model told nothing about ownership adds beside the existing structure, even
when that repeats code, and reports nearby problems instead of fixing them.
Told the code base is its own, it merges the repeated code and makes the
related fixes. The Ship action stands in for ownership: a project that merges
straight to its default branch has nobody else to review a wider change, and
one that ships by pull request is shared with the people who review it.

stdlib-only, like the rest of ui/.
"""
import delegation_policy
import project_settings
import run_relationships

STATEMENT = (
    "This codebase is yours: what it's for and how it's built are your call, and you'll keep "
    "building on it. Improve the structure as you work. Merge repeated code instead of adding "
    "another copy, and fix the related problems you find instead of only reporting them.")


NON_BUILD_ROUTES = run_relationships.NON_BUILD_ROUTES + ("orchestration-worker",)


def owned(meta, config_dir=None):
    """Whether every project the run builds in merges without a pull request.
    A delegated worker, eval, planning session, or local review keeps its bounded scope."""
    if not isinstance(meta, dict) or meta.get("route") in NON_BUILD_ROUTES or meta.get("outcome"):
        return False
    projects = {repo.get("mainRepoPath") for repo in meta.get("repositories") or []
                if isinstance(repo, dict)} | {meta.get("mainRepoPath")}
    projects.discard(None)
    return bool(projects) and all(
        project_settings.project_ship_action(project, config_dir) != "pr"
        for project in projects)


def hook_context(meta, config_dir=None):
    if not delegation_policy.active(meta) or not owned(meta, config_dir):
        return ""
    return ("Code ownership: " + STATEMENT + " Name each of those fixes in the PR body. The "
            "request still decides what this run delivers, and Orc's questions, gates and "
            "delivery rules are unchanged.")
