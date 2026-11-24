# Notion drafts, tech docs, and recorded docs worker mode

Read this file only when drafting a Notion doc (`/orc-docs notion|both`), drafting or refining a tech doc (`/orc-docs techdoc`), or reconciling an already-recorded `phaseDispatch.phases.docs` worker lease.

## Recorded `docs` worker mode

Control mode handles every ordinary `/orc`, chat, standalone, feedback, or resumed invocation inline (using bounded read-only Orc tasks only when Orchestrate is on) without creating a phase worker or lease.

**Worker mode** applies only when control supplies an `orc-phase-handoff claim` for phase `docs` (`generation`, `attempt`, `claimToken`, `inputManifest`, requested output kind). Run `orc-phase-handoff start --run-dir <run-dir> --phase docs --generation <generation> --claim-token <claimToken>` before reading/writing phase data; write only the claimed artifacts (`pr-body.md`, `delivery/<group-id>/pr-body.md`, `docs/feature.md`, or `docs/tech-doc.md`) from pinned inputs without external fetches or Notion calls, lint any PR body with `orc-pr-body-lint`, and publish via `orc-phase-handoff complete` (`--output`, `--verification`, `--model`, `--status`, `--summary`), returning `MANIFEST`, `STATUS_POINTER: meta.json#/phaseDispatch/phases/docs`, `MODEL`, and `STATUS`. Control consumes the manifest and owns Notion writes, URLs, questions, and gates.

## Notion doc outputs (opt-in only)

Notion is **always opt-in** — never auto-create it:
- **feature doc** — shipped feature (`docs/feature.md`, save URL as `notionUrl` in `meta.json`)
- **spike doc** — investigation / research output
- **qa doc** — test plan / QA notes
- **plan doc** — completed planning session (`planning/planning.mdx` alone; sections in order: **Destination**, **Work**, **Decisions**, **Open questions**, **Out of scope**, **Glossary**; never a build contract)

A request in chat ("draft me a Notion doc for this", "write a tech doc for this", or `/orc-docs notion|techdoc [<run-id>]`) — this is the only way a Notion doc gets made; Orc UI has no Notion button. Resolve the named or active run (or keep the draft in chat if there is no run), pick the type automatically (`techdoc` when requested or pre-Build; `plan doc` for a planning session; else `feature`/`spike`/`qa`), create the private draft, save `notionUrl` or `techDocUrl`, and print the link. On failure before saving the URL, report a concise error and write nothing. A run at a gate stays there: never change its `phase` or `status`, and reopen the gate with `orc-ui open --gate` on exit when invoked in that session. Attach screenshots via `notion-create-attachment` when opted in.

## Tech doc (`/orc-docs techdoc <run-id>`)

Drafted on request (see above). It is a review artifact,
not a delivery one: nothing is approved, built, or shipped by drafting.

- **Connector first.** Before any run-dir or `meta.json` write, confirm a
  Notion page-create tool is actually available. Missing -> report that Notion
  is not connected, leave the run dir untouched, stop.
  Never write a half-doc or a link to a page that was not created.
- **Genre.** Two shapes, picked from the run, not asked. Use the **spike** genre
  when the run is an investigation — the brief or plan Destination is to find
  out, evaluate, prototype, or answer a question rather than ship behavior, or
  the source is a spike ticket. Everything else is a **design doc**, which is
  also the default whenever the run is ambiguous. State the genre in one line at
  the top of `docs/tech-doc.md` so a redraft stays consistent.
