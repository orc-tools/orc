# Shared: minimal shell route

This is Orc's change route. Control executes the whole run inline without
separate phase workers. **The PR body is the final result. There is no Ship
page.** This route never writes `plan.mdx`; `diff.patch` and
`delivery-authority.json` still back delivery validation.

**Every run that builds ends at the Ship gate (`phase=ship,status=awaiting-gate`), at any effort level** — never hand-write terminal status; delivery helpers settle the run in step 6.

## 1. Classify, clarify, or settle without a diff

Classify read-only questions first via `question-runs.md`.

Stop before branching only for (a) an unresolved user-owned choice passing
[grilling-phase.md](grilling-phase.md), or (b) two+ unrelated features bundled
together (ask once whether to split, unless already told to keep together). Ask
through the Clarification form (`grilling-phase.md`), never as chat text: write
`clarification/clarification.mdx` and root `clarification-questions.json`, then
run `orc-ui open --gate '<run-id>/clarification/clarification.html' --title "<title>"`.
When answered, run `orc-clarification-done --run-dir "$RUN_DIR" --brief <brief.md>`
(it publishes `inputs/clarification-brief.md` and removes the question files;
never `rm` them) and pass the brief in
`start-minimal --source <json>`.

Keep branchless parent conversations open after child runs finish; run
`bin/orc-complete-parent --run-dir "$RUN_DIR" --confirmed-close --summary "..."`
only when the user explicitly asks to close a parent whose children are merged.

When an operational, deployment, or already-landed task finishes completely with
no repository diff, open question, gate, background work, or child runs, log one
`bin/orc-decision` row, settle via
`bin/orc-record-delivery --run-dir "$RUN_DIR" --no-diff --summary "<what completed>" --title "<title>"`
(which also tears down any untouched branch/worktree), and print the
`[Open in Orc.app](http://127.0.0.1:4173/#<run-id>)` link it outputs, one
terminal `Next:` line, and the `quick-recap` line.

## 2. Freeze and branch

Apply conditional synthesis/slicing from
[engineering-workflows.md](engineering-workflows.md) only when warranted; a
bounded request needs no extra file. Enter Build in one command:

```bash
orc-worktree start-minimal --run-dir "$RUN_DIR" --title "<title>" --branch "<branch>"
```

Pass `--source <json>` when `inputs/clarification-brief.md` or custom provenance
applies, and `--model <model>` only when overriding `meta.launchModel`.
`start-minimal` sets `title`, clears `titlePending`, ensures project
registration, records `subagentModels`, logs the route decision, freezes
`inputs/build-spec/`, and prepares the worktree (or in-place branch when
`worktree:false`).

## 3. Build inline

- Read [orchestration.md](orchestration.md) only when `meta.orchestration` is
  true; otherwise build inline (native helpers follow [handoff.md](handoff.md)).

When the brief has `## Mockups` (a run started from a plan), each mockup is
the design: open its HTML and build the real screen to match its layout,
wording and states, using the product's own components where the sketch only
approximates them. Name any place the build departs from it in the PR body.

When the change needs another repository, build only this repository and open
a sibling run there with
`orc-sibling --run-dir "$RUN_DIR" --repo <folder-or-path> --task "<what it builds>"`
(grouped under the plan or this run; it opens its own PR). In a grouped run,
coordinate with `orc-note ask|tell --run-dir "$RUN_DIR" --to <repo|step N|run-id> "<note>"`
(`ask` waits; `orc-note list` shows the group), answer incoming `<orc-note>`
asks with `orc-note answer <id> "<answer>"`, and never build another run's
part. In-flight runs with `orc-worktree add-repo` keep the multi-repo Ship
path below; new runs open siblings.

Read `~/.orc/review/learned-checks.md` before the first edit when present and
apply matching guidance. Implement in the worktree (applying
[engineering-workflows.md](engineering-workflows.md) for bug diagnosis when
applicable) and make one conventional commit (more only when slices naturally
split). For ad hoc UI exploration, use `orc-agent-browser open <run-id> [url]`
+ `snapshot` (fixture server only for Orc itself) and `close` afterward.

Run targeted checks only: typecheck/lint plus the test files/specs exercising
changed code. Do not run the full suite unless the user asks for it (or
`bin/test --changed=<buildBaseCommit>` falls back to it — quote the selection or
fallback reason; add `--reuse` on unchanged reruns; Low power caps workers
and never widens which checks to run). After a rebase/merge onto a moved base (`orc-sync-main --run-dir "$RUN_DIR"` merges a moved `main`, regenerates configured generated files, and resets `buildBaseCommit`), add only tests
for files that both sides touched plus test files the new base added or
changed. Verify dependencies from the worktree, avoid `|| true`, never launch or
drive `Orc.app`, and record exact commands, exit codes, and results (including
any expected red test before the fix). Passing final-head commands form the whole Build proof in step 4. Never add a throwaway worktree at `<buildBaseCommit>` to rerun failing browser specs; check `orc-browser-failures check '<spec> › <test>'` (`tests/known-browser-failures.json`) or fix the spec directly.

