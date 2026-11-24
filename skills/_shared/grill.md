# _shared/grill.md — the refine-loop grill

How Orc runs a plan-gate refine loop (and any other open-question loop): a
relentless interview that sharpens the plan instead of a batch questionnaire.
Orc's independent local adaptation of Matt Pocock's `grilling` / `grill-me`
workflows and earlier `grill-with-docs` / `wayfinder` patterns. Those projects
are attribution and design references, not vendored text or runtime
dependencies; this file is Orc's complete contract.

The mandatory pre-plan lifecycle lives in `grilling-phase.md`. The rules below
govern that internal stage and any legacy question-round refine loop.
Planning sessions (`planning-session.md`) keep every rule here except the
first: they ask the whole settled frontier as one batched round.

## The grill

- **One question at a time.** Ask, wait for the answer, fold it in, then ask
  the next. Never dump a questionnaire in chat (the gate page's form is the
  one sanctioned batch — the grill picks up where its answers leave fog).
- **Probe with concrete edge-case scenarios.** Not "is per-repo ok?" but
  "'gate' means pipeline stop in orc, feature flag in rails — one global
  glossary collides; still global?".
- **Recommend every time.** Each question carries a recommended answer and
  why, one line, worded so that "yes" accepts it. The user picks; you never
  pick for them.
- **Never answer your own questions.** A question the user must decide stays
  open until they answer it.
- **Repo answers first.** A question the codebase can answer is answered by
  reading the codebase, never asked. Only genuine user-judgment calls reach
  the user.
- **Sharpen fuzzy terms.** A vague term overloading two concepts gets split
  and named the moment it's noticed; the plan adopts the canonical term.

## Write it plainly

Every question the user reads, in a form or in chat, follows these rules:

- **Short questions, real names.** Use the names from the code and the
  request. No metaphors, coined terms, or slogans. Contract words such as
  frontier, fog, and wayfind never reach the user.
- **"Yes" accepts the recommendation.** Ask "Should the JSON list exactly
  what the editor shows?", not "Which properties appear in the JSON?". Name
  the other choices in the question's context only when the user needs them
  to answer.
- **Say "Recommended" once.** Mark the recommended option with
  `recommended: true` and give it one short reason. Never write
  "Recommended" in a label or description: the form's pill already says it.
  Planning rounds go further and give the other options a label alone.
- **A round is only its questions.** Keep summaries out of the round. The
  settled list belongs at the end, once, for the user to confirm.

## Plan decision horizon

This staging applies to lifecycle planning; it does not change standalone
`orc-init` or other workflows that use question-like prompts.

**Grilling owns every user-facing question — product and technical.** A
user-owned technical choice that affects visible behavior, safety/rollout, or
a hard-to-reverse contract is asked during Grilling (one at a time, per
`grilling-phase.md`), never deferred to Plan. Grilling researches deep enough
to surface those choices before approval.

1. Consume the approved Grilling brief as direction authority, then perform
   targeted repo/docs research and the plan-skeptic pass. Plan never reopens a
   routine direction round and never asks questions.
2. **Flagged assumption** — when planning research still uncovers a genuine
   user-owned choice Grilling missed, take the recommended answer as a
   reversible default and record it as a flagged `Locked decisions` row
   (provenance: `flagged assumption`). The plan gate's Request revision
   textarea is the correction channel; a wrong default costs one revision
   cycle, never a question round.
3. Show a concrete, question-free build plan for explicit approval. Earlier
   Grilling answers never approve a plan version.

Fresh plans never write `plan-questions.json`. Historical runs holding one
resume their recorded question round unchanged (legacy compat only).

## Paper trail — the project glossary

Resolved terms outlive the run. The moment a term crystallises (not batched
at the end), append it to the work repo's glossary at `~/.orc/context/<repo-slug>.md`:

- One line per term: `**<term>** — <meaning in the project's own words>`.
  Create the file lazily with a `# Context: <repo>` heading on first term.
- Glossary stays a glossary: vocabulary only — no implementation details, no
  spec, no decisions.
- **Never create a repo-level `CONTEXT.md`** — the paper trail lives under
  `~/.orc` so it compounds across runs without touching the work repo. A
  repo that already keeps its own `CONTEXT.md` still gets read; it just isn't written.

ADRs stay with the existing plan contract: mark a decision ADR-worthy only
when hard-to-reverse + surprising without context + a real trade-off — all
three or skip. Most grills produce sharper terms and no ADRs; that's the
intended shape.
