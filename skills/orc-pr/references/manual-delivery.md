# Manual delivery and legacy Ship actions

## Steps

1. **Confirm consent and validate authority.** Read project config without first-run onboarding.
   - **In-flow delivery action:** Orc UI pasted the user's explicit destination choice — do not re-ask. Lifecycle-v4 actions end with `[authority sha256:<64 lowercase hex>]` matching canonical `delivery-authority.json` and validated via `orc-delivery-authority validate` (grouped runs offer `reconcile repository PRs` or per-chip `open the PR for <group-id>` via [references/frozen-manifest-delivery.md](frozen-manifest-delivery.md)). Recorded v3 actions end with `[receipt sha256:<64 lowercase hex>]` matching canonical `verification-receipt.json`. Revalidate that exact shown digest plus live ticket evidence immediately before any push, PR, merge, or doc write; refuse on missing, stale, or mismatched digests. **Add to merge queue** / **Remove from queue** mutate queue state through Orc UI's HTTP endpoint without opening a session.
   - **Standalone `/orc-pr`:** print the `pr-body.md` deep link (or run-root link; `orc-ui start` first if needed) before asking via the harness question tool. Offer **Open PR**, **Add to merge queue**, **Remove worktree**, and **Not now** when `ship` action is `pr` (or the user explicitly asked for a PR); otherwise offer **Add to merge queue** (first) and **Not now**.
2. **Confirm `branch`, base branch, and title.** Reuse the run's existing `pr-body.md`. Dispatch `/orc-docs pr` when it is missing. Generation is
   mandatory.
3. **Commit stray `repoPath` edits** on `branch` if an earlier step missed them (edits in `mainRepoPath` while the run worktree is detached belong to the user and stay uncommitted).
4. **Push the run branch:** confirm `refs/heads/<branch>` equals `repoPath` `HEAD` (refuse with both SHAs on mismatch), then run `git -C <repoPath> push -u origin <branch>` (never the default branch).
5. **Lint `pr-body.md` and create the PR.** Strip any attribution footer (`sed -i '' '/Generated with/d' ~/.orc/runs/<id>/pr-body.md`), run `orc-pr-body-lint ~/.orc/runs/<id>/pr-body.md --repo <mainRepoPath>`, and fix reported violations if red before creating the PR. Run `gh pr create --base <base> --head <branch> --title "<title>" --body-file ~/.orc/runs/<id>/pr-body.md`.
   - **Screenshots ride on `gh pr create --attach`:** on `gh` 2.99.0+, pass one `--attach <that exact path>` per distinct local Markdown image (`![...](/abs/path)`) and verify via `gh pr view <url> --json body` that no `~/.orc/runs/` path survived. On older `gh`, omit/delete the Screenshots section before `gh pr create` and report `"screenshots skipped (gh < 2.99)"`.
   - **Grouped manifests (`meta.delivery.groups`):** follow [references/frozen-manifest-delivery.md](frozen-manifest-delivery.md).
6. **Staging label (optional):** only when **Open PR** ran, `config.repos[mainRepoPath].offerStagingPrLabel === true`, and `stagingPrLabel` is a valid trimmed single-line string (`<= 50` chars), print the `pr-body.md` (or run-root) link and ask (`No (Recommended)` vs `$stagingPrLabel`), applying `gh pr edit <number> --add-label "$stagingPrLabel"` only if chosen.
7. **Add to merge queue:** records deferred local-main merge consent via Orc UI's queue endpoint (`../../_shared/delivery-contract.md`), offering **Remove from queue** until claimed (single-repo runs only).
8. **Merge to main** (only on direct explicit immediate-merge request or legacy `Present/Recap action (<run-id>): merge to main`; Orc UI runs queued merges itself): skip steps 2–6 and never open a PR. Run `orc-merge-main <run-id>` (the sole transactional local no-ff merge helper — no push, branch deletion, or worktree teardown). On conflict, that consent authorizes one bounded resolution attempt in the same turn: Follow [the PR skill](../SKILL.md) for **Merge conflicts** (target `main`) immediately without asking again.
9. **Remove worktree:** Orc UI runs `orc-bring-to-main <run-id>` directly (`phase=done,status=complete,broughtToMainAt=<iso>`); treat a vanished worktree and flipped status as normal completion.
10. **Settle metadata:** on Open PR, run `orc-record-delivery --run-dir <run-dir> --pr-url <url>` (repeating `--pr-url` per repo; `--merged` when merged). `orc-merge-main` settles its own metadata.
11. **Completion block** (`orc-ui start` first if needed; omit on **Not now**; quote no tool output or duplicate status lines above it, and end with one `Next:` line plus these exact two lines separated by a blank line, never `orc://`):

    ```
    [Open in Orc.app](http://127.0.0.1:4173/#<run-id>)

    🟢 Merged <branch-slug> to main (<sha>) · <HH:MM> — <one-line what changed>
    ```

    Use `git show -s --format='%cd' --date=format:'%H:%M' <sha>` on Merge, or swap line 2 on Open PR to `🟢 Opened [PR #<n>](<pr-url>) (<branch-slug>) · <HH:MM> — <one-line what changed>` using wall-clock time.

## Push to the linked PR — the final landing's PR action

When a single-repo run already has an open PR (`meta.prUrl`, `meta.prUrls`, or `source: "pr"` `meta.sourceUrl`) and receives `Present action (<run-id>): push to the linked PR` (legacy `Recap action`) or direct explicit chat consent:

- Refuse when no linked PR exists or `meta.delivery` is set; if `meta.prFeedback.state == "awaiting-push"`, follow **Push comments & commits** in [references/pr-feedback-and-ci.md](pr-feedback-and-ci.md) instead.
- Commit stray `branch` edits in `repoPath`, then run `git push origin <branch>` (never force-push or push the default branch; `Everything up-to-date` is success).
- Then follow Settings > Push to a PR under **Push with no review round** in [pr-feedback-and-ci.md](pr-feedback-and-ci.md): with **Push comments & commits**, reply to and react 👍 on the review comments the push fixes; with **Push commits**, make no other GitHub write.
- Reopen the final gate and print the PR link.
