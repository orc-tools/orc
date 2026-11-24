# Shared: asks table

The asks table shows how closely the result matches what was asked. Put it in
every reply that reports built work: the Ship gate stop, a reopened Ship gate,
and an answer to "is this done?" about a run, ticket, or plan.

## Shape

1. One plain line on overall state first: what is built, and what is live or
   still waiting (Ship, a PR, another repo's branch).
2. Then a two-column table. The first header names the source of the asks; the
   second is `Status`.
3. At Ship, leave out the checks: no **Checks:** or **Testing:** block and no
   list of the commands you ran or their results. The Pull request panel lists
   them under Self-verification. Keep a real problem you found and couldn't
   fix, such as a known limitation or a follow-up, since it needs the reader.
   A status may still name a test as proof that an ask was built.

| Source | First header |
| --- | --- |
| Linear, GitHub, or Sentry ticket | `Ticket asks` |
| Plan (`plan.mdx`, plan session, Notion plan) | `Plan asks` |
| Chat prompt, with or without `inputs/clarification-brief.md` | `You asked` |

## Rows

- One row per distinct ask, in the source's order. Take asks from the
  ticket's description and acceptance criteria, the plan's steps, the
  clarification answers, or the prompt. Restate each ask in a few plain words;
  keep exact names (`/recipes`, `recipe_sources`) in code spans.
- Each status starts with one mark, then one or two sentences on how the
  result meets the ask, naming the exact field, file, event, or command.
  - `✅ Built.` only when the diff or a passing check shows it.
  - `⚠️ Partly built.` names what is missing.
  - `❌ Not built.` says why: dropped by a recorded decision, out of scope, or
    blocked.
- Add a `➕ Extra.` row for work no ask covered, so scope growth is visible.
- Past eight rows, merge closely related asks into one row.

## Example

All of it is built, but none of it is live yet. The API half waits at Ship.

| Ticket asks | Status |
| --- | --- |
| Save where a recipe came from | ✅ Built. The import form sends `source_url` and the API stores it in `recipe_sources.url`. |
| Tell imported recipes apart from typed ones | ✅ Built. `origin` is `imported` or `typed` on each recipe and in the `recipe_saved` event. |