- **Body.** Write `docs/tech-doc.md` in the chosen genre's shape, sourced from
  `plan.mdx` and the approved Grilling brief when present. A minimal-shell
  run has no `plan.mdx`: use the frozen `inputs/build-spec/source.json`,
  `diff.patch`, and `pr-body.md` instead. Use a read-only Orc drafting task when Orchestrate is on, or draft inline
  when it is off, following `../../_shared/handoff.md`; control edits the result.
  Prose for a colleague, but a colleague who wants specifics.

  **Design doc** — these sections in order, omitting any the run cannot fill:

  1. **Metadata header** — a leading blockquote: `Status`, `Stage`, `Owner`,
     `Last updated`, `Related to`. Fill it only from what the run knows — the
     plan title, `sourceUrl` from `meta.json`, today's date — and drop the
     fields the run cannot source rather than guessing at them.
  2. **TL;DR** — a verdict, not a description: what ships and where the
     engineering risk actually sits, as one short numbered list when the risk
     splits across decisions.
  3. **Decisions** — numbered, one per hard choice. Each is a framing question,
     then the options with a Pro/Con line each, ⭐ on the chosen one, then
     `**Decision:** option N` and one line of why. Rejected options stay in the
     doc — they are the record of what was considered. A plan records the pick,
     so a decision with no recorded alternatives is written as a bare
     `**Decision:**` line and a reason; never pad it with invented options.
  4. **Risks** — a table `# | Risk | Impact | Mitigation`. Each mitigation names
     something real: a ticket, a spike, a rollout step.
  5. **Phased delivery** — the numbered rollout order, saying what each stage
     unlocks and what gates it.
  6. **Open questions** — left open, as questions. This is what earns comments,
     so keep it honest and specific.
  7. **Appendix** — the links: tickets, PRs, related docs, prior art.

  Add **API changes** or a **State transitions** mermaid diagram when the work
  has either; skip both when it does not.

  **Spike doc** — Ski's numbered investigation shape:

  1. **Summary** — owner, date, timebox, status, related tickets and docs.
  2. **What we should know** by the end — the questions the spike answers.
  3. **Constraints and assumptions** — what was fixed going in.
  4. **Approach** — what was actually tried, including the dead ends.
  5. **Findings** — one sub-section per question, with the non-obvious bits
     called out.
  6. **Recommendation** — plus its trade-offs and what to weigh if picked up.
  7. **Next steps** — checkboxes.
  8. **Links** — branch, PR, references, libraries.
- **Evidence.** Concrete references are wanted, not banned: table and column
  names, endpoint paths, ticket IDs, branch and PR links, file paths. They are
  what make the doc reviewable. **Never invent** the things that make a doc
  credible — a metric, a baseline, a customer name, a percentage, a date. When a
  section has no real evidence behind it, omit it or mark it explicitly unknown.
- **Create it** in the user's Notion private drafts, record the page URL as
  `techDocUrl`, and print its deep link.
- **Where it shows.** Orc shows `docs/tech-doc.md` in the run side panel's
  **Tech doc** view, with an **Open in Notion** link to `techDocUrl`; it has no
  run tab.
- **Redraft** (`techdoc` again): rewrite `docs/tech-doc.md` and update the
  same Notion page. Same page, same URL.
- **Refine** (`techdoc <run-id> — refine: <text>`, or a steer typed in chat):
  the text is the **steer**, not the new body. Apply it to
  `docs/tech-doc.md` under the same genre, shape, and evidence rules, then
  update the same Notion page. Refining a run with no `techDocUrl` yet is a
  first draft, not a refinement.
- **Shared docs stay put.** When `meta.json` has `techDocPublic: true` (set by
  older runs once teammates commented), attempt **no** Notion write for that
  doc: answer in chat with the replacement text for each named doc section.
- **Keep the plan in step.** A refinement that contradicts `plan.mdx` — a
  decision, scope line, or risk the plan asserts — revises the plan in the same
  pass: snapshot `plan.mdx`, fold the change in, run `orc-plan-lint
  <run-dir>/plan.mdx --final`, and report which of the two documents you
  touched. A refinement the plan does not assert leaves `plan.mdx` untouched;
  never edit the plan to look consistent, and never treat a refinement as plan
  approval — that stays the gate form's job. After the build, the plan is
  approved and immutable: start a follow-up child run instead.

## Notion guardrails — NEVER touch shared/live docs

Notion is a shared space. Automating edits to it is off-limits.

- **Never modify an existing Notion doc.** Do not call `notion-update-page`,
  `notion-update-data-source`, `notion-update-view`, or `notion-move-pages` on
  any page you did not create this run. New work = a brand-new page only. The
  one page this run may rewrite is its own tech doc, and only while
  `techDocPublic` is unset — after that it is as untouchable as anyone else's.
- **Always create in private drafts.** Every page this skill makes goes in the
  user's private Notion drafts space — never a shared/team area.
- **Need existing content? Clone, don't edit.** If the doc must build on or
  reference an existing page, `notion-duplicate-page` that page into the private
  drafts, then edit the copy. Leave the original untouched.
- **Publishing is manual.** Never move/promote a draft into a shared space. Tell
  the user the draft is ready and let them apply changes to the live doc
  themselves. Output the draft URL so they can.