For visible UI changes, read `ui-craft.md` only when visible UI changes (match
`DESIGN.md` and sibling components, and inspect final shots with its five-point
self-check) and capture final changed states once at the final head:
read `screenshot.md` only when visible UI changed. Repository capture tools come
first (or `assets/playwright/capture.mjs`), writing immutable
`shots/after/` + `shots/manifest.json` (`before:null` for new screens, else
comparable base state; desktop + phone when both change), and validate with
`orc-validate-shots --strict "$RUN_DIR/shots"`. For each mockup in the brief,
capture the real screen in the mockup's state and framing, copy the mockup's
picture to `shots/mockup/<label>.<ext>` and set `"mockup": "mockup/<label>.<ext>"`
on that flow's manifest entry, so the run's Assets tab shows the two side by
side. The mockup never goes in the PR body (`/orc-docs pr`).

### Self-verification

After targeted checks pass, follow [self-verification.md](self-verification.md)
to exercise the real changed boundary (happy path plus 1–3 diff-driven edge
cases) using the repository's verification contract when present, run a short
blast-radius check only when touching shared boundaries, report each check
with `orc-check` as you run it (`orc-check run` for commands, after committing), and carry real observed proof and any
unverified limitations into `pr-body.md` (no extra gate).

### Comment pass

Skip this pass (no `repository-rules` lookup or `bin/orc-decision` log) when a
check after the last code commit already recorded `comments` as `skip` or `pass`
for that checkout. Otherwise inspect `git diff <buildBaseCommit>..HEAD` after
the last code commit. If the diff adds, edits, removes, or borders comments, run
`orc-app-plugin repository-rules --repo <checkout>` for that participant.
Read and apply the returned rules only to that checkout. Repository standards
take precedence. An empty list means there are no plugin rules to apply.
Commit fixes separately and rerun affected targeted checks. Record the pass
via `bin/orc-decision` with the head and number of fixes.

## 4. Evidence & PR body

- Read `../_shared/ship-worktree-links.md` only when visible UI changed,
  `worktree.url` is set, or the run changed an MCP server's tools, resources
  or prompts.
- Read `secrets-and-manual-steps.md` whenever the user still has to do
  something after delivery (deploy, migrate, change a setting, run a command
  elsewhere), and record each such step with `orc-manual-step` so it shows in
  the steps card above the composer. A `Next:` line alone leaves it in plain
  chat.

Do not write `ship/ship.mdx` or render a Ship page. Invoke `/orc-docs pr` to
draft `$RUN_DIR/pr-body.md`, and stop ephemeral background tasks.

## 5. Ship

For a single-repo run, generate the input using the registered participant ID
and live commit from the run:

```bash
bin/orc-delivery-authority ship-template --run-dir "$RUN_DIR" --out "$RUN_DIR/ship-input.json"
```

`--out` replaces the file on every rerun, so never redirect it with `>`.

The template fills each `buildProof[].commands` from the `orc-check run`
checks that passed at that entry's `head`, and names on stderr any it left out
for running at an older commit: rerun those with `orc-check run` and generate
it again. Add by hand only a check you ran at that `head` some other way
(`command`, `status: "pass"`, `exitCode: 0`, `result`). Keep the template's `handsOn` for non-UI changes. For UI changes use
`applicable: true`, 1–3 `flows`, `state: "ready"`, and
`shots: {path: "shots/manifest.json", sha256}`. Use `state: "blocked"` on capture
failure, which never disables delivery.

Publish evidence, lint `pr-body.md`, and open the Ship gate in one command:

```bash
bin/orc-delivery-authority ship --run-dir "$RUN_DIR" --input "$RUN_DIR/ship-input.json"
```

If Ship rejects the proof, regenerate the template, fix the reported field,
and retry once; if the same error repeats, stop and inspect the validator and
run state. Report Ship open only on `phase: "ship"` and
`status: "awaiting-gate"`. When `ship` returns `"linkedPrUrl"`, name that PR
link and **Push to PR** in `Next:`, never Open PR.

For a **multi-repo** run: write non-empty root `diff.patch`, run
`bin/orc-delivery-authority publish --run-dir "$RUN_DIR" --input <json>`,
`bin/orc-delivery-authority validate --run-dir "$RUN_DIR"`, and
`bin/orc-split-children --run-dir "$RUN_DIR"`, then draft `pr-body.md` and run
`bin/orc-delivery-authority ship` for each child without a parent `pr-body.md`.

Print `[Open in Orc.app](http://127.0.0.1:4173/#<run-id>/pr-body.md)`, the
asks table from [asks-table.md](asks-table.md), one `Next:` line, and the
`quick-recap` line. Do not read `../orc-pr/SKILL.md` or
`delivery-contract.md` during Build or while opening the Ship gate; read them
only when executing post-gate delivery after explicit consent.

## 6. After the gate

Composer Ship (`inputs/launch-delivery.json`) auto-queues once Ship validates;
Start never grants consent. A queued merge that conflicts is still approved:
on `resolve merge conflicts`, follow [resolve-conflicts.md](resolve-conflicts.md)
and land it in that turn, never by merging the default branch into the run
branch or reopening the gate. Ship feedback repeats steps 3–5 on the same
branch; direct-instruction deliveries settle via `orc-record-delivery`. Hold readiness with `orc-ship-hold --run-dir "$RUN_DIR"
--reason '...'` whenever a chat turn reopens a decision or code change before
re-running steps 3–5 and reopening the gate.
