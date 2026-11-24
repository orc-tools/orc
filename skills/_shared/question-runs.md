# Shared informational question runs

Apply this contract before project setup, Clarification, Plan, any branch or
worktree, phase dispatch, or external write.

## Classification

Classify a request as informational only when read-only evidence can answer the
whole request (explaining, summarizing, comparing, locating, inspecting,
reporting). A question mark alone does not qualify.

Any requested repository, configuration, branch, run-state, document, ticket,
comment, message, deployment, or other external mutation selects the change
pipeline. A mixed information-and-change request also selects the pipeline.
When intent is genuinely uncertain, use normal Clarification; never use the
informational path to avoid lifecycle safeguards. Source resolution may read
Linear, Sentry, Notion, Git, and repository evidence; defer every side effect
until classification finishes and preserve entry mode for provenance.

## Publication

Publish through `orc-publish-question --run-dir <run-dir> --answer-file
<markdown-file> [--title "<title>"]` (`-` for stdin). That helper is the only sanctioned writer of
terminal question metadata: it writes a complete non-empty `answer.md` via
atomic replace, records `--title` (when given) and the stub's canonical configured launch project in
external relationship authority, strips repository, Build, lifecycle,
relationship, and delivery fields, then atomically sets exactly
`outcome: "question"`, `phase: "done"`, and `status: "complete"`. Never
hand-write those fields into `meta.json`; repair a hand-written run with
`orc-publish-question --run-dir <run-dir> --repair`. Both initial publication
and repair refuse any run carrying lifecycle artifacts.

Publication is idempotent: keep valid canonical answer bytes when interrupted,
resume a matching external ownership record, regenerate abandoned temp files,
and fail closed on terminal metadata without a valid answer. Unconfigured
launches publish under Other projects.

When the question asks whether a run, ticket, or plan is done, shape the answer
as the asks table in [asks-table.md](asks-table.md).

The terminal stop gives the whole answer in the reply itself: the same content
as `answer.md`, not a summary of it. Do not link `answer.md` or print its
filesystem path. For comparisons or evidence exploration where local UI helps,
pass `--ui-file <spec.json>` per [interactive-answers.md](interactive-answers.md)
and optionally append
`[Open the interactive view](http://127.0.0.1:4173/#<run-id>/answer.md)` after
the full reply.

Do not create project config, branches, worktrees, Plan/Build/Verify/Ship
artifacts, dispatches, gates, delivery state, or external writes beyond the
ownership record above. Separate verified facts from inference and state
evidence limits.

## Terminal invariants

Question runs contain `answer.md`, optional `answer.ui.json` (`--ui-file`),
optional `diagram.md` (`orc-publish-diagram`), and source/title/session/model
metadata only — never `lifecycleVersion`, repository/branch/worktree fields,
Plan/Build/Verify/Ship artifacts, `phaseDispatch`, `decisions.*`, or delivery
state. A hook-created empty legacy `grilling.mdx` stub may remain; non-empty
bytes make the run invalid. Context-child lineage lives only in external
relationship authority beneath `~/.orc`. When `outcome` is present, it must be
`"question"`; readers validate invariants without normalizing corrupt state.

For `--answer-follow-up` turns on an answered or merged run, or `--update`
corrections to a saved answer, read [question-follow-up.md](question-follow-up.md).
