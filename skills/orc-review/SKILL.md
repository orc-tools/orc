---
name: orc-review
description: >
  Read-only PR sense-check (/orc:review <pr-url> or Review in Orc): single-pass
  Ship or Hold verdict with concrete findings and a drafted GitHub review.
---

# Orc PR review

Answer one question: **Is this PR safe to merge as-is?**
Strictly read-only: never edit, stage, commit, revert, push, or post to GitHub.
Apply `../_shared/plain-language.md`.

## 1. Setup and inputs

Initialize once against the checkout:

```bash
orc-local-review init --repo <checkout> --harness <claude|codex> \
  [--run-dir <run-dir>] [--pr <pr-url>] [--base <ref>] [--ticket-file <file>]
```

- Pass `--run-dir` to adopt a launch stub; if `init` refuses, report why and stop.
- Pass `--pr <url>` when a PR URL is given and `--base <ref>` for non-default bases.
- When Linear MCP is available, look up the linked ticket by PR URL attachment or
  first ticket key in the branch name, write its body and comments to a temp file,
  and pass `--ticket-file <file>`.
- Read the captured diff (`review/input-*.patch`, `review/input-new-files.json`),
  `review/requirements.md` (ticket + `gh pr view` description, commits, and earlier
  comments/threads), `~/.orc/review/learned-checks.md`, and `review.contextFile`
  when present. Run `orc-app-plugin repository-rules --repo <checkout>` and apply
  any returned rules to that checkout only.
- Existing PR comments and review threads are **background only**: never re-raise
  points the author already answered unless new code refutes their reason.

## QA steps for a pull request

When `review.prUrl` is set and the run is not under a `qa` run, publish typed
steps with `orc-qa-steps publish` per `../_shared/qa-steps.md` before the pass
below. Review in Orc seeded `qa/steps.json` with the PR's QA items
(`"seeded": true`, ids `pr-1`...): type each, copying its `id` only onto the
typed step that checks the same thing. With no file, use the QA section (`QA`, `QA steps`, `How to
test`, `Test plan`), or the diff with `"source": "diff"`. Orc started the app.

## 2. Single focused pass

Read the code before the PR description. Skip style, naming, formatting, and
CI-enforced nits. Check only high-signal risks:

1. **Ticket and spec alignment:** Compare behavior against the ticket (or request).
   Flag missing, partial, wrong, or unrequested behavior; treat the PR body as
   claims to verify.
2. **Failure hunting:** Trace concrete failure paths across changed code:
   - *Partway failure:* error/timeout leaves half-written state, hides failure, or
     reports success before the write lands.
   - *Duplicate / concurrent run:* double-click, retry, two tabs, two jobs, or
     crash re-run duplicates, overwrites, or undoes work.
   - *Non-grep shared readers/writers:* changed fields, columns, keys, files,
     flags, events, URLs, or payloads broken for external readers/writers.
   - *Bad / empty inputs:* empty, null, huge, boundary, wrong shape, stale/deleted
     ID, or untrusted input.
   - *UI vs server permission/gate mismatches:* controls visible to roles the
     server rejects, frontend checks without backend guards, or unguarded routes.
3. **Optional read-only check or repro:** Run targeted read-only tests or a quick
   repro in the checkout when it confirms or refutes a finding; leave files clean.
4. **Strict noise floor:** Report a finding only when every step appears in code
   with `file:line`, concrete failure path, and suggested fix. Zero style nits,
   zero speculative what-ifs. An empty findings list is valid.

## 3. Publish verdict and drafted review

Write a result JSON and publish with `orc-local-review publish --run-dir <run-dir> --input <result.json>`:

```json
{
  "schemaVersion": 1,
  "scopeDigest": "<inputScopeDigest from init>",
  "verdict": {"ship": false, "summary": "1-2 sentences on what the PR does and why it holds or ships."},
  "findings": [{
    "id": "stable-slug", "title": "Short plain title", "file": "path/to/file.py",
    "line": 42, "blocking": true, "evidence": "Concrete failure path.", "fix": "Smallest concrete fix."
  }],
  "checks": []
}
```

- `verdict.ship` is `true` iff nothing has `blocking: true` and no required check
  failed. Add non-blocking notes (`blocking: false`) only when high-signal.
- **Drafted GitHub review** (when `review.prUrl` is set): write
  `pr-review-draft.json` (`schemaVersion: 1`, `round: 1`, `pr`, `author`,
  `authorName`, `commit`, `verdict`, `recommended`: `REQUEST_CHANGES` / `COMMENT`
  / `APPROVE`, `suggestedNote` (a short overall note the user can take; never
  write `note`, so the review posts without one unless the user adds it),
  `comments[]` with `id`, `header` (a sentence-case title), `finding` (one or
  two sentences on what is wrong, never the `id`), `path`, `line`, `diffHunk`,
  `url`, `body`, `recommended`: `keep` / `drop`) and run
  `orc-pr-review check --run-dir <run-dir>`. Never post to GitHub; if asked in
  chat to reword a comment, run `orc-pr-review edit --run-dir <run-dir> --comment <id> --body-file -`.
- **Sound like the user typed it.** `suggestedNote` is one short line ("Looks
  good 👍", "Couple of things, see comments") or empty on a clean approve; each
  comment `body` is the problem and fix in a sentence or two. Never restate the
  PR, justify the verdict, cite policy, or explain your reasoning. Bad: "Looks
  good. Both log groups already read `logRetention`, so prod gets 180 days."
  Good: "Looks good 👍". Bad: "I noticed the bucket lives in process memory,
  which means each deploy resets limits." Good: "Resets on every deploy. Redis?"
- Open the report (`orc-ui open --gate '<run-id>/review/recap.html'`), reply with
  the `Ship` or `Hold` verdict, 1–2 sentence summary, blocking findings before
  optional notes (`file:line`, failure path, suggested fix), say the GitHub review
  is drafted (nothing posted yet), and stop.

New commits pushed to the PR re-run fresh against the new head — no repair mode,
no multi-round history, no quiz UI, and no acknowledgment digests.
