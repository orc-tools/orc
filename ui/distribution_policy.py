"""Classify entries in a Git tree for Orc packaging and merges."""

import json
import os
from pathlib import Path
import subprocess
import sys


POLICY = "distribution/policy.json"
INVENTORY = "distribution/public-files.txt"


class PolicyError(ValueError):
    pass


def git(repo, *args, data=None):
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    return subprocess.check_output(
        ["git", "--no-replace-objects", "-C", str(repo), *args], input=data, env=env)


def has_policy(repo, *revisions):
    return any(git(repo, "ls-tree", revision, "--", POLICY, INVENTORY)
               for revision in revisions)


def classify_tree(repo, revision):
    policy = json.loads(git(repo, "show", f"{revision}:{POLICY}"))
    approved = set(git(repo, "show", f"{revision}:{INVENTORY}").decode().splitlines())
    internal_files = set(policy["internalFiles"])
    internal_prefixes = tuple(policy["internalPrefixes"])
    entries = {}
    unclassified = []
    for entry in git(repo, "ls-tree", "-rz", revision).split(b"\0"):
        if not entry:
            continue
        header, name = entry.split(b"\t", 1)
        mode, _kind, oid = header.decode().split()
        name = name.decode()
        if mode not in ("100644", "100755"):
            raise PolicyError("symlinks and submodules require explicit materialization: " + name)
        if name not in approved and name not in internal_files and not name.startswith(internal_prefixes):
            unclassified.append(name)
        entries[name] = (mode, oid)
    if unclassified:
        raise PolicyError("\n".join("unclassified tracked file: " + name for name in unclassified)
                          + f"\nAdd each path to {INVENTORY} or classify it in {POLICY}.")
    return policy, approved, entries


def check_tree(repo, revision):
    try:
        classify_tree(repo, revision)
    except (ValueError, OSError, subprocess.CalledProcessError, KeyError, TypeError) as error:
        raise PolicyError(f"distribution policy rejected the merge: {error}") from error


def check_main_merge_index(repo):
    branch = subprocess.run(["git", "-C", str(repo), "symbolic-ref", "--quiet", "HEAD"],
                            text=True, capture_output=True)
    if branch.stdout.strip() != "refs/heads/main":
        return
    tree = subprocess.check_output(["git", "-C", str(repo), "write-tree"], text=True).strip()
    merge_head = git(repo, "rev-parse", "--git-path", "MERGE_HEAD").decode().strip()
    merge_head = repo / merge_head
    parents = merge_head.read_text().split() if merge_head.is_file() else []
    if has_policy(repo, "HEAD", tree, *parents):
        check_tree(repo, tree)


if __name__ == "__main__":
    try:
        check_main_merge_index(Path.cwd())
    except (PolicyError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"orc: {error}")
