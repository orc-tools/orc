# Shared: optional Clarification

The filename is retained for installed-skill compatibility. Its old Grilling
route is not executable in lifecycle v4. This contract implements the
control-owned optional Clarification before Plan.

## Activation test

Start a fresh request at Plan unless all of these are true:

1. evidence cannot answer a choice;
2. the user owns that choice;
3. guessing would materially change scope, visible behavior, safety, rollout,
   cost, or a hard-to-reverse contract; and
4. Plan approval alone would surface the choice too late to produce one
   coherent build-ready plan.

Repository facts, naming, ordinary implementation choices, and reversible
defaults are not Clarification. Resolve them and proceed. Never require a
question-free approval of a separate brief.

## Fresh decision-free path

Set `lifecycleVersion=4,phase=plan,status=running`. Pass the source brief and
repo evidence directly to Plan. Do not create `clarification/`,
`clarification-questions.json`, `inputs/clarification-brief.md`,
`grilling.mdx`, or a Clarification gate.

## Gated Clarification

Set `phase=clarification,status=running`. Write
`clarification/clarification.mdx` with the settled context, evidence, and one
unresolved choice. Write `clarification-questions.json` **at the run root, not
inside `clarification/`** using the form schema in
[question-form.md](question-form.md) with one `single`,
`multi`, or `text` question. Set `required: true` and explain why the run needs
the answer in `requiredReason`. Choice questions have
one clearly marked recommendation and concise trade-offs, and every `single`
or `multi` question sets `other: true` so the user can answer outside the
offered options or add notes beside a picked one.
When the choice is between takes the user has to hear, list each saved take in
the question's `clips` (see [question-form.md](question-form.md)) so Answer
mode plays them beside the question.

Then run `orc-ui open --gate '<run-id>/clarification/clarification.html' --title "<title>"` and
stop. That records `title`, clears `titlePending`, sets `phase=clarification`
and `status=awaiting-gate`, which is when Orc shows the question
card in the Chat and Answer mode behind it. On every route, harness and effort
level the choice goes through this form, never as chat text. A headless
session has no question tool, and a question typed into the reply has no
options to pick and binds no answer. The stop message carries the link and
points at the questions without restating them; never say they are in a panel
or tab.

Snapshot shown sources before revision. A valid submission binds run ID,
source digest, generation, explicit `answer` intent, and every required
answer. A skipped optional question remains open. Proceed with a stated
assumption when it is safe. A stale, malformed, comment-only, attachment-only,
or silent response does not settle a required choice. Ask the next dependent choice only after folding
the prior answer; never expose a branching questionnaire whose later wording
depends on an earlier response.

When no blocker remains, publish exact immutable
`inputs/clarification-brief.md` and remove the question files in one call,
`orc-clarification-done --run-dir <run-dir> --brief <brief.md>`, and only
then atomically enter `phase=plan,status=running`. Record user-owned choices in
`decisions.jsonl`. Plan consumes the immutable brief plus original source and
still requires exact approval.

## Quick clarification

Batch up to four genuinely independent user-owned choices in one
generation-bound form and serialize dependent ones, one at a time. Batching
follows the questions, never the Plan tier: Clarification runs before any Plan
exists, so a dependent follow-up gets its own form without changing `mode`.
Zero choices still omits Clarification entirely.

## Worker and historical boundaries

Clarification stays in control. It has no phase-dispatch claim and never
creates a branch, worktree, commit, diff, receipt, or delivery action. It
never substitutes for Plan
approval.

Historical Grilling artifacts render read-only, including unfinished pre-v3
runs. Start a fresh run for unfinished work; this file never resumes or
mutates the legacy route.
