# _shared/screenshot-playwright.md — throwaway Playwright capture fallback

Read this file **only when** the target repository has no capture command of
its own or its capture command has no view for the changed state. Follow
[screenshot.md](screenshot.md) for reuse, revision naming, validation, and
consumer rules.

## Repeatable capture in any project

The shared capture API in `assets/playwright/capture.mjs` (`~/.orc/playwright/capture.mjs`)
provides repeatable stills and GIFs:

```js
import { chromium } from '@playwright/test';
import { captureLoopGif, captureViewport, freezeMotion, prepareRepeatablePage, REPEATABLE_BROWSER_ARGS } from '../capture.mjs';

const browser = await chromium.launch({ args: REPEATABLE_BROWSER_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await prepareRepeatablePage(page);            // before the first navigation
await page.goto(url);
await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
await freezeMotion(page, { atMs: 20000 });
const still = await captureViewport(page, 'after/home.jpg', { target, targetDescription, reason });
const loop = await captureLoopGif(page, 'after/home-motion.gif', { target, targetDescription, reason });
```

`prepareRepeatablePage` pins the clock and `Math.random`. `freezeMotion` stops
timers and puts every CSS and Web Animation, shadow DOM and iframes included,
on one timeline. `captureLoopGif` seeks each frame on that timeline, defaults to
6 seconds at 12 fps, crossfades the loop seam, and steps down to 75% then 50%
size to stay under 10 MB (limits: 15 seconds, 25 fps; pass `padding` for a
focused crop; pass `advanceClock: true` only for JS timer/`requestAnimationFrame`
animations such as canvas).

Serve fixed data too: live feeds or relative timestamps still drift across runs.
Failures throw `BestEffortCaptureError` (`NO_MOTION`, `UNSTABLE_FRAME`,
`SIZE_LIMIT`, `ENCODER_UNAVAILABLE`): keep the still and record the reason. Use
`captureLoopGif` for ambient motion and `captureFocusedAnimation` for a
triggered interaction (hover, focus, drag).

## Layout and shared harness (`~/.orc/playwright`)

```text
~/.orc/
  playwright/                # persistent shared harness — never inside the repo
    package.json             # @playwright/test + chromium
  runs/<id>/shots/
    spec/*.spec.ts           # throwaway specs — never committed
    playwright.config.ts     # generated: absolute testDir, outputDir, baseURL
    node_modules             # symlink -> ~/.orc/playwright/node_modules
    capture.mjs              # symlink -> ~/.orc/playwright/capture.mjs
    before/<label>.jpg       # merge-base still (best-effort, may be absent)
    after/<label>.jpg        # post-change still (.png when high quality asked for)
    before/<flow>-motion.gif # optional focused temporal evidence
    after/<flow>-motion.gif
    manifest.json
```

Never conclude "no browser tooling available" from a missing repo
`node_modules`. Preflight is the sole authority:

```bash
~/.orc/playwright/preflight.sh
```

- `PREFLIGHT_OK <version>` (exit 0) -> proceed (auto-installs/repairs the
  harness on first use).
- `PREFLIGHT_FAIL <reason>` (exit 1) -> record that exact reason, skip capture,
  and continue the run. Never write a "no browser tooling" note without a
  `PREFLIGHT_FAIL` output line.

(If `preflight.sh` is absent, run `(cd ~/.orc/playwright && npx playwright --version)`
and initialize with `npm init -y && npm i -D @playwright/test && npx playwright install chromium`
when missing.)

GIF encoding optionally checks `command -v ffmpeg || command -v magick`. Helpers
use `ffmpeg` then compatible ImageMagick `magick`; **do not install** either. A
missing encoder skips GIF capture only while static stills remain authoritative.

## Base URL and authentication

- Worktree with `meta.worktree.started` -> `meta.worktree.url`. Otherwise reuse
  or start the repository's documented server command (never a live user
  instance; capture failure never blocks delivery). Backfill
  `worktree.relevantPath` in `meta.json` from the primary flow's root-relative
  path only when Build left it unset.
- **Orc UI app-handoff gate:** prefer `orc-ui preview <worktree>` (`browserOnly`),
  or dismiss the overlay first:
  ```js
  const cont = page.getByRole('button', { name: /Continue in browser/i });
  if (await cont.count()) await cont.click();
  ```
- **Authenticated capture (Rails worktrees):** use only the repository's or
  installed helper package's authorized disposable test session (`storageState`
  via `CAPTURE_STORAGE_STATE` and `CAPTURE_BASE_URL`), validating both before
  starting. Stop and report if missing or expired; never leak tokens/cookies or
  access shared data. Use custom DNS/cert options only when that test
  environment requires them.

## Throwaway specs

- Write one spec per changed flow in `shots/spec/` targeting the smallest stable
  component or container showing the change plus state context.
- Import `captureFocused`, `captureViewport`, `captureFullPage`,
  `captureFocusedAnimation`, and `captureLoopGif` from `../capture.mjs`; never
  call `page.screenshot` or `locator.screenshot` directly. Pass a semantic
  `targetDescription` (never `locator.toString()`).
