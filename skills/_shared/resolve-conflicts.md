# _shared/resolve-conflicts.md — resolving a conflicted Orc merge

Self-contained copy of the `resolving-merge-conflicts` skill, vendored so Orc
phases can reference it without the skill being installed. For target `main`,
the original **Merge to main** action authorizes one bounded same-turn attempt
for the exact queued branch and captured HEAD. A queued merge runs inside Orc
UI, so it delivers that attempt itself: the conflicted merge pastes the
`resolve merge conflicts` action into the run's session once. If the session
is absent, the unsent attempt stays pending until that session returns.
A paste with uncertain delivery is never retried automatically. An attempt
whose session stops before it finishes or releases is recovered by Orc UI
without anyone clicking: the half-done merge is cleared, the merge slot is
freed for other runs, and the action is pasted again after a wait, up to three
times. For a safely released or later main retry, consent comes from Orc UI's
**Resolve merge conflicts** action or an explicit chat request. Never exceed
one attempt per action.

**Finish or release; never stop to ask.** Sorting out the repository is this
run's job. Ending the turn on a question about a conflict, a stash, or stray
files leaves the merge slot held and every other run waiting. Resolve from the
primary sources, or release with the reason in `decisions.jsonl`.

**Resolve inside the claim, never in the run branch.** Merging the default
branch into the run branch and reopening the Ship gate lands nothing: the user
must approve the same merge again, and the merge slot stays held meanwhile.
When `orc-merge-watch` reports the conflict, end that turn; the
`resolve merge conflicts` action arrives next. Do not edit `meta.json` to
clear `mergeConflict` or change `status`.

**Uncommitted files in the default checkout are not yours to handle.** The
claim command stashes them and the finishing or releasing command puts them
back. Do not commit, move, discard, or ask about them. If a command prints a
line starting `orc-merge-main: parked:`, the stash could not go back cleanly:
repeat that line to the user and leave the stash alone.

## Resolution steps

1. **See the current state** of the merge. Check git history and the
   conflicting files.
2. **Find the primary sources** for each conflict. Understand deeply why each
   change was made, and what the original intent was. Read the commit
   messages, check the PRs, check original issues/tickets — for an Orc run,
   the run's `plan.mdx` / `build-summary.md` and the counterpart branch's log
   are the primary sources.
3. **Resolve each hunk.** Preserve both intents where possible. Where
   incompatible, pick the one matching the merge's stated goal and note the
   trade-off. Do **not** invent new behaviour. Stop rather than guess when primary evidence does not determine intent. For generated files configured in project settings, run `orc-merge-main <run-id> --regenerate-generated` after staging resolved code files instead of merging them by hand.
4. Discover the project's **automated checks** and run them — typically
   typecheck, then tests, then format. Fix anything the merge broke.
5. **Finish the merge.** Stage everything and commit (a normal merge commit —
   never `--amend` here, and never push).

## Orc finish steps (per target, from `meta.mergeConflict.target`)

- **`main`** — first run `orc-merge-main <run-id> --claim-resolution`.
  It atomically claims the pinned queue head when one exists, validates its
  captured branch/HEAD plus the journal's source/target HEAD and checkout
  identity, and moves the conflicted journal into its resolution claim. It
  follows a default branch that moved forward while the conflict waited, and
  adopts a run branch that only merged the default branch in, updating the
  queue entry itself; any other drift is refused. Never remove and re-add the
  queue entry to pick up a new head. A
  direct immediate merge has no queue claim but receives the same journal and
  identity validation. Keep any queue claim throughout resolution and
  verification. Redo the no-ff merge from the validated default checkout,
  resolve per the steps above, run checks, and commit. Then run plain
  `orc-merge-main <run-id>`; it detects that the captured source is contained
  and atomically finishes the transaction journal plus
  `phase=done,status=merged` metadata. Do not hand-write terminal merge
  metadata or remove the queue entry.
  If intent is ambiguous/unsafe or checks remain red, abort a live merge,
  restore the helper-recorded target HEAD and clean worktree, then run
  `orc-merge-main <run-id> --release-resolution`. Release retains queue-head
  membership, clears only this attempt's claim, and restores escalated
  conflict evidence so Remove/Cancel and a later explicit Resolve remain
  safe. A claim or release failure is itself an escalation; never continue
  without proven exclusive ownership.
- log one `decisions.jsonl` row (files conflicted, how resolved).
  If resolution turns out to be genuinely unsafe (incompatible intents with
  no stated goal to pick by), stop, restore `status=escalated` +
  `mergeConflict`, and ask. For `main`, perform the clean abort/restoration and
  helper release above before stopping.
