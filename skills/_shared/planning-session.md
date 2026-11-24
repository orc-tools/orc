# Shared: planning sessions

A planning session settles what to build before any run builds it. It is not
a lifecycle run: it has no Clarification, Plan approval, branch, worktree,
Build, delivery authority, or Ship. It asks the user batched rounds of
questions until nothing is left to decide, writes one planning artifact, and
then offers explicit next steps. Only a next-step action starts work.

Orc's independent adaptation of Matt Pocock's `grilling`, `grill-with-docs`,
and `domain-modeling` skills. Those are design references and
attribution, never vendored text or a runtime dependency; this file is the
complete contract. `/orc-plan-session` enters a session. Orc also reaches
it when the user asks another run's agent to quiz them: that run starts the
session as a context child (`mode: orc-plan-session` on its fork or
follow-up), so the session's brief is that run's context plus the request.

A plan run (`../orc-plan/SKILL.md`), which the composer's Start launches, is
on this route too. It shares the run shape, the plan page, Start work and
the boundaries below, writes the shorter plan its own skill gives, and
publishes a round only when something blocks that plan.

## Run shape

The hook-created stub is adopted like any other run. Control writes:

```json
{
  "route": "planning-session",
  "mode": "gated",
  "phase": "planning",
  "status": "running | awaiting-gate | complete | cancelled",
  "planning": {"state": "grilling", "round": 0},
  "planReveal": {"version": 1}
}
```

`route` is the stamp every reader keys on. Every session is one grill:
`planning.state` moves `grilling -> complete`. A plan run starts at
`drafting`. `planning.round` counts
published rounds. The launch stub writes `planReveal`; keep it as written.
Orc UI adds `planReveal.revealedAt` when the user plays the plan reveal.
Never write `lifecycleVersion`, `phaseDispatch`, `gatedPhases` by hand,
`branch`, `worktree`, or any Build or delivery field.

Artifacts:

- `planning/planning.mdx` — the one user-facing document (see **Artifact**).
- `planning-questions.json` at the run root — the current round's form.
- `planning-answers.json` — the page's own draft state; never read it as an
  answer. The answer arrives as pasted text in the session.

Overwrite `planning/planning.mdx` and `planning-questions.json` directly for
each round, without generating version copies. Glossary terms crystallised during the session append to `~/.orc/context/<repo-slug>.md` exactly as
`grill.md` requires.

## Rounds

Each round is one generation-bound form using the shared question schema in
`question-form.md`, written to the **Write it plainly** rules in `grill.md`,
with four differences from Clarification:

1. **Batched.** A round holds the whole current frontier: every decision whose
   prerequisites are already settled. A question whose wording depends on an
   unanswered question waits for the next round. There is no cap of four.
2. **Every question is answerable outside its options.** Every `single` or
   `multi` question sets `other: true`; the form sets `notes: true`; the
   recommended option comes first and is marked `recommended: true`, with a
   one-line reason in its `description`. Other options carry a label only.
3. **Plain send.** The page posts the serialized answers to the session; there
   is no review envelope or digest-bound intent. Set `"prefix": "Planning"` in
   the questions file so the pasted block reads `Planning answers (<run-id>)`.
   Mark a question `required: true` only when planning cannot continue without
   the user's answer. Explain the blocker in `requiredReason`.
4. **Numbered across rounds.** Set `numberFrom` in the questions file to one
   past the last question number shown, so a round that follows ten
   questions starts at 11. Round 1 omits it. Cite answers by number, as Q12.

Facts are never asked. A question the repository, docs, or a bounded research
subagent can answer is answered by research between rounds. Only genuine
user-judgment calls reach the form. Probe with concrete edge-case scenarios,
split an overloaded term the moment it appears, and never answer a question
on the user's behalf.

Orc UI keeps the session's tab hidden until the plan reveal. A round's
questions open in Answer mode, like Clarification, one step at a time, and
the round link opens Chat with Answer mode open. Give questions that must be
answered together the same `group` (see `question-form.md`). After folding a round's answers, the chat
reply is the next round's link plus one line for each answer that differed
from its recommendation, cited by number, such as `Q12: sort by name, not by
date`. When the user answered every question with the recommendation, say so
in one line. State any assumption you make for a skipped question. Never
restate the new round's questions, re-list decisions `planning/planning.mdx`
already holds, or add time estimates.

