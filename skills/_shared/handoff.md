# Delegation within Orc

Control keeps sequencing, judgment, user questions, integration and delivery.
Orchestrate is the only delegation mechanism for Orc and its bundled skills,
apart from the read-only helpers below. The trusted run metadata decides which
execution path is available:

- `meta.orchestration=true`: use the scoped `orc-orchestrator` service through
  MCP or its injected product bridge. Read [orchestration.md](orchestration.md).
  Delegate few, bounded tasks; a small operation stays inline.
- Off or absent: perform the work inline. Do not spawn native subagents for
  it, launch agent processes, use another session API, or enable Orchestrate as
  a fallback. Report an inline review as self-review, never independent.

A skill's request for a reviewer, drafting helper, explorer or worker follows
this choice. It does not override the toggle. Explicit context-child and
planning-session launches remain their own user-directed run operations;
they are not a substitute for delegated tasks.

## Read-only helpers

With Orchestrate on or off, control may give reading whose result is cheap to
check to a native subagent: file and code search, reading logs, running
targeted tests, and reporting which checks failed and with what errors. This
keeps verbose output out of control's context. Orc names no model for a
helper; the harness and the user's own settings choose it. Give the helper read-only tools (Read, Grep, Glob, and Bash for
read-only commands and tests), tell it not to edit files, and ask for what it
found, not what to do. Control decides what the findings mean. Editing,
committing, planning and review stay inline, or go to Orchestrate when it is
on. A helper's finding is input to control, not independent review. Record its model with
`orc-record-model <run-dir> <phase> helper <model> requested`.

## Choose a role and model

Read `orchestrator_capabilities`. Its `routes` are the user's Orchestrate
rules: a task whose role is routed runs on that route's agent and model
whatever target you pass, at an effort inside the route's range, so pass only
`options.effort` for it. A route marked `unavailable` cannot run here: do that
work inline and report it. Change routes only at the user's request, with
`orc-routes` or the board in Settings →
Orchestrate.

For a role with no route, choose an available model and effort from that
run's provider; the selected parent agent/account/model stays in control. Use
the cheapest listed model at low effort for mechanical work such as search,
running tests and reading their output; a cheaper capable model for research
or drafting; a stronger model for implementation and judgment; and independent
read-only review tasks when that evidence matters. Use actual catalogue IDs; no
native role presets or cross-provider fallback. Omitting the model selects the
service default, not necessarily the parent.

## Hand-off and acceptance

Give each task one exact outcome, source authority, relevant skill paths,
artifact pointers, owned files, forbidden writes, acceptance behavior and
targeted checks. A child receives its brief, not the conversation. Preserve
settled diagnosis and earlier review decisions. Never give two workers
overlapping writes. Commit inputs before dependent worktree tasks.

Use read-only task roles for research, review and returned drafts. Design is
read-only too unless the task declares files for it to commit, such as mockups
or variants. Writing tasks declare their exact files and use an isolated
worktree from the frozen Build branch. Control remains responsible for artifact publication and phase
transitions; a task is not a new lifecycle phase. Resolve and accept task
results, inspect their actual diffs and commands, integrate changes, then
check the combined head. A task result is evidence, never user approval.

If the service or model is unavailable, use its documented bridge or report
the failure. Continue suitable work inline without claiming independent
coverage; never substitute native agents. A required independent check stays
incomplete until valid evidence exists. Do not invent another approval gate.

## Recorded phase-worker compatibility

New phase executions run their control-owned bodies inline, delegating only
bounded work through Orchestrate when enabled. Do not create a new native
phase worker or a phase lease for them.

For an already-recorded `phaseDispatch` attempt, retain the existing
claim/start/complete/reconcile/consume and digest rules (read
[run-contract.md](run-contract.md) only when `meta.phaseDispatch` is present). An existing worker may complete its pinned
outputs; control reconciles it before moving on. An unavailable recorded
worker is reconciled and either consumed or retired through that contract.
After retirement, control records the recovery and resumes the phase inline
with normal control-mode proof; the old attempt remains terminal. Phase leases
and task manifests remain separate.

## Evidence and provenance

Retain task IDs and read each terminal result. Record role, actual model (or
literal `unknown`), effort, scope/head, considered files, completion state,
commands and limitations. Independent review requires another Orc task with
completed coverage at the current scope; control's own inspection is inline.

Append model provenance through:

```bash
orc-record-model <run-dir> <phase> <role> <model> <source>
```

Use `self-report` for an attested model, `requested` when only the requested
model is known, and `inherited` for inherited control settings. Keep earlier
records intact. Historical worker returns and phase receipts retain their
original schemas; do not relabel them as new Orc task results.
