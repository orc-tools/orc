# Shared: Orc lifecycle v4 with v3 compatibility

Every fresh gated or Quick run records `lifecycleVersion: 4` on the route:

```text
Clarification? -> Plan -> Build -> Ship
```

Executable v4 dispatch names are `plan`, `build`, and `ship` (v4 rejects
`verify`; Recorded lifecycle-v3 runs retain `plan`, `build`, `verify`, `ship`).

## Invariants

- Decision-free requests start at `phase=plan`; only a material unresolved
  user-owned choice enters `phase=clarification`.
- In `mode=gated`, Plan approval binds exact Plan bytes before repo writes,
  branches, or Build. `mode=quick`
  freezes its linted Plan bytes without approval; those frozen bytes still gate
  Build.
- Build runs in isolated participant branches/worktrees, owns targeted checks
  (no full suite) and changed-UI capture, and publishes
  `delivery-authority.json` without running repo commands.
- Ship is the sole post-Build gate. Delivery follows **Delivery consent** in
  `delivery-contract.md`.
- Pre-v3 runs are immutable (`legacy.md`). Control owns metadata, decisions,
  gates, repairs, and delivery; workers own only manifest-declared writes.

## Canonical artifacts

Happy-path single-repo v4 runs produce five artifacts directly at canonical
paths (`plan.mdx`, `build-summary.md`, `diff.patch`, `delivery-authority.json`,
`ship/ship.mdx`). Supporting records (`meta.json`, `decisions.jsonl`, `inputs/`,
`phase-dispatch/`, immutable `shots/{before,after}/` + mutable
`shots/manifest.json`, `artifact-feedback/`, `diagram.md` via
`bin/orc-publish-diagram`, conditional `clarification/clarification.mdx` +
`clarification-questions.json` + `inputs/clarification-brief.md`, and
multi-repo `evidence/manifest.json`) are non-happy-path records.

## Lifecycle metadata

```json
{
  "lifecycleVersion": 4,
  "mode": "gated | quick",
  "phase": "clarification | plan | build | ship | done",
  "status": "running | awaiting-gate | escalated | merging | complete | merged | merged-to-parent | cancelled",
  "planContractVersion": 3,
  "gatedPhases": ["plan", "ship"],
  "phaseDispatch": {"schemaVersion": 1, "phases": {"plan": {}, "build": {}, "ship": {}}}
}
```

Add `clarification` to `gatedPhases` only when its gate opens. Lifecycle v4
never uses `verifyRepairHeads` (retained append-only on recorded v3). Terminal
statuses (`complete`, `merged`, `merged-to-parent`, `cancelled`) make run state
and artifacts read-only.

## Informational question runs

Apply `_shared/question-runs.md` before setup or writes: pure information
publishes `answer.md`; mixed requests enter the lifecycle; invalid states fail
closed.

## Adopting the run

Orc UI pre-creates the run stub and registers configured projects via Add
project; `orc-worktree start-minimal` ensures project registration on Build
entry without prompting (unseen repos get `setupVersion: 1`, `worktree: true`,
`a11y: false`; a detected dev server is only offered in the project's
settings, never saved unasked). Route CLI commands (`orc-publish-question --title`,
`orc-worktree start-minimal --title`, `orc-local-review init --title`,
`orc-ui open --gate --title`, and `orc-record-delivery --title`) record `title`
and clear `titlePending` without hand-editing `meta.json`.

Record control's model with `orc-record-model <run-dir> <phase> orchestrator <model> inherited`.
On **RESUME**, record again if on a different model. Append-only `"subagentModels"`
is never backfilled (`subagentModels` — which model each subagent ran on, with
`source`: `self-report | requested | inherited`).

## Clarification

Read `_shared/grilling-phase.md` when evidence cannot settle a user-owned
choice. Publish `inputs/clarification-brief.md` before Plan; Clarification
never substitutes for Plan approval.

## Plan authority

Sections in order: Destination, Scope lock (`In-N` / Out), optional Tickets,
Approach, Build contract, conditional Locked decisions / Operational
constraints / UI acceptance states. Run `orc-plan-lint <run-dir>/plan.mdx --final`.
In `mode=gated`, only explicit `approve` advances; `mode=quick` freezes without
a gate. Then freeze exact Plan bytes and source authority under `inputs/build-spec/`
via `bin/orc-delivery-authority freeze-build-spec --run-dir "$RUN_DIR" [--source <file.json>]` — never write by hand. Partial, changed, redirected, or corrupt authority fails closed.

