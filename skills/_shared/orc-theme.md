# _shared/orc-theme.md — Orc page color scheme

All Orc-rendered pages (`plan.html`, `recap/recap.html`, `orc-ui` itself) use
Orc's restrained swamp palette. Slate-neutral canvases keep Tokyo Night's
subtlety while moss appears in secondary layers and the Orc mark; neutral ink
carries prose; blue is reserved for interaction and active work; status
colors keep their distinct meanings. Do not invent other product hex values —
pull from these tokens. Documented third-party marks and Orc's first-party art
are the only exceptions.

## CSS variables

`app-plugins/swamp/tokens.json` is the machine-readable source for these declarations,
`serve.py`'s gate-page template and fallbacks, `orc-ui`'s shell,
first-party SVG assets, the deck, and DESIGN.md's register. Run
`bin/orc-theme --write` after changing it; `bin/orc-theme` checks for drift.
Only a hand-authored bespoke page (rare — see `render-page.md`'s escape hatch)
still pastes this block into its inline CSS:

```css
:root {
  color-scheme: light dark; /* native scrollbars/controls match theme */
  /* Orc day */
  --bg: #e3e5e4; --panel: #eceeec; --border: #a8b0aa;
  --text: #38423c; --heading: #202722; --muted: #6e7971;
  --accent: #2d6983; --accent-soft: #cbd1cc; --chip: #cbd1cc; --code: #d4d8d5;
  --green: #53743a; --yellow: #8a6a2f; --red: #b83f50;
  --purple: #76518f; --cyan: #256f72; --orange: #9a5a25;
}
@media (prefers-color-scheme: dark) {
  :root {
    /* Orc night */
    --bg: #1a1c20; --panel: #16181b; --border: #3b4540;
    --text: #c7cfca; --heading: #e0e5e2; --muted: #707a73;
    --accent: #78a9c2; --accent-soft: #29312c; --chip: #29312c; --code: #1f2422;
    --green: #9dc76b; --yellow: #d5b05c; --red: #e87878;
    --purple: #b497d6; --cyan: #77b8b1; --orange: #e69257;
  }
}
/* An explicit setting wins over system preference in both directions. */
:root[data-theme="dark"] {
  --bg: #1a1c20; --panel: #16181b; --border: #3b4540;
  --text: #c7cfca; --heading: #e0e5e2; --muted: #707a73;
  --accent: #78a9c2; --accent-soft: #29312c; --chip: #29312c; --code: #1f2422;
  --green: #9dc76b; --yellow: #d5b05c; --red: #e87878;
  --purple: #b497d6; --cyan: #77b8b1; --orange: #e69257;
}
:root[data-theme="light"] {
  --bg: #e3e5e4; --panel: #eceeec; --border: #a8b0aa;
  --text: #38423c; --heading: #202722; --muted: #6e7971;
  --accent: #2d6983; --accent-soft: #cbd1cc; --chip: #cbd1cc; --code: #d4d8d5;
  --green: #53743a; --yellow: #8a6a2f; --red: #b83f50;
  --purple: #76518f; --cyan: #256f72; --orange: #9a5a25;
}
```

## Semantic roles

- `--bg` and `--panel` are slate-neutral canvases. `--border`, `--chip`, and
  `--code` carry the quiet moss undertone. Moss is atmosphere, never status.
- `--text` is body ink and `--heading` is emphasis. Do not use blue for prose.
- `--accent` is interactive/active and the visible focus color. Use
  `--accent-soft` for its quiet hover and selection fills.
- `--green` = pass/added; `--yellow` = warn; `--red` = fail/removed;
  `--orange` = gate/needs attention; `--purple` = merged lineage; `--cyan` =
  syntax or informational data, never an interaction substitute.
- Every state also names itself in text. Color is never the only signal.
- Orc marks and deck illustrations may compose palette hues as
  first-party art. Those uses do not assign workflow meaning and must remain
  visually separate from labeled status UI.

## Contrast and derivation

- Body and small UI text must meet 4.5:1; focus indicators and meaningful
  boundaries must meet 3:1 against adjacent surfaces.
- Meaningful resting control edges use `--control-border`, derived with
  `color-mix(in srgb, var(--border) 65%, var(--heading))`; decorative hairlines
  keep the quieter `--border`.
- Raw semantic hues are always valid for icons, dots, borders, and fills. For
  small text, use the surface's derived AA token (`--accent-text`,
  `--green-text`, `--yellow-text`, `--red-text`, `--gate`, or
  `--muted-strong`) rather than changing the semantic hue.
- Derive fills with `color-mix(in srgb, var(--token) 12%, transparent)` and
  borders at 40%. Do not add hard-coded tint hex values.
- Diff blocks use low-alpha `--green` for added, `--red` for removed, and
  `--muted` for hunk headers. Code blocks use `--code`.

Does NOT apply to the work repository's product code — this is Orc tooling chrome only.
