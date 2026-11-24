# Automatic orchestration

This route is active only when the launcher recorded `meta.orchestration=true`.
The user chose Orchestrate for this run. The chosen parent harness, account,
model, effort and Fast setting remain the coordinator's settings.

Start by calling `orchestrator_capabilities` on the scoped `orc-orchestrator`
MCP server. Decide what to delegate, assign disjoint files and clear outcomes,
choose models, and call `delegate_task`. Give each task the role that names
its work: `roles` in `orchestrator_capabilities` says what each is for. The
role decides whether the worker may write and, when routed, which model does
the task. A design task that declares `files` commits them (mockups,
variants); with none it is read-only and returns a proposal. A role the user's
Orchestrate rules route (`routes` in `orchestrator_capabilities`) runs on its
route's agent and model, at an effort inside the route's range, whatever target
you pass. Every other role stays on the coordinator's plan: the same agent and
account. Never hand the user a delegation form or require them to name child
agents.

## Keep fan-out small

Every worker on the coordinator's own login draws on its one usage limit, and
a worker that hits it fails. A role routed to another agent draws on that
agent's limit instead. On 2026-11-09 a seven-task fan-out at high and xhigh effort used
the whole 5-hour limit in about 20 minutes, and every worker failed together.
Leaving Orchestrate on is safe only while fan-out stays small:

- Start with one or two tasks. Add another only after a result shows the work
  needs it. A small direct operation needs no task at all.
- Give mechanical work (search, running tests, reading logs or test output,
  applying a settled edit) the cheapest listed model at low effort. Keep the
  stronger model and higher effort for implementation and judgment. A routed
  role already has its model: choose only its effort, inside the route's range.
- Keep implementation inline unless the plan has truly separate pieces that
  share no files. Shared files, an order between steps, or work that fits in
  one context all mean inline.
- Tell every coding worker to commit each time its targeted tests pass, so a
  usage-limit failure loses only the work since the last green commit.

## Briefs and results

Use self-contained task prompts. Children receive that prompt and role, not
the parent's conversation history. Delegate at most one review task per run:
fix its findings yourself and check the fixes with targeted tests, not another
review round. Use a distinct `clientRequestId` for
each task and retain it across retries. Prefer async execution and continue
independent work while results return automatically. Use only the scoped Orc
service, including when a native tool supports the same model. Never use
shell-launched agents, or native subagents beyond the read-only helpers in
[handoff.md](handoff.md). Model IDs come from the live
composer catalogue. With Orchestrate off, work inline.

Apply the delegation instructions in
[engineering workflows](engineering-workflows.md). Pass the relevant skill
paths, bounded spec or ticket context, ownership, acceptance evidence, and
targeted checks in each brief. Include established diagnosis and red/green
evidence when continuing existing work. These disciplines add no compulsory
fan-out and give workers no lifecycle or tracker authority.

For writing work, freeze the run's build request and enter its isolated branch
before spawning workers. Declare owned `files`, use worktree isolation, and
commit inputs the worker needs before delegation. Worker worktrees start at
the parent's local HEAD and do not copy uncommitted edits. When the run branch
moves, ask an isolated worker to rebase onto the branch's new head: completion
measures the worker's changes from the closest commit the run branch has held. A shared worker uses
the existing non-default parent branch. Control chooses when sharing is safe.
Workers run project setup and targeted checks, commit each time those checks
pass, then explicitly publish
`task_complete` with a summary and result manifest, and stop there: gates and
delivery (**Delivery consent** in `delivery-contract.md`) belong to control,
which is the one that sees the integrated result. Control reviews their exact heads, accepts their
work, integrates it into the parent, and runs affected final-head checks.

Retain each `taskId`. `task_status` reads and acknowledges a completed result.
`mode=wait` supports a bounded wait; timeout leaves the child running. A worker
with live descendants cannot publish successful completion. A quiet turn or a
child at Ship is not a worker result. `task_cancel` interrupts the active child
and descendants, holds queued messages and disposes automatic delivery;
already-published results remain readable. `orc_thread_send` delivers at once
and stops a worker's active turn when its agent cannot take input mid-turn; a
message waits only behind a pending question or a cancelled task. Uncertain
delivery is recorded as ambiguous and never automatically resent. Parent questions hold notifications;
terminal parents retain unread results and cannot be automatically reopened.
A worker whose turn failed is marked failed and its notification names the
error. A provider usage or rate limit fails again on that login until its
reset: tell the user at once and offer to continue without that lens in a
follow-up round, switch login, or wait. Salvage a failed worker's committed
and uncommitted work from its worktree before delegating again with a new
`clientRequestId`.

Use the injected product bridge when a harness does not expose its MCP tools.
The launch instructions contain its exact run-scoped command. It invokes the
same service and credential as MCP, rather than a separate shell child route.
Provider permissions inherit; narrower supervised modes are used only when
requested, and a child cannot widen the parent's launch permission mode.

Resolve outstanding tasks before Ship. A task result is evidence for control
to check, so it answers no user question, approves no gate, and creates no
recurring work; delivery follows **Delivery consent** in `delivery-contract.md`.
The user's setup is the preset picked in the composer's model picker, and
the routes in Settings → Orchestrate. Run Control's Automatic tasks
section is an optional view of progress and results.
