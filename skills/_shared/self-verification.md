# Shared: runtime self-verification

After targeted tests pass, prove the changed behavior against the real runnable
boundary before Ship. Reading your own diff catches syntax, not broken runtime
wiring; running the checkout catches what PR bots and static review cannot.

## 1. Follow the repository's verification contract first

Before inventing a harness, check for a repo verification contract in
`AGENTS.md`, `CLAUDE.md`, repo docs, or `orc-verification-guides --repo <checkout>`
(the user's private guide, never copied into the repo, and plugins' guides).
Follow how it says to start or reach the app, run its health check before
driving flows, sign in or seed state, drive flows (`orc-agent-browser`, CLI,
HTTP, or MCP), capture proof, and clean up.

Never drive a live production service or shared user instance. Use a
disposable fixture or worktree instance rather than live user data.

## 2. Exercise the real boundary (happy path + 1–3 edge cases)

Drive the changed surface directly in the running checkout — browser via
`orc-agent-browser`, CLI command, HTTP request, or MCP tool call — before
drafting QA steps. Dogfood the [qa-steps.md](qa-steps.md) mental model (`page`,
`command`, `mcp`, and `edge`) so every QA step you hand a reviewer is one you
already ran:

- **Health check:** when the guide defines a read-only readiness check, run it
  first to confirm the app is usable before driving flows.
- **Happy path:** execute the main changed user or caller flow end to end and
  observe the real output or rendered state.
- **1–3 diff-driven edge cases:** inspect what the diff branches on or reads
  and exercise the cases that matter: invalid or empty input, retry or
  double-click, page reload, another role/plan/account/feature flag, or a
  partway failure. Pick only cases the diff gives a reason to check.
- **Clean up:** close `orc-agent-browser close <run-id>` and stop only the
  ephemeral fixture or dev processes this run started, leaving saved proof
  intact on disk.

If a runtime boundary genuinely cannot run locally (missing credentials,
external service, or hardware), do not pretend you ran it; record the exact
reason as a limitation.

## 3. Short blast-radius check (shared boundaries only)

Run this check **only** when the diff touches a shared boundary: DB columns or
migrations, serialized state or files on disk, API or MCP contracts,
permissions or gates, feature flags, or concurrency/locking. Skip it for
isolated changes.

1. **Name 1–2 invariants** safety depends on (for example: UI controls match
   server guards, older saved payloads still deserialize, or retries stay
   idempotent).
2. **Read non-grep readers and writers** of that boundary — serializers,
   templates, background jobs, migrations, dynamic keys, or external clients
   that a literal symbol grep misses.
3. **Verify each invariant** with a focused test or a quick runnable check
   against the checkout.

## 4. Report each check as you run it

Report every check with `orc-check`; the user watches the list in Chat and
beside the PR at Ship. Commit first, then run each command check through
`orc-check run`, which runs it and records pass or fail from its exit code:

```bash
orc-check run tests --run-dir "$RUN_DIR" --label "Targeted tests" -- bin/test --changed
orc-check start live-flow --run-dir "$RUN_DIR" --label "Sign-in from a new device"
orc-check pass live-flow --run-dir "$RUN_DIR" --detail "Stops at the security-key step"
orc-check skip --run-dir "$RUN_DIR" --batch '[{"id": "blast-radius", "label": "Blast-radius check", "detail": "No shared boundary"}]'
```

- **What to report:** targeted tests, type checks and linters, each live flow,
  the edge cases as one row ("Edge cases (2)"), the blast-radius check, and
  screenshots (`--artifact shots/after/<label>.jpg` links one from the row).
- **How:** `run` each command (`--cwd <dir>` to run it elsewhere). For a
  check done by hand, `start` it, then `pass` or `fail` it. Record the checks
  you leave out in one `skip --batch` call, each with why, never one call per lane.
- **Stay honest:** report only what you ran, and a failure as `fail`. No check
  holds Ship, so a tick that is not true gains nothing.
- **Fix what you broke before Ship:** fix a failure your change caused, then
  report the same id again. Leave one only when it fails at `buildBaseCommit`
  too (swap the changed files back to base, or `orc-browser-failures check`):
  report it with `orc-check fail <id> --on-main` to show this run did not break
  it. Name a test that passed on retry (`FLAKY`) in `pr-body.md`; never rerun it.

## 5. Keep proof lightweight in `pr-body.md`

The reported checks are a view, not an attestation: Ship neither reads nor
requires them, and there is **no extra gate**; `ship-template` only pre-fills
`buildProof` from the `orc-check run` checks that passed at the final head.
Carry self-verification results directly into `pr-body.md` via `/orc-docs pr`:

- Turn the verified happy-path flows (and key edge cases) into host-free QA
  steps, or publish typed `command`/`mcp`/`edge` steps via
  [qa-steps.md](qa-steps.md).
- Include screenshots or GIFs (`screenshot.md`) for visible UI changes, and
  brief observed outcomes when helpful — never raw log dumps, local worktree
  hosts, or review-status chatter.
- Put any unverified boundary, skipped live flow, or missing capture under
  `### Limitations` after QA with the concrete reason.
