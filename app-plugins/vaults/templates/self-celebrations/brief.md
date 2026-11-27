# Self-celebrations

Keep the page headed "Good things, lately" on its yellow ground. Under the heading, the year of dots sits on one cream sheet across the page. Below it, the good things by month on the left, and the box headed "Tell it one yourself" with the three sources under it on the right. On a phone the box comes straight under the heading. The user can rename or restyle any of it.

Icons are drawn: use `<svg class="icon" aria-hidden="true"><use href="#i-out"/></svg>` after a link that leaves the page, never a character such as ↗.

## Good things

Keep each good thing in good-things.md as one line, newest first:

`- YYYY-MM-DD · GitHub|Notion|Slack|Me · What happened — why it mattered · [link text](url)`

Leave out the link for one the user told you with no link. Record only what the user did or was thanked for. Keep other people's private details out of it.

Draw the page from good-things.md on every build:

- **The year.** Write the total in `#year-title`, such as "39 good things in the last 12 months" ("1 good thing in the last 12 months" for one). Twelve columns in `#year`, the last 12 months ending with this one. Write each month's short name in its `.month` and put `aria-current="date"` on this month. Each column's `.dots` holds one `<i class="dot github|notion|slack|me"></i>` for each good thing of that month, the oldest at the bottom.
- **By month.** In `#months`, one `<section class="month-group">` for each month with good things, newest first, headed by the month's name (and its year when it is not this year) and how many it kept: `<h2>November <span>5 kept</span></h2>`. Each good thing is a `<div class="thing">`: `<time datetime="YYYY-MM-DD">24 Nov</time>`, a `<div>` with what happened in `<p class="what">` and why it mattered in `<p class="why">`, then its source tag, the link with the source's dot inside it: `<a class="tag" href="…"><i class="dot github"></i>web-app #412</a>`. One with no link ends with `<span class="tag"><i class="dot me"></i>Told by you</span>`. Remove the `.empty` line once there is one good thing.
- **Told by you.** When the user tells you one in the box, add it as `Me` with today's date, unless they give its date or source.

## Collecting

Each **Collect** button asks you to collect from one source. Use the vault's own login and the builder's existing permissions. Look back to the date that source was last checked, or 30 days the first time. Never add a URL that good-things.md already holds.

- **GitHub.** Use the authenticated gh CLI. Check `gh auth status`. Find the user's merged pull requests (`gh search prs --author @me --merged`), reviews they gave and issues they closed. Keep work that landed, with its title, URL and date.
- **Notion.** Use the connected Notion MCP search tool. Find pages the user wrote or finished, and comments thanking them. Keep the page's title, URL and date.
- **Slack.** Use the connected Slack MCP search tool. Find messages thanking or praising the user, and announcements of what they shipped. Keep a short quote, the channel, the message's link and its date. Leave out direct messages unless the user asks for them.

Read each match before you keep it. Group a burst of the same kind, such as 9 reviews in one week, into one good thing.

Update the source's `.src-state` with what happened, always with an absolute date: "Checked 24 Nov 2026. 4 new.", "Checked 24 Nov 2026. Nothing new.", "Needs sign-in: run /mcp in Claude Code.", "The gh CLI is not installed." or "Slack search was refused." Add the class `ok` to a state that checked, which leaves the source as one quiet line, and `failed` to one that could not, which outlines it. Never infer that a source is connected from its setup steps. With a missing CLI or connection, mark it `failed` and open that source's setup `details` so its steps show. With a refused tool, name what was refused and point to Orc's Allow. Move the `go` class to the button of the source the user should press next. Keep what was kept before when a source is unavailable.

In your reply, say what you kept from where, such as "Kept 4 from GitHub."

The page has light and dark looks, switched by `data-orc-mode` on the html element; keep both when restyling.
