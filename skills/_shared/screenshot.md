# _shared/screenshot.md — visual capture contract

Visual capture runs in lifecycle-v4 **Build** once at the final head after UI
edits settle (`meta.conditional.a11y`; recorded lifecycle-v3 keeps Verify
Tests). Later phases and docs reuse `$RUN_DIR/shots/manifest.json` without
recapturing. Capture real `.jpg` stills (`.png` at 2x only when asked) and
optional focused `.gif` motion pairs inside `$RUN_DIR/shots/`, never committed
to git or embedded as `data:` URIs.

On a post-Ship-feedback revision (`meta.feedbackRevision`), retake only changed
flows whose manifest `revision` differs: keep prior files intact, write
`before/<label>-<feedbackRevision>.<ext>` and
`after/<label>-<feedbackRevision>.<ext>`, and update that entry's paths and
`revision`.

## Repository capture tools

Always use the repository's documented capture command (for example in
`AGENTS.md` or `CLAUDE.md`) and fictional fixtures into `$RUN_DIR/shots`,
never a live installation or real account. Frame the smallest region that
shows the change with identical framing before and after.

When capturing before and after across commits:

```bash
git -C <repoPath> checkout <buildBaseCommit>
# run the repository's capture command for the before pass into "$RUN_DIR/shots"
git -C <repoPath> checkout <branch>
# run the repository's capture command for the after pass into "$RUN_DIR/shots"
orc-validate-shots --strict "$RUN_DIR/shots"
```

Pin the same fixture seed across both passes and verify
`git -C <repoPath> rev-parse --abbrev-ref HEAD` restores `<branch>`. Skip
the before pass for a new surface (`"before": null, "new": true`) or failed
base pass (`"before": null`). Capture a GIF only when motion or interaction
changed, and high-quality 2x PNGs only when asked.

## Manifest and validation

Whoever writes under `shots/` updates `shots/manifest.json` in the same step
(no orphan images) with `label`, `flow`, relative `before`/`after` paths, and
helper-returned `capture.before` / `capture.after` framing metadata
(`captureVersion: 1`). A flow
built to a plan's mockup also carries `mockup`, the mockup's picture copied
under `shots/mockup/`; the run's Assets tab shows it beside the real screen,
and it stays out of the PR body. Validate
immediately with `orc-validate-shots --strict shots/manifest.json` (or
`"$RUN_DIR/shots"`).

## Playwright fallback

Read [screenshot-playwright.md](screenshot-playwright.md) **only when**
the repository has no capture command of its own or its capture command has
no view for the changed state. Do not read it when a repository capture tool
covers the state.

## Consumers

- **Missing manifest repair:** if files exist under `shots/{before,after}/`
  without `manifest.json`, reconstruct it from `.jpg`, `.jpeg`, `.png`, and
  `.gif` files (ignoring `test-results/`), matching `before` by filename or
  `null`, and report the repair.
- **pr-body (`orc-docs` / `orc-pr`):** emit Markdown images using local absolute
  paths validated with `orc-pr-body-lint`. During delivery, `orc-pr` passes each
  file to `gh pr create --attach` (`gh` 2.99.0+, uploading and rewriting paths
  in place) or omits the Screenshots section on older `gh`. Local captures
  remain available in Ship and Orc recaps; never print a manual-upload reminder.
- **Ship / Notion:** legacy `ship/ship.mdx` embeds `../shots/...`; Notion docs
  upload via `notion-create-attachment`.
