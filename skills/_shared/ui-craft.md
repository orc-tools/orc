# Shared: UI craft for small changes and mockups

Read this file only when a plan or build changes visible UI. Small edits inside
an existing product look best through restraint and mimicry, not reinvention.

## 1. Match the existing system first

- Read `DESIGN.md` (or the repo's token/theme stylesheet) before sketching or
  editing. Follow its explicit rules and Don'ts.
- Inspect the real markup and CSS of the nearest sibling component — an adjacent
  sidebar row, inline notice, clickable header, or button — and reuse its exact
  spacing, typography, radius, border, and interaction subtlety.

## 2. Subtract before adding

- Change text, links, or behavior in place before adding a wrapper. Never put a
  one-line notice inside an extra card or add an unrequested bold subheading.
- Never invent extra chrome: no unrequested icons, badges, hover boxes, drop
  shadows, or decorative side-stripes.
- Keep new controls no larger or louder than surrounding controls.

## 3. Build mockups with real CSS, not raster cover-ups

- Whenever a change adds, removes, or resizes UI, render the local region with
  real flowing HTML/CSS using the repo's tokens and fonts so spacing grows or
  collapses naturally.
- Never mask out old UI on a fixed-height screenshot with `position: absolute`
  rectangles — guessed hex fills leave color seams and dead whitespace. Use a
  background screenshot only for non-layout overlays where nothing shifts or
  shrinks.
- In Orc, run `orc-mockup-scaffold --run-dir <run-dir> --label <label>` to get
  a self-contained HTML file with Orc's theme tokens, `--orc-*` aliases, and
  local Inter/JetBrains Mono fonts already wired.

## 4. Pick the right medium

- Skip a rest-state mockup for pure interaction tweaks with no resting visual
  change (such as making an existing header clickable) rather than inventing
  fake hover chrome to draw.
- For 3D scenes, shaders, or game characters, never paste flat 2D SVGs onto 3D
  renders. Use engine captures, reference images, or concept art instead.

## 5. One-pass visual self-check

Open your rendered mockup PNG (or build after-shot) and check five points before
showing it to the user. Fix and re-capture once if any point fails:

1. **Seams and bounds:** no background patch seams, dead whitespace, clipping,
   or elements sticking out past their container.
2. **No unrequested chrome:** no extra card, border, stripe, hover box, icon, or
   moved control.
3. **Neighbor parity:** left edges, padding, font size/weight, ellipsis, and
   tokens match adjacent UI.
4. **Visual weight:** new controls stay as quiet as their neighbors.
5. **Honest medium:** the picture fairly represents the real build.
