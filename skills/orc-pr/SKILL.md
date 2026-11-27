---
name: orc-pr
description: >
  Manual PR delivery (/orc-pr) and PR review-comment fixes (/orc-pr feedback
  <run-id>): push, open a GitHub PR from pr-body.md, or fix open-PR CI/comments.
---

# /orc-pr — manual PR and merge delivery

Apply `../_shared/plain-language.md` and read `../_shared/delivery-contract.md`. **Every push or PR creation requires explicit user consent** — earlier phases already committed the code.

- Read [references/pr-feedback-and-ci.md](references/pr-feedback-and-ci.md) **only when** invoked as `/orc-pr feedback <run-id>`, addressing PR review comments ("fix the Zerohands comments"), handling `PR action (<run-id>): push feedback fixes...` / `post replies` (or `meta.prFeedback`), or asked to check/fix failing CI on the run's open PR.
- Read [references/frozen-manifest-delivery.md](references/frozen-manifest-delivery.md) **only when** `meta.delivery.groups` is present.

## Single-repository PR delivery

The v4 Ship button runs `orc-pr <run-id> --authority <approved-sha256>` directly.
For an explicit chat instruction to open or push that run's PR, use the same
command with the current approved Ship authority. Return the PR URL it prints.
After a failed delivery, report the error and keep the gate available for retry.

Only when handling a legacy receipt, a grouped delivery, a staging-label choice,
a merge, or a standalone destination choice, follow
[the manual delivery steps](references/manual-delivery.md).

## Merge conflicts

- **`main`: resolve once in the same turn.** After `orc-merge-main` aborts and restores the default branch, run `orc-merge-main <run-id> --claim-resolution` (reclaiming the pinned queue head, adopting safe fast-forwards, and rejecting unexpected HEAD/checkout drift — never re-queue). Using the checkout path it prints, redo the merge per `../_shared/resolve-conflicts.md`, run required checks, commit, and run `orc-merge-main <run-id>` to finalize while keeping exclusive queue ownership. Do not ask for another
  approval.
- **Busy slot or dirty default checkout:** if another merge holds the slot, `orc-ui` sets `mergeConflict.resolutionPending` and dispatches `resolve merge conflicts` when free — end the turn without asking. `orc-merge-main` stashes and restores uncommitted default-checkout files itself (reporting any `orc-merge-main: parked:` line without touching the stash).
- **One attempt only.** If intent is ambiguous/incompatible, checks stay red after bounded repair, or claim/release fails, abort the merge, restore default-branch HEAD and a clean worktree, run `orc-merge-main <run-id> --release-resolution`, preserve `status=escalated` and `mergeConflict: {"target": "main", "detail": "<one line>"}`, log to `decisions.jsonl`, print the run-root link, and stop.
- **On `Present action (<run-id>): resolve merge conflicts`** (or legacy `Recap action`, explicit chat request, or Orc UI's own automatic dispatch of the consent that merge already carried): run as the first attempt or as a fallback for a main attempt that was safely released or retried after escalation, starting from `--claim-resolution`, following `../_shared/resolve-conflicts.md`, clearing `mergeConflict` on success, and never looping or pushing.

## Rules

- Never force-push or push the default branch.
- **Never push as a side effect.** Every initial push and feedback push waits for its own explicit user action, except a requested CI fix on the run's own open PR under **Fix
  failing CI on the open PR** in [references/pr-feedback-and-ci.md](references/pr-feedback-and-ci.md).
- **Write to a GitHub conversation only through `orc-pr-replies`** after an approved push (using `--zerohands-only` when only the push was approved and Settings > Push to a PR is **Push commits**, never hand-picking bot replies), or, for a push with no review round, the replies and 👍 reactions **Push with no review round** in [references/pr-feedback-and-ci.md](references/pr-feedback-and-ci.md) allows. Never resolve a thread, approve, request changes, edit/delete comments, or post anything else.
- Surface stale `pr-body.md` before creating a PR; keep `/orc-docs` happy-path QA steps; attach screenshots via `gh pr create --attach` or omit on `gh < 2.99.0` without manual-upload reminders; strip `Generated with` footers before `gh pr create` and never add AI attribution.