To publish a round: snapshot, write `planning/planning.mdx` with the settled
context so far, write `planning-questions.json`, bump `planning.round`, set
`planning.state = "grilling"`, then run
`orc-ui open --gate '<run-id>/planning/planning.html'`. That helper flips
`status` to `awaiting-gate`; control never writes that value itself. Stop and
wait for the pasted answers. A line marked `Skipped` leaves the question open.
Continue with a stated assumption where safe. Record the answers the user gave as
user-owned choices with
`bin/orc-decision --phase planning`, recompute the frontier, and publish the
next round or complete.

### First round

Before round 1, read the prompt and enough of the repository to answer every
factual question. A context brief's captured artifacts, such as the source
run's `answer.md`, count as that research: turn what they leave open into
the round instead of restating them. Round 1 carries the destination question when the prompt
leaves it open, and every frontier question that does not depend on it.

## Artifact

`planning/planning.mdx` opens with `# <destination title>` and then, in this
order:

1. `## Destination` — one or two lines: what reaching the end looks like.
2. `## Work` — written when the session completes: the runs that build the
   plan, as one list numbered from 1 in the order to start them. Each item
   is one run: `**<Name>.**`, then what that run builds in a sentence or
   two. A plan one run can build has one item. Each run builds in one
   repository: when the plan spans several, name each step's repository by
   its folder name in brackets after the name, as
   `**Export worker** (`serverless`).`, and give each repository its own
   steps rather than one step that builds two. A step that must wait for
   another says so in the item, as `Waits on step 1.`; Orc starts it by
   itself when that run reaches Ship. Say which steps can run side by side
   in a sentence under the list.
3. `## Decisions so far` — one bullet per settled decision, newest last, each
   in the user's own words. Group a round's decisions under `### Round N`
   and open each with its question number, as `Q12:`.
4. `## Not yet specified` — fog: questions you can tell are coming but cannot
   phrase precisely yet. Empty when the session is complete.
5. `## Out of scope` — work consciously ruled past the destination, with why.
6. optional `## Findings` — what research established that the decisions rest
   on: how the code works today, measurements, comparisons and costs, each
   with its source. Facts go here, never under Decisions.
7. optional `## Glossary` — terms settled this session, one line each.
8. optional `## Decisions worth recording` — only for a choice that is hard
   to reverse, surprising without context, and a real trade-off.

The plan page reads these headings. It leads with Destination, Work,
Decisions worth recording and Out of scope, and takes each step's name from
the Work list, so keep to the shapes above.

The document records what was decided and names the work that follows. It is
not a spec: it holds no implementation diary, no file paths, and no build
contract, and each run settles its own approach. `plan.mdx` never appears in
a planning run.

## Completion

The session is complete when the frontier is empty: every branch visited,
nothing silently assumed. Write `## Work`, set `planning.state = "complete"`,
clear `## Not yet specified`, remove `planning-questions.json`, and run
`orc-ui open --gate '<run-id>/planning/planning.html'` once more so the run
waits at `status=awaiting-gate`. Print the link and stop. Chat then offers
one action, **View plan**. It plays the plan reveal, records
`planReveal.revealedAt`, unhides the session's tab and opens the plan page.
Opening the printed link before the reveal plays it too. The reveal plays once
per plan. Sessions without `planReveal` show the tab with no reveal.

The plan page shows the document beside the steps of `## Work`. When the
steps name their repositories, **Start work** opens one run per step at once,
each in its repository with its own PR, and holds a step that waits on
another until that run reaches Ship. Those runs list together under the plan
in the sidebar when they span repositories, and can send each other notes.
Otherwise, until any
step has a run, one **Start work** button builds the whole plan in one run
and is the only Start on the page: every step shows that run, and no step
offers Start while it stands. Once a step has a run of its own, a step with
no run offers:

