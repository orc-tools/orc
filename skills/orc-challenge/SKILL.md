---
name: orc-challenge
description: >
  Opt-in adversarial diff stress-test (/orc:challenge): run one fresh read-only
  pass over risky changes and report only evidence-backed failure paths in Chat.
argument-hint: "[optional focus, branch, or model]"
---

# /orc:challenge — opt-in adversarial diff stress-test

Apply `../_shared/plain-language.md` and `../_shared/handoff.md`.

Use this skill only when the user asks for it on high-risk changes: migrations,
auth or permissions, concurrency, billing, state machines, or shared contracts.
It is never automatic and never gates delivery.

## Scope and boundaries

- Target the current branch diff: `<buildBaseCommit>..HEAD` inside an active
  Build, otherwise `<default-branch>...HEAD` plus any staged or unstaged edits,
  narrowed or focused by the user's arguments when given.
- Read surrounding callers, non-grep readers/writers, tests, schemas, and
  contracts — not only the changed lines.
- Keep the challenge pass strictly read-only: run read-only inspection, repro
  commands, or targeted tests only. Do not edit files, commit, branch, touch
  `meta.json`, or open a gate during the challenge pass.
- No multi-round state machine, no `rounds/NNNN/` snapshots, no
  `build-review.json` ledger, and no recap or quiz UI.

## Execution (one fresh pass)

- **Orchestrate off (`meta.orchestration` absent or false):** run one fresh
  read-only adversarial pass inline. Label the result `Inline challenge` and
  never claim independent review.
- **Orchestrate on (`meta.orchestration=true`):** delegate **one** fresh
  read-only Orc task (`review` role) through `orchestrator_capabilities` and
  `delegate_task` per `../_shared/orchestration.md`. Honor an optional model
  named in the user's arguments when listed in the live catalogue; otherwise use
  the routed role or a stronger available model. Pass the exact diff range,
  focus, and hard evidence bar in the brief. Never spawn extra lenses or a
  second round. Verify every returned claim against the checkout before
  reporting it.

## Attack surface

Try to break the change along concrete failure modes:

- Partway failures, retries, duplicate or concurrent execution, race conditions,
  and ordering or idempotency assumptions.
- Non-grep shared readers/writers, migration safety (expand/contract, rollback,
  nullability, backfills), and shared contract or wire-format drift.
- Trust boundaries, auth/permission mismatches between UI controls and server
  guards, illegal state-machine transitions, and billing or rounding edge cases.

## Hard evidence bar

A finding survives **only** when backed by at least one of:

1. A failing test (command and failure line).
2. A concrete repro command with observed broken output.
3. An exact traced code path (`entry -> state -> failure`) citing real symbols
   and lines in the checkout.

Drop speculative "might fail" concerns, style nits, naming/formatting feedback,
and comment-only passes.

## Output in Chat

Report directly in Chat:

1. **Verdict line:** `Challenge complete: <N> verified finding(s) (<mode>)` or
   `Challenge clean: no verified failure paths found (<mode>)`, where `<mode>`
   is `inline` or `independent via <model>`.
2. **Findings (if any):** for each surviving finding, give `file:line`, the
   concrete failure proof, and the smallest suggested fix.

An empty findings list is a valid clean pass; never pad it with low-confidence
nits. When invoked inside an active Build, control may fix verified findings in
the same turn like any other Chat feedback and rerun affected targeted checks;
outside a Build, stop after reporting.
