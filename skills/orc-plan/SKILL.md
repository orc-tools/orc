---
name: orc-plan
description: >
  Plan run (/orc:plan): write a one-screen plan for a request, with a before
  and after mockup when the change is visual, and stop for the user to read it.
---

# /orc:plan — a short plan before any work starts

Apply `../_shared/plain-language.md`. A plan run is what the composer's Start
launches. It writes one short plan, builds nothing, and stops. The user reads
the plan, comments on it, and starts the build from the plan page or by asking for
it. It runs on the planning route, so `../_shared/planning-session.md` owns
the plan page, Start work and the route's boundaries; read it only where a step below sends
you to it.

## Entry

`--launch-run <id>` adopts `~/.orc/runs/<id>`: its `route`, `phase=planning`,
`planning` and `planReveal` are already recorded. `--quoted-prompt` carries
the request, or names the `.md` or `.txt` file that holds it. Read
`../_shared/entry-parsing.md` only for a Linear or Sentry URL. Record the
model with `orc-record-model <run-dir> planning orchestrator <model> inherited`.

1. **A request for information is answered, not planned.** Classify with
   `../_shared/question-runs.md` first. Publish an informational request's
   answer with `orc-publish-question` and stop: there is nothing to build or
   review.
2. **Research before you write.** Read the repository instructions and enough
   code to answer every factual question yourself. Never ask the user a fact.
3. **Ask first only when something blocks the plan.** A choice blocks it when
   the request reads two materially different ways and a wrong guess makes
   the plan useless. Then publish one round per **Rounds** in
   `planning-session.md` (read it with `../_shared/question-form.md` and
   `../_shared/grill.md`), holding only the blocking questions, and write the
   plan when the answers arrive. Everything else is an assumption the plan
   states and the user overrules with a comment.

## The plan

Write `planning/planning.mdx`. It fits on about one screen: at most 300
words, or 450 when it lists several runs. A small change gets a few lines. It
opens with `# <what the user gets>` and one or two sentences that say what
changes for them, then holds these parts in this order:

1. `## What will change` — the visible or behavioural changes, one bullet
   each, most important first.
2. `## Mockup` — only for a visual change. See **Mockups**.
3. `## What Orc assumed` — each choice you made for the user where the
   request left one open, one bullet each, worded so they can overrule it.
   A guess only production data can settle carries a check. See **Checks
   against real data**.
4. `## Left out` — nearby work this plan does not do, with why in a few
   words.

Write `None.` under a part that has nothing in it. Add `## Work` after the
mockup only when one run cannot build the plan: a list numbered from 1, one
run per item as `**<Name>.**` and a sentence, then one sentence on which
steps can run side by side. Without it the plan page offers one Start run.
Each run builds in one repository. When the plan spans several, give each
repository its own steps and name it by folder in brackets after the name,
as `**Export worker** (`serverless`).`, and write `Waits on step N.` in a
step that must wait for another: the plan page's Start then opens one run per step in
its repository, and Orc starts a waiting step when that run reaches Ship.
In a plan of one repository, `Waits on step N.` matters to Split,
which does the same and stacks the waiting step on that step's branch.

The plan holds no file paths, no implementation diary, no checklist of
checks and no decision record. The build run settles its own approach.

## Checks against real data

Some guesses only production can answer, such as whether any team relies
on a setting through an override. When the answer would change the plan,
put a check under that guess's bullet instead of asking the user to say so:
a fenced `sql` query for the read replica, or a fenced `bash` block of
`aws` commands. Indent the block two spaces so it stays in the bullet, then
one line saying which result keeps the plan and which changes it and how,
such as `0 rows: the plan stands. Any rows: those teams keep the old
behaviour.`

- Orc never runs a check. It has no production access, and agents cannot
  run `aws` on the user's machine. The plan page gives each block a copy
  button.
- A check only reads: `SELECT` queries, and `aws` commands that describe,
  get or list (or `aws s3 ls`). Never suggest one whose output holds
  secrets, such as a task definition's environment.
- Write the query from the repository's own schema and models. When the
  repository documents how to reach the replica or which `aws` profile to
  use, follow it.
- Add a check only where its answer changes the plan, at most three per
  plan. Other guesses stay plain assumptions.
- Checks do not count toward the word limit; the result line does.

`orc-plan-ready` refuses a check that could change something, one outside
`## What Orc assumed`, and a fourth check.

## Mockups

A visual change carries a cheap picture of it: the screen as it is today
beside standalone HTML of how it would look. It is a sketch to comment on,
quick to redo, and never the real implementation. Read `../_shared/ui-craft.md`
only when the change is visual: match `DESIGN.md` and the nearest sibling
component first, skip rest-state mockups when nothing changes visually at rest,
and never paste flat 2D SVGs onto 3D renders.

