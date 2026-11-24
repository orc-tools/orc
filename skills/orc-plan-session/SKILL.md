---
name: orc-plan-session
description: >
  Interactive planning session (/orc-plan-session): settle open decisions in
  batched question rounds and end at a plan of steps you can start.
---

# /orc-plan-session — plan before any work starts

Apply `../_shared/plain-language.md` and read `../_shared/planning-session.md`
(the complete contract), `../_shared/question-form.md`, `../_shared/grill.md`,
and `../_shared/entry-parsing.md`. This skill
never claims or dispatches `plan`, `build`, or `ship`; it is a planning entry,
not a lifecycle phase.

## Entry

`/orc-plan-session <brief>` starts a session from a freeform prompt or a
marked prompt file.

Parse the source per `entry-parsing.md` and adopt the server-created stub (its
`route`, `mode`, `phase=planning`, `planning`, and `planReveal` are already
recorded). Record the model with
`orc-record-model <run-dir> planning orchestrator <model> inherited` and pass
`--title "<title>"` on the first `orc-ui open --gate '<run-id>/planning/planning.html' --title "<title>"` call.

## Start a session

1. **Research first.** Read repository instructions, the project glossary,
   and enough code to answer every factual question yourself. Use bounded
   read-only Orc tasks for larger independent questions only when Orchestrate
   is enabled, following `../_shared/handoff.md`; otherwise research inline.
2. **First round.** Publish round 1 per the contract: the destination
   question when the prompt leaves it open, and every frontier question that
   does not depend on it. Stop at the gate link.
3. **Fold and continue.** On the pasted `Planning answers`, record each
   user-owned choice with `bin/orc-decision <run-dir> --phase planning`,
   update `## Decisions so far`, sharpen terms, and recompute the frontier.
   Publish the next round or complete. The reply names only answers that
   differed from their recommendation, one line each, per the contract.
4. **Complete.** When the frontier is empty, finish the artifact with its
   `## Work` list, set `planning.state = "complete"`, remove
   `planning-questions.json`, open the gate once more, print the link, and
   stop. The plan page owns what happens next; never start work or draft a
   document from an answer. Only an explicit ask to build starts it, per
   **Build when asked** in `../_shared/planning-session.md`.

## Notion plan doc

The plan page offers no Notion action. When the user asks in chat for a Notion doc
of the plan, run `/orc-docs notion <run-id>`: it writes the private **plan**
doc from `planning/planning.mdx` and saves `notionUrl`. Then reopen the gate
with `orc-ui open --gate '<run-id>/planning/planning.html'` whether or not the
draft succeeded, and say what happened.

## Output

Every stop prints the run identity and one link,
`[Open in Orc.app](http://127.0.0.1:4173/#<run-id>/planning/planning.html)`,
then the `Next:` line and the `quick-recap` status line. Never print
`orc://` links and never ask a terminal question picker while a live pane can
receive the form's answers.
