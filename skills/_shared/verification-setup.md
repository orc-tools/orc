# Shared: verification setup

A project's home suggests this run until the project tells runs how to check
their work. The run studies how the project is tested and run, asks the user
one round of questions, writes a **Verifying changes** section, and tries it
out once end to end before shipping so every later run follows working steps
during self-verification ([self-verification.md](self-verification.md), step 1).

The user picks where the steps go before the run starts, and the prompt says
which:

- **In the repo** (the default): the section goes in the repository's
  `AGENTS.md`, on a branch, and ships like any other change.
- **Private:** the prompt asks for a private verification guide. The same
  section goes in the file `orc-verification-guides --repo <checkout>
  --private-path` prints, which lives in Orc's data outside every
  repository. Nothing in the repository changes: no branch, worktree or
  commit.

Project Settings' Verification card starts the same run in two more ways,
for a project whose steps already exist in the repo or as a private guide:

- **Update steps:** the prompt names where the steps are (any heading, in
  `AGENTS.md`, `CLAUDE.md` or the private guide) and quotes the change. Skip
  steps 1 and 2, change only what it asks there, keep the heading, then dry-run
  (step 4) and ship or settle (step 5).
- **Set up again:** run every step from scratch and in step 3 replace the
  existing section or private guide instead of extending it, keeping its
  heading and file. A plugin's guide changes only in its plugin.

The route stays `minimal-shell.md`. This file says what the run finds out,
asks and writes.

## 1. Find out before asking

Read the project's checkout without changing it:

- **Existing guidance:** `AGENTS.md`, `CLAUDE.md`, `README*`, `CONTRIBUTING*`
  and `docs/`. When a heading about verifying already exists, extend that
  section instead of adding a second one (Set up again replaces it).
- **Existing guides:** `orc-verification-guides --repo <checkout>` lists the
  user's private guide and enabled plugins' guides. A listed plugin guide
  already covers the repository: settle the run without a diff and name the
  guide in the summary. A private run that finds a private guide extends it
  (Set up again rewrites it).
- **Tests and checks:** the test runner and how to run one file or test
  (`package.json` scripts, `Makefile`, `bin/`, `pyproject.toml`, `Gemfile`,
  CI workflows), plus the type checker and linter.
- **Running the app:** the dev server command and port, environment files the
  checkout needs, whether Orc's worktree servers already start it, and any
  read-only health check or teardown command.
- **Signing in and data:** seed scripts, fixtures, demo accounts, and which
  services must never be driven (production, shared staging).
- **Proof:** an existing screenshot or capture command, Playwright or other
  browser tests.

## 2. Ask one round

Ask through the Clarification form (`grilling-phase.md`) before branching
(a private run never branches), even when the evidence looks complete: the point of this run is the user's
own priorities. Put what you found in `clarification/clarification.mdx` as
short facts, then ask up to four questions in one
`clarification-questions.json`, each with a recommendation drawn from the
evidence and `other: true`:

1. Which flows matter most to check after a change (`multi`, from the
   routes, screens or commands you found).
2. Whether visible changes need screenshots or GIFs (`single`).
3. Which account, role or seed data runs should sign in with (`single` or
   `text`); skip it when the project has no sign-in.
4. Anything runs must never touch, such as production data or paid APIs
   (`text`); skip it when the evidence already says.

Ask nothing else. Fold the answers in once and do not ask a second round.

## 3. Write the section

**In the repo:** add one section headed exactly `## Verifying changes` to the
repository's `AGENTS.md`, creating the file when it is missing. When only
`CLAUDE.md` exists, add `@AGENTS.md` to it so both agents read the same steps.

**Private:** write the section, under the same heading, to the path
`orc-verification-guides --repo <checkout> --private-path` prints, creating
its folder. Read the checkout in place and leave it untouched.

Either way, keep it under about 40 lines of concrete commands, in this order:

- **Targeted checks:** how to run the tests for changed files, the type
  checker and the linter. Say not to run the full suite unless asked.
- **Run the app:** the command, port and any setup a fresh worktree needs.
- **Health check:** a read-only readiness check confirming the app is usable
  before flows run (not just that a port is open).
- **Sign in and data:** the account or seed to use, and what never to drive.
- **Flows to exercise:** the flows the user picked, each as one line naming
  where to start and what to observe.
- **Proof:** whether to capture screenshots, and the command that takes them.
- **Cleanup:** how to stop only processes and browser sessions the run started,
  keeping saved proof intact.

## 4. Dry-run the steps

Write only commands you confirmed exist. Before shipping or settling a private
guide, execute the written steps once end to end against the checkout:

1. **Targeted checks:** run each command once. A command that fails at the base
   commit goes in as written with a note, never as a guess at a fix.
2. **Launch and health check:** start the app using the written command and run
   the health check to confirm it is usable.
3. **One main flow:** exercise one picked flow end to end (and run the capture
   command when proof capture is enabled).
4. **Cleanup and proof check:** run the cleanup steps — stopping only processes
   and browser sessions this run started — then confirm saved proof still exists
   on disk (and that a private run leaves the checkout clean).

Fix any broken step in the guide and re-run it before shipping or settling. If
a local limit blocks a step (missing credentials, external service, or
hardware), record the exact blocker beside that step in the guide and in the PR
body or settlement summary instead of leaving an untested step unmarked.

## 5. Ship

**In the repo:** build proof is the targeted checks and dry run you ran. The PR
body lists what the section covers, the answers it records, what the dry run
proved, and any blocked step. Nothing else in the repository changes.

**Private:** there is no diff to ship. Settle with
`orc-record-delivery --run-dir <run-dir> --no-diff --summary "<what the guide
covers, what the dry run proved, and where it is saved>" --title "<title>"`,
per `minimal-shell.md` step 1.
