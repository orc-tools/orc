# Shared: pages to try from Ship

Before opening Ship, control chooses the most useful page or pages for trying
the change. Read the finished diff, hands-on flows, route definitions, and
capture URLs. Prefer the page that demonstrates the intended behavior with the
least navigation. Keep distinct entry points when one page cannot cover the
important flows. Do not add a link for every screenshot, viewport, or UI state.

Record the choice in `meta.worktree.relevantLinks`, ordered with the primary
flow first. Each entry has a short, friendly `title` and a root-relative `path`:

```json
[
  {"title": "Token settings", "path": "/settings/tokens"},
  {"title": "Team permissions", "path": "/settings/members?tab=roles"}
]
```

When a page is where one of the PR body's QA steps happens, add `qaStep`,
that step's 1-based number, once the QA steps are final:
`{"title": "Token settings", "path": "/settings/tokens", "qaStep": 1}`. The
browser tools' **QA steps** panel turns that step into a link to the page and
lists pages with no step under it. The PR body stays host-free; the link
lives only here.

Use paths supported by the actual app. Preserve useful query parameters and
hash routes, but never include credentials, session tokens, absolute URLs,
protocol-relative URLs, or guessed example IDs. Deduplicate paths. Keep
`worktree.url` as the app root and set `worktree.relevantPath` to the primary
path for older clients. For a versioned participant, update its worktree and
the primary root projection together. Control owns this selection and these
metadata writes; a standalone Ship worker never edits metadata.

One valid destination makes the Next steps bar's browser link open that page
directly. Multiple destinations make it a split button: the main link opens the
app root and the arrow lists the named pages with their resolved URLs. The bar
only offers links while the app is running.

Reconsider these choices after Ship feedback changes the work. If there is no
useful specific destination, remove stale `relevantLinks` and `relevantPath`
and use the app root. If no worktree app exists, omit the links. Selecting links
never requires a user choice or blocks Ship.

## Launch commands

Some apps are tried outside the browser, such as a desktop game or native app
that the repository starts with its own launcher. When you viewed the change
that way, record the launch in `meta.worktree.relevantLaunches` instead of
`relevantLinks`, primary flow first. Each entry has a short `title` and the
one-line `command` to run from the worktree root:

```json
[
  {"title": "Harbor chase",
   "command": "./bin/launch-app --player --scene level:harbor:chase"}
]
```

Use the launcher and destination flags you used to view the change: the
place, mode, distance or save that reaches it with the least navigation. Make
the session visible and interactive, and drop flags that only suit automation,
such as headless, recording, time limits or bot drivers. Use only launchers
and flags the repository documents, never a secret, and only a save file that
stays in the worktree or run directory.

Copy every destination ID exactly from the launcher's own listing, such as its
`--list` output, or from a command you ran that reached the change. Never build
one from the pattern of another ID or of the example above: a launcher can
spell sibling destinations differently, so `level:harbor:chase` exists
while the similar-looking `menu:debug:cutscenes` does not. Before recording,
run the listing and check that each destination appears in it. Prefer the
destination that shows the change itself, such as the cutscene, over a menu
the user must navigate from. When no listing confirms a destination, record
the launcher with no destination and say where to go in the PR body.

The Next steps bar then offers every launch in place of the browser link, and
each runs its command in a new terminal tab in the run's worktree. Orc ignores an entry whose command spans lines. Update or remove
launches when Ship feedback changes the work.

## MCP setups

When the run changed an MCP server that its run's MCP tab reaches,
record in `meta.mcpSetups` the calls that show the change, primary first, so
the MCP tab offers them to load, run and compare. Each entry has a short
`title` and exactly one of `tool`, `resource` (its URI) or `prompt`, with
`arguments` as a JSON object (prompt arguments are strings):

```json
[
  {"title": "Search for setup", "tool": "search_pages", "arguments": {"query": "setup"}},
  {"title": "Getting started page", "resource": "docs://pages/getting-started"}
]
```

Use arguments that worked against the run's own data when you tried the
change; copy them from that call rather than guessing IDs. Record two to six,
never a secret or a token, and nothing that writes unless the change is about
that write. The tab also lists the calls the run's agent made to the server,
so there is no need to repeat those unless a title helps. Update or remove the
setups when Ship feedback changes the work.
