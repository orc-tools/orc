# Shared: Orc entry parsing

Read by `/orc` and `/orc:plan-session` when a launch prompt names a Linear key,
Sentry issue, marked prompt file, fork brief, or `handoff-brief.md`.

## Source parsing

Orc UI launches pass `--launch-run <reserved-id> --quoted-prompt <shell-quoted-brief>`
alongside a server-built `<orc-context>` header for every agent. Decode
`--quoted-prompt` as one shell-quoted token without evaluation, treat
`<reserved-id>` as the run identity, and parse the decoded brief as the source.

Reference recognition is deterministic: Linear and Sentry references may
appear with additive inline context, and Notion is accepted too. Legacy
fork briefs beneath `runs/<parent-id>/forks/` remain readable. New context
children use no-follow marked prompt files beneath
`~/.orc/relationship-contexts/` with `orcPrompt: true`,
`orcContextFork: true`, exact parent ID, configured target repository, package
path, and launch token. Context lineage is required; `parentBranch`,
`baseCommit`, and repository Git provenance are optional and validated as one
independent set. Malformed or contradictory context files fail closed.

A marked prompt file is recognized only when the whole trimmed argument is a
rooted path (`/`, `~/`, `./`, or `../`), one path-shaped token, or is wrapped
in one matching quote/backtick pair. Unquoted multiword text remains freeform.
Resolve relative entry paths from invocation cwd and expand only the current
user's `~/`; reject any `..` component after classification. Open the entry
path with no-follow semantics, then verify regular-file type, Markdown
extension (`<=262144` bytes, valid UTF-8), exactly one unquoted
`orcPrompt: true` marker in opening frontmatter, and a non-empty body. Read
only the body after frontmatter and derive title and slugs from body content,
never from path tokens. A missing, symlinked, non-Markdown, oversized, invalid,
empty, unmarked, or otherwise malformed path-shaped argument is an error: never
silently treat it as freeform. Legacy fork and external context-brief
recognition retains precedence, including when malformed.

A cancelled run's exact `handoff-brief.md` at
`~/.orc/runs/<run-id>/handoff-brief.md` carries one extra provenance effect:
after the successor stub exists, Orc UI atomically and idempotently adds the
one-sided `superseded-by` run link to external relationship authority while
keeping the successor `source=prompt` and preserving every source-run byte.
Never infer this relationship from another filename or directory, and never
auto-link or cancel a non-cancelled source run.
