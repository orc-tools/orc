# Evals parent

Use this route only for the adopted run whose `meta.json` has `route=evals`
and an `evals` record. Orc launched it as the parent of one ordinary `/orc`
child per candidate: each on its own agent, model and effort, with its own
Fast and Orchestrate, each in its own worktree. Every candidate gets
the same prompt unless it was given its own. The parent compares them. It never sets up the
project, creates a branch or worktree, opens a Plan, builds, or delivers.
Children ship through their own Ship gates.

Keep `route`, `evals`, the run ID, and the session fields. Refine `title` and
remove `titlePending` as any adopted run does. Never write `branch`,
`worktree`, `lifecycleVersion`, or delivery fields.

## First turn

Read `meta.json` `evals.children`. Print one line per child: its candidate
label, its run link (`#<childRunId>`), and whether it launched or failed with
its `error`. Print this run's own link, say the report comes once every child
has settled, and end the turn. Do not poll or wait.

## Report

Orc sends one message when every child has settled. Write the report then, or
when the user asks for it in Chat, even with children unsettled; say which.

1. Run `orc-evals-report gather --run-dir <this run dir>`. It writes
   `evals/facts.json`: per blind letter (Candidate A, B, …) the prompt it
   was given, the final phase and status, wall time from launch to settle, tokens and cost, diff
   stats, Build proof commands and results, and paths to `diff.patch`,
   `pr-body.md` and `shots/manifest.json`. `evals/blind.json` maps letters
   to candidates; do not open it yet.
2. Judge blind. For each letter, read only the files `facts.json` lists for
   it: the diff, the PR body, the proof and any screenshots. Do not open the
   child's `meta.json`, chat or run folder otherwise; they name the model.
   Score each dimension 1–5, or `unknown` when the evidence is missing, with
   one line of evidence each:
   - did what was asked (against that letter's `prompt` in `facts.json`,
     not against each other);
   - correctness and proof (checks that ran and passed, not claimed);
   - scope discipline (no unrequested changes);
   - code quality (fits the codebase, simplest correct change);
   - UI evidence, only when the prompt changes UI.
   Then compare each pair: which is better and why, in one line. A candidate
   with no diff or a launch failure scores `unknown` and loses every pair.
3. Unblind only after scoring: read `evals/blind.json` and attach each label
   and child run ID to its letter. Do not change a score after unblinding.
4. Write the report to a scratch file and publish it with
   `orc-evals-report publish --run-dir <this run dir> --report <file>`. It
   refuses a report without the parts below and, on success, writes
   `evals-report.md`, sets `phase=done`, `status=complete` and
   `outcome=evals`. Fix and retry on refusal; never write those yourself.

The report, in plain language (`plain-language.md`):

- `TL;DR:` the verdict: the winner and the one reason, or "no clear winner".
- A scoreboard table with columns Candidate | Outcome | Checks | Diff size |
  Time | Tokens | Cost | Score. Score is the mean of known dimensions. Facts come from
  `facts.json`; write `unknown` rather than estimating. Outcome names where
  the child stopped (`Ship gate`, `Escalated at Build`), never who it waits
  on. Checks is passed over ran (`4/4`), or `none` when none ran; Orc shows a
  tick or cross beside it. Diff size is `5 files, +2 −9`. Time is minutes and seconds (`4m 15s`),
  never raw seconds. Tokens is `cost.tokens.total`, rounded (`412k`, `1.2M`).
- What differed: approach, scope, tests, and UI when relevant.
- Per-candidate notes, each linking its child run as `[label](#<childRunId>)`.
- Method and caveats: judged blind on the rubric above; one trial is an
  anecdote, not a statistic; repeat trials of one candidate are reported as a
  pass rate (settled with passing proof / trials), not averaged into one
  score; when this run's own model family matches a candidate's, say the judge
  may favour it; when `ownPrompts` is true, say which candidates had their own
  prompt and that their scores compare the prompt as well as the model; every
  child started from `baseCommit`.
- `Next:` open the winner's PR body (its child run) and ship it from there, or
  what to try when there is no winner.

End the turn with the run link. Later Chat messages are follow-up questions
about the comparison: answer them from the evidence, and republish only when
the user asks for a changed report.