1. **Today.** Capture the smallest region that shows the change, into
   `<run-dir>/shots/before/`, from fictional data. Follow the repository's
   documented capture command (such as in `AGENTS.md` or `CLAUDE.md`) when it
   has one; otherwise capture the running app with `orc-agent-browser` as in
   step 3 and copy the image into `<run-dir>/shots/before/`. Skip this for a
   screen that does not exist yet.
2. **Mockup.** Write `planning/mockups/<label>.html`: one self-contained
   file, no scripts or network requests. When UI is added, removed, or resized,
   build the local container with real flowing CSS using the repo's tokens and
   fonts (`orc-mockup-scaffold --run-dir <run-dir> --label <label>` wires Orc's
   tokens and fonts automatically); use today's screenshot as a background
   image (`../../shots/before/<file>`) only when nothing shifts or shrinks, and
   never mask out old UI with opaque cover-up boxes. Draw a new screen whole.
   When the repository has an `.impeccable/` folder, it designs with the
   impeccable skill: read that skill's `reference/craft-floor.md` before
   writing the mockup and follow it under `DESIGN.md`. Never start its helper
   agents or ask its questions; Orc's steps here come first.
3. **Its picture and self-check.** In one shell command, serve the run folder
   from a throwaway local server, take the picture, and stop the server:

   ```bash
   (cd <run-dir> && exec python3 -m http.server 47611 --bind 127.0.0.1) & server=$!
   orc-agent-browser open <run-id> http://127.0.0.1:47611/planning/mockups/<label>.html
   orc-agent-browser viewport <run-id> <width> <height>
   orc-agent-browser screenshot <run-id> --name <label>.png
   orc-agent-browser close <run-id>
   kill $server
   mkdir -p <run-dir>/shots/after
   cp <run-dir>/browser/screenshots/<label>.png <run-dir>/shots/after/<label>.png
   ```

   Use the screenshot's own width and height (or the flow's width and natural
   height for a CSS-built region). Open `<run-dir>/shots/after/<label>.png` and
   run the five-point self-check in `../_shared/ui-craft.md` before stopping.
   A screenshot name is used once, so a redone mockup takes `<label>-2.png`.
   In a repository with an `.impeccable/` folder, also scan each mockup
   against the repository's design notes:
   `orc-design-check --repo <repo> --report <run-dir>/planning/mockups/<label>.html`.
   Fix what it lists that the sketch only got wrong, and take the picture
   again after a fix. Exit 3 means impeccable is not installed here.
4. **In the plan.** Under `## Mockup`, one line saying what the pair shows,
   then the pair on two adjacent lines so the page sets them side by side,
   then a link that opens the mockup. When step 3 scanned the mockups, one
   line after the pairs names each design problem the scan still lists, says
   it found none, or says impeccable is not installed:

   ```markdown
   ![The composer today](../shots/before/composer.jpg)
   ![Mockup of the composer with Start without a plan](../shots/after/composer.png)

   [Open in browser](mockups/composer.html)

   Impeccable's design scan found no problems in this mockup.
   ```

Show at most three pairs: the screens that change most.

## Stop for the user

Run `orc-plan-ready --run-dir <run-dir> --title "<title>"`. It checks the
plan's parts, its length and that every picture and mockup it names exists,
marks the plan complete and opens the gate. Fix what it reports and run it
again; never set `planning.state` or `status` by hand. Print the run
identity and one link,
`[Open in Orc.app](http://127.0.0.1:4173/#<run-id>/planning/planning.html)`,
then the `Next:` line and the `quick-recap` status line, and stop. Silence is
never a go-ahead: only Start work on the plan page, or the user's explicit
ask to build, starts the build.

## Asked to build

When the user asks the plan run to build the plan, in chat or in a note,
follow **Build when asked** in `../_shared/planning-session.md`: make any
changes asked for in the same message, run `orc-plan-ready` again, then
start the build with `orc-plan-start --run-dir <run-dir>` (`--each` when
they ask for a run per step, such as "a run for each" or "separate runs";
one line asking which when a plan of several steps gets only "go") and
reply from its output with its links, never before it has answered.
Never answer that only the button can start it.

## Notes on the plan

The user comments by clicking a part of the plan, or a spot on a picture, and
sends the notes together. They arrive as one message that names a batch. Read
`../_shared/artifact-feedback.md` and follow it: revise the plan, answer each
note, and run `orc-plan-ready` again so the run stops at its gate. A plan that
is being revised offers no Start work until then. When the batch also asks
to build, start the build next (**Asked to build**).

When the user pastes a check's output, in a note or in chat, revise the plan
from the real numbers: follow the result line the check named, turn the
guess into the fact the output shows, drop the check, and run
`orc-plan-ready` again. Output that answers neither way stays a guess with
its check, and the reply says what it showed.

## Boundaries

A plan run changes nothing in the repository: no branch, worktree, commit or
edit, and nothing written outside the run folder. It starts the build only
through `orc-plan-start` when asked, never builds it itself, never dispatches
`plan`, `build` or `ship`, and never writes `plan.mdx`.