- **Focused capture is the default:** call
  `captureFocused(locator, path, { padding: 24, targetDescription })` on a
  stable semantic locator (role + accessible name, test id, or landmark) once
  settled. When manual clipping is needed, scroll into view, add 16–32 CSS px
  padding clamped to bounds, and keep shadows, focus rings, menus, tooltips, and
  expanded content uncropped.
- **Classify temporal evidence first:** request a GIF only when time, order, or
  interaction is needed to see the change — simulation, hover, focus transition,
  drag/reorder, progress, or changed animation timing. Static layout, copy, or
  color stays still-only. Record every attempted, skipped, and failed motion
  capture in Build's capture proof (recorded lifecycle-v3 Verify folds it into
  `verification-receipt.json`); the worker does not write a duplicate QA report
  or `decisions.jsonl` row.
- **One distinct before/after GIF pair per changed flow** alongside normal
  stills, with a separate kebab-case label (`<flow>-motion`) inside the same
  spec pass.
- **Focused animation API:** call
  `captureFocusedAnimation(locator, path, action, options = {})` where `action`
  triggers the change once. Hard budget: at most 2.5 seconds, 8 fps, 20 frames,
  CSS scale, and output below 10 MB. Use Playwright Clock and the app's
  established seed hook with the same
  clock/seed setup in both checkouts (otherwise note nondeterminism risk). Catch
  `BestEffortCaptureError`, delete partial GIFs, record the failure, and keep
  stills; never record WebM/video or fall back to a viewport/full-page GIF
  (ambient whole-screen motion uses `captureLoopGif` with a reason).
- Call `captureViewport(page, path, { target, targetDescription, reason })`
  only when viewport is the smallest useful frame (`target` >= 20% of frame;
  “element is fixed” or “viewport anchored” fail validation). A fixed top-right button uses a clamped 24px padded
  top-right `captureFocused` crop, never a full viewport.
- Call `captureFullPage(page, path, { target, targetDescription, reason })`
  only for page-scale changes (layout, theme, shell, or distant linked regions).
  Scroll to bottom and back first; if the app scrolls inside a fixed-height
  pane (`100vh`), grow the viewport to content height before capturing and
  restore afterward.
- Keep the **same focus locator, viewport, state setup, padding, and capture
  method** across before and after (using the nearest shared ancestor when the
  changed child is new). Capture only changed states (2–4 shots per flow,
  kebab-case state labels, never `01-` prefixes or login/loading hops).

Run from the shots dir (`preflight.sh <shots-dir>` checks/repairs the shared
harness and writes that shots dir's `node_modules` symlink, `capture.mjs`
symlink, and ESM `package.json`):

```bash
~/.orc/playwright/preflight.sh ~/.orc/runs/<id>/shots
cd ~/.orc/runs/<id>/shots
~/.orc/playwright/node_modules/.bin/playwright test --config playwright.config.ts
orc-validate-shots --strict shots/manifest.json
```

Use `viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5` and `.jpg`
stills (quality 80); use `.png` at `deviceScaleFactor: 2` only when high quality
is requested or a side exceeds 65,500 device px. Retake once on strict
validation failure; unresolved capture failure blocks Build authority.

## Before/after checkout pass and manifest schema

Work is committed before capture, so the tree must be clean (skip before if
dirty):

1. `BASE=$(git -C <repoPath> merge-base <branch> <default>)`
2. `git -C <repoPath> checkout $BASE` -> reload server -> run specs into
   `shots/before/` (best-effort; `"before": null` on failure; `"before": null, "new": true`
   for newly introduced surfaces).
3. `git -C <repoPath> checkout <branch>` -> reload -> run specs into
   `shots/after/`, then verify `git -C <repoPath> rev-parse --abbrev-ref HEAD`.

Write `capture.before` / `capture.after` directly from helper return values
(never hand-author framing fields or wrap the array in `"shots"`):

```json
[{ "label": "feedback-button", "flow": "feedback action",
   "before": "before/feedback-button.jpg", "after": "after/feedback-button.jpg",
   "capture": {
     "before": { "captureVersion": 1, "method": "focused",
       "target": "fixed top-right feedback button", "reason": "default focused crop",
       "padding": 24, "targetBounds": { "x": 1320, "y": 24, "width": 72, "height": 40 },
       "imageBounds": { "x": 1296, "y": 0, "width": 120, "height": 88 },
       "viewport": { "width": 1440, "height": 900 } },
     "after": { "captureVersion": 1, "method": "focused",
       "target": "fixed top-right feedback button", "reason": "default focused crop",
       "padding": 24, "targetBounds": { "x": 1312, "y": 24, "width": 80, "height": 40 },
       "imageBounds": { "x": 1288, "y": 0, "width": 128, "height": 88 },
       "viewport": { "width": 1440, "height": 900 } }
   } }]
```

GIF entries use the same framing schema with `.gif` paths, `<flow>-motion`
labels, and optional `setup`.
