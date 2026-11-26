# Public Orc releases

This distribution contains Orc's end-user runtime and curated coding skills.
Private development run names and development history are not published.

Each release is a `## v<version>` section, newest first, written and reviewed
by the publisher before it goes out. A release bundles every change since the
one before.

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
