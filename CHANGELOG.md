# Public Orc releases

This distribution contains Orc's end-user runtime and curated coding skills.
Private development run names and development history are not published.

Each release is a `## v<version>` section, newest first, written and reviewed
by the publisher before it goes out. A release bundles every change since the
one before.

## v3.157.0 (2026-11-27)

- New Integrations section in Settings for Slack, GitHub and Notion, with a switch for each. Orc now reads Slack with its own sign-in and checks it every 3 minutes.
- Costs can now be shown in pounds or dollars, and Year in review follows your choice. Factory tickets are calmer, with a kind tag, one row of facts and a cost for each subagent and worker.
- Merge queue: when a queued run will hit a conflict, you can see the steps ahead of it and press Resolve now to prepare the fix early.
- Vaults: new Self-celebrations, Next up and Meeting prep templates. Pages follow Orc's light and dark mode, and the New vault dialog lets you pick the model, effort and login.
- Plugins can be installed from a Git branch, pinned or following it. In Cmd+K you can add a plugin by pasting its Git URL.
- PR comments are planned on their own tab before fixing starts. Comments a push fixed get a 👍, and Push follows your comments and commits setting. The done bar can update the PR body, and the PR body opens as soon as it is written.
- Plans: start any one step of a split plan from its row, and the start panel stays still from Ready to Building. A plan's step runs now appear beneath it in the sidebar.
- Answer mode has a compact questions card, and a lone question can be answered right in Chat.
- The Servers page now leads with what needs your attention.
- Sidebar run statuses are clearer and the list scrolls to show the whole open run. Status grouping is gone.
- Phone improvements: the composer controls fit in three rows, and the done card, login cards and subagent counts are tidier. Installer actions stay visible, and the side panel tabs sit on one scrolling row.
- You can open every linked laptop from your phone through the one that is connected.
- Dictation shows its progress inside the composer bar and finishes before the draft is sent.
- Find tints every match in a pane and counts matches in folded diff files. Logs and plain-text run files open in a full-screen view.
- Smaller touches: Ship when done explains how a run ends, the side panel button shows lines added and removed, animations can be toggled from the command palette, and the Assets tab opens pictures full screen. Composer icon buttons have tooltips, and the model pill shows which model leads.
- Text is easier to read in many places, including QA, Settings search, sidebar badges, PR code in day mode and the cancelled and error states.
- Orc feels faster, with quicker run lists, sidebar scrolling and queued follow-ups.

## v3.104.0 (2026-11-26)

- Improved queue mode UX
- Made installing private packages easier
- Show advisors in factories
- Allow question runs to generate images as part of its answer

## v3.85.0 (2026-11-25)

- UX Improvements
- Updated Claude Code/Codex CLI compatibility.
- Improved QA browser

## v3.62.0 (2026-11-24)

- Orc is public: install it on Mac, Windows or Windows on Arm.

## v3.0.0

- Initial public release.

## Theme changes

| Old | New | What to edit |
|---|---|---|
| `.run-activity` | — | Removed the run-header activity badge; remove `.run-activity` rules from your theme. |
| `.activity-link` | — | Removed with `.run-activity`; remove `.activity-link` rules from your theme. |
| `.queue-open` | — | Removed from the run header with `.run-activity`; remove `.queue-open` rules from your theme. |
| `terminal` scene module | — | The maximised terminal now opens with the screen change every theme shares, so a theme's `terminal` module is no longer loaded. The manifest entry is still accepted; remove it and the module. |
| `stagePiece`, `stageRandom` from `/js/terminal-stage.js` | — | Removed with terminal scenes; drop the import with your `terminal` module. |
| `.stage-fx-…` | — | Removed with terminal scenes; remove `stage-fx-` rules from your theme. |
