# Shared rendered pages

Phases write source artifacts. `ui/serve.py` synthesizes the browser page on
request. Never write a gate page's HTML: an `.html` file in a run folder never
gets Orc's origin or the gate's controls, and the page synthesized from its
source replaces it. Other pages in a run folder or checkout open on their own
files origin, where module scripts, relative `fetch` and storage work but
dotfiles and other runs' files do not load. Lifecycle v3 synthesizes Plan from
`plan.mdx` and Ship from `ship/ship.mdx`. Completed historical gate pages stay
renderable from their recorded sources but are inert.

## Plan

Plan opens only after final lint. It shows Destination, Scope lock, Tickets,
Approach, Build contract, locked decisions, operational constraints, and any
UI acceptance states. The page binds exact approval or revision to the source
digest and generation. A pending/revision overlay must not expose stale
approval controls.

## Ship

Ship opens for `lifecycleVersion: 4` with valid live
`delivery-authority.json`, or for lifecycle v3 with a passing live
`verification-receipt.json`, and `phase=ship,status=awaiting-gate`. It combines
the concise outcome, evidence, 1–3 hands-on flows, and explicit delivery
actions. Non-UI work names hands-on as not applicable. Visible work with no app
is disclosed as a residual and never disables delivery.

The action bar is injected only into the current Ship page, never snapshots or
earlier artifacts. Viewing the page has no side effect. Each button is its own
claim under **Delivery consent** (`delivery-contract.md`), and a feedback or
manual override is a separate explicit claim too.
Stale Plan/diff/head/receipt authority renders recovery and no delivery.

## Presentation floor

- Use the Orc theme and existing design-system components.
- Preserve semantic headings, landmarks, native controls, accessible names,
  visible focus, keyboard order, reflow.
- Lead with what needs the user. Do not restate the phase the page already
  shows, and do not describe the page's own actions in prose above them.
- Keep pending, failed, historical, and actionable states visibly distinct in
  text, not color alone.
- Never claim runtime/visual facts that were not tested.

## Versions and links

Snapshot every shown source before overwriting it. The canonical path always
means Latest. Snapshots are read-only and never gain action injection. Start
`orc-ui`, print one HTTP deep link, and never auto-open a non-gate artifact.

```bash
orc-ui open --gate '<run-id>/plan.html'
orc-ui open --gate '<run-id>/ship/ship.html'
```

Completed pre-v3 Grilling, Review, MVP, QA, Recap, and Present pages remain
viewable for audit. Their old answers and actions are display data only and
cannot resume or mutate the run.
