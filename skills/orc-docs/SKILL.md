---
name: orc-docs
description: >
  Draft pr-body.md (default before PR) or an opt-in private Notion/tech doc,
  including "draft me a
  Notion doc for this" or /orc-docs [pr|notion|both|techdoc].
---

# /orc-docs — PR body and docs writer

Apply `../_shared/plain-language.md`. On `route: "minimal-shell"`, draft
`pr-body.md` from `delivery-authority.json`, `shots/manifest.json`,
`diff.patch`, and `inputs/build-spec/source.json` (otherwise `plan.mdx`,
`build-summary.md`, and reports). Control drafts inline when Orchestrate is off
(or uses a bounded read-only Orc task per `../_shared/handoff.md`); never spawn
a native drafting agent or new phase lease.

## Which outputs to write

PR body generation is mandatory before opening a PR (generation does not authorize opening one). For grouped multi-repo delivery, write one
`delivery/<group-id>/pr-body.md` per group from only that repo's evidence and
template.

- **In-flow (`/orc-docs pr`):** write `pr-body.md` only; never prompt or touch
  Notion.
- **Standalone (`/orc-docs`):** adopt the run (`phase=docs,status=running` when
  no arg), write `pr-body.md`, and offer Notion only when invoked bare (`Skip
  (Recommended)` default, printing the run link first).
- **Notion / Tech doc (`notion|both|techdoc` or chat request):** Notion is
  strictly opt-in — this is the only way a Notion doc gets made, and a run at a
  gate must never change its `phase` or `status`. Read
  [references/notion-and-techdoc.md](references/notion-and-techdoc.md) (including
  **plan doc** — a completed planning session, never the feature or spike
     shape, plus recorded `docs` worker leases) and follow it.

## Repo PR template — use it verbatim when one exists

Check `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`,
and `.github/PULL_REQUEST_TEMPLATE/` (case-insensitive) first. When present, **it
is the skeleton**:

- Keep its exact headings, section order, helper links, and intro tips verbatim.
- Keep all unticked checklist items; tick satisfied items plus **Claude** under
  *AI contribution* when present.
- Fill its sections using the project's writing instructions. Keep checklist items in the template and invent none when absent.

## Draft the description

Before drafting, read the active writing instructions for this body:

```bash
orc-pr-body-lint <run-dir>/pr-body.md --repo <checkout> --print-instructions
```

For grouped delivery, pass each group's body path and checkout separately.
Follow the printed instructions for the description's content, structure, tone and length.
They are editable under Settings → Projects → project → Delivery. With the
default, use the headline as the first heading when there is no repo template.
Write visible notes, keep QA host-free, and omit AI attribution footers.
Keep required review limitations and screenshots as described below.

Lint each finished body and fix reported violations:

```bash
orc-pr-body-lint <run-dir>/pr-body.md --repo <checkout>
```

Add `--shots <run-dir>/shots/manifest.json` when captures exist. Never hand-author
`pr-body.md` outside `/orc-docs pr`.

The run's QA button walks these QA steps in a window beside the worktree app,
each on the page `worktree.relevantLinks` gives it. Base the QA steps on the
real flows exercised during self-verification (`../_shared/self-verification.md`),
keeping them host-free and within the body cap; fold brief observed outcomes or
edge cases cleanly into the steps or a concise visible note without raw log
dumps. Read `../_shared/qa-steps.md` **only when** a QA step is a command to
run or an MCP call, or the change treats some setup differently that the QA
steps never try (another plan, role or account): publish every step typed, QA
steps then edge cases, since published steps replace the ones read from the
body.

## Review evidence

Never add review status chatter (e.g. `"Self-review complete (inline)"`);
`orc-pr-body-lint` rejects it. Put concrete limitations (an unverified runtime
boundary, skipped live flow, or missing screenshot) beside the affected check
or under `### Limitations` after QA, alongside any `reviewEvidence.deferred`
entries and high or medium `reviewEvidence.closedByControl` entries with
`status: dismissed` (by id and reason).

## Screenshots

When `~/.orc/runs/<id>/shots/manifest.json` exists (reconstructing `manifest.json` from `.jpg`, `.jpeg`, `.png`, and `.gif` files under `shots/{before,after}/` ignoring `test-results/` only if unindexed files sit under `shots/`), add a
**Screenshots** table using plain Markdown `![alt](/abs/path/under/shots/...)`
syntax (`—` when `before: null`, `_New_` when `new: true`) so `orc-pr` can
rewrite paths via `gh pr create --attach`:

```markdown
| flow | before | after |
|------|--------|-------|
| tab reorder | ![before](/Users/me/.orc/runs/<id>/shots/before/tab-reorder.jpg) | ![after](/Users/me/.orc/runs/<id>/shots/after/tab-reorder.jpg) |
```

Never put a mockup in the PR body, even when an entry has `mockup` (the flow
was built to a plan's mockup): the table keeps `before` and `after` only, and
the mockup shows beside the real screen in the run's Assets tab.
`orc-pr-body-lint --shots` fails on a body that embeds one.

Never use `<img>`, never link local recap pages, and never commit media to git.
Attachment preflight belongs to delivery. `orc-pr` checks the installed `gh` version and omits screenshots on older `gh` — do not read `../orc-pr/SKILL.md` while drafting `pr-body.md`.

## Preview

Run `orc-ui start` and print `http://127.0.0.1:4173/#<run-id>/pr-body.md`
without auto-opening a browser. When Orchestrate is on, include the repo PR
template and the active writing instructions verbatim in the read-only drafting brief, then run the
finalize pass yourself.