## Build isolation, proof, and evidence

Cut `<prefix>/<ticket-or-noticket>/<short-slug>` from recorded `buildBaseCommit`
after freeze; every participant must be `ready`. Implement Scope In in blocker
order (one conventional commit per ticket, targeted proof, changed-UI `shots/`).
Never launch or drive `Orc.app`; prove native Swift via `swiftc -typecheck` and
temp `app/build.sh`, and UI via `orc-ui preview` + Playwright. Ticketed runs
bind participant, In IDs, blockers, base/head, ordered owned commits, diff digest,
and head-bound command proof in `evidence/manifest.json` (`orc-ticket-evidence validate`).

Publish `delivery-authority.json` via `bin/orc-delivery-authority publish`
(schema v1) and `validate`
before Ship and before delivery.

## Local accessibility floor

Plan records this local floor and Build applies it to changed UI; Repository guidance and design-system rules layer on top. The floor: native buttons and semantic controls, accessible names/ARIA, keyboard-operable controls + `:focus-visible`, image/icon text alternatives, non-color-only state + zoom, reflow, and async states, stable focus, and confirmation/recovery on destructive or irreversible actions.

## Lifecycle-v3 Verify compatibility

Recorded v3 runs retain their Verify receipt contract: Verify binds
Plan, diff (`"planSourceDigest"`, `"diffDigest"`, `ticketEvidence`), bases, and `"finalHeads"`. It has one recorded check (`"tests"` — `checks.tests` is the only required check). Attribute `buildBaseCommit` failures as `preexistingFailures`; append the head to `verifyRepairHeads` before at most one repair per generation (never a second repair pass inside one generation), rerun invalidated tests, and write temporary bytes to atomically replace the canonical path (`verification-receipt.json`, the single canonical Verify artifact; never expose a
partial receipt or hand-write it). Optional evidence requires confined run-relative paths, digests, producer heads, and explicit stale/missing state. After fail, control starts the next Verify generation without asking the user — a new Verify generation stays in the same run while absent from
`verifyRepairHeads`, producing one terminal receipt per generation, bounded by three heads or when the prior pass produced no new head or left the same failures unfixed (`phase=verify,status=escalated`).

## Ship and delivery

Ship validates `delivery-authority.json` (or v3 receipt) via `orc-delivery-authority ship`
and opens `phase=ship,status=awaiting-gate`. Actions bind `[authority sha256:<digest>]`.
Ship feedback refines the branch on the existing worktree as supplemental
authority — never edit `plan.mdx` or reopen Plan approval,
including feedback that adds to or contradicts Scope Out. Multi-repo freezes
one group per evidence participant (or `bin/orc-split-children` on minimal-shell).
Direct deliveries settle via `bin/orc-record-delivery` (including `--no-diff --summary "..."` when a completed task has no repository diff, open question, gate, or child runs).

## Phase dispatch

Phases run inline in control (or bounded Orc tasks via [handoff.md](handoff.md)).
A worker never hand-edits control metadata and returns `MODEL: <exact model id>`
and `STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`.

## Secrets, manual steps, stops, and config

For `orc-secret` and `orc-manual-step`, read
[secrets-and-manual-steps.md](secrets-and-manual-steps.md).

At stops, print run identity and the HTTP Orc link first; a headless or
herdr-backed form
gate stops without a terminal question tool, while other stops repeat the same HTTP link in the structured question. The final successful stop links only
`ship/ship.html` (or `pr-body.md` on minimal-shell). Never emit `orc://` links. Do not print worktree app links or bare worktree app URLs; Open the worktree app from
inside Orc (`ship-worktree-links.md` sets `worktree.relevantLinks`). Log decisions via `bin/orc-decision`. End completions with one `Next:` line naming the single thing that happens now (Never list two actions; when terminal, state that nothing is outstanding and the session is done) followed by the `quick-recap` traffic-light line.

PR body generation is mandatory (`pr-body.md` replaces `ship/ship.mdx` on
minimal-shell); Generation does not authorize opening a PR. Optional **Live dev server** project setting `worktreeServer` (`{port}`, omitted when off — never `worktreeServer: false`) and `scripts` never block non-UI Build.

## Budget

Keep the canonical lifecycle contract corpus at or below 5,500 lines, with at most three phase dispatches and the five canonical artifacts on the v4 happy path.
