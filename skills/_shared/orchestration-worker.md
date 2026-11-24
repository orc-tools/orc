# Delegated worker execution

Use this route only for the hook-validated reserved launch whose existing
`meta.json` has `route=orchestration-worker`, `mode=worker`, and
`orchestrationWorker`. Preserve the run ID, parent/task/launch identity,
workspace, branch, session ownership, and runtime settings. Do not initialize
another run or replace worker metadata with a lifecycle record.

Decode the single `--quoted-prompt` argument with shell tokenization without
evaluation. It must match this run's `inputs/start-prompt.txt`. Execute that
supplied task under the recorded worker role and file ownership. Do not fetch
the parent's conversation or expand the brief into its earlier request.
Use the injected orchestration tools and the run-scoped instructions supplied
by the launcher. The existing credential is scoped to this worker.

Apply [engineering workflows](engineering-workflows.md) within the supplied
brief and ownership. Use supplied spec or ticket excerpts, diagnose unknown
failure causes, and return exact diagnostic and test evidence to the parent.
These skills do not authorize broader scope, tracker writes, frozen-source
changes, or lifecycle control.

Implementation tasks edit only assigned files and run relevant checks.
Isolated workers commit each time those checks pass, so a usage-limit failure
loses only the work since the last green commit, and commit everything before
successful completion. When the
parent asks you to rebase, rebase onto a head of its run branch; completion
checks only the commits above the closest one. Shared
workers leave their changes for the parent and do not stage or commit unrelated
work. Research and review roles inspect and report without repository
changes. A design task follows the implementation rules for the files it
declares, and with none declared it also only inspects and reports. Preserve
inherited permissions; do not introduce approval steps.

Delegate a useful independent subtask only through the injected Orc tools,
and only when your task truly has a separate piece; most need none. Native
subagents are limited to the read-only helpers in [handoff.md](handoff.md);
never use another agent-launch API.
Keep each brief self-contained, declare file ownership for writing tasks, and
retain task IDs. Continue useful work while async children run. If nothing else
remains, end the current turn and let their automatic result notification wake
this session. A quiet turn does not complete your task. Read the returned
result, resolve findings within your ownership, and wait for all children to
finish before publishing your own result.

Call `task_complete` with a concise summary, `status=completed` or
`status=failed`, actual checks with commands and exit codes, and the live commit
head when relevant. Report unfinished changes and failed checks honestly. The
service publishes the task result and final worker state; do not write those
artifacts or finalize metadata yourself. A failed publication is unfinished
work and must be corrected or reported to the parent through scoped tools.

This worker route opens no clarification, Plan, Ship, or delivery gate and
approves no lifecycle artifact. The parent owns integration, approval, and
delivery (**Delivery consent** in `delivery-contract.md`), because only it sees
the combined result the user will accept. Stop after successful
`task_complete` publication.
