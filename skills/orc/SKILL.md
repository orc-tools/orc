---
name: orc
description: >
  Run Orc lifecycle v4 for a ticket, issue, question, or task: fast-exit
  routing, optional Clarification, isolated Build, targeted proof, and Ship.
---

# /orc — lifecycle v4 router and control

Apply `../_shared/plain-language.md`. Take the first route that matches. Each
route names the files it needs:

1. **Reserved routes & follow-ups.**
   - `meta.route == "orchestration-worker"` with `orchestrationWorker`: read
     `../_shared/orchestration-worker.md` and stop.
   - `meta.route == "evals"` with `evals`: read `../_shared/evals.md` and stop.
   - `meta.route == "meeting-prep"` with `inputs/meeting.json`: read
     `../_shared/meeting-prep.md` and stop.
   - `meta.route == "qa"` with `inputs/qa.json`: read `../_shared/qa-run.md`
     and stop.
   - `--answer-follow-up <run-id>`: adopts nothing; read
     `../_shared/question-follow-up.md` and stop.
   - Explicit standalone request to bootstrap a separate project at a named
     path: run `orc-init <path> --defaults --mode orc --task <task> --harness
     <codex|claude>`, cancel the bootstrap stub (`status=cancelled`,
     `cancelReason="redirected to standalone orc-init: <path>"`, one
     `decisions.jsonl` row), follow its new-conversation endpoint, and **stop**.
2. **Parse launch input.** `--launch-run <id>` adopts `~/.orc/runs/<id>`.
   `--quoted-prompt <text-or-path>` carries the literal prompt (or read a `.md`/`.txt`
   path it names). Read `../_shared/entry-parsing.md` only for fork briefs,
   `handoff-brief.md`, or Linear/Sentry URL parsing.
3. **Classify before setup or writes.** Read `../_shared/question-runs.md`
   first. An informational request publishes `answer.md` via
   `orc-publish-question --run-dir <run-dir> --answer-file <file> --title "<title>"`
   and stops; setup and build files do not apply. A mixed request uses the
   lifecycle; invalid combinations fail closed.
4. **Fresh `/orc` change run.** Do not hand-edit `meta.json` boilerplate:
   a decision-free request enters Build in one call via
   `orc-worktree start-minimal --run-dir "$RUN_DIR" --title "<title>" --branch "<branch>"`;
   only a material unresolved user-owned choice starts at `phase=clarification`
   via the Clarification form (`orc-ui open --gate '<run-id>/clarification/clarification.html' --title "<title>"`),
   never as chat text. Execute [../_shared/minimal-shell.md](../_shared/minimal-shell.md)
   directly; its Clarification rules come from `../_shared/grilling-phase.md`.
   Read `../_shared/run-contract.md` only when resuming a historical `plan.mdx`
   or `lifecycleVersion == 3` run; do not read it on a fresh `/orc` run.
5. **Resume & chat actions.** Pre-v3 runs are read-only (`../_shared/legacy.md`).
   Resume the first unproven phase in the file that owns the run's route
   (**Route ownership** below). For wrong-folder, browser, quiz, or
   `[Video attachment: ...]` turns, read `../_shared/chat-actions.md`; for Ship
   comment batches, read `../_shared/artifact-feedback.md`; before delegating a
   subagent, read `../_shared/handoff.md`.

## Notion docs in chat

On an explicit request ("draft me a Notion doc for this", "write a tech doc"),
invoke `/orc-docs notion|techdoc <run-id>` per `../_shared/chat-actions.md`;
leave `phase`, `status`, and gate unchanged.

## Route ownership

Each run follows exactly one route file, and that file wins for the run:

- `meta.route == "minimal-shell"`, and any routeless lifecycle-v4 run without
  `plan.mdx` (every fresh `/orc` change run): `../_shared/minimal-shell.md`.
  It writes no `plan.mdx` and no Ship page; `pr-body.md` is the result.
- Resumed historical runs carrying `plan.mdx` or `lifecycleVersion == 3`:
  `../_shared/run-contract.md`.

## Control and dispatch

Control alone owns `meta.json`, `decisions.jsonl`, Clarification,
branch/worktree setup, repair selection, gates, delivery, push, and merge.
Phase bodies run inline in control; Orchestrate uses bounded Orc tasks
(`../_shared/handoff.md`). A worker return is evidence, not approval.

## Delivery

Deliver only as **Delivery consent** in `../_shared/delivery-contract.md`
allows (a PR goes through `gh pr create` via `/orc-pr`; read
`../_shared/delivery-contract.md` and `../orc-pr/SKILL.md` only when executing
post-gate delivery after explicit consent, never during Build or Ship gate
setup). Settle direct
deliveries with `orc-record-delivery --run-dir <run-dir>` (and completed tasks
with no repository diff, branch, PR, child runs, or open question with
`orc-record-delivery --run-dir <run-dir> --no-diff --summary "..." [--title "<title>"]`).
Escalate only real blockers, through `orc-escalate --run-dir <run-dir> --reason
'<what the user must do>'` (`--clear` resumes; the next gate open also
clears it), never by editing `status` in `meta.json`; cancellation is terminal.
