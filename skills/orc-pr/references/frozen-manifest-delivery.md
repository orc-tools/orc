# Frozen manifest delivery (`meta.delivery.groups`)

Read this file **only when** `meta.delivery.groups` is present on a multi-repository run.

Treat `meta.delivery.groups` as a reconciliation ledger, never a batch to recreate. New multi-repository manifests carry one group per evidence participant; historical manifests keep their recorded grouping.

1. Process groups in dependency order, or only `<group-id>` when invoked via a repository chip's `open the PR for <group-id>` action (leaving other groups untouched).
2. Lint and use each group's own `delivery/<group-id>/pr-body.md` (stripping any `Generated with` line first); never pass another group's body.
3. Resolve the group's participant repo and query the remote for the exact frozen `branch` + `baseBranch` pair before creating a PR:
   - **1 matching PR:** persist `{url, number, state}` on the group and continue.
   - **2+ matching PRs:** record the group error, restore the originating gate (`phase=present,status=awaiting-gate` for fresh runs; Recap for legacy), and stop.
   - **0 matching PRs:** verify the frozen synthesized `headSha`, push `<headSha>:refs/heads/<branch>` explicitly (creating no local ref), open one PR against its frozen `baseBranch` (attaching local Markdown shot images on `gh` 2.99.0+ or omitting Screenshots on older `gh`), and immediately persist that group's PR before advancing.
4. Retries skip reconciled groups and resume failed/unstarted ones so partial runs never duplicate PRs. Any group error preserves reconciled groups, records a retryable error, restores the gate, and stops. Refresh flattened `prUrls` from all recorded group `pr.url` entries after each write. A manifest run never enters the local-main merge queue or offers local **Merge to main**.
