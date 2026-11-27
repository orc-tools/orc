# Shared question forms

Lifecycle v3 has two run-owned decision forms: optional Clarification and exact
Plan approval. Comment rounds retain their own forms. Verify has no routine
picker, and Ship uses explicit action buttons rather than an answer schema.

## Schema

Canonical question JSON contains `schemaVersion: 1`, a non-empty `questions`
array, and one generation/source identity when the owner requires it. Each
question has a stable `id`, short `header`, prompt, and type `single`, `multi`,
or `text`. Choice questions have 2–5 distinct options with labels and concise
consequences. Put the recommended option first and mark it with
`recommended: true`; the form draws the Recommended pill, so no label or
description repeats the word. An optional top-level `numberFrom` sets the
first question's number, which defaults to 1.

Two optional escape hatches keep an answer from being trapped by the offered
options. A question with `other: true` gains an "Other / notes" choice plus a
free-text input; whatever is typed there is always serialized, so it works as
notes alongside a picked option, not only as a standalone answer. A form with
top-level `notes: true` gains one free-form textarea at the end. Answers
serialize as `<question>?: <picked label(s)>[ — other: <text>]`. `text`
questions take neither `options` nor `other`.

### Answer mode

Orc asks Clarification and planning-round questions in Answer mode: a chat
card leads into a full-width view that shows one step at a time and hides the
steps ahead. Each question is its own step unless it shares a `group` string
with the question right before it. Grouped questions share one step, side by
side, and the first one's optional `groupReason` says in one sentence why they
cannot be answered apart. Group only questions that genuinely depend on each
other, two or three at most; a merely related question gets its own step.
Set `required: true` when an answer blocks the run and put the concrete reason
in `requiredReason`. Other planning questions may be skipped. Clarification
questions without a `required` flag are required for compatibility with existing
runs. Set `required: false` explicitly for any optional Clarification question.

Skipped questions appear as **Skipped** at review. The user can change them
before submitting. Send and Copy include these skips alongside any answers, and
a skip leaves the decision open.

An optional `facts` list, up to six `{label, detail, tone}` entries with
`tone` of `ok`, `warn`, `bad`, or `info`, shows the evidence behind the
question as chips under its `context`. Neither field changes the answers.

A PR feedback round (`../orc-pr/references/pr-feedback-and-ci.md`) asks one
question per review comment from `pr-review-questions.json`. Each carries a
`comment` object, `{author, body, path, line, url, diffHunk, bot}`, that Answer
mode draws as the step's lead: who said it, where, the quoted comment and
its code. Its `context` reads as "What Orc found" and its `facts` as the
evidence chips. Every comment step must be answered and none can be skipped.
The PR comments tab draws the same file as the round's plan: the file's
`summary` as **The plan**, each `context` as **The issue** and each
`approach` (1 to 3 short steps) as **Recommended approach**.

A question that asks the user to judge audio, such as voice takes in an
audition, lists those takes in `clips`: up to eight `{path, label}` entries,
where `path` is an `.mp3`, `.wav`, `.ogg`, `.oga`, `.opus`, `.m4a`, `.aac` or
`.flac` file saved in the run folder (relative, for example
`auditions/round-2/take-1.mp3`) and `label` is what the user hears it called,
such as the option it belongs to. Answer mode plays each one beside the
question. Links in `clarification.mdx` and provider URLs do not play there, so
save the take into the run folder first. Pair the clips with a `single` question
whose options name the takes and `other: true` for changes.

A chat message that starts `About question N (Header):` was asked from Answer
mode about that question while the gate stays open. It is not an answer:
reply briefly in chat, change no question file, and keep the gate open.

Clarification contains one active user-owned decision. Plan approval contains
no open product question: the user either approves the exact digest or requests
a revision with notes/feedback. Notes, attachments, or feedback always mean
revise; they never count as approval.

## Submission

Every submission binds the run ID, canonical source digest, page generation,
intent, and answers/notes. The server writes an immutable envelope and manifest
last, then wakes the recorded session once. Replaying the same idempotency key
returns the prior result. A stale digest, generation, run identity, malformed
answer, pending feedback batch, or mismatched manifest fails closed.

When the run has a headless session, the page exposes **Send to …**. Otherwise
it exposes **Copy answers**. Copy and send serialize the same bound payload.
Delivery failure keeps
the run at its gate and leaves the payload available for retry.

## Lifecycle rules

- Clarification is created only when a genuine user-owned decision blocks a
  build-ready Plan. Resolution publishes immutable brief bytes and enters Plan.
- Exact Plan approval is mandatory before branch/worktree Build begins.
- Verify records judgments and bounded repair in the receipt; it never asks a
  routine Review or QA question.
- Ship has no question file. Feedback is a same-run follow-up; PR, merge, and
  document actions are explicit consent claims.
- Completed pre-v3 forms and answers render read-only. They cannot wake a
  session or advance an obsolete route.

Question files are durable sources. Snapshot a shown source and its question
schema before revising it. Never hand-edit answer archives or treat a browser
draft, comment, attachment, or chat silence as a lifecycle decision.
