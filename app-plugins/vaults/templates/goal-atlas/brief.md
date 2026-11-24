# Goal Atlas

Keep the illustrated cartographic cover, the goals and evidence on facing pages, and the embedded chat. Keep the Add a goal action available as the list grows. The user can rename or restyle any of it.

Record each goal and the next step the user gives in goals.md. Show that information in the goals list. Add a date, milestone or progress figure only when the user supplies one.

## Finding evidence

The two Find evidence buttons ask for a search of one source. Read the saved goals first. If there are none, ask for the first goal in your reply. When the request names a goal or source, search within that scope. Use the current vault login and the builder’s existing permissions.

- For GitHub, use the authenticated gh CLI. Check gh auth status. Search the user's relevant pull requests or issues with gh search prs or gh search issues using goal terms and repository context. Inspect matching records for their title, URL, date and actual contribution.
- For Notion, use the connected Notion MCP search tool with the goal terms and fetch the matching pages. Use the page title, URL and material that supports the specific goal.
- Attach only matches you actually read and can link. On a user-requested build, record the goal, date, source URL and a sentence explaining the connection in evidence.md. Group the same entries under their goal in the evidence log. Refresh an existing URL instead of duplicating it. Keep prior evidence when a source is unavailable.
- Update only the source you actually checked. Show when it was checked and distinguish matches, a successful search with no matches, a missing tool, a login needed and a denied permission. With a missing CLI or connection, open that source’s setup details. With a refused tool, name what was refused and point to Orc’s permission controls. If another requested source is available, continue with it. Never infer that a source is connected from its setup instructions.