- **Start step N** when the plan has several steps — Orc UI forks a child change run through the existing context-fork route
  with `planning/planning.mdx` captured as context. Its prompt names the
  step, and the run builds only that step. The child treats the artifact as
  settled direction and never reopens its decisions. The parent stays open. A
  step with a run shows that run and its state in place of Start, and offers
  Start again only when the run was cancelled. The sidebar lists each change
  run as its own top-level run, not nested under the plan, with its split
  children beneath it. Each change run and its children get a Plan tab in the
  side panel, with the same steps and document, where the next step can
  start. Child planning sessions stay nested and take no step.

Notes the reader left on the plan and never sent go with Start work: the
run's prompt lists each one under the plan it builds, after the plan's own
direction, and a note that changes something the plan settled wins. Every
step's run gets the same notes. Sending them first instead has the plan run
revise the plan before anything starts.

The **Builds with** row under the steps chooses what the run Start launches
builds on: model, effort, Fast, permissions, account and Orchestrate. It opens
on the plan run's own settings.

Until a step has a run, the plan page takes notes: the user clicks a
paragraph, or a spot on a picture, and sends the notes together. They reach
the session as an artifact-feedback batch; follow the **Planning** rule in
`artifact-feedback.md`. The page offers no Start while the plan is revised.

A plan with no `## Work` list is one step, built by one run. While a plan
has steps without a run, the sidebar says how many have one, such as `2 of 4
started`, and the plan stays listed when the runs it started are settled.

The plan page has no Done button. Historical closed sessions carry
`outcome: "planning"`, `phase: "done"`,
  `status: "complete"` and remain read-only. They still offer Start work for
a step that has no run.

No next step runs automatically. Silence, notes, and answers are never a
next-step choice; an explicit ask to build is (**Build when asked**).

### Build when asked

The user can start the build in words instead of with the button. A chat
message or note batch that plainly asks to build ("build it", "start the
build", "go ahead and build", "start step 2") is the Start work choice made
in chat. "Looks good", thanks, answers and silence never are.

1. **Only a finished plan builds.** `planning.state` is `"complete"`: a
   plan run's plan has passed `orc-plan-ready`, a session has written its
   `## Work`. Before that, say in one line that nothing is settled to build
   yet, and carry on.
2. **Changes come first.** When the same message also asks for changes
   ("build it, and drop stations with no tracks"), make them as the
   **Planning** rule in `artifact-feedback.md` says: revise the plan, redo
   each mockup they affect, answer every note, and stop at the gate again
   (`orc-plan-ready`, or `orc-ui open --gate` for a session). Do not wait
   for the user to read the revised plan.
3. **Start it.** Run `orc-plan-start --run-dir <run-dir>`. "Build it" builds
   the whole plan in one run; "start step N" adds `--step N`, as the plan
   page's Start step N does. The build runs on what Builds with opens on,
   the plan run's own settings, unless the user named others: pass only what
   they named, as `--agent`, `--model`, `--effort`, `--fast`,
   `--permission-mode`, `--account` or `--[no-]orchestration` ("build it
   with Codex" is `--agent codex`). Notes left in the plan's tray go with
   the build, as with Start work.
4. **Reply and stop.** One line with `[Open the build](<link>)` from its
   output, then stop. Chat follows the build from there, as after Start work.
5. **A refusal stops at the gate.** When the helper refuses, run the gate
   command again so the plan waits at its gate, say why in one line, say
   Start work on the plan page still offers the build, and stop.

## Boundaries

A planning run never creates a branch, worktree, commit, diff, receipt,
delivery authority, Ship artifact, or external write beyond a Notion draft
the user asked for in chat (`/orc-docs notion`). It never claims a phase dispatch and never dispatches
`plan`, `build`, or `ship`. Answered questions stay answered: a later round
may sharpen a decision but never silently reverses one. Clarification keeps
its own one-choice rule; this contract relaxes batching for planning
sessions only.

The terminal stop links
`[Open in Orc.app](http://127.0.0.1:4173/#<run-id>/planning/planning.html)`.
